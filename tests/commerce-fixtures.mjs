import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isolatedFixture} from './backend-fixtures.mjs';
import {asyncLocalStore} from '../backend/async-store.mjs';
import {openLocalStore} from '../backend/store.mjs';
import {asaasMockClient} from '../backend/commerce/asaas-mock.mjs';
import {localCommerce} from '../backend/commerce/flow.mjs';
export const MOCK_WEBHOOK_TOKEN='mock-only-not-a-real-secret-0000000000000000000';
export async function commerceFixture(options={}){
 const f=await isolatedFixture();f.store.exec(readFileSync(new URL('../backend/commerce/schema.sql',import.meta.url),'utf8'));
 const org=f.store.get('SELECT org_id FROM users WHERE id=?',f.ids.student).org_id,otherOrg=f.store.get('SELECT org_id FROM users WHERE id=?',f.ids.outsider).org_id;
 const buyerId=randomUUID(),otherBuyerId=randomUUID(),accountId=options.accountId||'fixture-asaas-account',customer='cus_fixture_buyer';let clock=1700000000000,raw=f.store,store=asyncLocalStore(raw),payments=[],installments=[],createError=false,listError=false;
 for(const [id,orgId,customerId] of [[buyerId,org,customer],[otherBuyerId,otherOrg,'cus_fixture_other']])f.store.run('INSERT INTO commerce_buyers(id,org_id,customer_id,environment,account_id) VALUES (?,?,?,?,?)',id,orgId,customerId,'mock',accountId);
 const calls=[];const sessions=new Map([['buyer-session',{buyerId,orgId:org}],['other-session',{buyerId:otherBuyerId,orgId:otherOrg}]]);
 const proofs=new Map([['one-use-proof',{buyerId,orgId:org,userId:f.ids.student}],['wrong-org-proof',{buyerId,orgId:otherOrg,userId:f.ids.outsider}]]);
 const client=asaasMockClient({accountId,transport:{kind:'mock',async request(req){calls.push(req);if(req.method==='POST'){if(createError)throw Error('INJECTED PRIVATE DIAGNOSTIC');return {id:'checkout_'+req.body.externalReference};}if(listError)throw Error('INJECTED PROVIDER FAILURE');const query=new URL('https://fixture.invalid'+req.path).searchParams;const source=query.has('installment')?installments:payments;const offset=Number(query.get('offset'));return {hasMore:offset+100<source.length,data:source.slice(offset,offset+100)};}}});
 const configuration=()=>({store,client,resolvePrincipal:async token=>sessions.get(token)||null,proveIdentity:async token=>{const proof=proofs.get(token);proofs.delete(token);return proof||null;},resolveAdmin:async token=>token==='admin-session'?{userId:f.ids.admin}:token==='outsider-admin-session'?{userId:f.ids.outsider}:null,webhookToken:MOCK_WEBHOOK_TOKEN,publicOrigin:'https://shape.fixture.invalid',now:()=>clock,...options});
 let commerce=localCommerce(configuration());
 return {...f,org,otherOrg,buyerId,otherBuyerId,accountId,customer,client,calls,sessions,proofs,get store(){return raw;},get commerce(){return commerce;},configuration,
 async order(sku='quarterly',billingType='PIX',key=randomUUID()){return commerce.createOrder('buyer-session',{sku,billingType},key);},
 async checkout(o){return commerce.createCheckout('buyer-session',o.id);},
 payment(o,changes={}){return {id:'pay_'+o.id,customer,externalReference:o.external_reference,value:o.amount_cents/100,netValue:1,billingType:o.billing_type,status:o.billing_type==='PIX'?'RECEIVED':'CONFIRMED',...changes};},
 setPayments(value){payments=value;},setInstallments(value){installments=value;},setCreateError(value){createError=value;},setListError(value){listError=value;},advance(ms){clock+=ms;},
 async webhook(o,event='CHECKOUT_PAID',changes={}){const payload={id:'evt_'+randomUUID(),event,account:{id:accountId},checkout:{id:o.checkout_id,externalReference:o.external_reference,customer},...changes};return commerce.acceptWebhook({headers:{'asaas-access-token':MOCK_WEBHOOK_TOKEN},rawBody:JSON.stringify(payload)});},
 async reopen(){await store.close();raw=openLocalStore(f.filename);store=asyncLocalStore(raw);commerce=localCommerce(configuration());},
 async close(){await store.close();}
 };
}
