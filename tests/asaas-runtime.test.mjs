import {recoverRejectedCheckout} from '../backend/commerce/checkout-recovery.mjs';
import {asyncLocalStore} from '../backend/async-store.mjs';
import {sandboxSecurity} from '../backend/security.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {applyAsaasRuntimeSchema} from '../backend/commerce/asaas-runtime-migrate.mjs';
import {asaasRuntime} from '../backend/commerce/asaas-runtime.mjs';
import {INTAKE_VERSION,CONSENT_VERSION} from '../public/sim/intake-fields.js';
import {fullIntakeAnswers} from './intake-test-fixtures.mjs';
const profileFixture={phone:'1120000000',address:'Rua Teste Sandbox',addressNumber:'99999',postalCode:'01310000',province:'Bairro Teste'};
const apiKey='synthetic-api-never-real-00000000000000000',webhookToken='synthetic-hook-never-real-1111111111111111';
async function fixture(work,{proxy=false}={}){const f=await isolatedFixture(),orgId=f.store.get('SELECT org_id FROM users WHERE id=?',f.ids.student).org_id,accountId='synthetic-runtime';applyAsaasRuntimeSchema(f.store,{isolatedSandbox:true,accountId,orgId});let clock=Date.parse('2026-10-12T15:00:00Z'),app,origin,timeoutCustomer=false,checkoutResponse=null;const calls=[],customers=new Map(),payments=new Map();
 const config={enabled:true,isolatedSandbox:true,environment:'sandbox',networkAccessApproved:true,accountId,orgId,apiKey,webhookToken,publicOrigin:'https://sandbox.fixture.invalid',fetchImpl:async(url,options)=>{assert.equal(new URL(url).origin,'https://api-sandbox.asaas.com');calls.push({url,method:options.method,body:options.body&&JSON.parse(options.body)});const parsed=new URL(url);if(parsed.pathname.endsWith('/customers')){if(options.method==='POST'){const b=JSON.parse(options.body),id='cus_'+b.externalReference;customers.set(b.externalReference,{...b,id,city:12565,cityName:'São Paulo'});if(timeoutCustomer)throw Error('uncertain');return Response.json({id});}return Response.json({hasMore:false,data:[customers.get(parsed.searchParams.get('externalReference'))].filter(Boolean)});}if(parsed.pathname.includes('/customers/')){const c=[...customers.values()].find(c=>c.id===parsed.pathname.split('/').pop());if(!c)return Response.json({}, {status:404});if(options.method==='PUT')Object.assign(c,JSON.parse(options.body),{city:12565,cityName:'São Paulo'});return Response.json(c);}if(options.method==='POST'&&checkoutResponse)return checkoutResponse();if(options.method==='POST')return Response.json({id:'checkout_'+JSON.parse(options.body).externalReference});return Response.json({hasMore:false,data:payments.get(parsed.searchParams.get('checkoutSession'))||[]});}};
 const security=proxy?sandboxSecurity({SIM_PUBLIC_ORIGIN:'https://sandbox.example.test',SIM_TRUSTED_PROXY_IPS:'127.0.0.1',SIM_STAGING_CLIENT_IPS:'192.0.2.10'}):undefined;const proxyHeaders=proxy?{'x-forwarded-host':'sandbox.example.test','x-forwarded-proto':'https','x-forwarded-for':'192.0.2.10'}:{};
 async function start(store){app=await createLocalServer({security,store,filename:f.filename,now:()=>clock,sessionMs:365*86400000,asaas:config});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+app.server.address().port;if(security)security.upstreamHost=new URL(origin).host;}
 await start(f.store);
 function client(){let cookie='';return {async req(route,body,method='POST',headers={}){const r=await fetch(origin+'/api/local/'+route,{method:body===undefined?'GET':method,headers:{...proxyHeaders,Cookie:cookie,Origin:security?.origin||origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),...headers},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};},login(role){return this.req('login',{email:role.toLowerCase()+'@fixture.invalid',password:FIXTURE_PASSWORD});}};}
 async function notify(o,event='CHECKOUT_PAID',token=webhookToken,id=randomUUID()){const r=await fetch(origin+'/api/asaas/webhook',{method:'POST',headers:{...proxyHeaders,...(proxy?{'x-forwarded-for':'198.51.100.20'}:{}),'Content-Type':'application/json','asaas-access-token':token},body:JSON.stringify({id,event,account:{id:accountId},checkout:{id:o.checkout_id,customer:o.customer_id,externalReference:o.id}})});return r.status;}
 try{await work({...f,config,client,calls,customers,payments,notify,get store(){return app.store;},get origin(){return origin;},clock:()=>clock,advance:ms=>{clock+=ms;},customerTimeout:()=>{timeoutCustomer=true;},checkoutResponse:value=>{checkoutResponse=value;},async restart(disabled=false){await app.close();config.enabled=!disabled;await start();}});}finally{await app.close();}
}
const prepare=async(f,s)=>{assert.equal((await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true,...profileFixture})).status,200);const r=await s.req('asaas/orders',{sku:'quarterly',billingType:'PIX',confirmed:true});assert.equal(r.status,201,JSON.stringify(r));const id=r.data.orderId;assert.equal((await s.req('asaas/orders/'+id+'/checkout',{})).status,200);return f.store.get('SELECT * FROM commerce_orders WHERE id=?',id);};
const settle=async(f,a,o)=>{f.payments.set(o.checkout_id,[{id:'pay_'+o.id,customer:o.customer_id,externalReference:o.id,billingType:o.billing_type,value:o.amount_cents/100,status:'RECEIVED'}]);assert.equal(await f.notify(o),200);assert.equal((await a.req('asaas/process',{})).status,200);};

