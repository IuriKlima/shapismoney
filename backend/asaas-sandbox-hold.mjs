import http from 'node:http';
import {readFileSync,unlinkSync} from 'node:fs';

export const NETWORK_DIAGNOSTIC_PATH='/__sandbox-network-check-20261013';
const cleanNetworkField=value=>typeof value==='string'?value.replace(/[^\x20-\x7e]/g,'').slice(0,200):null;

// Public preparation page only: no database, credentials, sessions or financial routes.
export async function startSandboxHold({port=5191,host='0.0.0.0',diagnosticArmFile='/tmp/shape-network-diagnostic-arm',diagnosticLog=console.log,now=Date.now}={}){
 if(process.env.NODE_ENV==='production'||!Number.isInteger(port)||port<0||port>65535)throw Error('Sandbox preparation only.');
 const server=http.createServer({requestTimeout:5000,headersTimeout:5000},(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");res.setHeader('Referrer-Policy','no-referrer');req.resume();
  // Temporary, operator-armed, one visit only. Never inspect cookies, credentials or body.
  if(req.url===NETWORK_DIAGNOSTIC_PATH){
   let armedAt;try{armedAt=Number(readFileSync(diagnosticArmFile,'utf8'));}catch{}
   const valid=Number.isSafeInteger(armedAt)&&armedAt>0&&now()>=armedAt&&now()-armedAt<300000;
   if(!valid||req.method!=='GET'){if(!valid){try{unlinkSync(diagnosticArmFile);}catch{}}res.writeHead(404);return res.end();}
   try{unlinkSync(diagnosticArmFile);}catch{res.writeHead(404);return res.end();}
   diagnosticLog('SANDBOX_NETWORK_DIAGNOSTIC '+JSON.stringify({remoteAddress:cleanNetworkField(req.socket.remoteAddress),host:cleanNetworkField(req.headers.host),forwardedHost:cleanNetworkField(req.headers['x-forwarded-host']),forwardedProto:cleanNetworkField(req.headers['x-forwarded-proto']),forwardedFor:cleanNetworkField(req.headers['x-forwarded-for'])}));
   res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Visita de teste registrada. Pode voltar ao chat.');
  }
  if(req.url==='/healthz'&&['GET','HEAD'].includes(req.method)){res.writeHead(200,{'Content-Type':'application/json'});return res.end(req.method==='HEAD'?undefined:JSON.stringify({ready:true,mode:'preparation',financialEnabled:false}));}
  if(req.url==='/'&&['GET','HEAD'].includes(req.method)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Shape — Ambiente de teste</title><main><h1>Ambiente de teste em preparação</h1><p>As funcionalidades ainda estão indisponíveis.</p><p>Nenhum dado pessoal ou pagamento é solicitado nesta página.</p></main></html>');}
  res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({available:false}));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {server,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
