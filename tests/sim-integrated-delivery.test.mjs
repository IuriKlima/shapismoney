import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {commerceRuntimeFixture,COMMERCE_PASSWORD} from './commerce-runtime-fixtures.mjs';
import {nutritionProposalFixture} from './nutrition-proposal-fixtures.mjs';
import {sessionsConfiguration} from './training-sessions-fixtures.mjs';
import {syntheticTrainingBudget} from './training-proposal-fixtures.mjs';
import {applyCommerceFixture} from '../backend/commerce/migrate-fixture.mjs';
import {fullIntakeAnswers} from './intake-test-fixtures.mjs';
import {INTAKE_VERSION,CONSENT_VERSION} from '../public/sim/intake-fields.js';
const worker={enabled:true,reviewed:true,expiresAt:Date.now()+3600000,maxAttemptUSD:.05,totalUSD:.10,maxCalls:2,poll:false};
const count=(f,t)=>f.store.get('SELECT COUNT(*) AS n FROM '+t).n;
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r));return r.data;};
function buyerClient(f){const cookies=new Map();return {async req(route,body,method='POST',key=randomUUID()){
 const origin=f.origin,r=await fetch(origin+'/api/local/'+route,{method:body===undefined?'GET':method,headers:{Origin:origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)});
 for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');if(v)cookies.set(k,v);else cookies.delete(k);}return {status:r.status,data:await r.json()};
 }};}
async function paidBuyer(f,admin){const b=buyerClient(f),email='integrated-buyer@fixture.invalid';ok(await b.req('commerce/register',{name:'Comprador integrado ficticio',email}),202);
 const id=ok(await b.req('commerce/orders',{sku:'quarterly',billingType:'PIX'}),201).orderId;ok(await b.req('commerce/orders/'+id+'/checkout',{}));
 ok(await admin.req('commerce/admin/orders/'+id+'/simulate',{scenario:'paid'}));ok(await admin.req('commerce/admin/process',{}));
 const crm=ok(await admin.req('commerce/admin/crm')),reg=crm.registrations.find(r=>r.email===email),job=crm.outbox.find(r=>r.buyer_id===reg.buyer_id&&r.kind==='verify-identity');
 const token=ok(await admin.req('commerce/admin/outbox/'+job.id+'/preview',{})).fragment.split('=')[1];ok(await b.req('password-access/confirm',{token,email,password:COMMERCE_PASSWORD}));
 ok(await b.req('login',{email,password:COMMERCE_PASSWORD}));const student=ok(await b.req('students')).students[0];
 ok(await admin.req('students/'+student.id+'/assignments',{coachId:f.ids.coach,nutritionId:f.ids.nutrition,revision:student.revision},'PUT'));
 const current=ok(await b.req('students')).students[0],base='students/'+student.id;
 ok(await b.req('onboarding',{goal:'Hipertrofia',days:3,experience:'Iniciante',context:'Synthetic integrated context',revision:current.revision},'PUT'));
 ok(await b.req(base+'/anamnesis',{version:INTAKE_VERSION,revision:0,answers:fullIntakeAnswers(),consentVersion:CONSENT_VERSION,consents:{training:true,nutrition:true}},'PUT'));
 return {b,id,base,sid:student.id};}