test('revision-3 profile refusal recovery needs corrected provider evidence and preserves the preceding history',async()=>fixture(async f=>{
 const s=f.client();await s.login('student');await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true,...profileFixture});
 const id=(await s.req('asaas/orders',{sku:'monthly',billingType:'PIX',confirmed:true})).data.orderId;
 f.checkoutResponse(()=>Response.json({errors:[{code:'invalid_object',description:'missing financial profile'}]},{status:400}));
 await s.req('asaas/orders/'+id+'/checkout',{});
 // Model the current live revision after its separately audited first recovery.
 f.store.run('UPDATE commerce_orders SET revision=3 WHERE id=?',id);
 const old=f.store.get('SELECT * FROM commerce_orders WHERE id=?',id),history=f.store.all('SELECT * FROM commerce_audit WHERE order_id=?',id),calls=f.calls.length;
 const evidence={logId:'89755343',orderId:id,externalReference:id,customerId:old.customer_id,accountId:old.account_id,environment:'sandbox',method:'POST',path:'/api/v3/checkouts',httpStatus:400,code:'invalid_object',reason:'missing-customer-profile',responseHasResource:false,reviewedLog:true,singleAttemptConfirmed:true,checkoutAbsenceBasis:'provider-validation-rejection',checkedAt:f.clock(),paymentsHttpStatus:200,paymentsComplete:true,paymentCount:0,activePixKey:true,customerProfileVerified:true,notificationDisabled:true,city:12565,rejectedFields:['phone','address','addressNumber','postalCode','province','city']};
 const args={store:asyncLocalStore(f.store),orderId:id,actorId:f.ids.admin,accountId:old.account_id,orgId:old.org_id,expectedRevision:3,expectedUpdatedAt:old.updated_at,evidence,now:f.clock};
 await assert.rejects(recoverRejectedCheckout({...args,expectedRevision:1}),{status:409});
 for(const change of [{customerProfileVerified:false},{notificationDisabled:false},{city:null},{city:'12565'},{rejectedFields:[]},{reason:'unknown'}])await assert.rejects(recoverRejectedCheckout({...args,evidence:{...evidence,...change}}),{status:409});
 assert.equal((await recoverRejectedCheckout(args)).dryRun,true);assert.equal(f.store.get('SELECT revision FROM commerce_orders WHERE id=?',id).revision,3);
 assert.equal((await recoverRejectedCheckout({...args,apply:true,approved:true})).rearmed,true);
 const next=f.store.get('SELECT * FROM commerce_orders WHERE id=?',id);assert.equal(next.revision,4);assert.equal(next.status,'pending');assert.equal(next.idempotency_key,old.idempotency_key);assert.equal(next.external_reference,old.external_reference);
 for(const row of history)assert.deepEqual(f.store.get('SELECT * FROM commerce_audit WHERE id=?',row.id),row);
 assert.equal((await recoverRejectedCheckout({...args,apply:true,approved:true})).alreadyRecorded,true);assert.equal(f.calls.length,calls);
}));

