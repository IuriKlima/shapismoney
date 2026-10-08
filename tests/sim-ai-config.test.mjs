import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,chmodSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveAIConfiguration,aiCapabilities} from '../backend/ai-config.mjs';
const dummy='fixture-ai-credential';
const env={SIM_AI_ENABLED:'true'};
const rejected=work=>assert.throws(work,error=>error.message==='AI configuration unavailable. Check the enabled flag and the dedicated private secret file.'&&!error.message.includes(dummy));

test('disabled AI never touches secret files; development source stays explicit',()=>{
  assert.deepEqual(resolveAIConfiguration({OPENAI_API_KEY:dummy,OPENAI_API_KEY_FILE:'/missing',SIM_AI_ENABLED:'false'},{fsImpl:{lstatSync(){assert.fail('disabled AI read filesystem');}}}),{apiKey:'',model:'gpt-5.4-nano'});
  assert.equal(resolveAIConfiguration({...env,OPENAI_API_KEY:dummy}).apiKey,dummy);
  for(const values of [{},{OPENAI_API_KEY:dummy,NODE_ENV:'production'},{OPENAI_API_KEY:dummy,OPENAI_API_KEY_FILE:'/missing'},{OPENAI_API_KEY:'bad key'},{OPENAI_API_KEY:dummy,OPENAI_MODEL:'invalid/model'},{OPENAI_API_KEY_FILE:'relative'},{OPENAI_API_KEY_FILE:'/wrong',NODE_ENV:'production'}])rejected(()=>resolveAIConfiguration({...env,...values}));
});

test('bounded private file read, missing/empty/oversized contents and errors are redacted',()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'sim-ai-config-')),file=path.join(directory,'credential');
  try{
    for(const value of ['','x'.repeat(4097),'fixture secret','fixture\0secret']){if(existsSync(file))chmodSync(file,0o600);writeFileSync(file,value,{mode:0o600});chmodSync(file,0o400);rejected(()=>resolveAIConfiguration({...env,OPENAI_API_KEY_FILE:file}));}
    chmodSync(file,0o600);writeFileSync(file,dummy+'\n',{mode:0o600});chmodSync(file,0o400);assert.equal(resolveAIConfiguration({...env,OPENAI_API_KEY_FILE:file}).apiKey,dummy);
    rejected(()=>resolveAIConfiguration({...env,OPENAI_API_KEY_FILE:path.join(directory,'missing')}));
  }finally{rmSync(directory,{recursive:true,force:true});}
});

const privateStat={isSymbolicLink:()=>false,isFile:()=>true,size:dummy.length,dev:1,ino:2,mode:0o100440,uid:0};
function fakeFS(overrides={}){
  return {lstatSync:()=>privateStat,openSync:()=>9,fstatSync:()=>privateStat,readSync:(_fd,buffer)=>{buffer.write(dummy);return dummy.length;},closeSync:()=>{},...overrides};
}
const production={...env,NODE_ENV:'production',OPENAI_API_KEY_FILE:'/run/secrets/sim_openai_api_key'};
test('POSIX secret rejects symlinks, unsafe permissions/owner, non-files and inode replacement',()=>{
  // Use the host path implementation for fixture paths; production runtime path is POSIX.
  const file=path.resolve('fixture-ai-file'),settings={...env,OPENAI_API_KEY_FILE:file};
  for(const replacement of [{mode:0o100444},{mode:0o100460},{mode:0o100450},{uid:2000},{isFile:()=>false},{ino:3}])rejected(()=>resolveAIConfiguration(settings,{platform:'linux',uid:1000,fsImpl:fakeFS({fstatSync:()=>({...privateStat,...replacement})})}));
  let opened=false;rejected(()=>resolveAIConfiguration(settings,{fsImpl:fakeFS({lstatSync:()=>({...privateStat,isSymbolicLink:()=>true}),openSync:()=>{opened=true;return 9;}})}));assert.equal(opened,false);
  let closed=false;rejected(()=>resolveAIConfiguration(settings,{fsImpl:fakeFS({readSync(){throw Error(dummy);},closeSync(){closed=true;}})}));assert.equal(closed,true);
  rejected(()=>resolveAIConfiguration(settings,{fsImpl:fakeFS({readSync:()=>4097})}));
  assert.equal(resolveAIConfiguration(settings,{platform:'linux',uid:1000,fsImpl:fakeFS()}).apiKey,dummy);
  assert.equal(resolveAIConfiguration(production,{platform:'linux',uid:1000,fsImpl:fakeFS()}).apiKey,dummy);
});

test('public capabilities expose only synthetic availability for existing professional roles',()=>{
  for(const role of ['admin','student','unknown'])assert.deepEqual(aiCapabilities(role,{apiKey:dummy}),{available:false,reason:'role-restricted',mode:'synthetic-development',writesPerformed:false});
  for(const role of ['coach','nutrition']){
    assert.equal(aiCapabilities(role).available,false);assert.equal(aiCapabilities(role).reason,'disabled');
    const result=aiCapabilities(role,{apiKey:dummy});assert.equal(result.available,true);assert.equal(result.reason,'available');assert.ok(!JSON.stringify(result).includes(dummy));
  }
});
