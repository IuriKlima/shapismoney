import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {postgresStore,migratePostgres} from '../backend/postgres.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {hashPassword} from '../backend/auth.mjs';
import {COMMERCE_PASSWORD} from './commerce-runtime-fixtures.mjs';
test('same HTTP commerce/identity/access/outbox rules run through existing PostgreSQL adapter in isolated PGlite',async()=>{
 const db=new PGlite();await db.exec('CREATE ROLE sim_app NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE SCHEMA sim;GRANT USAGE ON SCHEMA sim TO sim_app;SET search_path=sim,pg_catalog;');
 let gate=Promise.resolve();const acquire=async()=>{let release;const next=new Promise(r=>release=r),old=gate;gate=next;await old;return release;};
 const query=async(sql,params=[])=>{if(!params.length&&sql.split(';').filter(s=>s.trim()).length>1){const last=(await db.exec(sql)).at(-1);return {rows:last?.rows||[],rowCount:last?.affectedRows||0};}const r=await db.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows||0};};
 const pool={query:async(...args)=>{const release=await acquire();try{return await query(...args);}finally{release();}},connect:async()=>{const release=await acquire();return {query,release};},end:()=>db.close()};
 const store=postgresStore(pool);await migratePostgres(store);
 const sql=readFileSync(new URL('../backend/commerce/migrations/001-local-commerce.sql',import.meta.url),'utf8');
 await store.query(sql);await store.query('CREATE TABLE commerce_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');await store.run('INSERT INTO commerce_migrations VALUES (?,?)','001-local-commerce',createHash('sha256').update(sql).digest('hex'));
 const org=randomUUID(),adminId=randomUUID();await store.run('INSERT INTO organizations VALUES (?,?)',org,'PG commerce fixture');await store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',adminId,org,'pgadmin@fixture.invalid','PG fixture admin','admin',await hashPassword(COMMERCE_PASSWORD));
 // Fixture tables need separate harness permissions, never granted by production migrations.
 await store.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA sim TO sim_app;REVOKE INSERT,UPDATE,DELETE ON schema_migrations,commerce_migrations FROM sim_app;SET ROLE sim_app');
 const app=await createLocalServer({store,loginLimit:50,commerce:{enabled:true,fixtureOnly:true,embeddedPostgresFixture:true,adminId}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
 const client=()=>{const cookies=new Map();return async(route,body)=>{const r=await fetch(origin+'/api/local/'+route,{method:body===undefined?'GET':'POST',headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID()})},body:body===undefined?undefined:JSON.stringify(body)});for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');if(v)cookies.set(k,v);else cookies.delete(k);}return {status:r.status,data:await r.json()};};};
 const admin=client(),buyer=client();try{
  assert.equal((await admin('login',{email:'pgadmin@fixture.invalid',password:COMMERCE_PASSWORD})).status,200);
  await buyer('commerce/register',{name:'PG fictional buyer',email:'pgbuyer@fixture.invalid'});
  const crm=(await admin('commerce/admin/crm')).data,job=crm.outbox.find(j=>j.kind==='verify-identity');
  const preview=await admin('commerce/admin/outbox/'+job.id+'/preview',{}),token=preview.data.fragment.split('=')[1];
  const confirmed=await buyer('password-access/confirm',{token,email:'pgbuyer@fixture.invalid',password:COMMERCE_PASSWORD});assert.equal(confirmed.status,200);
  await buyer('login',{email:'pgbuyer@fixture.invalid',password:COMMERCE_PASSWORD});assert.equal((await buyer('session')).data.user.access.active,false);assert.equal((await buyer('students')).status,403);
  const order=await buyer('commerce/orders',{sku:'quarterly',billingType:'PIX'});assert.equal(order.status,201);const id=order.data.orderId;
  assert.equal((await buyer('commerce/orders/'+id+'/checkout',{})).status,200);
  for(let i=0;i<3;i++){await admin('commerce/admin/orders/'+id+'/simulate',{scenario:'paid'});assert.equal((await admin('commerce/admin/process',{})).status,200);}
  assert.equal((await buyer('session')).data.user.access.active,true);assert.equal((await buyer('students')).data.students.length,1);
  assert.equal((await store.get('SELECT COUNT(*)::integer AS n FROM commerce_entitlements')).n,1);
  assert.equal((await store.get("SELECT COUNT(*)::integer AS n FROM commerce_outbox WHERE kind='paid'")).n,1);
  assert.equal((await store.get('SELECT COUNT(*)::integer AS n FROM plans')).n,0);
  assert.equal((await store.get('SELECT COUNT(*)::integer AS n FROM schema_migrations')).n,7);
  await assert.rejects(()=>store.query('CREATE TABLE forbidden_commerce_runtime(id TEXT)'));
 }finally{await app.close();}
});
