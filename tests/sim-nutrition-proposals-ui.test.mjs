import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {nutritionProposalFixture} from './nutrition-proposal-fixtures.mjs';
import {nutritionUI} from '../public/sim/nutrition-ui.js';
test('nutrition UI HTTP journey hydrates mock proposal, confirms draft, edits existing revision and cancels unsaved changes',async()=>{
 const f=await nutritionProposalFixture(),dom=new JSDOM('<main></main>'),doc=dom.window.document,saved=globalThis.FormData;globalThis.FormData=dom.window.FormData;
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const ui=nutritionUI({getUser:()=>({role:'nutrition'}),getStudent:()=>({id:f.ids.studentRecord}),esc,perform:async work=>work(),api:async(path,body,method,key)=>{const r=await f.n.req(path,body,method,key);if(r.status>=400)throw Error(JSON.stringify(r));return r.data;}});
 try{
  await f.consent();await ui.load();doc.querySelector('main').innerHTML=ui.render();assert.match(doc.body.textContent,/OFFLINE DE TESTE/);assert.match(doc.body.textContent,/metas profissionais/);
  const generate=doc.querySelector('.nutrition-proposal-prepare');generate.elements.confirmed.checked=true;await ui.submit({target:generate,preventDefault(){}});doc.querySelector('main').innerHTML=ui.render();
  const form=doc.querySelector('.nutrition-plan');assert.equal(form.elements.title.value,'Fictitious offline nutrition draft');assert.match(doc.body.textContent,/Confirmação cria somente um rascunho persistente/);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,0);
  const grams=form.querySelector('[data-nutrition-field="0.items.0.grams"]');grams.value='110';ui.input({target:grams});await ui.submit({target:form,preventDefault(){}});assert.equal(f.store.get('SELECT COUNT(*) AS n FROM nutrition_plans').n,1);
  await ui.load();doc.querySelector('main').innerHTML=ui.render();assert.match(doc.body.textContent,/Desvios calculados no servidor/);
  const plan=f.store.get('SELECT id,revision FROM nutrition_plans');ui.click({target:doc.querySelector('[data-nutrition-edit]')});doc.querySelector('main').innerHTML=ui.render();const edited=doc.querySelector('.nutrition-plan');assert.equal(edited.elements.title.value,'Fictitious offline nutrition draft');assert.equal(edited.querySelector('[data-nutrition-field="0.items.0.grams"]').value,'110');
  edited.elements.title.value='Human revised existing draft';await ui.submit({target:edited,preventDefault(){}});assert.equal(f.store.get('SELECT revision FROM nutrition_plans WHERE id=?',plan.id).revision,plan.revision+1);
  await ui.load();doc.querySelector('main').innerHTML=ui.render();ui.click({target:doc.querySelector('[data-nutrition-edit]')});doc.querySelector('main').innerHTML=ui.render();doc.querySelector('.nutrition-plan').elements.title.value='Unsaved cancel';ui.click({target:doc.querySelector('[data-nutrition-cancel]')});assert.equal(f.store.get('SELECT title FROM nutrition_plans WHERE id=?',plan.id).title,'Human revised existing draft');assert.equal(f.calls(),1);
 }finally{ui.reset();globalThis.FormData=saved;dom.window.close();await f.close();}
});
