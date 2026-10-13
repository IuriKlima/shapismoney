// Uses existing authenticated student routes. Never simulates payment or creates credentials.
export function asaasCommerceUI({api,esc,perform,root,getUser}){
 const win=root.defaultView||root.ownerDocument?.defaultView;
 let meta=null,account={registered:false,orders:[]},attempt=null,checkout=null,notice='',customerUncertain=false;
 const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
 const labels={pending:'Aguardando pagamento de teste',paid:'Pagamento de teste conciliado',review:'Revisão financeira necessária',overdue:'Em atraso',canceled:'Cancelado',expired:'Expirado',refund_pending:'Estorno em análise',partially_refunded:'Estorno parcial em revisão',refunded:'Estornado',chargeback:'Chargeback em revisão'};
 const isStudent=()=>getUser()?.role==='student';
 async function load(){if(!isStudent()){account={registered:false,orders:[]};checkout=null;return;}account=await api('asaas/account');if(account.registered)customerUncertain=false;}
 function render(){
  if(!meta||!isStudent())return '';
  let html='<section class="card commerce-panel" id="commerce-section"><span class="premium-kicker">ASAAS SANDBOX · AMBIENTE DE TESTES</span><h2>Planos e compra de teste</h2><p>Use somente dados fictícios. Pagamento Pix ou cartão simulado no Asaas Sandbox, sem dinheiro real. Não há renovação automática. A anamnese depende da confirmação conciliada no servidor; treino e nutrição dependem de revisão e publicação profissional.</p>';
  if(notice)html+='<p role="status">'+esc(notice)+'</p>';
  if(win?.location.hash?.startsWith('#purchase-'))html+='<p>Retorno do checkout recebido. Voltar a esta página não confirma pagamento. Atualize o status abaixo.</p>';
  if(!account.registered)html+='<form class="commerce-asaas-customer"><label>CPF ou CNPJ fictício de teste<input name="cpfCnpj" inputmode="numeric" pattern="[0-9]{11}|[0-9]{14}" minlength="11" maxlength="14" required autocomplete="off"></label><label class="checkbox"><input name="confirmed" type="checkbox" required>Confirmo o uso exclusivo de dados fictícios neste ambiente de testes.</label><p>O cadastro usa o nome e o e-mail da sua conta de aluno neste sandbox.</p>'+(customerUncertain?'<p>Cadastro inconclusivo. Consulte a tentativa existente usando os mesmos dados, sem criar outro cliente.</p>':'')+'<button class="btn gold" name="action" value="'+(customerUncertain?'recover':'create')+'">'+(customerUncertain?'Consultar cadastro existente':'Cadastrar cliente de teste')+'</button><button class="btn light" name="action" value="recover">Recuperar cadastro interrompido</button></form>';
  const blocked=!account.registered||account.orders.some(o=>['pending','overdue','review','refund_pending','partially_refunded','chargeback'].includes(o.status)||(o.status==='paid'&&!o.protocolPublished));
  html+='<div class="commerce-plans">'+meta.catalog.map(p=>'<article class="note"><h3>'+esc(p.name)+'</h3><p>'+esc(money(p.amountCents))+' · total por '+esc(p.durationMonths)+' mês(es)</p><p>Renovação manual. A vigência começa na publicação do protocolo.</p><form class="commerce-asaas-buy"><input type="hidden" name="sku" value="'+esc(p.sku)+'"><label>Pagamento de teste<select name="billingType">'+p.billingTypes.map(t=>'<option value="'+esc(t)+'">'+(t==='PIX'?'Pix simulado':'Cartão de teste')+'</option>').join('')+'</select></label><label class="checkbox"><input name="confirmed" type="checkbox" required>Confirmo este pedido no ambiente de testes.</label><button class="btn gold" '+(blocked?'disabled':'')+'>Criar pedido de teste</button></form></article>').join('')+'</div>';
  if(attempt)html+='<p>Resposta do pedido interrompida. Ao repetir a mesma escolha, reutilizaremos a tentativa. Atualize primeiro para verificar se o pedido já existe.</p>';
  for(const o of account.orders)html+='<article class="note commerce-order"><h3>'+esc(o.plan.name)+' · '+esc(money(o.plan.amountCents))+'</h3><p>'+esc(labels[o.status]||o.status)+'</p><p>Anamnese: '+(o.onboardingAuthorized?'autorizada pelo servidor':'aguardando confirmação')+'</p>'+(['new','ready'].includes(o.checkoutState)&&o.status==='pending'?'<button class="btn gold" data-commerce-asaas-checkout="'+esc(o.orderId)+'">'+(o.checkoutState==='ready'?'Recuperar link do checkout':'Preparar checkout no Asaas Sandbox')+'</button>':'')+(['unknown','creating'].includes(o.checkoutState)?'<p>Checkout inconclusivo. Não repita a criação; solicite revisão da tentativa existente.</p>':'')+'</article>';
  if(checkout)html+='<p><a class="btn gold" href="'+esc(checkout)+'" target="_blank" rel="noopener noreferrer">Abrir checkout de teste no Asaas Sandbox</a></p>';
  return html+'<button class="btn light" data-commerce-asaas-refresh>Atualizar status no servidor</button></section>';
 }
 function submit(e){const f=e.target;if(!f.classList?.contains('commerce-asaas-buy')&&!f.classList?.contains('commerce-asaas-customer'))return false;e.preventDefault();const d=Object.fromEntries(new win.FormData(f)),action=e.submitter?.value;
  return perform(async()=>{
   if(!isStudent())throw Error('Entre com sua conta de aluno de teste.');
   if(d.confirmed!=='on')throw Error('Confirme o uso do ambiente de testes.');
   if(f.classList.contains('commerce-asaas-customer')){
    const recover=customerUncertain||action==='recover';
    try{await api('asaas/customer'+(recover?'/recover':''),{cpfCnpj:d.cpfCnpj,...(recover?{}:{confirmed:true})});}catch(error){customerUncertain=true;throw error;}
   }else{
    const body={sku:d.sku,billingType:d.billingType,confirmed:true};
    if(attempt&&JSON.stringify(attempt.body)!==JSON.stringify(body))throw Error('Recupere a tentativa anterior antes de escolher outro plano.');
    attempt??={body,key:win.crypto.randomUUID()};
    await api('asaas/orders',attempt.body,'POST',attempt.key);attempt=null;
   }
   await load();
  });
 }
 function click(e){const b=e.target.closest('button');if(!b||(!b.hasAttribute('data-commerce-asaas-checkout')&&!b.hasAttribute('data-commerce-asaas-refresh')))return false;
  return perform(async()=>{
   if(!isStudent())throw Error('Entre com sua conta de aluno de teste.');
   checkout=null;
   if(b.dataset.commerceAsaasCheckout){
    const result=await api('asaas/orders/'+b.dataset.commerceAsaasCheckout+'/checkout',{});
    let url;try{url=new URL(result.checkoutUrl);}catch{throw Error('Link de checkout inválido.');}
    if(url.origin!=='https://sandbox.asaas.com'||url.pathname!=='/checkoutSession/show'||url.username||url.password||!url.searchParams.get('id'))throw Error('Checkout fora do Asaas Sandbox bloqueado.');
    checkout=url.href;
   }
   await load();notice='Status consultado no servidor. Somente a conciliação confirma o pagamento.';
  });
 }
 return {configure(value){meta=value;},load,render,submit,click,reset(){account={registered:false,orders:[]};attempt=null;checkout=null;notice='';customerUncertain=false;}};
}
