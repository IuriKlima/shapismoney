import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {commerceRuntimeFixture,COMMERCE_PASSWORD} from './commerce-runtime-fixtures.mjs';
import {applyCommerceFixture} from '../backend/commerce/migrate-fixture.mjs';
import {commerceRuntime} from '../backend/commerce/runtime.mjs';
const fixture=work=>async()=>{const f=await commerceRuntimeFixture();try{await work(f);}finally{await f.close();}};
const count=(f,table)=>f.store.get('SELECT COUNT(*) AS n FROM '+table).n;
async function open(f,b){await f.register(b);const o=await f.order(b);assert.equal(o.status,201);const id=o.data.orderId;assert.equal((await b.request('commerce/orders/'+id+'/checkout',{})).status,200);return id;}
async function paid(f,b,id){await f.simulate(id,'paid');await f.process();}
async function verify(f,b){const token=await f.preview();assert.equal((await f.confirm(b,token)).status,200);assert.equal((await b.request('login',{email:'commerce@fixture.invalid',password:COMMERCE_PASSWORD})).status,200);return token;}

test('HTTP commerce gates fixture-only migration, production and real identities',fixture(async f=>{
 const cap=await f.client().request('commerce/capabilities');assert.equal(cap.data.realCheckoutEnabled,false);assert.equal(cap.data.catalog[0].available,false);
 assert.equal((await f.client().request('commerce/register',{name:'Real user',email:'real@example.com'})).status,400);
 assert.throws(()=>applyCommerceFixture(f.store,{fixtureOnly:false}));
 await assert.rejects(()=>commerceRuntime({store:{kind:'postgres'},security:{production:true},configuration:f.config}),{status:503});
 assert.equal(count(f,'schema_migrations'),8);applyCommerceFixture(f.store,{fixtureOnly:true});assert.equal(count(f,'commerce_migrations'),1);
}));

test('signup proof before money stays pending and never receives legacy/manual access; payment allows only onboarding',fixture(async f=>{
 const b=f.client(),id=await open(f,b),token=await verify(f,b);
 let session=await b.request('session');assert.equal(session.data.user.access.mode,'commerce');assert.equal(session.data.user.access.active,false);
 assert.equal((await b.request('students')).status,403);assert.equal(f.store.get("SELECT COUNT(*) n FROM operations WHERE operation_key LIKE 'access-grant-%'").n,0);assert.equal(count(f,'commerce_entitlements'),0);
 assert.equal((await f.confirm(b,token)).status,400);
 await paid(f,b,id);session=await b.request('session');assert.equal(session.data.user.access.active,true);assert.deepEqual(session.data.user.access.features,{training:false,nutrition:false});
 const student=(await b.request('students')).data.students[0];assert.equal((await b.request('onboarding',{goal:'Hipertrofia',days:3,experience:'Iniciante',context:'Ensaio',revision:student.revision},'PUT')).status,200);
 assert.equal((await b.request('students/'+student.id+'/plans')).status,403);
 assert.equal(count(f,'plans'),0);assert.equal(count(f,'nutrition_plans'),0);assert.equal(count(f,'service_cases'),0);
 for(let i=0;i<3;i++){await f.simulate(id,'paid');await f.process();await b.request('commerce/orders/'+id+'/reconcile',{});}
 assert.equal(count(f,'commerce_entitlements'),1);assert.equal(f.store.get("SELECT COUNT(*) n FROM commerce_outbox WHERE dedupe_key=?",id+':paid').n,1);
 assert.equal(f.store.get("SELECT COUNT(*) n FROM commerce_tasks WHERE kind='onboarding'").n,1);
 const outbox=await f.admin.request('commerce/admin/crm');assert.equal(outbox.data.emailsSent,0);assert.ok(!JSON.stringify(outbox).includes(token));
}));

test('payment before proof cannot create account; matching email, order ID and success redirect do not recover another buyer',fixture(async f=>{
 const b=f.client(),id=await open(f,b);await paid(f,b,id);assert.equal(count(f,'users'),7);assert.equal((await b.request('commerce/orders/'+id)).data.onboardingAuthorized,false);
 const stranger=f.client();assert.equal((await stranger.request('commerce/orders/'+id)).status,401);
 await f.register(stranger);assert.equal((await stranger.request('commerce/session')).data.registered,false);assert.equal((await stranger.request('commerce/orders/'+id+'/reconcile',{})).status,401);
 const r=await fetch(f.origin+'/local#purchase-success');assert.equal(r.status,200);assert.equal(count(f,'users'),7);
 const token=await f.preview();assert.equal((await f.confirm(b,token,'other@fixture.invalid')).status,400);assert.equal(count(f,'users'),7);
 assert.equal((await f.confirm(b,token)).status,200);assert.equal((await b.request('commerce/orders/'+id)).data.onboardingAuthorized,true);
 assert.equal((await stranger.request('commerce/admin/crm')).status,401);assert.equal((await stranger.request('commerce/admin/process',{})).status,401);
}));

test('price fields, monthly, fake verified flag and checkout replays remain blocked over HTTP',fixture(async f=>{
 const b=f.client();await f.register(b);const key=randomUUID();const responses=await Promise.all(Array.from({length:4},()=>f.order(b,'quarterly',key)));assert.equal(new Set(responses.map(r=>r.data.orderId)).size,1);
 assert.equal((await b.request('commerce/orders',{sku:'quarterly',billingType:'PIX',amountCents:1})).status,400);
 assert.equal((await f.order(b,'monthly')).status,503);assert.equal((await b.request('commerce/register',{name:'Fictício',email:'other@fixture.invalid',verified:true})).status,400);
 const id=responses[0].data.orderId;await Promise.all(Array.from({length:3},()=>b.request('commerce/orders/'+id+'/checkout',{})));assert.equal(count(f,'commerce_mock_checkouts'),1);assert.equal(count(f,'commerce_entitlements'),0);
 for(let i=0;i<3;i++)await b.request('commerce/interest',{sku:'annual'});assert.equal(count(f,'commerce_interest'),1);assert.equal(f.store.get("SELECT COUNT(*) n FROM commerce_outbox WHERE kind='interest'").n,1);
}));

