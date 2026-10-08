import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {rmSync} from 'node:fs';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {mountPersistent} from '../public/sim/persistent.js';
test('UI admin: cadastro confirmado, onboarding manual, treino publicado, reload, logout e onboarding do aluno',async()=>{
  const fixture=await isolatedFixture();const backend=await createLocalServer({store:fixture.store,loginLimit:20});await new Promise(resolve=>backend.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+backend.server.address().port;
  const dom=new JSDOM('<div id="local-app"></div><p id="local-status"></p>',{url:origin+'/local'});const originalFetch=globalThis.fetch,originalForm=globalThis.FormData;globalThis.FormData=dom.window.FormData;let cookie='';
  globalThis.fetch=async(url,options)=>{const response=await originalFetch(origin+url,{...options,headers:{...options.headers,...(options.body?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{})}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
  let unmount;const query=s=>{const node=dom.window.document.querySelector(s);assert.ok(node,s);return node;};const field=(s,v)=>{query(s).value=v;};const submit=id=>query('#'+id).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  const wait=async(predicate)=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('UI did not settle');};
  const login=async role=>{field('[name=email]',role+'@fixture.invalid');field('[name=password]',FIXTURE_PASSWORD);submit('login');await wait(()=>dom.window.document.querySelector('[data-action=logout]'));};
  try{
    unmount=await mountPersistent(dom.window.document);await login('admin');field('#create-student [name=name]','Cadastro UI Fictício');field('#create-student [name=email]','ui@fixture.invalid');field('#create-student [name=internalNote]','Nota interna UI');submit('create-student');assert.ok(query('#confirm-student'));assert.equal(fixture.store.get("SELECT COUNT(*) AS n FROM students WHERE email='ui@fixture.invalid'").n,0);query('#confirm-student').click();await wait(()=>fixture.store.get("SELECT COUNT(*) AS n FROM students WHERE email='ui@fixture.invalid'").n===1&&query('#local-status').textContent==='Operação concluída no servidor.');
    unmount();unmount=await mountPersistent(dom.window.document);assert.match(query('#local-app').textContent,/Cadastro UI Fictício/);assert.equal(dom.window.localStorage.length,0);
    assert.ok(!dom.window.document.querySelector('#authenticated-ai'));
    query('[data-student="'+fixture.ids.studentRecord+'"]').click();await wait(()=>dom.window.document.querySelector('#onboarding')&&query('#local-status').textContent==='Operação concluída no servidor.');
    field('#onboarding [name=context]','Registrado pelo admin fictício');submit('onboarding');
    await wait(()=>fixture.store.get('SELECT revision FROM students WHERE id=?',fixture.ids.studentRecord).revision===2&&query('#local-status').textContent==='Operação concluída no servidor.');
    field('#create-plan [name=title]','Treino admin UI');field('#create-plan [name=exercise]','Exemplo manual UI');submit('create-plan');
    await wait(()=>fixture.store.get("SELECT COUNT(*) AS n FROM plans WHERE title='Treino admin UI'").n===1&&query('#local-status').textContent==='Operação concluída no servidor.');
    for(const [action,expected] of [['submit','review'],['approve','approved'],['publish','published']]){
      query('[data-plan][data-action="'+action+'"]').click();
      await wait(()=>fixture.store.get("SELECT status FROM plans WHERE title='Treino admin UI'").status===expected&&query('#local-status').textContent==='Operação concluída no servidor.');
    }
    unmount();unmount=await mountPersistent(dom.window.document);assert.match(query('#local-app').textContent,/published/);

    query('[data-action=logout]').click();await wait(()=>dom.window.document.querySelector('#login'));await login('student');assert.ok(!query('#local-app').textContent.includes('INTERNO'));field('#onboarding [name=context]','Fictício: três dias na semana');submit('onboarding');await wait(()=>fixture.store.get('SELECT revision FROM students WHERE id=?',fixture.ids.studentRecord).revision===3&&query('#local-status').textContent==='Operação concluída no servidor.');
    unmount();unmount=await mountPersistent(dom.window.document);assert.equal(query('#onboarding [name=context]').value,'Fictício: três dias na semana');assert.equal(dom.window.localStorage.length,0);
  }finally{unmount?.();dom.window.close();globalThis.fetch=originalFetch;globalThis.FormData=originalForm;await backend.close();rmSync(fixture.directory,{recursive:true,force:true});}
});

test('UI convite manual: código fora da URL/storage, ativação e primeiro onboarding',async()=>{
 const f=await isolatedFixture(),backend=await createLocalServer({store:f.store,loginLimit:30});await new Promise(resolve=>backend.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+backend.server.address().port;
 const dom=new JSDOM('<div id="local-app"></div><p id="local-status"></p>',{url:origin+'/local'}),doc=dom.window.document;const originalFetch=globalThis.fetch,originalForm=globalThis.FormData;globalThis.FormData=dom.window.FormData;let cookie='',unmount;
 globalThis.fetch=async(url,options)=>{assert.ok(!url.includes('token'));const response=await originalFetch(origin+url,{...options,headers:{...options.headers,...(options.body?{Origin:origin}:{}),Cookie:cookie}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
 const query=s=>{const n=doc.querySelector(s);assert.ok(n,s);return n;},field=(s,v)=>{query(s).value=v;},submit=id=>query('#'+id).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('UI did not settle');};
 try{
  unmount=await mountPersistent(doc);field('#login [name=email]','admin@fixture.invalid');field('#login [name=password]',FIXTURE_PASSWORD);submit('login');await wait(()=>doc.querySelector('#create-student'));
  field('#create-student [name=name]','Convite UI');field('#create-student [name=email]','inviteui@fixture.invalid');submit('create-student');query('#confirm-student').click();await wait(()=>query('#local-status').textContent==='Operação concluída no servidor.');const row=f.store.get("SELECT * FROM students WHERE email='inviteui@fixture.invalid'");query('[data-student="'+row.id+'"]').click();await wait(()=>query('#local-status').textContent==='Operação concluída no servidor.');query('#invite-student [name=verifiedDelivery]').checked=true;submit('invite-student');await wait(()=>doc.querySelector('#invite-code'));const token=query('#invite-code').value;assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.match(query('#local-app').textContent,/Nenhum e-mail foi enviado/);assert.equal(dom.window.localStorage.length,0);assert.equal(dom.window.location.search,'');assert.equal(dom.window.location.hash,'');
  query('[data-action=logout]').click();await wait(()=>doc.querySelector('#activate'));assert.ok(!doc.documentElement.innerHTML.includes(token));field('#activate [name=email]',row.email);field('#activate [name=token]',token);field('#activate [name=password]',FIXTURE_PASSWORD);submit('activate');await wait(()=>query('#local-status').textContent==='Operação concluída no servidor.');assert.ok(!doc.documentElement.innerHTML.includes(token));
  field('#login [name=email]',row.email);field('#login [name=password]',FIXTURE_PASSWORD);submit('login');await wait(()=>doc.querySelector('#onboarding'));assert.ok(!doc.querySelector('#invite-professional'));field('#onboarding [name=context]','Primeiro onboarding fictício');submit('onboarding');await wait(()=>JSON.parse(f.store.get('SELECT onboarding FROM students WHERE id=?',row.id).onboarding).context==='Primeiro onboarding fictício');
 }finally{unmount?.();dom.window.close();globalThis.fetch=originalFetch;globalThis.FormData=originalForm;await backend.close();rmSync(f.directory,{recursive:true,force:true});}
});
