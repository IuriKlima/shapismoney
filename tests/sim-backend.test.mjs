import test from 'node:test';
import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createLocalServer} from '../backend/server.mjs';
import {openLocalStore} from '../backend/store.mjs';
import {verifyPassword} from '../backend/auth.mjs';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';
async function setup(options={}){
  const fixture=await isolatedFixture();let app=await createLocalServer({store:fixture.store,...options});let url;
  const listen=async()=>{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+app.server.address().port;};await listen();
  const client=()=>{let cookie='';return {async request(route,body,method='POST',headers={}){const response=await fetch(url+'/api/local/'+route,{method:body===undefined?'GET':method,headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:url,'Idempotency-Key':randomUUID()}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:response.status,data:await response.json(),headers:response.headers};},login(role){return this.request('login',{email:role.toLowerCase()+'@fixture.invalid',password:FIXTURE_PASSWORD});}};};
  return {...fixture,client,async restart(){await app.close();app=await createLocalServer({filename:fixture.filename,...options});await listen();},async close(){await app.close();rmSync(fixture.directory,{recursive:true,force:true});},get url(){return url;},get store(){return app.store;}};
}
async function withFixture(run,options){const f=await setup(options);try{await run(f);}finally{await f.close();}}
test('senha scrypt com sal; sessão HttpOnly/SameSite, expiração, logout e rate limit',async()=>{
  let clock=Date.now();await withFixture(async f=>{
    const c=f.client();const hash=f.store.get('SELECT password_hash FROM users WHERE id=?',f.ids.coach).password_hash;assert.ok(hash.startsWith('scrypt$32768$8$1$'));assert.equal(await verifyPassword('wrong-password',hash),false);
    assert.equal((await c.request('session')).status,401);const login=await c.login('coach');assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);assert.ok(!JSON.stringify(login.data).includes('password'));
    assert.equal((await c.request('session')).status,200);clock+=1100;assert.equal((await c.request('session')).status,401);assert.equal((await c.login('coach')).status,200);assert.equal((await c.request('logout',{})).status,200);assert.equal((await c.request('session')).status,401);
    const denied=f.client();for(let i=0;i<6;i++)assert.equal((await denied.request('login',{email:'missing@fixture.invalid',password:'wrong-password'})).status,401);assert.equal((await denied.login('coach')).status,429);
  },{now:()=>clock,sessionMs:1000,loginLimit:8});
});
test('isolamento por aluno, papel e tenant; notas internas nunca retornam ao aluno',async()=>withFixture(async f=>{
  const student=f.client(),coach=f.client(),otherCoach=f.client(),nutrition=f.client(),outsider=f.client(),otherStudent=f.client();for(const [c,r] of [[student,'student'],[coach,'coach'],[otherCoach,'otherCoach'],[nutrition,'nutrition'],[outsider,'outsider'],[otherStudent,'otherStudent']])assert.equal((await c.login(r)).status,200);
  const own=await student.request('students');assert.equal(own.data.students.length,1);assert.equal(own.data.students[0].id,f.ids.studentRecord);assert.ok(!JSON.stringify(own.data).includes('INTERNO'));assert.ok(!Object.hasOwn(own.data.students[0],'internalNote'));
  for(const c of [student,coach,nutrition,outsider])assert.equal((await c.request('students/'+f.ids.otherRecord)).status,404);assert.equal((await otherCoach.request('students/'+f.ids.studentRecord)).status,404);assert.equal((await otherStudent.request('students/'+f.ids.studentRecord)).status,404);
  assert.equal((await nutrition.request('students')).data.students.length,1);assert.match((await coach.request('students/'+f.ids.studentRecord)).data.student.internalNote,/INTERNO/);
  const data={name:'Fictício Novo',email:'new@fixture.invalid',internalNote:'Nota de teste'};for(const c of [student,nutrition])assert.equal((await c.request('students',data)).status,403);assert.equal((await student.request('audit')).status,403);
  assert.equal((await student.request('students',{...data,role:'admin'})).status,403);assert.equal((await coach.request('students',{...data,role:'admin'})).status,400);
},{loginLimit:30}));
test('cadastro validado, dedup/idempotência/auditoria e persistência após reiniciar',async()=>withFixture(async f=>{
  const c=f.client();await c.login('coach');const key=randomUUID(),data={name:'Aluno Cadastro Fictício',email:' NEW@FIXTURE.INVALID ',internalNote:'Nota interna'};
  const created=await c.request('students',data,'POST',{'Idempotency-Key':key});assert.equal(created.status,201);assert.equal(created.data.accountProvisioned,false);const id=created.data.student.id;
  assert.deepEqual((await c.request('students',data,'POST',{'Idempotency-Key':key})).data,created.data);assert.equal((await c.request('students',{...data,name:'Outro pedido'},'POST',{'Idempotency-Key':key})).status,409);assert.equal((await c.request('students',{...data,email:'new@fixture.invalid'})).status,409);
  const audit=await c.request('audit');assert.equal(audit.data.audit.filter(a=>a.event==='student.created'&&a.student_id===id).length,1);assert.equal(f.store.get('SELECT COUNT(*) AS count FROM users').count,7);
  await f.restart();assert.equal((await c.request('session')).status,200);assert.equal((await c.request('students/'+id)).data.student.name,data.name);assert.equal(f.store.get('SELECT COUNT(*) AS count FROM schema_migrations').count,1);
}));
test('onboarding salva no servidor; revisão antes de publicar e aluno só vê aprovado/publicado',async()=>withFixture(async f=>{
  const c=f.client(),s=f.client(),n=f.client(),other=f.client();for(const [client,role] of [[c,'coach'],[s,'student'],[n,'nutrition'],[other,'otherStudent']])await client.login(role);
  const onboarding={goal:'Condicionamento',days:3,experience:'Iniciante',context:'Rotina inteiramente fictícia',revision:1};assert.equal((await s.request('onboarding',onboarding,'PUT')).status,200);assert.equal((await s.request('onboarding',onboarding,'PUT')).status,409);assert.equal((await c.request('onboarding',onboarding,'PUT')).status,403);
  const input={title:'Treino fictício Base',exercises:[{name:'Exercício de exemplo',sets:3,reps:10}]};assert.equal((await s.request('students/'+f.ids.studentRecord+'/plans',input)).status,403);assert.equal((await n.request('students/'+f.ids.studentRecord+'/plans',input)).status,403);
  let plan=(await c.request('students/'+f.ids.studentRecord+'/plans',input)).data.plan;assert.equal(plan.status,'draft');assert.equal((await s.request('students/'+f.ids.studentRecord+'/plans')).data.plans.length,0);assert.equal((await c.request('plans/'+plan.id+'/publish',{revision:plan.revision})).status,409);
  for(const action of ['submit','approve','publish']){assert.equal((await s.request('plans/'+plan.id+'/'+action,{revision:plan.revision})).status,403);const result=await c.request('plans/'+plan.id+'/'+action,{revision:plan.revision});assert.equal(result.status,200);plan=result.data.plan;if(action!=='publish')assert.equal((await s.request('students/'+f.ids.studentRecord+'/plans')).data.plans.length,0);}
  const visible=await s.request('students/'+f.ids.studentRecord+'/plans');assert.equal(visible.data.plans.length,1);assert.equal(visible.data.plans[0].status,'published');assert.equal((await other.request('students/'+f.ids.studentRecord+'/plans')).status,404);
  await f.restart();assert.equal((await s.request('students')).data.students[0].onboarding.context,onboarding.context);assert.equal((await s.request('students/'+f.ids.studentRecord+'/plans')).data.plans[0].id,plan.id);
},{loginLimit:30}));
test('CSRF/origin, limites, uploads ausentes e sessão revogada quando usuário desativado',async()=>withFixture(async f=>{
  const c=f.client();assert.equal((await c.request('login',{email:'coach@fixture.invalid',password:FIXTURE_PASSWORD},'POST',{Origin:'https://external.invalid'})).status,403);await c.login('coach');assert.equal((await c.request('students',{name:'AA',email:'a@fixture.invalid',internalNote:''},'POST',{Origin:''})).status,403);
  assert.equal((await c.request('students',{name:'AA',email:'a@fixture.invalid',internalNote:'x'.repeat(17000)})).status,413);assert.equal((await c.request('uploads',{})).status,404);
  f.store.run('UPDATE users SET active=0 WHERE id=?',f.ids.coach);assert.equal((await c.request('session')).status,401);assert.equal((await c.login('coach')).status,401);
}));
test('migration sem conta automática; SQLite vazio não provisiona administrador',()=>{
  const store=openLocalStore(':memory:');try{assert.equal(store.get('SELECT COUNT(*) AS n FROM users').n,0);assert.equal(store.get('SELECT COUNT(*) AS n FROM organizations').n,0);}finally{store.close();}
});

test('adaptador local e servidor recusam produção inclusive quando importados',async()=>{
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';try{assert.throws(()=>openLocalStore(':memory:'),/refuses production/);await assert.rejects(()=>createLocalServer({filename:':memory:'}),/refuses production/);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