test('integrated commerce + completed intake stays onboarding-only: no SLA, draft, mail or clinical feature until services defined',async()=>{
 const f=await commerceRuntimeFixture({serverOptions:(f,clock)=>({draftJobs:worker,chat:syntheticTrainingBudget,trainingProposals:sessionsConfiguration(f.store.get('SELECT org_id FROM students WHERE id=?',f.ids.studentRecord).org_id,clock)})});
 try{const admin={req:(...args)=>f.admin.request(...args)},p=await paidBuyer(f,admin),body={version:INTAKE_VERSION,revision:1,confirmed:true},completed=ok(await p.b.req(p.base+'/anamnesis/complete',body));
  assert.equal(completed.anamnesis.complete,true);assert.equal(completed.startedNow,false);assert.equal(completed.blockedReason,'services-undefined');assert.equal(completed.service.started,false);assert.equal(completed.service.serviceDefinitionPending,true);
  await f.app.flushDraftJobs();await f.app.flushProtocolEmail();for(const table of ['plans','nutrition_plans','service_cases','ai_monthly_reservations'])assert.equal(count(f,table),0);
  assert.equal((await p.b.req(p.base+'/plans')).status,403);assert.equal((await p.b.req(p.base+'/nutrition')).status,403);assert.deepEqual(ok(await p.b.req('notifications')).notifications,[]);
  assert.equal(ok(await admin.req('commerce/admin/crm')).emailsSent,0);await f.restart();const session=ok(await p.b.req('session'));assert.equal(session.user.access.mode,'commerce');assert.deepEqual(session.user.access.features,{training:false,nutrition:false});
 }finally{await f.close();}
});
test('integrated paid buyer + explicit manual exception runs synthetic drafts, professional publication, durable notices and replay safely',async()=>{
 const messages=[];const f=await nutritionProposalFixture({serverOptions:(f,clock)=>{applyCommerceFixture(f.store,{fixtureOnly:true});return {commerce:{enabled:true,fixtureOnly:true,adminId:f.ids.admin},draftJobs:worker,chat:syntheticTrainingBudget,trainingProposals:sessionsConfiguration(f.store.get('SELECT org_id FROM students WHERE id=?',f.ids.studentRecord).org_id,clock),protocolEmail:{enabled:true,reviewed:true,publicOrigin:'https://shape.example.test',autoDispatch:false,transport:{kind:'mock',send:async m=>{messages.push(m);return {accepted:true};}}}};}});
 try{const p=await paidBuyer(f,f.a);ok(await p.b.req(p.base+'/anamnesis/complete',{version:INTAKE_VERSION,revision:1,confirmed:true}));
  const access=ok(await f.a.req(p.base+'/access')).access;ok(await f.a.req(p.base+'/access',{level:'training-nutrition',expiresAt:null,enabled:true,sequence:access.sequence,confirmed:true},'PUT'));
  ok(await f.coach.req(p.base+'/anamnesis/review',{version:INTAKE_VERSION,revision:1,confirmed:true}));ok(await p.b.req(p.base+'/anamnesis/complete',{version:INTAKE_VERSION,revision:1,confirmed:true}),201);
  const original=ok(await f.n.req(f.base+'/nutrition/context')).context,keys=['targets','tolerances','allergies','preferences','meals','catalogIds','rules','sources','transferApproved'];
  ok(await f.n.req(p.base+'/nutrition/context',{revision:0,anamnesisRevision:1,reviewed:true,...Object.fromEntries(keys.map(k=>[k,original[k]]))},'PUT'));
  let c=ok(await p.b.req(p.base+'/training-proposal-consent')).consent;ok(await p.b.req(p.base+'/training-proposal-consent',{purpose:'SIM_TRAINING_PROPOSAL_LOCAL_V1',sequence:c.sequence,anamnesisRevision:c.anamnesisRevision,enabled:true,confirmed:true},'PUT'));
  c=ok(await p.b.req(p.base+'/nutrition/external-consent')).consent;ok(await p.b.req(p.base+'/nutrition/external-consent',{purpose:'SIM_NUTRITION_PROPOSAL_EXTERNAL_V1',revision:c.revision,contextRevision:c.contextRevision,anamnesisRevision:c.anamnesisRevision,enabled:true,confirmed:true},'PUT'));
  await f.app.flushDraftJobs();assert.equal(count(f,'plans'),1);assert.equal(count(f,'nutrition_plans'),1);assert.equal(count(f,'ai_monthly_reservations'),2);assert.equal(messages.length,0);assert.deepEqual(ok(await p.b.req(p.base+'/plans')).plans,[]);
  let t=f.store.get('SELECT id,revision FROM plans');assert.equal((await f.coach.req('plans/'+t.id+'/publish',{revision:t.revision})).status,409);
  for(const action of ['submit','approve','publish'])t=ok(await f.coach.req('plans/'+t.id+'/'+action,{revision:t.revision})).plan;
  let n=ok(await f.n.req('nutrition/plans/'+f.store.get('SELECT id FROM nutrition_plans').id)).plan;
  for(const action of ['submit','approve','publish'])n=ok(await f.n.req('nutrition/plans/'+n.id+'/'+action,{revision:n.revision,...(action==='approve'?{reviewed:true}:{})})).plan;
  assert.equal(ok(await p.b.req(p.base+'/plans')).plans.length,1);const notices=ok(await p.b.req('notifications')).notifications;assert.equal(notices.length,2);assert.equal(messages.length,0);
  await f.app.flushProtocolEmail();assert.equal(messages.length,2);assert.ok(messages.every(m=>m.to==='integrated-buyer@fixture.invalid'));assert.equal(ok(await f.a.req('commerce/admin/crm')).emailsSent,0);
  await f.restart();await f.app.flushDraftJobs();await f.app.flushProtocolEmail();assert.equal(count(f,'plans'),1);assert.equal(count(f,'nutrition_plans'),1);assert.equal(messages.length,2);assert.equal(f.calls(),1);
  ok(await f.a.req('commerce/admin/orders/'+p.id+'/simulate',{scenario:'refund'}));ok(await f.a.req('commerce/admin/process',{}));
  assert.equal(ok(await p.b.req('session')).user.access.mode,'manual');assert.equal(ok(await p.b.req('notifications')).notifications.length,2);
 }finally{await f.close();}
});
