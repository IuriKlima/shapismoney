// One authorized, synthetic-only pair. No env files, retries, production flags or publications.
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,rmdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {responsesProposalAdapter,proposalInputTokenUpperBound,trainingProposalSchemaFor,nutritionProposalSchemaFor} from '../backend/proposal-responses.mjs';
export const SMOKE_AUTHORIZATION='shape-synthetic-smoke-2026-10-10-two-requests';
export const SMOKE_MODEL='gpt-4.1-mini-2025-04-14';
export const SMOKE_LIMITS=Object.freeze({requests:2,inputTokens:8000,outputTokens:4000,totalUSD:.10,inputUSDPerMillion:.40,outputUSDPerMillion:1.60});
const source={id:'synthetic-only-source',reference:'Invented fixture; no ebook or student data',version:'test-1',sha256:createHash('sha256').update('Entirely fictitious, test-only professional rules').digest('hex')};
export function smokeInputs(){return [
 {kind:'training',untrustedFacts:{days:1,environment:['Synthetic test room']},untrustedMethod:{status:'synthetic-fixture',fixtureOnly:true,sources:[source],rules:[{id:'synthetic-rule',sourceId:source.id,section:'Synthetic section',criterion:'Test-only reviewer approved one generic movement in the synthetic room.',providerTransferApproved:true}],exercises:[{id:'synthetic-movement',name:'Generic invented test movement',status:'approved',environments:['Synthetic test room'],equipment:['synthetic-none'],limitations:[],allowedAlternativeIds:[]}] }},
 {kind:'nutrition',untrustedFacts:{targets:{energyKcal:100,proteinG:10,carbsG:10,fatG:2},tolerances:{energyKcal:1,proteinG:1,carbsG:1,fatG:1},allergies:[],preferences:{preferredFoodIds:[],excludedFoodIds:[]},meals:[{name:'Synthetic meal',itemCount:1}]},untrustedMethod:{kind:'nutrition-reviewed-context',fixtureOnly:true,sources:[source],rules:[{id:'synthetic-food-rule',sourceId:source.id,section:'Synthetic section',text:'Test-only reviewer approved exactly 100 grams of the invented cooked food in the single meal.',providerTransferApproved:true}],foods:[{id:'synthetic-food',name:'Invented test food',status:'approved',preparation:'cooked',allergens:[],mayContain:[],composition:{energyKcal:100,proteinG:10,carbsG:10,fatG:2}}]}}
 ];}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function smokePreflight(){const inputs=smokeInputs(),perAttemptMaxUSD=(SMOKE_LIMITS.inputTokens*SMOKE_LIMITS.inputUSDPerMillion+SMOKE_LIMITS.outputTokens*SMOKE_LIMITS.outputUSDPerMillion)/1e6;
 const requests=inputs.map(input=>({kind:input.kind,inputTokenUpperBound:proposalInputTokenUpperBound(input),schemaHash:hash(input.kind==='training'?trainingProposalSchemaFor(input):nutritionProposalSchemaFor(input)),inputHash:hash(input)}));
 if(requests.some(r=>r.inputTokenUpperBound>8000)||perAttemptMaxUSD*2>SMOKE_LIMITS.totalUSD)throw Error('Synthetic smoke exceeds authorized bounds');
 return {authorization:SMOKE_AUTHORIZATION,model:SMOKE_MODEL,limits:SMOKE_LIMITS,perAttemptMaxUSD,totalMaxEstimateUSD:perAttemptMaxUSD*2,tariffSource:'https://developers.openai.com/api/docs/models/gpt-4.1-mini',tariffCheckedAt:'2026-10-10',requests,syntheticOnly:true,realBillingVerified:false,publications:0,productionFlagsChanged:false};}
function durable(file,value){const temp=file+'.tmp';if(existsSync(temp)&&lstatSync(temp).isSymbolicLink())throw Error('Unsafe ledger');const fd=openSync(temp,'w',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,file);}
export async function runSyntheticSmoke({execute=false,key=process.env.OPENAI_API_KEY,directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.qa'),adapterFactory=responsesProposalAdapter}={}){
 const preflight=smokePreflight();if(!execute)return {...preflight,executed:false,existingProcessKeyAvailable:typeof key==='string'&&key.length>20};
 if(typeof key!=='string'||key.length<21)return {...preflight,executed:false,blockedReason:'existing-shape-key-not-available-in-process'};
 mkdirSync(directory,{recursive:true});if(lstatSync(directory).isSymbolicLink())throw Error('Unsafe ledger directory');const ledgerFile=path.join(directory,'authorized-synthetic-smoke.json'),lock=path.join(directory,'authorized-synthetic-smoke.lock');
 mkdirSync(lock);try{
  if(existsSync(ledgerFile))throw Error('Authorization already reserved; never repeat or retry');
  const ledger={...preflight,executed:true,reservedUSD:preflight.totalMaxEstimateUSD,attempts:preflight.requests.map(r=>({...r,state:'reserved',maxEstimateUSD:preflight.perAttemptMaxUSD})),beganAt:new Date().toISOString(),requestAttempts:0};durable(ledgerFile,ledger);
  for(const [index,input] of smokeInputs().entries()){
   const attempt=ledger.attempts[index];attempt.state='attempted';attempt.startedAt=new Date().toISOString();ledger.requestAttempts++;durable(ledgerFile,ledger);
   try{const adapter=adapterFactory({apiKey:key,model:SMOKE_MODEL,onUsage:async usage=>{if(usage.inputTokens>8000||usage.outputTokens>4000)throw Error('Usage exceeds authorization');attempt.usage=usage;attempt.usageEstimateUSD=(usage.inputTokens*.40+usage.outputTokens*1.60)/1e6;durable(ledgerFile,ledger);}});
    const output=await adapter.generate(input,{signal:AbortSignal.timeout(20000)});attempt.state='schema-validated';attempt.outputHash=hash(output);durable(path.join(directory,'synthetic-smoke-'+input.kind+'.json'),{syntheticOnly:true,reviewRequired:true,notPublished:true,output});
   }catch{attempt.state='failed-or-unknown';attempt.retryAllowed=false;}
   attempt.finishedAt=new Date().toISOString();durable(ledgerFile,ledger);
  }
  ledger.finishedAt=new Date().toISOString();ledger.knownUsageEstimateUSD=ledger.attempts.reduce((s,a)=>s+(a.usageEstimateUSD||0),0);ledger.reservationRetainedUSD=ledger.reservedUSD;durable(ledgerFile,ledger);return ledger;
 }finally{rmdirSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.slice(2).some(a=>a!=='--execute')){console.error('Only --execute is supported; no credentials or fixture content arguments.');process.exitCode=1;}else{
  try{console.log(JSON.stringify(await runSyntheticSmoke({execute:process.argv.includes('--execute')}),null,2));}catch{console.error('Synthetic smoke blocked; inspect the durable ledger without retrying.');process.exitCode=1;}
 }
}
