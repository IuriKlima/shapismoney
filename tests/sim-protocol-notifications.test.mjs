import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';
import {seedReviewedIntake} from './intake-test-fixtures.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {openLocalStore} from '../backend/store.mjs';
import {asyncLocalStore} from '../backend/async-store.mjs';
import {PROTOCOL_NOTICE_MARKER,protocolMailConfiguration,protocolNotificationFlow} from '../backend/protocol-notifications.mjs';

async function fixture(work,{enabled=true,wrapStore}={}){
  const f=await isolatedFixture(),messages=[];
  await seedReviewedIntake(f.store,f.ids.studentRecord,f.ids.coach);
  let clock=Date.parse('2026-11-10T12:00:00Z'),app,origin;
  const configuration={enabled,reviewed:true,publicOrigin:'https://shape.example.test',autoDispatch:false,transport:{kind:'mock',send:async m=>{messages.push(m);return {accepted:true};}}};
  async function start(){app=await createLocalServer({store:wrapStore?wrapStore(f.store):f.store,protocolEmail:configuration,now:()=>clock,loginLimit:40});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+app.server.address().port;}
  await start();
  const client=()=>{let cookie='';return {async req(route,body,method='POST',key=randomUUID(),headers={}){
    const r=await fetch(origin+'/api/local/'+route,{method:body===undefined?'GET':method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,Cookie:cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});
    if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};
  },login(role){return this.req('login',{email:role.toLowerCase()+'@fixture.invalid',password:FIXTURE_PASSWORD});}};};
  const actor=f.store.get('SELECT * FROM users WHERE id=?',f.ids.coach);
  const records=()=>f.store.all('SELECT * FROM operations WHERE request_hash=?',PROTOCOL_NOTICE_MARKER);
  try{await work({...f,configuration,messages,client,records,get app(){return app;},get now(){return clock;},advance:ms=>clock+=ms,restart:async()=>{await app.close();f.store=openLocalStore(f.filename);await start();},actor});}
  finally{await app.close();rmSync(f.directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
async function training(c,sid,{publish=true}={}){
  let r=await c.req('students/'+sid+'/plans',{title:'SECRET clinical title never emailed',exercises:[{name:'SECRET clinical exercise',sets:2,reps:8}]});assert.equal(r.status,201);let p=r.data.plan;
  for(const action of ['submit','approve',...(publish?['publish']:[])]){r=await c.req('plans/'+p.id+'/'+action,{revision:p.revision});assert.equal(r.status,200,JSON.stringify(r));p=r.data.plan;}
  return p;
}
async function nutrition(a,n,sid,nid){
  assert.equal((await a.req('nutrition/credentials',{userId:nid,registration:'FICTITIOUS ONLY',verified:true,checkedRegistration:true,revision:0},'PUT')).status,200);
  let r=await n.req('nutrition/foods',{name:'SECRET synthetic food',preparation:'cooked',per100g:{energyKcal:120,proteinG:10,carbsG:15,fatG:2},allergens:[],mayContain:[],provenance:{source:'Synthetic fixture',reference:'No real food',version:'1'}});assert.equal(r.status,201);
  r=await n.req('nutrition/foods/'+r.data.food.id+'/approve',{revision:1,sourceVerified:true});assert.equal(r.status,200);
  let p=(await n.req('students/'+sid+'/nutrition',{title:'SECRET diet title',allergies:[],allergiesChecked:true,meals:[{name:'SECRET meal',items:[{foodId:r.data.food.id,grams:150,alternatives:[]}]}]})).data.plan;
  for(const action of ['submit','approve','publish']){r=await n.req('nutrition/plans/'+p.id+'/'+action,{revision:p.revision,...(action==='approve'?{reviewed:true}:{})});assert.equal(r.status,200,JSON.stringify(r));p=r.data.plan;}
  return p;
}

test('publication records a durable notice atomically; duplicate publication creates no second notice/email; read survives restart',async()=>fixture(async f=>{
  const c=f.client(),s=f.client();await c.login('coach');await s.login('student');let p=await training(c,f.ids.studentRecord,{publish:false});
  assert.equal(f.records().length,0);assert.deepEqual((await s.req('notifications')).data.notifications,[]);
  const key=randomUUID(),body={revision:p.revision};const published=await c.req('plans/'+p.id+'/publish',body,'POST',key);assert.equal(published.status,200);p=published.data.plan;
  assert.equal(f.records().length,1);assert.equal(f.messages.length,0);
  assert.deepEqual((await c.req('plans/'+p.id+'/publish',body,'POST',key)).data,published.data);assert.equal(f.records().length,1);
  const notice=(await s.req('notifications')).data.notifications[0];assert.equal(notice.planId,p.id);assert.equal(notice.kind,'training');assert.equal(notice.readAt,null);
  await f.restart();await f.app.flushProtocolEmail();assert.equal(f.messages.length,1);assert.equal(f.messages[0].to,'student@fixture.invalid');assert.ok(f.messages[0].text.includes('https://shape.example.test/local'));
  assert.ok(!JSON.stringify(f.messages).includes('SECRET'));assert.ok(!JSON.stringify(f.records()).includes('SECRET'));assert.ok(!JSON.stringify(f.records()).includes('student@fixture.invalid'));
  assert.equal((await s.req('notifications/'+notice.id+'/read',{confirmed:true})).status,200);await f.app.flushProtocolEmail();assert.equal(f.messages.length,1);
  await f.restart();assert.equal((await s.req('notifications')).data.unread,0);assert.equal((await s.req('notifications')).data.notifications[0].emailState,'accepted');
}));

test('notification write failure rolls back publication and audit; retry can publish without partial success',async()=>{
  let fail=true;
  await fixture(async f=>{const c=f.client();await c.login('coach');const p=await training(c,f.ids.studentRecord,{publish:false});const r=await c.req('plans/'+p.id+'/publish',{revision:p.revision});assert.equal(r.status,500);assert.equal(f.store.get('SELECT status FROM plans WHERE id=?',p.id).status,'approved');assert.equal(f.records().length,0);assert.equal(f.store.get("SELECT COUNT(*) n FROM audit WHERE event='plan.publish'").n,0);fail=false;assert.equal((await c.req('plans/'+p.id+'/publish',{revision:p.revision})).status,200);assert.equal(f.records().length,1);},{wrapStore:raw=>{const adapter=asyncLocalStore(raw);return {...adapter,kind:'postgres',run:async(sql,...args)=>{if(fail&&sql==='INSERT INTO operations VALUES (?,?,?,?,?)'&&args[2]===PROTOCOL_NOTICE_MARKER)throw Error('Injected rollback fixture');return adapter.run(sql,...args);}};}});
});

test('nutrition publication emits one notice; role/tenant isolation, CSRF and feature revocation apply',async()=>fixture(async f=>{
  const a=f.client(),n=f.client(),s=f.client(),other=f.client(),outsider=f.client();for(const [c,r] of [[a,'admin'],[n,'nutrition'],[s,'student'],[other,'otherStudent'],[outsider,'outsider']])await c.login(r);
  const p=await nutrition(a,n,f.ids.studentRecord,f.ids.nutrition);const notice=(await s.req('notifications')).data.notifications[0];assert.equal(notice.kind,'nutrition');assert.equal(notice.planId,p.id);assert.equal(f.records().length,1);
  assert.deepEqual((await other.req('notifications')).data.notifications,[]);assert.equal((await other.req('notifications/'+notice.id+'/read',{confirmed:true})).status,404);assert.equal((await a.req('notifications')).status,403);
  assert.equal((await outsider.req('students/'+f.ids.studentRecord+'/notifications')).status,403);assert.equal((await n.req('students/'+f.ids.studentRecord+'/notifications')).status,403);
  assert.equal((await s.req('notifications/'+notice.id+'/read',{confirmed:true},'POST',randomUUID(),{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await a.req('students/'+f.ids.studentRecord+'/access',{level:'training',expiresAt:null,enabled:true,sequence:0,confirmed:true},'PUT')).status,200);
  await f.app.flushProtocolEmail();assert.equal(f.messages.length,0);assert.deepEqual((await s.req('notifications')).data.notifications,[]);
  assert.equal((await s.req('notifications/'+notice.id+'/read',{confirmed:true})).status,404);assert.equal((await a.req('students/'+f.ids.studentRecord+'/notifications')).data.notifications[0].emailState,'cancelled');
}));

test('disabled email leaves the in-app notice available without pretending dispatch or retroactively sending',async()=>fixture(async f=>{
  const c=f.client(),s=f.client();await c.login('coach');await s.login('student');await training(c,f.ids.studentRecord);await f.app.flushProtocolEmail();
  assert.equal(f.messages.length,0);assert.equal((await s.req('notifications')).data.notifications[0].emailState,'disabled');
  f.configuration.enabled=true;await f.app.flushProtocolEmail();assert.equal(f.messages.length,0);
},{enabled:false}));

test('changed recipient, expired access and deactivated identity cancel queued emails',async()=>fixture(async f=>{
  const c=f.client();await c.login('coach');await training(c,f.ids.studentRecord);
  f.store.run('UPDATE users SET email=? WHERE id=?','changed@fixture.invalid',f.ids.student);await f.app.flushProtocolEmail();assert.equal(f.messages.length,0);assert.equal(JSON.parse(f.records()[0].result).emailState,'cancelled');
  f.store.run('UPDATE users SET email=?,active=0 WHERE id=?','student@fixture.invalid',f.ids.student);await training(c,f.ids.studentRecord);assert.equal(JSON.parse(f.records().at(-1).result).emailState,'recipient-unavailable');await f.app.flushProtocolEmail();assert.equal(f.messages.length,0);
  f.store.run('UPDATE users SET active=1 WHERE id=?',f.ids.student);const a=f.client();await a.login('admin');await a.req('students/'+f.ids.studentRecord+'/access',{level:'training',expiresAt:f.now+1000,enabled:true,sequence:0,confirmed:true},'PUT');await training(c,f.ids.studentRecord);f.advance(2000);await f.app.flushProtocolEmail();assert.equal(f.messages.length,0);assert.equal(JSON.parse(f.records().at(-1).result).emailState,'cancelled');
}));

test('provider failure is unknown delivery, diagnostics are discarded, interrupted lease is not retried',async()=>fixture(async f=>{
  const c=f.client();await c.login('coach');await training(c,f.ids.studentRecord);let calls=0;
  f.configuration.transport.send=async()=>{calls++;throw Error('SECRET provider details');};await f.app.flushProtocolEmail();await f.app.flushProtocolEmail();assert.equal(calls,1);assert.equal(JSON.parse(f.records()[0].result).emailState,'delivery-unknown');assert.ok(!JSON.stringify(f.records()).includes('SECRET'));
  await training(c,f.ids.studentRecord);const r=f.records().at(-1),v=JSON.parse(r.result);f.store.run('UPDATE operations SET status=102,result=? WHERE actor_id=? AND operation_key=?',JSON.stringify({...v,emailState:'sending',leaseUntil:f.now+1000}),r.actor_id,r.operation_key);
  await f.restart();f.advance(2000);await f.app.flushProtocolEmail();assert.equal(calls,1);assert.equal(JSON.parse(f.records().at(-1).result).emailState,'delivery-unknown');
}));

test('separate runtime opt-in fails closed, and production refuses injected mock transport',async()=>{
  assert.deepEqual(protocolMailConfiguration({},{}),{});assert.throws(()=>protocolMailConfiguration({SIM_PROTOCOL_EMAIL_ENABLED:'true'},{}));
  const config={enabled:true,reviewed:true,transport:{kind:'mock'}};assert.deepEqual(protocolMailConfiguration({SIM_PROTOCOL_EMAIL_ENABLED:'true',SIM_PROTOCOL_EMAIL_REVIEWED:'true'},config),config);
  const flow=protocolNotificationFlow({security:{production:true,origin:'https://shape.example.test'},configuration:{...config,publicOrigin:'https://shape.example.test'}});assert.equal(flow.available(),false);await flow.close();
});
