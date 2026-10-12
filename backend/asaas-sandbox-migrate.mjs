import path from 'node:path';
import {openLocalStore} from './store.mjs';
import {applyAsaasRuntimeSchema} from './commerce/asaas-runtime-migrate.mjs';
let store;
try{
 if(process.env.NODE_ENV==='production'||process.env.SIM_ASAAS_ISOLATED_DATABASE!=='true'||!path.isAbsolute(process.env.SIM_ASAAS_DATABASE_PATH||''))throw Error('Isolated database required.');
 store=openLocalStore(process.env.SIM_ASAAS_DATABASE_PATH);
 applyAsaasRuntimeSchema(store,{isolatedSandbox:true,accountId:process.env.ASAAS_SANDBOX_ACCOUNT_ID,orgId:process.env.SIM_ASAAS_ORG_ID});
 console.log('Isolated sandbox schema verified. No provider requests.');
}catch{console.error('Sandbox migration refused. Verify isolated database, organization, account scope and checksum.');process.exitCode=1;}finally{store?.close();}