test('incomplete customer is repaired in place without checkout, new customer, recovery or access changes',async()=>fixture(async f=>{
 const s=f.client(),other=f.client();await s.login('student');await other.login('otherStudent');
 assert.equal((await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true})).status,400);assert.equal(f.calls.length,0);
 await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true,...profileFixture});
 const id=(await s.req('asaas/orders',{sku:'monthly',billingType:'PIX',confirmed:true})).data.orderId;
 const c=[...f.customers.values()][0];for(const field of ['phone','address','addressNumber','postalCode','province','city'])delete c[field];
 const original=f.store.get('SELECT * FROM commerce_orders WHERE id=?',id);
 assert.equal((await s.req('asaas/orders/'+id+'/checkout',{})).status,409);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/checkouts')).length,0);
 const account=(await s.req('asaas/account')).data;assert.equal(account.financialProfile.ready,false);assert.ok(account.financialProfile.missing.includes('city'));assert.ok(!JSON.stringify(account).includes('12345678909'));
 const input={...profileFixture,confirmed:true};
 assert.equal((await other.req('asaas/customer/profile',input,'PUT')).status,409);
 assert.equal((await s.req('asaas/customer/profile',{...input,city:3550308},'PUT')).status,400);
 assert.equal((await s.req('asaas/customer/profile',input,'PUT',{Origin:'https://evil.invalid'})).status,403);
 const fixed=await s.req('asaas/customer/profile',input,'PUT');assert.equal(fixed.status,200,JSON.stringify(fixed));assert.equal(fixed.data.financialProfile.ready,true);assert.equal(fixed.data.financialProfile.city,12565);
 assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/customers')).length,1);
 assert.deepEqual(f.store.get('SELECT * FROM commerce_orders WHERE id=?',id),original);
 assert.equal(f.store.get('SELECT COUNT(*) n FROM commerce_entitlements').n,0);assert.equal(f.store.get('SELECT COUNT(*) n FROM asaas_service_periods').n,0);
 assert.equal((await s.req('asaas/orders/'+id+'/checkout',{})).status,200);
 assert.equal((await s.req('asaas/customer/profile',input,'PUT')).status,409);
}));

test('profile checks fail closed on unresolved city, enabled notifications, changed identity and uncertain PUT',async()=>fixture(async f=>{
 const s=f.client();await s.login('student');await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true,...profileFixture});
 const id=(await s.req('asaas/orders',{sku:'monthly',billingType:'PIX',confirmed:true})).data.orderId;
 const c=[...f.customers.values()][0],oldEmail=c.email;
 for(const invalid of [{city:null},{city:'12565'},{notificationDisabled:false}]){
  const before={...c};Object.assign(c,invalid);assert.equal((await s.req('asaas/orders/'+id+'/checkout',{})).status,409);Object.assign(c,before);
 }
 c.email='other@fixture.invalid';assert.equal((await s.req('asaas/customer/profile',{...profileFixture,confirmed:true},'PUT')).status,409);c.email=oldEmail;
 const fetchImpl=f.config.fetchImpl;f.config.fetchImpl=async(url,options)=>{if(options.method==='PUT')throw Error('lost update response');return fetchImpl(url,options);};await f.restart();
 assert.equal((await s.req('asaas/customer/profile',{...profileFixture,confirmed:true},'PUT')).status,503);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/checkouts')).length,0);assert.equal(f.store.get('SELECT status FROM commerce_orders WHERE id=?',id).status,'pending');
}));

