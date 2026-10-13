import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startSandboxHold,NETWORK_DIAGNOSTIC_PATH} from '../backend/asaas-sandbox-hold.mjs';

test('diagnostic is disarmed by default, bounded, one-shot and never returns metadata',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'shape-net-')),file=path.join(dir,'arm'),logs=[];let clock=1000000;
 const app=await startSandboxHold({port:0,host:'127.0.0.1',diagnosticArmFile:file,diagnosticLog:x=>logs.push(x),now:()=>clock}),origin='http://127.0.0.1:'+app.server.address().port;
 const visit=(route=NETWORK_DIAGNOSTIC_PATH,options={})=>fetch(origin+route,options);
 try{
  assert.equal((await visit()).status,404);assert.equal(logs.length,0);
  await writeFile(file,String(clock));assert.equal((await visit('/')).status,200);assert.equal(logs.length,0);
  assert.equal((await visit(NETWORK_DIAGNOSTIC_PATH,{method:'POST',body:'do-not-log-body'})).status,404);assert.equal(logs.length,0);
  const r=await visit(NETWORK_DIAGNOSTIC_PATH,{headers:{cookie:'do-not-log-cookie',authorization:'do-not-log-auth','x-forwarded-host':'sandbox.example.test','x-forwarded-proto':'https','x-forwarded-for':'x'.repeat(250),'x-extra':'do-not-log-extra'}});
  assert.equal(r.status,200);assert.equal(await r.text(),'Visita de teste registrada. Pode voltar ao chat.');assert.equal(logs.length,1);
  const data=JSON.parse(logs[0].slice('SANDBOX_NETWORK_DIAGNOSTIC '.length));assert.deepEqual(Object.keys(data),['remoteAddress','host','forwardedHost','forwardedProto','forwardedFor']);assert.equal(data.forwardedFor.length,200);assert.equal(data.forwardedHost,'sandbox.example.test');assert.doesNotMatch(logs[0],/do-not-log/);
  assert.equal((await visit()).status,404);assert.equal(logs.length,1);
  await writeFile(file,String(clock));clock+=300000;assert.equal((await visit()).status,404);assert.equal(logs.length,1);
  await writeFile(file,String(clock+1));assert.equal((await visit()).status,404);assert.equal(logs.length,1);
  assert.deepEqual(await(await visit('/healthz')).json(),{ready:true,mode:'preparation',financialEnabled:false});
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
