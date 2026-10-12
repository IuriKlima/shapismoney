import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Explicit migration command/API for an isolated sandbox DB only; never startup.
export function applyAsaasRuntimeSchema(store,{isolatedSandbox=false,accountId,orgId}={}){
 if(process.env.NODE_ENV==='production'||store.kind!=='sqlite'||isolatedSandbox!==true||!/^[-A-Za-z0-9_]{1,200}$/.test(accountId||'')||!store.get('SELECT id FROM organizations WHERE id=?',orgId))throw Error('Isolated sandbox database and account/organization required.');
 const files=['asaas-preparation.sql','asaas-runtime.sql'],sql=files.map(f=>readFileSync(new URL(f,import.meta.url),'utf8')).join('\n'),checksum=createHash('sha256').update(sql).digest('hex');
 store.transaction(()=>{store.exec('CREATE TABLE IF NOT EXISTS asaas_runtime_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');const old=store.get('SELECT checksum FROM asaas_runtime_migrations WHERE name=?','001-runtime');if(old){const c=store.get('SELECT * FROM asaas_runtime_config WHERE singleton=1');if(old.checksum!==checksum||c.account_id!==accountId||c.org_id!==orgId)throw Error('Sandbox migration or scope mismatch.');return;}
 if(store.get("SELECT name FROM sqlite_master WHERE name='commerce_orders'"))throw Error('Existing financial database requires reviewed upgrade.');store.exec(sql);store.run('INSERT INTO asaas_runtime_config VALUES (1,?,?)',accountId,orgId);store.run('INSERT INTO asaas_runtime_migrations VALUES (?,?)','001-runtime',checksum);});
}
