import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync,readFileSync} from 'node:fs';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';
import {seedReviewedIntake,fullIntakeAnswers} from './intake-test-fixtures.mjs';
import {syntheticTrainingConfiguration,syntheticTrainingBudget} from './training-proposal-fixtures.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {TRAINING_PROPOSAL_PURPOSE} from '../backend/training-safety.mjs';
import {trainingProposalFlow} from '../backend/training-proposals.mjs';

async function setup(options={}){
 const f=await isolatedFixture(),now=options.now||Date.now;
 await seedReviewedIntake(f.store,f.ids.studentRecord,f.ids.coach);
 await seedReviewedIntake(f.store,f.ids.otherRecord,f.ids.otherCoach);
 const config=options.configuration||syntheticTrainingConfiguration(now,options.generate);
 const app=await createLocalServer({store:f.store,loginLimit:80,now,chat:{...syntheticTrainingBudget,...options.budget},trainingProposals:config});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
 const client=()=>{let cookie='';return {async req(path,body,method='POST',key=randomUUID()){const response=await fetch(origin+'/api/local/'+path,{method:body===undefined?'GET':method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,data:await response.json()};},login(role){return this.req('login',{email:role.toLowerCase()+'@fixture.invalid',password:FIXTURE_PASSWORD});}};};
 const c=client(),s=client(),a=client(),o=client();for(const [x,role] of [[c,'coach'],[s,'student'],[a,'admin'],[o,'outsider']])await x.login(role);
 const base='students/'+f.ids.studentRecord;
 const consent=async(enabled=true)=>{const state=(await s.req(base+'/training-proposal-consent')).data.consent;return s.req(base+'/training-proposal-consent',{purpose:TRAINING_PROPOSAL_PURPOSE,sequence:state.sequence,anamnesisRevision:state.anamnesisRevision,enabled,confirmed:true},'PUT');};
 const prepare=(actor=c,key=randomUUID())=>actor.req(base+'/training-proposals/prepare',{anamnesisRevision:1,consentSequence:1,confirmed:true},'POST',key);
 const confirm=(p,payload=p.payload,actor=c,key=randomUUID())=>actor.req(base+'/training-proposals/confirm',{proposalId:p.id,proposalHash:p.hash,payload,confirmed:true},'POST',key);
 return {...f,app,config,c,s,a,o,base,consent,prepare,confirm,async close(){await app.close();rmSync(f.directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}};
}
async function run(work,options){const f=await setup(options);try{await work(f);}finally{await f.close();}}

test('personalized training defaults closed; private pending methodology cannot activate; no network adapter',async()=>{
 await run(async f=>{assert.equal((await f.c.req('training-proposals/capabilities')).data.available,false);assert.equal((await f.prepare()).status,503);},{configuration:{}});
 await run(async f=>{f.config.methodology.status='pending-bruno-validation';assert.equal((await f.c.req('training-proposals/capabilities')).data.available,false);assert.equal((await f.prepare()).status,503);});
 const source=readFileSync(new URL('../backend/training-proposals.mjs',import.meta.url),'utf8');assert.ok(!source.includes('api.openai.com'));assert.ok(!source.includes('OPENAI_API_KEY'));
 const flow=trainingProposalFlow({now:Date.now,security:{production:true},configuration:syntheticTrainingConfiguration(),budgetConfiguration:syntheticTrainingBudget});try{assert.equal((await flow.handle({role:'admin'},{},{method:'GET'},'/api/local/training-proposals/capabilities')).data.available,false);}finally{flow.close();}
});
test('specific student choice, reviewed intake, tenant/role and admin V2 purpose required; no draft on preparation',async()=>run(async f=>{
 assert.equal((await f.prepare()).status,409);assert.equal((await f.a.req(f.base+'/training-proposal-consent',{purpose:TRAINING_PROPOSAL_PURPOSE,sequence:0,anamnesisRevision:1,enabled:true,confirmed:true},'PUT')).status,403);
 assert.equal((await f.consent()).status,200);assert.equal((await f.prepare(f.s)).status,403);assert.equal((await f.prepare(f.o)).status,404);
 const own=await f.prepare();assert.equal(own.status,200);assert.equal(own.data.writesPerformed,false);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);
 f.store.run("UPDATE anamneses SET consent_version='SIM_INTAKE_PURPOSES_V1' WHERE student_id=?",f.ids.studentRecord);assert.equal((await f.prepare(f.a)).status,403);assert.equal((await f.prepare()).status,200);
 f.store.run('UPDATE anamneses SET reviewed_revision=NULL WHERE student_id=?',f.ids.studentRecord);assert.equal((await f.prepare()).status,409);
}));
test('minimized context changes with fictitious intake; structured edits remain catalog-bound and confirmation idempotent',async()=>{
 const inputs=[];const cfg=syntheticTrainingConfiguration();const generate=cfg.provider.generate;
 await run(async f=>{
  f.store.run('UPDATE anamneses SET answers=? WHERE student_id=?',JSON.stringify({...fullIntakeAnswers(),main_goal:'Condicionamento fictício',days:2,full_name:'DO_NOT_SEND_NAME',whatsapp:'DO_NOT_SEND_CONTACT',letter:'DO_NOT_SEND_LETTER',current_diet:'DO_NOT_SEND_DIET',personal_context:'DO_NOT_SEND_NARRATIVE'}),f.ids.studentRecord);
  await f.consent();const result=await f.prepare();assert.equal(result.status,200);const p=result.data.proposal;assert.equal(p.payload.daysPerWeek,2);assert.match(p.payload.title,/Condicionamento/);assert.equal(inputs[0].untrustedFacts.days,2);
  for(const value of ['DO_NOT_SEND','@fixture.invalid','INTERNO','studentId','user_id'])assert.ok(!JSON.stringify(inputs).includes(value));
  const edited={...p.payload,title:'Editado explicitamente',exercises:p.payload.exercises.map(e=>({...e,sets:3,reason:'Justificativa fictícia editada pelo responsável.'}))};const key=randomUUID();const saved=await f.confirm(p,edited,f.c,key);assert.equal(saved.status,201);assert.equal(saved.data.plan.status,'draft');assert.equal(saved.data.plan.content.exercises[0].sets,3);assert.equal(saved.data.plan.content.proposalSource.mode,'local-simulation');assert.deepEqual((await f.confirm(p,edited,f.c,key)).data,saved.data);assert.equal((await f.confirm(p,edited)).status,409);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,1);
  assert.ok(!JSON.stringify((await f.a.req('audit')).data).includes('Condicionamento fictício'));
 },{generate:input=>{inputs.push(input);return generate(input);}});
});
test('proposal refuses unavailable catalog, frequency, fabricated evidence/reference, extra fields and foreign/session hash',async()=>run(async f=>{
 await f.consent();const p=(await f.prepare()).data.proposal;
 for(const change of [{exerciseId:'unknown'},{evidence:['full_name']},{ruleId:'invented'},{sets:11},{restSeconds:-1}]){const payload={...p.payload,exercises:p.payload.exercises.map(e=>({...e,...change}))};assert.equal((await f.confirm(p,payload)).status,400);}
 assert.equal((await f.confirm(p,{...p.payload,daysPerWeek:7})).status,400);assert.equal((await f.confirm(p,{...p.payload,diagnosis:'invented'})).status,400);assert.equal((await f.confirm(p,p.payload,f.a)).status,409);
 assert.equal((await f.confirm({...p,hash:'altered'})).status,409);await f.c.req('logout',{});await f.c.login('coach');assert.equal((await f.confirm(p)).status,409);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);
}));
test('withdrawal, intake revision, coach assignment, inactive actor and method changes invalidate confirmation',async()=>{
 for(const change of [f=>f.consent(false),f=>f.store.run('UPDATE anamneses SET revision=revision+1 WHERE student_id=?',f.ids.studentRecord),f=>f.store.run('UPDATE students SET coach_id=? WHERE id=?',f.ids.otherCoach,f.ids.studentRecord),f=>f.store.run('UPDATE users SET active=0 WHERE id=?',f.ids.coach),f=>{f.config.methodology.version='fixture-v2';}])await run(async f=>{await f.consent();const p=(await f.prepare()).data.proposal;await change(f);assert.notEqual((await f.confirm(p)).status,201);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);});
});
test('provider delay rechecks consent; failed output still consumes reservation; exhausted cap and duplicate key do not retry',async()=>{
 let release,start;const began=new Promise(r=>{start=r;});const generator=syntheticTrainingConfiguration().provider.generate;
 await run(async f=>{await f.consent();const pending=f.prepare();await began;await f.consent(false);release();assert.equal((await pending).status,409);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);assert.equal(f.store.get('SELECT COUNT(*) n FROM ai_monthly_reservations').n,1);},{generate:async input=>{start();await new Promise(r=>{release=r;});return generator(input);}});
 let calls=0;await run(async f=>{await f.consent();const key=randomUUID();assert.equal((await f.prepare(f.c,key)).status,502);assert.equal((await f.prepare(f.c,key)).status,409);assert.equal(calls,1);assert.equal(f.store.get('SELECT COUNT(*) n FROM ai_monthly_reservations').n,1);},{generate:()=>{calls++;throw Error('PRIVATE_PROVIDER_ERROR');}});
 await run(async f=>{await f.consent();assert.equal((await f.prepare()).status,503);},{budget:{globalMonthlyUSD:.000001,adminMonthlyUSD:.000001},generate:()=>assert.fail('must not call')});
});
test('logout during preparation prevents response; changed student revision does not revive old risk resolution',async()=>{
 let release,start;const began=new Promise(r=>{start=r;});const generator=syntheticTrainingConfiguration().provider.generate;
 await run(async f=>{await f.consent();const pending=f.prepare();await began;await f.c.req('logout',{});release();assert.equal((await pending).status,401);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);},{generate:async input=>{start();await new Promise(r=>{release=r;});return generator(input);}});
 await run(async f=>{f.store.run('UPDATE anamneses SET attention_review=1 WHERE student_id=?',f.ids.studentRecord);const body={sequence:0,anamnesisRevision:1,decision:'allow-with-limitations',note:'Limitações fictícias previamente conferidas.',confirmed:true};assert.equal((await f.c.req(f.base+'/training-risk',body,'PUT')).status,200);assert.equal((await f.c.req(f.base+'/training-risk')).data.risk.resolved,true);f.store.run('UPDATE students SET revision=revision+1 WHERE id=?',f.ids.studentRecord);assert.equal((await f.c.req(f.base+'/training-risk')).data.risk.resolved,false);});
});
test('TTL and shared rate cap; existing ledger remains monotonic and schema stays 007',async()=>{
 let time=Date.now();await run(async f=>{await f.consent();const p=(await f.prepare()).data.proposal;time+=21*60*1000;assert.equal((await f.confirm(p)).status,409);assert.equal(f.store.get('SELECT COUNT(*) n FROM ai_monthly_reservations').n,1);assert.equal(f.store.get('SELECT COUNT(*) n FROM schema_migrations').n,8);},{now:()=>time});
 await run(async f=>{await f.consent();for(let i=0;i<5;i++)assert.equal((await f.prepare()).status,200);assert.equal((await f.prepare()).status,429);assert.equal(f.store.get('SELECT COUNT(*) n FROM ai_monthly_reservations').n,5);});
});
test('risk gate blocks manual and generated approval/publication; only current coach explicit decision resolves, revisions invalidate',async()=>run(async f=>{
 f.store.run('UPDATE anamneses SET attention_review=1 WHERE student_id=?',f.ids.studentRecord);await f.consent();const p=(await f.prepare()).data.proposal;assert.equal(p.riskPending,true);const draft=await f.confirm(p);let plan=draft.data.plan;
 plan=(await f.c.req('plans/'+plan.id+'/submit',{revision:plan.revision})).data.plan;
 assert.equal((await f.a.req('plans/'+plan.id+'/approve',{revision:plan.revision})).status,409);
 const body={sequence:0,anamnesisRevision:1,decision:'allow-with-limitations',note:'Limitações fictícias conferidas pelo personal; sem diagnóstico clínico.',confirmed:true};
 assert.equal((await f.a.req(f.base+'/training-risk',body,'PUT')).status,403);assert.equal((await f.s.req(f.base+'/training-risk',body,'PUT')).status,403);
 assert.equal((await f.c.req(f.base+'/training-risk',{...body,confirmed:false},'PUT')).status,400);assert.equal((await f.c.req(f.base+'/training-risk',{...body,decision:'hold'},'PUT')).status,200);assert.equal((await f.c.req('plans/'+plan.id+'/approve',{revision:plan.revision})).status,409);
 assert.equal((await f.c.req(f.base+'/training-risk',{...body,sequence:1},'PUT')).status,200);plan=(await f.c.req('plans/'+plan.id+'/approve',{revision:plan.revision})).data.plan;assert.equal(plan.status,'approved');
 const privateStudent=(await f.s.req(f.base+'/training-risk')).data.risk;assert.equal(privateStudent.note,undefined);
 f.store.run('UPDATE anamneses SET revision=revision+1 WHERE student_id=?',f.ids.studentRecord);assert.equal((await f.a.req('plans/'+plan.id+'/publish',{revision:plan.revision})).status,409);
 const manual=(await f.c.req(f.base+'/plans',{title:'Manual fictício',daysPerWeek:3,exercises:[{name:'Exemplo',sets:2,reps:8}]})).data.plan;const reviewed=(await f.c.req('plans/'+manual.id+'/submit',{revision:manual.revision})).data.plan;assert.equal((await f.a.req('plans/'+manual.id+'/approve',{revision:reviewed.revision})).status,409);
}));
test('concurrent confirmations with different keys create one draft; post-save edit invalidates approval and published plans stay immutable',async()=>run(async f=>{
 await f.consent();const p=(await f.prepare()).data.proposal;const results=await Promise.all([f.confirm(p),f.confirm(p)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,1);let plan=results.find(r=>r.status===201).data.plan;
 for(const action of ['submit','approve']){const result=await f.c.req('plans/'+plan.id+'/'+action,{revision:plan.revision});assert.equal(result.status,200);plan=result.data.plan;}
 const edited=await f.c.req('training-proposals/plans/'+plan.id,{revision:plan.revision,payload:{...p.payload,title:'Nova edição fictícia'},confirmed:true},'PUT');assert.equal(edited.status,200);plan=edited.data.plan;assert.equal(plan.status,'draft');assert.equal(f.store.get('SELECT approved_by FROM plans WHERE id=?',plan.id).approved_by,null);
 assert.equal((await f.c.req('plans/'+plan.id+'/publish',{revision:plan.revision})).status,409);
 for(const action of ['submit','approve','publish']){const result=await f.c.req('plans/'+plan.id+'/'+action,{revision:plan.revision});assert.equal(result.status,200);plan=result.data.plan;}
 assert.equal((await f.c.req('training-proposals/plans/'+plan.id,{revision:plan.revision,payload:p.payload,confirmed:true},'PUT')).status,409);
}));
