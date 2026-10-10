import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {postgresStore,postgresMigrations,migratePostgres,verifyRuntimeRole} from '../backend/postgres.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {hashPassword} from '../backend/auth.mjs';
import {FIXTURE_PASSWORD} from './backend-fixtures.mjs';
import {seedReviewedIntake} from './intake-test-fixtures.mjs';

const PUBLISHED='5db29b5758aadbd15d15d0d68dc6c9017961a97c';
const hash=value=>createHash('sha256').update(value).digest('hex');
const tables=['radar_leads','radar_runs','radar_events','radar_registrations','radar_limits','student_profiles'];
const syntheticPhoto='UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/u2oAAA=';

async function embedded(directory,initialize=false){
  const db=new PGlite(directory);
  let gate=Promise.resolve();
  const acquire=async()=>{let release;const next=new Promise(r=>{release=r;});const previous=gate;gate=next;await previous;return release;};
  const query=async(sql,params=[])=>{if(!params.length&&sql.split(';').filter(s=>s.trim()).length>1){const r=(await db.exec(sql)).at(-1)||{};return {rows:r.rows||[],rowCount:r.affectedRows||0};}const r=await db.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows||0};};
  const pool={query:async(...args)=>{const release=await acquire();try{return await query(...args);}finally{release();}},connect:async()=>{const release=await acquire();return {query,release};},end:()=>db.close()};
  const store=postgresStore(pool);
  if(initialize)await db.exec('CREATE ROLE sim_app NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE sim_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE SCHEMA sim AUTHORIZATION sim_migrator;GRANT USAGE ON SCHEMA sim TO sim_app;');
  await db.exec('SET search_path=sim,pg_catalog;');
  return {db,store};
}

async function snapshot(store,names){
  const result={};
  for(const name of names){assert.match(name,/^[a-z_]+$/);result[name]=(await store.all('SELECT * FROM "'+name+'"')).map(r=>JSON.stringify(r)).sort();}
  return result;
}

test('contingency retains published runtime/assets and exact 008 catalog, without bypassing schema validation',()=>{
  const files=execFileSync('git',['ls-tree','-r','--name-only',PUBLISHED,'--','backend','public','app','components','deploy','package.json','package-lock.json'],{encoding:'utf8'}).trim().split(/\r?\n/);
  const runtime=files.filter(p=>/\.(?:mjs|js|tsx|ts|css|html|svg|sql)$/.test(p)||/(?:^|\/)package(?:-lock)?\.json$/.test(p)||/^deploy\/Dockerfile(?:\.dockerignore)?$/.test(p));
  assert.ok(runtime.length>60);
  // Compare Git-normalized contents; Windows checkout may use CRLF for code, while SQL is forced LF.
  for(const file of runtime)assert.equal(execFileSync('git',['hash-object','--path='+file,file],{encoding:'utf8'}).trim(),execFileSync('git',['rev-parse',PUBLISHED+':'+file],{encoding:'utf8'}).trim(),file);
  assert.equal(hash(readFileSync('backend/pg-migrations/008-radar-profile.sql')),'2b13954ef16fefe54babebede9e3413d0d89f7ccdede111fdf10506c59ad5a9c');
  assert.equal(hash(readFileSync('backend/migrations/008-radar-profile.sql')),'ec030cd2a7f748db78351135f83996852d9bcc15f0ea9042855c20f164b14490');
  assert.equal(postgresMigrations().length,8);
});

