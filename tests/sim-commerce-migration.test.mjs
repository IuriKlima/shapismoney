import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const sql=readFileSync(new URL('../backend/commerce/migrations/001-local-commerce.sql',import.meta.url),'utf8');
const grants=readFileSync(new URL('../backend/commerce/migrations/001-review-grants.sql',import.meta.url),'utf8');
test('review-only commerce migration validates PostgreSQL tenant constraints, rollback and restricted grants in fictitious PGlite',async()=>{
 const db=new PGlite();try{
  await db.exec("CREATE TABLE organizations(id TEXT PRIMARY KEY);CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE students(id TEXT PRIMARY KEY,org_id TEXT REFERENCES organizations(id));CREATE ROLE sim_commerce_fixture NOSUPERUSER NOCREATEDB NOCREATEROLE;"+sql+grants);
  await db.exec("INSERT INTO organizations VALUES ('org'),('foreign');INSERT INTO users VALUES ('u');INSERT INTO students VALUES ('s','org');INSERT INTO commerce_buyers(id,org_id,customer_id,environment,account_id) VALUES ('b','org','c','mock','fixture-a');");
  await assert.rejects(()=>db.exec("INSERT INTO commerce_student_sources VALUES ('s','foreign','b')"));
  await db.exec("SET ROLE sim_commerce_fixture;INSERT INTO commerce_registrations VALUES ('b','org','fixture@fixture.invalid','Fixture',NULL);INSERT INTO commerce_outbox VALUES ('notice','b','org','identity','verify-identity','pending',1);");
  await assert.rejects(()=>db.exec("INSERT INTO commerce_outbox VALUES ('duplicate','b','org','identity','verify-identity','pending',2)"));
  await assert.rejects(()=>db.exec('CREATE TABLE forbidden(id TEXT)'));
  await assert.rejects(()=>db.exec('SELECT * FROM commerce_mock_checkouts'));
  await db.exec("BEGIN;INSERT INTO commerce_identity_proofs VALUES ('hash','b','notice',2,NULL,1);ROLLBACK;");
  assert.equal((await db.query('SELECT COUNT(*)::integer n FROM commerce_identity_proofs')).rows[0].n,0);
 }finally{await db.close();}
});
