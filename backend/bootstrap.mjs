import {randomUUID} from 'node:crypto';
import {hashPassword} from './auth.mjs';
export class BootstrapFailure extends Error{}
const fail=message=>{throw new BootstrapFailure(message);};
const clean=(value,min,max)=>{if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail('Entrada inválida.');return value.trim();};
export async function provisionInitialAdmin({store,email,name,organizationName,password,confirmation,now=Date.now}){
  const address=clean(email,3,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))fail('E-mail inválido.');
  const person=clean(name,2,100),organization=clean(organizationName,2,100);
  if(confirmation!=='CRIAR ADMINISTRADOR INICIAL')fail('Confirmação explícita necessária.');
  if(typeof password!=='string'||password.length<14||password.length>128||/[\u0000-\u001f\u007f]/.test(password))fail('A senha deve ter 14–128 caracteres sem controles.');
  const hash=await hashPassword(password);
  try{return await store.transaction(async()=>{
    if(store.kind==='postgres')await store.query('SELECT pg_advisory_xact_lock(824017352)');
    if(await store.get("SELECT id FROM users WHERE role='admin' LIMIT 1"))fail('Já existe administrador. Bootstrap inicial recusado; recuperação exige procedimento separado.');
    if(await store.get('SELECT id FROM users LIMIT 1')||await store.get('SELECT id FROM organizations LIMIT 1'))fail('Instalação não está vazia. Provisionamento exige procedimento separado.');
    const org=randomUUID(),id=randomUUID();await store.run('INSERT INTO organizations(id,name) VALUES (?,?)',org,organization);
    await store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',id,org,address,person,'admin',hash);
    await store.run('INSERT INTO audit(id,org_id,actor_id,student_id,event,created_at) VALUES (?,?,?,?,?,?)',randomUUID(),org,id,null,'bootstrap.admin.created',now());
    return {id,organizationId:org,role:'admin'};
  });}catch(error){if(error instanceof BootstrapFailure)throw error;fail('Bootstrap falhou. Nenhuma alteração parcial foi confirmada.');}
}