test('contingency rejects missing, changed and future catalog entries while retaining limited runtime permissions',async()=>{
  const {db,store}=await embedded();
  try{
    await db.exec('CREATE ROLE sim_app NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE sim_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE SCHEMA sim AUTHORIZATION sim_migrator;GRANT USAGE ON SCHEMA sim TO sim_app;SET search_path=sim,pg_catalog;SET ROLE sim_migrator;');
    await migratePostgres(store);await db.exec('SET ROLE sim_app;');await verifyRuntimeRole(store);
    const catalog=await store.all('SELECT name,checksum FROM schema_migrations');
    const altered=rows=>({...store,all:async(sql,...args)=>sql==='SELECT name,checksum FROM schema_migrations'?rows:store.all(sql,...args)});
    for(const invalid of [catalog.filter(r=>r.name!=='008-radar-profile.sql'),catalog.map(r=>r.name==='008-radar-profile.sql'?{...r,checksum:'synthetic-invalid-checksum'}:r),[...catalog,{name:'009-unapproved.sql',checksum:'synthetic-future'}]])await assert.rejects(()=>verifyRuntimeRole(altered(invalid)),/migrations are missing or changed/);
    assert.deepEqual(await store.all('SELECT name,checksum FROM schema_migrations'),catalog);
    assert.equal((await store.get("SELECT has_schema_privilege(current_user,'sim','CREATE') AS allowed")).allowed,false);
    await assert.rejects(()=>store.query('CREATE TABLE forbidden_contingency(id integer)'));
    await assert.rejects(()=>store.run('DELETE FROM schema_migrations'));
  }finally{await store.close();}
});

