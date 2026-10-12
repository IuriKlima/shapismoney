import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalServer} from './server.mjs';
import {sandboxSecurity} from './security.mjs';
import {sandboxConfiguration} from './commerce/asaas-sandbox-config.mjs';
import {startSandboxHold} from './asaas-sandbox-hold.mjs';

// Separate entrypoint. Normal app startup never reads/enables Asaas configuration.
export async function startAsaasSandbox(values,{fetchImpl}={}){
 if(process.env.NODE_ENV==='production')throw Error('Production forbidden.');
 if(values.SIM_ASAAS_SANDBOX_ENABLED!=='true')return startSandboxHold({port:Number(values.SIM_BACKEND_PORT||5191)});
 if(process.env.NODE_ENV==='production'||values.SIM_ASAAS_ISOLATED_DATABASE!=='true')throw Error('Dedicated sandbox database required.');
 const config=sandboxConfiguration(values);if(!config.enabled)throw Error('Explicit sandbox activation required.');
 const security=sandboxSecurity(values);if(config.publicOrigin!==security.origin)throw Error('Callback origin mismatch.');
 const filename=values.SIM_ASAAS_DATABASE_PATH,orgId=values.SIM_ASAAS_ORG_ID,port=Number(values.SIM_BACKEND_PORT||5191);
 if(!filename||!path.isAbsolute(filename)||!/^[-a-f0-9]{36}$/.test(orgId||'')||!Number.isInteger(port)||port<1||port>65535)throw Error('Database path, organization and port required.');
 const app=await createLocalServer({filename,security,asaas:{...config,orgId,isolatedSandbox:true,...(fetchImpl?{fetchImpl}:{})}});
 try{await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'0.0.0.0',resolve);});}catch(e){await app.close();throw e;}
 let running=false;const timer=setInterval(async()=>{if(running)return;running=true;try{await app.flushAsaas();}catch{}finally{running=false;}},2000);timer.unref();const close=app.close;
 app.close=async()=>{clearInterval(timer);while(running)await new Promise(resolve=>setTimeout(resolve,10));await close();};return app;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const app=await startAsaasSandbox(process.env);console.log('Isolated Asaas sandbox backend started.');for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}
 catch{console.error('Sandbox startup refused: verify isolated database migration, HTTPS proxy and explicit sandbox configuration.');process.exitCode=1;}
}
