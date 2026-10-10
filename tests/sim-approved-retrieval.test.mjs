import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {sessionsFixture,fixtureResponse,fixtureSessionPayload} from './training-sessions-fixtures.mjs';
import {nutritionProposalFixture} from './nutrition-proposal-fixtures.mjs';
import {selectApprovedReferences} from '../backend/private-retrieval.mjs';
import {trainingRuntimeConfiguration} from '../backend/training-runtime.mjs';
import {nutritionRuntimeConfiguration} from '../backend/nutrition-runtime.mjs';
import {responsesProposalAdapter} from '../backend/proposal-responses.mjs';
import {sessionsConfiguration} from './training-sessions-fixtures.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function fixtureReferences({kind,orgId,by,sourceId,sourceSha256,sourceVersion,ruleId}){
 const text='Artificial context reference for days environment targets meals. No numeric prescription.';
 const approved={id:sha('synthetic approved chunk'),text,source:'synthetic-source',sourceSha256,locator:'page:2',offset:0,status:'pending-professional-review'},pending={...approved,id:sha('synthetic pending chunk'),text:'SECRET PENDING REFERENCE NEVER SENT'};
 return {enabled:true,bundle:{schemaVersion:'SIM_APPROVED_REFERENCE_BUNDLE_V1',kind,orgId,version:'synthetic-reviewed-v1',review:{by,role:kind==='training'?'coach':'nutrition',credentialRevision:1,at:Date.now()-1000,providerTransferApproved:true},corpus:{schemaVersion:'SIM_LOCAL_CORPUS_V1',chunks:[approved,pending]},approvals:[{chunkId:approved.id,status:'approved',sourceId,sourceVersion,sourceSha256,textSha256:sha(text),ruleIds:[ruleId],providerTransferApproved:true},{chunkId:pending.id,status:'pending-review'}]}};
}
function trainingReferences(config,f){const source=config.methodology.sources[0];return fixtureReferences({kind:'training',orgId:config.methodology.orgId,by:f.ids.coach,sourceId:source.id,sourceSha256:source.sha256,sourceVersion:source.version,ruleId:config.methodology.rules[0].id});}
function nutritionReferences(f){return fixtureReferences({kind:'nutrition',orgId:f.store.get('SELECT org_id FROM users WHERE id=?',f.ids.nutrition).org_id,by:f.ids.nutrition,sourceId:'offline-test-book',sourceSha256:'a'.repeat(64),sourceVersion:'1',ruleId:'offline-test-rule'});}

test('synthetic training prepare retrieves only explicitly approved text and draft records exact provenance without raw reference text',async()=>{
 let input,calls=0;const f=await sessionsFixture({configure:(config,f)=>{config.privateReferences=trainingReferences(config,f);},fetchImpl:async(_url,request)=>{calls++;input=JSON.parse(JSON.parse(request.body).input);return fixtureResponse(fixtureSessionPayload(input));}});
 try{
  await f.consent();const prepared=await f.prepare();assert.equal(prepared.status,200,JSON.stringify(prepared));assert.equal(calls,1);
  const refs=input.untrustedMethod.retrievedReferences;assert.equal(refs.length,1);assert.equal(refs[0].locator,'page:2');assert.equal(refs[0].textSha256,sha(refs[0].text));assert.ok(!JSON.stringify(input).includes('SECRET PENDING'));
  const saved=await f.confirm(prepared.data.proposal);assert.equal(saved.status,201);const p=saved.data.plan;assert.equal(p.status,'draft');const provenance=p.content.proposalSource.referenceRetrieval;assert.equal(provenance.retrieved[0].chunkId,refs[0].chunkId);assert.equal(provenance.retrieved[0].sourceSha256,refs[0].sourceSha256);assert.equal(provenance.reviewedBy,f.ids.coach);assert.ok(!JSON.stringify(provenance).includes(refs[0].text));
 }finally{await f.close();}
});

test('durable automatic nutrition draft uses approved retrieval, current qualified reviewer, provenance and existing professional targets',async()=>{
 let input;const f=await nutritionProposalFixture({configure:(config,f)=>{config.privateReferences=nutritionReferences(f);},serverOptions:()=>({draftJobs:{enabled:true,reviewed:true,expiresAt:Date.now()+3600000,maxAttemptUSD:.05,totalUSD:.10,maxCalls:2,poll:false}})});
 try{
  await f.consent();f.setHook(async(_f,_request,value)=>{input=value;});await f.app.flushDraftJobs();assert.equal(f.calls(),1);assert.equal(input.untrustedMethod.retrievedReferences.length,1);assert.ok(!JSON.stringify(input).includes('SECRET PENDING'));assert.equal(input.untrustedFacts.targets.energyKcal,100);
  const plan=f.store.get('SELECT * FROM nutrition_plans');assert.equal(plan.status,'draft');const content=JSON.parse(plan.content);assert.equal(content.proposalSource.automaticDraft,true);assert.equal(content.proposalSource.referenceRetrieval.retrieved[0].locator,'page:2');assert.equal(content.professionalContext.targets.energyKcal,100);
  await f.restart();await f.app.flushDraftJobs();assert.equal(f.calls(),1);
 }finally{await f.close();}
});

