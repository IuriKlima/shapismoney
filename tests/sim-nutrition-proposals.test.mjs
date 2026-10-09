import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {nutritionProposalFixture} from './nutrition-proposal-fixtures.mjs';
import {nutritionRuntimeConfiguration} from '../backend/nutrition-runtime.mjs';
import {NUTRITION_EXTERNAL_PURPOSE} from '../backend/nutrition-context.mjs';
import {normalizeAllergens} from '../backend/nutrition-validation.mjs';
test('nutrition opt-in is independently closed, production blocked and no credential resolution while off',()=>{
 let reads=0;assert.deepEqual(nutritionRuntimeConfiguration({},{} ,{resolveKey:()=>{reads++;throw Error('No key');}}),{});assert.equal(reads,0);
 assert.throws(()=>nutritionRuntimeConfiguration({SIM_NUTRITION_EXTERNAL_ENABLED:'true'},{production:true},{resolveKey:()=>{reads++;}}),/gate closed/);assert.equal(reads,0);
 assert.deepEqual(normalizeAllergens(['leite','ovo'],()=>{throw Error('invalid');}),['milk','egg']);assert.throws(()=>normalizeAllergens(['milk','leite'],()=>{throw Error('duplicate');}),/duplicate/);
});
test('labelled offline nutrition: student-owned consent, contextual enums, persistent proposal, one draft and shared reservation',async()=>{
 const f=await nutritionProposalFixture();try{
  const cap=(await f.n.req('nutrition-proposals/capabilities')).data;assert.equal(cap.available,true);assert.equal(cap.providerKind,'responses-offline-test');assert.equal(cap.externalCalls,false);
  assert.equal((await f.prepare()).status,409);assert.equal(f.calls(),0);
  for(const actor of [f.a,f.coach,f.other,f.outsider])assert.notEqual((await f.prepare(randomUUID(),actor)).status,200);
  const c=(await f.s.req(f.base+'/nutrition/external-consent')).data.consent;
  const body={purpose:NUTRITION_EXTERNAL_PURPOSE,revision:c.revision,contextRevision:c.contextRevision,anamnesisRevision:c.anamnesisRevision,enabled:true,confirmed:true};
  assert.equal((await f.a.req(f.base+'/nutrition/external-consent',body,'PUT')).status,403);assert.equal((await f.n.req(f.base+'/nutrition/external-consent',body,'PUT')).status,403);
  assert.equal((await f.s.req(f.base+'/nutrition/external-consent',{...body,purpose:'SIM_TRAINING_PROPOSAL_EXTERNAL_V1'},'PUT')).status,400);
  await f.consent();f.setHook(async(_f,request,input)=>{const wire=JSON.parse(request.body);assert.equal(wire.store,false);assert.deepEqual(wire.text.format.schema.properties.meals.items.properties.items.items.properties.foodId.enum,[f.baseFood.id]);assert.ok(wire.text.format.schema.properties.evidence.items.enum.includes('targets'));assert.ok(!JSON.stringify(input).includes('@fixture.invalid'));assert.ok(!Object.hasOwn(input.untrustedFacts,'age'));assert.ok(!Object.hasOwn(input.untrustedFacts,'current_diet'));});
  const key=randomUUID(),r=await f.prepare(key);assert.equal(r.status,200,JSON.stringify(r));const p=r.data.proposal;assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);assert.equal((await f.prepare(key)).status,409);assert.equal(f.calls(),1);
  assert.ok(f.store.get('SELECT result FROM operations WHERE operation_key=?','nutrition-external-proposal-'+p.id));const metadata=JSON.parse(f.store.get('SELECT metadata FROM ai_monthly_reservations').metadata);assert.equal(metadata.purpose,'nutrition-proposals');assert.equal(metadata.model,'offline-nutrition-model');
  const confirmKey=randomUUID(),saved=await f.confirm(p,p.payload,confirmKey);assert.equal(saved.status,201,JSON.stringify(saved));assert.deepEqual(await f.confirm(p,p.payload,confirmKey),saved);assert.equal((await f.confirm(p)).status,409);
  assert.equal(saved.data.plan.status,'draft');assert.equal(saved.data.plan.totals.energyKcal,100);assert.equal(saved.data.plan.content.meals[0].items[0].composition.energyKcal,10000);assert.equal(saved.data.plan.content.meals[0].items[0].gramsTenths,1000);assert.equal(saved.data.plan.content.proposalSource.reviewRequired,true);assert.equal(saved.data.plan.targetDeviations.energyKcal,0);assert.equal((await f.s.req('nutrition/plans/'+saved.data.plan.id)).status,404);
  assert.ok(!JSON.stringify(f.store.all('SELECT result FROM operations')).includes('offline-only-fictitious-nutrition'));
 }finally{await f.close();}
});
test('nutrition before/during/after dispatch changes never create drafts; failed calls keep cost and do not retry',async()=>{
 for(const change of ['consent','context','credential','intake','catalog','session','gate']){
  const f=await nutritionProposalFixture();try{await f.consent();f.setHook(async()=>{if(change==='consent')await f.consent(false);if(change==='context')await f.context({tolerances:{energyKcal:10,proteinG:1,carbsG:1,fatG:1}});if(change==='credential')f.store.run('UPDATE nutrition_credentials SET verified=0,revision=revision+1 WHERE user_id=?',f.ids.nutrition);if(change==='intake')f.store.run('UPDATE anamneses SET revision=revision+1 WHERE student_id=?',f.ids.studentRecord);if(change==='catalog')f.store.run('UPDATE nutrition_foods SET revision=revision+1 WHERE id=?',f.baseFood.id);if(change==='session')f.store.run('DELETE FROM sessions WHERE user_id=?',f.ids.nutrition);if(change==='gate')f.config.externalGate=false;});const key=randomUUID(),r=await f.prepare(key);assert.notEqual(r.status,200,change);assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);assert.notEqual((await f.prepare(key)).status,200);assert.equal(f.calls(),1);assert.equal(JSON.parse(f.store.get("SELECT result FROM operations WHERE operation_key LIKE 'nutrition-external-job-%'").result).state,'failed');}finally{await f.close();}
 }
 const f=await nutritionProposalFixture();try{await f.consent();const p=(await f.prepare()).data.proposal;await f.consent(false);assert.equal((await f.confirm(p)).status,409);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);}finally{await f.close();}
});
test('nutrition schema/prescription rejects invented food/preparation/total/grams/evidence and duplicate alternatives',async()=>{
 for(const mutate of [p=>{p.meals[0].items[0].foodId=randomUUID();},p=>{p.meals[0].items[0].preparation='raw';},p=>{p.totals={energyKcal:100};},p=>{p.meals[0].items[0].grams=1.01;},p=>{p.meals[0].items[0].grams=140;},p=>{p.evidence=['inferred-bmi'];},p=>{p.meals[0].items[0].alternatives=[{...p.meals[0].items[0]}];delete p.meals[0].items[0].alternatives[0].alternatives;}]){
  const f=await nutritionProposalFixture({mutate});try{await f.consent();assert.equal((await f.prepare()).status,502);assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);}finally{await f.close();}
 }
 const f=await nutritionProposalFixture();try{const unsafe=await f.food({mayContain:['milk']});const r=await f.context({allergies:['leite'],catalogIds:[f.baseFood.id,unsafe.id]});assert.equal(r.status,200);await f.consent();const p=(await f.prepare()).data.proposal;p.payload.meals[0].items[0].alternatives=[{foodId:unsafe.id,preparation:unsafe.preparation,grams:100}];assert.equal((await f.confirm(p)).status,400);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);}finally{await f.close();}
});
test('nutrition immutable published versions, current replacement and old student choices/history survive',async()=>{
 const f=await nutritionProposalFixture();try{await f.consent();const p=(await f.prepare()).data.proposal;let plan=(await f.confirm(p)).data.plan;const originalId=plan.id;
  const edit={...plan.editable,title:'Human edited draft',revision:plan.revision};edit.meals[0].items[0].grams=110;const changed=await f.n.req('nutrition/plans/'+plan.id,edit,'PUT');assert.equal(changed.status,200);plan=changed.data.plan;assert.equal(plan.status,'draft');assert.equal(plan.content.proposalSource.proposalId,p.id);assert.equal(plan.totals.energyKcal,110);
  for(const action of ['submit','approve','publish']){const r=await f.n.req('nutrition/plans/'+plan.id+'/'+action,{revision:plan.revision,...(action==='approve'?{reviewed:true}:{})});assert.equal(r.status,200,JSON.stringify(r));plan=r.data.plan;}
  const choice={mealIndex:0,itemIndex:0,optionIndex:0,planRevision:plan.revision,revision:0};assert.equal((await f.s.req('nutrition/plans/'+plan.id+'/choices',choice)).status,200);const oldContent=f.store.get('SELECT content FROM nutrition_plans WHERE id=?',originalId).content;assert.equal((await f.n.req('nutrition/plans/'+plan.id,{...plan.editable,revision:plan.revision},'PUT')).status,409);
  const version=await f.n.req('nutrition/plans/'+plan.id+'/versions',{...plan.editable,title:'Human replacement version',revision:plan.revision,changeReason:'Professional offline replacement review'},'POST');assert.equal(version.status,201,JSON.stringify(version));plan=version.data.plan;assert.notEqual(plan.id,originalId);assert.equal(plan.content.previousVersion.id,originalId);assert.equal(plan.status,'draft');
  for(const action of ['submit','approve','publish'])plan=(await f.n.req('nutrition/plans/'+plan.id+'/'+action,{revision:plan.revision,...(action==='approve'?{reviewed:true}:{})})).data.plan;
  assert.equal(f.store.get('SELECT content FROM nutrition_plans WHERE id=?',originalId).content,oldContent);const list=(await f.s.req(f.base+'/nutrition')).data.plans;assert.equal(list.length,2);assert.equal(list.find(x=>x.id===originalId).current,false);assert.equal(list.find(x=>x.id===plan.id).current,true);assert.equal(list.find(x=>x.id===originalId).choices.length,1);
  await f.context({targets:{energyKcal:105,proteinG:10,carbsG:10,fatG:2}});assert.equal((await f.n.req('nutrition/plans/'+plan.id+'/versions',{...plan.editable,title:'Invalid stale context',revision:plan.revision,changeReason:'Context changed after publication'})).status,409);
 }finally{await f.close();}
});
test('nutrition timeout/budget/gate and fake transport labels close before requests or retain durable reservation',async()=>{
 for(const change of [c=>{c.externalGate=false;},c=>{c.offlineTest=false;},c=>{c.budget.purpose='chat';},c=>{c.provider.model='changed';}]){
  const f=await nutritionProposalFixture();try{await f.consent();change(f.config);assert.equal((await f.prepare()).status,503);assert.equal(f.calls(),0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,0);}finally{await f.close();}
 }
 const exhausted=await nutritionProposalFixture({budget:{globalMonthlyUSD:.001,adminMonthlyUSD:.001}});try{await exhausted.consent();assert.equal((await exhausted.prepare()).status,503);assert.equal(exhausted.calls(),0);}finally{await exhausted.close();}
 const f=await nutritionProposalFixture({timeoutMs:5,hook:async()=>new Promise(r=>setTimeout(r,30))});try{await f.consent();assert.equal((await f.prepare()).status,502);assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);}finally{await f.close();}
});


