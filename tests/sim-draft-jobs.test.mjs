import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sessionsFixture,sessionsConfiguration} from './training-sessions-fixtures.mjs';
import {syntheticTrainingBudget} from './training-proposal-fixtures.mjs';
import {nutritionProposalFixture} from './nutrition-proposal-fixtures.mjs';
import {draftJobConfiguration,DRAFT_JOB_MARKER} from '../backend/draft-jobs.mjs';
import {retrievePrivateSources} from '../backend/private-retrieval.mjs';

const worker=(overrides={})=>({enabled:true,reviewed:true,expiresAt:Date.now()+3600000,maxAttemptUSD:.05,totalUSD:.10,maxCalls:8,poll:false,...overrides});
const jobs=f=>f.store.all('SELECT * FROM operations WHERE request_hash=?',DRAFT_JOB_MARKER).map(r=>({...JSON.parse(r.result),record:r}));
const currentJobs=f=>jobs(f).filter(j=>!['superseded','interrupted'].includes(j.state));
async function grant(f,level='training'){
  const client=f.admin||f.a,c=(await client.req(f.base+'/access')).data.access;
  const r=await client.req(f.base+'/access',{level,expiresAt:null,enabled:true,sequence:c.sequence,confirmed:true},'PUT');assert.equal(r.status,200,JSON.stringify(r));
}

test('worker default/production/review/expiry/caps fail closed without credential reads',()=>{
  assert.deepEqual(draftJobConfiguration({},{}),{});
  const env={SIM_DRAFT_JOBS_ENABLED:'true',SIM_DRAFT_JOBS_REVIEWED:'true',SIM_DRAFT_JOBS_EXPIRES_AT:String(Date.now()+100000),SIM_DRAFT_JOBS_MAX_ATTEMPT_USD:'.05',SIM_DRAFT_JOBS_TOTAL_USD:'.10'};
  assert.throws(()=>draftJobConfiguration(env,{production:true}),/closed/);
  for(const patch of [{SIM_DRAFT_JOBS_REVIEWED:'false'},{SIM_DRAFT_JOBS_TOTAL_USD:'.11'},{SIM_DRAFT_JOBS_MAX_ATTEMPT_USD:'.06'},{SIM_DRAFT_JOBS_EXPIRES_AT:'0'}])assert.throws(()=>draftJobConfiguration({...env,...patch},{}));
  assert.equal(draftJobConfiguration(env,{}).networkReviewed,false);
});

test('complete intake and explicit current consent yield one training-only durable draft; duplicate/restart scan never regenerates',async()=>{
  let calls=0;const f=await sessionsFixture({draftJobs:worker(),fetchImpl:async()=>{calls++;throw Error('test overridden below');}});
  try{
    // Use the established synthetic fixture response, no network transport.
    const base=sessionsConfiguration(f.config.methodology.orgId);f.config.provider.generate=base.provider.generate;
    await grant(f);await f.app.flushDraftJobs();assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,0);
    const c=(await f.student.req(f.base+'/training-proposal-consent')).data.consent,body={purpose:'SIM_TRAINING_PROPOSAL_LOCAL_V1',sequence:c.sequence,anamnesisRevision:c.anamnesisRevision,enabled:true,confirmed:true},key=randomUUID();
    const first=await f.student.req(f.base+'/training-proposal-consent',body,'PUT',key);assert.equal(first.status,200);assert.deepEqual(await f.student.req(f.base+'/training-proposal-consent',body,'PUT',key),first);
    await Promise.all([f.app.flushDraftJobs(),f.app.flushDraftJobs()]);
    assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);assert.ok(!jobs(f).some(j=>j.kind==='nutrition'&&j.state==='draft-ready'));
    await f.app.flushDraftJobs();assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,1);assert.equal(calls,0);
    const p=f.store.get('SELECT * FROM plans');assert.equal(p.status,'draft');assert.equal(p.approved_by,null);const source=JSON.parse(p.content).proposalSource;assert.equal(source.automaticDraft,true);assert.equal(source.reviewRequired,true);assert.equal(source.externalCalls,false);assert.ok(!source.confirmedBy);
    const visible=(await f.student.req(f.base+'/draft-jobs')).data.jobs;assert.ok(visible.some(j=>j.state==='draft-ready'));assert.ok(visible.every(j=>!j.planId&&!j.reservationId));
  }finally{await f.close();}
});

