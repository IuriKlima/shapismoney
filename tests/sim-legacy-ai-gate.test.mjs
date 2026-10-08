import test from 'node:test';
import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import {createLocalServer} from '../backend/server.mjs';
import {resolveAIConfiguration} from '../backend/ai-config.mjs';
import {chatRuntimeConfiguration} from '../backend/ai-chat.mjs';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';

for(const condition of ['outside-allowlist','expired-window','zero-budget','authorized-chat'])test('persistent legacy AI fails closed with SIM_AI_ENABLED=true: '+condition,async()=>{
 const f=await isolatedFixture();let now=Date.now(),calls=0;
 const env={SIM_AI_ENABLED:'true',OPENAI_API_KEY:'synthetic-fixture-not-a-real-key',SIM_AI_CHAT_ENABLED:'true',SIM_AI_CHAT_REVIEWED:'true',SIM_AI_CHAT_MODEL:'gpt-6-luna',SIM_AI_CHAT_BUDGET_MODE:'monthly-per-student',SIM_AI_CHAT_GLOBAL_MONTHLY_BUDGET_USD:condition==='zero-budget'?'0':'.10',SIM_AI_CHAT_ADMIN_MONTHLY_BUDGET_USD:'.10',SIM_AI_CHAT_INPUT_USD_PER_MILLION:'.125',SIM_AI_CHAT_OUTPUT_USD_PER_MILLION:'.5',SIM_AI_CHAT_PRICE_REVIEWED_AT:new Date(now).toISOString(),SIM_AI_CHAT_UNTIL:new Date(now+86400000).toISOString(),SIM_AI_CHAT_USER_IDS:condition==='outside-allowlist'?f.ids.otherStudent:f.ids.admin};
 const ai={...resolveAIConfiguration(env),fetchImpl:async()=>{calls++;return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic legacy output'}]}]}));}};
 const chat={...chatRuntimeConfiguration(env,ai,{now}),generate:async()=>{calls++;return {reply:'Synthetic mock',inferences:[],action:null};}};
 const app=await createLocalServer({store:f.store,ai,chat,now:()=>now,sessionMs:2*86400000,loginLimit:40});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
 const client=()=>{let cookie='';return async(route,body)=>{const r=await fetch(origin+'/api/local/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};};};
 try{
 const anonymous=client();assert.equal((await anonymous('ai',{scenario:'method',syntheticConsent:true})).status,401);
 for(const role of ['admin','student','coach','nutrition']){
 const request=client();assert.equal((await request('login',{email:role+'@fixture.invalid',password:FIXTURE_PASSWORD})).status,200);
 if(condition==='expired-window')now=Math.max(now,Date.parse(env.SIM_AI_CHAT_UNTIL)+1);
 const capability=await request('ai/capabilities');assert.equal(capability.status,200);assert.equal(capability.data.available,false);assert.equal(capability.data.reason,'legacy-disabled');
 const legacy=await request('ai',{scenario:'method',syntheticConsent:true});assert.equal(legacy.status,503);assert.ok(!JSON.stringify(legacy.data).includes(env.OPENAI_API_KEY));
 if(role==='admin')assert.equal((await request('ai/chat/capabilities')).data.available,condition==='authorized-chat');
 }
 assert.equal(calls,0);assert.equal(f.store.get('SELECT COUNT(*) n FROM ai_monthly_reservations').n,0);assert.equal(f.store.get("SELECT COUNT(*) n FROM operations WHERE operation_key LIKE 'ai-budget-%'").n,0);
 }finally{await app.close();rmSync(f.directory,{recursive:true,force:true});}
});
