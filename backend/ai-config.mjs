import * as fs from 'node:fs';
import path from 'node:path';

const invalid=()=>new Error('AI configuration unavailable. Check the enabled flag and the dedicated private secret file.');
const validKey=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&/^[\x21-\x7e]+$/.test(value);

// Read once at startup; never persist, log or return this credential through an API.
export function resolveAIConfiguration(env,{fsImpl=fs,platform=process.platform,uid=process.getuid?.()}={}){
  const model=env.OPENAI_MODEL||'gpt-5.4-nano';
  if(env.SIM_AI_ENABLED!=='true')return {apiKey:'',model};
  let fd;
  try{
    if(!/^[a-zA-Z0-9._-]{1,100}$/.test(model))throw invalid();
    const direct=env.OPENAI_API_KEY?.trim(),file=env.OPENAI_API_KEY_FILE;
    if(direct&&file)throw invalid();
    if(!file){
      if(env.NODE_ENV==='production'||!validKey(direct))throw invalid();
      return {apiKey:direct,model};
    }
    const paths=env.NODE_ENV==='production'?path.posix:path;
    if(typeof file!=='string'||!paths.isAbsolute(file)||paths.normalize(file)!==file)throw invalid();
    if(env.NODE_ENV==='production'&&file!=='/run/secrets/sim_openai_api_key')throw invalid();
    // Reject symlinks in the file and its ancestors before opening the file.
    for(let current=file;;current=paths.dirname(current)){
      if(fsImpl.lstatSync(current).isSymbolicLink())throw invalid();
      if(paths.dirname(current)===current)break;
    }
    const original=fsImpl.lstatSync(file);
    fd=fsImpl.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    const stat=fsImpl.fstatSync(fd);
    if(!stat.isFile()||stat.size<1||stat.size>4096||stat.dev!==original.dev||stat.ino!==original.ino)throw invalid();
    // POSIX: allow group read for the runtime, forbid group write/execute and all world access.
    if(platform!=='win32'&&((stat.mode&0o037)!==0||![0,uid].includes(stat.uid)))throw invalid();
    // Bound the read even if the file grows after the metadata check.
    const buffer=Buffer.alloc(4097);const count=fsImpl.readSync(fd,buffer,0,buffer.length,0);
    if(count>4096)throw invalid();
    const apiKey=buffer.subarray(0,count).toString('utf8').trim();buffer.fill(0);
    if(!validKey(apiKey))throw invalid();
    return {apiKey,model};
  }catch{throw invalid();}
  finally{if(fd!==undefined){try{fsImpl.closeSync(fd);}catch{/* No credential or filesystem diagnostics in logs. */}}}
}

export function aiCapabilities(role,ai={}){
  const permitted=['coach','nutrition'].includes(role);
  const configured=validKey(ai.apiKey);
  return {available:permitted&&configured,reason:!permitted?'role-restricted':!configured?'disabled':'available',mode:'synthetic-development',writesPerformed:false};
}
