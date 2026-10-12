import test from 'node:test';
import assert from 'node:assert/strict';
import {startAsaasSandbox} from '../backend/asaas-sandbox-server.mjs';

test('disabled sandbox starts a public holding page without reading secrets, DB or opening action handlers',async()=>{
 const values=new Proxy({SIM_BACKEND_PORT:'0',SIM_ASAAS_SANDBOX_ENABLED:'false'},{get(target,key){if(String(key).includes('KEY')||String(key).includes('TOKEN')||String(key).includes('DATABASE'))throw Error('Secret/database must not be read');return target[key];}});
 const app=await startAsaasSandbox(values,{fetchImpl:()=>{throw Error('Network forbidden');}});const origin='http://127.0.0.1:'+app.server.address().port;
 try{const home=await fetch(origin);assert.equal(home.status,200);assert.match(await home.text(),/teste em prepara/);assert.deepEqual(await(await fetch(origin+'/healthz')).json(),{ready:true,mode:'preparation',financialEnabled:false});
 for(const route of ['/api/local/login','/api/local/asaas/customer','/api/local/asaas/orders','/api/asaas/webhook','/api/local/plans/example/publish']){const r=await fetch(origin+route,{method:'POST',body:'{}'});assert.equal(r.status,503);assert.deepEqual(await r.json(),{available:false});}
 }finally{await app.close();}
});
