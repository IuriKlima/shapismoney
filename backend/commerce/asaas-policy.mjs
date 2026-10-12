import {commerceError,exactFields} from './catalog.mjs';

// Historical display amounts only. Neither this list nor the mock catalog approves a sale.
export const ASAAS_PRICE_REVIEW=Object.freeze([
 Object.freeze({sku:'monthly',monthlyCents:49900,months:1,candidateTotalCents:49900,enabled:false}),
 Object.freeze({sku:'quarterly',monthlyCents:39900,months:3,candidateTotalCents:119700,enabled:false}),
 Object.freeze({sku:'semiannual',monthlyCents:29900,months:6,candidateTotalCents:179400,enabled:false})
]);

export function compileAsaasOffers(offers=[]){
 if(!Array.isArray(offers))throw commerceError(503,'Ofertas não confirmadas.');
 const approved=new Map(),installmentLimits={};
 for(const input of offers){
  exactFields(input,['sku','version','approved','amountCents','months','billingTypes','maxInstallments','renewal','access']);
  const candidate=ASAAS_PRICE_REVIEW.find(x=>x.sku===input.sku);
  if(!candidate||approved.has(input.sku)||input.approved!==true||typeof input.version!=='string'||!/^[-A-Za-z0-9_.]{1,80}$/.test(input.version)||!Number.isSafeInteger(input.amountCents)||input.amountCents<=0||input.amountCents>10000000||input.months!==candidate.months||input.renewal!=='blocked'||input.access!=='onboarding-only'||!Array.isArray(input.billingTypes)||!input.billingTypes.length||new Set(input.billingTypes).size!==input.billingTypes.length||input.billingTypes.some(x=>!['PIX','CREDIT_CARD'].includes(x))||!Number.isInteger(input.maxInstallments)||input.maxInstallments<1||input.maxInstallments>21||input.maxInstallments>1&&!input.billingTypes.includes('CREDIT_CARD'))throw commerceError(503,'Oferta, parcelamento ou renovação não confirmados.');
  approved.set(input.sku,structuredClone(input));if(input.maxInstallments>1)installmentLimits[input.sku]=input.maxInstallments;
 }
 return {installmentLimits,snapshot(sku,{billingType}={}){const offer=approved.get(sku);if(!offer||!offer.billingTypes.includes(billingType))throw commerceError(503,'Oferta ainda não habilitada.');return {sku,name:{monthly:'Mensal',quarterly:'Trimestral',semiannual:'Semestral'}[sku],amountCents:offer.amountCents,currency:'BRL',durationMonths:offer.months,policyVersion:offer.version,chargeKind:'total-sale',renewal:'blocked',access:'onboarding-only',split:false};}};
}
