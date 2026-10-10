import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {isolatedFixture,FIXTURE_PASSWORD} from './backend-fixtures.mjs';
import {applyCommerceFixture} from '../backend/commerce/migrate-fixture.mjs';
import {createLocalServer} from '../backend/server.mjs';
export const COMMERCE_PASSWORD='Commerce-fixture-password-only-2026!';
export async function commerceRuntimeFixture(options={}){
 const networkFetch=globalThis.fetch;const f=await isolatedFixture();applyCommerceFixture(f.store,{fixtureOnly:true});let clock=1700000000000;
 const config={enabled:true,fixtureOnly:true,adminId:f.ids.admin};let app,origin;const overrides=options.serverOptions?.(f,()=>clock)||{};
 async function start(store){app=await createLocalServer({store,filename:store?undefined:f.filename,loginLimit:100,now:()=>clock,commerce:config,...overrides});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+app.server.address().port;}
 await start(f.store);
 const client=()=>{const cookies=new Map();return {get cookies(){return cookies;},async request(route,body,method='POST',headers={}){
  const response=await networkFetch(origin+'/api/local/'+route,{method:body===undefined?'GET':method,headers:{...(cookies.size?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID()}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  for(const c of response.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');if(v)cookies.set(k,v);else cookies.delete(k);}
  return {status:response.status,data:await response.json(),headers:response.headers};
 },login(role='admin',password=FIXTURE_PASSWORD){return this.request('login',{email:role+'@fixture.invalid',password});}};};
 const admin=client();await admin.login();
 async function register(buyer,email='commerce@fixture.invalid'){return buyer.request('commerce/register',{name:'Comprador fictício',email});}
 async function order(buyer,sku='quarterly',key=randomUUID()){const r=await buyer.request('commerce/orders',{sku,billingType:'PIX'},'POST',{'Idempotency-Key':key});return r;}
 async function preview(email='commerce@fixture.invalid'){
  const r=await admin.request('commerce/admin/crm'),reg=r.data.registrations.find(r=>r.email===email),job=r.data.outbox.find(j=>j.buyer_id===reg.buyer_id&&j.kind==='verify-identity'&&j.state==='pending');
  const p=await admin.request('commerce/admin/outbox/'+job.id+'/preview',{});if(p.status!==200)throw Error('Fixture preview failed');return p.data.fragment.split('=')[1];
 }
 const confirm=(buyer,token,email='commerce@fixture.invalid',password=COMMERCE_PASSWORD)=>buyer.request('password-access/confirm',{token,email,password});
 const simulate=(id,scenario)=>admin.request('commerce/admin/orders/'+id+'/simulate',{scenario});
 const process=()=>admin.request('commerce/admin/process',{});
 return {...f,admin,client,register,order,preview,confirm,simulate,process,config,get app(){return app;},get store(){return app.store;},get origin(){return origin;},advance(ms){clock+=ms;},async restart(){await app.close();await start();},async close(){await app.close();rmSync(f.directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
}
