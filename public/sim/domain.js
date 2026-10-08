export const PLANS = Object.freeze([
  {id:'monthly',name:'Mensal',total:499,installments:1,amount:499,label:'R$ 499 / mês'},
  {id:'quarterly',name:'Trimestral',total:1197,installments:3,amount:399,label:'3x de R$ 399'},
  {id:'half-year',name:'Semestral',total:1794,installments:6,amount:299,label:'6x de R$ 299'},
]);
export const normalizeEmail = value => String(value ?? '').trim().toLowerCase();
export const isLocalDemo = host => ['localhost','127.0.0.1','[::1]','::1'].includes(host);
export function findDuplicate(clients,email){return clients.find(c=>normalizeEmail(c.email)===normalizeEmail(email));}
export function addDemoLead(state,input,id,at){
  const email=normalizeEmail(input.email);
  if(!input.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Informe nome e e-mail fictícios válidos.');
  if(!['annual','custom'].includes(input.interest))throw Error('Escolha anual ou projeto personalizado.');
  const existing=findDuplicate(state.clients,email);
  if(existing){existing.interest=input.interest;existing.request=String(input.message||'').trim();return {client:existing,created:false};}
  const client={id,name:input.name.trim(),email,interest:input.interest,request:String(input.message||'').trim(),stage:'purchase',owner:'Bruno',next:'Revisar interesse e combinar contato (demo)',due:'A definir',last:'Agora / demo',plan:'',consent:false,notes:[],timeline:[{at,title:'Interesse registrado localmente',text:'Nenhum contato ou envio externo foi realizado.'}]};
  state.clients.push(client);return {client,created:true};
}
