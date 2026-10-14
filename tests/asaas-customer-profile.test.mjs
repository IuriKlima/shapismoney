import test from 'node:test';
import assert from 'node:assert/strict';
import {financialFields,financialStatus} from '../backend/commerce/customer-profile.mjs';
import {asaasSandboxClient} from '../backend/commerce/asaas-client.mjs';
const fields={phone:'1120000000',address:'Rua Teste Sandbox',addressNumber:'99999',postalCode:'01310000',province:'Bairro Teste'};
test('customer schema normalizes phone and CEP; city must come from provider, not a name or IBGE assumption',()=>{
 assert.deepEqual(financialFields({...fields,phone:'(11) 2000-0000',postalCode:'01310-000'}),fields);
 for(const key of Object.keys(fields))assert.throws(()=>financialFields({...fields,[key]:''}),{status:400});
 for(const phone of ['123','+551120000000','11e20000000','0000000000'])assert.throws(()=>financialFields({...fields,phone}),{status:400});
 for(const city of [null,'São Paulo','12565',0,-1,3.5])assert.equal(financialStatus({...fields,city,notificationDisabled:true}).ready,false);
 assert.equal(financialStatus({...fields,city:12565,notificationDisabled:true}).ready,true);
 assert.equal(financialStatus({...fields,city:12565,notificationDisabled:false}).ready,false);
});
test('customer correction only PUTs allowed fields to the existing sandbox ID with notifications disabled',async()=>{
 const calls=[];const client=asaasSandboxClient({enabled:true,environment:'sandbox',accountId:'fixture',apiKey:'synthetic-key-never-real-00000000000000',networkAccessApproved:true,fetchImpl:async(url,options)=>{calls.push({url,...options});return Response.json({id:'cus_fixture'});}});
 await client.updateCustomer('cus_fixture',{...fields,notificationDisabled:true});
 assert.equal(calls.length,1);assert.equal(calls[0].method,'PUT');assert.equal(calls[0].url,'https://api-sandbox.asaas.com/v3/customers/cus_fixture');
 assert.deepEqual(JSON.parse(calls[0].body),{...fields,notificationDisabled:true});
 for(const extra of [{city:3550308},{notificationDisabled:false},{email:'real@example.com'},{customer:'other'}])await assert.rejects(()=>client.updateCustomer('cus_fixture',{...fields,notificationDisabled:true,...extra}),{status:400});
 assert.equal(calls.length,1);
});
