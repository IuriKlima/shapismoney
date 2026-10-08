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
  await f.restart();assert.equal((await c.request('session')).status,200);assert.equal((await c.request('students/'+id)).data.student.name,data.name);assert.equal(f.store.get('SELECT COUNT(*) AS count FROM schema_migrations').count,3);
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

test('admin gere cadastro, onboarding e treino somente na própria organização, sem papéis profissionais implícitos',async()=>withFixture(async f=>{
  const admin=f.client(),coach=f.client(),nutrition=f.client(),student=f.client(),outsider=f.client(),otherCoach=f.client();
  for(const [client,role] of [[admin,'admin'],[coach,'coach'],[nutrition,'nutrition'],[student,'student'],[outsider,'outsider'],[otherCoach,'otherCoach']])assert.equal((await client.login(role)).status,200);
  const data={name:'Aluno admin fictício',email:'admin-created@fixture.invalid',internalNote:'Cadastro administrativo'};
  const created=await admin.request('students',data);assert.equal(created.status,201);assert.equal(created.data.accountProvisioned,false);
  const id=created.data.student.id;assert.equal(f.store.get('SELECT coach_id FROM students WHERE id=?',id).coach_id,f.ids.admin);
  assert.equal(f.store.get('SELECT COUNT(*) AS n FROM users').n,7);
  assert.equal((await admin.request('students',{...data,email:'another@fixture.invalid',role:'coach'})).status,400);
  assert.equal((await admin.request('students',{...data,email:'another@fixture.invalid',org_id:'untrusted'})).status,400);
  assert.equal((await coach.request('students/'+id)).status,404);
  const external=await outsider.request('students',{...data,email:'external@fixture.invalid'});assert.equal(external.status,201);
  for(const suffix of ['','/plans'])assert.equal((await admin.request('students/'+external.data.student.id+suffix)).status,404);
  const onboarding={goal:'Condicionamento',days:3,experience:'Iniciante',context:'Informado pelo aluno fictício',revision:1};
  const staffPath='students/'+f.ids.studentRecord+'/onboarding';
  for(const [client,code] of [[nutrition,403],[student,403],[otherCoach,404],[outsider,404]])assert.equal((await client.request(staffPath,onboarding,'PUT')).status,code);
  assert.equal((await admin.request('students/'+external.data.student.id+'/onboarding',onboarding,'PUT')).status,404);
  assert.equal((await admin.request(staffPath,{...onboarding,role:'coach'},'PUT')).status,400);
  assert.equal((await admin.request(staffPath,onboarding,'PUT')).status,200);
  assert.equal((await admin.request(staffPath,onboarding,'PUT')).status,409);
  const competing=await Promise.all([admin.request(staffPath,{...onboarding,revision:2},'PUT'),coach.request(staffPath,{...onboarding,revision:2},'PUT')]);
  assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
  assert.equal((await admin.request('onboarding',{...onboarding,revision:3},'PUT')).status,403);
  const input={title:'Treino administrativo fictício',exercises:[{name:'Exemplo manual',sets:3,reps:10}]};
  assert.equal((await admin.request('students/'+external.data.student.id+'/plans',input)).status,404);
  let plan=(await admin.request('students/'+f.ids.studentRecord+'/plans',input)).data.plan;assert.equal(plan.status,'draft');
  assert.equal((await student.request('students/'+f.ids.studentRecord+'/plans')).data.plans.length,0);
  assert.equal((await admin.request('plans/'+plan.id+'/publish',{revision:plan.revision})).status,409);
  for(const action of ['submit','approve','publish']){
    for(const [client,code] of [[nutrition,403],[student,403],[otherCoach,404],[outsider,404]])assert.equal((await client.request('plans/'+plan.id+'/'+action,{revision:plan.revision})).status,code);
    const result=await admin.request('plans/'+plan.id+'/'+action,{revision:plan.revision});assert.equal(result.status,200);plan=result.data.plan;
  }
  assert.equal((await student.request('students/'+f.ids.studentRecord+'/plans')).data.plans[0].status,'published');
  const wrongRevision=await admin.request('plans/'+plan.id+'/publish',{revision:1});assert.equal(wrongRevision.status,409);
  assert.equal((await admin.request('ai',{scenario:'method',syntheticConsent:true})).status,403);
  assert.equal((await admin.request('nutrition',{})).status,404);
  const audit=(await admin.request('audit')).data.audit;assert.ok(audit.some(e=>e.actor_id===f.ids.admin&&e.event==='onboarding.recorded'));
  assert.ok(audit.some(e=>e.actor_id===f.ids.admin&&e.event==='plan.publish'));
  assert.ok(!audit.some(e=>e.student_id===external.data.student.id));
},{loginLimit:40}));

