import {Buffer} from 'node:buffer';
export const SCENARIOS=Object.freeze({
  method:'Explique em até 120 palavras o ciclo fictício evidência, prioridades, decisão, prescrição, execução e reavaliação. Não invente fontes.',
  review:'Num exemplo inteiramente fictício, quais informações um profissional deve revisar antes de aprovar uma proposta de treino? Não prescreva exercícios ou doses.',
  routine:'Num exemplo inteiramente fictício, sugira três perguntas sobre organização da rotina para revisão profissional. Não use dados de pessoas.'
});
export function createDevAIHandler({apiKey='',model='gpt-5.4-nano',fetchImpl=globalThis.fetch,timeoutMs=20000,maxRequests=5,guard,cors=true}={}){
  let active=false;const requests=[];
  return async function handle(req,res){
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    const fail=(status,message)=>send(status,{error:message});
    if(guard){try{guard(req);}catch{return fail(403,'Origem ou proxy inválido.');}}else{
    let host;try{host=new URL('http://'+req.headers.host);}catch{return fail(403,'Acesso local inválido.');}
    const own='http://'+host.host;
    if(!['127.0.0.1','localhost'].includes(host.hostname)||!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress))return fail(403,'Somente acesso local.');
    const origin=req.headers.origin;
    if(![own,'http://127.0.0.1:5173','http://localhost:5173'].includes(origin))return fail(403,'Origem local inválida.');
    if(cors){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');return send(204,{});}
    }
    if(req.method!=='POST')return fail(405,'Use POST.');
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return fail(415,'Envie JSON.');
    let body;try{
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>2048)return fail(413,'Entrada excede 2 KB.');chunks.push(chunk);}
      body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch{return fail(400,'Entrada JSON inválida.');}
    if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='scenario,syntheticConsent'||body.syntheticConsent!==true||!Object.hasOwn(SCENARIOS,body.scenario))return fail(400,'Selecione um exemplo fictício e confirme o envio.');
    if(!apiKey)return fail(503,'OPENAI_API_KEY não configurada no servidor local.');
    if(!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(model))return fail(503,'Modelo inválido na configuração do servidor.');
    const now=Date.now();while(requests.length&&requests[0]<now-60000)requests.shift();
    if(active||requests.length>=maxRequests)return fail(429,'Aguarde antes de enviar outra pergunta.');
    active=true;requests.push(now);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
    try{
      const upstream=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,max_output_tokens:256,reasoning:{effort:'none'},instructions:'Responda em português. Apenas exemplos sintéticos de desenvolvimento. Sem diagnóstico ou prescrição individual. Nenhuma ferramenta, escrita ou ação no CRM. Propostas exigem aprovação profissional. Use somente o resumo de método fornecido, sem atribuir fontes inexistentes.',input:SCENARIOS[body.scenario]})});
      if(!upstream.ok){await upstream.body?.cancel();return fail(upstream.status===429?429:502,upstream.status===429?'Provedor limitou a solicitação ou a cota.':upstream.status===401||upstream.status===403?'Provedor recusou a credencial ou permissão.':'Provedor indisponível. Tente novamente depois.');}
      let size=0;const chunks=[];
      for await(const chunk of upstream.body){size+=chunk.length;if(size>32768){controller.abort();return fail(502,'Resposta do provedor excedeu o limite.');}chunks.push(chunk);}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const reply=(data.output||[]).filter(x=>x.type==='message'&&x.role==='assistant').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');
      if(data.status!=='completed'||typeof reply!=='string'||!reply.trim()||reply.length>4000||reply.includes(apiKey))return fail(502,'Resposta do provedor inválida ou incompleta.');
      send(200,{reply,model,mode:'synthetic-development',writesPerformed:false});
    }catch{return fail(controller.signal.aborted?504:502,controller.signal.aborted?'Tempo de resposta esgotado.':'Não foi possível conectar ao provedor.');}
    finally{clearTimeout(timer);res.off('close',disconnect);active=false;}
  };
}
