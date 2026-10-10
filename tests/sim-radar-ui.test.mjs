import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountPublic} from '../public/sim/public.js';
import {profileUI} from '../public/sim/profile-ui.js';
import {QUESTIONS,RADAR_VERSION} from '../public/sim/radar-model.js';

test('Radar UI: capture minima, no default consent/answers, back/cancel/repeat, rules result and no intimate events',async()=>{
  const dom=new JSDOM('<div id="public-app"></div>',{url:'http://127.0.0.1:5191/radar',pretendToBeVisual:true});dom.window.scrollTo=()=>{};const previous=globalThis.fetch,oldForm=globalThis.FormData;const calls=[];
  globalThis.FormData=dom.window.FormData;globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({version:RADAR_VERSION})};};
  const root=dom.window.document;let unmount;const q=s=>{const el=root.querySelector(s);assert.ok(el,s);return el;};const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0));};const submit=s=>q(s).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  try{unmount=mountPublic(root);q('[data-action=capture]').click();assert.equal(q('[name=marketing]').checked,false);assert.equal(q('[name=necessary]').checked,false);assert.equal(root.querySelector('[name=company]'),null);
    q('[name=name]').value='Pessoa fictícia';q('[name=email]').value='ui@fixture.invalid';q('[data-action=cancel]').click();q('[data-action=capture]').click();assert.equal(q('[name=name]').value,'Pessoa fictícia');q('[name=necessary]').checked=true;submit('#capture');await settle();assert.equal(calls.filter(c=>c.url.endsWith('register')).length,1);assert.equal(calls[0].body.marketing,false);assert.equal(root.querySelector('input[name=answer]:checked'),null);
    q('[name=answer][value="2"]').checked=true;submit('#question');q('[data-action=back]').click();assert.equal(q('[name=answer][value="2"]').checked,true);
    q('[data-action=leave]').click();q('[data-dialog=cancel]').click();assert.ok(q('#question'));assert.equal(q('[name=answer][value="2"]').checked,true);
    for(let i=0;i<QUESTIONS.length;i++){q('[name=answer][value="3"]').checked=true;submit('#question');await settle();}
    assert.ok(q('.radar-chart'));assert.match(q('.result-total').textContent,/50/);assert.match(root.body.textContent,/Seus eixos ficaram no mesmo nível/);assert.match(q('.score-method').textContent,/invertida/);assert.equal(root.querySelectorAll('.result-tip').length,5);
    assert.deepEqual(calls.filter(c=>c.url.endsWith('/event')).map(c=>c.body.event),['start','completion','result']);for(const call of calls.filter(c=>c.url.endsWith('/event')))assert.deepEqual(Object.keys(call.body).sort(),['event','version']);assert.equal(dom.window.localStorage.length,0);
    q('[data-action=repeat]').click();await settle();assert.ok(q('#question'));assert.equal(root.querySelector('input[name=answer]:checked'),null);q('[data-action=leave]').click();q('[data-dialog=leave]').click();assert.ok(q('[data-action=capture]'));
  }finally{unmount?.();dom.window.close();globalThis.fetch=previous;globalThis.FormData=oldForm;}
});
test('private profile UI escapes bio, cancels without requests and owner forms load/save revisions',async()=>{
  const dom=new JSDOM('<div id="local-app"></div>',{url:'http://127.0.0.1:5191/local'});const oldForm=globalThis.FormData;globalThis.FormData=dom.window.FormData;let profile={displayName:'Pessoa fictícia',bio:'<script>private</script>',revision:0,photoUrl:null},writes=0;const root=dom.window.document;const panel=profileUI({root,esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),getUser:()=>({role:'student'}),getStudent:()=>({id:'synthetic'}),api:async(path,body)=>{if(body){writes++;profile={...profile,...body,revision:1};}return {profile};},perform:async work=>work()});
  try{await panel.load();root.querySelector('#local-app').innerHTML=panel.render();assert.equal(root.querySelector('script'),null);let b=root.querySelector('[data-profile-edit=text]');panel.click({target:b});root.querySelector('[name=displayName]').value='Cancelado';root.querySelector('[data-profile-cancel]').click();assert.equal(writes,0);assert.equal(root.querySelector('dialog'),null);
    panel.click({target:b});root.querySelector('[name=displayName]').value='Novo nome';root.querySelector('[name=bio]').value='Nova bio';await panel.submit({target:root.querySelector('form'),preventDefault(){}});assert.equal(writes,1);assert.equal(profile.displayName,'Novo nome');assert.equal(root.querySelector('dialog'),null);
    await panel.load();root.querySelector('#local-app').innerHTML=panel.render();b=root.querySelector('[data-profile-edit=photo]');panel.click({target:b});await panel.submit({target:root.querySelector('form'),preventDefault(){}});assert.match(root.querySelector('.profile-error').textContent,/Selecione/);assert.equal(writes,1);panel.reset();assert.equal(root.querySelector('dialog'),null);
  }finally{panel.reset();dom.window.close();globalThis.FormData=oldForm;}
});
