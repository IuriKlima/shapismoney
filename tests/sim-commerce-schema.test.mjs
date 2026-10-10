import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const draft=readFileSync(new URL('../backend/commerce/schema.sql',import.meta.url),'utf8');
test('commerce draft SQL is PostgreSQL-compatible with account-scoped events and tenant FK; not a real concurrency test',async()=>{
 const db=new PGlite();try{await db.exec("CREATE TABLE organizations(id TEXT PRIMARY KEY);CREATE TABLE users(id TEXT PRIMARY KEY);"+draft);await db.exec("INSERT INTO organizations VALUES ('org'),('other');INSERT INTO users VALUES ('student');INSERT INTO commerce_buyers(id,org_id,customer_id,environment,account_id) VALUES ('buyer','org','cus_mock','mock','fixture-account')");
 await db.exec("INSERT INTO commerce_events(environment,account_id,event_id,event_type,state,received_at) VALUES ('mock','fixture-account','evt_1','CHECKOUT_PAID','pending',1),('mock','fixture-other','evt_1','CHECKOUT_PAID','pending',1)");await assert.rejects(()=>db.exec("INSERT INTO commerce_events(environment,account_id,event_id,event_type,state,received_at) VALUES ('mock','fixture-account','evt_1','CHECKOUT_PAID','pending',1)"));
 await assert.rejects(()=>db.exec("INSERT INTO commerce_interest VALUES ('interest','missing-buyer','org','annual',1)"));await assert.rejects(()=>db.exec("INSERT INTO commerce_interest VALUES ('interest','buyer','other','annual',1)"));assert.equal((await db.query('SELECT COUNT(*)::integer n FROM commerce_events')).rows[0].n,2);await db.exec("BEGIN;INSERT INTO commerce_interest VALUES ('interest','buyer','org','annual',1);ROLLBACK");assert.equal((await db.query('SELECT COUNT(*)::integer n FROM commerce_interest')).rows[0].n,0);
 }finally{await db.close();}
});
