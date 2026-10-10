import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Explicit local migration: never called by normal startup or numbered migrations.
export function applyCommerceFixture(store,{fixtureOnly=false}={}){
 if(store.kind!=='sqlite'||fixtureOnly!==true||process.env.NODE_ENV==='production')throw Error('Commerce migration is restricted to an explicit SQLite fixture.');
 if(store.get("SELECT COUNT(*) AS n FROM users WHERE email NOT LIKE '%@fixture.invalid'").n)throw Error('Non-fixture identities are forbidden.');
 const sql=readFileSync(new URL('./migrations/001-local-commerce.sql',import.meta.url),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
 store.exec('CREATE TABLE IF NOT EXISTS commerce_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
 const old=store.get('SELECT checksum FROM commerce_migrations WHERE name=?','001-local-commerce');
 if(old&&old.checksum!==checksum)throw Error('Commerce migration checksum mismatch.');
 if(!old)store.transaction(()=>{store.exec(sql);store.run('INSERT INTO commerce_migrations VALUES (?,?)','001-local-commerce',checksum);});
}
