import {commerceError} from './catalog.mjs';
// Explicit configuration contract for the separate sandbox entrypoint. Not imported by normal bootstrap.
// Caller supplies environment values; this module never reads process.env or secret files.
export function sandboxConfiguration(values={}){
 if(values.SIM_ASAAS_SANDBOX_ENABLED!=='true')return {enabled:false};
 const fail=()=>{throw commerceError(503,'Configuração sandbox incompleta ou não autorizada.');};
 if(values.SIM_ASAAS_ENVIRONMENT!=='sandbox'||values.SIM_ASAAS_NETWORK_APPROVED!=='true')fail();
 const apiKey=values.ASAAS_SANDBOX_API_KEY,webhookToken=values.ASAAS_WEBHOOK_AUTH_TOKEN,accountId=values.ASAAS_SANDBOX_ACCOUNT_ID;
 if(typeof apiKey!=='string'||typeof webhookToken!=='string'||apiKey.length<32||webhookToken.length<32||apiKey.length>512||webhookToken.length>255||apiKey===webhookToken||/[\r\n]/.test(apiKey+webhookToken)||!/^[-A-Za-z0-9_]{1,200}$/.test(accountId||''))fail();
 let origin;try{origin=new URL(values.ASAAS_SANDBOX_PUBLIC_ORIGIN);}catch{fail();}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.origin!==values.ASAAS_SANDBOX_PUBLIC_ORIGIN||['shapeismoney.com.br','www.shapeismoney.com.br'].includes(origin.hostname))fail();
 return {enabled:true,environment:'sandbox',networkAccessApproved:true,accountId,apiKey,webhookToken,publicOrigin:origin.origin,periodPolicy:'first-authorized-protocol-release',automaticRenewal:false,split:false};
}
