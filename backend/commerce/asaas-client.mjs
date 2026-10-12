import {commerceError,exactFields} from './catalog.mjs';

// Backend-only. No environment/file reads, constructor requests, arbitrary hosts or retries.
const clients=new WeakSet();
const API='https://api-sandbox.asaas.com/v3';
const resourceId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const unavailable=()=>commerceError(503,'Resposta Asaas inconclusiva; consulte a conciliação antes de repetir.');
export const isAsaasSandboxClient=client=>clients.has(client);

async function boundedJSON(response,signal){
 if(!response.ok||response.redirected)throw unavailable();
 const reader=response.body?.getReader();if(!reader)throw unavailable();
 const chunks=[];let size=0;
 try{for(;;){if(signal.aborted)throw unavailable();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024)throw unavailable();chunks.push(Buffer.from(value));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }finally{await reader.cancel().catch(()=>{});}
}

function assertCheckout(body){
 exactFields(body,['billingTypes','chargeTypes','minutesToExpire','externalReference','customer','callback','items','installment']);
 if(!resourceId(body.customer)||!resourceId(body.externalReference)||!Array.isArray(body.billingTypes)||body.billingTypes.length!==1||!['PIX','CREDIT_CARD'].includes(body.billingTypes[0]))throw commerceError(400,'Checkout inválido.');
 if(!Array.isArray(body.chargeTypes)||JSON.stringify(body.chargeTypes)!==JSON.stringify(body.installment?['DETACHED','INSTALLMENT']:['DETACHED']))throw commerceError(400,'Renovação automática não habilitada.');
 if(body.installment){exactFields(body.installment,['maxInstallmentCount']);if(body.billingTypes[0]!=='CREDIT_CARD'||!Number.isInteger(body.installment.maxInstallmentCount)||body.installment.maxInstallmentCount<2||body.installment.maxInstallmentCount>21)throw commerceError(400,'Parcelamento inválido.');}
 if(!Number.isInteger(body.minutesToExpire)||body.minutesToExpire<10||body.minutesToExpire>1440||!Array.isArray(body.items)||body.items.length!==1)throw commerceError(400,'Checkout inválido.');
 exactFields(body.items[0],['name','description','quantity','value']);
 const item=body.items[0];if(item.quantity!==1||typeof item.name!=='string'||item.name.length>200||typeof item.description!=='string'||item.description.length>500||!Number.isFinite(item.value)||item.value<=0||item.value>100000)throw commerceError(400,'Item inválido.');
 exactFields(body.callback,['successUrl','cancelUrl','expiredUrl']);
 const origins=new Set();for(const key of ['successUrl','cancelUrl','expiredUrl']){let url;try{url=new URL(body.callback[key]);}catch{throw commerceError(400,'Retorno inválido.');}if(url.protocol!=='https:'||url.username||url.password)throw commerceError(400,'Retorno inválido.');origins.add(url.origin);}
 if(origins.size!==1)throw commerceError(400,'Retorno inválido.');
}

// Keep only reconciliation evidence. Never return card data/tokens or provider diagnostics.
function payment(row){
 if(!resourceId(row?.id))throw unavailable();
 return Object.fromEntries(Object.entries({id:row.id,customer:row.customer,externalReference:row.externalReference,value:row.value,billingType:row.billingType,status:row.status,deleted:row.deleted,installment:row.installment,installmentNumber:row.installmentNumber,subscription:row.subscription,refunds:row.refunds?.length?[{}]:[],chargeback:!!row.chargeback}).filter(([,v])=>v!==undefined));
}

export function asaasSandboxClient({enabled=false,environment='sandbox',accountId,apiKey,networkAccessApproved=false,fetchImpl=globalThis.fetch,timeoutMs=8000}={}){
 if(!enabled)return null;
 if(environment!=='sandbox'||process.env.NODE_ENV==='production'||networkAccessApproved!==true)throw commerceError(503,'Acesso Asaas não autorizado; produção permanece bloqueada.');
 if(!resourceId(accountId)||typeof apiKey!=='string'||apiKey.length<32||apiKey.length>512||/[\r\n]/.test(apiKey)||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw commerceError(503,'Configuração Asaas incompleta.');
 async function request(method,path,body){
  const abort=new AbortController();let timer;
  try{return await Promise.race([(async()=>{const response=await fetchImpl(API+path,{method,redirect:'error',signal:abort.signal,headers:{access_token:apiKey,'Content-Type':'application/json','User-Agent':'ShapeIsMoney/AsaasPreparation'},...(body?{body:JSON.stringify(body)}:{})});return boundedJSON(response,abort.signal);})(),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(unavailable());},timeoutMs);})]);}
  catch{throw unavailable();}finally{clearTimeout(timer);abort.abort();}
 }
 async function payments(filter){const all=[];let offset=0;const seen=new Set();
  for(let page=0;page<20;page++){const data=await request('GET','/payments?'+new URLSearchParams({...filter,offset:String(offset),limit:'100'}));
   if(!Array.isArray(data?.data)||data.data.length>100||typeof data.hasMore!=='boolean'||data.hasMore&&!data.data.length)throw unavailable();
   for(const raw of data.data){const row=payment(raw);if(seen.has(row.id))throw unavailable();seen.add(row.id);all.push(row);}
   if(!data.hasMore)return all;offset+=data.data.length;
  }throw unavailable();
 }
 const client=Object.freeze({kind:'asaas',scope:Object.freeze({environment:'sandbox',accountId}),
  async createCustomer(body){
   exactFields(body,['name','email','cpfCnpj','externalReference','notificationDisabled']);
   if(typeof body.name!=='string'||body.name.length<2||body.name.length>100||typeof body.email!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)||! /^(?:\d{11}|\d{14})$/.test(body.cpfCnpj)||!resourceId(body.externalReference)||body.notificationDisabled!==true)throw commerceError(400,'Cadastro financeiro invalido.');
   const data=await request('POST','/customers',body);if(!resourceId(data?.id))throw unavailable();return {id:data.id};
  },
  async customersByReference(reference){if(!resourceId(reference))throw commerceError(400,'Referencia invalida.');const data=await request('GET','/customers?'+new URLSearchParams({externalReference:reference,limit:'100',offset:'0'}));if(!Array.isArray(data?.data)||data.hasMore!==false||data.data.length>1)throw unavailable();return data.data.map(r=>{if(!resourceId(r.id)||r.externalReference!==reference||r.deleted)throw unavailable();return {id:r.id,email:r.email,cpfCnpj:r.cpfCnpj,externalReference:r.externalReference};});},
  async createCheckout(body){assertCheckout(body);const data=await request('POST','/checkouts',body);if(!resourceId(data?.id))throw unavailable();return {id:data.id};},
  paymentsByCheckout(id){if(!resourceId(id))throw commerceError(400,'Checkout inválido.');return payments({checkoutSession:id});},
  paymentsByInstallment(id){if(!resourceId(id))throw commerceError(400,'Parcelamento inválido.');return payments({installment:id});},
  hostedCheckoutUrl(id){if(!resourceId(id))throw commerceError(400,'Checkout inválido.');return 'https://sandbox.asaas.com/checkoutSession/show?id='+encodeURIComponent(id);}
 });clients.add(client);return client;
}
