import {provisionInitialAdmin} from '../backend/bootstrap.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {postgresStore,migratePostgres,verifyRuntimeRole,numberedSQL} from '../backend/postgres.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {hashPassword} from '../backend/auth.mjs';
import {FIXTURE_PASSWORD} from './backend-fixtures.mjs';
async function embedded(){
  const db=new PGlite();await db.exec('CREATE ROLE sim_app NOSUPERUSER NOCREATEDB NOCREATEROLE; CREATE SCHEMA sim; GRANT USAGE ON SCHEMA sim TO sim_app; SET search_path=sim,pg_catalog;');
  let gate=Promise.resolve();const acquire=async()=>{let release;const next=new Promise(resolve=>{release=resolve;});const before=gate;gate=next;await before;return release;};
  const query=async(sql,params=[])=>{if(!params.length&&sql.split(';').filter(s=>s.trim()).length>1){const result=await db.exec(sql);const last=result.at(-1)||{};return {rows:last.rows||[],rowCount:last.affectedRows||0};}const result=await db.query(sql,params);return {rows:result.rows,rowCount:result.affectedRows||0};};
  const pool={query:async(...args)=>{const release=await acquire();try{return await query(...args);}finally{release();}},connect:async()=>{const release=await acquire();return {query,release};},end:()=>db.close()};
  return {db,store:postgresStore(pool)};
}
test('PostgreSQL embarcado: migrations repetíveis, checksum, papel limitado e QA seed bloqueado',async()=>{
  const {db,store}=await embedded();try{
    await migratePostgres(store);await migratePostgres(store);assert.equal((await store.all('SELECT * FROM schema_migrations')).length,2);assert.equal((await store.get('SELECT COUNT(*)::integer AS n FROM users')).n,0);
    await db.exec('SET ROLE sim_app');await verifyRuntimeRole(store);await assert.rejects(()=>store.query('CREATE TABLE forbidden(id INTEGER)'));await assert.rejects(()=>store.run("DELETE FROM schema_migrations"));await db.exec('RESET ROLE');
    const password=await hashPassword(FIXTURE_PASSWORD),org=randomUUID();await store.run('INSERT INTO organizations VALUES (?,?)',org,'Fictício');await store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',randomUUID(),org,'qa@fixture.invalid','QA','coach',password);await db.exec('SET ROLE sim_app');await assert.rejects(()=>verifyRuntimeRole(store),/QA fixtures/);await db.exec('RESET ROLE');
    await store.run('UPDATE schema_migrations SET checksum=?','invalid-checksum');await assert.rejects(()=>migratePostgres(store),/checksum mismatch/);
  }finally{await store.close();}
});
test('SQL PostgreSQL embarcado: login, isolamento, idempotência concorrente, revisão e IA autenticada mock',async()=>{
  const {store}=await embedded();await migratePostgres(store);const org=randomUUID(),coach=randomUUID(),studentUser=randomUUID(),otherUser=randomUUID(),student=randomUUID(),otherStudent=randomUUID();const password=await hashPassword(FIXTURE_PASSWORD);
  await store.transaction(async()=>{await store.run('INSERT INTO organizations VALUES (?,?)',org,'Fictício PG');for(const [id,email,role] of [[coach,'coach@fixture.invalid','coach'],[studentUser,'student@fixture.invalid','student'],[otherUser,'other@fixture.invalid','student']])await store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',id,org,email,'Fictício',role,password);for(const [id,user,email] of [[student,studentUser,'student@fixture.invalid'],[otherStudent,otherUser,'other@fixture.invalid']])await store.run('INSERT INTO students(id,org_id,user_id,coach_id,email,name,internal_note) VALUES (?,?,?,?,?,?,?)',id,org,user,coach,email,'Aluno fictício','NOTA INTERNA');});
  let calls=0;const app=await createLocalServer({store,loginLimit:20,ai:{apiKey:'test-only-provider-key',fetchImpl:async(_url,options)=>{calls++;const input=JSON.parse(options.body);assert.ok(!JSON.stringify(input).includes('NOTA INTERNA'));assert.ok(!JSON.stringify(input).includes('@fixture.invalid'));return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Resposta do provider mock; revisão profissional.'}]}]}));}}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
  const client=()=>{let cookie='';return {async request(path,body,key=randomUUID()){const response=await fetch(origin+'/api/local/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,data:await response.json()};}};};
  try{
    const c=client(),s=client(),anonymous=client();for(const [who,email] of [[c,'coach@fixture.invalid'],[s,'student@fixture.invalid']])assert.equal((await who.request('login',{email,password:FIXTURE_PASSWORD})).status,200);
    assert.equal((await s.request('students/'+otherStudent)).status,404);assert.ok(!JSON.stringify((await s.request('students')).data).includes('NOTA INTERNA'));
    const input={name:'Fictício PG novo',email:'new@fixture.invalid',internalNote:'Interna'},key=randomUUID();const repeated=await Promise.all([c.request('students',input,key),c.request('students',input,key)]);assert.equal(repeated[0].status,201);assert.equal(repeated[1].status,201);assert.deepEqual(repeated[0].data,repeated[1].data);assert.equal((await store.get("SELECT COUNT(*)::integer AS n FROM students WHERE email='new@fixture.invalid'")).n,1);
    let plan=(await c.request('students/'+student+'/plans',{title:'PG fictício',exercises:[{name:'Exemplo',sets:3,reps:10}]})).data.plan;assert.equal((await s.request('students/'+student+'/plans')).data.plans.length,0);assert.equal((await c.request('plans/'+plan.id+'/publish',{revision:plan.revision})).status,409);
    for(const action of ['submit','approve','publish'])plan=(await c.request('plans/'+plan.id+'/'+action,{revision:plan.revision})).data.plan;assert.equal((await s.request('students/'+student+'/plans')).data.plans[0].status,'published');
    const question={scenario:'method',syntheticConsent:true};assert.equal((await anonymous.request('ai',question)).status,401);assert.equal((await s.request('ai',question)).status,403);assert.equal((await c.request('ai',{...question,role:'admin'})).status,400);const reply=await c.request('ai',question);assert.equal(reply.status,200);assert.equal(reply.data.writesPerformed,false);assert.match(reply.data.reply,/provider mock/);assert.equal(calls,1);assert.equal((await store.get('SELECT COUNT(*)::integer AS n FROM plans')).n,1);
  }finally{await app.close();}
});
test('contrato do pool usa mesmo cliente na transação e libera após rollback',async()=>{
  const calls=[];const client={query:async(...args)=>{calls.push(args);return {rows:[{id:'actor'}],rowCount:1};},release:()=>calls.push(['release'])};const store=postgresStore({query:()=>assert.fail('pool.query must not handle transaction'),connect:async()=>client,end:async()=>{}});
  await assert.rejects(()=>store.transaction(async()=>{await store.lockActor('actor');await store.run('INSERT INTO table_x VALUES (?)','parameter');throw Error('rollback');}),/rollback/);
  assert.deepEqual(calls.map(c=>c[0]),['BEGIN','SELECT id FROM users WHERE id=$1 FOR UPDATE','INSERT INTO table_x VALUES ($1)','ROLLBACK','release']);assert.deepEqual(calls[2][1],['parameter']);assert.equal(numberedSQL("SELECT '?' AS q, ? AS id, 'it''s?' AS t"),"SELECT '?' AS q, $1 AS id, 'it''s?' AS t");
});

test('PostgreSQL embarcado: bootstrap com papel limitado cria/audita e recusa admin existente',async()=>{
  const {db,store}=await embedded();try{await migratePostgres(store);await db.exec('SET ROLE sim_app');await verifyRuntimeRole(store);
    const input={store,email:'initial@bootstrap.example.test',name:'Administrador Fictício PG',organizationName:'Fictícia PG',password:FIXTURE_PASSWORD,confirmation:'CRIAR ADMINISTRADOR INICIAL'};const result=await provisionInitialAdmin(input);assert.equal(result.role,'admin');assert.equal((await store.get('SELECT COUNT(*)::integer AS n FROM users')).n,1);assert.equal((await store.get("SELECT COUNT(*)::integer AS n FROM audit WHERE event='bootstrap.admin.created'")).n,1);await assert.rejects(()=>provisionInitialAdmin(input),/Já existe administrador/);await verifyRuntimeRole(store);
  }finally{await store.close();}
});

test('PostgreSQL limitado: admin cadastra/onboarda/publica treino, sem acesso a outra organização',async()=>{
  const {db,store}=await embedded();await migratePostgres(store);
  const org=randomUUID(),externalOrg=randomUUID(),admin=randomUUID(),externalAdmin=randomUUID();
  const hash=await hashPassword(FIXTURE_PASSWORD);
  await store.transaction(async()=>{
    for(const [id,name] of [[org,'Organização teste'],[externalOrg,'Outra organização teste']])await store.run('INSERT INTO organizations VALUES (?,?)',id,name);
    for(const [id,tenant,email] of [[admin,org,'admin@fixture.invalid'],[externalAdmin,externalOrg,'externaladmin@fixture.invalid']])await store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',id,tenant,email,'Admin fictício','admin',hash);
  });
  await db.exec('SET ROLE sim_app');
  const app=await createLocalServer({store,loginLimit:20});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;
  const client=()=>{let cookie='';return {async request(path,body,method='POST',key=randomUUID()){
    const response=await fetch(origin+'/api/local/'+path,{method:body===undefined?'GET':method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,data:await response.json()};
  }};};
  try{
    const owner=client(),external=client();
    for(const [who,email] of [[owner,'admin@fixture.invalid'],[external,'externaladmin@fixture.invalid']])assert.equal((await who.request('login',{email,password:FIXTURE_PASSWORD})).status,200);
    const input={name:'Aluno fictício admin PG',email:'adminstudent@fixture.invalid',internalNote:'Registro administrativo'},key=randomUUID();
    const repeated=await Promise.all([owner.request('students',input,'POST',key),owner.request('students',input,'POST',key)]);
    assert.deepEqual(repeated[0],repeated[1]);assert.equal(repeated[0].status,201);assert.equal(repeated[0].data.accountProvisioned,false);
    const student=repeated[0].data.student;
    assert.equal((await external.request('students/'+student.id)).status,404);
    const onboarding={goal:'Hipertrofia',days:3,experience:'Iniciante',context:'Resposta fictícia registrada',revision:student.revision};
    assert.equal((await external.request('students/'+student.id+'/onboarding',onboarding,'PUT')).status,404);
    assert.equal((await owner.request('students/'+student.id+'/onboarding',onboarding,'PUT')).status,200);
    assert.equal((await owner.request('students/'+student.id+'/onboarding',onboarding,'PUT')).status,409);
    let plan=(await owner.request('students/'+student.id+'/plans',{title:'Treino manual PG',exercises:[{name:'Exemplo',sets:3,reps:10}]})).data.plan;
    assert.equal((await owner.request('plans/'+plan.id+'/publish',{revision:plan.revision})).status,409);
    for(const action of ['submit','approve','publish']){
      assert.equal((await external.request('plans/'+plan.id+'/'+action,{revision:plan.revision})).status,404);
      const result=await owner.request('plans/'+plan.id+'/'+action,{revision:plan.revision});assert.equal(result.status,200);plan=result.data.plan;
    }
    assert.equal(plan.status,'published');
    assert.equal((await owner.request('ai',{scenario:'method',syntheticConsent:true})).status,403);
    assert.equal((await store.get('SELECT COUNT(*)::integer AS n FROM users')).n,2);
    await assert.rejects(()=>store.query('CREATE TABLE forbidden_admin_test(id INTEGER)'));
    await assert.rejects(()=>store.run('DELETE FROM schema_migrations'));
  }finally{await app.close();}
});

test('PostgreSQL limitado: convite isolado e consumo concorrente atômico com rollback do vínculo',async()=>{
 const {db,store}=await embedded();await migratePostgres(store);const org=randomUUID(),other=randomUUID(),admin=randomUUID(),external=randomUUID();const password=await hashPassword(FIXTURE_PASSWORD);
 for(const id of [org,other])await store.run('INSERT INTO organizations VALUES (?,?)',id,'Org fictícia');for(const [id,tenant,address] of [[admin,org,'inviteadmin@fixture.invalid'],[external,other,'otheradmin@fixture.invalid']])await store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',id,tenant,address,'Admin fictício','admin',password);
 await db.exec('SET ROLE sim_app');const app=await createLocalServer({store,loginLimit:30});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
 const client=()=>{let cookie='';return async(path,body,method='POST')=>{const res=await fetch(origin+'/api/local/'+path,{method:body===undefined?'GET':method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,data:await res.json()};};};
 try{
  const a=client(),b=client(),recipient=client();await a('login',{email:'inviteadmin@fixture.invalid',password:FIXTURE_PASSWORD});await b('login',{email:'otheradmin@fixture.invalid',password:FIXTURE_PASSWORD});
  const row=(await a('students',{name:'PG convidado',email:'pginvite@fixture.invalid',internalNote:'Privada'})).data.student;const body={kind:'student',studentId:row.id,email:row.email,name:row.name,professionalRole:null,verifiedDelivery:true};assert.equal((await b('invitations',body)).status,404);
  const invite=(await a('invitations',body)).data;assert.match(invite.token,/^[A-Za-z0-9_-]{43}$/);const input={token:invite.token,email:row.email,password:FIXTURE_PASSWORD};
  const results=await Promise.all([recipient('activate',input),client()('activate',input)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,400]);assert.equal((await store.get('SELECT COUNT(*)::integer AS n FROM users WHERE email=?',row.email)).n,1);
  assert.equal((await recipient('login',{email:row.email,password:FIXTURE_PASSWORD})).data.user.role,'student');const own=(await recipient('students')).data.students[0];assert.equal(own.id,row.id);assert.equal((await recipient('onboarding',{goal:'Condicionamento',days:2,experience:'Iniciante',context:'Fictício PG',revision:own.revision},'PUT')).status,200);
  const bad=(await a('students',{name:'Vínculo mudado',email:'mismatch@fixture.invalid',internalNote:''})).data.student;const badInvite=(await a('invitations',{...body,studentId:bad.id,email:bad.email,name:bad.name})).data;await store.run('UPDATE students SET email=? WHERE id=?','changed@fixture.invalid',bad.id);
  assert.equal((await client()('activate',{token:badInvite.token,email:bad.email,password:FIXTURE_PASSWORD})).status,409);assert.equal((await store.get('SELECT COUNT(*)::integer AS n FROM users WHERE email=?',bad.email)).n,0);assert.equal((await store.get('SELECT consumed_at FROM invitations WHERE id=?',badInvite.invitation.id)).consumed_at,null);
  assert.ok(!JSON.stringify(await store.all('SELECT * FROM operations')).includes(invite.token));assert.ok(!JSON.stringify(await store.all('SELECT * FROM audit')).includes(invite.token));await assert.rejects(()=>store.query('CREATE TABLE forbidden_invite(id INTEGER)'));
 }finally{await app.close();}
});
