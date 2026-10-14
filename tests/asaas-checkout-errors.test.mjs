import test from 'node:test';
import assert from 'node:assert/strict';
import {asaasSandboxClient,isDefinitiveCheckoutRejection} from '../backend/commerce/asaas-client.mjs';

const body={customer:'cus_fixture',externalReference:'order_fixture',billingTypes:['PIX'],chargeTypes:['DETACHED'],minutesToExpire:60,items:[{name:'Test',description:'Synthetic',quantity:1,value:499}],callback:{successUrl:'https://fixture.invalid/ok',cancelUrl:'https://fixture.invalid/cancel',expiredUrl:'https://fixture.invalid/expired'}};
const validation={errors:[{code:'invalid_object',description:'private provider text'}]};
test('only a complete structured checkout validation refusal is definitive; everything uncertain stays closed',async t=>{
 const cases=[
  ['validation',()=>Response.json(validation,{status:400}),true],
  ['server failure',()=>Response.json(validation,{status:500}),false],
  ['rate limit',()=>Response.json(validation,{status:429}),false],
  ['unrecognized error',()=>Response.json({errors:[{code:'new_provider_error'}]},{status:400}),false],
  ['contradictory id',()=>Response.json({...validation,id:'checkout_fixture'},{status:400}),false],
  ['html gateway error',()=>new Response('<html>error</html>',{status:400}),false],
  ['truncated JSON',()=>new Response('{"errors":',{status:400,headers:{'Content-Type':'application/json'}}),false],
  ['empty errors',()=>Response.json({errors:[]},{status:400}),false],
  ['oversized body',()=>Response.json({errors:[{code:'invalid_object',description:'x'.repeat(1024*1024)}]},{status:400}),false],
  ['network failure',()=>{throw Error('offline');},false],
  ['timeout',()=>new Promise(()=>{}),false],
  ['malformed success',()=>Response.json({}),false],
 ];
 for(const [name,response,definitive] of cases)await t.test(name,async()=>{
  let calls=0;const client=asaasSandboxClient({enabled:true,networkAccessApproved:true,accountId:'fixture',apiKey:'synthetic-never-real-key-00000000000000',timeoutMs:100,fetchImpl:async()=>{calls++;return response();}});
  await assert.rejects(client.createCheckout(body),e=>{assert.equal(isDefinitiveCheckoutRejection(e),definitive);assert.equal(e.status,definitive?422:503);assert.ok(!e.message.includes('private provider text'));return true;});assert.equal(calls,1);
 });
 assert.equal(isDefinitiveCheckoutRejection({status:422,definitive:true}),false);
});