test('nutrition preparation recovered by a fresh application instance; no provider replay',async()=>{
 const f=await nutritionProposalFixture();let fresh;try{await f.consent();const p=(await f.prepare()).data.proposal;
 const {createLocalService}=await import('../backend/service.mjs'),{asyncLocalStore}=await import('../backend/async-store.mjs');
 fresh=await createLocalService({store:asyncLocalStore(f.store),nutritionProposals:f.config,loginLimit:80});
 f.app.server.removeAllListeners('request');f.app.server.on('request',fresh);assert.equal((await f.confirm(p)).status,201);assert.equal(f.calls(),1);
 }finally{await fresh?.close();await f.close();}
});
test('nutrition session/gate/context rechecked after awaiting reservation lock before dispatch: zero fake POST and zero spend',async()=>{
 for(const mode of ['session','gate','context','credential']){
  const f=await nutritionProposalFixture();let fresh,release;try{await f.consent();const {createLocalService}=await import('../backend/service.mjs'),{asyncLocalStore}=await import('../backend/async-store.mjs');
  const adapter=asyncLocalStore(f.store),transaction=adapter.transaction;let signal;const waiting=new Promise(r=>{signal=r;});let armed=true;
  adapter.transaction=async work=>{if(armed){armed=false;signal();await new Promise(r=>{release=r;});}return transaction(work);};
  fresh=await createLocalService({store:adapter,nutritionProposals:f.config,loginLimit:80});f.app.server.removeAllListeners('request');f.app.server.on('request',fresh);
  const pending=f.prepare();await waiting;
  if(mode==='session')f.store.run('DELETE FROM sessions WHERE user_id=?',f.ids.nutrition);
  if(mode==='gate')f.config.externalGate=false;
  if(mode==='context')f.store.run('UPDATE anamneses SET revision=revision+1 WHERE student_id=?',f.ids.studentRecord);
  if(mode==='credential')f.store.run('UPDATE nutrition_credentials SET verified=0,revision=revision+1 WHERE user_id=?',f.ids.nutrition);
  release();const r=await pending;assert.notEqual(r.status,200,mode);assert.equal(f.calls(),0,mode);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,0,mode);assert.equal(f.store.get("SELECT COUNT(*) AS n FROM operations WHERE operation_key LIKE 'nutrition-external-job-%'").n,0,mode);
  }finally{release?.();await fresh?.close();await f.close();}
 }
});
test('nutrition catalog aliases, exact preparation and all permitted combinations respect reviewed bounds; no auto-equivalence',async()=>{
 const f=await nutritionProposalFixture();try{
  const alternative=await f.food({name:'Synthetic alternate',per100g:{energyKcal:110,proteinG:11,carbsG:11,fatG:2}});await f.context({catalogIds:[f.baseFood.id,alternative.id]});await f.consent();const p=(await f.prepare()).data.proposal;
  p.payload.meals[0].items[0].alternatives=[{foodId:alternative.id,preparation:'cooked',grams:200}];assert.equal((await f.confirm(p)).status,400);
  p.payload.meals[0].items[0].alternatives[0].grams=100;const saved=await f.confirm(p);assert.equal(saved.status,201);assert.equal(saved.data.plan.totals.energyKcal,100);
  const unsafe=await f.food({mayContain:['leite']});const row=f.store.get('SELECT may_contain FROM nutrition_foods WHERE id=?',unsafe.id);assert.deepEqual(JSON.parse(row.may_contain),['milk']);
  const badContext=await f.context({catalogIds:[f.baseFood.id,unsafe.id],allergies:['milk','leite']});assert.equal(badContext.status,400);
 }finally{await f.close();}
});


