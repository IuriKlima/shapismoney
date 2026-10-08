import http from 'node:http';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openLocalStore} from './store.mjs';
import {createLocalService} from './service.mjs';
import {asyncLocalStore} from './async-store.mjs';
import {assertRequest,localSecurity,productionSecurity} from './security.mjs';
import {postgresStore,poolFromEnvironment,verifyRuntimeRole} from './postgres.mjs';
export async function createLocalServer({filename,store:provided,security=localSecurity(),...options}){
  if(process.env.NODE_ENV==='production'&&!security.production)throw Error('Local server refuses production.');
  if(security.production&&provided?.kind!=='postgres')throw Error('Production requires the PostgreSQL adapter.');
  const store=provided||openLocalStore(filename);const serviceStore=store.kind==='postgres'?store:asyncLocalStore(store);const api=await createLocalService({store:serviceStore,security,...options});const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/sim');
  const server=http.createServer({requestTimeout:10000,headersTimeout:10000},async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Referrer-Policy':'no-referrer'};
    for(const [key,value] of Object.entries(headers))res.setHeader(key,value);
    let url;try{url=new URL(req.url,'http://127.0.0.1');assertRequest(req,security,{health:url.pathname==='/healthz'});}catch{res.writeHead(403,{'Content-Type':'application/json'});return res.end('{"error":"Origem ou proxy inválido."}');}
    if(security.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    if(url.pathname==='/healthz'&&req.method==='GET'){try{await serviceStore.get('SELECT 1 AS ok');res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ready":true}');}catch{res.writeHead(503);return res.end('{"ready":false}');}}
    if(url.pathname.startsWith('/api/'))return api(req,res);
    if(req.method!=='GET'){res.writeHead(405);return res.end();}
    const files={'/':'persistent.html','/local':'persistent.html','/sim/persistent.js':'persistent.js','/sim/style.css':'style.css','/sim/logo.svg':'logo.svg'};const name=files[url.pathname];if(!name){res.writeHead(404);return res.end();}
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
    try{let body=readFileSync(path.join(root,name));if(security.production&&name==='persistent.html')body=Buffer.from(body.toString().replace('Fatia local persistente · somente dados fictícios · convites com entrega manual; sem pagamentos ou uploads. Este fluxo usa sessões e banco no servidor, separado da demonstração.','Acompanhamento com acesso individual. Propostas de treino exigem aprovação profissional; pagamentos e uploads ainda indisponíveis.'));res.writeHead(200,{'Content-Type':types[path.extname(name)]});res.end(body);}catch{res.writeHead(500);res.end('Recurso indisponível.');}
  });
  return {server,store,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await serviceStore.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let app;
  try{
    const production=process.env.NODE_ENV==='production';const security=production?productionSecurity(process.env):localSecurity();
    const port=Number(process.env.SIM_BACKEND_PORT||'5190');if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid application port.');
    let store;if(production){store=postgresStore(poolFromEnvironment());try{await verifyRuntimeRole(store);}catch(error){await store.close();throw error;}}
    app=await createLocalServer({filename:path.resolve('.qa/local-backend/app.sqlite'),store,security,ai:{apiKey:process.env.SIM_AI_ENABLED==='true'?process.env.OPENAI_API_KEY:'',model:process.env.OPENAI_MODEL||'gpt-5.4-nano'}});
    app.server.listen(port,production?'0.0.0.0':'127.0.0.1',()=>console.log('SIM backend started | '+(production?'PostgreSQL / trusted HTTPS proxy':'local loopback / no accounts provisioned')));
    for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
  }catch{console.error('SIM startup failed: validate PostgreSQL roles/migrations, HTTPS origin, proxy and required environment. No fallback was started.');process.exitCode=1;}
}
