import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {rmSync} from 'node:fs';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';
import {seedReviewedIntake} from './intake-test-fixtures.mjs';
import {syntheticTrainingConfiguration,syntheticTrainingBudget} from './training-proposal-fixtures.mjs';
import {createLocalServer} from '../backend/server.mjs';
import {mountPersistent} from '../public/sim/persistent.js';

test('full local UI: student optional purpose, coach prepares/edits draft, explicit risk decision, revision and navigation',async()=>{
 const f=await isolatedFixture();await seedReviewedIntake(f.store,f.ids.studentRecord,f.ids.coach);f.store.run('UPDATE anamneses SET attention_review=1 WHERE student_id=?',f.ids.studentRecord);
 const backend=await createLocalServer({store:f.store,loginLimit:40,chat:syntheticTrainingBudget,trainingProposals:syntheticTrainingConfiguration()});await new Promise(r=>backend.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+backend.server.address().port;
 const dom=new JSDOM('<div id="local-app"></div><p id="local-status"></p>',{url:origin+'/local',pretendToBeVisual:true}),doc=dom.window.document;const originalFetch=globalThis.fetch,originalForm=globalThis.FormData;globalThis.FormData=dom.window.FormData;let cookie='',unmount;
 const urls=[];globalThis.fetch=async(url,options)=>{assert.ok(url.startsWith('/api/local/'));urls.push(url);const r=await originalFetch(origin+url,{...options,headers:{...options.headers,...(options.body?{Origin:origin}:{}),Cookie:cookie}});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
 const q=s=>{const n=doc.querySelector(s);assert.ok(n,s);return n;};const wait=async fn=>{for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('UI did not settle: '+q('#local-status').textContent);};
 const submit=s=>q(s).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 const done=()=>q('#local-status').textContent==='Operação concluída no servidor.';
 async function login(role){q('#login [name=email]').value=role+'@fixture.invalid';q('#login [name=password]').value=FIXTURE_PASSWORD;submit('#login');await wait(()=>doc.querySelector('#training-proposals-section')&&done());}
 async function logout(){q('[data-action=logout]').click();await wait(()=>doc.querySelector('#login'));}
 try{
  unmount=await mountPersistent(doc);await login('student');q('[data-view=profile]').click();assert.equal(q('[data-panel=profile]').hidden,false);assert.equal(q('.training-proposal-consent [name=enabled]').checked,false);assert.match(q('.training-proposal-consent').textContent,/Não há envio à OpenAI/);assert.ok(!doc.querySelector('.training-risk-form'));assert.ok(!doc.querySelector('.training-proposal-prepare'));
  q('.training-proposal-consent [name=enabled]').checked=true;q('.training-proposal-consent [name=confirmed]').checked=true;submit('.training-proposal-consent');await wait(()=>done()&&q('.training-proposal-consent [name=enabled]').checked);
  await logout();await login('coach');q('[data-view=training]').click();assert.equal(q('[data-panel=training]').hidden,false);assert.match(q('#training-proposals-section').textContent,/publicação bloqueadas/);
  q('.training-proposal-prepare [name=confirmed]').checked=true;submit('.training-proposal-prepare');await wait(()=>doc.querySelector('.training-proposal-confirm')&&done());assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,0);
  q('.training-proposal-confirm [name=title]').value='Rascunho UI fictício';q('.training-proposal-confirm [name=sets-0]').value='3';q('.training-proposal-confirm [name=confirmed]').checked=true;submit('.training-proposal-confirm');await wait(()=>doc.querySelector('.training-draft-edit')&&done());let plan=f.store.get('SELECT * FROM plans');assert.equal(plan.status,'draft');assert.equal(JSON.parse(plan.content).exercises[0].sets,3);
  q('.training-draft-edit [name=title]').value='Editado após salvar';q('.training-draft-edit [name=confirmed]').checked=true;submit('.training-draft-edit');await wait(()=>done()&&f.store.get('SELECT revision FROM plans').revision===2);plan=f.store.get('SELECT * FROM plans');assert.equal(plan.title,'Editado após salvar');
  q('[data-plan][data-action=submit]').click();await wait(()=>done()&&f.store.get('SELECT status FROM plans').status==='review');q('[data-plan][data-action=approve]').click();await wait(()=>q('#local-status').textContent.includes('Sinal de atenção'));assert.equal(f.store.get('SELECT status FROM plans').status,'review');
  q('.training-risk-form [name=decision]').value='allow-with-limitations';q('.training-risk-form [name=note]').value='Decisão fictícia após avaliação; manter limitações conferidas.';q('.training-risk-form [name=confirmed]').checked=true;submit('.training-risk-form');await wait(()=>done()&&q('#training-proposals-section').textContent.includes('resolução profissional registrada'));
  q('[data-plan][data-action=approve]').click();await wait(()=>done()&&f.store.get('SELECT status FROM plans').status==='approved');
  for(const width of [320,390]){dom.window.innerWidth=width;q('[data-view=students]').click();q('[data-view=training]').click();assert.equal(q('[data-panel=training]').hidden,false);dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));assert.equal(q('[data-panel=training]').hidden,false);assert.ok(!q('#training-proposals-section').textContent.includes('NaN'));}
  unmount();unmount=await mountPersistent(doc);q('[data-view=training]').click();assert.equal(q('.training-draft-edit [name=title]').value,'Editado após salvar');assert.equal(dom.window.localStorage.length,0);assert.ok(urls.some(u=>u.includes('/training-proposals/prepare')));assert.ok(!urls.some(u=>u.includes('/ai/chat/message')));
  await logout();await login('student');q('[data-view=profile]').click();q('.training-proposal-consent [name=enabled]').checked=false;q('.training-proposal-consent [name=confirmed]').checked=true;submit('.training-proposal-consent');await wait(()=>done()&&!q('.training-proposal-consent [name=enabled]').checked);assert.equal(f.store.get('SELECT COUNT(*) n FROM plans').n,1);
 }finally{unmount?.();dom.window.close();globalThis.fetch=originalFetch;globalThis.FormData=originalForm;await backend.close();rmSync(f.directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
