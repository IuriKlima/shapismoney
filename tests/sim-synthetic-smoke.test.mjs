import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runSyntheticSmoke,smokePreflight,smokeInputs,SMOKE_MODEL} from '../scripts/synthetic-proposal-smoke.mjs';
import {responsesProposalAdapter} from '../backend/proposal-responses.mjs';
const temporary=()=>mkdtempSync(path.join(tmpdir(),'shape-synthetic-smoke-'));
test('synthetic smoke is dry by default, needs process key and stays below authorization without reading env files',async()=>{
 const directory=temporary();try{const p=smokePreflight();assert.equal(p.totalMaxEstimateUSD,.0192);assert.ok(p.requests.every(r=>r.inputTokenUpperBound<=8000));assert.equal(p.model,SMOKE_MODEL);
  const factory=()=>assert.fail('No dispatch without explicit execute + existing key');assert.equal((await runSyntheticSmoke({key:undefined,directory,adapterFactory:factory})).executed,false);assert.equal((await runSyntheticSmoke({execute:true,key:'',directory,adapterFactory:factory})).executed,false);assert.equal(existsSync(path.join(directory,'authorized-synthetic-smoke.json')),false);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('durable smoke reserves both attempts first; failure/timeout counts, usage persists, restart cannot repeat',async()=>{
 const directory=temporary();let calls=0;try{const result=await runSyntheticSmoke({execute:true,key:'fictitious-test-only-key-value',directory,adapterFactory:({onUsage})=>({async generate(input){const j=JSON.parse(readFileSync(path.join(directory,'authorized-synthetic-smoke.json'),'utf8'));assert.equal(j.attempts.length,2);assert.equal(j.reservedUSD,.0192);assert.equal(j.requestAttempts,++calls);if(input.kind==='training')throw Error('Fictitious timeout');await onUsage({inputTokens:50,outputTokens:20});return {synthetic:true};}})});
  assert.equal(calls,2);assert.equal(result.attempts[0].state,'failed-or-unknown');assert.equal(result.attempts[0].retryAllowed,false);assert.equal(result.attempts[1].state,'schema-validated');assert.equal(result.attempts[1].usage.inputTokens,50);assert.equal(result.realBillingVerified,false);
  await assert.rejects(()=>runSyntheticSmoke({execute:true,key:'fictitious-test-only-key-value',directory,adapterFactory:()=>assert.fail('Never resend')}));assert.equal(calls,2);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('Responses adapter usage hook reports only counters and observes schema failures without exposing response text',async()=>{
 const input=smokeInputs()[0],usage=[];const adapter=responsesProposalAdapter({apiKey:'fictitious-test-only-key-value',model:SMOKE_MODEL,mockOnly:true,onUsage:v=>usage.push(v),fetchImpl:async()=>new Response(JSON.stringify({status:'completed',usage:{input_tokens:50,output_tokens:20},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{}'}]}]}))});
 await assert.rejects(()=>adapter.generate(input));assert.deepEqual(usage,[{inputTokens:50,outputTokens:20}]);
});
