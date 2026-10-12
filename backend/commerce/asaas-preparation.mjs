import {asaasSandboxClient} from './asaas-client.mjs';
import {asaasSandboxCommerce} from './flow.mjs';
import {commerceError} from './catalog.mjs';

// No production bootstrap, HTTP route, environment or auto-running worker imports this file.
export function prepareAsaas(configuration={}){
 const disabled=Object.freeze({enabled:false,realCheckoutEnabled:false,productionEnabled:false,split:false,renewalEnabled:false});
 if(configuration.enabled!==true)return Object.freeze({capabilities:disabled});
 if(configuration.apiKey===configuration.webhookToken)throw commerceError(503,'Separe a chave da API do token do webhook.');
 const client=asaasSandboxClient(configuration);
 const core=asaasSandboxCommerce({...configuration,client});
 return Object.freeze({capabilities:Object.freeze({...disabled,enabled:true,environment:'sandbox'}),
  createOrder:core.createOrder,summary:core.summary,verifyIdentity:core.verifyIdentity,
  reconcile:core.reconcile,pauseOnboarding:core.pauseOnboarding,crm:core.crm,
  async createCheckout(credential,orderId){const order=await core.createCheckout(credential,orderId);if(order.checkout_state!=='ready'||order.status!=='pending')throw commerceError(409,'Checkout indisponível.');return {orderId:order.id,checkoutUrl:client.hostedCheckoutUrl(order.checkout_id),environment:'sandbox'};},
  acceptWebhook:core.acceptWebhook,
  async processBatch({limit=20}={}){if(!Number.isInteger(limit)||limit<1||limit>100)throw commerceError(400,'Lote inválido.');const exclude=new Set();let processed=0;while(processed<limit&&await core.processNext({exclude}))processed++;return {processed};}
 });
}

// Mount only on a reviewed sandbox endpoint. Auth is the dedicated webhook token,
// not browser Origin/cookie. No production origin-policy exception is introduced here.
export function asaasWebhookHandler(preparation){
 return async function webhook(req,res){
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(!preparation?.capabilities.enabled)return send(503,{received:false});
  if(req.method!=='POST')return send(405,{received:false});
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return send(415,{received:false});
  try{let size=0;const chunks=[];for await(const chunk of req){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>131072)throw commerceError(413,'Notificação excedeu limite.');chunks.push(bytes);}
   const result=await preparation.acceptWebhook({headers:req.headers,rawBody:Buffer.concat(chunks).toString('utf8')});send(result.status,{received:true});
  }catch(error){send([400,401,409,413].includes(error.status)?error.status:503,{received:false});}
 };
}
