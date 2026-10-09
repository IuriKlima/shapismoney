import {createLocalService} from '../backend/service.mjs';
import {asyncLocalStore} from '../backend/async-store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sessionsFixture,fixtureResponse} from './training-sessions-fixtures.mjs';
import {responsesProposalAdapter} from '../backend/proposal-responses.mjs';
import {trainingRuntimeConfiguration} from '../backend/training-runtime.mjs';
import {TRAINING_EXTERNAL_PURPOSE} from '../backend/training-safety.mjs';

// All method approval, people and credentials here are isolated test data.
// They never approve Bruno's method; transport is explicitly fake-test.
async function externalFixture(options={}){
 let calls=0,hook=options.hook;
 const f=await sessionsFixture({timeoutMs:options.timeoutMs,configure:(config,f,org)=>{
  config.mode='external-reviewed';config.externalGate=true;config.offlineTest=true;
  config.budget={purpose:'training-proposals',budgetMode:'monthly-per-student',globalMonthlyUSD:1,adminMonthlyUSD:1,inputRate:.75,outputRate:4.5,...options.budget};
  const m=config.methodology;m.status='reviewed';m.fixtureOnly=false;m.review={by:f.ids.coach,role:'coach',at:Date.now()-1000,providerTransferApproved:true};
  m.sources.forEach(s=>{s.id=s.id.replace('fixture-','offline-test-');});m.rules.forEach(r=>{r.id=r.id.replace('fixture-','offline-test-');r.sourceId=r.sourceId.replace('fixture-','offline-test-');r.providerTransferApproved=true;});
  m.exercises.forEach(e=>{e.id=e.id.replace('fixture-','offline-test-');e.allowedAlternativeIds=e.allowedAlternativeIds.map(id=>id.replace('fixture-','offline-test-'));});
  config.provider=responsesProposalAdapter({apiKey:'offline-fake-credential-only',model:'offline-training-model',fetchImpl:async(_url,request)=>{
   calls++;const input=JSON.parse(JSON.parse(request.body).input);if(hook)await hook(f,request,input);
   const payload={title:'Isolated offline draft',daysPerWeek:input.untrustedFacts.days,sessions:Array.from({length:input.untrustedFacts.days},(_,i)=>({id:'session_'+i,name:'Offline session '+i,weekday:i+1,exercises:[{exerciseId:input.untrustedMethod.exercises[0].id,sets:3,reps:10,restSeconds:90,rir:2,reason:'Offline protocol validation, not clinical prescription.',evidence:['days','environment'],ruleId:input.untrustedMethod.rules[0].id,alternatives:[]}]}))};options.mutate?.(payload);return fixtureResponse(payload);
  }});options.configure?.(config,f,org);
 }});
 const externalConsent=async(enabled=true)=>{const c=(await f.student.req(f.base+'/training-external-consent')).data.consent;return f.student.req(f.base+'/training-external-consent',{purpose:TRAINING_EXTERNAL_PURPOSE,sequence:c.sequence,anamnesisRevision:c.anamnesisRevision,enabled,confirmed:true},'PUT');};
 return {...f,externalConsent,calls:()=>calls,setHook:value=>{hook=value;}};
}

