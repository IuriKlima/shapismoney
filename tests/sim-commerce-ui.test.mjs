import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountPersistent} from '../public/sim/persistent.js';
import {commerceUI} from '../public/sim/commerce-ui.js';
import {commerceRuntimeFixture,COMMERCE_PASSWORD} from './commerce-runtime-fixtures.mjs';
const wait=async predicate=>{for(let i=0;i<250;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Commerce DOM UI did not settle');};

test('commerce DOM UI at desktop/mobile widths: repeated order, interrupted return, identity, paid onboarding, reload and logout',async()=>{
 const f=await commerceRuntimeFixture(),originalFetch=globalThis.fetch,originalForm=globalThis.FormData,requests=[];let b=f.client();
 const dom=new JSDOM('<main><div id="local-app"></div><p id="local-status"></p></main>',{url:f.origin+'/local'}),d=dom.window.document;
 globalThis.FormData=dom.window.FormData;globalThis.fetch=async(url,options)=>{const route=url.replace('/api/local/',''),body=options?.body?JSON.parse(options.body):undefined;requests.push({route,body,method:options?.method||'GET'});const r=await b.request(route,body,options?.method||'GET',options?.headers);return {ok:r.status<400,status:r.status,json:async()=>r.data};};
 const q=s=>{const n=d.querySelector(s);assert.ok(n,s);return n;},field=(s,v)=>q(s).value=v,submit=s=>q(s).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));let unmount;
 try{
  unmount=await mountPersistent(d);
  for(const width of [1440,390,320]){dom.window.innerWidth=width;assert.match(q('#commerce-section').textContent,/1\.197,00/);assert.match(q('#commerce-section').textContent,/1\.794,00/);assert.match(q('#commerce-section').textContent,/499,00/);assert.equal(q('.commerce-buy button').disabled,true);assert.equal(q('#commerce-section button:disabled').textContent,'Mensal bloqueado');}
  field('.commerce-register [name=name]','UI commerce fixture');field('.commerce-register [name=email]','commerce@fixture.invalid');submit('.commerce-register');await wait(()=>d.querySelector('.commerce-buy button')&&!q('.commerce-buy button').disabled);
  submit('.commerce-buy');submit('.commerce-buy');await wait(()=>d.querySelector('.commerce-order'));assert.equal(f.store.get('SELECT COUNT(*) n FROM commerce_orders').n,1);
  q('[data-commerce-checkout]').click();q('[data-commerce-checkout]').click();await wait(()=>q('.commerce-order').textContent.includes('ready'));
  const id=f.store.get('SELECT id FROM commerce_orders').id;q('[data-commerce-return]').click();await wait(()=>q('#commerce-section').textContent.includes('redirect não confirma'));assert.equal(f.store.get('SELECT COUNT(*) n FROM commerce_entitlements').n,0);
  unmount();unmount=await mountPersistent(d);assert.equal(d.querySelectorAll('.commerce-order').length,1);assert.equal(dom.window.localStorage.length,0);
  const token=await f.preview();dom.window.location.hash='#commerce-proof='+token;await wait(()=>d.querySelector('.commerce-confirm'));assert.equal(dom.window.location.hash,'#commerce-confirm');assert.ok(!d.body.innerHTML.includes(token));
  field('.commerce-confirm [name=email]','commerce@fixture.invalid');field('.commerce-confirm [name=password]',COMMERCE_PASSWORD);field('.commerce-confirm [name=passwordConfirm]',COMMERCE_PASSWORD);submit('.commerce-confirm');await wait(()=>d.querySelector('#login'));
  field('#login [name=email]','commerce@fixture.invalid');field('#login [name=password]',COMMERCE_PASSWORD);submit('#login');await wait(()=>d.querySelector('.commerce-workspace'));assert.ok(!d.querySelector('#onboarding'));
  await f.simulate(id,'paid');await f.process();q('[data-commerce-refresh]').click();await wait(()=>d.querySelector('#onboarding'));assert.match(q('.commerce-order').textContent,/Onboarding: autorizado/);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);
  field('#onboarding [name=days]','5');field('#onboarding [name=goal]','Condicionamento');field('#onboarding [name=experience]','Intermediário');field('#onboarding [name=context]','Saved commercial onboarding');submit('#onboarding');await wait(()=>q('#local-status').textContent==='Operação concluída no servidor.');const payload=requests.filter(request=>request.route==='onboarding').at(-1);assert.equal(payload.method,'PUT');assert.equal(payload.body.days,5);assert.equal(typeof payload.body.days,'number');const saved=JSON.parse(f.store.get("SELECT onboarding FROM students WHERE email='commerce@fixture.invalid'").onboarding);assert.equal(saved.context,'Saved commercial onboarding');assert.equal(saved.days,5);assert.equal(saved.goal,'Condicionamento');assert.equal(saved.experience,'Intermediário');for(const [name,value] of Object.entries(saved))assert.equal(q('#onboarding [name='+name+']').value,String(value));
  unmount();unmount=await mountPersistent(d);for(const [name,value] of Object.entries(saved))assert.equal(q('#onboarding [name='+name+']').value,String(value));
  const studentId=f.store.get("SELECT id FROM students WHERE email='commerce@fixture.invalid'").id;
  assert.equal(JSON.parse(f.store.get('SELECT answers FROM anamneses WHERE student_id=?',studentId)?.answers||'{}').days,undefined,'legacy onboarding does not invent an original intake response');
  field('.intake-form [name=days]','5');q('.intake-form [name=trainingConsent]').checked=true;submit('.intake-form');await wait(()=>JSON.parse(f.store.get('SELECT answers FROM anamneses WHERE student_id=?',studentId)?.answers||'{}').days===5&&q('#local-status').textContent==='Operação concluída no servidor.');
  assert.equal(requests.filter(request=>request.route==='students/'+studentId+'/anamnesis'&&request.method==='PUT').at(-1).body.answers.days,5);
  assert.equal(f.store.get('SELECT status FROM anamneses WHERE student_id=?',studentId).status,'draft');assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);
  q('[data-action=logout]').click();await wait(()=>d.querySelector('.commerce-register'));assert.equal(dom.window.localStorage.length,0);
  unmount();b=f.client();assert.equal(b.cookies.size,0);unmount=await mountPersistent(d);
  field('#login [name=email]','commerce@fixture.invalid');field('#login [name=password]',COMMERCE_PASSWORD);submit('#login');await wait(()=>d.querySelector('#onboarding'));
  for(const [name,value] of Object.entries(saved))assert.equal(q('#onboarding [name='+name+']').value,String(value),'fresh session restores '+name);
  assert.equal(q('.intake-form [name=days]').value,'5');assert.equal(JSON.parse(f.store.get('SELECT answers FROM anamneses WHERE student_id=?',studentId).answers).days,5);
  assert.equal((await b.request('students/'+studentId+'/anamnesis')).data.anamnesis.answers.days,5);
  assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);assert.equal(dom.window.localStorage.length,0);
  q('[data-action=logout]').click();await wait(()=>d.querySelector('.commerce-register'));
 }finally{unmount?.();globalThis.fetch=originalFetch;globalThis.FormData=originalForm;dom.window.close();await f.close();}
});