test('convites: cadastro→ativação→login→onboarding; whitelist, isolamento e código nunca persistido',async()=>withFixture(async f=>{
 const a=f.client(),coach=f.client(),recipient=f.client(),outside=f.client();await a.login('admin');await coach.login('coach');await outside.login('outsider');
 const created=await a.request('students',{name:'Aluno convite fictício',email:'invite@fixture.invalid',internalNote:'Privado'});const row=created.data.student;
 const body={kind:'student',studentId:row.id,email:row.email,name:row.name,professionalRole:null,verifiedDelivery:true};
 assert.equal((await coach.request('invitations',body)).status,403);assert.equal((await outside.request('invitations',body)).status,403);
 assert.equal((await a.request('invitations',{...body,org_id:'forged'})).status,400);assert.equal((await a.request('invitations',{...body,professionalRole:'admin'})).status,400);assert.equal((await a.request('invitations',{...body,email:'wrong@fixture.invalid'})).status,400);assert.equal((await a.request('invitations',{...body,verifiedDelivery:false})).status,400);
 const key=randomUUID();const issued=await a.request('invitations',body,'POST',{'Idempotency-Key':key});assert.equal(issued.status,201);assert.equal(issued.data.emailSent,false);const token=issued.data.token;assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal((await a.request('invitations',body,'POST',{'Idempotency-Key':key})).data.token,null);
 assert.ok(!JSON.stringify(f.store.all('SELECT * FROM invitations')).includes(token));assert.ok(!JSON.stringify(f.store.all('SELECT * FROM operations')).includes(token));assert.ok(!JSON.stringify(f.store.all('SELECT * FROM audit')).includes(token));
 const activation={token,email:row.email,password:FIXTURE_PASSWORD};assert.equal((await recipient.request('activate',{...activation,email:'wrong@fixture.invalid'})).status,400);assert.equal((await recipient.request('activate',{...activation,role:'admin'})).status,400);assert.equal((await recipient.request('activate',{...activation,password:'short'})).status,400);
 const competing=await Promise.all([recipient.request('activate',activation),f.client().request('activate',activation)]);assert.deepEqual(competing.map(r=>r.status).sort(),[201,400]);assert.equal((await recipient.request('activate',activation)).status,400);
 assert.equal((await recipient.request('login',{email:row.email,password:FIXTURE_PASSWORD})).data.user.role,'student');const own=(await recipient.request('students')).data.students;assert.equal(own.length,1);assert.equal(own[0].id,row.id);assert.ok(!JSON.stringify(own).includes('Privado'));
 assert.equal((await recipient.request('onboarding',{goal:'Hipertrofia',days:3,experience:'Iniciante',context:'Fictício inicial',revision:own[0].revision},'PUT')).status,200);assert.equal((await recipient.request('invitations',body)).status,403);
},{loginLimit:40}));

