import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {proposalSpecs} from '../backend/proposal-specs.mjs';
import {trainingProposalSchemaFor,validateSchema,responsesProposalAdapter,proposalInstructions} from '../backend/proposal-responses.mjs';
import {sessionsFixture,fixtureSessionPayload,fixtureResponse} from './training-sessions-fixtures.mjs';

function context(){
 const method={exercises:[0,1].map(i=>({id:'fixture-'+i,name:'Movimento fictício '+i,status:'approved',environments:['fixture-gym'],allowedAlternativeIds:['fixture-'+(1-i)]})),rules:[{id:'fixture-rule',sourceId:'fixture-source',section:'fixture-section'}],sources:[{id:'fixture-source',version:'fixture-v1',sha256:createHash('sha256').update('fictitious protocol only').digest('hex')}]};
 const input={kind:'training',untrustedFacts:{days:2,environment:['fixture-gym']},untrustedMethod:method};
 const payload={title:'Proposta fictícia independente',daysPerWeek:2,sessions:[2,5].map((weekday,i)=>({id:'block_'+i,name:'Bloco fictício '+i,weekday,exercises:[{exerciseId:'fixture-'+i,sets:3,reps:10,restSeconds:90,rir:2,reason:'Justificativa fictícia para verificar o contrato do servidor.',evidence:['days'],ruleId:'fixture-rule',alternatives:[{exerciseId:'fixture-'+(1-i),reason:'Alternativa fictícia explicitamente permitida no catálogo.',evidence:['environment'],ruleId:'fixture-rule'}]}]}))};
 const helpers={deny:(status,message)=>{throw Object.assign(Error(message),{status});},exact:(value,keys)=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),keys.slice().sort());},text:(value,min,max)=>{assert.ok(typeof value==='string'&&value.trim().length>=min&&value.length<=max);return value.trim();}};
 const validate=(value=payload,configuration={mode:'local-simulation',methodology:method})=>proposalSpecs({...helpers,configuration}).training.validate(value,{facts:input.untrustedFacts});
 return {input,payload,method,helpers,validate};
}

test('training schema and server share text bounds, session IDs and available frequency; dose remains professional choice',()=>{
 const f=context(),schema=trainingProposalSchemaFor(f.input);validateSchema(f.payload,schema);const normalized=f.validate();assert.equal(normalized.sessions[0].exercises[0].sets,3);assert.equal(normalized.sessions[0].exercises[0].reference.sourceVersion,'fixture-v1');
 assert.equal(schema.properties.daysPerWeek.maximum,2);assert.equal(schema.properties.sessions.maxItems,2);assert.match(proposalInstructions,/sessions.length=daysPerWeek/);assert.match(proposalInstructions,/weekday únicos/);
 for(const [mutate,field] of [[v=>{v.title='x';},'$.title'],[v=>{v.daysPerWeek=3;},'$.daysPerWeek'],[v=>{v.sessions[0].name='x';},'$.sessions[0].name'],[v=>{v.sessions[0].id='bad id';},'$.sessions[0].id'],[v=>{v.sessions[0].exercises[0].reason='x';},'$.sessions[0].exercises[0].reason'],[v=>{v.sessions[0].exercises[0].alternatives[0].reason='        ';},'$.sessions[0].exercises[0].alternatives[0].reason']]){const value=structuredClone(f.payload);mutate(value);assert.throws(()=>validateSchema(value,schema),e=>e.validationDiagnostic.field===field);assert.throws(()=>f.validate(value));}
});

test('cross-item uniqueness and session-count relationships remain mandatory server rules beyond JSON schema',()=>{
 const f=context();for(const [mutate,field,rule] of [[v=>{v.sessions[1].weekday=2;},'$.sessions[1].weekday','unique-weekday'],[v=>{v.sessions[1].id=v.sessions[0].id;},'$.sessions[1].id','unique-session-id'],[v=>{v.sessions.pop();},'$.sessions','session-count']]){const value=structuredClone(f.payload);mutate(value);validateSchema(value,trainingProposalSchemaFor(f.input));assert.throws(()=>f.validate(value),e=>e.validationDiagnostic.field===field&&e.validationDiagnostic.rule===rule);}
});

test('methodology must be configured at the declared API location; misplaced/missing configuration fails closed with a safe rule',()=>{
 const f=context();assert.throws(()=>proposalSpecs({...f.helpers,methodology:f.method,configuration:{mode:'local-simulation'}}).training.validate(f.payload,{facts:f.input.untrustedFacts}),e=>e.status===503&&e.validationDiagnostic.field==='$.configuration.methodology'&&e.validationDiagnostic.rule==='methodology-required'&&!e.message.includes('undefined'));
 assert.equal(f.validate(f.payload,{mode:'local-simulation',methodologies:{training:f.method}}).sessions.length,2);
});

test('catalog alternatives, evidence and source provenance stay enforced on application confirmation',()=>{
 const f=context();for(const mutate of [v=>{v.exercises[0].status='pending';},v=>{v.exercises[0].environments=['elsewhere'];},v=>{v.exercises[0].allowedAlternativeIds=[];},v=>{v.sources[0].sha256='wrong';},v=>{delete v.sources[0].version;},v=>{delete v.rules[0].section;}]){const method=structuredClone(f.method);mutate(method);assert.throws(()=>f.validate(f.payload,{mode:'local-simulation',methodology:method}),e=>e.status===400&&!!e.validationDiagnostic.rule);}
 const value=structuredClone(f.payload);value.sessions[0].exercises[0].alternatives[0].evidence=Array(6).fill('days');assert.throws(()=>f.validate(value),e=>e.validationDiagnostic.rule==='fact-evidence');
});

test('adapter uses context-specific schema and rejects invalid context before mock transport',async()=>{
 const f=context();let wire,calls=0;const adapter=responsesProposalAdapter({apiKey:'fixture-key-only',model:'fixture-model',mockOnly:true,fetchImpl:async(_u,o)=>{calls++;wire=JSON.parse(o.body);return fixtureResponse(f.payload);}});await adapter.generate(f.input);assert.equal(wire.text.format.schema.properties.daysPerWeek.maximum,2);assert.equal(wire.text.format.schema.properties.sessions.maxItems,2);await assert.rejects(()=>adapter.generate({...f.input,untrustedFacts:{...f.input.untrustedFacts,days:8}}),/context unavailable/);assert.equal(calls,1);
});

test('application mock generation refuses short reasons and repeated weekdays without creating drafts or refunding reservations',async()=>{
 for(const [mutate,status] of [[v=>{v.sessions[0].exercises[0].reason='x';},502],[v=>{v.sessions[1].weekday=v.sessions[0].weekday;},400]]){const f=await sessionsFixture({fetchImpl:async(_u,o)=>{const value=fixtureSessionPayload(JSON.parse(JSON.parse(o.body).input));mutate(value);return fixtureResponse(value);}});try{await f.consent();const response=await f.prepare();assert.equal(response.status,status);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM plans').n,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_monthly_reservations').n,1);assert.ok(!JSON.stringify(response.data).includes('fixture-only-not-a-real-api-key'));}finally{await f.close();}}
});