test('explicit real adapter path with labelled fake transport persists only confirmed drafts and immutable human versions',async()=>{
 const f=await externalFixture({hook:async(_f,request)=>{const wire=JSON.parse(request.body);assert.equal(wire.store,false);assert.ok(wire.text.format.schema.properties.sessions.items.properties.exercises.items.properties.evidence.items.enum.includes('days'));assert.ok(!wire.input.includes('@fixture.invalid'));}});try{
  const cap=(await f.coach.req('training-proposals/capabilities')).data;assert.equal(cap.available,true);assert.equal(cap.providerKind,'responses-offline-test');assert.equal(cap.externalCalls,false);assert.equal(cap.mode,'external-reviewed');
  await f.consent();assert.equal((await f.prepare()).status,409);assert.equal(f.calls(),0);await f.externalConsent();
  const key=randomUUID(),r=await f.prepare(key);assert.equal(r.status,200);const p=r.data.proposal;assert.equal(p.mode,'external-reviewed');assert.equal((await f.prepare(key)).status,409);assert.equal(f.calls(),1);
  assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,0);const logs=f.store.all('SELECT operation_key,result FROM operations');assert.ok(logs.some(x=>x.operation_key==='training-external-proposal-'+p.id));assert.ok(!JSON.stringify(logs).includes('offline-fake-credential-only'));
  const saved=await f.confirm(p);assert.equal(saved.status,201);const plan=saved.data.plan;assert.equal(plan.status,'draft');assert.equal(plan.content.proposalSource.providerKind,'responses-offline-test');assert.equal(plan.content.proposalSource.reviewRequired,true);assert.equal(f.store.get('SELECT approved_by FROM plans WHERE id=?',plan.id).approved_by,null);
  const edit=structuredClone(p.payload);edit.title='Human reviewed edit';const revised=await f.coach.req('training-proposals/plans/'+plan.id,{revision:1,payload:edit,confirmed:true,changeReason:'Explicit offline human edit.'},'PUT');assert.equal(revised.status,201);assert.notEqual(revised.data.plan.id,plan.id);assert.equal(f.store.get('SELECT title FROM plans WHERE id=?',plan.id).title,plan.title);
  assert.equal((await f.confirm(p)).status,409);assert.equal(f.calls(),1);const reservation=f.store.get('SELECT metadata FROM ai_monthly_reservations');assert.equal(JSON.parse(reservation.metadata).model,'offline-training-model');
 }finally{await f.close();}
});

test('external gate, own budget, reviewed method, transfer approval, reviewer, organization and fake label fail closed before calls',async()=>{
 for(const mutate of [c=>{c.externalGate=false;},c=>{delete c.budget;},c=>{c.budget.purpose='chat';},c=>{c.budget.globalMonthlyUSD=.1;},c=>{c.provider.model='changed-model';},c=>{c.methodology.status='pending-review';},c=>{c.methodology.fixtureOnly=true;},c=>{c.methodology.review.providerTransferApproved=false;},c=>{c.methodology.rules[0].providerTransferApproved=false;},c=>{c.offlineTest=false;},c=>{c.methodology.orgId=randomUUID();},(c,f)=>{f.store.run('UPDATE users SET active=0 WHERE id=?',f.ids.coach);}]){
  const f=await externalFixture();try{await f.externalConsent();mutate(f.config,f);const r=await f.prepare();assert.notEqual(r.status,200);assert.equal(f.calls(),0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,0);}finally{await f.close();}
 }
});

test('specific external consent belongs to student and cannot be replaced by local consent or staff authorization',async()=>{
 const f=await externalFixture();try{await f.consent();const local=(await f.student.req(f.base+'/training-proposal-consent')).data.consent;assert.equal(local.externalTransferAuthorized,false);const c=(await f.student.req(f.base+'/training-external-consent')).data.consent;assert.equal(c.enabled,false);const body={purpose:TRAINING_EXTERNAL_PURPOSE,sequence:0,anamnesisRevision:c.anamnesisRevision,enabled:true,confirmed:true};assert.equal((await f.admin.req(f.base+'/training-external-consent',body,'PUT')).status,403);assert.equal((await f.coach.req(f.base+'/training-external-consent',body,'PUT')).status,403);assert.equal((await f.student.req(f.base+'/training-external-consent',{...body,purpose:'SIM_TRAINING_PROPOSAL_LOCAL_V1'},'PUT')).status,400);assert.equal(f.calls(),0);}finally{await f.close();}
});

test('budget exhaustion and durable running job block generation, independent of chat budget',async()=>{
 const blocked=await externalFixture({budget:{globalMonthlyUSD:.000001,adminMonthlyUSD:.000001}});try{await blocked.externalConsent();assert.equal((await blocked.prepare()).status,503);assert.equal(blocked.calls(),0);}finally{await blocked.close();}
 let begin,release;const started=new Promise(r=>{begin=r;});const f=await externalFixture({hook:async()=>{begin();await new Promise(r=>{release=r;});}});try{await f.externalConsent();const first=f.prepare();await started;assert.equal((await f.prepare()).status,409);assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);release();assert.equal((await first).status,200);}finally{release?.();await f.close();}
});