test('convites: expiração, substituição, profissional distinto e rate limit',async()=>{
 let clock=Date.now();await withFixture(async f=>{
  const a=f.client(),c=f.client();await a.login('admin');const professional=(address,role='coach')=>({kind:'professional',studentId:null,email:address,name:'Profissional fictício',professionalRole:role,verifiedDelivery:true});
  assert.equal((await a.request('invitations',professional('forged@fixture.invalid','admin'))).status,400);
  const first=(await a.request('invitations',professional('pro@fixture.invalid'))).data;const second=(await a.request('invitations',professional('pro@fixture.invalid'))).data;
  assert.equal((await c.request('activate',{token:first.token,email:'pro@fixture.invalid',password:FIXTURE_PASSWORD})).status,400);
  assert.equal((await c.request('activate',{token:second.token,email:'pro@fixture.invalid',password:FIXTURE_PASSWORD})).status,201);
  assert.equal((await c.request('login',{email:'pro@fixture.invalid',password:FIXTURE_PASSWORD})).data.user.role,'coach');assert.equal((await c.request('students')).data.students.length,0);
  const expired=(await a.request('invitations',professional('expired@fixture.invalid','nutrition'))).data;clock+=1800001;assert.equal((await f.client().request('activate',{token:expired.token,email:'expired@fixture.invalid',password:FIXTURE_PASSWORD})).status,400);assert.equal(f.store.get("SELECT COUNT(*) AS n FROM users WHERE email='expired@fixture.invalid'").n,0);
  for(let i=0;i<7;i++)assert.equal((await f.client().request('activate',{token:'x'.repeat(43),email:'no@fixture.invalid',password:FIXTURE_PASSWORD})).status,400);assert.equal((await f.client().request('activate',{token:'x'.repeat(43),email:'no@fixture.invalid',password:FIXTURE_PASSWORD})).status,429);
 },{now:()=>clock,loginLimit:40});
});

