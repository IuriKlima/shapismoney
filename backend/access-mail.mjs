import * as fs from 'node:fs';
import path from 'node:path';
import {smtpAccessTransport} from './access-smtp.mjs';
const unavailable=()=>Error('Access email configuration unavailable.');
export function resendAccessTransport({apiKey,from,fetchImpl=fetch}){return {kind:'resend',async send({to,subject,text,idempotencyKey,signal}){try{const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(10000)]),headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from,to:[to],subject,text})});let body='';const reader=response.body?.getReader();if(!reader)throw unavailable();try{while(true){const {done,value}=await reader.read();if(done)break;if(body.length+value.length>2048)throw unavailable();body+=new TextDecoder().decode(value);}}finally{await reader.cancel();}if(!response.ok||body.length>2048||typeof JSON.parse(body).id!=='string')throw unavailable();return {accepted:true};}catch{throw unavailable();}}};}
// Disabled settings never read a key, instantiate a provider, or send anything.
export function accessMailConfiguration(env,security,{fsImpl=fs,platform=process.platform,uid=process.getuid?.(),fetchImpl=fetch,loadMailer}={}){
 if(env.SIM_ACCESS_EMAIL_ENABLED!=='true')return {enabled:false};
 let fd;try{
  if(env.SIM_ACCESS_EMAIL_REVIEWED!=='true'||!['smtp','resend'].includes(env.SIM_MAIL_PROVIDER)||typeof env.SIM_MAIL_FROM!=='string'||env.SIM_MAIL_FROM.length>254||! /^[\x21-\x7e]+$/.test(env.SIM_MAIL_FROM)||! /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.SIM_MAIL_FROM))throw unavailable();
  const url=new URL(security.origin||env.SIM_PUBLIC_ORIGIN);if(url.protocol!=='https:'||url.origin!==url.href.slice(0,-1)||url.username||url.password||url.hostname.endsWith('.invalid'))throw unavailable();
  const smtp=env.SIM_MAIL_PROVIDER==='smtp';if(smtp&&(! /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(env.SIM_SMTP_HOST||'')||!env.SIM_SMTP_HOST.includes('.')||!['465','587'].includes(env.SIM_SMTP_PORT)||env.SIM_SMTP_USER!==env.SIM_MAIL_FROM))throw unavailable();
  const file=smtp?env.SIM_SMTP_PASSWORD_FILE:env.SIM_MAIL_API_KEY_FILE,paths=env.NODE_ENV==='production'?path.posix:path;if(typeof file!=='string'||!paths.isAbsolute(file)||paths.normalize(file)!==file||env.NODE_ENV==='production'&&file!==(smtp?'/run/secrets/sim_smtp_password':'/run/secrets/sim_mail_api_key'))throw unavailable();
  for(let current=file;;current=paths.dirname(current)){if(fsImpl.lstatSync(current).isSymbolicLink())throw unavailable();if(paths.dirname(current)===current)break;}
  const original=fsImpl.lstatSync(file);fd=fsImpl.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const stat=fsImpl.fstatSync(fd);if(!stat.isFile()||stat.size<1||stat.size>4096||stat.ino!==original.ino||stat.dev!==original.dev||platform!=='win32'&&((stat.mode&0o037)!==0||![0,uid].includes(stat.uid)))throw unavailable();
  const buffer=Buffer.alloc(4097),size=fsImpl.readSync(fd,buffer,0,buffer.length,0),apiKey=buffer.subarray(0,size).toString('utf8').trim();buffer.fill(0);if(size>4096||! /^[\x21-\x7e]{1,4096}$/.test(apiKey))throw unavailable();
  return {enabled:true,reviewed:true,publicOrigin:url.origin,transport:smtp?smtpAccessTransport({host:env.SIM_SMTP_HOST,port:Number(env.SIM_SMTP_PORT),user:env.SIM_SMTP_USER,password:apiKey,from:env.SIM_MAIL_FROM,loadMailer}):resendAccessTransport({apiKey,from:env.SIM_MAIL_FROM,fetchImpl})};
 }catch{throw unavailable();}finally{if(fd!==undefined){try{fsImpl.closeSync(fd);}catch{/* No secret diagnostics. */}}}
}
