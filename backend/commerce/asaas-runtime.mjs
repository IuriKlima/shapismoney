import {randomUUID,createHash} from 'node:crypto';
import {asaasSandboxClient} from './asaas-client.mjs';
import {compileAsaasOffers} from './asaas-policy.mjs';
import {asaasSandboxCommerce} from './flow.mjs';
import {asaasWebhookHandler} from './asaas-preparation.mjs';
import {commerceError,exactFields} from './catalog.mjs';
import {protocolPeriod,renewalNotice} from './manual-period.mjs';
import {refundWindow} from './refund-window.mjs';
import {COMMERCE_SOURCE_MARKER} from '../access-policy.mjs';
import {assertRequest} from '../security.mjs';
import {FINANCIAL_FIELDS,financialFields,financialStatus} from './customer-profile.mjs';

// Actual application sessions, application DB and Asaas HTTP client. No fixture identities.
// Explicit sandbox activation only; no automatic migration or secret discovery.
export async function asaasRuntime({store,security,session,read,intakeState,now=Date.now,configuration={}}){
 if(!configuration.enabled)return null;
 if(process.env.NODE_ENV==='production'||security.production||store.kind!=='sqlite'||configuration.isolatedSandbox!==true||configuration.apiKey===configuration.webhookToken)throw commerceError(503,'Backend sandbox isolado obrigatorio.');
 const scope=await store.get('SELECT * FROM asaas_runtime_config WHERE singleton=1');
 if(!scope||scope.account_id!==configuration.accountId||scope.org_id!==configuration.orgId)throw commerceError(503,'Migracao e escopo sandbox obrigatorios.');
 const client=asaasSandboxClient(configuration);
 // Verify the credential identity before registering handlers or touching access markers.
 await client.verifyAccount();
async function sourceMarker(row){await store.run('INSERT INTO operations VALUES (?,?,?,?,?) ON CONFLICT(actor_id,operation_key) DO NOTHING',row.user_id||row.coach_id,'commerce-source-'+row.id,COMMERCE_SOURCE_MARKER,200,JSON.stringify({studentId:row.id,orgId:row.org_id,source:'payment'}));}
await store.transaction(async()=>{for(const row of await store.all('SELECT * FROM students WHERE org_id=?',scope.org_id))await sourceMarker(row);});

 async function actor(req,role){const u=(await session(req))?.user;if(!u||u.org_id!==scope.org_id||role&&u.role!==role)throw commerceError(401,'Sessao autorizada obrigatoria.');return u;}
 async function principal(req){const u=await actor(req,'student');const b=await store.get('SELECT id,org_id FROM commerce_buyers WHERE user_id=? AND org_id=? AND active=1',u.id,u.org_id);return b?{buyerId:b.id,orgId:b.org_id}:null;}
 const offers=[['monthly',49900,1],['quarterly',119700,3],['semiannual',179400,6]].map(([sku,amountCents,months])=>({sku,amountCents,months,approved:true,version:'manual-protocol-20261012',billingTypes:['PIX','CREDIT_CARD'],maxInstallments:months,renewal:'blocked',access:'onboarding-only'}));
 const offerPolicy=compileAsaasOffers(offers);
 const capabilities=()=>({enabled:true,mode:'asaas-sandbox',environment:'sandbox',automaticRenewal:false,catalog:offers.map(o=>({...offerPolicy.snapshot(o.sku,{billingType:o.billingTypes[0]}),billingTypes:[...o.billingTypes],maxInstallments:o.maxInstallments}))});
 async function renewalGuard(b){
  if(await store.get("SELECT id FROM commerce_orders WHERE buyer_id=? AND status IN ('pending','overdue','review','refund_pending','partially_refunded','chargeback')",b.id))throw commerceError(409,'Resolva a compra existente antes de outra.');
  if(await store.get("SELECT o.id FROM commerce_orders o LEFT JOIN asaas_service_periods p ON p.order_id=o.id WHERE o.buyer_id=? AND o.status='paid' AND p.order_id IS NULL",b.id))throw commerceError(409,'Compra paga aguarda protocolo.');
  if(await store.get('SELECT p.order_id FROM asaas_service_periods p JOIN commerce_orders o ON o.id=p.order_id WHERE o.buyer_id=? AND p.starts_at>?',b.id,now()))throw commerceError(409,'Proximo periodo ja comprado.');
 }
 const core=asaasSandboxCommerce({...configuration,store,client,now,offers,resolvePrincipal:principal,proveIdentity:async()=>{throw commerceError(403,'Use a sessao do aplicativo.');},resolveAdmin:async req=>({userId:(await actor(req,'admin')).id}),manualRenewalGuard:renewalGuard,verifyBuyerIdentity});
 const webhook=asaasWebhookHandler({capabilities:{enabled:true},acceptWebhook:core.acceptWebhook});
 async function verifyBuyerIdentity(o){
  const b=await store.get('SELECT * FROM commerce_buyers WHERE id=? AND org_id=? AND active=1',o.buyer_id,o.org_id);
  if(!b||b.account_id!==o.account_id||b.account_id!==scope.account_id||b.environment!=='sandbox'||b.customer_id!==o.customer_id||b.identity_verified_at===null)return false;
  const u=await store.get("SELECT * FROM users WHERE id=? AND org_id=? AND role='student' AND active=1",b.user_id,o.org_id);
  const intent=await store.get('SELECT * FROM asaas_customer_intents WHERE user_id=? AND org_id=?',b.user_id,o.org_id);
  if(!u||!intent||intent.state!=='ready'||intent.customer_id!==o.customer_id)return false;
  const c=await client.customerById(o.customer_id);
  return c.id===intent.customer_id&&c.email===u.email&&c.externalReference===intent.reference&&createHash('sha256').update(u.id+'\0'+u.email+'\0'+String(c.cpfCnpj||'').replace(/\D/g,'')).digest('hex')===intent.fingerprint;
 }
 async function customer(req,body){
  exactFields(body,['cpfCnpj','confirmed',...FINANCIAL_FIELDS]);const profile=financialFields(body);if(body.confirmed!==true||typeof body.cpfCnpj!=='string'||!/^(?:\d{11}|\d{14})$/.test(body.cpfCnpj))throw commerceError(400,'Confirme o cadastro financeiro.');
  const u=await actor(req,'student'),student=await store.get('SELECT * FROM students WHERE user_id=? AND org_id=?',u.id,u.org_id);if(!student)throw commerceError(409,'Cadastro do aluno obrigatorio.');
  const fingerprint=createHash('sha256').update(u.id+'\0'+u.email+'\0'+body.cpfCnpj).digest('hex');let intent,claimed=false;
  await store.transaction(async()=>{await actor(req,'student');intent=await store.get('SELECT * FROM asaas_customer_intents WHERE user_id=?',u.id);if(intent){if(intent.fingerprint!==fingerprint)throw commerceError(409,'Cadastro financeiro mudou; revisao necessaria.');return;}
   // Never silently override an existing manually granted service contract.
   if(await store.get("SELECT operation_key FROM operations WHERE operation_key LIKE ?",'access-grant-'+student.id+'-%'))throw commerceError(409,'Acesso manual existente exige migracao revisada.');
   intent={reference:randomUUID(),state:'creating'};await store.run('INSERT INTO asaas_customer_intents VALUES (?,?,?,?,?,NULL)',u.id,u.org_id,intent.reference,fingerprint,'creating');claimed=true;});
  if(intent.state==='ready')return {registered:true};
  if(!claimed)throw commerceError(409,'Cadastro inconclusivo; use recuperacao, sem novo envio.');
  try{const matches=await client.customersByReference(intent.reference);if(matches.length)throw commerceError(409,'Referencia existente exige recuperacao.');const result=await client.createCustomer({name:u.name,email:u.email,cpfCnpj:body.cpfCnpj,externalReference:intent.reference,notificationDisabled:true,...profile});await bindCustomer(u,student,result.id,intent.reference);return {registered:true};}
  catch{await store.run("UPDATE asaas_customer_intents SET state='unknown' WHERE user_id=? AND state='creating'",u.id);throw commerceError(503,'Cadastro inconclusivo; nao repetir criacao.');}
 }
 async function bindCustomer(u,student,customerId,reference){await store.transaction(async()=>{
  const live=await store.get('SELECT * FROM users WHERE id=? AND org_id=? AND active=1',u.id,u.org_id);if(!live||live.email!==u.email||live.role!=='student')throw commerceError(409,'Identidade mudou.');
  const old=await store.get('SELECT * FROM asaas_customer_intents WHERE user_id=?',u.id);if(old.state==='ready'){if(old.customer_id!==customerId)throw commerceError(409,'Customer divergente.');return;}
  const buyerId=randomUUID();await store.run('INSERT INTO commerce_buyers(id,org_id,user_id,customer_id,environment,account_id,identity_verified_at) VALUES (?,?,?,?,?,?,?)',buyerId,u.org_id,u.id,customerId,'sandbox',scope.account_id,now());
  await store.run('INSERT INTO asaas_student_sources VALUES (?,?)',student.id,buyerId);
  await sourceMarker(student);
  await store.run("UPDATE asaas_customer_intents SET state='ready',customer_id=? WHERE user_id=? AND reference=?",customerId,u.id,reference);
 });}
 async function recoverCustomer(req,body){exactFields(body,['cpfCnpj']);const u=await actor(req,'student'),intent=await store.get('SELECT * FROM asaas_customer_intents WHERE user_id=?',u.id);if(!intent||intent.state==='ready')return {registered:intent?.state==='ready'};
  if(typeof body.cpfCnpj!=='string'||createHash('sha256').update(u.id+'\0'+u.email+'\0'+body.cpfCnpj).digest('hex')!==intent.fingerprint)throw commerceError(409,'Cadastro divergente.');
  const rows=await client.customersByReference(intent.reference);if(rows.length!==1||rows[0].email!==u.email||rows[0].cpfCnpj?.replace(/\D/g,'')!==body.cpfCnpj)throw commerceError(409,'Cadastro ainda inconclusivo; revisao necessaria.');
  await bindCustomer(u,await store.get('SELECT * FROM students WHERE user_id=? AND org_id=?',u.id,u.org_id),rows[0].id,intent.reference);return {registered:true};
 }

 // Read provider data only for the customer already bound to this signed-in user.
 async function customerProfile(req){
  const u=await actor(req,'student');
  const b=await store.get('SELECT * FROM commerce_buyers WHERE user_id=? AND org_id=? AND active=1',u.id,u.org_id);
  const intent=await store.get('SELECT * FROM asaas_customer_intents WHERE user_id=?',u.id);
  if(!b||!intent||intent.state!=='ready'||intent.customer_id!==b.customer_id||b.account_id!==scope.account_id||b.environment!=='sandbox')throw commerceError(409,'Cadastro financeiro não vinculado.');
  const c=await client.customerById(b.customer_id);
  const fingerprint=createHash('sha256').update(u.id+'\0'+u.email+'\0'+String(c.cpfCnpj||'').replace(/\D/g,'')).digest('hex');
  if(c.externalReference!==intent.reference||c.email!==u.email||fingerprint!==intent.fingerprint)throw commerceError(409,'Identidade financeira divergente.');
  return {buyer:b,customer:c,status:financialStatus(c)};
 }
 async function updateCustomerProfile(req,body){
  exactFields(body,[...FINANCIAL_FIELDS,'confirmed']);if(body.confirmed!==true)throw commerceError(400,'Confirme os dados fictícios.');
  const fields=financialFields(body);
  return store.transaction(async()=>{
   const before=await customerProfile(req);
   if(await store.get("SELECT id FROM commerce_orders WHERE buyer_id=? AND (checkout_state IN ('creating','unknown','ready') OR status='paid')",before.buyer.id))throw commerceError(409,'Checkout existente exige revisão antes de alterar o cadastro.');
   // Absolute PUT on the same customer; never create a replacement or resend automatically.
   await client.updateCustomer(before.buyer.customer_id,{...fields,notificationDisabled:true});
   const after=await customerProfile(req);
   // Asaas may canonicalize street/neighborhood from the CEP; verify the submitted
   // phone, number and CEP, plus the completeness of its returned address/city.
   const returned=after.status.ready?financialFields(after.customer):null;
   if(!returned||['phone','addressNumber','postalCode'].some(k=>returned[k]!==fields[k]))throw commerceError(409,'Cadastro retornado pelo Asaas requer revisão. Nenhum checkout foi enviado.');
   return {registered:true,financialProfile:after.status};
  });
 }

 async function accessState(row){if(row.org_id!==scope.org_id)return null;const source=await store.get('SELECT buyer_id FROM asaas_student_sources WHERE student_id=?',row.id);if(!source)return {mode:'commerce',source:'payment',active:false,sequence:0,level:null,expiresAt:null,features:{training:false,nutrition:false}};
  const orders=await store.all('SELECT o.id,o.status,e.onboarding_authorized FROM commerce_orders o JOIN commerce_entitlements e ON e.order_id=o.id JOIN commerce_buyers b ON b.id=o.buyer_id WHERE b.id=? AND b.user_id=? AND b.org_id=? AND b.active=1',source.buyer_id,row.user_id,row.org_id);
  const valid=orders.filter(o=>o.status==='paid'&&o.onboarding_authorized===1),periods=await store.all('SELECT * FROM asaas_service_periods WHERE student_id=? ORDER BY ends_at DESC',row.id),current=periods.find(p=>valid.some(o=>o.id===p.order_id)&&p.starts_at<=now()&&p.ends_at>now()),pending=valid.some(o=>!periods.some(p=>p.order_id===o.id));
  return {mode:'commerce',source:'payment',active:!!current||pending,sequence:0,level:null,expiresAt:current?.ends_at??null,periodPolicyPending:false,onboardingOnly:!current,servicePurchased:valid.length>0,features:{training:!!current,nutrition:!!current}};
 }
 // Invoked inside the existing publication transaction, after clinical approval.
 async function publishedLocked(actor,row,planId,kind='training'){const nutrition=kind==='nutrition',column=nutrition?'nutrition_plan_id':'plan_id',table=nutrition?'nutrition_plans':'plans';const source=await store.get('SELECT buyer_id FROM asaas_student_sources WHERE student_id=?',row.id);if(!source)return;
  if(actor.org_id!==row.org_id||!(nutrition?actor.role==='nutrition'&&row.nutrition_id===actor.id:actor.role==='admin'||actor.role==='coach'&&row.coach_id===actor.id))throw commerceError(403,'Profissional responsavel obrigatorio.');
  const binding=await store.get('SELECT * FROM asaas_protocol_orders WHERE '+column+'=? AND student_id=?',planId,row.id);if(!binding){const state=await accessState(row);if(state?.features.training)return;throw commerceError(409,'Vincule este protocolo a compra antes de publicar.');}
  const previous=await store.get('SELECT * FROM asaas_service_periods WHERE order_id=?',binding.order_id);if(previous)return previous;
  const o=await store.get("SELECT o.* FROM commerce_orders o JOIN commerce_entitlements e ON e.order_id=o.id WHERE o.id=? AND o.buyer_id=? AND o.org_id=? AND o.status='paid' AND o.adverse_seen=0 AND e.onboarding_authorized=1",binding.order_id,source.buyer_id,row.org_id);
  const intake=await intakeState(row.id,row.org_id),plan=await store.get("SELECT * FROM "+table+" WHERE id=? AND student_id=? AND status='published'",planId,row.id);
  if(!o||!intake.complete||intake.reviewPending||!plan||plan.published_at>now())throw commerceError(409,'Pagamento, anamnese revisada e publicacao obrigatorios.');
  const last=await store.get('SELECT MAX(ends_at) AS end FROM asaas_service_periods WHERE student_id=?',row.id),dates=protocolPeriod({releasedAt:plan.published_at,currentEnd:last?.end??null,months:JSON.parse(o.snapshot).durationMonths,policyConfirmed:true});
  await store.run('INSERT INTO asaas_service_periods VALUES (?,?,?,?,?,?,?,?)',o.id,row.id,nutrition?null:plan.id,nutrition?plan.id:null,actor.id,plan.published_at,dates.start,dates.end);
  await store.run('INSERT INTO commerce_audit VALUES (?,?,?,?,?)',randomUUID(),o.id,row.org_id,'commerce.protocol.first-release',now());return dates;
 }
 async function orderSummary(req,id){const {externalPaymentPerformed,...summary}=await core.summary(req,id);return {...summary,plan:{...summary.plan,renewal:'manual'},sandbox:true,automaticRenewal:false};}
async function processBatch(){let processed=0;const exclude=new Set();while(processed<20&&await core.processNext({exclude}))processed++;return {processed};}
 async function handle(req,route){if(!route.startsWith('/api/local/asaas/'))return null;const u=await actor(req),prefix='/api/local/asaas';
  if(route===prefix+'/customer'&&req.method==='POST')return {status:200,data:await customer(req,await read(req))};
  if(route===prefix+'/customer/profile'&&req.method==='PUT')return {status:200,data:await updateCustomerProfile(req,await read(req))};
  if(route===prefix+'/customer/recover'&&req.method==='POST')return {status:200,data:await recoverCustomer(req,await read(req))};
  if(route===prefix+'/process'&&req.method==='POST'){await actor(req,'admin');exactFields(await read(req),[]);return {status:200,data:await processBatch()};}
  if(route===prefix+'/orders'&&req.method==='POST'){const b=await read(req);exactFields(b,['sku','billingType','confirmed']);if(b.confirmed!==true)throw commerceError(400,'Confirme a nova compra.');const o=await core.createOrder(req,{sku:b.sku,billingType:b.billingType},req.headers['idempotency-key']);return {status:201,data:await orderSummary(req,o.id)};}
  if(route===prefix+'/account'&&req.method==='GET'){const p=await principal(req);if(!p)return {status:200,data:{registered:false,orders:[]}};const rows=await store.all('SELECT o.*,e.created_at AS paid_at FROM commerce_orders o LEFT JOIN commerce_entitlements e ON e.order_id=o.id WHERE o.buyer_id=? ORDER BY o.created_at',p.buyerId);return {status:200,data:{registered:true,financialProfile:(await customerProfile(req)).status,automaticRenewal:false,orders:await Promise.all(rows.map(async o=>{const period=await store.get('SELECT starts_at,ends_at FROM asaas_service_periods WHERE order_id=?',o.id);return {...await orderSummary(req,o.id),periodPolicyPending:false,protocolPublished:!!period,period:period||null,refundWindow:refundWindow(o.paid_at,now()),notice:renewalNotice(period?.ends_at,now())};}))}};}
  const m=/^\/api\/local\/asaas\/orders\/([a-f0-9-]{36})\/(checkout|protocol|request)$/.exec(route);
  if(m&&req.method==='POST'){const body=await read(req);if(m[2]==='checkout'){exactFields(body,[]);await core.summary(req,m[1]);if(!(await customerProfile(req)).status.ready)throw commerceError(409,'Complete o cadastro financeiro antes de preparar o checkout.');const o=await core.createCheckout(req,m[1]);return {status:200,data:{orderId:o.id,checkoutUrl:client.hostedCheckoutUrl(o.checkout_id)}};}
   if(m[2]==='request'){exactFields(body,['kind','confirmed']);if(body.confirmed!==true||!['refund','cancel-purchase'].includes(body.kind))throw commerceError(400,'Confirme a solicitacao.');await core.summary(req,m[1]);const e=await store.get('SELECT created_at FROM commerce_entitlements WHERE order_id=?',m[1]);await store.run('INSERT INTO asaas_purchase_requests VALUES (?,?,?,?) ON CONFLICT(order_id,kind) DO NOTHING',m[1],body.kind,now(),refundWindow(e?.created_at,now()).status);return {status:202,data:{recorded:true,providerActionPerformed:false}};}
   exactFields(body,['planId','kind']);const kind=body.kind||'training';if(!['training','nutrition'].includes(kind))throw commerceError(400,'Tipo de protocolo invalido.');const nutrition=kind==='nutrition';if(!['admin','coach','nutrition'].includes(u.role))throw commerceError(403,'Profissional obrigatorio.');
   await store.transaction(async()=>{const current=await actor(req);const o=await store.get('SELECT o.*,s.student_id FROM commerce_orders o JOIN asaas_student_sources s ON s.buyer_id=o.buyer_id WHERE o.id=? AND o.org_id=?',m[1],u.org_id);if(!o)throw commerceError(404,'Compra indisponivel.');await store.lockStudent(o.student_id);const row=await store.get('SELECT * FROM students WHERE id=? AND org_id=?',o.student_id,u.org_id);if(!(nutrition?current.role==='nutrition'&&row.nutrition_id===current.id:current.role==='admin'||current.role==='coach'&&row.coach_id===current.id))throw commerceError(403,'Profissional responsavel obrigatorio.');const plan=await store.get('SELECT * FROM '+(nutrition?'nutrition_plans':'plans')+' WHERE id=? AND student_id=?',body.planId,row.id);if(!plan||plan.status==='published')throw commerceError(409,'Selecione protocolo ainda nao publicado.');const old=await store.get('SELECT * FROM asaas_protocol_orders WHERE order_id=?',o.id);if(old&&(nutrition?old.nutrition_plan_id:old.plan_id)!==plan.id)throw commerceError(409,'Compra ja vinculada a outro protocolo.');await store.run('INSERT INTO asaas_protocol_orders VALUES (?,?,?,?) ON CONFLICT(order_id) DO NOTHING',o.id,row.id,nutrition?null:plan.id,nutrition?plan.id:null);});return {status:200,data:{bound:true}};
  }
  throw commerceError(404,'Rota sandbox indisponivel.');
 }
 return {handle,capabilities,accessState,publishedLocked,processBatch,allowsInvitedIdentity:async row=>{if(row.org_id!==scope.org_id)return false;await sourceMarker(row);return true;},async handleWebhook(req,res){
  let pathname;try{pathname=new URL(req.url,'http://127.0.0.1').pathname;}catch{return false;}if(pathname!=='/api/asaas/webhook')return false;
  // Dedicated server-to-server route; retain socket/Host checks, no browser CSRF bypass elsewhere.
  try{const headers={...req.headers};delete headers.origin;delete headers['sec-fetch-site'];assertRequest({method:'GET',url:req.url,headers,socket:req.socket},security.sandbox?{...security,stage:'webhook'}:security);}catch{res.writeHead(403);res.end();return true;}
  await webhook(req,res);return true;
 }};
}
