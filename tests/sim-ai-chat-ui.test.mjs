import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {rmSync} from 'node:fs';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {mountPersistent} from '../public/sim/persistent.js';
test('interface IA: consentimento, proposta escapada, cancelar sem escrever e duplo clique confirmado uma vez',async()=>{
 const f=await isolatedFixture();let calls=0;const backend=await createLocalServer({store:f.store,chat:{enabled:true,budgetUSD:.1,inputRate:.125,outputRate:.5,generate:()=>{calls++;return {reply:'<script>não executar</script>',inferences:['Hipótese fictícia'],action:{type:'create-student',name:'Cadastro IA UI',email:'ui-ai@fixture.invalid',internalNote:'<img src=x onerror=alert(1)>',title:null,daysPerWeek:null,exercises:null}};}}});await new Promise(r=>backend.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+backend.server.address().port;
 const dom=new JSDOM('<div id="local-app"></div><p id="local-status"></p>',{url:origin+'/local'}),doc=dom.window.document;const originalFetch=globalThis.fetch,originalForm=globalThis.FormData;globalThis.FormData=dom.window.FormData;let cookie='',unmount;
 globalThis.fetch=async(url,options)=>{const r=await originalFetch(origin+url,{...options,headers:{...options.headers,...(options.body?{Origin:origin}:{}),Cookie:cookie}});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
 const q=s=>{const n=doc.querySelector(s);assert.ok(n,s);return n;},submit=id=>q('#'+id).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));const wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('UI did not settle');};
 try{unmount=await mountPersistent(doc);q('#login [name=email]').value='admin@fixture.invalid';q('#login [name=password]').value=FIXTURE_PASSWORD;submit('login');await wait(()=>doc.querySelector('#ai-chat'));
 assert.equal(q('#ai-chat [name=providerConsent]').checked,false);assert.equal(q('#ai-chat [name=providerConsent]').dataset.consentVersion,'SIM_CHAT_EXTERNAL_V1');assert.ok(q('#ai-chat details a'));q('#ai-chat [name=message]').value='Cadastro fictício';submit('ai-chat');assert.equal(calls,0);q('#ai-chat [name=providerConsent]').checked=true;submit('ai-chat');await wait(()=>doc.querySelector('[data-action=review-ai-proposal]'));assert.equal(calls,1);assert.equal(f.store.get("SELECT COUNT(*) n FROM audit WHERE event='ai.provider-consent.SIM_CHAT_EXTERNAL_V1'").n,1);assert.equal(f.store.get("SELECT COUNT(*) n FROM students WHERE email='ui-ai@fixture.invalid'").n,0);assert.equal(q('#chat-section').querySelectorAll('script,img').length,0);
 q('[data-action=review-ai-proposal]').click();q('#cancel-ai-proposal').click();assert.equal(f.store.get("SELECT COUNT(*) n FROM students WHERE email='ui-ai@fixture.invalid'").n,0);
 q('[data-action=review-ai-proposal]').click();const b=q('#confirm-ai-proposal');b.click();b.click();await wait(()=>f.store.get("SELECT COUNT(*) n FROM students WHERE email='ui-ai@fixture.invalid'").n===1&&!doc.querySelector('#confirm-ai-proposal'));assert.equal(f.store.get("SELECT COUNT(*) n FROM audit WHERE event='student.created'").n,1);assert.equal(dom.window.localStorage.length,0);assert.equal(calls,1);
 }finally{unmount?.();globalThis.fetch=originalFetch;globalThis.FormData=originalForm;await backend.close();rmSync(f.directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});dom.window.close();}
});