test('admin assigns active same-organization professionals, revokes old access and invalidates unpublished approval',async()=>withFixture(async f=>{
  const admin=f.client(),coach=f.client(),replacement=f.client(),nutrition=f.client(),student=f.client(),outsider=f.client();
  for(const [c,r] of [[admin,'admin'],[coach,'coach'],[replacement,'otherCoach'],[nutrition,'nutrition'],[student,'student'],[outsider,'outsider']])await c.login(r);
  const roster=await admin.request('professionals');assert.equal(roster.status,200);assert.equal(roster.data.professionals.length,3);assert.ok(!JSON.stringify(roster.data).includes(f.ids.outsider));assert.ok(!JSON.stringify(roster.data).includes('password'));
  for(const c of [coach,nutrition,student,outsider])assert.equal((await c.request('professionals')).status,403);
  const path='students/'+f.ids.studentRecord+'/assignments';
  const external=await outsider.request('students',{name:'External synthetic profile',email:'external-assignment@fixture.invalid',internalNote:''});assert.equal(external.status,201);assert.equal((await admin.request('students/'+external.data.student.id+'/assignments',{coachId:f.ids.coach,nutritionId:null,revision:1},'PUT')).status,404);
  const body={coachId:f.ids.otherCoach,nutritionId:f.ids.nutrition,revision:1};
  for(const [c,status] of [[coach,403],[nutrition,403],[student,403],[replacement,404],[outsider,404]])assert.equal((await c.request(path,body,'PUT')).status,status);
  for(const change of [{coachId:f.ids.outsider},{coachId:f.ids.admin},{coachId:f.ids.student},{nutritionId:f.ids.coach},{coachId:'*'},{revision:0},{role:'admin'}])assert.equal((await admin.request(path,{...body,...change},'PUT')).status,400);
  f.store.run('UPDATE users SET active=0 WHERE id=?',f.ids.otherCoach);assert.equal((await admin.request(path,body,'PUT')).status,400);f.store.run('UPDATE users SET active=1 WHERE id=?',f.ids.otherCoach);
  const input={title:'Unpublished reassignment test',exercises:[{name:'Synthetic exercise',sets:3,reps:10}]};let draft=(await coach.request('students/'+f.ids.studentRecord+'/plans',input)).data.plan;
  for(const action of ['submit','approve'])draft=(await coach.request('plans/'+draft.id+'/'+action,{revision:draft.revision})).data.plan;
  let published=(await coach.request('students/'+f.ids.studentRecord+'/plans',{...input,title:'Published history'})).data.plan;for(const action of ['submit','approve','publish'])published=(await coach.request('plans/'+published.id+'/'+action,{revision:published.revision})).data.plan;
  const key=randomUUID(),assigned=await admin.request(path,body,'PUT',{'Idempotency-Key':key});assert.equal(assigned.status,200);assert.deepEqual(assigned.data.student.assignments,{coachId:f.ids.otherCoach,nutritionId:f.ids.nutrition});assert.deepEqual((await admin.request(path,body,'PUT',{'Idempotency-Key':key})).data,assigned.data);
  assert.equal((await admin.request(path,body,'PUT')).status,409);assert.equal((await coach.request('students/'+f.ids.studentRecord)).status,404);assert.equal((await coach.request('plans/'+draft.id+'/publish',{revision:draft.revision})).status,404);assert.equal((await replacement.request('students/'+f.ids.studentRecord)).status,200);
  const reset=f.store.get('SELECT * FROM plans WHERE id=?',draft.id);assert.equal(reset.status,'draft');assert.equal(reset.approved_by,null);assert.equal((await replacement.request('plans/'+draft.id+'/publish',{revision:reset.revision})).status,409);
  assert.equal((await student.request('students/'+f.ids.studentRecord+'/plans')).data.plans[0].status,'published');assert.equal(f.store.get('SELECT status FROM plans WHERE id=?',published.id).status,'published');
  const competing=await Promise.all([admin.request(path,{coachId:null,nutritionId:null,revision:2},'PUT'),admin.request(path,{coachId:f.ids.coach,nutritionId:null,revision:2},'PUT')]);assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
  const current=(await admin.request('students/'+f.ids.studentRecord)).data.student;assert.equal((await admin.request(path,{coachId:null,nutritionId:null,revision:current.revision},'PUT')).status,200);
  for(const c of [coach,replacement,nutrition])assert.equal((await c.request('students/'+f.ids.studentRecord)).status,404);assert.equal((await student.request('students/'+f.ids.studentRecord)).status,200);
  assert.deepEqual((await admin.request('students/'+f.ids.studentRecord)).data.student.assignments,{coachId:null,nutritionId:null});assert.equal((await admin.request('audit')).data.audit.filter(a=>a.event.startsWith('assignment.coach.changed:')).length,2+(competing[0].status===200?0:1));
  await f.restart();assert.equal((await replacement.request('students/'+f.ids.studentRecord)).status,404);assert.equal((await admin.request('students/'+f.ids.studentRecord)).status,200);
},{loginLimit:30}));