test('nutrition running durable job blocks concurrent duplicate work; concurrent confirmations create one plan and existing chat spend shares cap',async()=>{
 const f=await nutritionProposalFixture();let release;try{
  await f.consent();let called;const waiting=new Promise(r=>{called=r;});f.setHook(async()=>{called();await new Promise(r=>{release=r;});});
  const first=f.prepare();await waiting;assert.equal((await f.prepare()).status,409);assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);release();const p=(await first).data.proposal;
  const confirmed=await Promise.all([f.confirm(p),f.confirm(p)]);assert.deepEqual(confirmed.map(r=>r.status).sort(),[201,409]);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,1);
 }finally{release?.();await f.close();}
 const g=await nutritionProposalFixture();try{
  await g.consent();const {budgetCycle}=await import('../backend/ai-monthly-budget.mjs'),org=g.store.get('SELECT org_id FROM students WHERE id=?',g.ids.studentRecord).org_id;
  g.store.run('INSERT INTO ai_monthly_reservations VALUES (?,?,?,?,?,?,?,?,?,?)',randomUUID(),org,g.ids.student,g.ids.studentRecord,budgetCycle(Date.now()),999999,randomUUID(),'fictitious-hash',JSON.stringify({purpose:'chat',kind:'conservative-reservation'}),Date.now());
  assert.equal((await g.prepare()).status,503);assert.equal(g.calls(),0);assert.equal(g.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);
 }finally{await g.close();}
});


test('nutrition external purpose does not grant access entitlement; withdrawing and access changes invalidate prepared proposal',async()=>{
 const f=await nutritionProposalFixture();try{
  await f.consent();const p=(await f.prepare()).data.proposal;
  assert.equal((await f.a.req(f.base+'/access',{level:'training',expiresAt:null,enabled:true,sequence:0,confirmed:true},'PUT')).status,200);
  assert.equal((await f.prepare()).status,403);assert.equal((await f.confirm(p)).status,403);assert.equal(f.calls(),1);
  assert.equal((await f.consent(false)).status,200);assert.equal((await f.consent(true)).status,403);
  assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);
 }finally{await f.close();}
});
