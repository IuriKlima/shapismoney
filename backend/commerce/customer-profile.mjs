import {commerceError,exactFields} from './catalog.mjs';

export const FINANCIAL_FIELDS=Object.freeze(['phone','address','addressNumber','postalCode','province']);
// Customer create/update endpoints resolve city from postalCode. Their schema does
// not accept city; GET returns the Asaas city ID (not an assumed IBGE code).
export function financialFields(body){
 const fail=()=>{throw commerceError(400,'Informe telefone com DDD, endereço, número, CEP e bairro de teste.');};
 const result={};
 for(const key of FINANCIAL_FIELDS){
  if(typeof body[key]!=='string'||/[\x00-\x1f\x7f]/.test(body[key]))fail();
  result[key]=body[key].trim();
 }
 if(!/^[\d ()+-]+$/.test(result.phone)||!/^\d{5}-?\d{3}$/.test(result.postalCode))fail();
 result.phone=result.phone.replace(/[ ()+-]/g,'');result.postalCode=result.postalCode.replace('-','');
 if(!/^[1-9]\d(?:[2-5]\d{7}|9\d{8})$/.test(result.phone))fail();
 for(const key of ['address','province'])if(result[key].length<2||result[key].length>100)fail();
 if(!result.addressNumber||result.addressNumber.length>20)fail();
 return result;
}
export function financialUpdate(body){exactFields(body,[...FINANCIAL_FIELDS,'notificationDisabled']);if(body.notificationDisabled!==true)throw commerceError(400,'Notificações devem permanecer desativadas no sandbox.');return {...financialFields(body),notificationDisabled:true};}
export function financialStatus(customer){
 const missing=FINANCIAL_FIELDS.filter(k=>typeof customer[k]!=='string'||!customer[k].trim());
 try{financialFields(customer);}catch{if(!missing.length)missing.push('format');}
 if(!Number.isSafeInteger(customer.city)||customer.city<=0||customer.city>2147483647)missing.push('city');
 if(customer.notificationDisabled!==true)missing.push('notificationDisabled');
 return {ready:missing.length===0,missing,city:Number.isSafeInteger(customer.city)?customer.city:null,cityName:typeof customer.cityName==='string'?customer.cityName:null};
}