test('synthetic acceptance: registration, separate invitations, assignment, activation, onboarding, reviewed publication and student visibility',async()=>withFixture(async f=>{
  const admin=f.client(),recipient=f.client(),professional=f.client();await admin.login('admin');
  const created=await admin.request('students',{name:'Synthetic acceptance student',email:'acceptance-student@fixture.invalid',internalNote:'INTERNAL ACCEPTANCE ONLY'});assert.equal(created.status,201);const id=created.data.student.id;
  const professionalInvite=await admin.request('invitations',{kind:'professional',studentId:null,email:'acceptance-coach@fixture.invalid',name:'Synthetic acceptance coach',professionalRole:'coach',verifiedDelivery:true});assert.equal(professionalInvite.status,201);
  assert.equal((await professional.request('activate',{email:'acceptance-coach@fixture.invalid',token:professionalInvite.data.token,password:FIXTURE_PASSWORD})).status,201);assert.equal((await professional.request('login',{email:'acceptance-coach@fixture.invalid',password:FIXTURE_PASSWORD})).status,200);
  const coach=f.store.get("SELECT id FROM users WHERE email='acceptance-coach@fixture.invalid'").id;assert.equal((await admin.request('students/'+id+'/assignments',{coachId:coach,nutritionId:null,revision:1},'PUT')).status,200);
  const invitation=await admin.request('invitations',{kind:'student',studentId:id,email:created.data.student.email,name:created.data.student.name,professionalRole:null,verifiedDelivery:true});assert.equal(invitation.status,201);
  assert.equal((await recipient.request('activate',{email:created.data.student.email,token:invitation.data.token,password:FIXTURE_PASSWORD})).status,201);assert.equal((await recipient.request('login',{email:created.data.student.email,password:FIXTURE_PASSWORD})).status,200);
  let row=(await recipient.request('students/'+id)).data.student;assert.ok(!JSON.stringify(row).includes('INTERNAL'));assert.equal((await recipient.request('onboarding',{goal:'Condicionamento',days:3,experience:'Iniciante',context:'Synthetic availability only',revision:row.revision},'PUT')).status,200);
  let plan=(await professional.request('students/'+id+'/plans',{title:'Acceptance plan',exercises:[{name:'Synthetic exercise',sets:3,reps:10}]})).data.plan;
  assert.equal((await recipient.request('students/'+id+'/plans')).data.plans.length,0);assert.equal((await professional.request('plans/'+plan.id+'/publish',{revision:plan.revision})).status,409);
  for(const action of ['submit','approve','publish']){const result=await professional.request('plans/'+plan.id+'/'+action,{revision:plan.revision});assert.equal(result.status,200);plan=result.data.plan;}
  assert.equal((await recipient.request('students/'+id+'/plans')).data.plans[0].id,plan.id);
  let workout=(await recipient.request('workouts',{planId:plan.id})).data.workout;for(let i=0;i<3;i++)workout=(await recipient.request('workouts/'+workout.id+'/sets',{exerciseIndex:0,setIndex:i,reps:10,load:0,completed:true,revision:workout.revision},'PUT')).data.workout;assert.equal(workout.completed,true);
  assert.equal((await recipient.request('ranking/preferences',{enabled:true,alias:'Acceptance participant',revision:0},'PUT')).status,200);assert.equal((await admin.request('ranking')).data.entries[0].consistency,33);
  await f.restart();assert.equal((await recipient.request('students/'+id+'/plans')).data.plans[0].status,'published');assert.equal((await recipient.request('workouts/current')).data.workout.completed,true);assert.equal((await recipient.request('ranking/preferences',{enabled:false,alias:'',revision:1},'PUT')).status,200);assert.equal((await admin.request('ranking')).data.entries.length,0);
},{loginLimit:30}));

test('capabilities autenticadas refletem a configuração sem ampliar papéis ou chamar o provedor',async()=>{
  for(const enabled of [false,true]){
    let calls=0;
    await withFixture(async f=>{
      assert.equal((await f.client().request('ai/capabilities')).status,401);
      for(const role of ['admin','student','coach','nutrition']){
        const client=f.client();await client.login(role);
        const response=await client.request('ai/capabilities');assert.equal(response.status,200);
        const permitted=['coach','nutrition'].includes(role);
        assert.deepEqual(response.data,{available:enabled&&permitted,reason:!permitted?'role-restricted':enabled?'available':'disabled',mode:'synthetic-development',writesPerformed:false});
        assert.ok(!JSON.stringify(response.data).includes('fixture-ai-credential'));
        if(!permitted)assert.equal((await client.request('ai',{scenario:'method',syntheticConsent:true})).status,403);
        else if(!enabled)assert.equal((await client.request('ai',{scenario:'method',syntheticConsent:true})).status,503);
      }
      assert.equal(calls,0);
    },{loginLimit:30,ai:{apiKey:enabled?'fixture-ai-credential':'',fetchImpl:async()=>{calls++;throw Error('Provider must not run during capability checks');}}});
  }
});
