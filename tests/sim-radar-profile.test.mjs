import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {QUESTIONS,RADAR_VERSION,RADAR_CONSENT,radarResult} from '../public/sim/radar-model.js';

async function fixture(){const f=await isolatedFixture();const org=f.store.get('SELECT org_id FROM users WHERE id=?',f.ids.admin).org_id;const app=await createLocalServer({store:f.store,radarOrgId:org,loginLimit:50});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
  const jar=()=>{let cookie='';return async(route,body,method='POST',key=randomUUID())=>{const r=await fetch(origin+'/api/local/'+route,{method:body===undefined?'GET':method,headers:{Origin:origin,...(body!==undefined?{'Content-Type':'application/json','Idempotency-Key':key}:{}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const binary=r.headers.get('content-type')==='image/webp';return {status:r.status,data:binary?Buffer.from(await r.arrayBuffer()):await r.json(),headers:r.headers};};};return {...f,app,origin,jar,close:()=>app.close()};}
const registration={name:'Contato fictício',email:'lead@fixture.invalid',phone:'',necessary:true,marketing:false,consentVersion:RADAR_CONSENT,source:'radar'};
const event=name=>({event:name,version:RADAR_VERSION});

test('versioned score matches supplied formula, inversion, strict answers and ties',()=>{
  const answers=Object.fromEntries(QUESTIONS.map(q=>[q.id,3]));const mid=radarResult(answers);assert.equal(mid.total,50);assert.equal(mid.priorities.length,5);assert.equal(mid.strengths.length,5);
  assert.equal(radarResult({...answers,capacity_1:5,capacity_2:5,capacity_3:1}).axes[1].value,100);
  assert.equal(radarResult({...answers,capacity_3:5}).axes[1].value,33);assert.equal(radarResult({...answers,capacity_3:5}).discomfort,true);
  for(const bad of [{},{...answers,capacity_1:0},{...answers,capacity_1:6},{...answers,capacity_1:2.5},{...answers,extra:'private'}])assert.throws(()=>radarResult(bad));
});
test('public capture/events are idempotent and separate consent, track abandonment, never accept health payloads, CRM isolated by organization',async()=>{
  const f=await fixture(),visitor=f.jar(),other=f.jar(),admin=f.jar(),coach=f.jar(),outsider=f.jar();f.store.run("UPDATE users SET role='admin' WHERE id=?",f.ids.outsider);try{
    const key=randomUUID();assert.equal((await visitor('radar/register',{...registration,necessary:false})).status,400);assert.equal((await visitor('radar/register',{...registration,marketing:'true'})).status,400);
    assert.equal((await visitor('radar/register',registration,'POST',key)).status,201);assert.equal((await visitor('radar/register',registration,'POST',key)).status,201);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM radar_leads').n,1);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM radar_runs').n,1);
    assert.equal((await visitor('radar/register',{...registration,name:'Modified'},'POST',key)).status,409);
    assert.equal((await other('radar/event',event('start'))).status,401);assert.equal((await visitor('radar/event',event('completion'))).status,409);
    assert.equal((await visitor('radar/event',{...event('start'),answers:{capacity_3:5}})).status,400);
    await Promise.all([visitor('radar/event',event('start')),visitor('radar/event',event('start'))]);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM radar_events').n,2);assert.equal(f.store.get('SELECT state FROM radar_runs').state,'start');
    for(const name of ['completion','result','cta']){assert.equal((await visitor('radar/event',event(name))).status,200);assert.equal((await visitor('radar/event',event(name))).status,200);}
    assert.equal(f.store.get('SELECT COUNT(*) AS n FROM radar_events').n,5);
    const repeatKey=randomUUID();assert.equal((await visitor('radar/restart',{},'POST',repeatKey)).status,201);assert.equal((await visitor('radar/restart',{},'POST',repeatKey)).status,201);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM radar_runs').n,2);await visitor('radar/event',event('start'));
    await admin('login',{email:'admin@fixture.invalid',password:FIXTURE_PASSWORD});await coach('login',{email:'coach@fixture.invalid',password:FIXTURE_PASSWORD});await outsider('login',{email:'outsider@fixture.invalid',password:FIXTURE_PASSWORD});
    assert.equal((await coach('crm/radar')).status,403);assert.deepEqual((await outsider('crm/radar')).data.leads,[]);const crm=await admin('crm/radar');assert.equal(crm.data.leads[0].marketing,false);assert.equal(crm.data.leads[0].runs.length,2);assert.equal(crm.data.leads[0].runs[0].state,'start');assert.doesNotMatch(JSON.stringify(crm.data),/capacity_3|answers|token_hash|request_hash|discomfort/);
    await visitor('radar/register',{...registration,marketing:true,source:'plans'});assert.equal((await visitor('radar/event',event('cta'))).status,200);await visitor('radar/marketing',{enabled:false});assert.equal(f.store.get('SELECT marketing FROM radar_leads').marketing,0);
    assert.equal((await visitor('radar/event',{...event('completion'),version:'other'})).status,400);
    for(const path of ['/','/radar','/vendas','/privacidade'])assert.equal((await fetch(f.origin+path)).status,200);
  }finally{await f.close();}
});
test('owner profile edits preserve previous records; coach/admin cannot mutate; uploaded photo is private and sanitized',async()=>{
  const f=await fixture();const owner=f.jar(),coach=f.jar(),admin=f.jar(),other=f.jar(),outsider=f.jar(),anonymous=f.jar();const url='students/'+f.ids.studentRecord+'/profile';try{
    for(const [r,role] of [[owner,'student'],[coach,'coach'],[admin,'admin'],[other,'otherstudent'],[outsider,'outsider']])await r('login',{email:role+'@fixture.invalid',password:FIXTURE_PASSWORD});
    assert.equal((await anonymous(url)).status,401);assert.equal((await other(url)).status,404);assert.equal((await outsider(url)).status,404);
    const before=f.store.get('SELECT * FROM students WHERE id=?',f.ids.studentRecord);const body={displayName:'Meu nome de exibição',bio:'Minha apresentação privada.',revision:0};
    assert.equal((await coach(url,body,'PUT')).status,403);assert.equal((await admin(url,body,'PUT')).status,403);
    const key=randomUUID();assert.equal((await owner(url,body,'PUT',key)).status,200);assert.equal((await owner(url,body,'PUT',key)).status,200);assert.equal((await owner(url,body,'PUT')).status,409);assert.deepEqual(f.store.get('SELECT * FROM students WHERE id=?',f.ids.studentRecord),before);
    const current=(await owner(url)).data.profile;assert.equal(current.revision,1);assert.equal(current.bio,body.bio);assert.equal((await coach(url)).data.profile.displayName,body.displayName);
    assert.equal((await owner(url,{...body,revision:1,bio:'x'.repeat(281)},'PUT')).status,400);
    const jpeg=await sharp({create:{width:160,height:100,channels:3,background:'#a97624'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'PRIVATE TEST METADATA',ImageDescription:'SECRET fixture metadata'}}}).toBuffer();
    assert.equal((await owner(url+'/photo',{revision:1,image:jpeg.toString('base64'),type:'image/jpeg'},'PUT')).status,200);
    const photo=await owner(url+'/photo');assert.equal(photo.status,200);const meta=await sharp(photo.data).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);assert.equal((await anonymous(url+'/photo')).status,401);assert.equal((await outsider(url+'/photo')).status,404);
    for(const body of [{revision:2,image:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),type:'image/svg+xml'},{revision:2,image:Buffer.from('<html>invalid</html>').toString('base64'),type:'image/png'},{revision:2,image:jpeg.toString('base64'),type:'image/png'},{revision:2,image:'a'.repeat(2800001),type:'image/jpeg'}])assert.equal((await owner(url+'/photo',body,'PUT')).status,400);
    const pixelBomb=await sharp({create:{width:5000,height:4000,channels:3,background:'white'}}).png().toBuffer();assert.equal((await owner(url+'/photo',{revision:2,image:pixelBomb.toString('base64'),type:'image/png'},'PUT')).status,400);
    const audit=JSON.stringify(f.store.all('SELECT * FROM audit'));assert.doesNotMatch(audit,/Minha apresentação|PRIVATE TEST|Meu nome de exibição/);
    assert.equal((await owner(url+'/photo',{revision:2,image:null,type:null},'PUT')).status,200);assert.equal((await owner(url+'/photo')).status,404);assert.equal((await owner(url)).data.profile.bio,body.bio);
  }finally{await f.close();}
});