test('interrupted checkout and list failure survive restart, block second creation, recover and process durable queue once',fixture(async f=>{
 const b=f.client();await f.register(b);const id=(await f.order(b)).data.orderId;await f.simulate(id,'timeout');
 assert.equal((await b.request('commerce/orders/'+id+'/checkout',{})).status,503);assert.equal((await b.request('commerce/orders/'+id+'/checkout',{})).status,409);assert.equal((await f.order(b,'semiannual')).status,409);
 await f.restart();assert.equal((await b.request('commerce/orders/'+id)).data.checkoutState,'unknown');
 await f.simulate(id,'recover-checkout');await f.process();assert.equal((await b.request('commerce/orders/'+id)).data.checkoutState,'ready');
 await f.simulate(id,'list-failure');await f.simulate(id,'paid');await f.process();assert.equal(count(f,'commerce_entitlements'),0);assert.equal(f.store.get("SELECT COUNT(*) n FROM commerce_events WHERE state='pending'").n,1);
 await f.simulate(id,'restore-list');await f.process();assert.equal(count(f,'commerce_entitlements'),1);assert.equal(count(f,'commerce_mock_checkouts'),1);
 await f.restart();await f.simulate(id,'paid');await f.process();assert.equal(count(f,'commerce_entitlements'),1);
}));

test('recovery requires new one-use proof, revokes sessions and cannot create a second identity or legacy grant',fixture(async f=>{
 const b=f.client(),id=await open(f,b);await paid(f,b,id);await verify(f,b);const recovery=f.client();
 assert.equal((await recovery.request('commerce/recover',{email:'commerce@fixture.invalid'})).status,202);assert.equal((await recovery.request('commerce/session')).data.registered,false);
 const token=await f.preview();const results=await Promise.all([f.confirm(recovery,token),f.confirm(recovery,token)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
 assert.equal((await b.request('session')).status,401);assert.equal(count(f,'users'),8);assert.equal(count(f,'commerce_student_sources'),1);
 assert.equal((await recovery.request('login',{email:'commerce@fixture.invalid',password:COMMERCE_PASSWORD})).status,200);assert.equal((await recovery.request('commerce/session')).data.orders[0].orderId,id);
 await recovery.request('logout',{});assert.equal((await recovery.request('commerce/session')).data.registered,false);
 assert.equal(f.store.get("SELECT COUNT(*) n FROM operations WHERE operation_key LIKE 'access-grant-%'").n,0);
}));

test('identity confirmation rollback and expired proofs do not provision users or consume authorization',fixture(async f=>{
 const b=f.client();await f.register(b);const token=await f.preview();
 f.store.exec("CREATE TRIGGER fixture_identity_failure BEFORE INSERT ON audit WHEN NEW.event='commerce.identity.email-proof-consumed' BEGIN SELECT RAISE(ABORT,'fixture atomic rollback'); END");
 assert.equal((await f.confirm(b,token)).status,500);assert.equal(count(f,'users'),7);assert.equal(count(f,'commerce_student_sources'),0);assert.equal(f.store.get('SELECT consumed_at FROM commerce_identity_proofs').consumed_at,null);
 f.store.exec('DROP TRIGGER fixture_identity_failure');f.advance(15*60*1000+1);assert.equal((await f.confirm(b,token)).status,400);assert.equal(count(f,'users'),7);
}));

test('financial adverse states, late paid and explicit admin pause do not reactivate refunded onboarding',fixture(async f=>{
 const b=f.client(),id=await open(f,b);await paid(f,b,id);await verify(f,b);
 await f.simulate(id,'partial-refund');await f.process();assert.equal((await b.request('session')).data.user.access.active,true);assert.equal((await b.request('commerce/orders/'+id)).data.financialReview,true);
 await f.simulate(id,'refund');await f.process();await f.simulate(id,'paid');await f.process();await b.request('commerce/orders/'+id+'/reconcile',{});
 const summary=(await b.request('commerce/orders/'+id)).data;assert.equal(summary.status,'refunded');assert.equal(summary.onboardingAuthorized,false);assert.equal((await b.request('session')).data.user.access.active,false);
 assert.equal((await b.request('commerce/admin/orders/'+id+'/pause',{confirmed:true})).status,403);
 await f.admin.request('commerce/admin/orders/'+id+'/pause',{confirmed:true});await b.request('commerce/orders/'+id+'/reconcile',{});assert.equal(f.store.get('SELECT onboarding_authorized FROM commerce_entitlements WHERE order_id=?',id).onboarding_authorized,0);
 assert.equal(f.store.get("SELECT COUNT(*) n FROM commerce_outbox WHERE kind='financial-review'").n,1);
}));


test('persistent commercial source cannot fall back to legacy access when commerce is disabled on restart',fixture(async f=>{
 const b=f.client();await f.register(b);await verify(f,b);
 f.config.enabled=false;await f.restart();
 const session=await b.request('session');assert.equal(session.status,200);assert.equal(session.data.user.access.mode,'commerce');assert.equal(session.data.user.access.active,false);assert.equal((await b.request('students')).status,403);
 assert.equal((await b.request('commerce/capabilities')).data.enabled,false);
}));
