import {randomUUID} from 'node:crypto';
import {commerceError} from './catalog.mjs';

// Operator-only library, deliberately not mounted on HTTP or imported by startup.
// Evidence must come from a reviewed provider log and fresh read-only provider queries.
// This routine never contacts the provider and never creates a checkout or grants access.
export async function recoverRejectedCheckout({store,orderId,actorId,accountId,orgId,expectedRevision,expectedUpdatedAt,evidence,apply=false,approved=false,now=Date.now}){
 const fail=()=>{throw commerceError(409,'Recovery evidence or order state does not match.');};
 if(process.env.NODE_ENV==='production'||store.kind!=='sqlite'||!evidence||!/^\d{1,30}$/.test(evidence.logId||''))fail();
 const marker='commerce.checkout.retry-authorized:'+evidence.logId;
 return store.transaction(async()=>{
  const actor=await store.get("SELECT id FROM users WHERE id=? AND org_id=? AND role='admin' AND active=1",actorId,orgId);
  const scope=await store.get('SELECT account_id,org_id FROM asaas_runtime_config WHERE singleton=1');
  const o=await store.get('SELECT * FROM commerce_orders WHERE id=?',orderId);
  if(!actor||scope?.account_id!==accountId||scope?.org_id!==orgId||!o||o.environment!=='sandbox'||o.account_id!==accountId||o.org_id!==orgId)fail();
  if(await store.get('SELECT id FROM commerce_audit WHERE order_id=? AND event=?',orderId,marker))return {orderId,alreadyRecorded:true,rearmed:false};
  if(o.billing_type!=='PIX'||o.amount_cents!==49900||o.revision!==expectedRevision||o.updated_at!==expectedUpdatedAt||o.checkout_id||o.adverse_seen||!((o.checkout_state==='unknown'&&o.status==='pending')||(o.checkout_state==='new'&&o.status==='review')))fail();
  const e=evidence;
  if(e.orderId!==o.id||e.externalReference!==o.external_reference||e.customerId!==o.customer_id||e.accountId!==accountId||e.environment!=='sandbox'||e.method!=='POST'||e.path!=='/api/v3/checkouts'||e.httpStatus!==400||e.code!=='invalid_object'||!['missing-pix-key','missing-customer-profile'].includes(e.reason)||e.responseHasResource!==false||e.reviewedLog!==true||e.singleAttemptConfirmed!==true||e.checkoutAbsenceBasis!=='provider-validation-rejection')fail();
  if(e.reason==='missing-customer-profile'&&(o.status!=='review'||o.checkout_state!=='new'||e.customerProfileVerified!==true||e.notificationDisabled!==true||!Number.isSafeInteger(e.city)||e.city<=0||e.city>2147483647||JSON.stringify(e.rejectedFields)!==JSON.stringify(['phone','address','addressNumber','postalCode','province','city'])))fail();
  if(!Number.isSafeInteger(e.checkedAt)||e.checkedAt>now()||now()-e.checkedAt>60000||e.paymentsHttpStatus!==200||e.paymentsComplete!==true||e.paymentCount!==0||e.activePixKey!==true)fail();
  for(const table of ['commerce_payments','commerce_entitlements','asaas_service_periods'])if(await store.get('SELECT order_id FROM '+table+' WHERE order_id=?',orderId))fail();
  if(await store.get('SELECT event_id FROM commerce_events WHERE environment=? AND account_id=? AND (external_reference=? OR customer_id=?)','sandbox',accountId,o.external_reference,o.customer_id))fail();
  if(await store.get("SELECT id FROM commerce_orders WHERE buyer_id=? AND id<>? AND (checkout_state IN ('creating','unknown') OR status IN ('pending','paid','review'))",o.buyer_id,o.id))fail();
  const plan={orderId,from:{status:o.status,checkoutState:o.checkout_state,revision:o.revision},to:{status:'pending',checkoutState:'new',revision:o.revision+1},externalReferencePreserved:true,idempotencyKeyPreserved:true,providerWrites:0};
  if(!apply)return {dryRun:true,plan};
  if(!approved)throw commerceError(403,'Explicit approval required before recovery.');
  const result=await store.run("UPDATE commerce_orders SET status='pending',checkout_state='new',revision=revision+1,updated_at=? WHERE id=? AND revision=? AND updated_at=? AND checkout_id IS NULL",now(),orderId,expectedRevision,expectedUpdatedAt);
  if(result.changes!==1)fail();
  await store.run('INSERT INTO commerce_audit VALUES (?,?,?,?,?)',randomUUID(),orderId,orgId,marker,now());
  await store.run('INSERT INTO commerce_audit VALUES (?,?,?,?,?)',randomUUID(),orderId,orgId,'commerce.checkout.recovery-evidence:'+JSON.stringify({actorId,logId:e.logId,http:400,code:e.code,reason:e.reason,checkedAt:e.checkedAt,paymentCount:0,checkoutAbsenceBasis:e.checkoutAbsenceBasis,from:plan.from,...(e.reason==='missing-customer-profile'?{customerProfileVerified:true,notificationDisabled:true,city:e.city,rejectedFields:e.rejectedFields}:{})}),now());
  return {orderId,rearmed:true,plan};
 });
}
