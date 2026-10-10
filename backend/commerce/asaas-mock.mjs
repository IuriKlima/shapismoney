import {commerceError} from './catalog.mjs';
// No fetch, API key, environment-secret reads or real URLs. Only an injected mock.
// Paths/body names mirror the official v3 contract; runtime integration is absent.
export function asaasMockClient({accountId,transport,timeoutMs=2000}){
 if(typeof accountId!=='string'||!accountId.startsWith('fixture-')||transport?.kind!=='mock'||typeof transport.request!=='function')throw commerceError(503,'Somente cliente financeiro fictício permitido.');
 const scope=Object.freeze({environment:'mock',accountId});
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw commerceError(503,'Limite financeiro inválido.');
 async function request(input){const abort=new AbortController();let timer;try{return await Promise.race([transport.request({...input,scope,signal:abort.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(commerceError(503,'Resposta financeira inconclusiva.'));},timeoutMs);})]);}finally{clearTimeout(timer);}}
 async function payments(filter){const data=[];let offset=0;for(let page=0;page<20;page++){
  const query=new URLSearchParams({...filter,offset:String(offset),limit:'100'});const result=await request({method:'GET',path:'/v3/payments?'+query.toString()});
  if(!result||!Array.isArray(result.data)||typeof result.hasMore!=='boolean'||result.data.length>100)throw commerceError(503,'Lista de cobranças incompleta.');
  data.push(...result.data);if(!result.hasMore)return data;if(!result.data.length)throw commerceError(503,'Paginação financeira inválida.');offset+=result.data.length;
 }throw commerceError(503,'Conciliação excedeu o limite local.');}
 return Object.freeze({kind:'mock',scope,async createCheckout(body){const r=await request({method:'POST',path:'/v3/checkouts',body});if(!r||typeof r.id!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(r.id))throw commerceError(503,'Resposta de checkout inconclusiva.');return {id:r.id};},
 paymentsByCheckout:id=>payments({checkoutSession:id}),paymentsByInstallment:id=>payments({installment:id})});
}