test('sandbox capability catalog comes from approved backend offers and contains no credentials',async()=>fixture(async f=>{
 for(const path of ['/local','/sim/persistent.js','/sim/commerce-ui.js','/sim/asaas-commerce-ui.js']){const asset=await fetch(f.origin+path);assert.equal(asset.status,200,path);assert.ok((await asset.text()).length>0);}
 const r=await f.client().req('commerce/capabilities');assert.equal(r.status,200);assert.equal(r.data.mode,'asaas-sandbox');assert.deepEqual(r.data.catalog.map(p=>[p.sku,p.amountCents,p.durationMonths]),[['monthly',49900,1],['quarterly',119700,3],['semiannual',179400,6]]);assert.deepEqual(r.data.catalog[0].billingTypes,['PIX','CREDIT_CARD']);assert.ok(!JSON.stringify(r.data).includes(apiKey));assert.ok(!JSON.stringify(r.data).includes(webhookToken));assert.equal(f.calls.length,0);
 assert.equal((await f.client().req('asaas/orders',{sku:'monthly',billingType:'PIX',confirmed:true})).status,401);
 await f.restart(true);const disabled=(await f.client().req('commerce/capabilities')).data;assert.equal(disabled.enabled,false);assert.equal(disabled.mode,undefined);
}));

test('real HTTP sessions, durable customer, authenticated webhook, clinical intake and first publication connect end to end',async()=>fixture(async f=>{
 const s=f.client(),a=f.client(),c=f.client(),other=f.client();for(const [x,role] of [[s,'student'],[a,'admin'],[c,'coach'],[other,'otherStudent']])assert.equal((await x.login(role)).status,200);
 assert.equal((await f.client().req('asaas/account')).status,401);assert.equal((await s.req('students')).status,403);const o=await prepare(f,s);
 assert.equal((await s.req('students')).status,403);assert.equal((await other.req('asaas/orders/'+o.id+'/checkout',{})).status,401);assert.equal(await f.notify(o,'CHECKOUT_PAID','wrong'),401);
 assert.equal((await s.req('asaas/process',{})).status,401);assert.equal((await s.req('asaas/orders/'+o.id+'/checkout',{},'POST',{Origin:'https://evil.invalid'})).status,403);
 await settle(f,a,o);let account=(await s.req('asaas/account')).data;assert.equal(account.orders[0].period,null);assert.equal((await s.req('students')).status,200);assert.equal((await s.req('students/'+f.ids.studentRecord+'/plans')).status,403);
 const intake='students/'+f.ids.studentRecord+'/anamnesis';assert.equal((await s.req(intake,{version:INTAKE_VERSION,revision:0,answers:fullIntakeAnswers(),consentVersion:CONSENT_VERSION,consents:{training:true,nutrition:false}},'PUT')).status,200);
 assert.equal((await s.req(intake+'/complete',{version:INTAKE_VERSION,revision:1,confirmed:true})).status,201);assert.equal((await c.req(intake+'/review',{version:INTAKE_VERSION,revision:1,confirmed:true})).status,200);
 const draft=await c.req('students/'+f.ids.studentRecord+'/plans',{title:'Sandbox reviewed plan',exercises:[{name:'Synthetic movement',sets:3,reps:10}]});assert.equal(draft.status,201);let plan=draft.data.plan;
 for(const action of ['submit','approve']){const r=await c.req('plans/'+plan.id+'/'+action,{revision:plan.revision});assert.equal(r.status,200,JSON.stringify(r));plan=r.data.plan;}
 assert.equal((await c.req('plans/'+plan.id+'/publish',{revision:plan.revision})).status,409);assert.equal(f.store.get('SELECT status FROM plans WHERE id=?',plan.id).status,'approved');
 assert.equal((await c.req('asaas/orders/'+o.id+'/protocol',{planId:plan.id})).status,200);f.advance(8*86400000);
 f.store.exec("CREATE TRIGGER sandbox_audit_failure BEFORE INSERT ON commerce_audit WHEN NEW.event='commerce.protocol.first-release' BEGIN SELECT RAISE(ABORT,'atomic test'); END");
assert.equal((await c.req('plans/'+plan.id+'/publish',{revision:plan.revision})).status,500);assert.equal(f.store.get('SELECT status FROM plans WHERE id=?',plan.id).status,'approved');assert.equal(f.store.get('SELECT COUNT(*) n FROM asaas_service_periods').n,0);f.store.exec('DROP TRIGGER sandbox_audit_failure');
const body={revision:plan.revision},key=randomUUID();const results=await Promise.all([c.req('plans/'+plan.id+'/publish',body,'POST',{'Idempotency-Key':key}),c.req('plans/'+plan.id+'/publish',body,'POST',{'Idempotency-Key':key})]);assert.deepEqual(results.map(r=>r.status),[200,200]);
 account=(await s.req('asaas/account')).data;assert.equal(account.orders[0].period.starts_at,f.clock());assert.equal(account.orders[0].refundWindow.status,'outside_window');assert.equal((await s.req('students/'+f.ids.studentRecord+'/plans')).status,200);const saved=account.orders[0].period;
 await f.restart();assert.deepEqual((await s.req('asaas/account')).data.orders[0].period,saved);await f.notify(o);await a.req('asaas/process',{});assert.equal(f.store.get('SELECT COUNT(*) n FROM asaas_service_periods').n,1);
 assert.equal((await s.req('asaas/orders/'+o.id+'/request',{kind:'refund',confirmed:true})).status,202);assert.equal((await other.req('asaas/orders/'+o.id+'/request',{kind:'refund',confirmed:true})).status,401);
 const renewal=await prepare(f,s);await settle(f,a,renewal);assert.equal((await s.req('asaas/orders',{sku:'monthly',billingType:'PIX',confirmed:true})).status,409);
 let next=(await c.req('students/'+f.ids.studentRecord+'/plans',{title:'Renewal protocol',exercises:[{name:'Synthetic renewal',sets:2,reps:8}]})).data.plan;
for(const action of ['submit','approve'])next=(await c.req('plans/'+next.id+'/'+action,{revision:next.revision})).data.plan;
assert.equal((await c.req('asaas/orders/'+renewal.id+'/protocol',{planId:next.id})).status,200);
assert.equal((await c.req('plans/'+next.id+'/publish',{revision:next.revision})).status,200);
const renewed=f.store.get('SELECT * FROM asaas_service_periods WHERE order_id=?',renewal.id);assert.equal(renewed.starts_at,saved.ends_at);assert.ok(renewed.ends_at>renewed.starts_at);assert.equal((await s.req('asaas/account')).data.orders[1].refundWindow.status,'within_window');
assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/customers')).length,1);assert.equal(f.calls.find(c=>c.url.endsWith('/customers')&&c.method==='POST').body.notificationDisabled,true);
}));

