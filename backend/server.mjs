import {nutritionRuntimeConfiguration} from './nutrition-runtime.mjs';
import {createAnalysisDemo} from './analysis-demo.mjs';
import {trainingRuntimeConfiguration} from './training-runtime.mjs';
import {accessMailConfiguration} from './access-mail.mjs';
import {chatRuntimeConfiguration} from './ai-chat.mjs';
import http from 'node:http';
import {resolveAIConfiguration} from './ai-config.mjs';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openLocalStore} from './store.mjs';
import {createLocalService} from './service.mjs';
import {asyncLocalStore} from './async-store.mjs';
import {assertRequest,localSecurity,productionSecurity} from './security.mjs';
import {postgresStore,poolFromEnvironment,verifyRuntimeRole} from './postgres.mjs';
export async function createLocalServer({filename,store:provided,security=localSecurity(),analysisDemo={},...options}){
  if(process.env.NODE_ENV==='production'&&!security.production)throw Error('Local server refuses production.');
  if(security.production&&provided?.kind!=='postgres')throw Error('Production requires the PostgreSQL adapter.');
  const store=provided||openLocalStore(filename);const serviceStore=store.kind==='postgres'?store:asyncLocalStore(store);const api=await createLocalService({store:serviceStore,security,...options});const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/sim');
  const demonstration=createAnalysisDemo({...analysisDemo,security});
  const server=http.createServer({requestTimeout:10000,headersTimeout:10000},async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Referrer-Policy':'no-referrer'};
    for(const [key,value] of Object.entries(headers))res.setHeader(key,value);
    let url;try{url=new URL(req.url,'http://127.0.0.1');assertRequest(req,security,{health:url.pathname==='/healthz'});}catch{res.writeHead(403,{'Content-Type':'application/json'});return res.end('{"error":"Origem ou proxy inválido."}');}
    if(security.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    if(url.pathname==='/healthz'&&req.method==='GET'){try{await serviceStore.get('SELECT 1 AS ok');res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ready":true}');}catch{res.writeHead(503);return res.end('{"ready":false}');}}
    if(await demonstration.handle(req,res,url.pathname))return;
    if((url.pathname==='/analysis-demo'||url.pathname==='/sim/analysis-demo.js'||url.pathname==='/sim/analysis-demo.css')&&!demonstration.enabled){res.writeHead(404);return res.end();}
    if(url.pathname.startsWith('/api/'))return api(req,res);
    if(req.method!=='GET'&&!(req.method==='HEAD'&&['/','/local','/radar','/vendas','/privacidade'].includes(url.pathname))){res.writeHead(405);return res.end();}
    const files={'/sim/analysis-demo.css':'analysis-demo.css','/analysis-demo':'analysis-demo.html','/sim/analysis-demo.js':'analysis-demo.js','/':'public.html','/radar':'public.html','/vendas':'public.html','/privacidade':'public.html','/sim/public.js':'public.js','/sim/public.css':'public.css','/sim/brand-fonts.css':'brand-fonts.css','/sim/radar-model.js':'radar-model.js','/sim/profile-ui.js':'profile-ui.js','/sim/assets/architecture.webp':'assets/architecture.webp','/sim/assets/bruno-barbosa-667.webp':'assets/bruno-barbosa-667.webp','/sim/assets/bruno-barbosa-400.webp':'assets/bruno-barbosa-400.webp','/local':'persistent.html','/sim/persistent.js':'persistent.js','/sim/access-ui.js':'access-ui.js','/sim/manual-training-ui.js':'manual-training-ui.js','/sim/nutrition-proposal-ui.js':'nutrition-proposal-ui.js','/sim/nutrition-ui.js':'nutrition-ui.js','/sim/budget-ui.js':'budget-ui.js','/sim/intake-fields.js':'intake-fields.js','/sim/intake-ui.js':'intake-ui.js','/sim/crm-ui.js':'crm-ui.js','/sim/supervision-ui.js':'supervision-ui.js','/sim/training-proposals-ui.js':'training-proposals-ui.js','/sim/training-session-editor.js':'training-session-editor.js','/sim/style.css':'style.css','/sim/logo.svg':'logo.svg'};const name=files[url.pathname];if(!name){res.writeHead(404);return res.end();}
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'};
    try{let body=readFileSync(path.join(root,name));if(security.production&&name==='persistent.html')body=Buffer.from(body.toString().replace('Fatia local persistente · somente dados fictícios · convites com entrega manual; sem pagamentos ou uploads. Este fluxo usa sessões e banco no servidor, separado da demonstração.','Acompanhamento com acesso individual. Propostas de treino exigem aprovação profissional; pagamentos e uploads ainda indisponíveis.'));res.writeHead(200,{'Content-Type':types[path.extname(name)]});res.end(req.method==='HEAD'?undefined:body);}catch{res.writeHead(500);res.end('Recurso indisponível.');}
  });
  return {server,store,flushAccessEmail:()=>api.flushAccessEmail?.(),close:async()=>{await api.close?.();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await serviceStore.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let app;
  try{
    const production=process.env.NODE_ENV==='production';const security=production?productionSecurity(process.env):localSecurity();
    const port=Number(process.env.SIM_BACKEND_PORT||'5190');if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid application port.');
    const ai=resolveAIConfiguration(process.env);
    let store;if(production){store=postgresStore(poolFromEnvironment());try{await verifyRuntimeRole(store);}catch(error){await store.close();throw error;}}
    app=await createLocalServer({filename:path.resolve('.qa/local-backend/app.sqlite'),store,security,ai,radarOrgId:process.env.SIM_RADAR_ORG_ID,analysisDemo:{enabled:process.env.SIM_ANALYSIS_DEMO_ENABLED==='true',videoDirectory:process.env.SIM_VIDEO_DIR},trainingProposals:trainingRuntimeConfiguration(process.env,security),nutritionProposals:nutritionRuntimeConfiguration(process.env,security),chat:chatRuntimeConfiguration(process.env,ai),accessEmail:accessMailConfiguration(process.env,security)});
    app.server.listen(port,production?'0.0.0.0':'127.0.0.1',()=>console.log('SIM backend started | '+(production?'PostgreSQL / trusted HTTPS proxy':'local loopback / no accounts provisioned')));
    for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
  }catch{console.error('SIM startup failed: validate PostgreSQL roles/migrations, HTTPS origin, proxy and required environment. No fallback was started.');process.exitCode=1;}
}
