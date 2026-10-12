import {request as httpRequest} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {productionSecurity,assertRequest} from '../backend/security.mjs';
import {createLocalServer} from '../backend/server.mjs';
const gmail={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document',referer:'https://mail.google.com/'};
const security=productionSecurity({SIM_PRODUCTION_REVIEWED:'true',SIM_PUBLIC_ORIGIN:'https://shape.example.test',SIM_TRUSTED_PROXY_IPS:'172.20.0.2',SIM_PROXY_UPSTREAM_HOST:'shape.internal:5190'});
const request=(url='/',method='GET',headers={})=>({url,method,socket:{remoteAddress:'172.20.0.2'},headers:{host:security.host,'x-forwarded-proto':'https','x-forwarded-for':'203.0.113.10',...gmail,...headers}});

const raw=async(url,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{const req=httpRequest(new URL(url),{method,headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')}));});req.on('error',reject);req.end(body);});

test('exact Gmail navigation without Origin/cookie/token permits public entry documents GET and HEAD',()=>{for(const url of ['/','/app','/login','/local'])for(const method of ['GET','HEAD'])assert.equal(assertRequest(request(url,method),security).clientIP,'203.0.113.10');});

test('app aliases preserve navigation-only access, Origin, HTTPS and proxy restrictions',()=>{
 for(const url of ['/app','/login']){
  for(const method of ['POST','PUT','DELETE'])assert.throws(()=>assertRequest(request(url,method,{origin:security.origin}),security),e=>e.status===403);
  for(const headers of [{'sec-fetch-mode':'cors'},{'sec-fetch-dest':'iframe'},{origin:'https://other.example.test'},{'x-forwarded-proto':'http'},{host:'other.example.test'}])assert.throws(()=>assertRequest(request(url,'GET',headers),security),e=>e.status===403);
  assert.throws(()=>assertRequest({...request(url),socket:{remoteAddress:'172.20.0.99'}},security),e=>e.status===403);
  assert.throws(()=>assertRequest(request(url),{...security,stage:'staging',clients:['203.0.113.11']}),e=>e.status===403);
 }
});

test('direct GET, refresh and HEAD serve app/login/local identically and preserve public route documents',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'shape-entry-aliases-'));
 const app=await createLocalServer({filename:path.join(directory,'db.sqlite')});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+app.server.address().port;
 try{
  const original=await raw(origin+'/local',{headers:gmail});
  assert.equal(original.status,200);assert.match(original.text,/id="local-app"/);
  for(const route of ['/app','/login','/local']){
   for(let refresh=0;refresh<2;refresh++){
    const page=await raw(origin+route,{headers:gmail});
    assert.equal(page.status,200);assert.equal(page.headers.location,undefined);assert.equal(page.text,original.text);
   }
   const head=await raw(origin+route,{method:'HEAD',headers:gmail});assert.equal(head.status,200);assert.equal(head.text,'');
  }
  for(const route of ['/','/vendas','/radar']){const page=await raw(origin+route,{headers:gmail});assert.equal(page.status,200);assert.match(page.text,/id="public-app"/);assert.doesNotMatch(page.text,/id="local-app"/);}
  for(const asset of ['platform-tablet-demo.jpg','platform-phone-demo.jpg']){const image=await raw(origin+'/sim/assets/'+asset,{headers:{'sec-fetch-site':'same-origin'}});assert.equal(image.status,200);assert.equal(image.headers['content-type'],'image/jpeg');assert.ok(image.text.length>1000);}
 }finally{await app.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('cross-site APIs, mutations, private/other resources and incomplete Fetch Metadata remain blocked',()=>{
 for(const url of ['/api/local/login','/api/local/students','/api/local/password-access/confirm','/api/local/plans/00000000-0000-0000-0000-000000000000/file','/sim/persistent.js','/sim/style.css','/local/','/unknown'])assert.throws(()=>assertRequest(request(url),security),e=>e.status===403);
 for(const method of ['POST','PUT','DELETE','OPTIONS'])assert.throws(()=>assertRequest(request('/local',method,{origin:security.origin}),security),e=>e.status===403);
 for(const headers of [{'sec-fetch-mode':undefined},{'sec-fetch-dest':undefined},{'sec-fetch-mode':'cors'},{'sec-fetch-dest':'iframe'}])assert.throws(()=>assertRequest(request('/local','GET',headers),security),e=>e.status===403);
 assert.throws(()=>assertRequest(request('/local','GET',{'sec-fetch-mode':undefined,'sec-fetch-dest':undefined,referer:undefined}),security),e=>e.status===403);
});

test('navigation exception preserves HTTPS canonical host/proxy, staging IP and supplied Origin validation',()=>{
 for(const headers of [{host:'other.example.test'},{'x-forwarded-proto':'http'},{'x-forwarded-for':'203.0.113.10, 172.20.0.2'},{origin:'https://mail.google.com/'}])assert.throws(()=>assertRequest(request('/local','GET',headers),security),e=>e.status===403);
 assert.throws(()=>assertRequest({...request('/local'),socket:{remoteAddress:'172.20.0.99'}},security),e=>e.status===403);
 assert.equal(assertRequest(request('/local','GET',{host:security.upstreamHost,'x-forwarded-host':security.host}),security).clientIP,'203.0.113.10');
 const stage={...security,stage:'staging',clients:['203.0.113.11']};assert.throws(()=>assertRequest(request('/local'),stage),e=>e.status===403);
});

test('normal same-origin login/API policy unchanged; Referer alone is not an authorization source',()=>{
 assert.equal(assertRequest(request('/api/local/login','POST',{'sec-fetch-site':'same-origin',origin:security.origin}),security).clientIP,'203.0.113.10');
 assert.throws(()=>assertRequest(request('/api/local/login','POST',{'sec-fetch-site':'same-origin',origin:'https://mail.google.com/'}),security),e=>e.status===403);
 assert.equal(assertRequest(request('/local','GET',{'sec-fetch-site':undefined,'sec-fetch-mode':undefined,'sec-fetch-dest':undefined}),security).clientIP,'203.0.113.10');
});

test('HTTP Gmail→public password page succeeds, fragment never reaches request/journal; cross-site APIs remain403 and public assets load same-origin',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'shape-public-entry-'));const app=await createLocalServer({filename:path.join(directory,'db.sqlite')});const seen=[];app.server.prependListener('request',req=>{seen.push(req.url);});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
 try{const synthetic='x'.repeat(43);const page=await raw(origin+'/local#password='+synthetic,{headers:gmail});assert.equal(page.status,200);assert.equal(page.headers['referrer-policy'],'no-referrer');assert.equal(seen.at(-1),'/local');assert.ok(!page.text.includes(synthetic));assert.ok(!JSON.stringify(app.store.all('SELECT * FROM operations')).includes(synthetic));
  assert.equal((await raw(origin+'/',{headers:gmail})).status,200);const head=await raw(origin+'/local',{method:'HEAD',headers:gmail});assert.equal(head.status,200);assert.equal(head.text,'');
  assert.equal((await raw(origin+'/api/local/students',{headers:gmail})).status,403);
  assert.equal((await raw(origin+'/api/local/password-access/confirm',{method:'POST',headers:{...gmail,Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(origin+'/api/local/students',{headers:{Origin:origin,'Sec-Fetch-Site':'same-origin'}})).status,401);
  assert.equal((await fetch(origin+'/sim/persistent.js',{headers:{'Sec-Fetch-Site':'same-origin'}})).status,200);
  assert.equal((await fetch(origin+'/local',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 }finally{await app.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
