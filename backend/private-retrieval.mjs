import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
// Read-only local search. Its results are untrusted reference text, never clinical rules.
const words=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]{3,}/g)||[];
export function retrievePrivateSources(corpus,query,{limit=5}={}){
  if(corpus?.schemaVersion!=='SIM_LOCAL_CORPUS_V1'||!Array.isArray(corpus.chunks)||!Number.isInteger(limit)||limit<1||limit>10)throw Error('Invalid local corpus');
  const terms=new Set(words(query));
  if(!terms.size)return [];
  return corpus.chunks.map(chunk=>{
    const tokens=new Set(words(chunk.text));
    const score=[...terms].filter(term=>tokens.has(term)).length;
    return {chunk,score};
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.chunk.id.localeCompare(b.chunk.id)).slice(0,limit).map(({chunk,score})=>({...chunk,score,untrustedReference:true,generationConnected:false}));
}

export const referenceConfigurationHash=configuration=>createHash('sha256').update(JSON.stringify(configuration||null)).digest('hex');
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=()=>{throw Object.assign(Error('Referências aprovadas indisponíveis; nenhum trecho pendente substitui a revisão.'),{safe:true,status:409});};

export function readPrivateReferences(filename,workspace){
  const base=realpathSync(path.join(workspace,'.qa')),resolved=path.resolve(filename),stat=lstatSync(resolved);
  if(!resolved.startsWith(base+path.sep)||!stat.isFile()||stat.isSymbolicLink()||realpathSync(resolved)!==resolved||stat.size>2000000)fail();
  return {enabled:true,bundle:JSON.parse(readFileSync(resolved,'utf8'))};
}

// Approval is a separate exact-text allowlist. Extraction never manufactures approval.
// The current professional/method/context remains the authority for prescription.
export async function selectApprovedReferences({configuration,store,now,actor,kind,facts,method,external=false,production=false}){
  if(configuration?.enabled!==true)return null;
  if(production)fail();
  const b=configuration.bundle,review=b?.review,corpus=b?.corpus;
  if(b?.schemaVersion!=='SIM_APPROVED_REFERENCE_BUNDLE_V1'||b.kind!==kind||b.orgId!==actor.org_id||typeof b.version!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(b.version)||corpus?.schemaVersion!=='SIM_LOCAL_CORPUS_V1'||!Array.isArray(corpus.chunks)||!Array.isArray(b.approvals)||b.approvals.length>100||!Number.isSafeInteger(review?.at)||review.at<=0||review.at>now())fail();
  const reviewer=await store.get('SELECT id,active,role,org_id FROM users WHERE id=?',review.by);
  if(reviewer?.active!==1||reviewer.org_id!==actor.org_id||reviewer.role!==review.role||(kind==='training'?!['coach','admin'].includes(review.role):review.role!=='nutrition'))fail();
  if(kind==='nutrition'){
    const credential=await store.get('SELECT org_id,verified,revision FROM nutrition_credentials WHERE user_id=?',review.by);
    if(credential?.verified!==1||credential.org_id!==actor.org_id||credential.revision!==review.credentialRevision)fail();
  }
  if(external&&review.providerTransferApproved!==true)fail();
  if(new Set(b.approvals.map(a=>a.chunkId)).size!==b.approvals.length||new Set(corpus.chunks.map(c=>c.id)).size!==corpus.chunks.length)fail();
  const approved=[];
  for(const a of b.approvals){
    if(a.status!=='approved')continue;
    const chunk=corpus.chunks.find(c=>c.id===a.chunkId),source=method.sources.find(s=>s.id===a.sourceId);
    if(!chunk||!source||typeof chunk.text!=='string'||chunk.text.length>1500||!chunk.text.trim()||!Number.isSafeInteger(chunk.offset)||chunk.offset<0||typeof chunk.locator!=='string'||!/^(page|paragraph):[1-9][0-9]*$/.test(chunk.locator)||a.textSha256!==digest(chunk.text)||a.sourceSha256!==source.sha256||chunk.sourceSha256!==source.sha256||a.sourceVersion!==source.version||!Array.isArray(a.ruleIds)||!a.ruleIds.length||new Set(a.ruleIds).size!==a.ruleIds.length||a.ruleIds.some(id=>!method.rules.some(r=>r.id===id&&r.sourceId===source.id)))fail();
    if(external&&a.providerTransferApproved!==true)continue;
    approved.push({...chunk,effectiveApproval:a});
  }
  const query=Object.values(facts).filter(v=>typeof v==='string'||Array.isArray(v)).flat().join(' ')+' '+method.rules.map(r=>r.criterion||r.text||'').join(' ');
  const selected=retrievePrivateSources({schemaVersion:'SIM_LOCAL_CORPUS_V1',chunks:approved},query,{limit:3});
  if(!selected.length)fail();
  const references=selected.map(c=>({chunkId:c.id,sourceId:c.effectiveApproval.sourceId,sourceVersion:c.effectiveApproval.sourceVersion,sourceSha256:c.sourceSha256,locator:c.locator,offset:c.offset,textSha256:c.effectiveApproval.textSha256,ruleIds:c.effectiveApproval.ruleIds,text:c.text,untrustedReference:true}));
  if(Buffer.byteLength(JSON.stringify(references))>6000)fail();
  return {references,provenance:{bundleVersion:b.version,bundleHash:referenceConfigurationHash(configuration),reviewedBy:review.by,reviewedAt:review.at,retrieved:references.map(reference=>{const metadata={...reference};delete metadata.text;return metadata;})}};
}
