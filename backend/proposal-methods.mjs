import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const fail=()=>{throw Error('Private method configuration rejected');};
export const methodDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validatePrivateMethod(value){
 const str=(v,max=500)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
 if(!value||value.schemaVersion!=='SIM_PRIVATE_METHOD_V1'||!['training','nutrition'].includes(value.kind)||!str(value.version,80)||! /^[a-zA-Z0-9_-]+$/.test(value.version)||! /^[a-f0-9-]{36}$/.test(value.orgId)||!['pending-review','reviewed'].includes(value.status))fail();
 if(!Array.isArray(value.sources)||value.sources.length<1||value.sources.length>20||value.sources.some(s=>!str(s.id,80)||! /^[a-f0-9]{64}$/.test(s.sha256)||!str(s.version,80)||!str(s.reference,300)))fail();
 if(!Array.isArray(value.rules)||value.rules.length<1||value.rules.length>30||new Set(value.rules.map(r=>r.id)).size!==value.rules.length||value.rules.some(r=>!str(r.id,80)||!str(r.criterion)||!value.sources.some(s=>s.id===r.sourceId)||!str(r.section,80)||typeof r.providerTransferApproved!=='boolean'))fail();
 if(!Array.isArray(value.exercises)||value.exercises.length>100||value.exercises.some(e=>!str(e.id,80)||!str(e.name,100)||!['pending-review','approved'].includes(e.status)||!Array.isArray(e.environments)||!Array.isArray(e.equipment)||!Array.isArray(e.limitations)||[...e.environments,...e.equipment,...e.limitations].some(v=>!str(v,100))))fail();
 if(value.kind==='training'&&value.status==='reviewed'&&(!value.exercises.length||value.exercises.some(e=>e.status!=='approved'||!e.environments.length)))fail();
 if(value.status==='reviewed'&&(!value.review||! /^[a-f0-9-]{36}$/.test(value.review.by)||!['admin','coach','nutrition'].includes(value.review.role)||!Number.isSafeInteger(value.review.at)||typeof value.review.providerTransferApproved!=='boolean'||value.kind==='nutrition'&&value.review.role!=='nutrition'))fail();
 if(Buffer.byteLength(JSON.stringify(value))>65536)fail();return value;
}
export function methodPreview(value){validatePrivateMethod(value);return {kind:value.kind,version:value.version,status:value.status,hash:methodDigest(value),rules:value.rules.length,exercises:value.exercises.length,pendingExercises:value.exercises.filter(e=>e.status!=='approved'||!e.environments.length).length,sourceVersions:value.sources.map(({id,version,sha256})=>({id,version,sha256})),providerTransferApproved:value.review?.providerTransferApproved===true,activationPerformed:false};}
function privateDirectory(workspace){
 const root=realpathSync(workspace),qa=path.join(root,'.qa');mkdirSync(qa,{recursive:true,mode:0o700});if(lstatSync(qa).isSymbolicLink()||realpathSync(qa)!==qa)fail();
 const dir=path.join(qa,'methods');mkdirSync(dir,{recursive:true,mode:0o700});if(lstatSync(dir).isSymbolicLink()||realpathSync(dir)!==dir)fail();
 const result=spawnSync('git',['check-ignore','-q','--','.qa/methods/method.json'],{cwd:root,stdio:'ignore'});if(result.status!==0)fail();return dir;
}
export function readMethodCandidate(filename){const stat=lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)fail();return validatePrivateMethod(JSON.parse(readFileSync(filename,'utf8')));}
export function importPrivateMethod({workspace,candidate,expectedHash}){
 validatePrivateMethod(candidate);if(methodDigest(candidate)!==expectedHash)fail();
 // Import cannot smuggle approval, even if the supplied file calls itself reviewed.
 const value={...candidate,status:'pending-review'};delete value.review;const directory=privateDirectory(workspace),filename=path.join(directory,value.version+'.pending.json');
 writeFileSync(filename,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});return {filename,preview:methodPreview(value)};
}
export function reviewPrivateMethod({workspace,candidate,expectedHash,actor,credential,confirmed,providerTransferApproved=false,now=Date.now()}){
 validatePrivateMethod(candidate);if(candidate.status!=='pending-review'||methodDigest(candidate)!==expectedHash||confirmed!==true||!actor?.active||actor.org_id!==candidate.orgId)fail();
 if(candidate.kind==='training'&&!['admin','coach'].includes(actor.role)||candidate.kind==='nutrition'&&(actor.role!=='nutrition'||credential?.verified!==1||credential.user_id!==actor.id||credential.org_id!==actor.org_id))fail();
 const value=validatePrivateMethod({...candidate,status:'reviewed',review:{by:actor.id,role:actor.role,at:now,providerTransferApproved:providerTransferApproved===true}});
 const filename=path.join(privateDirectory(workspace),value.version+'.reviewed.json');writeFileSync(filename,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});return {filename,preview:methodPreview(value)};
}
