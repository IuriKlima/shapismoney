import {createHash,randomUUID} from 'node:crypto';

export const PROTOCOL_NOTICE_MARKER=createHash('sha256').update('sim-protocol-notice:v1').digest('hex');
const addressHash=value=>createHash('sha256').update(value).digest('hex');
const keyFor=v=>'protocol-notice-'+v.studentId+'-'+v.kind+'-'+v.planId;
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);

// A separate opt-in prevents an access-email release from silently enabling notices.
export function protocolMailConfiguration(env,accessEmail){
  if(env.SIM_PROTOCOL_EMAIL_ENABLED!=='true')return {};
  if(env.SIM_PROTOCOL_EMAIL_REVIEWED!=='true'||accessEmail?.enabled!==true||accessEmail.reviewed!==true)throw Error('Protocol email configuration unavailable.');
  return {...accessEmail};
}

export function protocolNotificationFlow({store,now,deny,exact,read,mutation,student,policy,audit,security,configuration={}}){
  let closed=false,draining=null;
  const abort=new AbortController();
  function available(){
    try{
      const url=new URL(configuration.publicOrigin),kind=configuration.transport?.kind;
      return configuration.enabled===true&&configuration.reviewed===true&&typeof configuration.transport?.send==='function'
        &&(['smtp','resend'].includes(kind)||!security.production&&kind==='mock')
        &&url.origin===configuration.publicOrigin&&!url.username&&!url.password
        &&(url.protocol==='https:'||!security.production&&kind==='mock'&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))
        &&(!security.production||url.origin===security.origin);
    }catch{return false;}
  }
  const decode=r=>JSON.parse(r.result);
  async function change(r,status,value){
    return (await store.run('UPDATE operations SET status=?,result=? WHERE actor_id=? AND operation_key=? AND status=? AND result=?',status,JSON.stringify(value),r.actor_id,r.operation_key,r.status,r.result)).changes===1;
  }
  async function records(studentId){
    return await store.all('SELECT * FROM operations WHERE request_hash=? AND operation_key LIKE ?',PROTOCOL_NOTICE_MARKER,'protocol-notice-'+studentId+'-%');
  }
  async function published(v){
    if(v.kind==='training')return await store.get("SELECT p.id,p.published_at FROM plans p JOIN students s ON s.id=p.student_id WHERE p.id=? AND p.student_id=? AND s.org_id=? AND p.status='published'",v.planId,v.studentId,v.orgId);
    if(v.kind==='nutrition')return await store.get("SELECT id,published_at FROM nutrition_plans WHERE id=? AND student_id=? AND org_id=? AND status='published'",v.planId,v.studentId,v.orgId);
    return null;
  }
  // Called inside the publication transaction under its student lock.
  async function queueLocked(actor,row,{kind,planId}){
    const key=keyFor({studentId:row.id,kind,planId});
    const existing=await store.get('SELECT * FROM operations WHERE request_hash=? AND operation_key=?',PROTOCOL_NOTICE_MARKER,key);
    if(existing)return {id:decode(existing).id,emailState:decode(existing).emailState};
    const plan=await published({kind,planId,studentId:row.id,orgId:actor.org_id});
    if(!plan)deny(409,'Aviso exige plano publicado da mesma organização.');
    const grant=await policy.state(row),recipient=row.user_id?await store.get("SELECT id,email,active,role,org_id FROM users WHERE id=?",row.user_id):null;
    const linked=recipient?.active===1&&recipient.role==='student'&&recipient.org_id===row.org_id&&recipient.email===row.email;
    const eligible=linked&&grant.active&&grant.features[kind]===true;
    const emailState=!available()?'disabled':eligible?'pending':'recipient-unavailable';
    const v={id:randomUUID(),orgId:row.org_id,studentId:row.id,kind,planId,publishedAt:plan.published_at,readAt:null,
      recipientUserId:linked?recipient.id:null,recipientEmailHash:linked?addressHash(recipient.email):null,grantSequence:grant.sequence,emailState};
    await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,key,PROTOCOL_NOTICE_MARKER,emailState==='pending'?202:200,JSON.stringify(v));
    await audit(actor,row.id,'protocol.notice.created:'+v.id);
    return {id:v.id,emailState};
  }
  async function eligibleRecipient(v){
    const row=await store.get('SELECT * FROM students WHERE id=? AND org_id=?',v.studentId,v.orgId);
    if(!row||row.user_id!==v.recipientUserId||addressHash(row.email)!==v.recipientEmailHash||!await published(v))return null;
    const user=await store.get("SELECT * FROM users WHERE id=? AND org_id=? AND role='student' AND active=1",v.recipientUserId,v.orgId);
    const grant=await policy.state(row);
    if(!user||user.email!==row.email||!grant.active||grant.features[v.kind]!==true||grant.sequence!==v.grantSequence)return null;
    return {row,user};
  }
  async function dispatch(r){
    let claimed,to;
    await store.transaction(async()=>{
      await store.lockActor(r.actor_id);
      const current=await store.get('SELECT * FROM operations WHERE actor_id=? AND operation_key=?',r.actor_id,r.operation_key);
      if(current?.status!==202)return;
      const v=decode(current);
      if(v.recipientUserId&&v.recipientUserId!==r.actor_id)await store.lockActor(v.recipientUserId);
      const recipient=await store.get('SELECT email FROM users WHERE id=?',v.recipientUserId);
      if(recipient)await store.lockEmail(recipient.email);
      await store.lockStudent(v.studentId);
      const target=available()?await eligibleRecipient(v):null;
      if(!target){await change(current,409,{...v,emailState:'cancelled',finishedAt:now()});return;}
      claimed={...v,emailState:'sending',leaseUntil:now()+30000};
      if(!await change(current,102,claimed)){claimed=null;return;}
      to=target.user.email;
    });
    if(!claimed)return;
    let emailState='delivery-unknown',timer;
    const timeout=new AbortController();
    try{
      if(!available()||closed)throw Error('Dispatch unavailable');
      const result=await Promise.race([
        configuration.transport.send({to,subject:'Atualização disponível no Shape IS Money',
          text:'Seu acompanhamento recebeu uma atualização. Entre na sua conta para consultar: '+configuration.publicOrigin+'/local\nEste aviso não contém planos, anexos ou informações de saúde.',
          idempotencyKey:'protocol-notice-'+claimed.id,signal:AbortSignal.any([abort.signal,timeout.signal])}),
        new Promise((_,reject)=>{timer=setTimeout(()=>{timeout.abort();reject(Error('Dispatch timeout'));},10000);})
      ]);
      if(result?.accepted===true)emailState='accepted';
    }catch{/* Provider details, addresses and message bodies never enter diagnostics. */}
    finally{clearTimeout(timer);}
    await store.transaction(async()=>{
      await store.lockActor(r.actor_id);await store.lockStudent(claimed.studentId);
      const current=await store.get('SELECT * FROM operations WHERE actor_id=? AND operation_key=?',r.actor_id,r.operation_key);
      if(current?.status!==102)return;
      const v=decode(current);
      await change(current,emailState==='accepted'?200:502,{...v,emailState,finishedAt:now()});
    });
  }
  async function flush(){
    if(closed)return;if(draining)return draining;
    draining=(async()=>{
      for(const r of await store.all('SELECT * FROM operations WHERE request_hash=? AND status=?',PROTOCOL_NOTICE_MARKER,102)){
        await store.transaction(async()=>{
          await store.lockActor(r.actor_id);
          const current=await store.get('SELECT * FROM operations WHERE actor_id=? AND operation_key=?',r.actor_id,r.operation_key);
          if(current?.status!==102)return;
          const v=decode(current);await store.lockStudent(v.studentId);
          if(v.leaseUntil<=now())await change(current,502,{...v,emailState:'delivery-unknown',finishedAt:now()});
        });
      }
      for(const r of await store.all('SELECT * FROM operations WHERE request_hash=? AND status=? ORDER BY operation_key LIMIT 20',PROTOCOL_NOTICE_MARKER,202)){
        if(closed)break;await dispatch(r);
      }
    })();
    try{await draining;}finally{draining=null;}
  }
  const timer=configuration.autoDispatch!==false&&available()?setInterval(()=>{flush().catch(()=>{});},2000):null;
  timer?.unref?.();
  async function ownRow(actor){
    if(actor.role!=='student')deny(403,'Avisos pertencem ao aluno.');
    const row=await store.get('SELECT id FROM students WHERE user_id=? AND org_id=?',actor.id,actor.org_id);
    if(!row)deny(404,'Aluno não encontrado.');return await student(actor,row.id);
  }
  const dto=v=>({id:v.id,kind:v.kind,planId:v.planId,publishedAt:v.publishedAt,readAt:v.readAt,emailState:v.emailState});
  async function visible(actor,row){
    const grant=await policy.state(row),items=[];
    for(const r of await records(row.id)){
      const v=decode(r);
      if(v.orgId!==actor.org_id||v.studentId!==row.id||!await published(v))continue;
      if(actor.role==='student'&&(!grant.active||grant.features[v.kind]!==true))continue;
      items.push(dto(v));
    }
    return items.sort((a,b)=>b.publishedAt-a.publishedAt||a.id.localeCompare(b.id)).slice(0,100);
  }
  async function handle(actor,req,route){
    if(route==='/api/local/notifications'&&req.method==='GET'){
      const row=await ownRow(actor),notifications=await visible(actor,row);
      return {status:200,data:{notifications,unread:notifications.filter(v=>v.readAt===null).length,emailAvailable:available()}};
    }
    const admin=/^\/api\/local\/students\/([a-f0-9-]{36})\/notifications$/.exec(route);
    if(admin&&req.method==='GET'){
      if(actor.role!=='admin')deny(403,'Histórico de avisos restrito à administração.');
      const row=await student(actor,admin[1]);return {status:200,data:{notifications:await visible(actor,row),emailAvailable:available(),acceptedMeans:'provider-acceptance-only'}};
    }
    const m=/^\/api\/local\/notifications\/([a-f0-9-]{36})\/read$/.exec(route);
    if(!m||req.method!=='POST')return null;
    const row=await ownRow(actor),body=await read(req);exact(body,['confirmed']);
    if(body.confirmed!==true||!uuid(m[1]))deny(400,'Confirme a leitura do aviso.');
    return await mutation(actor,req,body,async()=>{
      await store.lockStudent(row.id);const currentRow=await student(actor,row.id);
      const grant=await policy.state(currentRow);
      const record=(await records(row.id)).find(r=>decode(r).id===m[1]);
      const v=record&&decode(record);
      if(!v||v.orgId!==actor.org_id||!grant.active||grant.features[v.kind]!==true||!await published(v))deny(404,'Aviso não encontrado.');
      if(v.readAt===null){v.readAt=now();if(!await change(record,record.status,v))deny(409,'Aviso mudou. Recarregue.');await audit(actor,row.id,'protocol.notice.read:'+v.id);}
      return {status:200,data:{notification:dto(v)}};
    });
  }
  return {queueLocked,handle,flush,available,async close(){closed=true;if(timer)clearInterval(timer);abort.abort();if(draining)await draining;}};
}
