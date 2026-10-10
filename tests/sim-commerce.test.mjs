import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {commerceFixture,MOCK_WEBHOOK_TOKEN} from './commerce-fixtures.mjs';
import {purchaseSnapshot,cents} from '../backend/commerce/catalog.mjs';
import {localCommerce} from '../backend/commerce/flow.mjs';
import {asaasMockClient} from '../backend/commerce/asaas-mock.mjs';
const fixture=work=>async()=>{const f=await commerceFixture();try{await work(f);}finally{await f.close();}};
const count=(f,table)=>f.store.get('SELECT COUNT(*) n FROM '+table).n;
async function paid(f,verified=false){let o=await f.order();o=await f.checkout(o);if(verified)await f.commerce.verifyIdentity('buyer-session','one-use-proof');f.setPayments([f.payment(o)]);await f.webhook(o);await f.commerce.processNext();return o;}

test('server commercial snapshot uses total BRL prices; monthly undecided and interest cannot charge',fixture(async f=>{
 assert.equal(purchaseSnapshot('quarterly').amountCents,119700);assert.equal(purchaseSnapshot('semiannual').amountCents,179400);assert.equal(purchaseSnapshot('monthly',{monthlyMode:'detached'}).amountCents,49900);
 await assert.rejects(()=>f.order('monthly'),{status:503});for(const sku of ['annual','specific-project'])await assert.rejects(()=>f.order(sku),{status:409});
 for(const extra of [{amountCents:1},{currency:'USD'},{orgId:f.otherOrg},{customer:'foreign'},{durationMonths:99},{maxInstallmentCount:21}])await assert.rejects(()=>f.commerce.createOrder('buyer-session',{sku:'quarterly',billingType:'PIX',...extra},randomUUID()),{status:400});
 assert.equal(count(f,'commerce_orders'),0);assert.equal(f.calls.length,0);assert.throws(()=>cents(1.001),{status:409});
}));
test('order idempotency is durable, concurrent and bound to buyer and server price',fixture(async f=>{
 const key=randomUUID(),orders=await Promise.all(Array.from({length:5},()=>f.order('quarterly','PIX',key)));assert.equal(new Set(orders.map(o=>o.id)).size,1);assert.equal(count(f,'commerce_orders'),1);
 await assert.rejects(()=>f.order('semiannual','PIX',key),{status:409});await assert.rejects(()=>f.commerce.summary('other-session',orders[0].id),{status:404});await assert.rejects(()=>f.commerce.summary(null,orders[0].id),{status:401});
}));
test('documented hosted checkout request is server-built; creation and success callback grant nothing',fixture(async f=>{
 const o=await f.order(),r=await f.checkout(o),call=f.calls[0];assert.equal(call.path,'/v3/checkouts');assert.equal(call.body.items[0].value,1197);assert.equal(call.body.items[0].quantity,1);assert.equal(call.body.customer,f.customer);assert.equal(call.body.externalReference,o.id);assert.deepEqual(call.body.billingTypes,['PIX']);assert.deepEqual(call.body.chargeTypes,['DETACHED']);assert.equal(call.body.subscription,undefined);assert.equal(call.body.installment,undefined);
 assert.equal(call.body.callback.successUrl,'https://shape.fixture.invalid/local#purchase-success');assert.equal(r.checkout_state,'ready');assert.equal((await f.commerce.summary('buyer-session',o.id)).onboardingAuthorized,false);assert.equal(count(f,'commerce_entitlements'),0);
}));
test('quarterly/card installment request retains the full sale total; installment limit must be configured',async()=>{
 const f=await commerceFixture({installmentLimits:{quarterly:3,semiannual:6}});try{const o=await f.checkout(await f.order('quarterly','CREDIT_CARD')),body=f.calls[0].body;assert.equal(body.items[0].value,1197);assert.deepEqual(body.chargeTypes,['DETACHED','INSTALLMENT']);assert.deepEqual(body.installment,{maxInstallmentCount:3});assert.equal(body.subscription,undefined);assert.equal(o.max_installments,3);}finally{await f.close();}
});
test('webhook is authenticated/account scoped and stores a whitelist before acknowledging',fixture(async f=>{
 const o=await f.checkout(await f.order()),raw={id:'evt_sanitized',event:'CHECKOUT_PAID',account:{id:f.accountId},checkout:{id:o.checkout_id,customer:f.customer,externalReference:o.id,customerData:{email:'private@fixture.invalid'},secret:'NEVER_STORE'},payment:{creditCard:{creditCardToken:'NEVER_STORE'},creditCardToken:'NEVER_STORE'},unknownNewField:{secret:'NEVER_STORE'}};
 for(const token of [undefined,'fake',MOCK_WEBHOOK_TOKEN+'x'])await assert.rejects(()=>f.commerce.acceptWebhook({headers:{'asaas-access-token':token},rawBody:JSON.stringify(raw)}),{status:401});
 await assert.rejects(()=>f.commerce.acceptWebhook({headers:{'asaas-access-token':MOCK_WEBHOOK_TOKEN},rawBody:JSON.stringify({...raw,account:{id:'foreign'}})}),{status:400});assert.equal(count(f,'commerce_events'),0);
 const first=await f.commerce.acceptWebhook({headers:{'asaas-access-token':MOCK_WEBHOOK_TOKEN},rawBody:JSON.stringify(raw)});assert.equal(first.status,200);assert.equal(count(f,'commerce_events'),1);const stored=JSON.stringify(f.store.all('SELECT * FROM commerce_events'));assert.ok(!stored.includes('NEVER_STORE'));assert.ok(!stored.includes('creditCard'));assert.ok(!stored.includes('private@'));assert.equal((await f.commerce.acceptWebhook({headers:{'asaas-access-token':MOCK_WEBHOOK_TOKEN},rawBody:JSON.stringify(raw)})).duplicate,true);
}));
test('paid event without authoritative payment cannot authorize onboarding',fixture(async f=>{
 const o=await f.checkout(await f.order());await f.commerce.verifyIdentity('buyer-session','one-use-proof');await f.webhook(o);await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).onboardingAuthorized,false);assert.equal(count(f,'commerce_entitlements'),0);
}));
test('paid reconciliation creates one entitlement/task; identity proof is separate and one-use',fixture(async f=>{
 const o=await paid(f);let s=await f.commerce.summary('buyer-session',o.id);assert.equal(s.status,'paid');assert.equal(s.onboardingAuthorized,false);assert.equal(count(f,'commerce_entitlements'),1);
 await assert.rejects(()=>f.commerce.verifyIdentity('buyer-session',{email:'student@fixture.invalid',orderId:o.id,verified:true}),{status:403});await assert.rejects(()=>f.commerce.verifyIdentity('buyer-session','wrong-org-proof'),{status:403});
 await f.commerce.verifyIdentity('buyer-session','one-use-proof');await assert.rejects(()=>f.commerce.verifyIdentity('buyer-session','one-use-proof'),{status:403});s=await f.commerce.summary('buyer-session',o.id);assert.equal(s.onboardingAuthorized,true);assert.equal(s.protocolPublished,false);assert.equal(s.periodPolicyPending,true);
 for(let i=0;i<4;i++)await f.webhook(o);await Promise.all([f.commerce.processNext(),f.commerce.processNext()]);while(await f.commerce.processNext()){}await f.commerce.reconcile('buyer-session',o.id);
 assert.equal(count(f,'commerce_entitlements'),1);assert.equal(f.store.get("SELECT COUNT(*) n FROM commerce_tasks WHERE kind='onboarding'").n,1);assert.equal(f.store.get("SELECT COUNT(*) n FROM commerce_audit WHERE event='commerce.onboarding.authorized'").n,1);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);
}));
test('verification alone and revoked purchase session cannot grant or buy',fixture(async f=>{
 const o=await f.order();await f.commerce.verifyIdentity('buyer-session','one-use-proof');assert.equal((await f.commerce.summary('buyer-session',o.id)).onboardingAuthorized,false);f.sessions.delete('buyer-session');await assert.rejects(()=>f.checkout(o),{status:401});assert.equal(f.calls.length,0);
}));
test('card authorized or risk pending and Pix merely confirmed do not grant',fixture(async f=>{
 for(const [billingType,status]of [['CREDIT_CARD','AUTHORIZED'],['CREDIT_CARD','AWAITING_RISK_ANALYSIS'],['PIX','CONFIRMED']]){const o=await f.checkout(await f.order('quarterly',billingType));f.setPayments([f.payment(o,{status})]);await f.webhook(o);await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).onboardingAuthorized,false);}assert.equal(count(f,'commerce_entitlements'),0);
}));
test('gross total, customer/reference/type and duplicated payment divergence go to review',fixture(async f=>{
 for(const changes of [{value:399},{value:1197.01},{customer:'foreign'},{externalReference:'foreign'},{billingType:'BOLETO'},{deleted:true}]){const o=await f.checkout(await f.order());f.setPayments([f.payment(o,changes)]);await f.webhook(o);await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).status,'review');}const o=await f.checkout(await f.order());const p=f.payment(o,{value:598.5});f.setPayments([p,p]);await f.webhook(o);await f.commerce.processNext();assert.equal(count(f,'commerce_entitlements'),0);
}));
test('net value does not alter approved gross sale, and payments are read by checkout filter',fixture(async f=>{
 const o=await paid(f,true);assert.equal((await f.commerce.summary('buyer-session',o.id)).onboardingAuthorized,true);assert.ok(f.calls.some(c=>c.method==='GET'&&new URL('https://fixture.invalid'+c.path).searchParams.get('checkoutSession')===o.checkout_id));assert.equal(f.store.get('SELECT amount_cents FROM commerce_orders WHERE id=?',o.id).amount_cents,119700);
}));
test('full installment schedule is reconciled, not a single installment mistaken for total',async()=>{
 const f=await commerceFixture({installmentLimits:{quarterly:3}});try{const o=await f.checkout(await f.order('quarterly','CREDIT_CARD')),group='fixture_installment',rows=[1,2,3].map(n=>f.payment(o,{id:'pay_part_'+n,value:399,installment:group,installmentNumber:n}));f.setPayments([rows[0]]);f.setInstallments(rows);await f.webhook(o);await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).status,'paid');assert.equal(count(f,'commerce_payments'),3);assert.ok(f.calls.some(c=>c.path.includes('installment='+group)));}finally{await f.close();}
});
test('incomplete installment schedule stays closed',async()=>{
 const f=await commerceFixture({installmentLimits:{quarterly:3}});try{const o=await f.checkout(await f.order('quarterly','CREDIT_CARD')),row=f.payment(o,{value:399,installment:'fixture_installment',installmentNumber:1});f.setPayments([row]);f.setInstallments([row]);await f.webhook(o);await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).status,'review');assert.equal(count(f,'commerce_entitlements'),0);}finally{await f.close();}
});
test('checkout timeout is durable unknown and never blindly creates a second charge',fixture(async f=>{
 const o=await f.order();f.setCreateError(true);await assert.rejects(()=>f.checkout(o),{status:503});await assert.rejects(()=>f.checkout(o),{status:409});assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal((await f.commerce.summary('buyer-session',o.id)).checkoutState,'unknown');
 const before=(await f.commerce.summary('buyer-session',o.id));assert.ok(!JSON.stringify(before).includes('INJECTED'));assert.equal(count(f,'commerce_entitlements'),0);
}));
test('authenticated checkout-created can recover an unknown attempt only with matching reference/customer',fixture(async f=>{
 const o=await f.order();f.setCreateError(true);await assert.rejects(()=>f.checkout(o));const recovered={...o,checkout_id:'checkout_recovered'};await f.webhook(recovered,'CHECKOUT_CREATED');await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).checkoutState,'ready');f.setPayments([f.payment(o)]);await f.webhook(recovered);await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).status,'paid');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
}));
test('durable event queue and entitlement survive process reopen; no raw payload/email duplication',fixture(async f=>{
 const o=await f.checkout(await f.order());f.setPayments([f.payment(o)]);await f.webhook(o);await f.reopen();await f.commerce.processNext();assert.equal(count(f,'commerce_entitlements'),1);await f.reopen();await f.commerce.reconcile('buyer-session',o.id);assert.equal(count(f,'commerce_entitlements'),1);assert.equal(count(f,'commerce_tasks'),1);
}));
test('transient provider failure returns event to durable queue and expired worker lease recovers',fixture(async f=>{
 const o=await f.checkout(await f.order());f.setPayments([f.payment(o)]);f.setListError(true);await f.webhook(o);await f.commerce.processNext();assert.equal(f.store.get('SELECT state FROM commerce_events').state,'pending');f.setListError(false);f.store.run("UPDATE commerce_events SET state='processing',lease_until=?",1700000000001);f.advance(10);await f.commerce.processNext();assert.equal(f.store.get('SELECT state FROM commerce_events').state,'done');assert.equal(count(f,'commerce_entitlements'),1);
}));
test('pending and overdue delivered after paid do not downgrade or duplicate',fixture(async f=>{
 const o=await paid(f);f.setPayments([f.payment(o,{status:'OVERDUE'})]);await f.webhook(o,'PAYMENT_OVERDUE',{checkout:undefined,payment:{id:'pay_'+o.id,externalReference:o.id,customer:f.customer}});await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).status,'paid');assert.equal(count(f,'commerce_entitlements'),1);
}));
test('refund/chargeback observations latch financial review and late paid cannot reactivate',fixture(async f=>{
 const o=await paid(f,true);await f.commerce.pauseOnboarding('admin-session',o.id,{confirmed:true});await f.webhook(o,'PAYMENT_REFUNDED',{checkout:undefined,payment:{id:'pay_'+o.id,externalReference:o.id,customer:f.customer,creditCardToken:'NEVER_STORE'}});await f.commerce.processNext();await f.webhook(o);await f.commerce.processNext();const s=await f.commerce.summary('buyer-session',o.id);assert.equal(s.status,'refunded');assert.equal(s.financialReview,true);assert.equal(s.onboardingAuthorized,false);assert.equal(count(f,'commerce_entitlements'),1);assert.equal(f.store.get("SELECT COUNT(*) n FROM commerce_tasks WHERE kind='financial-review'").n,1);
}));
test('queued adverse event blocks first grant even when a paid event is processed earlier',fixture(async f=>{
 const o=await f.checkout(await f.order());f.setPayments([f.payment(o)]);await f.webhook(o,'CHECKOUT_PAID',{id:'evt_aaa'});await f.webhook(o,'PAYMENT_REFUND_IN_PROGRESS',{id:'evt_zzz',checkout:undefined,payment:{id:'pay_'+o.id,externalReference:o.id,customer:f.customer}});await f.commerce.processNext();assert.equal(count(f,'commerce_entitlements'),0);await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).status,'refund_pending');
}));
test('partial refund and chargeback create review, not an invented automatic access sanction',fixture(async f=>{
 for(const event of ['PAYMENT_PARTIALLY_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED']){const o=await paid(f);await f.webhook(o,event,{checkout:undefined,payment:{id:'pay_'+o.id,externalReference:o.id,customer:f.customer}});await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).financialReview,true);assert.equal(f.store.get('SELECT onboarding_authorized FROM commerce_entitlements WHERE order_id=?',o.id).onboarding_authorized,1);}
}));
test('cancel/expiry are recorded; unexpected late paid is held for financial review',fixture(async f=>{
 for(const event of ['CHECKOUT_CANCELED','CHECKOUT_EXPIRED']){const o=await f.checkout(await f.order());await f.webhook(o,event);await f.commerce.processNext();assert.ok(['canceled','expired'].includes((await f.commerce.summary('buyer-session',o.id)).status));f.setPayments([f.payment(o)]);await f.webhook(o);await f.commerce.processNext();assert.equal((await f.commerce.summary('buyer-session',o.id)).status,'review');}assert.equal(count(f,'commerce_entitlements'),0);
}));
test('annual and specific project interest persist once without checkout or entitlement',fixture(async f=>{
 for(const sku of ['annual','specific-project'])for(let i=0;i<3;i++)assert.deepEqual(await f.commerce.interest('buyer-session',{sku}),{recorded:true,charged:false});assert.equal(count(f,'commerce_interest'),2);assert.equal(count(f,'commerce_orders'),0);assert.equal(count(f,'commerce_entitlements'),0);assert.equal(f.calls.length,0);
}));
test('financial base refuses production, real transports, and preserves existing runtime/migration wiring',fixture(async f=>{
 assert.throws(()=>localCommerce({...f.configuration(),production:true}),{status:503});assert.throws(()=>asaasMockClient({accountId:'real-account',transport:{kind:'real',request:fetch}}),{status:503});assert.throws(()=>localCommerce({...f.configuration(),webhookToken:'real-secret-not-allowed-in-this-local-module'}),{status:503});
 assert.ok(readFileSync(new URL('../backend/service.mjs',import.meta.url),'utf8').includes('./commerce/runtime.mjs'));assert.equal(f.store.get('SELECT COUNT(*) n FROM schema_migrations').n,7);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);
}));
test('injected DB failure rolls back payment, entitlement, task and audit together; queued retry recovers',fixture(async f=>{
 const o=await f.checkout(await f.order());f.setPayments([f.payment(o)]);await f.webhook(o);f.store.exec("CREATE TRIGGER fail_commerce_audit BEFORE INSERT ON commerce_audit WHEN NEW.event='commerce.onboarding.authorized' BEGIN SELECT RAISE(ABORT,'synthetic transactional failure'); END");await f.commerce.processNext();assert.equal(f.store.get('SELECT status FROM commerce_orders WHERE id=?',o.id).status,'pending');assert.equal(count(f,'commerce_entitlements'),0);assert.equal(count(f,'commerce_tasks'),0);assert.equal(count(f,'commerce_payments'),0);assert.equal(f.store.get('SELECT state FROM commerce_events').state,'pending');f.store.exec('DROP TRIGGER fail_commerce_audit');await f.commerce.processNext();assert.equal(count(f,'commerce_entitlements'),1);assert.equal(count(f,'commerce_tasks'),1);
}));
test('webhook storage failure does not return HTTP200; retry after persistence recovery acknowledges once',fixture(async f=>{
 const o=await f.checkout(await f.order());f.store.exec("CREATE TRIGGER fail_commerce_event BEFORE INSERT ON commerce_events BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END");await assert.rejects(()=>f.webhook(o));assert.equal(count(f,'commerce_events'),0);f.store.exec('DROP TRIGGER fail_commerce_event');assert.equal((await f.webhook(o)).status,200);assert.equal(count(f,'commerce_events'),1);
}));
test('manual pause requires active admin of the order organization and cannot be reversed by replay',fixture(async f=>{
 const o=await paid(f,true);await assert.rejects(()=>f.commerce.pauseOnboarding('buyer-session',o.id,{confirmed:true}),{status:403});await assert.rejects(()=>f.commerce.pauseOnboarding('outsider-admin-session',o.id,{confirmed:true}),{status:403});await assert.rejects(()=>f.commerce.pauseOnboarding('admin-session',o.id,{confirmed:false}),{status:400});for(let i=0;i<2;i++)await f.commerce.pauseOnboarding('admin-session',o.id,{confirmed:true});await f.commerce.reconcile('buyer-session',o.id);assert.equal((await f.commerce.summary('buyer-session',o.id)).onboardingAuthorized,false);assert.equal(f.store.get("SELECT COUNT(*) n FROM commerce_audit WHERE event='commerce.onboarding.paused'").n,1);
}));
test('unknown fields/events do not interrupt durable receipt; malformed and oversized notifications reject',fixture(async f=>{
 const o=await f.checkout(await f.order());await f.webhook(o,'FUTURE_PROVIDER_EVENT',{newField:{creditCardToken:'NEVER_STORE'}});await f.commerce.processNext();assert.equal(f.store.get('SELECT state FROM commerce_events').state,'done');assert.equal(count(f,'commerce_entitlements'),0);await assert.rejects(()=>f.commerce.acceptWebhook({headers:{'asaas-access-token':MOCK_WEBHOOK_TOKEN},rawBody:'not-json'}),{status:400});await assert.rejects(()=>f.commerce.acceptWebhook({headers:{'asaas-access-token':MOCK_WEBHOOK_TOKEN},rawBody:'x'.repeat(131073)}),{status:413});
}));
test('event idempotency is scoped by account/environment, never globally across merchants',fixture(async f=>{
 const secondClient=asaasMockClient({accountId:'fixture-second-account',transport:{kind:'mock',request:async()=>{throw Error('No provider calls expected');}}}),second=localCommerce({...f.configuration(),client:secondClient});const first={headers:{'asaas-access-token':MOCK_WEBHOOK_TOKEN},rawBody:JSON.stringify({id:'evt_same',event:'FUTURE_EVENT',account:{id:f.accountId}})},other={...first,rawBody:JSON.stringify({id:'evt_same',event:'FUTURE_EVENT',account:{id:'fixture-second-account'}})};await f.commerce.acceptWebhook(first);await second.acceptWebhook(other);assert.equal(count(f,'commerce_events'),2);assert.equal((await second.acceptWebhook(other)).duplicate,true);
}));
test('mock transport times out/aborts without retry, or a late response changing the result',async()=>{
 let calls=0,signal;const client=asaasMockClient({accountId:'fixture-timeout',timeoutMs:5,transport:{kind:'mock',request:async req=>{calls++;signal=req.signal;return new Promise(()=>{});}}});await assert.rejects(()=>client.createCheckout({}),{status:503});assert.equal(calls,1);assert.equal(signal.aborted,true);
});
test('payment list pagination must finish completely and rejects a stalled page',async()=>{
 const offsets=[],rows=Array.from({length:101},(_,i)=>({id:'fixture_'+i}));const client=asaasMockClient({accountId:'fixture-pages',transport:{kind:'mock',request:async req=>{const offset=Number(new URL('https://fixture.invalid'+req.path).searchParams.get('offset'));offsets.push(offset);return {hasMore:offset===0,data:rows.slice(offset,offset+100)};}}});assert.equal((await client.paymentsByCheckout('checkout_fixture')).length,101);assert.deepEqual(offsets,[0,100]);const stalled=asaasMockClient({accountId:'fixture-pages',transport:{kind:'mock',request:async()=>({hasMore:true,data:[]})}});await assert.rejects(()=>stalled.paymentsByCheckout('checkout_fixture'),{status:503});
});
test('local commerce CRM is admin-only, tenant-scoped and keeps onboarding/SLA/professional release separate',fixture(async f=>{
 const o=await paid(f,true);await f.commerce.interest('buyer-session',{sku:'annual'});await f.commerce.interest('other-session',{sku:'specific-project'});await assert.rejects(()=>f.commerce.crm('buyer-session'),{status:403});const crm=await f.commerce.crm('admin-session');assert.equal(crm.orders.length,1);assert.equal(crm.orders[0].orderId,o.id);assert.deepEqual(crm.interests.map(i=>i.sku),['annual']);assert.equal(crm.tasks.filter(t=>t.kind==='onboarding').length,1);assert.equal(count(f,'service_cases'),0);assert.equal(count(f,'anamneses'),0);assert.equal(count(f,'plans'),0);
}));
test('payment event cannot claim a different payment just by copying order reference/customer',fixture(async f=>{
 const o=await f.checkout(await f.order());f.setPayments([f.payment(o)]);await f.webhook(o,'PAYMENT_RECEIVED',{checkout:undefined,payment:{id:'pay_foreign',externalReference:o.id,customer:f.customer}});await f.commerce.processNext();assert.equal(f.store.get('SELECT state FROM commerce_events').state,'review');assert.equal(count(f,'commerce_entitlements'),0);assert.equal(f.store.get("SELECT COUNT(*) n FROM commerce_tasks WHERE kind='financial-review'").n,1);
}));
test('inconclusive checkout cannot be bypassed with a new idempotency key or a pre-existing second order',fixture(async f=>{
 const first=await f.order(),second=await f.order('semiannual');f.setCreateError(true);await assert.rejects(()=>f.checkout(first),{status:503});await assert.rejects(()=>f.order('quarterly','PIX',randomUUID()),{status:409});await assert.rejects(()=>f.checkout(second),{status:409});assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(count(f,'commerce_entitlements'),0);
}));
