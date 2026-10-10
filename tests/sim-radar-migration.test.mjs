import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {postgresStore,postgresMigrations,migratePostgres,verifyRuntimeRole} from '../backend/postgres.mjs';

test('published 007 to 008 preserves legacy data, rolls back failed DDL, keeps new leads/photos on repeat and limits runtime privileges',async()=>{
  const db=new PGlite(),files=postgresMigrations(),legacy=files.filter(f=>f.name<'008-'),addition=files.find(f=>f.name==='008-radar-profile.sql');
  assert.equal(legacy.length,7);assert.ok(addition);
  const query=async(sql,args=[])=>{if(!args.length&&sql.split(';').filter(s=>s.trim()).length>1){const result=(await db.exec(sql)).at(-1)||{};return {rows:result.rows||[],rowCount:result.affectedRows||0};}const result=await db.query(sql,args);return {rows:result.rows,rowCount:result.affectedRows||0};};
  const store=postgresStore({query,connect:async()=>({query,release(){}}),end:()=>db.close()});
  const newTables=['radar_leads','radar_runs','radar_events','radar_registrations','radar_limits','student_profiles'];
  const snapshot=async names=>{const rows={};for(const name of names){assert.match(name,/^[a-z_]+$/);rows[name]=(await store.all('SELECT * FROM "'+name+'"')).map(r=>JSON.stringify(r)).sort();}return rows;};
  try{
    await db.exec('CREATE ROLE sim_app NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE sim_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE SCHEMA sim AUTHORIZATION sim_migrator;GRANT USAGE ON SCHEMA sim TO sim_app;SET ROLE sim_migrator;SET search_path=sim,pg_catalog;CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL);');
    for(const f of legacy){const published=execFileSync('git',['show','5db29b5758aadbd15d15d0d68dc6c9017961a97c:backend/pg-migrations/'+f.name],{encoding:'utf8'});assert.equal(createHash('sha256').update(published).digest('hex'),f.checksum);await store.query(f.sql);await store.run('INSERT INTO schema_migrations VALUES (?,?)',f.name,f.checksum);}
    await db.exec("INSERT INTO organizations VALUES ('o','Synthetic preservation only');INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES ('c','o','coach@example.test','Synthetic coach','coach','synthetic-not-a-login'),('u','o','student@example.test','Synthetic student','student','synthetic-not-a-login');INSERT INTO students(id,org_id,user_id,coach_id,email,name,internal_note,onboarding,revision) VALUES ('s','o','u','c','student@example.test','Synthetic preserved name','Synthetic private note','{\"goal\":\"Synthetic legacy goal\"}',7);INSERT INTO plans(id,student_id,author_id,title,content,status,revision,approved_by,approved_revision,published_at) VALUES ('p','s','c','Synthetic published plan','{\"exercises\":[]}','published',4,'c',4,123);INSERT INTO service_cases(student_id,org_id,started_at,target_at,promised_at,onboarding_revision,status,updated_at) VALUES ('s','o',100,172800100,259200100,7,'waiting',100);INSERT INTO anamneses(student_id,org_id,version,answers,status,training_consent,nutrition_consent,consent_version,consented_at,revision,attention_review,updated_at) VALUES ('s','o','SYNTHETIC_TEST','{\"test\":\"private synthetic answer\"}','draft',1,0,'SYNTHETIC_CONSENT',100,3,0,100);GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA sim TO sim_app;REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM sim_app;SET ROLE sim_app;");
    await assert.rejects(()=>verifyRuntimeRole(store),/migrations are missing or changed/);
    await db.exec('SET ROLE sim_migrator');
    const baseTables=(await store.all("SELECT table_name FROM information_schema.tables WHERE table_schema='sim' AND table_name<>'schema_migrations' ORDER BY table_name")).map(r=>r.table_name),before=await snapshot(baseTables);
    const broken={...store,query:async(sql,args)=>{if(sql===addition.sql){await store.query(sql,args);throw Error('Synthetic failure after 008 DDL');}return store.query(sql,args);}};
    await assert.rejects(()=>migratePostgres(broken),/Synthetic failure/);assert.equal((await store.get('SELECT COUNT(*) AS n FROM schema_migrations')).n,7);assert.deepEqual(await snapshot(baseTables),before);
    for(const table of newTables)assert.equal((await store.get('SELECT to_regclass(?) AS name','sim.'+table)).name,null);
    await migratePostgres(store);assert.deepEqual(await snapshot(baseTables),before);assert.equal((await store.get('SELECT COUNT(*) AS n FROM schema_migrations')).n,8);
    await db.exec('SET ROLE sim_app');await verifyRuntimeRole(store);
    for(const table of newTables)for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await store.get('SELECT has_table_privilege(current_user,?,?) AS allowed','sim.'+table,privilege)).allowed,true);
    assert.equal((await store.get("SELECT has_schema_privilege(current_user,'sim','CREATE') AS allowed")).allowed,false);assert.equal((await store.get("SELECT has_table_privilege(current_user,'sim.schema_migrations','DELETE') AS allowed")).allowed,false);
    await db.exec("INSERT INTO radar_leads VALUES ('lead','o','Synthetic interest','lead@example.test','',0,'SYNTHETIC','radar',100,100);INSERT INTO radar_runs VALUES ('run','lead','synthetic-not-a-token',200,'registered','SYNTHETIC','radar',100);INSERT INTO radar_events VALUES ('run','registration',100);INSERT INTO radar_registrations VALUES ('synthetic-operation','synthetic-hash','run');INSERT INTO radar_limits VALUES ('synthetic-ip-hash',1,200);INSERT INTO student_profiles VALUES ('s','Synthetic display','Synthetic private bio','U1lOVEhFVElD',2);");
    const additions=await snapshot(newTables);await db.exec('SET ROLE sim_migrator');await migratePostgres(store);assert.deepEqual(await snapshot(baseTables),before);assert.deepEqual(await snapshot(newTables),additions);assert.equal((await store.get('SELECT COUNT(*) AS n FROM schema_migrations')).n,8);
    await db.exec('SET ROLE sim_app');await verifyRuntimeRole(store);
  }finally{await store.close();}
});