test('pending/tampered/wrong-org/role/hash/source/transfer references fail before generation; no substitute text or numeric rules',async()=>{
 for(const change of [b=>{b.approvals[0].status='pending-review';},b=>{b.corpus.chunks[0].text='Changed unreviewed text';},b=>{b.orgId=randomUUID();},b=>{b.review.role='nutrition';},b=>{b.approvals[0].sourceVersion='changed-version';},b=>{b.approvals[0].ruleIds=['invented-rule'];},b=>{b.approvals.push(b.approvals[0]);}]){
  let calls=0;const f=await sessionsFixture({configure:(config,f)=>{config.privateReferences=trainingReferences(config,f);change(config.privateReferences.bundle);},fetchImpl:async()=>{calls++;throw Error('must not dispatch');}});try{await f.consent();assert.notEqual((await f.prepare()).status,200);assert.equal(calls,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,0);}finally{await f.close();}
 }
 const f=await nutritionProposalFixture({configure:(config,f)=>{config.privateReferences=nutritionReferences(f);config.privateReferences.bundle.approvals[0].providerTransferApproved=false;}});try{await f.consent();assert.equal((await f.prepare()).status,409);assert.equal(f.calls(),0);}finally{await f.close();}
});

test('reference approval change in-flight discards output and preserves reservation',async()=>{
 const f=await nutritionProposalFixture({configure:(config,f)=>{config.privateReferences=nutritionReferences(f);}});try{
  await f.consent();f.setHook(async()=>{f.config.privateReferences.bundle.approvals[0].status='pending-review';});assert.notEqual((await f.prepare()).status,200);assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);
 }finally{await f.close();}
});

test('revocation of a different source reviewer blocks human approval without changing the assigned coach',async()=>{
 const reviewer=randomUUID();
 const f=await sessionsFixture({configure:(config,f)=>{
  f.store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',reviewer,config.methodology.orgId,'source-reviewer@fixture.invalid','Synthetic source reviewer','coach','never-used-test-password-hash');
  config.privateReferences=trainingReferences(config,f);config.privateReferences.bundle.review.by=reviewer;
 }});try{
  await f.consent();const prepared=await f.prepare();assert.equal(prepared.status,200);const saved=await f.confirm(prepared.data.proposal);assert.equal(saved.status,201);const submitted=await f.coach.req('plans/'+saved.data.plan.id+'/submit',{revision:1});assert.equal(submitted.status,200);
  f.store.run('UPDATE users SET active=0 WHERE id=?',reviewer);
  assert.equal((await f.coach.req('plans/'+saved.data.plan.id+'/approve',{revision:submitted.data.plan.revision})).status,409);assert.equal(f.store.get('SELECT status FROM plans WHERE id=?',saved.data.plan.id).status,'review');
 }finally{await f.close();}
});

test('off and production reference integration does not read private files or resolve credentials',async()=>{
 const never=()=>assert.fail('No private file or credential reads');
 assert.deepEqual(trainingRuntimeConfiguration({SIM_TRAINING_REFERENCES_ENABLED:'true'},{production:false},{readReferences:never,resolveKey:never}),{});
 assert.deepEqual(nutritionRuntimeConfiguration({SIM_NUTRITION_REFERENCES_ENABLED:'true'},{production:false},{readReferences:never,resolveKey:never}),{});
 assert.throws(()=>trainingRuntimeConfiguration({SIM_TRAINING_EXTERNAL_ENABLED:'true',SIM_TRAINING_REFERENCES_ENABLED:'true'},{production:true},{readReferences:never,resolveKey:never}),/closed/);
 await assert.rejects(()=>selectApprovedReferences({configuration:{enabled:true},production:true}),/Referências/);
});

test('proposed pinned nonreasoning smoke model omits reasoning, caps output and never retries using fake transport',async()=>{
 const config=sessionsConfiguration(randomUUID());let calls=0;
 const adapter=responsesProposalAdapter({apiKey:'synthetic-key-only',model:'gpt-4.1-mini-2025-04-14',fetchImpl:async(_url,request)=>{
  calls++;const wire=JSON.parse(request.body);assert.ok(!Object.hasOwn(wire,'reasoning'));assert.equal(wire.max_output_tokens,4000);assert.equal(wire.store,false);throw Error('synthetic transport failure');
 }});
 const input={kind:'training',untrustedFacts:{days:1,environment:['Na academia']},untrustedMethod:config.methodology};
 await assert.rejects(()=>adapter.generate(input));assert.equal(calls,1);
});
