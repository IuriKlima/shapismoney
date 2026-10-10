import {COMMERCE_SOURCE_MARKER} from '../access-policy.mjs';
import {randomUUID} from 'node:crypto';
import {hashPassword,newToken,tokenHash} from '../auth.mjs';
import {asaasMockClient} from './asaas-mock.mjs';
import {localCommerce} from './flow.mjs';
import {COMMERCE_CATALOG,commerceError,exactFields} from './catalog.mjs';

export const MOCK_ACCOUNT='fixture-local-commerce';
export const MOCK_WEBHOOK_TOKEN='mock-only-local-commerce-no-real-secret-000000000';
const trustedIdentity=Symbol('local verified identity');
const TTL=15*60*1000;
const cookieName='sim_commerce_buyer';
const address=value=>{
 if(typeof value!=='string'||value.length>254||! /^[^\s@]+@fixture\.invalid$/i.test(value))throw commerceError(400,'Use somente e-mail fictício @fixture.invalid neste ensaio.');
 return value.toLowerCase();
};
const cookie=(token,age=28800)=>cookieName+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age;

// Opt-in only. No transport, credential lookup, automatic migrations or dispatch.
export async function commerceRuntime({store,security,session,now,read,configuration={}}){
 if(!configuration.enabled)return null;
 if(security.production||process.env.NODE_ENV==='production'||!['sqlite','postgres'].includes(store.kind)||store.kind==='postgres'&&configuration.embeddedPostgresFixture!==true||configuration.fixtureOnly!==true)throw commerceError(503,'Comércio simulado exige banco fictício explícito e loopback.');
 const admin=await store.get("SELECT * FROM users WHERE id=? AND role='admin' AND active=1",configuration.adminId);
 const unsafe=await store.get("SELECT COUNT(*) AS n FROM users WHERE email NOT LIKE '%@fixture.invalid'");
 if(!admin||unsafe.n||!await store.get('SELECT name FROM commerce_migrations WHERE name=?','001-local-commerce'))throw commerceError(503,'Fixture e migração comercial explícitas obrigatórias.');
 const enqueue=async(buyerId,key,kind)=>store.run('INSERT INTO commerce_outbox(id,buyer_id,org_id,dedupe_key,kind,state,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(buyer_id,dedupe_key) DO NOTHING',randomUUID(),buyerId,admin.org_id,key,kind,'pending',now());
 async function principal(req){
  if(req?.[trustedIdentity])return {buyerId:req[trustedIdentity],orgId:admin.org_id};
  const auth=await session(req);
  if(auth){if(auth.user.role!=='student')return null;const b=await store.get('SELECT id,org_id FROM commerce_buyers WHERE user_id=? AND org_id=? AND identity_verified_at IS NOT NULL AND active=1',auth.user.id,auth.user.org_id);return b?{buyerId:b.id,orgId:b.org_id}:null;}
  const value=new RegExp('(?:^|;\\s*)'+cookieName+'=([A-Za-z0-9_-]{43})(?:;|$)').exec(req.headers.cookie||'')?.[1];
  const b=value?await store.get('SELECT b.id,b.org_id FROM commerce_buyer_sessions s JOIN commerce_buyers b ON b.id=s.buyer_id WHERE s.token_hash=? AND s.expires_at>? AND b.active=1',tokenHash(value),now()):null;
  return b?{buyerId:b.id,orgId:b.org_id}:null;
 }
 async function proveIdentity({token,email,passwordHash}){
  if(!await store.get("SELECT id FROM users WHERE id=? AND org_id=? AND role='admin' AND active=1",admin.id,admin.org_id))throw commerceError(409,'Responsável fictício indisponível.');
  const proof=await store.get('SELECT * FROM commerce_identity_proofs WHERE token_hash=?',tokenHash(token));
  if(!proof||proof.consumed_at!==null||proof.expires_at<=now())throw commerceError(400,'Link inválido, expirado ou já utilizado.');
  const r=await store.get('SELECT * FROM commerce_registrations WHERE buyer_id=?',proof.buyer_id);
  if(!r||r.email!==email)throw commerceError(400,'Link inválido, expirado ou já utilizado.');
  await store.lockEmail(email);
  const b=await store.get('SELECT * FROM commerce_buyers WHERE id=?',r.buyer_id);
  let user=await store.get('SELECT * FROM users WHERE email=?',email);
  if(user&&(!b.user_id||b.user_id!==user.id||!user.active||user.role!=='student'||user.org_id!==r.org_id))throw commerceError(409,'Identidade já vinculada; procure a administração.');
  let studentId=r.student_id;
  if(!user){
   const id=randomUUID();await store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',id,r.org_id,email,r.name,'student',passwordHash);user={id};
   studentId=randomUUID();await store.run('INSERT INTO students(id,org_id,user_id,coach_id,email,name) VALUES (?,?,?,?,?,?)',studentId,r.org_id,id,admin.id,email,r.name);
   await store.run('INSERT INTO commerce_student_sources(student_id,org_id,buyer_id) VALUES (?,?,?)',studentId,r.org_id,r.buyer_id);
   await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',admin.id,'commerce-source-'+studentId,COMMERCE_SOURCE_MARKER,200,JSON.stringify({studentId,orgId:r.org_id,source:'payment'}));
   await store.run('UPDATE commerce_registrations SET student_id=? WHERE buyer_id=?',studentId,r.buyer_id);
  }else await store.run('UPDATE users SET password_hash=? WHERE id=?',passwordHash,user.id);
  if((await store.run('UPDATE commerce_identity_proofs SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL',now(),proof.token_hash)).changes!==1)throw commerceError(400,'Link já utilizado.');
  await store.run('UPDATE commerce_identity_proofs SET consumed_at=? WHERE buyer_id=? AND consumed_at IS NULL',now(),r.buyer_id);
  await store.run('UPDATE commerce_outbox SET state=? WHERE id=?','confirmed',proof.outbox_id);
  await store.run('DELETE FROM sessions WHERE user_id=?',user.id);await store.run('DELETE FROM commerce_buyer_sessions WHERE buyer_id=?',r.buyer_id);
  await store.run('INSERT INTO audit VALUES (?,?,?,?,?,?)',randomUUID(),r.org_id,user.id,studentId,'commerce.identity.email-proof-consumed',now());
  return {buyerId:r.buyer_id,orgId:r.org_id,userId:user.id};
 }
 const client=asaasMockClient({accountId:MOCK_ACCOUNT,transport:{kind:'mock',async request(req){
  if(req.method==='POST'){
   const o=await store.get('SELECT * FROM commerce_orders WHERE id=?',req.body.externalReference),scenario=await store.get('SELECT scenario FROM commerce_fixture_scenarios WHERE order_id=?',o.id),checkoutId='checkout_'+o.id;
   await store.run('INSERT INTO commerce_mock_checkouts(order_id,checkout_id,payments) VALUES (?,?,?) ON CONFLICT(order_id) DO NOTHING',o.id,checkoutId,'[]');
   if(scenario?.scenario==='timeout')throw commerceError(503,'Timeout fictício após criação do checkout.');return {id:checkoutId};
  }
  const query=new URL('https://fixture.invalid'+req.path).searchParams;
  const row=await store.get('SELECT * FROM commerce_mock_checkouts WHERE checkout_id=?',query.get('checkoutSession'));
  if(!row)return {hasMore:false,data:[]};
  if((await store.get('SELECT scenario FROM commerce_fixture_scenarios WHERE order_id=?',row.order_id))?.scenario==='list-failure')throw commerceError(503,'Falha fictícia de reconciliação.');
  return {hasMore:false,data:JSON.parse(row.payments)};
 }}});
 const core=localCommerce({store,client,resolvePrincipal:principal,resolveAdmin:async req=>{const u=(await session(req))?.user;return u?{userId:u.id}:null;},proveIdentity,webhookToken:MOCK_WEBHOOK_TOKEN,publicOrigin:'https://shape.fixture.invalid',now});
 async function syncOutbox(){
  await store.transaction(async()=>{
   for(const task of await store.all('SELECT t.*,o.buyer_id FROM commerce_tasks t JOIN commerce_orders o ON o.id=t.order_id WHERE t.org_id=?',admin.org_id))await enqueue(task.buyer_id,task.order_id+':'+task.kind,task.kind);
   for(const o of await store.all('SELECT * FROM commerce_orders WHERE org_id=? AND status=?',admin.org_id,'paid'))await enqueue(o.buyer_id,o.id+':paid','paid');
  });
 }
 async function accessState(row){
  const source=await store.get('SELECT * FROM commerce_student_sources WHERE student_id=? AND org_id=?',row.id,row.org_id);if(!source)return null;
  const b=await store.get('SELECT * FROM commerce_buyers WHERE id=? AND org_id=? AND user_id=? AND active=1',source.buyer_id,row.org_id,row.user_id);
  const e=b&&b.identity_verified_at!==null?await store.get("SELECT e.order_id FROM commerce_entitlements e JOIN commerce_orders o ON o.id=e.order_id WHERE e.buyer_id=? AND e.org_id=? AND e.onboarding_authorized=1 AND o.status IN ('paid','partially_refunded','refund_pending','chargeback')",b.id,row.org_id):null;
  return {mode:'commerce',source:'payment',active:!!e,sequence:0,level:null,expiresAt:null,periodPolicyPending:true,onboardingOnly:true,features:{training:false,nutrition:false}};
 }
 async function snapshots(req){const p=await principal(req);if(!p)return {registered:false,orders:[]};const b=await store.get('SELECT * FROM commerce_buyers WHERE id=?',p.buyerId);return {registered:true,identityVerified:b.identity_verified_at!==null,orders:await Promise.all((await store.all('SELECT id FROM commerce_orders WHERE buyer_id=? ORDER BY created_at DESC,id',b.id)).map(o=>core.summary(req,o.id)))};}
 async function requestProof(buyerId){
  const pending=await store.get("SELECT id FROM commerce_outbox WHERE buyer_id=? AND kind='verify-identity' AND state='pending'",buyerId);
  if(!pending)await enqueue(buyerId,'identity:'+randomUUID(),'verify-identity');
 }
 async function requireAdmin(req){const a=(await session(req))?.user;if(a?.role!=='admin'||a.org_id!==admin.org_id)throw commerceError(403,'Administração da organização obrigatória.');return a;}
 const publicPrefix='/api/local/commerce';
 async function handlePublic(req,route){
  if(route===publicPrefix+'/capabilities'&&req.method==='GET')return {status:200,data:{enabled:true,simulation:true,realCheckoutEnabled:false,periodPolicyPending:true,catalog:COMMERCE_CATALOG.map(p=>({...p,available:['quarterly','semiannual'].includes(p.id),installmentLimit:null}))}};
  if(route===publicPrefix+'/session'&&req.method==='GET')return {status:200,data:await snapshots(req)};
  if(route===publicPrefix+'/register'&&req.method==='POST'){
   const body=await read(req);exactFields(body,['name','email']);const email=address(body.email);if(typeof body.name!=='string'||body.name.trim().length<2||body.name.length>100)throw commerceError(400,'Nome de 2–100 caracteres obrigatório.');
   const token=newToken();let buyerId;
   await store.transaction(async()=>{
    await store.lockEmail(email);const old=await store.get('SELECT buyer_id FROM commerce_registrations WHERE email=?',email);
    if(old||await store.get('SELECT id FROM users WHERE email=?',email)||await store.get('SELECT id FROM students WHERE email=?',email))return;
    buyerId=randomUUID();await store.run('INSERT INTO commerce_buyers(id,org_id,customer_id,environment,account_id) VALUES (?,?,?,?,?)',buyerId,admin.org_id,'cus_fixture_'+buyerId,'mock',MOCK_ACCOUNT);
    await store.run('INSERT INTO commerce_registrations(buyer_id,org_id,email,name) VALUES (?,?,?,?)',buyerId,admin.org_id,email,body.name.trim());
    await store.run('INSERT INTO commerce_buyer_sessions VALUES (?,?,?)',tokenHash(token),buyerId,now()+28800000);await requestProof(buyerId);
   });
   return {status:202,data:{message:'Ensaio registrado. Nenhum e-mail enviado. Confirme a identidade pela prévia fictícia da administração.',simulation:true},...(buyerId?{buyerCookie:cookie(token)}:{})};
  }
  if(route===publicPrefix+'/recover'&&req.method==='POST'){
   const body=await read(req);exactFields(body,['email']);const email=address(body.email);
   await store.transaction(async()=>{const r=await store.get('SELECT buyer_id FROM commerce_registrations WHERE email=?',email);if(r)await requestProof(r.buyer_id);});
   return {status:202,data:{message:'Se existir um cadastro fictício, uma prévia estará disponível ao admin. Nenhum e-mail enviado.'}};
  }
  if(route==='/api/local/password-access/confirm'&&req.method==='POST'){
   // Shared confirmation endpoint. Only the hashed commercial proof selects this path.
   const body=await read(req);exactFields(body,['token','email','password']);
   if(typeof body.token!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(body.token))throw commerceError(400,'Link inválido.');
   const proof=await store.get('SELECT buyer_id FROM commerce_identity_proofs WHERE token_hash=?',tokenHash(body.token));
   if(!proof)return {forwardPasswordBody:body};
   if(typeof body.password!=='string'||body.password.length<14||body.password.length>128)throw commerceError(400,'Senha de 14–128 caracteres obrigatória.');
   await core.verifyIdentity({[trustedIdentity]:proof.buyer_id},{token:body.token,email:address(body.email),passwordHash:await hashPassword(body.password)});
   const token=newToken();await store.run('INSERT INTO commerce_buyer_sessions VALUES (?,?,?)',tokenHash(token),proof.buyer_id,now()+28800000);await syncOutbox();
   return {status:200,data:{completed:true,simulation:true,message:'Identidade fictícia confirmada. Entre com seu e-mail e senha; pagamento continua separado.'},buyerCookie:cookie(token),clearSession:true};
  }
  if(route===publicPrefix+'/webhook'&&req.method==='POST'){
   const body=await read(req,131072);return {status:200,data:await core.acceptWebhook({headers:req.headers,rawBody:JSON.stringify(body)})};
  }
  if(!route.startsWith(publicPrefix+'/'))return null;
  if(route===publicPrefix+'/orders'&&req.method==='POST'){
   const o=await core.createOrder(req,await read(req),req.headers['idempotency-key']);return {status:201,data:await core.summary(req,o.id)};
  }
  if(route===publicPrefix+'/interest'&&req.method==='POST'){const body=await read(req),result=await core.interest(req,body),p=await principal(req);await enqueue(p.buyerId,'interest:'+body.sku,'interest');return {status:202,data:result};}
  const own=/^\/api\/local\/commerce\/orders\/([a-f0-9-]{36})(\/checkout|\/reconcile)?$/.exec(route);
  if(own){
   if(!own[2]&&req.method==='GET')return {status:200,data:await core.summary(req,own[1])};
   if(req.method==='POST'){exactFields(await read(req),[]);if(own[2]==='/checkout'){await core.createCheckout(req,own[1]);return {status:200,data:await core.summary(req,own[1])};}if(own[2]==='/reconcile'){const data=await core.reconcile(req,own[1]);await syncOutbox();return {status:200,data};}}
  }
  return null;
 }
 async function handleAdmin(req,route){
  if(!route.startsWith(publicPrefix+'/admin/'))return null;const actor=await requireAdmin(req);
  if(route===publicPrefix+'/admin/crm'&&req.method==='GET')return {status:200,data:{...await core.crm(req),registrations:await store.all('SELECT buyer_id,email,name,student_id FROM commerce_registrations WHERE org_id=?',actor.org_id),outbox:await store.all('SELECT id,buyer_id,kind,state,created_at FROM commerce_outbox WHERE org_id=? ORDER BY created_at,id',actor.org_id),simulation:true,emailsSent:0}};
  if(route===publicPrefix+'/admin/process'&&req.method==='POST'){exactFields(await read(req),[]);const exclude=new Set();for(let i=0;i<20&&await core.processNext({exclude});i++);await syncOutbox();return {status:200,data:{processed:true,emailsSent:0}};}
  const preview=/^\/api\/local\/commerce\/admin\/outbox\/([a-f0-9-]{36})\/preview$/.exec(route);
  if(preview&&req.method==='POST'){
   exactFields(await read(req),[]);const token=newToken();let recipient;
   await store.transaction(async()=>{
    const o=await store.get("SELECT * FROM commerce_outbox WHERE id=? AND org_id=? AND kind='verify-identity' AND state='pending'",preview[1],actor.org_id);if(!o)throw commerceError(409,'Prévia já emitida. Solicite recuperação para gerar outro link.');
    recipient=(await store.get('SELECT email FROM commerce_registrations WHERE buyer_id=?',o.buyer_id)).email;
    await store.run('UPDATE commerce_identity_proofs SET consumed_at=? WHERE buyer_id=? AND consumed_at IS NULL',now(),o.buyer_id);
    await store.run('INSERT INTO commerce_identity_proofs VALUES (?,?,?,?,?,?)',tokenHash(token),o.buyer_id,o.id,now()+TTL,null,now());
    await store.run('UPDATE commerce_outbox SET state=? WHERE id=?','previewed',o.id);
   });
   return {status:200,data:{recipient,fragment:'#commerce-proof='+token,simulation:true,emailSent:false,expiresAt:now()+TTL}};
  }
  const simulate=/^\/api\/local\/commerce\/admin\/orders\/([a-f0-9-]{36})\/(simulate|pause)$/.exec(route);
  if(simulate&&req.method==='POST'){
   const body=await read(req);if(simulate[2]==='pause'){const data=await core.pauseOnboarding(req,simulate[1],body);return {status:200,data};}
   exactFields(body,['scenario']);if(!['paid','cancel','expired','refund','partial-refund','chargeback','timeout','recover-checkout','list-failure','restore-list'].includes(body.scenario))throw commerceError(400,'Cenário fictício inválido.');
   const o=await store.get('SELECT * FROM commerce_orders WHERE id=? AND org_id=?',simulate[1],actor.org_id);if(!o)throw commerceError(404,'Pedido indisponível.');
   if(['timeout','list-failure','restore-list'].includes(body.scenario)){
    if(body.scenario==='timeout'&&o.checkout_state!=='new')throw commerceError(409,'Timeout só pode ser preparado antes do checkout.');
    await store.run('INSERT INTO commerce_fixture_scenarios VALUES (?,?) ON CONFLICT(order_id) DO UPDATE SET scenario=excluded.scenario',o.id,body.scenario);return {status:200,data:{prepared:true,simulation:true}};
   }
   const checkout=await store.get('SELECT * FROM commerce_mock_checkouts WHERE order_id=?',o.id);if(!checkout)throw commerceError(409,'Abra primeiro o checkout fictício.');
   const types={paid:'CHECKOUT_PAID',cancel:'CHECKOUT_CANCELED',expired:'CHECKOUT_EXPIRED',refund:'PAYMENT_REFUNDED','partial-refund':'PAYMENT_PARTIALLY_REFUNDED',chargeback:'PAYMENT_CHARGEBACK_REQUESTED','recover-checkout':'CHECKOUT_CREATED'};
   if(body.scenario==='paid')await store.run('UPDATE commerce_mock_checkouts SET payments=? WHERE order_id=?',JSON.stringify([{id:'pay_'+o.id,customer:o.customer_id,externalReference:o.id,value:o.amount_cents/100,billingType:o.billing_type,status:o.billing_type==='PIX'?'RECEIVED':'CONFIRMED'}]),o.id);
   const eventId='evt_fixture_'+o.id+'_'+body.scenario,paymentEvent=['refund','partial-refund','chargeback'].includes(body.scenario);
   const result=await core.acceptWebhook({headers:{'asaas-access-token':MOCK_WEBHOOK_TOKEN},rawBody:JSON.stringify({id:eventId,event:types[body.scenario],account:{id:MOCK_ACCOUNT},...(paymentEvent?{payment:{id:'pay_'+o.id,externalReference:o.id,customer:o.customer_id}}:{checkout:{id:checkout.checkout_id,externalReference:o.id,customer:o.customer_id}})})});
   return {status:200,data:{...result,simulation:true,queued:true}};
  }
  throw commerceError(404,'Recurso comercial indisponível.');
 }
 async function logout(req){const value=new RegExp('(?:^|;\\s*)'+cookieName+'=([A-Za-z0-9_-]{43})(?:;|$)').exec(req.headers.cookie||'')?.[1];if(value)await store.run('DELETE FROM commerce_buyer_sessions WHERE token_hash=?',tokenHash(value));return cookie('',0);}
 return {handlePublic,handleAdmin,accessState,syncOutbox,logout};
}
