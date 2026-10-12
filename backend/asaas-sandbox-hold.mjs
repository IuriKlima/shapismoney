import http from 'node:http';

// Public preparation page only: no database, credentials, sessions or financial routes.
export async function startSandboxHold({port=5191,host='0.0.0.0'}={}){
 if(process.env.NODE_ENV==='production'||!Number.isInteger(port)||port<0||port>65535)throw Error('Sandbox preparation only.');
 const server=http.createServer({requestTimeout:5000,headersTimeout:5000},(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");res.setHeader('Referrer-Policy','no-referrer');req.resume();
  if(req.url==='/healthz'&&['GET','HEAD'].includes(req.method)){res.writeHead(200,{'Content-Type':'application/json'});return res.end(req.method==='HEAD'?undefined:JSON.stringify({ready:true,mode:'preparation',financialEnabled:false}));}
  if(req.url==='/'&&['GET','HEAD'].includes(req.method)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Shape — Ambiente de teste</title><main><h1>Ambiente de teste em preparação</h1><p>As funcionalidades ainda estão indisponíveis.</p><p>Nenhum dado pessoal ou pagamento é solicitado nesta página.</p></main></html>');}
  res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({available:false}));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {server,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
