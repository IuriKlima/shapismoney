import {isIP} from 'node:net';
const fail=message=>{const error=new Error(message);error.status=403;error.safe=true;throw error;};
export const localSecurity=()=>({production:false,cookieName:'sim_local_session'});
export function productionSecurity(env){
  if(env.SIM_PRODUCTION_REVIEWED!=='true')throw Error('Production review flag is required.');
  let origin;try{origin=new URL(env.SIM_PUBLIC_ORIGIN);}catch{throw Error('HTTPS public origin is required.');}
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||['localhost','127.0.0.1'].includes(origin.hostname)||origin.hostname.endsWith('.invalid'))throw Error('A canonical HTTPS origin is required.');
  const proxies=(env.SIM_TRUSTED_PROXY_IPS||'').split(',').map(s=>s.trim()).filter(Boolean);if(!proxies.length||proxies.some(ip=>!isIP(ip)))throw Error('Explicit trusted proxy IP addresses are required.');
  return {production:true,cookieName:'__Host-sim_session',origin:origin.origin,host:origin.host,proxies};
}
export function assertRequest(req,security,{health=false}={}){
  const peer=req.socket.remoteAddress;const local=['127.0.0.1','::ffff:127.0.0.1','::1'].includes(peer);
  if(health&&local)return {clientIP:peer};
  if(req.headers['sec-fetch-site']==='cross-site')fail('Requisição externa bloqueada.');
  let origin;
  if(security.production){
    const normalized=peer?.startsWith('::ffff:')?peer.slice(7):peer;
    if(!security.proxies.includes(normalized)||req.headers.host!==security.host||req.headers['x-forwarded-proto']!=='https')fail('Proxy HTTPS inválido.');
    const ip=req.headers['x-forwarded-for'];if(typeof ip!=='string'||!isIP(ip))fail('Identidade de rede inválida.');
    origin=security.origin;if(req.method!=='GET'&&req.headers.origin!==origin)fail('Origem inválida.');return {clientIP:ip};
  }
  let host;try{host=new URL('http://'+req.headers.host);}catch{fail('Host inválido.');}
  if(!local||!['127.0.0.1','localhost'].includes(host.hostname)||req.headers.host!==host.host)fail('Somente loopback.');
  origin='http://'+host.host;if(req.method!=='GET'&&req.headers.origin!==origin)fail('Origem inválida.');return {clientIP:peer};
}
export const cookieHeader=(security,token,maxAge)=>security.cookieName+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(security.production?'; Secure':'');
