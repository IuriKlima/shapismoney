import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {rmSync} from 'node:fs';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {mountPersistent} from '../public/sim/persistent.js';
test('UI login, cadastro com confirmação, reload de servidor, logout e onboarding persistente',async()=>{
  const fixture=await isolatedFixture();const backend=await createLocalServer({store:fixture.store,loginLimit:20});await new Promise(resolve=>backend.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+backend.server.address().port;
  const dom=new JSDOM('<div id="local-app"></div><p id="local-status"></p>',{url:origin+'/local'});const originalFetch=globalThis.fetch,originalForm=globalThis.FormData;globalThis.FormData=dom.window.FormData;let cookie='';
  globalThis.fetch=async(url,options)=>{const response=await originalFetch(origin+url,{...options,headers:{...options.headers,...(options.body?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{})}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
  let unmount;const query=s=>{const node=dom.window.document.querySelector(s);assert.ok(node,s);return node;};const field=(s,v)=>{query(s).value=v;};const submit=id=>query('#'+id).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  const wait=async(predicate)=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('UI did not settle');};
  const login=async role=>{field('[name=email]',role+'@fixture.invalid');field('[name=password]',FIXTURE_PASSWORD);submit('login');await wait(()=>dom.window.document.querySelector('[data-action=logout]'));};
  try{
    unmount=await mountPersistent(dom.window.document);await login('coach');field('#create-student [name=name]','Cadastro UI Fictício');field('#create-student [name=email]','ui@fixture.invalid');field('#create-student [name=internalNote]','Nota interna UI');submit('create-student');assert.ok(query('#confirm-student'));assert.equal(fixture.store.get("SELECT COUNT(*) AS n FROM students WHERE email='ui@fixture.invalid'").n,0);query('#confirm-student').click();await wait(()=>fixture.store.get("SELECT COUNT(*) AS n FROM students WHERE email='ui@fixture.invalid'").n===1&&query('#local-status').textContent==='Operação concluída no servidor.');
    unmount();unmount=await mountPersistent(dom.window.document);assert.match(query('#local-app').textContent,/Cadastro UI Fictício/);assert.equal(dom.window.localStorage.length,0);
    query('[data-action=logout]').click();await wait(()=>dom.window.document.querySelector('#login'));await login('student');assert.ok(!query('#local-app').textContent.includes('INTERNO'));field('#onboarding [name=context]','Fictício: três dias na semana');submit('onboarding');await wait(()=>fixture.store.get('SELECT revision FROM students WHERE id=?',fixture.ids.studentRecord).revision===2&&query('#local-status').textContent==='Operação concluída no servidor.');
    unmount();unmount=await mountPersistent(dom.window.document);assert.equal(query('#onboarding [name=context]').value,'Fictício: três dias na semana');assert.equal(dom.window.localStorage.length,0);
  }finally{unmount?.();dom.window.close();globalThis.fetch=originalFetch;globalThis.FormData=originalForm;await backend.close();rmSync(fixture.directory,{recursive:true,force:true});}
});