test('uncertain customer creation never repeats POST; reference recovery uses matching authenticated identity',async()=>fixture(async f=>{const s=f.client();await s.login('student');f.customerTimeout();assert.equal((await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true,...profileFixture})).status,503);await f.restart();assert.equal((await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true,...profileFixture})).status,409);assert.equal((await s.req('asaas/customer/recover',{cpfCnpj:'00000000000'})).status,409);assert.equal((await s.req('asaas/customer/recover',{cpfCnpj:'12345678909'})).status,200);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);}));

test('normal application stays inert and sandbox cannot use production or mismatched account scope',async()=>fixture(async f=>{await assert.rejects(()=>asaasRuntime({store:f.store,security:{production:true},configuration:f.config}),{status:503});await assert.rejects(()=>asaasRuntime({store:f.store,security:{production:false},configuration:{...f.config,accountId:'other'}}),{status:503});assert.equal(await asaasRuntime({configuration:{}}),null);assert.throws(()=>applyAsaasRuntimeSchema(f.store,{isolatedSandbox:false}));}));

test('dedicated HTTPS sandbox keeps reviewer/proxy/origin restrictions while token-authenticated webhook accepts provider IP',async()=>fixture(async f=>{
 const s=f.client(),a=f.client();assert.equal((await s.login('student')).status,200);await a.login('admin');const o=await prepare(f,s);await settle(f,a,o);
 assert.equal((await s.req('asaas/account',undefined,'GET',{'x-forwarded-for':'198.51.100.20'})).status,403);
 assert.equal((await s.req('asaas/account',undefined,'GET',{'x-forwarded-proto':'http'})).status,403);
 assert.equal((await s.req('asaas/orders/'+o.id+'/checkout',{},'POST',{Origin:'https://foreign.example.test'})).status,403);
 assert.equal(await f.notify(o,'CHECKOUT_PAID','invalid'),401);
},{proxy:true}));

