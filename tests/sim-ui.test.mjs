import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {mountSIM} from '../public/sim/app.js';
import {PLANS,normalizeEmail,findDuplicate,addDemoLead,isLocalDemo} from '../public/sim/domain.js';

function fixture(url='http://127.0.0.1:5173/app',saved,options={}){
  const dom=new JSDOM('<div id="host"></div>',{url,pretendToBeVisual:true});
  dom.window.scrollTo=()=>{};
  const names=['window','document','location','history','localStorage','FormData'];
  const previous=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:name==='window'?dom.window:dom.window[name]});
  const oldFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({catalog:[],available:false})};};
  if(saved)dom.window.localStorage.setItem('sim-prototype-v1',saved);
  const root=dom.window.document.querySelector('#host').attachShadow({mode:'open'});
  root.innerHTML='<div id="app"></div><div id="modal-root"></div><div id="toast"></div>';
  const unmount=mountSIM(root,options);
  const query=s=>{const el=root.querySelector(s);assert.ok(el,'Missing '+s);return el;};
  const click=action=>query('[data-action="'+action+'"]').click();
  const field=(s,v)=>{const el=query(s);el.value=v;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  const submit=id=>{const form=query('#'+id);assert.ok(form.checkValidity(),id+' must be valid');form.requestSubmit();};
  const data=()=>JSON.parse(dom.window.localStorage.getItem('sim-prototype-v1'));
  const close=()=>{unmount();dom.window.close();globalThis.fetch=oldFetch;for(const n of names){const d=previous.get(n);if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}};
  return {dom,root,query,click,field,submit,data,close,calls:()=>calls};
}
async function withUI(run,url,saved){const f=fixture(url,saved);try{await Promise.resolve();await Promise.resolve();await run(f);}finally{f.close();}}

