import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
  assert.match(home.html,/Você construiu uma vida de alto nível/);
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

test('editorial home has a single main heading, eleven sections and working anchor destinations',()=>{
  const html=render('/').html;
  assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.equal((html.match(/<section\b/g)||[]).length,11);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const match of html.matchAll(/href="\/?#([^"]+)"/g))assert.ok(ids.includes(match[1]),'Missing anchor '+match[1]);
  const primary=[...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>INICIAR MEU DIAGNÓSTICO/g)];
  assert.ok(primary.length>=3);
  assert.ok(primary.every(m=>m[1]==='/radar'));
  assert.equal((html.match(/<details><summary>/g)||[]).length,6);
  assert.match(html,/Quadro ilustrativo da metodologia/);
  assert.match(html,/não substitui uma avaliação profissional/);
  assert.doesNotMatch(html,/17 imagens|17 fotos|depoimento autorizado|resultado garantido em/i);
});

test('home metadata is canonical while Radar keeps its own document and assets are packaged',()=>{
  const home=readFileSync(new URL('../public/sim/sales.html',import.meta.url),'utf8');
  const radar=readFileSync(new URL('../public/sim/public.html',import.meta.url),'utf8');
  const server=readFileSync(new URL('../backend/server.mjs',import.meta.url),'utf8');
  const docker=readFileSync(new URL('../deploy/Dockerfile',import.meta.url),'utf8');
  assert.match(home,/<title>Shape Is Money \| O corpo é o primeiro capital<\/title>/);
  assert.match(home,/rel="canonical" href="https:\/\/shapeismoney.com.br\/"/);
  assert.match(home,/property="og:image"/);
  assert.match(home,/Pular para o conteúdo/);
  assert.match(radar,/<title>Shape Is Money \| Radar e acompanhamento<\/title>/);
  assert.match(server,/'\/':'sales.html'/);
  assert.match(server,/'\/vendas':'sales.html'/);
  assert.match(server,/'\/radar':'public.html'/);
  assert.match(docker,/COPY[^\n]*public\/sim\/sales.html/);
});