test('qualified nutrition publication can start the same first-release period through its real handler',async()=>fixture(async f=>{
 const s=f.client(),a=f.client(),c=f.client(),n=f.client();for(const [x,role] of [[s,'student'],[a,'admin'],[c,'coach'],[n,'nutrition']])await x.login(role);
 const o=await prepare(f,s);await settle(f,a,o);const intake='students/'+f.ids.studentRecord+'/anamnesis';
 await s.req(intake,{version:INTAKE_VERSION,revision:0,answers:fullIntakeAnswers(),consentVersion:CONSENT_VERSION,consents:{training:true,nutrition:true}},'PUT');await s.req(intake+'/complete',{version:INTAKE_VERSION,revision:1,confirmed:true});await c.req(intake+'/review',{version:INTAKE_VERSION,revision:1,confirmed:true});
 assert.equal((await a.req('nutrition/credentials',{userId:f.ids.nutrition,registration:'SYNTHETIC TEST ONLY',verified:true,checkedRegistration:true,revision:0},'PUT')).status,200);
 let food=(await n.req('nutrition/foods',{name:'Synthetic composition',preparation:'cooked',per100g:{energyKcal:120,proteinG:10,carbsG:15,fatG:2},allergens:[],mayContain:[],provenance:{source:'Synthetic fixture',reference:'Not a real diet',version:'1'}})).data.food;
 food=(await n.req('nutrition/foods/'+food.id+'/approve',{revision:1,sourceVerified:true})).data.food;
 let plan=(await n.req('students/'+f.ids.studentRecord+'/nutrition',{title:'Synthetic reviewed nutrition',allergies:[],allergiesChecked:true,meals:[{name:'Synthetic meal',items:[{foodId:food.id,grams:150,alternatives:[]}]}]})).data.plan;assert.ok(plan);
 for(const action of ['submit','approve']){const r=await n.req('nutrition/plans/'+plan.id+'/'+action,{revision:plan.revision,...(action==='approve'?{reviewed:true}:{})});assert.equal(r.status,200);plan=r.data.plan;}
 assert.equal((await c.req('asaas/orders/'+o.id+'/protocol',{planId:plan.id,kind:'nutrition'})).status,403);
 assert.equal((await n.req('asaas/orders/'+o.id+'/protocol',{planId:plan.id,kind:'nutrition'})).status,200);
 const result=await n.req('nutrition/plans/'+plan.id+'/publish',{revision:plan.revision});assert.equal(result.status,200,JSON.stringify(result));
 const period=f.store.get('SELECT * FROM asaas_service_periods');assert.equal(period.nutrition_plan_id,plan.id);assert.equal(period.plan_id,null);assert.equal(period.starts_at,f.clock());
}));

test('existing admin invitation activates a new sandbox identity without granting unpaid service',async()=>fixture(async f=>{
 const a=f.client(),s=f.client();await a.login('admin');const made=await a.req('students',{name:'Synthetic new buyer',email:'newbuyer@fixture.invalid'});assert.equal(made.status,201);const id=made.data.student.id;
 const invite=await a.req('invitations',{kind:'student',studentId:id,email:'newbuyer@fixture.invalid',name:'Synthetic new buyer',professionalRole:null,verifiedDelivery:true});assert.equal(invite.status,201);
 assert.equal((await s.req('activate',{token:invite.data.token,email:'newbuyer@fixture.invalid',password:FIXTURE_PASSWORD})).status,201);
 assert.equal((await s.req('login',{email:'newbuyer@fixture.invalid',password:FIXTURE_PASSWORD})).status,200);assert.equal((await s.req('students')).status,403);
 assert.equal((await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true,...profileFixture})).status,200);assert.equal((await s.req('students')).status,403);
 assert.equal((await s.req('activate',{token:invite.data.token,email:'newbuyer@fixture.invalid',password:FIXTURE_PASSWORD})).status,400);await f.restart(true);assert.equal((await s.req('students')).status,403);
}));


