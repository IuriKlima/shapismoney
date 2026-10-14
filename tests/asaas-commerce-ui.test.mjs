import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {commerceUI} from '../public/sim/commerce-ui.js';

const catalog=[{sku:'monthly',name:'Mensal',amountCents:49900,durationMonths:1,billingTypes:['PIX'],maxInstallments:1}];
function harness({api,user={role:'student'},hash=''}={}){
 const calls=[];let currentUser=user;
 const win={location:{hash},history:{replaceState(){}},crypto:{randomUUID},FormData:class{constructor(f){return Object.entries(f.fields);}}};
 const ui=commerceUI({root:{defaultView:win},getUser:()=>currentUser,esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),perform:fn=>fn(),onPasswordComplete(){},api:async(...args)=>{calls.push(args);if(args[0]==='commerce/capabilities')return {enabled:true,mode:'asaas-sandbox',catalog};return api(...args);}});
 const submit=(kind,fields,action)=>ui.submit({target:{fields,className:'commerce-asaas-'+kind,classList:{contains:c=>c==='commerce-asaas-'+kind}},submitter:{value:action},preventDefault(){}});
 const click=(id)=>{const attr=id?'data-commerce-asaas-checkout':'data-commerce-asaas-refresh';return ui.click({target:{closest:()=>({dataset:id?{commerceAsaasCheckout:id}:{commerceAsaasRefresh:''},hasAttribute:k=>k===attr})}});};
 return {ui,calls,submit,click,setUser:u=>{currentUser=u;}};
}
test('server-selected sandbox hides purchase without student session and never calls mock routes',async()=>{
 const h=harness({user:null,api:async()=>({registered:false,orders:[]})});await h.ui.loadPublic();assert.equal(h.ui.render(),'');assert.equal(h.calls.length,1);
 h.setUser({role:'admin'});await h.ui.load();assert.equal(h.ui.render(),'');assert.equal(h.calls.length,1);
 h.setUser({role:'student'});await h.ui.load();assert.match(h.ui.render(),/499,00/);assert.match(h.ui.render(),/ASAAS SANDBOX/);assert.ok(h.calls.slice(1).every(([p])=>p==='asaas/account'));assert.equal(h.ui.passwordView(),'');
 h.ui.reset();h.setUser(null);await h.ui.load();assert.equal(h.ui.render(),'');
});
test('lost order response reuses the same idempotency key; redirect and refresh cannot mark paid',async()=>{
 let fail=true,paid=false;const h=harness({hash:'#purchase-success',api:async(p)=>{if(p==='asaas/account')return {registered:true,orders:[{orderId:'order',plan:catalog[0],status:paid?'paid':'pending',checkoutState:'ready',onboardingAuthorized:paid}]};if(p==='asaas/orders'&&fail)throw Error('lost response');return {};}});
 await h.ui.loadPublic();assert.match(h.ui.render(),/não confirma pagamento/);assert.match(h.ui.render(),/aguardando confirmação/);
 const body={sku:'monthly',billingType:'PIX',confirmed:'on'};await assert.rejects(()=>h.submit('buy',body),/lost/);fail=false;await h.submit('buy',body);
 const orders=h.calls.filter(([p])=>p==='asaas/orders');assert.equal(orders.length,2);assert.equal(orders[0][3],orders[1][3]);assert.deepEqual(orders[0][1],{sku:'monthly',billingType:'PIX',confirmed:true});
 await h.click();assert.match(h.ui.render(),/aguardando confirmação/);assert.ok(!h.calls.some(([p])=>/reconcile|simulate|process/.test(p)));
 paid=true;await h.click();assert.match(h.ui.render(),/autorizada pelo servidor/);
});
test('uncertain customer uses explicit recovery and never resends customer creation',async()=>{
 const h=harness({api:async(p)=>{if(p==='asaas/account')return {registered:false,orders:[]};if(p==='asaas/customer')throw Error('uncertain');return {registered:true};}});await h.ui.loadPublic();
 const body={cpfCnpj:'12345678909',confirmed:'on'};await assert.rejects(()=>h.submit('customer',body),/uncertain/);assert.match(h.ui.render(),/Cadastro inconclusivo/);await h.submit('customer',body);
 assert.equal(h.calls.filter(([p])=>p==='asaas/customer').length,1);assert.deepEqual(h.calls.find(([p])=>p==='asaas/customer/recover')[1],{cpfCnpj:'12345678909'});
});
test('checkout URL allows only hosted sandbox and requires an explicit link click',async()=>{
 let url='https://www.asaas.com/checkoutSession/show?id=test';const h=harness({api:async p=>p==='asaas/account'?{registered:true,orders:[]}:{checkoutUrl:url}});await h.ui.loadPublic();await assert.rejects(()=>h.click('order'),/fora do Asaas Sandbox/);assert.ok(!h.ui.render().includes('href='));
 url='https://sandbox.asaas.com/checkoutSession/show?id=test';await h.click('order');assert.match(h.ui.render(),/href="https:\/\/sandbox\.asaas\.com\/checkoutSession\/show\?id=test"/);assert.match(h.ui.render(),/noopener noreferrer/);
});

test('financial profile UI submits only contact/address fields to PUT and never sends city guesses or another checkout',async()=>{
 let ready=false;const h=harness({api:async(p)=>p==='asaas/account'?{registered:true,financialProfile:{ready,cityName:null},orders:[{orderId:'order',plan:catalog[0],status:'review',checkoutState:'new'}]}:(ready=true,{})});
 await h.ui.loadPublic();for(const field of ['phone','address','addressNumber','postalCode','province','city'])assert.match(h.ui.render(),new RegExp('name="'+field+'"'));
 assert.match(h.ui.render(),/name="city" readonly/);assert.ok(!h.ui.render().includes('data-commerce-asaas-checkout'));
 const fields={phone:'1120000000',address:'Rua Teste Sandbox',addressNumber:'99999',postalCode:'01310000',province:'Bairro Teste'};
 await h.submit('profile',{...fields,city:'wrong value',confirmed:'on'});
 assert.deepEqual(h.calls.find(([p])=>p==='asaas/customer/profile'),['asaas/customer/profile',{...fields,confirmed:true},'PUT']);
 assert.ok(!h.calls.some(([p])=>p.endsWith('/checkout')||p==='asaas/customer'||p==='asaas/orders'));assert.ok(!h.ui.render().includes('data-commerce-asaas-checkout'));
});
