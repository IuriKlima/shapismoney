import {AsyncLocalStorage} from 'node:async_hooks';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
pg.types.setTypeParser(20,value=>{const number=Number(value);if(!Number.isSafeInteger(number))throw Error('Database integer out of range.');return number;});
export function numberedSQL(sql){let index=0;let quote=false;return sql.replace(/'|\?/g,token=>{if(token==="'"){quote=!quote;return token;}return quote?token:'$'+(++index);});}
export function postgresStore(pool){
  const context=new AsyncLocalStorage();
  const query=(sql,args=[])=>{const client=context.getStore()||pool;return client.query(numberedSQL(sql),args);};
  return {kind:'postgres',get:async(sql,...args)=>(await query(sql,args)).rows[0],all:async(sql,...args)=>(await query(sql,args)).rows,run:async(sql,...args)=>({changes:(await query(sql,args)).rowCount}),
    lockWorkout:async id=>{await query('SELECT id FROM workouts WHERE id=? FOR UPDATE',[id]);},
    lockStudent:async id=>{await query('SELECT id FROM students WHERE id=? FOR UPDATE',[id]);},
    lockActor:async id=>{await query('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);},
    async transaction(work){if(context.getStore())throw Error('Nested transactions are unsupported.');const client=await pool.connect();try{await client.query('BEGIN');const result=await context.run(client,work);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}},
    close:()=>pool.end(),query
  };
}
export function poolFromEnvironment(env=process.env,{migration=false}={}){
  const password=env.PGPASSWORD_FILE?readFileSync(env.PGPASSWORD_FILE,'utf8').trim():env.PGPASSWORD;
  if(!env.PGHOST||!env.PGDATABASE||!env.PGUSER||!password||password.length<20)throw Error('Dedicated PostgreSQL connection settings are required.');
  if(env.PGUSER!==(migration?'sim_migrator':'sim_app'))throw Error('Use the dedicated limited database role.');
  const mode=env.SIM_DB_TLS;let ssl;
  if(mode==='verify-full')ssl={rejectUnauthorized:true,...(env.SIM_DB_CA_FILE?{ca:readFileSync(env.SIM_DB_CA_FILE,'utf8')}: {})};
  else if(mode==='private-network'&&/^[a-z][a-z0-9_-]*$/.test(env.PGHOST))ssl=false;
  else throw Error('Verified TLS or explicit private container database network required.');
  const pool=new pg.Pool({host:env.PGHOST,port:Number(env.PGPORT||5432),database:env.PGDATABASE,user:env.PGUSER,password,ssl,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:5000,options:'-c search_path=sim,pg_catalog'});
  pool.on('error',()=>{}); // Readiness checks surface pool failures without printing connection details.
  return pool;
}
export async function verifyRuntimeRole(store){
  const role=await store.get('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user');
  const ddl=await store.get("SELECT has_schema_privilege(current_user,'sim','CREATE') AS can_create");
  if(!role||role.rolname!=='sim_app'||role.rolsuper||role.rolcreatedb||role.rolcreaterole||ddl.can_create)throw Error('Database runtime role has excessive privileges.');
  const fixtures=await store.get("SELECT COUNT(*)::integer AS count FROM users WHERE email LIKE '%@fixture.invalid'");if(fixtures.count)throw Error('QA fixtures are forbidden in production.');
  const migrations=await store.all('SELECT name,checksum FROM schema_migrations');const expected=postgresMigrations();
  if(migrations.length!==expected.length||expected.some(m=>!migrations.some(existing=>existing.name===m.name&&existing.checksum===m.checksum)))throw Error('Database migrations are missing or changed.');
}
export function postgresMigrations(){const directory=path.join(path.dirname(fileURLToPath(import.meta.url)),'pg-migrations');return readdirSync(directory).filter(n=>/^\d+-[a-z-]+\.sql$/.test(n)).sort().map(name=>{const sql=readFileSync(path.join(directory,name),'utf8');return {name,sql,checksum:createHash('sha256').update(sql).digest('hex')};});}
export async function migratePostgres(store){
  await store.transaction(async()=>{
    await store.query('SELECT pg_advisory_xact_lock(824017351)');
    await store.query('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
    for(const migration of postgresMigrations()){const old=await store.get('SELECT checksum FROM schema_migrations WHERE name=?',migration.name);if(old&&old.checksum!==migration.checksum)throw Error('Migration checksum mismatch.');if(!old){await store.query(migration.sql);await store.run('INSERT INTO schema_migrations VALUES (?,?)',migration.name,migration.checksum);}}
    await store.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA sim TO sim_app');
    await store.query('REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM sim_app');
  });
}
