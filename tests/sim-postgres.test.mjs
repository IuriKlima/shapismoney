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
    await migratePostgres(store);await migratePostgres(store);assert.equal((await store.all('SELECT * FROM schema_migrations')).length,1);assert.equal((await store.get('SELECT COUNT(*)::integer AS n FROM users')).n,0);
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
