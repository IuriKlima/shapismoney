import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPublic} from '../public/sim/public.js';

// Minimal host for initial HTML rendering; no requests or form interactions.
function render(route){
  const location=new URL(route,'https://shape.example.test');
  const app={innerHTML:'',ownerDocument:{defaultView:{location}},querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}};
  const dispose=mountPublic({querySelector:()=>app},{photoAvailable:true});
  const html=app.innerHTML;
  dispose();
  return {html,url:location.href};
}

test('home renders the complete sales page and keeps its URL; vendas remains an identical alias',()=>{
  const home=render('/'),alias=render('/vendas');
  assert.equal(home.html,alias.html);
  assert.match(home.html,/Um plano que/);
  assert.match(home.html,/id="planos"/);
  assert.match(home.html,/href="\/radar"/);
  assert.match(home.html,/href="\/app"/);
  assert.equal(home.url,'https://shape.example.test/');
  assert.equal(alias.url,'https://shape.example.test/vendas');
  assert.equal(render('/?source=campaign#planos').html,home.html);
});

test('Radar and privacy retain their own content',()=>{
  const radar=render('/radar').html,privacy=render('/privacidade').html;
  assert.match(radar,/Descobrir meu Radar/);
  assert.doesNotMatch(radar,/id="planos"/);
  assert.match(privacy,/Seu contexto/);
  assert.doesNotMatch(privacy,/id="planos"/);
});
