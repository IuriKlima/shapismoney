import {randomUUID,createHash} from 'node:crypto';
import {commerceError} from './catalog.mjs';
import {isAsaasSandboxClient} from './asaas-client.mjs';

// Operator-only, never mounted or run at startup. No provider writes. A reviewed
// account correction is distinct from webhook acceptance or payment confirmation.
export async function repairSandboxAccountScope({store,client,orderId,actorId,orgId,fromAccountId,toAccountId,expectedRevision,expectedUpdatedAt,expectedCheckoutId,apply=false,approved=false,now=Date.now}){
 const fail=()=>{throw commerceError(409,'Account repair evidence or isolated order state changed.');};
 if(process.env.NODE_ENV==='production'||store.kind!=='sqlite'||!isAsaasSandboxClient(client)||client.scope.environment!=='sandbox'||client.scope.accountId!==toAccountId||fromAccountId===toAccountId)fail();
 // Authority is the current credential's GET response, never the webhook account ID.
 const identity=await client.verifyAccount(),checkedAt=now();if(identity.id!==toAccountId)fail();
 const first=await store.get('SELECT * FROM commerce_orders WHERE id=?',orderId);if(!first||first.checkout_id!==expectedCheckoutId)fail();
 const customer=await client.customerById(first.customer_id),payments=await client.paymentsByCheckout(expectedCheckoutId);
 if(payments.length!==1)fail();const p=payments[0];
 if(p.checkoutSession!==expectedCheckoutId||p.customer!==first.customer_id||p.externalReference!==null&&p.externalReference!==first.external_reference||p.value!==499||p.billingType!=='PIX'||p.status!=='PENDING'||p.deleted||p.subscription||p.installment||p.refunds?.length||p.chargeback)fail();
 return store.transaction(async()=>{
  if(now()-checkedAt>60000||now()<checkedAt)fail();
  const actor=await store.get("SELECT id FROM users WHERE id=? AND org_id=? AND role='admin' AND active=1",actorId,orgId);
  const scope=await store.get('SELECT * FROM asaas_runtime_config WHERE singleton=1');
  const o=await store.get('SELECT * FROM commerce_orders WHERE id=?',orderId);
  const b=await store.get('SELECT * FROM commerce_buyers WHERE id=?',o?.buyer_id);
  if(!actor||scope?.org_id!==orgId||scope.account_id!==fromAccountId||!o||!b||o.org_id!==orgId||b.org_id!==orgId||o.environment!=='sandbox'||b.environment!=='sandbox'||o.account_id!==fromAccountId||b.account_id!==fromAccountId||b.customer_id!==o.customer_id||o.customer_id!==first.customer_id||o.external_reference!==first.external_reference||b.active!==1||b.identity_verified_at===null)fail();
  if(o.revision!==expectedRevision||o.updated_at!==expectedUpdatedAt||o.checkout_id!==expectedCheckoutId||o.status!=='pending'||o.checkout_state!=='ready'||o.adverse_seen||o.billing_type!=='PIX'||o.amount_cents!==49900)fail();
  // Narrowly repair this single isolated unpaid buyer/order; never mass-relabel history.
  for(const table of ['commerce_buyers','commerce_orders'])if((await store.get('SELECT COUNT(*) n FROM '+table)).n!==1)fail();
  for(const table of ['commerce_events','commerce_payments','commerce_entitlements','asaas_service_periods'])if((await store.get('SELECT COUNT(*) n FROM '+table)).n!==0)fail();
  const u=await store.get("SELECT * FROM users WHERE id=? AND org_id=? AND role='student' AND active=1",b.user_id,orgId);
  const intent=await store.get('SELECT * FROM asaas_customer_intents WHERE user_id=? AND org_id=?',b.user_id,orgId);
  if(!u||!intent||intent.state!=='ready'||intent.customer_id!==o.customer_id||customer.id!==o.customer_id||customer.email!==u.email||customer.externalReference!==intent.reference||customer.notificationDisabled!==true||createHash('sha256').update(u.id+'\0'+u.email+'\0'+String(customer.cpfCnpj||'').replace(/\D/g,'')).digest('hex')!==intent.fingerprint)fail();
  const plan={orderId,fromAccountId,toAccountId,fromRevision:o.revision,toRevision:o.revision+1,checkoutId:o.checkout_id,paymentId:p.id,providerWrites:0,financialStatusPreserved:true,identityPreserved:true};
  if(!apply)return {dryRun:true,plan};
  if(!approved)throw commerceError(403,'Explicit account-scope correction approval required.');
  await store.run('UPDATE asaas_runtime_config SET account_id=? WHERE singleton=1 AND account_id=?',toAccountId,fromAccountId);
  await store.run('UPDATE commerce_buyers SET account_id=? WHERE id=? AND account_id=?',toAccountId,b.id,fromAccountId);
  const changed=await store.run('UPDATE commerce_orders SET account_id=?,revision=revision+1,updated_at=? WHERE id=? AND account_id=? AND revision=? AND updated_at=?',toAccountId,now(),o.id,fromAccountId,expectedRevision,expectedUpdatedAt);if(changed.changes!==1)fail();
  await store.run('INSERT INTO commerce_audit VALUES (?,?,?,?,?)',randomUUID(),o.id,orgId,'commerce.account.scope-corrected:'+JSON.stringify({actorId,fromAccountId,toAccountId,authority:'GET /v3/myAccount/status',checkedAt,fromRevision:o.revision,checkoutId:o.checkout_id,paymentId:p.id}),now());
  return {applied:true,plan};
 });
}
