export function notificationUI({api,esc,perform,getUser,getStudent}){
  let entries=[],emailAvailable=false;
  const labels={training:'Seu treino foi publicado.',nutrition:'Seu plano de alimentação foi publicado.'};
  const emailLabels={disabled:'Envio de aviso por e-mail desativado',pending:'Aviso por e-mail na fila',sending:'Despacho em andamento',accepted:'Aviso aceito pelo provedor; entrega na caixa não confirmada','recipient-unavailable':'Destinatário sem acesso disponível',cancelled:'Despacho cancelado após nova conferência','delivery-unknown':'Entrega incerta; sem reenvio automático'};
  async function load(){
    entries=[];emailAvailable=false;const u=getUser(),s=getStudent();
    if(u?.role!=='student'&&!(u?.role==='admin'&&s))return;
    const result=await api(u.role==='student'?'notifications':'students/'+s.id+'/notifications');
    entries=result.notifications;emailAvailable=result.emailAvailable;
  }
  function render(){
    const u=getUser();if(!['admin','student'].includes(u?.role)||!entries.length)return '';
    const admin=u.role==='admin';
    return '<section class="card" id="notification-section" aria-label="Atualizações do acompanhamento"><h3>Atualizações do acompanhamento</h3>'+(admin&&!emailAvailable?'<p>Os avisos ficam na conta do aluno. O envio por e-mail está desativado.</p>':'')+entries.map(v=>{
      const date=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(v.publishedAt);
      return '<article class="note"><p>'+esc(labels[v.kind]||'Há uma atualização disponível.')+'</p><p>'+esc(date)+' · '+(v.readAt===null?'Ainda não lido':'Lido pelo aluno')+'</p>'+(admin?'<p>'+esc(emailLabels[v.emailState]||'Estado do aviso indisponível')+'</p>':'<a class="btn light" data-panel-link="'+(v.kind==='training'?'training':'profile')+'" href="'+(v.kind==='training'?'#training-section':'#profile-section')+'">Ver plano</a>'+(v.readAt===null?'<button class="btn light" data-notice-read="'+esc(v.id)+'">Marcar como lido</button>':''))+'</article>';
    }).join('')+'</section>';
  }
  function click(e){
    const button=e.target.closest('[data-notice-read]');if(!button||getUser()?.role!=='student')return false;
    e.preventDefault();perform(async()=>{await api('notifications/'+button.dataset.noticeRead+'/read',{confirmed:true},'POST',crypto.randomUUID());});return true;
  }
  return {load,render,click,reset(){entries=[];emailAvailable=false;}};
}