test('DOM UI preserves idempotency key on lost response, shows unknown checkout failure and never auto-charges on return',async()=>{
 const dom=new JSDOM('<main></main>',{url:'http://127.0.0.1/local#purchase-success'}),d=dom.window.document,calls=[];let fail=true;
 const original=globalThis.FormData;globalThis.FormData=dom.window.FormData;
 const ui=commerceUI({root:d,esc:String,getUser:()=>null,perform:fn=>fn(),onPasswordComplete(){},api:async(route,body,method,key)=>{calls.push({route,body,key});if(route==='commerce/capabilities')return {enabled:true,catalog:[{id:'quarterly',name:'Trimestral',kind:'total-sale',amountCents:119700,months:3}]};if(route==='commerce/session')return {registered:true,identityVerified:false,orders:[{orderId:'fixture-order',plan:{name:'Trimestral',amountCents:119700},checkoutState:'unknown',status:'pending'}]};if(route==='commerce/orders'&&fail)throw Error('Resposta interrompida');return {};}});
 try{
  await ui.loadPublic();d.querySelector('main').innerHTML=ui.render();assert.match(d.body.textContent,/Criação inconclusiva/);assert.equal(calls.filter(c=>c.route==='commerce/orders').length,0);
  const event={target:d.querySelector('.commerce-buy'),preventDefault(){}};await assert.rejects(()=>ui.submit(event),/interrompida/);fail=false;await ui.submit(event);const orders=calls.filter(c=>c.route==='commerce/orders');assert.equal(orders.length,2);assert.equal(orders[0].key,orders[1].key);assert.deepEqual(Object.keys(orders[0].body).sort(),['billingType','sku']);
  assert.equal(dom.window.localStorage.length,0);
 }finally{globalThis.FormData=original;dom.window.close();}
});