test('stale consent/revision/method/session during provider work rejects safely without draft or refund',async()=>{
 for(const change of [async f=>{const c=(await f.student.req(f.base+'/training-external-consent')).data.consent;await f.student.req(f.base+'/training-external-consent',{purpose:TRAINING_EXTERNAL_PURPOSE,sequence:c.sequence,anamnesisRevision:c.anamnesisRevision,enabled:false,confirmed:true},'PUT');},async f=>{f.store.run('UPDATE anamneses SET revision=revision+1 WHERE student_id=?',f.ids.studentRecord);},async f=>{f.config.methodology.version='changed-method';},async f=>{await f.coach.req('logout',{});}]){
  const f=await externalFixture({hook:change});try{await f.externalConsent();const r=await f.prepare();assert.notEqual(r.status,200);assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);const job=f.store.all('SELECT result FROM operations WHERE operation_key LIKE ?', 'training-external-job-%').map(x=>JSON.parse(x.result))[0];assert.equal(job.state,'failed');assert.ok(job.diagnostic);assert.ok(!JSON.stringify(job).includes('offline-fake-credential-only'));}finally{await f.close();}
 }
});

test('runtime is independently opt-in, production closed and fake adapter never presents itself as real',()=>{
 const never=()=>assert.fail('No method or credential reads');assert.deepEqual(trainingRuntimeConfiguration({}, {production:false},{readMethod:never,resolveKey:never}),{});assert.throws(()=>trainingRuntimeConfiguration({SIM_TRAINING_EXTERNAL_ENABLED:'true'},{production:true},{readMethod:never,resolveKey:never}),/production gate closed/);
 const fake=responsesProposalAdapter({apiKey:'offline-only',model:'offline',fetchImpl:async()=>{}});assert.equal(fake.kind,'responses-offline-test');assert.equal(fake.mockOnly,true);assert.equal(fake.transportKind,'fake-test');
});


test('student, unrelated role/org and unresolved risk cannot generate external proposals',async()=>{
 for(const role of ['student','nutrition','outsider','othercoach']){const f=await externalFixture();try{await f.externalConsent();await f.coach.login(role);assert.notEqual((await f.prepare()).status,200);assert.equal(f.calls(),0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,0);}finally{await f.close();}}
 const f=await externalFixture();try{f.store.run('UPDATE anamneses SET attention_review=1 WHERE student_id=?',f.ids.studentRecord);await f.externalConsent();assert.equal((await f.prepare()).status,409);assert.equal(f.calls(),0);}finally{await f.close();}
});

test('timeout and invalid output retain reservations and durable safe diagnosis without retry',async()=>{
 for(const options of [{timeoutMs:25,hook:async(_f,request)=>new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(Error('private@example.test sensitive provider detail')),{once:true}))},{mutate:p=>{p.sessions[0].exercises[0].evidence=['Invented factual label'];}}]){
  const f=await externalFixture(options);try{await f.externalConsent();const key=randomUUID();assert.equal((await f.prepare(key)).status,502);assert.equal((await f.prepare(key)).status,409);assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,0);const job=JSON.parse(f.store.get('SELECT result FROM operations WHERE operation_key LIKE ?', 'training-external-job-%').result);assert.equal(job.state,'failed');assert.ok(job.diagnostic);assert.ok(!JSON.stringify(job).includes('private@example.test'));assert.ok(!JSON.stringify(job).includes('Invented factual label'));assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);}finally{await f.close();}
 }
});


test('fresh application flow recovers prepared proposal from durable journal, same session, without repeating provider',async()=>{
 const f=await externalFixture();let fresh;try{await f.externalConsent();const p=(await f.prepare()).data.proposal;
  fresh=await createLocalService({store:asyncLocalStore(f.store),trainingProposals:f.config,loginLimit:80});
  f.app.server.removeAllListeners('request');f.app.server.on('request',fresh);
  const key=randomUUID(),saved=await f.confirm(p,p.payload,key);assert.equal(saved.status,201);assert.equal(saved.data.plan.status,'draft');assert.deepEqual((await f.confirm(p,p.payload,key)).data,saved.data);assert.equal((await f.confirm(p)).status,409);assert.equal(f.calls(),1);
 }finally{await fresh?.close();await f.close();}
});