test('definitive checkout refusal preserves order, audit and idempotency without another provider POST',async()=>fixture(async f=>{
 const s=f.client();await s.login('student');
 await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true,...profileFixture});
 const body={sku:'monthly',billingType:'PIX',confirmed:true},headers={'Idempotency-Key':'refusal-fixture'};
 const created=await s.req('asaas/orders',body,'POST',headers),id=created.data.orderId;
 f.checkoutResponse(()=>Response.json({errors:[{code:'invalid_object',description:'PRIVATE provider detail must never be stored'}]},{status:400}));
 const result=await s.req('asaas/orders/'+id+'/checkout',{});assert.equal(result.status,422);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 const order=f.store.get('SELECT * FROM commerce_orders WHERE id=?',id);assert.equal(order.status,'review');assert.equal(order.checkout_state,'new');assert.equal(order.checkout_id,null);
 assert.equal((await s.req('asaas/orders',body,'POST',headers)).data.orderId,id);
 await f.restart();await s.login('student');
 const retries=await Promise.all([s.req('asaas/orders/'+id+'/checkout',{}),s.req('asaas/orders/'+id+'/checkout',{})]);assert.deepEqual(retries.map(r=>r.status),[409,409]);
 assert.equal((await s.req('asaas/orders',body)).status,409);
 assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/checkouts')).length,1);
 const audit=f.store.all('SELECT event FROM commerce_audit WHERE order_id=?',id);assert.equal(audit.filter(r=>r.event==='commerce.checkout.rejected.http400.invalid_object').length,1);assert.ok(!JSON.stringify(audit).includes('PRIVATE'));
 assert.equal(f.store.get('SELECT COUNT(*) n FROM commerce_orders').n,1);assert.equal(f.store.get('SELECT COUNT(*) n FROM commerce_entitlements').n,0);
 assert.equal(f.store.get('SELECT COUNT(*) n FROM commerce_tasks WHERE order_id=? AND kind=?',id,'financial-review').n,1);
}));

test('lost checkout response remains unknown and can recover only through authenticated matching webhook',async()=>fixture(async f=>{
 const s=f.client(),a=f.client();await s.login('student');await a.login('admin');
 await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true,...profileFixture});
 const id=(await s.req('asaas/orders',{sku:'monthly',billingType:'PIX',confirmed:true})).data.orderId;
 f.checkoutResponse(()=>{throw Error('lost response after possible provider creation');});
 assert.equal((await s.req('asaas/orders/'+id+'/checkout',{})).status,503);
 let o=f.store.get('SELECT * FROM commerce_orders WHERE id=?',id);assert.equal(o.status,'pending');assert.equal(o.checkout_state,'unknown');
 assert.equal((await s.req('asaas/orders/'+id+'/checkout',{})).status,409);
 o={...o,checkout_id:'checkout_recovered'};
 assert.equal(await f.notify(o,'CHECKOUT_CREATED','wrong'),401);assert.equal(await f.notify(o,'CHECKOUT_CREATED'),200);
 await a.req('asaas/process',{});
 assert.equal(f.store.get('SELECT checkout_state FROM commerce_orders WHERE id=?',id).checkout_state,'ready');
 assert.equal((await s.req('asaas/orders/'+id+'/checkout',{})).status,200);
 assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/checkouts')).length,1);
 assert.equal(f.store.get('SELECT COUNT(*) n FROM commerce_entitlements').n,0);
}));