test('training plus nutrition produces two separate reviewed drafts and notices only after human publication',async()=>{
  const f=await nutritionProposalFixture({serverOptions:(f,clock)=>({draftJobs:worker(),chat:syntheticTrainingBudget,trainingProposals:sessionsConfiguration(f.store.get('SELECT org_id FROM students WHERE id=?',f.ids.studentRecord).org_id,clock)})});
  try{
    await grant(f,'training-nutrition');await f.consent();
    const c=(await f.s.req(f.base+'/training-proposal-consent')).data.consent;
    assert.equal((await f.s.req(f.base+'/training-proposal-consent',{purpose:'SIM_TRAINING_PROPOSAL_LOCAL_V1',sequence:c.sequence,anamnesisRevision:c.anamnesisRevision,enabled:true,confirmed:true},'PUT')).status,200);
    await f.app.flushDraftJobs();assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,1);assert.equal(f.calls(),1);
    assert.equal((await f.s.req('notifications')).data.notifications.length,0);
    let plan=(await f.n.req('nutrition/plans/'+f.store.get('SELECT id FROM nutrition_plans').id)).data.plan;
    for(const action of ['submit','approve','publish']){const r=await f.n.req('nutrition/plans/'+plan.id+'/'+action,{revision:plan.revision,...(action==='approve'?{reviewed:true}:{})});assert.equal(r.status,200,JSON.stringify(r));plan=r.data.plan;}
    const notifications=(await f.s.req('notifications')).data.notifications;assert.equal(notifications.length,1);assert.equal(notifications[0].kind,'nutrition');
    await f.restart();await f.app.flushDraftJobs();assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,2);
    const published=f.store.get('SELECT * FROM nutrition_plans WHERE status=?','published');
    f.store.run('UPDATE anamneses SET revision=revision+1,status=? WHERE student_id=?','draft',f.ids.studentRecord);
    await f.app.flushDraftJobs();assert.deepEqual(f.store.get('SELECT * FROM nutrition_plans WHERE id=?',published.id),published);assert.equal(f.calls(),1);
  }finally{await f.close();}
});

test('known offline failure keeps reservation, explicit retry is idempotent, and third attempt is the limit',async()=>{
  const f=await nutritionProposalFixture({serverOptions:()=>({draftJobs:worker()}),hook:async()=>{throw Error('isolated offline failure');}});
  try{
    await grant(f,'training-nutrition');await f.consent();await f.app.flushDraftJobs();let j=currentJobs(f).find(j=>j.kind==='nutrition');assert.equal(j.state,'failed');assert.equal(f.calls(),1);
    await f.app.flushDraftJobs();assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);
    const route=f.base+'/draft-jobs/'+j.id+'/retry',body={version:j.version,reason:'Controlled offline test retry',confirmed:true},key=randomUUID();
    assert.equal((await f.a.req(route,body)).status,403);assert.equal((await f.coach.req(route,body)).status,403);assert.ok([403,404].includes((await f.other.req(route,body)).status));
    const r=await f.n.req(route,body,'POST',key);assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(await f.n.req(route,body,'POST',key),r);
    await f.app.flushDraftJobs();assert.equal(f.calls(),2);j=currentJobs(f).find(j=>j.kind==='nutrition');assert.equal(j.attempt,2);
    assert.equal((await f.n.req(route,body)).status,200);await f.app.flushDraftJobs();assert.equal(f.calls(),3);assert.equal((await f.n.req(route,body)).status,409);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,3);
  }finally{await f.close();}
});

test('in-flight consent/access/credential/intake changes reject output and retain reservation, without automatic retry',async()=>{
  for(const change of ['consent','access','credential','intake']){
    const f=await nutritionProposalFixture({serverOptions:()=>({draftJobs:worker()})});try{
      await grant(f,'training-nutrition');await f.consent();f.setHook(async()=>{
        if(change==='consent')await f.consent(false);
        if(change==='access')await grant(f,'training');
        if(change==='credential')f.store.run('UPDATE nutrition_credentials SET verified=0,revision=revision+1 WHERE user_id=?',f.ids.nutrition);
        if(change==='intake')f.store.run('UPDATE anamneses SET revision=revision+1,status=? WHERE student_id=?','draft',f.ids.studentRecord);
      });await f.app.flushDraftJobs();assert.equal(f.calls(),1,change);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);await f.app.flushDraftJobs();assert.equal(f.calls(),1,change);
    }finally{await f.close();}
  }
});

test('lease recovery marks interrupted after restart; explicit reconcile closes without sending again',async()=>{
  const f=await nutritionProposalFixture({serverOptions:()=>({draftJobs:worker()})});try{
    await grant(f,'training-nutrition');await f.consent();await f.app.flushDraftJobs();const j=currentJobs(f).find(j=>j.kind==='nutrition'),value={...j};delete value.record;delete value.planId;value.state='running';value.leaseUntil=1;
    f.store.run('UPDATE operations SET status=?,result=? WHERE actor_id=? AND operation_key=?',102,JSON.stringify(value),j.record.actor_id,j.record.operation_key);
    await f.restart();await f.app.flushDraftJobs();assert.equal(f.calls(),1);assert.equal(jobs(f).find(r=>r.id===j.id).state,'interrupted');
    const r=await f.n.req(f.base+'/draft-jobs/'+j.id+'/reconcile',{version:j.version,reason:'Reconciled persisted draft without resend',confirmed:true});assert.equal(r.status,200,JSON.stringify(r));await f.app.flushDraftJobs();assert.equal(f.calls(),1);
  }finally{await f.close();}
});

