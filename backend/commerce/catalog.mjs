// Commercial prices are server-owned totals, never an installment or a net receipt.
export const COMMERCE_CATALOG=Object.freeze([
 Object.freeze({id:'monthly',name:'Mensal',amountCents:49900,months:1,kind:'monthly-undecided'}),
 Object.freeze({id:'quarterly',name:'Trimestral',amountCents:119700,months:3,kind:'total-sale'}),
 Object.freeze({id:'semiannual',name:'Semestral',amountCents:179400,months:6,kind:'total-sale'}),
 Object.freeze({id:'annual',name:'Anual',kind:'interest'}),
 Object.freeze({id:'specific-project',name:'Projeto específico',kind:'interest'})
]);
export function commerceError(status,message){return Object.assign(Error(message),{status,safe:true});}
export function exactFields(body,fields){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k)))throw commerceError(400,'Campos de compra inválidos.');}
export function purchaseSnapshot(sku,{monthlyMode=null}={}){
 const item=COMMERCE_CATALOG.find(x=>x.id===sku);if(!item)throw commerceError(400,'Plano inválido.');
 if(item.kind==='interest')throw commerceError(409,'Este plano recebe interesse, sem cobrança.');
 if(item.id==='monthly'&&monthlyMode!=='detached')throw commerceError(503,'Modo de cobrança mensal pendente.');
 return {sku:item.id,name:item.name,amountCents:item.amountCents,currency:'BRL',durationMonths:item.months,sellerAbsorbsFees:true,chargeKind:'total-sale'};
}
export function cents(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>1e-7)throw commerceError(409,'Valor financeiro inválido.');return Math.round(value*100);}
export function checkoutBody(order,{publicOrigin,billingType,maxInstallmentCount=null,minutesToExpire=60}){
 const origin=new URL(publicOrigin);if(origin.origin!==publicOrigin||origin.protocol!=='https:'||origin.username||origin.password)throw commerceError(503,'Origem de retorno inválida.');
 if(!['PIX','CREDIT_CARD'].includes(billingType)||!Number.isInteger(minutesToExpire)||minutesToExpire<10||minutesToExpire>1440)throw commerceError(400,'Checkout inválido.');
 if(maxInstallmentCount!==null&&(billingType!=='CREDIT_CARD'||!Number.isInteger(maxInstallmentCount)||maxInstallmentCount<2||maxInstallmentCount>21))throw commerceError(400,'Parcelamento não permitido.');
 const snapshot=JSON.parse(order.snapshot);if(snapshot.currency!=='BRL'||snapshot.amountCents!==order.amount_cents||!order.customer_id)throw commerceError(409,'Pedido sem vínculo financeiro conferido.');
 const callback=Object.fromEntries(['success','cancel','expired'].map(name=>[name+'Url',publicOrigin+'/local#purchase-'+name]));
 return {billingTypes:[billingType],chargeTypes:maxInstallmentCount?['DETACHED','INSTALLMENT']:['DETACHED'],minutesToExpire,externalReference:order.external_reference,customer:order.customer_id,callback,items:[{name:'Shape IS Money — '+snapshot.name,description:snapshot.durationMonths+' meses de acompanhamento; liberação profissional separada.',quantity:1,value:order.amount_cents/100}],...(maxInstallmentCount?{installment:{maxInstallmentCount}}:{})};
}
