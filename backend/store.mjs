import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
// Local adapter only. Production must explicitly select a reviewed PostgreSQL adapter.
export function openLocalStore(filename){
  if(process.env.NODE_ENV==='production')throw Error('Local SQLite adapter refuses production. Implement the reviewed PostgreSQL adapter first.');
  if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename,{timeout:5000});
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  function transaction(work){db.exec('BEGIN IMMEDIATE');try{const result=work();if(result?.then)throw Error('Transactions must be synchronous in the local adapter.');db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
  const migrations=path.join(path.dirname(fileURLToPath(import.meta.url)),'migrations');
  for(const name of readdirSync(migrations).filter(n=>/^\d+-[a-z-]+\.sql$/.test(n)).sort()){
    const sql=readFileSync(path.join(migrations,name),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');const existing=get('SELECT checksum FROM schema_migrations WHERE name=?',name);
    if(existing&&existing.checksum!==checksum){db.close();throw Error('Migration checksum mismatch.');}
    if(!existing)transaction(()=>{db.exec(sql);run('INSERT INTO schema_migrations(name,checksum) VALUES (?,?)',name,checksum);});
  }
  return {kind:'sqlite',run,get,all,transaction,exec:sql=>db.exec(sql),close:()=>db.close()};
}