test('operator recovery is dry by default, evidence-bound, atomic and single-use without provider writes',async()=>fixture(async f=>{
 const s=f.client();await s.login('student');await s.req('asaas/customer',{cpfCnpj:'12345678909',confirmed:true,...profileFixture});
 const body={sku:'monthly',billingType:'PIX',confirmed:true},headers={'Idempotency-Key':'recover-original'};
 const id=(await s.req('asaas/orders',body,'POST',headers)).data.orderId;
 f.checkoutResponse(()=>{throw Error('old deployment discarded refusal details');});await s.req('asaas/orders/'+id+'/checkout',{});
 const old=f.store.get('SELECT * FROM commerce_orders WHERE id=?',id),store=asyncLocalStore(f.store),calls=f.calls.length;
 const evidence={logId:'12345',orderId:id,externalReference:old.external_reference,customerId:old.customer_id,accountId:old.account_id,environment:'sandbox',method:'POST',path:'/api/v3/checkouts',httpStatus:400,code:'invalid_object',reason:'missing-pix-key',responseHasResource:false,reviewedLog:true,singleAttemptConfirmed:true,checkoutAbsenceBasis:'provider-validation-rejection',checkedAt:f.clock(),paymentsHttpStatus:200,paymentsComplete:true,paymentCount:0,activePixKey:true};
 const args={store,orderId:id,actorId:f.ids.admin,accountId:old.account_id,orgId:old.org_id,expectedRevision:old.revision,expectedUpdatedAt:old.updated_at,evidence,now:f.clock};
 assert.equal((await recoverRejectedCheckout(args)).dryRun,true);assert.equal(f.store.get('SELECT checkout_state FROM commerce_orders WHERE id=?',id).checkout_state,'unknown');
 await assert.rejects(recoverRejectedCheckout({...args,apply:true}),e=>e.status===403);
 for(const change of [{paymentCount:1},{paymentsComplete:false},{paymentsHttpStatus:500},{activePixKey:false},{checkedAt:f.clock()-60001},{responseHasResource:true},{singleAttemptConfirmed:false},{httpStatus:503},{customerId:'other'},{checkoutAbsenceBasis:'empty-payment-list'}])await assert.rejects(recoverRejectedCheckout({...args,evidence:{...evidence,...change},apply:true,approved:true}),e=>e.status===409);
 await assert.rejects(recoverRejectedCheckout({...args,actorId:f.ids.student}),e=>e.status===409);
 await assert.rejects(recoverRejectedCheckout({...args,expectedRevision:old.revision+1}),e=>e.status===409);
 await f.notify({...old,checkout_id:'unexpected'},'CHECKOUT_CREATED');await assert.rejects(recoverRejectedCheckout(args),e=>e.status===409);f.store.run('DELETE FROM commerce_events');
 f.store.exec("CREATE TRIGGER recovery_audit_failure BEFORE INSERT ON commerce_audit WHEN NEW.event LIKE 'commerce.checkout.recovery-evidence:%' BEGIN SELECT RAISE(ABORT,'atomic recovery test'); END");
 await assert.rejects(recoverRejectedCheckout({...args,apply:true,approved:true}));assert.equal(f.store.get('SELECT revision FROM commerce_orders WHERE id=?',id).revision,old.revision);assert.equal(f.store.get('SELECT COUNT(*) n FROM commerce_audit WHERE event=?','commerce.checkout.retry-authorized:12345').n,0);f.store.exec('DROP TRIGGER recovery_audit_failure');
 const results=await Promise.all([recoverRejectedCheckout({...args,apply:true,approved:true}),recoverRejectedCheckout({...args,apply:true,approved:true})]);assert.equal(results.filter(r=>r.rearmed).length,1);assert.equal(results.filter(r=>r.alreadyRecorded).length,1);
 const ready=f.store.get('SELECT * FROM commerce_orders WHERE id=?',id);assert.equal(ready.checkout_state,'new');assert.equal(ready.status,'pending');assert.equal(ready.idempotency_key,old.idempotency_key);assert.equal(ready.external_reference,old.external_reference);assert.equal(ready.revision,old.revision+1);assert.equal(f.calls.length,calls);
 assert.equal((await s.req('asaas/orders',body,'POST',headers)).data.orderId,id);assert.equal(f.store.get('SELECT COUNT(*) n FROM commerce_orders').n,1);assert.equal(f.store.get('SELECT COUNT(*) n FROM commerce_entitlements').n,0);
}));