test('functional legacy return after 008 writes preserves leads, consent history, profile/photo bytes and catalog across durable reopen', {timeout:120000},async()=>{
  const directory=realpathSync(mkdtempSync(path.join(os.tmpdir(),'sim-contingency-008-'))),temporary=realpathSync(os.tmpdir());
  assert.ok(directory.startsWith(temporary+path.sep));
  const org=randomUUID(),otherOrg=randomUUID(),coach=randomUUID(),owner=randomUUID(),external=randomUUID(),sid=randomUUID(),lead=randomUUID(),completed=randomUUID(),abandoned=randomUUID();
  let state=await embedded(directory,true),app;
  try{
    await state.db.exec('SET ROLE sim_migrator;');await migratePostgres(state.store);
    const password=await hashPassword(FIXTURE_PASSWORD),now=Date.now();
    await state.store.transaction(async()=>{
      for(const tenant of [org,otherOrg])await state.store.run('INSERT INTO organizations VALUES (?,?)',tenant,'Synthetic contingency tenant');
      for(const [id,tenant,role,email] of [[coach,org,'coach','coach'],[owner,org,'student','student'],[external,otherOrg,'coach','external']])await state.store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',id,tenant,email+'@example.test','Synthetic '+role,role,password);
      await state.store.run('INSERT INTO students(id,org_id,user_id,coach_id,email,name,internal_note) VALUES (?,?,?,?,?,?,?)',sid,org,owner,coach,'student@example.test','Synthetic original student','Synthetic private staff note');
      await seedReviewedIntake(state.store,sid,coach);
    });
    await state.db.exec('SET ROLE sim_app;');await verifyRuntimeRole(state.store);
    // These are post-008 application-role writes, including completed and abandoned runs.
    await state.store.transaction(async()=>{
      await state.store.run('INSERT INTO radar_leads VALUES (?,?,?,?,?,?,?,?,?,?)',lead,org,'Synthetic interest','lead@example.test','',0,'SIM_RADAR_CONTACT_V1','radar',now,now);
      for(const [id,status] of [[completed,'cta'],[abandoned,'start']])await state.store.run('INSERT INTO radar_runs VALUES (?,?,?,?,?,?,?,?)',id,lead,hash('synthetic-'+id),now+43200000,status,'SIM_RADAR_SELF_REPORT_V1','radar',now);
      for(const event of ['registration','start','completion','result','cta'])await state.store.run('INSERT INTO radar_events VALUES (?,?,?)',completed,event,now);
      for(const event of ['registration','start'])await state.store.run('INSERT INTO radar_events VALUES (?,?,?)',abandoned,event,now);
      await state.store.run('INSERT INTO radar_registrations VALUES (?,?,?)','synthetic-registration',hash('synthetic-request'),completed);
      await state.store.run('INSERT INTO radar_limits VALUES (?,?,?)',hash('synthetic-local-ip'),2,now+3600000);
      await state.store.run('INSERT INTO student_profiles VALUES (?,?,?,?,?)',sid,'Synthetic updated display','Synthetic private biography',syntheticPhoto,3);
    });
    const preserved=await snapshot(state.store,[...tables,'schema_migrations','anamneses']);
    const photoDigest=hash(Buffer.from((await state.store.get('SELECT photo FROM student_profiles WHERE student_id=?',sid)).photo,'base64'));
    await state.store.close();state=await embedded(directory);await state.db.exec('SET ROLE sim_app;');await verifyRuntimeRole(state.store);
    let origin;
    const start=async()=>{app=await createLocalServer({store:state.store,loginLimit:30});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+app.server.address().port;};
    const client=()=>{let cookie='';return async(route,body,method='POST',key=randomUUID())=>{const r=await fetch(origin+'/api/local/'+route,{method:body===undefined?'GET':method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};};};
    await start();const staff=client(),student=client(),outsider=client();
    for(const [c,email] of [[staff,'coach'],[student,'student'],[outsider,'external']])assert.equal((await c('login',{email:email+'@example.test',password:FIXTURE_PASSWORD})).status,200);
    const oldHome=await fetch(origin+'/');assert.equal(oldHome.status,200);assert.equal(await oldHome.text(),readFileSync('public/sim/persistent.html','utf8'));
    for(const route of ['/radar','/vendas','/privacidade'])assert.equal((await fetch(origin+route)).status,404);
    assert.equal((await fetch(origin+'/healthz')).status,200);
    const own=await student('students');assert.equal(own.status,200);assert.equal(own.data.students[0].name,'Synthetic original student');
    assert.ok(!JSON.stringify(own.data).includes('private staff note'));assert.ok(!JSON.stringify(own.data).includes(syntheticPhoto));
    assert.equal((await outsider('students/'+sid)).status,404);
    for(const route of ['students/'+sid+'/profile','students/'+sid+'/profile/photo','crm/radar'])assert.equal((await staff(route)).status,404);
    assert.equal((await student('students/'+sid+'/profile',{displayName:'Unauthorized contingency change'},'PUT')).status,404);
    assert.equal((await staff('radar/register',{name:'No contingency capture'})).status,404);
    assert.equal((await student('ai',{})).status,503);
    let plan=(await staff('students/'+sid+'/plans',{title:'Synthetic contingency plan',daysPerWeek:2,exercises:[{name:'Synthetic exercise',sets:1,reps:10}]})).data.plan;assert.ok(plan);
    for(const action of ['submit','approve','publish']){const r=await staff('plans/'+plan.id+'/'+action,{revision:plan.revision});assert.equal(r.status,200);plan=r.data.plan;}
    assert.equal((await student('students/'+sid+'/plans')).data.plans[0].id,plan.id);
    assert.equal((await outsider('students/'+sid+'/plans')).status,404);
    let workout=(await student('workouts',{planId:plan.id})).data.workout;assert.ok(workout);
    const body={exerciseIndex:0,setIndex:0,reps:10,load:10,completed:true,revision:workout.revision},key=randomUUID();
    const first=await student('workouts/'+workout.id+'/sets',body,'PUT',key);assert.equal(first.status,200);assert.deepEqual(await student('workouts/'+workout.id+'/sets',body,'PUT',key),first);workout=first.data.workout;
    assert.equal((await staff('workouts/'+workout.id+'/sets',{...body,revision:workout.revision},'PUT')).status,403);
    assert.deepEqual(await snapshot(state.store,[...tables,'schema_migrations','anamneses']),preserved);
    assert.equal(hash(Buffer.from((await state.store.get('SELECT photo FROM student_profiles WHERE student_id=?',sid)).photo,'base64')),photoDigest);
    await app.close();app=null;state=await embedded(directory);await state.db.exec('SET ROLE sim_app;');await verifyRuntimeRole(state.store);await start();
    assert.equal((await student('session')).status,200);assert.equal((await student('students/'+sid+'/plans')).data.plans[0].id,plan.id);
    assert.deepEqual(await snapshot(state.store,[...tables,'schema_migrations','anamneses']),preserved);
    assert.equal((await state.store.get('SELECT COUNT(*)::integer AS n FROM workout_edits')).n,1);
  }finally{
    if(app)await app.close();else await state.store.close();
    const resolved=realpathSync(directory);assert.equal(resolved,directory);assert.ok(resolved.startsWith(temporary+path.sep));rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
