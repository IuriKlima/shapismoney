import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createDevAIHandler,SCENARIOS} from '../prototype/dev-ai.mjs';
const valid={scenario:'method',syntheticConsent:true};
const provider=(text='Exemplo fictício: revisão profissional obrigatória.')=>new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]}));
async function fixture(options,run){
  const server=http.createServer(createDevAIHandler(options));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const request=(body=valid,extra={})=>new Promise((resolve,reject)=>{
    const req=http.request(url,{method:extra.method||'POST',headers:{Origin:url,'Content-Type':'application/json',...extra.headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(Buffer.concat(chunks).toString('utf8'))}));});req.on('error',reject);req.end(extra.method==='GET'?undefined:typeof body==='string'?body:JSON.stringify(body));
  });
  try{await run(request,url);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('Responses recebe apenas exemplo sintético; segredo não aparece na resposta',async()=>{
  let calls=0;
  await fixture({apiKey:'test-secret-only',fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer test-secret-only');const body=JSON.parse(options.body);assert.equal(body.input,SCENARIOS.method);assert.equal(body.store,false);assert.equal(body.max_output_tokens,256);assert.equal(body.model,'gpt-5.4-nano');assert.ok(!Object.hasOwn(body,'tools'));return provider();}},async request=>{const response=await request();assert.equal(response.status,200);const body=await response.json();assert.equal(body.writesPerformed,false);assert.equal(body.mode,'synthetic-development');assert.ok(!JSON.stringify(body).includes('test-secret-only'));});
  assert.equal(calls,1);
});
test('bloqueia Host/Origin externos, entrada extra, consentimento ausente e limite de corpo',async()=>{
  let calls=0;await fixture({apiKey:'test-secret',fetchImpl:async()=>{calls++;return provider();}},async request=>{
    for(const [body,extra,status] of [[valid,{headers:{Origin:'https://external.test'}},403],[valid,{headers:{Host:'external.test'}},403],[{...valid,patient:'não enviar'}, {},400],[{...valid,syntheticConsent:false},{},400],[{...valid,scenario:'unknown'},{},400],['x'.repeat(2049),{},413],['{',{},400],[valid,{headers:{'Content-Type':'text/plain'}},415]])assert.equal((await request(body,extra)).status,status);
  });assert.equal(calls,0);
});
test('chave ausente, recusa, cota, rede e output inválido nunca retornam sucesso fictício',async()=>{
  for(const [options,status] of [[{},503],[{apiKey:'secret',fetchImpl:async()=>new Response('secret',{status:401})},502],[{apiKey:'secret',fetchImpl:async()=>new Response('secret',{status:429})},429],[{apiKey:'secret',fetchImpl:async()=>{throw Error('secret');}},502],[{apiKey:'secret',fetchImpl:async()=>provider('')},502],[{apiKey:'secret',fetchImpl:async()=>provider('secret')},502],[{apiKey:'secret',fetchImpl:async()=>provider('x'.repeat(4001))},502],[{apiKey:'secret',fetchImpl:async()=>new Response('x'.repeat(32769))},502]])await fixture(options,async request=>{const response=await request();assert.equal(response.status,status);const body=await response.json();assert.equal(typeof body.error,'string');assert.ok(!JSON.stringify(body).includes('secret'));assert.ok(!Object.hasOwn(body,'reply'));});
});
test('timeout, concorrência e limite por minuto',async()=>{
  await fixture({apiKey:'secret',timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}))},async request=>assert.equal((await request()).status,504));
  let release,started;const began=new Promise(resolve=>{started=resolve;});
  await fixture({apiKey:'secret',maxRequests:1,fetchImpl:async()=>{started();await new Promise(resolve=>{release=resolve;});return provider();}},async request=>{const first=request();await began;assert.equal((await request()).status,429);release();assert.equal((await first).status,200);assert.equal((await request()).status,429);});
});
test('preflight apenas para origem local; métodos sem POST não acionam provedor',async()=>{
  await fixture({},async(request,url)=>{const response=await fetch(url,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5173'}});assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:5173');assert.equal((await request(undefined,{method:'GET',body:undefined})).status,405);});
});