test('planos fecham os totais e parcelamentos solicitados',()=>{
  assert.deepEqual(PLANS.map(p=>[p.total,p.installments,p.amount]),[[499,1,499],[1197,3,399],[1794,6,299]]);
  for(const p of PLANS)assert.equal(p.total,p.installments*p.amount);
});
test('identidade do e-mail normaliza espaços e caixa',()=>{
  assert.equal(normalizeEmail(' ALUNO@EXEMPLO.COM '),'aluno@exemplo.com');
  assert.ok(findDuplicate([{email:' aluno@exemplo.com '}],'ALUNO@EXEMPLO.COM'));
});
test('leads anual/personalizado atualizam interesse sem duplicar aluno',()=>{
  const state={clients:[]};
  assert.equal(addDemoLead(state,{name:'Lead Demo',email:'lead@exemplo.com',interest:'annual'},'lead-1','demo').created,true);
  assert.equal(addDemoLead(state,{name:'Lead Demo',email:' LEAD@EXEMPLO.COM ',interest:'custom'},'lead-2','demo').created,false);
  assert.equal(state.clients.length,1);assert.equal(state.clients[0].interest,'custom');
  assert.throws(()=>addDemoLead(state,{name:'Lead',email:'inválido',interest:'annual'},'bad','demo'));
});
test('somente loopback habilita operações demonstrativas',()=>{
  for(const host of ['localhost','127.0.0.1','[::1]'])assert.equal(isLocalDemo(host),true);
  for(const host of ['app.example.com','localhost.example.com','127.0.0.2'])assert.equal(isLocalDemo(host),false);
});
test('produção não grava estado, busca catálogo ou habilita formulários',()=>withUI(f=>{
  assert.equal(f.calls(),0);assert.equal(f.data(),null);
  assert.equal(f.root.querySelector('form'),null);
  assert.ok([...f.root.querySelectorAll('[data-action]')].every(b=>b.disabled));
  assert.match(f.query('#app').textContent,/ainda aguardam integração/);
},'https://app.example.com/'));
test('cinco abas móveis e exercícios sem autoplay/preload',()=>withUI(f=>{
  assert.equal(f.root.querySelectorAll('.bottom-nav button').length,5);
  for(const tab of ['today','workout','food','progress','profile']){f.click('view:'+tab);assert.ok(f.query('.content'));}
  f.click('view:workout');assert.match(f.query('.video-empty').textContent,/Vídeo indisponível/);
  assert.ok(!f.root.querySelector('video[autoplay]'));
  const css=readFileSync(new URL('../public/sim/style.css',import.meta.url),'utf8');
  assert.match(css,/@media\(max-width:640px\)/);
}));
test('duplo clique de série não desfaz conclusão; retomada persiste',async()=>{
  let saved;
  await withUI(f=>{f.click('view:workout');f.field('[data-set="0"][data-field="load"]','20');const b=f.query('[data-action="set:0"]');b.click();b.click();assert.equal(Object.values(f.data().session.sets).filter(x=>x.done).length,1);f.click('pause');saved=f.dom.window.localStorage.getItem('sim-prototype-v1');});
  await withUI(f=>{assert.match(f.query('#app').textContent,/Sua sessão está salva/);f.click('resume');assert.equal(f.query('[data-set="0"][data-field="load"]').value,'20');},undefined,saved);
});
test('manual e chat exigem revisão, não enviam convite e deduplicam',()=>withUI(f=>{
  assert.equal(f.root.querySelectorAll('.crm-mobile-nav button').length,8);f.click('new-client');f.field('#new-client-form [name="name"]','QA Cancelado');f.click('close-modal');assert.equal(f.data()?.clients?.some(c=>c.name==='QA Cancelado')||false,false);f.click('new-client');f.field('#new-client-form [name="name"]','QA Aluno');f.field('#new-client-form [name="email"]','qa-aluno@exemplo.com');f.submit('new-client-form');
  assert.equal(f.data()?.clients?.some(c=>c.email==='qa-aluno@exemplo.com')||false,false);
  const b=f.query('[data-action="confirm-client"]');b.click();b.click();
  assert.equal(f.data().clients.filter(c=>c.email==='qa-aluno@exemplo.com').length,1);
  assert.match(f.query('.modal').textContent,/demonstração/);assert.match(f.data().chatMessages.at(-1).text,/Nenhum convite/);
  f.click('team:clients');f.click('new-client');f.field('#new-client-form [name="name"]','QA Repetido');f.field('#new-client-form [name="email"]','QA-ALUNO@exemplo.com');f.submit('new-client-form');assert.match(f.query('.modal').textContent,/já está/);
  f.click('close-modal');f.click('team:chat');f.field('#chat-form [name="command"]','Cadastre aluno QA Chat com treino Base B');f.submit('chat-form');
  assert.ok(f.root.querySelector('#new-client-form'));assert.equal(f.data().clients.some(c=>c.name==='QA Chat'),false);
  f.field('#new-client-form [name="email"]','qa-chat@exemplo.com');f.submit('new-client-form');f.click('confirm-client');assert.equal(f.data().clients.find(c=>c.email==='qa-chat@exemplo.com').plan,'base-b');
},'http://127.0.0.1:5173/crm'));
test('interesse anual entra no CRM local e repetição atualiza sem duplicar',()=>withUI(f=>{
  const submitLead=interest=>{f.click('lead:'+interest);f.field('#lead-form [name="name"]','QA Interesse');f.field('#lead-form [name="email"]','qa-lead@exemplo.com');f.query('#lead-form [name="demoConsent"]').checked=true;f.submit('lead-form');};
  submitLead('annual');assert.match(f.query('.modal').textContent,/Nenhuma mensagem/);f.click('close-modal');submitLead('custom');
  assert.equal(f.data().clients.filter(c=>c.email==='qa-lead@exemplo.com').length,1);const lead=f.data().clients.find(c=>c.email==='qa-lead@exemplo.com');f.click('open-duplicate:'+lead.id);assert.match(f.query('#app').textContent,/Projeto personalizado/);
},'http://127.0.0.1:5173/'));
test('onboarding preserva etapa no reload e voltar usa histórico local',async()=>{
  let saved;
  await withUI(f=>{f.click('join');f.click('skip-intro');f.field('#access-form [name="name"]','QA Jornada');f.field('#access-form [name="email"]','jornada@exemplo.com');f.submit('access-form');assert.ok(f.root.querySelector('#assessment-form'));saved=f.dom.window.localStorage.getItem('sim-prototype-v1');f.dom.window.history.pushState({},'','/app');f.dom.window.dispatchEvent(new f.dom.window.PopStateEvent('popstate'));assert.ok(f.root.querySelector('.bottom-nav'));},'http://127.0.0.1:5173/');
  await withUI(f=>assert.ok(f.root.querySelector('#assessment-form')),'http://127.0.0.1:5173/comecar',saved);
});
test('relato é privado por padrão; compartilhamento pode ser revogado',()=>withUI(f=>{
  f.click('view:food');f.click('student-chat');f.field('#student-chat-form [name="report"]','QA rotina fictícia');f.submit('student-chat-form');assert.equal(f.data().studentReports.at(-1).shared,false);assert.match(f.query('.modal').textContent,/alergias/);
  f.click('close-modal');f.click('student-chat');f.field('#student-chat-form [name="report"]','QA compartilhado');f.query('#student-chat-form [name="share"]').checked=true;f.submit('student-chat-form');const report=f.data().studentReports.at(-1);assert.equal(report.shared,true);f.click('student-chat');f.click('revoke-report:'+report.id);assert.equal(f.data().studentReports.at(-1).shared,false);
}));
test('editar nutrição invalida revisão e liberação demonstrativas',()=>withUI(f=>{
  f.click('team:nutrition');f.click('release-nutrition');assert.equal(f.data()?.nutrition?.status||'draft','draft');f.click('approve-nutrition');f.click('release-nutrition');assert.equal(f.data().nutrition.status,'released-demo');f.field('#nutrition-review-form [name="method"]','Exemplo a validar');f.submit('nutrition-review-form');assert.equal(f.data().nutrition.status,'draft');assert.equal(f.data().nutrition.version,2);
},'http://127.0.0.1:5173/crm'));


