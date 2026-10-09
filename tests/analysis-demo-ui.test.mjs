import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {analysisFixture} from './analysis-demo-fixtures.mjs';
import {mountAnalysisDemo} from '../public/sim/analysis-demo.js';
const wait=async check=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('UI did not settle');await new Promise(r=>setTimeout(r,10));}};

test('analysis UI HTTP journey: mock generation, human editor, pending exact videos, student execution and nutrition substitution',async()=>{
 const f=await analysisFixture(),dom=new JSDOM(readFileSync(new URL('../public/sim/analysis-demo.html',import.meta.url),'utf8'),{url:f.origin+'/analysis-demo'}),doc=dom.window.document,saved=globalThis.FormData;globalThis.FormData=dom.window.FormData;let ui;
 try{ui=await mountAnalysisDemo(doc,{fetchImpl:(url,options)=>fetch(f.origin+url,{...options,headers:{...options.headers,Origin:f.origin}})});assert.match(doc.body.textContent,/Nenhuma chamada à OpenAI/);assert.ok(!doc.body.textContent.includes('Gerado por IA real'));
  const click=selector=>doc.querySelector(selector).click();click('[data-generate="training"]');await wait(()=>ui.getState().training);click('[data-generate="nutrition"]');await wait(()=>ui.getState().nutrition);
  assert.match(doc.body.textContent,/reiniciar o servidor apaga o caso/);
  const oldTitle=ui.getState().training.payload.title,oldHistory=ui.getState().history.training.length;
  doc.querySelector('#demo-training-edit').elements.title.value='Unsaved fictitious edit';doc.querySelector('[data-cancel]').click();
  assert.equal(doc.querySelector('#demo-training-edit').elements.title.value,oldTitle);assert.equal(ui.getState().history.training.length,oldHistory);assert.match(doc.querySelector('#analysis-status').textContent,/descartadas/);
  let revision=ui.getState().revision;const form=doc.querySelector('#demo-training-edit');form.elements.title.value='Versão humana demonstrativa';form.elements['sets-0-0'].value='3';form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>ui.getState().revision>revision);assert.equal(ui.getState().training.payload.sessions[0].exercises[0].sets,3);assert.equal(ui.getState().history.training.length,2);assert.match(doc.body.textContent,/Associação demonstrativa pendente/);
  click('[data-view="student"]');assert.equal(doc.querySelectorAll('video').length,9);for(const v of doc.querySelectorAll('video')){assert.equal(v.getAttribute('preload'),'none');assert.equal(v.hasAttribute('autoplay'),false);assert.ok(ui.getState().catalog.some(c=>c.url===v.getAttribute('src')));}
  revision=ui.getState().revision;click('[data-execution]');await wait(()=>ui.getState().revision>revision);assert.equal(Object.values(ui.getState().execution)[0],1);
  const before=ui.getState().nutritionView.totals.proteinG;revision=ui.getState().revision;const choice=doc.querySelector('[data-choice="0:0"]');choice.value='1';choice.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await wait(()=>ui.getState().revision>revision);assert.notEqual(ui.getState().nutritionView.totals.proteinG,before);assert.match(doc.body.textContent,/metas artificiais/);
  click('[data-view="review"]');revision=ui.getState().revision;const meal=doc.querySelector('#demo-nutrition-edit');meal.elements['grams-0-0'].value='100';meal.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>ui.getState().revision>revision);assert.equal(ui.getState().nutritionView.totals.energyKcal,500);assert.equal(ui.getState().history.nutrition.length,2);
  click('[data-view="intake"]');revision=ui.getState().revision;const intake=doc.querySelector('#demo-intake');intake.elements.days.value='2';intake.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>ui.getState().revision>revision);assert.equal(ui.getState().training,null);assert.equal(ui.getState().facts.days,2);assert.equal(ui.getState().originalIntake.days,3);assert.equal(ui.getState().published,false);assert.equal(ui.getState().providers.externalCalls,0);
  assert.equal(dom.window.localStorage.length,0);assert.equal(f.app.store.get('SELECT COUNT(*) AS n FROM plans').n,0);
 }finally{ui?.dispose();globalThis.FormData=saved;dom.window.close();await f.close();}
});
