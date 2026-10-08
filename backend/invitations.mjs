import {randomUUID} from 'node:crypto';
import {hashPassword,newToken,tokenHash} from './auth.mjs';
// Codes are entered in a POST body, never a URL. Delivery is exclusively manual.
export function invitationFlow({store,now,audit,deny,exact,email,text,read,mutation,student}){
  async function throttle(bucket,limit){await store.transaction(async()=>{const a=await store.get('INSERT INTO login_attempts(bucket,count,reset_at) VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN login_attempts.reset_at<=? THEN 1 ELSE login_attempts.count+1 END,reset_at=CASE WHEN login_attempts.reset_at<=? THEN ? ELSE login_attempts.reset_at END RETURNING count',bucket,1,now()+900000,now(),now(),now()+900000);if(a.count>limit)deny(429,'Aguarde antes de tentar novamente.');});}
  async function activate(req,connection){
    await throttle('activate-ip:'+connection.clientIP,8);
    const body=await read(req);exact(body,['token','email','password']);const address=email(body.email);
    if(typeof body.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.token)||typeof body.password!=='string'||body.password.length<14||body.password.length>128)deny(400,'Código e senha de 14–128 caracteres obrigatórios.');
    const digest=tokenHash(body.token),password=await hashPassword(body.password);
    await store.transaction(async()=>{
      const invite=await store.get('UPDATE invitations SET consumed_at=? WHERE token_hash=? AND email=? AND consumed_at IS NULL AND expires_at>? RETURNING *',now(),digest,address,now());
      if(!invite)deny(400,'Convite inválido, expirado ou já utilizado.');
      const issuer=await store.get("SELECT id FROM users WHERE id=? AND org_id=? AND role='admin' AND active=1",invite.created_by,invite.org_id);if(!issuer)deny(400,'Convite indisponível.');
      if(await store.get('SELECT id FROM users WHERE email=?',address))deny(409,'Destinatário já possui acesso.');
      const id=randomUUID();await store.run('INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES (?,?,?,?,?,?)',id,invite.org_id,address,invite.name,invite.role,password);
      if(invite.role==='student'){const updated=await store.run('UPDATE students SET user_id=?,revision=revision+1 WHERE id=? AND org_id=? AND email=? AND user_id IS NULL',id,invite.student_id,invite.org_id,address);if(updated.changes!==1)deny(409,'Vínculo de aluno indisponível.');}
      await audit({id,org_id:invite.org_id},invite.student_id,'invitation.activated');
    });
    return {status:201,data:{activated:true,message:'Acesso ativado. Entre com a senha que você definiu.'}};
  }
  async function create(actor,req){
    if(actor.role!=='admin')deny(403,'Convites exigem administrador da organização.');
    await throttle('invite-admin:'+actor.id,10);
    const body=await read(req);exact(body,['kind','studentId','email','name','professionalRole','verifiedDelivery']);
    if(body.verifiedDelivery!==true)deny(400,'Confirme a identificação do destinatário e a entrega privada.');
    let row=null,role,address,name;
    if(body.kind==='student'){if(body.professionalRole!==null)deny(400,'Convite de aluno não concede papel profissional.');row=await student(actor,body.studentId);if(row.user_id)deny(409,'Aluno já possui acesso.');address=row.email;name=row.name;role='student';if(email(body.email)!==address||text(body.name,2,100)!==name)deny(400,'Destinatário deve corresponder ao cadastro.');}
    else if(body.kind==='professional'){if(body.studentId!==null||!['coach','nutrition'].includes(body.professionalRole))deny(400,'Selecione personal ou nutrição.');role=body.professionalRole;address=email(body.email);name=text(body.name,2,100);}
    else deny(400,'Tipo de convite inválido.');
    let token=null;
    const result=await mutation(actor,req,body,async()=>{
      // Serialize issuance across administrators of the same organization.
      await store.run('UPDATE organizations SET name=name WHERE id=?',actor.org_id);
      if(await store.get('SELECT id FROM users WHERE email=?',address))deny(409,'Destinatário já possui acesso.');
      if(row){const current=await student(actor,row.id);if(current.user_id||current.email!==address)deny(409,'Cadastro mudou. Recarregue.');}
      await store.run('UPDATE invitations SET consumed_at=? WHERE org_id=? AND email=? AND consumed_at IS NULL',now(),actor.org_id,address);
      token=newToken();const id=randomUUID(),expiresAt=now()+1800000;
      await store.run('INSERT INTO invitations(id,org_id,created_by,email,name,role,student_id,token_hash,expires_at) VALUES (?,?,?,?,?,?,?,?,?)',id,actor.org_id,actor.id,address,name,role,row?.id||null,tokenHash(token),expiresAt);
      await audit(actor,row?.id||null,'invitation.created.'+role);
      return {status:201,data:{invitation:{id,email:address,role,expiresAt},delivery:'manual',emailSent:false}};
    });
    // The idempotency cache contains metadata only. A replay never reveals the code.
    return {...result,data:{...result.data,token}};
  }
  return {activate,create};
}