test('chat IA usa resposta do endpoint, escapa texto, mostra erro e não altera CRM',async()=>{
  const f=fixture('http://127.0.0.1:5173/crm',undefined,{aiEndpoint:'/api/dev-ai'});
  try{
    await Promise.resolve();await Promise.resolve();f.click('team:chat');
    const before=f.dom.window.localStorage.getItem('sim-prototype-v1');let calls=0;
    globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/dev-ai');assert.deepEqual(JSON.parse(options.body),{scenario:'method',syntheticConsent:true});return {ok:true,json:async()=>({reply:'<script>never execute</script> Revisão profissional.',mode:'synthetic-development',writesPerformed:false})};};
    f.query('#dev-ai-form input').checked=true;f.submit('dev-ai-form');assert.ok(f.query('#dev-ai-form button').disabled);
    await new Promise(resolve=>setTimeout(resolve,0));assert.match(f.query('#dev-ai-result').textContent,/Revisão profissional/);assert.equal(f.root.querySelector('#dev-ai-result script'),null);assert.equal(calls,1);assert.equal(f.dom.window.localStorage.getItem('sim-prototype-v1'),before);
    globalThis.fetch=async()=>({ok:false,json:async()=>({error:'Provedor indisponível.'})});f.query('#dev-ai-form input').checked=true;f.submit('dev-ai-form');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.query('#dev-ai-result').textContent,'Provedor indisponível.');assert.equal(f.dom.window.localStorage.getItem('sim-prototype-v1'),before);
  }finally{f.close();}
});
