import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import {createLocalServer as legacyServer} from '../backend/server.mjs';
import {postgresStore,migratePostgres,verifyRuntimeRole} from '../backend/postgres.mjs';
import {hashPassword} from '../backend/auth.mjs';
import {seedReviewedIntake} from '../tests/intake-test-fixtures.mjs';
import {FIXTURE_PASSWORD} from '../tests/backend-fixtures.mjs';




if(process.argv.length!==3)throw Error('Usage: node tests/contingency-forward-return-fixture.mjs PATH_TO_PINNED_UX_WORKTREE');
const pinned='f5d7f94764e28f8fe8c31468f2a7b70d92108671',forward=fs.realpathSync(path.resolve(process.argv[2]));
assert.equal(execFileSync('git',['-C',forward,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),pinned);
assert.equal(execFileSync('git',['-C',forward,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
const {createLocalServer:forwardServer}=await import(pathToFileURL(path.join(forward,'backend/server.mjs')).href);
const {postgresStore:forwardStore}=await import(pathToFileURL(path.join(forward,'backend/postgres.mjs')).href);
const {RADAR_VERSION,RADAR_CONSENT}=await import(pathToFileURL(path.join(forward,'public/sim/radar-model.js')).href);
const require=createRequire(path.join(forward,'backend/package.json')),sharp=require('sharp');
const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'sim-real-forward-return-008-'))),temporary=fs.realpathSync(os.tmpdir());assert.ok(directory.startsWith(temporary+path.sep));
const org=randomUUID(),admin=randomUUID(),owner=randomUUID(),sid=randomUUID(),tables=['radar_leads','radar_runs','radar_events','radar_registrations','radar_limits','student_profiles','schema_migrations','anamneses'];
const digest=value=>createHash('sha256').update(value).digest('hex');
async function open(adapter,initialize=false){
 const db=new PGlite(directory);let gate=Promise.resolve();const acquire=async()=>{let release;const next=new Promise(r=>{release=r;});const previous=gate;gate=next;await previous;return release;};
 const query=async(sql,args=[])=>{if(!args.length&&sql.split(';').filter(s=>s.trim()).length>1){const r=(await db.exec(sql)).at(-1)||{};return {rows:r.rows||[],rowCount:r.affectedRows||0};}const r=await db.query(sql,args);return {rows:r.rows,rowCount:r.affectedRows||0};};
 const pool={query:async(...args)=>{const release=await acquire();try{return await query(...args);}finally{release();}},connect:async()=>{const release=await acquire();return {query,release};},end:()=>db.close()},store=adapter(pool);
 if(initialize)await db.exec('CREATE ROLE sim_app NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE sim_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE SCHEMA sim AUTHORIZATION sim_migrator;GRANT USAGE ON SCHEMA sim TO sim_app;');await db.exec('SET search_path=sim,pg_catalog;');return {db,store};
}
async function snapshot(store){const value={};for(const table of tables)value[table]=(await store.all('SELECT * FROM '+table)).map(r=>JSON.stringify(r)).sort();return value;}
let state,app,origin;
const start=async factory=>{app=await factory({store:state.store,radarOrgId:org,loginLimit:30});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+app.server.address().port;};
const client=()=>{let cookie='';return async(route,body,method='POST',key=randomUUID())=>{const r=await fetch(origin+'/api/local/'+route,{method:body===undefined?'GET':method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:r.headers.get('content-type')==='image/webp'?Buffer.from(await r.arrayBuffer()):await r.json()};};};
const visitor=client(),staff=client(),student=client();
try{
 state=await open(forwardStore,true);await state.db.exec('SET ROLE sim_migrator;');await migratePostgres(state.store);const password=await hashPassword(FIXTURE_PASSWORD);
 await state.store.run('INSERT INTO organizations VALUES (?,?)',org,'Synthetic actual forward-return');for(const [id,role]of [[admin,'admin'],[owner,'student']])await state.store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',id,org,role+'@example.test','Synthetic '+role,role,password);
 await state.store.run('INSERT INTO students(id,org_id,user_id,coach_id,email,name) VALUES (?,?,?,?,?,?)',sid,org,owner,admin,'student@example.test','Synthetic source name');await seedReviewedIntake(state.store,sid,admin);
 await state.db.exec('SET ROLE sim_app;');await verifyRuntimeRole(state.store);await start(forwardServer);
 for(const [c,role]of [[staff,'admin'],[student,'student']])assert.equal((await c('login',{email:role+'@example.test',password:FIXTURE_PASSWORD})).status,200);
 const registration={name:'Synthetic actual captured lead',email:'synthetic-lead@example.test',phone:'',necessary:true,marketing:false,consentVersion:RADAR_CONSENT,source:'radar'},key=randomUUID();assert.equal((await visitor('radar/register',registration,'POST',key)).status,201);assert.equal((await visitor('radar/register',registration,'POST',key)).status,201);
 for(const event of ['start','completion','result','cta'])assert.equal((await visitor('radar/event',{event,version:RADAR_VERSION})).status,200);
 assert.equal((await visitor('radar/restart',{})).status,201);assert.equal((await visitor('radar/event',{event:'start',version:RADAR_VERSION})).status,200);
 const route='students/'+sid+'/profile';assert.equal((await student(route,{displayName:'Synthetic edited profile',bio:'Synthetic private bio',revision:0},'PUT')).status,200);
 const jpeg=await sharp({create:{width:120,height:80,channels:3,background:'#ab8750'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'SYNTHETIC QA ONLY'}}}).toBuffer();assert.equal((await student(route+'/photo',{revision:1,image:jpeg.toString('base64'),type:'image/jpeg'},'PUT')).status,200);
 const photo=(await student(route+'/photo')).data,metadata=await sharp(photo).metadata();assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);
 const before=await snapshot(state.store),beforeDigest=digest(JSON.stringify(before)),photoDigest=digest(photo);assert.equal((await staff('crm/radar')).data.leads[0].runs.length,2);
 await app.close();app=null;state=await open(postgresStore);await state.db.exec('SET ROLE sim_app;');await verifyRuntimeRole(state.store);await start(legacyServer);
 assert.equal((await staff('session')).status,200);assert.equal((await student('session')).status,200);assert.equal((await student(route)).status,404);assert.equal((await staff('crm/radar')).status,404);assert.equal((await fetch(origin+'/radar')).status,404);
 let plan=(await staff('students/'+sid+'/plans',{title:'Synthetic legacy return plan',daysPerWeek:2,exercises:[{name:'Synthetic exercise',sets:1,reps:10}]})).data.plan;assert.ok(plan);for(const action of ['submit','approve','publish']){const r=await staff('plans/'+plan.id+'/'+action,{revision:plan.revision});assert.equal(r.status,200);plan=r.data.plan;}
 assert.equal((await student('students/'+sid+'/plans')).data.plans[0].id,plan.id);assert.deepEqual(await snapshot(state.store),before);
 await app.close();app=null;state=await open(forwardStore);await state.db.exec('SET ROLE sim_app;');await verifyRuntimeRole(state.store);await start(forwardServer);
 assert.equal((await student(route)).data.profile.displayName,'Synthetic edited profile');assert.equal(digest((await student(route+'/photo')).data),photoDigest);const crm=(await staff('crm/radar')).data;assert.equal(crm.leads.length,1);assert.equal(crm.leads[0].marketing,false);assert.equal(crm.leads[0].runs.length,2);assert.deepEqual(await snapshot(state.store),before);assert.equal((await student('students/'+sid+'/plans')).data.plans[0].id,plan.id);
 const result={passed:true,forward:pinned,legacyBase:'5db29b5758aadbd15d15d0d68dc6c9017961a97c',realHTTPForwardWrites:true,distinctRuntimeModules:true,durableDatabaseReopenedTwice:true,newTablesAndCatalogDigestBefore:beforeDigest,newTablesAndCatalogDigestAfter:digest(JSON.stringify(await snapshot(state.store))),privatePhotoSha256:photoDigest,forwardReturnForwardVerified:true,limits:'PGlite and local HTTP; Docker image IDs, native Linux/PostgreSQL and real HTTPS proxy not tested'};fs.writeFileSync('.qa/forward-return-008-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{if(app)await app.close();else if(state)await state.store.close();const resolved=fs.realpathSync(directory);assert.equal(resolved,directory);assert.ok(resolved.startsWith(temporary+path.sep));fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