test('disabled worker, strict per-attempt and installation caps, exhausted monthly budget, and invalid payload never bypass fail-closed gates',async()=>{
  for(const options of [{serverOptions:()=>({draftJobs:{}})},{serverOptions:()=>({draftJobs:worker({maxAttemptUSD:.000001})})},{serverOptions:()=>({draftJobs:worker({totalUSD:.000001})})},{budget:{globalMonthlyUSD:.000001,adminMonthlyUSD:.000001},serverOptions:()=>({draftJobs:worker()})},{mutate:p=>{p.meals[0].items[0].foodId=randomUUID();},serverOptions:()=>({draftJobs:worker()})}]){
    const f=await nutritionProposalFixture(options);try{await grant(f,'training-nutrition');await f.consent();await f.app.flushDraftJobs();assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);assert.equal(f.calls(),options.mutate?1:0);await f.app.flushDraftJobs();assert.equal(f.calls(),options.mutate?1:0);}finally{await f.close();}
  }
});

test('local retrieval preserves source/locator and never marks unreviewed reference as generation-connected',()=>{
  const corpus={schemaVersion:'SIM_LOCAL_CORPUS_V1',chunks:[{id:'one',text:'Rotina recuperação ciclo',source:'synthetic-source',locator:'page:2',status:'pending-professional-review',providerTransferApproved:false}]};
  const hits=retrievePrivateSources(corpus,'recuperacao ciclo');assert.equal(hits.length,1);assert.equal(hits[0].locator,'page:2');assert.equal(hits[0].generationConnected,false);assert.equal(hits[0].providerTransferApproved,false);assert.equal(hits[0].untrustedReference,true);assert.equal(hits[0].score,2);assert.throws(()=>retrievePrivateSources(corpus,'x',{limit:100}));
});

test('enqueue failure rolls back the consent event; incomplete intake never dispatches',async()=>{
  const f=await sessionsFixture({draftJobs:worker()});try{
    await grant(f);const original=f.store.run.bind(f.store);
    f.store.run=(sql,...args)=>{if(sql.startsWith('INSERT INTO operations')&&args[2]===DRAFT_JOB_MARKER)throw Error('isolated queue persistence failure');return original(sql,...args);};
    assert.equal((await f.consent()).status,500);
    f.store.run=original;assert.equal((await f.student.req(f.base+'/training-proposal-consent')).data.consent.enabled,false);
    await f.consent();f.store.run('UPDATE anamneses SET status=? WHERE student_id=?','draft',f.ids.studentRecord);await f.app.flushDraftJobs();assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,0);
  }finally{await f.close();}
});

test('shared actor rate quota blocks dispatch and a network-labelled engine requires separate worker approval',async()=>{
  for(const network of [false,true]){
    const f=await nutritionProposalFixture({serverOptions:()=>({draftJobs:worker()}),...(network?{configure:c=>{c.provider.kind='responses';c.provider.transportKind='network';c.provider.mockOnly=false;c.offlineTest=false;}}:{})});try{
      await grant(f,'training-nutrition');await f.consent();
      if(!network)for(let i=0;i<5;i++)f.store.run('INSERT INTO operations VALUES (?,?,?,?,?)',f.ids.nutrition,'ai-budget-'+randomUUID(),'f'.repeat(64),202,JSON.stringify({createdAt:Date.now(),budgetMode:'monthly-per-student'}));
      await f.app.flushDraftJobs();assert.equal(f.calls(),0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,0);assert.ok(jobs(f).some(j=>j.kind==='nutrition'&&j.state==='blocked'));
    }finally{await f.close();}
  }
});

test('durable attempt cap survives restart and blocks an explicitly requested offline retry',async()=>{
  const f=await nutritionProposalFixture({serverOptions:()=>({draftJobs:worker({maxCalls:1})}),hook:async()=>{throw Error('known offline failure');}});try{
    await grant(f,'training-nutrition');await f.consent();await f.app.flushDraftJobs();assert.equal(f.calls(),1);
    const j=jobs(f).find(j=>j.kind==='nutrition'&&j.state==='failed');
    assert.equal((await f.n.req(f.base+'/draft-jobs/'+j.id+'/retry',{version:j.version,reason:'Explicit offline retry under attempt cap',confirmed:true})).status,200);
    await f.restart();await f.app.flushDraftJobs();assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);assert.equal(jobs(f).find(r=>r.id===j.id).state,'blocked');
  }finally{await f.close();}
});
