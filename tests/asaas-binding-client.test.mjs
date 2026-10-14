import test from 'node:test';import assert from 'node:assert/strict';
import {asaasSandboxClient} from '../backend/commerce/asaas-client.mjs';
const options={enabled:true,networkAccessApproved:true,accountId:'fixture',apiKey:'synthetic-never-real-key-00000000000000'};
test('official account check returns only id, mismatches are rejected and transport failures do not prove identity',async()=>{
 let response=()=>Response.json({id:'fixture',sensitive:'not returned'}),calls=0;
 const c=asaasSandboxClient({...options,fetchImpl:async(url,o)=>{calls++;assert.equal(url,'https://api-sandbox.asaas.com/v3/myAccount/status');assert.equal(o.method,'GET');return response();}});
 assert.equal(calls,0);assert.deepEqual(await c.verifyAccount(),{id:'fixture'});
 response=()=>Response.json({id:'different'});await assert.rejects(c.verifyAccount(),{status:409});
 response=()=>Response.json({id:'fixture'},{status:401});await assert.rejects(c.verifyAccount(),{status:503});
 response=()=>Response.json({});await assert.rejects(c.verifyAccount(),{status:503});
});
test('payment reader preserves checkout ID and explicit null reference across complete pagination without retaining raw details',async()=>{
 const urls=[];const c=asaasSandboxClient({...options,fetchImpl:async url=>{urls.push(url);const offset=new URL(url).searchParams.get('offset');return Response.json({hasMore:offset==='0',data:[{id:'pay_'+offset,checkoutSession:'checkout_fixture',externalReference:null,customer:'cus_fixture',value:499,billingType:'PIX',status:'PENDING',sensitive:'discard'}]});}});
 const rows=await c.paymentsByCheckout('checkout_fixture');assert.equal(rows.length,2);assert.equal(rows[0].checkoutSession,'checkout_fixture');assert.equal(rows[0].externalReference,null);assert.equal(rows[0].sensitive,undefined);assert.ok(urls.every(u=>new URL(u).searchParams.get('checkoutSession')==='checkout_fixture'));assert.equal(new URL(urls[1]).searchParams.get('offset'),'1');
});
