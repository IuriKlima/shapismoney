import {createHash,randomUUID} from 'node:crypto';
import {INTAKE_VERSION} from '../public/sim/intake-fields.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const DRAFT_JOB_MARKER=hash('sim-draft-job:v1');
const decode=record=>JSON.parse(record.result);
const terminal=new Set(['draft-ready','superseded','failed','interrupted']);

// No credential or file resolution. Production remains explicitly closed.
export function draftJobConfiguration(env,security){
  if(env.SIM_DRAFT_JOBS_ENABLED!=='true')return {};
  if(security.production||env.SIM_DRAFT_JOBS_REVIEWED!=='true')throw Error('Draft worker gate closed');
  const expiresAt=Number(env.SIM_DRAFT_JOBS_EXPIRES_AT),maxAttemptUSD=Number(env.SIM_DRAFT_JOBS_MAX_ATTEMPT_USD),totalUSD=Number(env.SIM_DRAFT_JOBS_TOTAL_USD);
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt-Date.now()>86400000||!Number.isFinite(maxAttemptUSD)||maxAttemptUSD<=0||maxAttemptUSD>.05||!Number.isFinite(totalUSD)||totalUSD<=0||totalUSD>.10)throw Error('Reviewed worker limits required');
  const maxCalls=Number(env.SIM_DRAFT_JOBS_MAX_CALLS||2);if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>2)throw Error('Pilot maximum is two attempts');
  return {enabled:true,reviewed:true,expiresAt,maxAttemptUSD,totalUSD,maxCalls,networkReviewed:env.SIM_DRAFT_JOBS_NETWORK_REVIEWED==='true'};
}

export function draftJobFlow({store,now,deny,exact,text,read,mutation,student,audit,policy,security,engines,configuration={}}){
  let closed=false,draining=null;
  const controllers=new Set();
  const workerStamp=()=>hash({enabled:configuration.enabled,reviewed:configuration.reviewed,expiresAt:configuration.expiresAt,maxAttemptUSD:configuration.maxAttemptUSD,totalUSD:configuration.totalUSD,maxCalls:configuration.maxCalls,networkReviewed:configuration.networkReviewed});
  const windowId=hash({expiresAt:configuration.expiresAt,reviewed:configuration.reviewed});
  function available(){return !closed&&!security.production&&configuration.enabled===true&&configuration.reviewed===true&&Number.isSafeInteger(configuration.expiresAt)&&configuration.expiresAt>now()&&configuration.expiresAt-now()<=86400000&&configuration.maxAttemptUSD>0&&configuration.maxAttemptUSD<=.05&&configuration.totalUSD>0&&configuration.totalUSD<=.10&&Number.isInteger(configuration.maxCalls??2)&&(configuration.maxCalls??2)>=1&&(configuration.maxCalls??2)<=8;}
  const records=()=>store.all('SELECT * FROM operations WHERE request_hash=? ORDER BY operation_key',DRAFT_JOB_MARKER);
  async function change(record,value,status=200){
    return (await store.run('UPDATE operations SET status=?,result=? WHERE actor_id=? AND operation_key=? AND result=?',status,JSON.stringify(value),record.actor_id,record.operation_key,record.result)).changes===1;
  }
  async function version(row,kind){
    const intake=await store.get('SELECT version,revision,status,training_consent,reviewed_revision,reviewed_by FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id),access=await policy.state(row);
    const references=(await store.all("SELECT actor_id,request_hash,result FROM operations WHERE operation_key LIKE 'training-record-%' OR operation_key LIKE 'nutrition-record-%' ORDER BY operation_key")).filter(r=>{const v=decode(r);return v.studentId===row.id&&(!v.orgId||v.orgId===row.org_id)&&(kind==='training'?r.request_hash.length===64:r.request_hash.startsWith('nutrition-'));});
    const assignedId=kind==='training'?row.coach_id:row.nutrition_id;
    const actor=assignedId?await store.get('SELECT id,org_id,role,active FROM users WHERE id=?',assignedId):null;
    const credential=kind==='nutrition'?await store.get('SELECT revision,verified FROM nutrition_credentials WHERE user_id=?',assignedId):null;
    const catalog=kind==='nutrition'?await store.all('SELECT id,revision,status FROM nutrition_foods WHERE org_id=? ORDER BY id',row.org_id):null;
    return {intake,access,actor,fingerprint:hash({student:row.id,org:row.org_id,revision:row.revision,user:row.user_id,assignment:assignedId,actor,intake,access,references,credential,catalog,engine:engines[kind].version(),worker:workerStamp()})};
  }
  async function enqueueLocked(eventActor,row){
    const all=(await records()).filter(r=>{const v=decode(r);return v.studentId===row.id&&v.orgId===row.org_id;});
    const access=await policy.state(row);
    const intake=await store.get('SELECT status,version,revision FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id);
    for(const kind of ['training','nutrition']){
      const v=await version(row,kind),eligible=access.active&&access.features[kind]===true&&intake?.status==='complete'&&intake.version===INTAKE_VERSION;
      for(const old of all){const value=decode(old);if(value.kind===kind&&!terminal.has(value.state)&&(value.version!==v.fingerprint||!eligible))await change(old,{...value,state:value.state==='running'?'running':'superseded',cancelRequested:true,updatedAt:now()});}
      if(!eligible||all.some(r=>{const value=decode(r);return value.kind===kind&&value.version===v.fingerprint;}))continue;
      const id=randomUUID(),key='draft-job-'+hash({student:row.id,kind,version:v.fingerprint});
      const value={id,orgId:row.org_id,studentId:row.id,kind,version:v.fingerprint,anamnesisRevision:intake.revision,state:v.actor?.active===1&&await engines[kind].ready(v.actor,row.id)?'queued':'blocked',blockedCode:409,attempt:0,createdAt:now(),updatedAt:now(),reviewRequired:true};
      await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',eventActor.id,key,DRAFT_JOB_MARKER,202,JSON.stringify(value));
      await audit(eventActor,row.id,'draft-job.enqueued:'+id);
    }
  }
  async function observeLocked(actor,req,body){
    const route=new URL(req.url,'http://localhost').pathname;
    if(route.includes('/draft-jobs'))return;
    const m=/^\/api\/local\/students\/([a-f0-9-]{36})(?:\/|$)/.exec(route);
    const id=m?.[1]||body?.studentId;
    if(!id)return;
    const row=await store.get('SELECT * FROM students WHERE id=? AND org_id=?',id,actor.org_id);
    if(row){await store.lockStudent(row.id);await enqueueLocked(actor,row);}
  }
  async function authorized(row,kind){
    await policy.assertActive(row,kind);
    const actor=await store.get('SELECT * FROM users WHERE id=? AND org_id=? AND active=1 AND role=?',kind==='training'?row.coach_id:row.nutrition_id,row.org_id,kind==='training'?'coach':'nutrition');
    if(!actor)deny(403,'Profissional vinculado indisponível.');return actor;
  }
  async function candidate(record){
    const value=decode(record),row=await store.get('SELECT * FROM students WHERE id=? AND org_id=?',value.studentId,value.orgId);
    if(!row)deny(409,'Vínculo indisponível.');
    const actor=await authorized(row,value.kind),v=await version(row,value.kind);
    if(v.fingerprint!==value.version||value.cancelRequested)deny(409,'Versão superada.');
    if(!available())deny(503,'Worker desativado.');
    const snapshot=await engines[value.kind].snapshot(actor,row.id);
    if(snapshot.externalCalls&&(configuration.networkReviewed!==true||(configuration.maxCalls??2)>2))deny(503,'Envio externo não aprovado para o worker.');
    if(!Number.isFinite(snapshot.cost)||snapshot.cost<=0||Math.ceil(snapshot.cost*1e6)>Math.floor(configuration.maxAttemptUSD*1e6))deny(503,'Teto por tentativa excedido.');
    return {value,row,actor,snapshot};
  }
  async function claim(record){
    let claimed;
    const initial=decode(record),row=await store.get('SELECT * FROM students WHERE id=?',initial.studentId);
    if(!row)return null;
    const actorId=initial.kind==='training'?row.coach_id:row.nutrition_id;
    if(!actorId)return null;
    await store.transaction(async()=>{
      await store.lockActor(actorId);await store.lockStudent(initial.studentId);await store.lockAIBudget();
      const current=await store.get('SELECT * FROM operations WHERE actor_id=? AND operation_key=?',record.actor_id,record.operation_key);
      const value=current&&decode(current);if(!value||!['queued','blocked'].includes(value.state))return;
      let c;
      try{c=await candidate(current);}catch(error){await change(current,{...value,state:error.status===409?'superseded':'blocked',blockedCode:error.status||503,updatedAt:now()});return;}
      const jobs=(await records()).map(decode);
      if(jobs.some(j=>j.studentId===value.studentId&&j.orgId===value.orgId&&(j.state==='running'||j.externalCalls===true&&['failed','interrupted'].includes(j.state)&&!j.reconciledAt)))return;
      const recent=await store.all("SELECT result FROM operations WHERE actor_id=? AND operation_key LIKE 'ai-budget-%'",c.actor.id);
      if(recent.filter(r=>decode(r).createdAt>now()-60000).length>=5||jobs.filter(j=>j.studentId===value.studentId&&j.startedAt>now()-86400000).reduce((n,j)=>n+(j.attempt||0),0)>=4){await change(current,{...value,state:'blocked',blockedCode:429,updatedAt:now()});return;}
      const used=jobs.flatMap(j=>j.attempts||[]).filter(a=>a.windowId===windowId).reduce((n,a)=>n+a.reservedMicros,0),amount=Math.ceil(c.snapshot.cost*1e6);
      const attempts=jobs.flatMap(j=>j.attempts||[]).filter(a=>a.windowId===windowId);
      if(attempts.length>=(configuration.maxCalls??2)||used+amount>Math.floor(configuration.totalUSD*1e6)){await change(current,{...value,state:'blocked',blockedCode:503,updatedAt:now()});return;}
      const attempt=value.attempt+1;
      if(attempt>3)deny(409,'Máximo de tentativas atingido.');
      const reservation=await c.snapshot.budget.reserveLocked(c.actor,c.row.id,c.snapshot.cost,'draft-attempt-'+value.id+'-'+attempt,c.snapshot.input);
      if(reservation.blocked){await change(current,{...value,state:'blocked',blockedCode:503,updatedAt:now()});return;}
      await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',c.actor.id,'ai-budget-'+randomUUID(),hash('draft-worker-reservation'),202,JSON.stringify({budgetMode:'monthly-per-student',monthlyReservationId:reservation.id,studentId:c.row.id,reservedUSD:c.snapshot.cost,createdAt:now(),model:c.snapshot.model,inputTokenUpperBound:c.snapshot.inputTokens,maxOutputTokens:c.snapshot.outputTokens,externalCalls:c.snapshot.externalCalls}));
      const claimedValue={...value,state:'running',attempt,attempts:[...(value.attempts||[]),{number:attempt,reservationId:reservation.id,reservedMicros:reservation.amountMicros,windowId}],reservationId:reservation.id,actorId:c.actor.id,externalCalls:c.snapshot.externalCalls,startedAt:now(),updatedAt:now(),leaseUntil:now()+30000};
      if(!await change(current,claimedValue,102))deny(409,'Fila mudou.');
      await audit(c.actor,c.row.id,'draft-job.claimed:'+value.id+':'+attempt);
      claimed={record:{...current,result:JSON.stringify(claimedValue),status:102},...c,value:claimedValue};
    });
    return claimed;
  }
  async function dispatch(record){
    const c=await claim(record);if(!c)return;
    const controller=new AbortController();controllers.add(controller);let timer;
    try{
      // Recheck immediately before dispatch. No fabricated HTTP session or role grant.
      await candidate(c.record);
      const timeoutMs=Math.min(20000,Math.max(1,c.snapshot.timeoutMs));
      c.snapshot.output=await Promise.race([engines[c.value.kind].generate(c.snapshot,{signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},timeoutMs);timer.unref?.();})]);
      await store.transaction(async()=>{
        await store.lockActor(c.actor.id);await store.lockStudent(c.row.id);
        const current=await store.get('SELECT * FROM operations WHERE actor_id=? AND operation_key=?',c.record.actor_id,c.record.operation_key),value=decode(current);
        if(value.state!=='running'||value.attempt!==c.value.attempt)deny(409,'Tentativa mudou.');
        const fresh=await candidate(current);if(fresh.actor.id!==c.actor.id||fresh.snapshot.fingerprint!==c.snapshot.fingerprint)deny(409,'Contexto mudou.');
        const planId=await engines[value.kind].saveLocked(c.actor,c.snapshot,c.value.reservationId,value.id,value.version);
        if(!await change(current,{...value,state:'draft-ready',planId,finishedAt:now(),updatedAt:now()},201))deny(409,'Fila mudou.');
      });
    }catch(error){
      await store.transaction(async()=>{await store.lockStudent(c.row.id);const current=await store.get('SELECT * FROM operations WHERE actor_id=? AND operation_key=?',c.record.actor_id,c.record.operation_key);const value=decode(current);if(value.state==='running'&&value.attempt===c.value.attempt)await change(current,{...value,state:error.status===409?'superseded':'failed',failureCode:error.status||502,finishedAt:now(),updatedAt:now()},502);});
    }finally{clearTimeout(timer);controllers.delete(controller);}
  }
  async function recover(){
    for(const record of await records()){
      const value=decode(record);
      if(value.state==='running'&&value.leaseUntil<=now())await store.transaction(async()=>{await store.lockStudent(value.studentId);await change(record,{...value,state:'interrupted',failureCode:502,updatedAt:now()},409);});
    }
  }
  async function scan(){
    let cursor='';
    while(!closed){const rows=await store.all('SELECT s.* FROM students s JOIN anamneses a ON a.student_id=s.id WHERE a.status=? AND s.id>? ORDER BY s.id LIMIT 200','complete',cursor);
      for(const row of rows){const actor=await store.get('SELECT * FROM users WHERE id=? AND active=1 AND org_id=?',row.coach_id,row.org_id);if(actor)await store.transaction(async()=>{await store.lockActor(actor.id);await store.lockStudent(row.id);await enqueueLocked(actor,await store.get('SELECT * FROM students WHERE id=?',row.id));});}
      if(rows.length<200)break;cursor=rows.at(-1).id;
    }
  }
  async function flush(){
    if(closed)return;if(draining)return draining;
    draining=(async()=>{await recover();await scan();for(const record of await records()){if(closed)break;if(['queued','blocked'].includes(decode(record).state))await dispatch(record);}})();
    try{await draining;}finally{draining=null;}
  }
  const dto=(value,actor)=>({id:value.id,kind:value.kind,version:value.version,anamnesisRevision:value.anamnesisRevision,state:value.state,reviewRequired:true,...(actor.role!=='student'?{attempt:value.attempt,blockedCode:value.blockedCode,failureCode:value.failureCode,planId:value.planId}:{} )});
  async function handle(actor,req,route){
    const m=/^\/api\/local\/students\/([a-f0-9-]{36})\/draft-jobs(?:\/([a-f0-9-]{36})\/(retry|reconcile))?$/.exec(route);if(!m)return null;
    const row=await student(actor,m[1]),scoped=(await records()).filter(r=>{const v=decode(r);return v.orgId===actor.org_id&&v.studentId===row.id;});
    if(!m[2]&&req.method==='GET'){
      const access=await policy.state(row);
      return {status:200,data:{jobs:scoped.filter(r=>{const v=decode(r);return access.features[v.kind]===true&&(actor.role==='admin'||actor.role==='student'||v.kind==='training'&&actor.role==='coach'&&row.coach_id===actor.id||v.kind==='nutrition'&&actor.role==='nutrition'&&row.nutrition_id===actor.id);}).map(r=>dto(decode(r),actor)),workerAvailable:available(),realProductionGate:false}};
    }
    if(!m[2]||req.method!=='POST')deny(405,'Use consulta ou reconciliação explícita.');
    const record=scoped.find(r=>decode(r).id===m[2]);if(!record)deny(404,'Job indisponível.');
    const body=await read(req);exact(body,['version','reason','confirmed']);text(body.reason,8,300);if(body.confirmed!==true)deny(400,'Confirme a decisão de reconciliação.');
    return mutation(actor,req,body,async()=>{
      await store.lockStudent(row.id);const current=await store.get('SELECT * FROM operations WHERE actor_id=? AND operation_key=?',record.actor_id,record.operation_key),value=decode(current),active=await authorized(await store.get('SELECT * FROM students WHERE id=?',row.id),value.kind);
      if(actor.id!==active.id)deny(403,'Reconciliação exige o profissional vinculado ao serviço.');
      const v=await version(row,value.kind);if(value.version!==body.version||m[3]==='retry'&&value.version!==v.fingerprint)deny(409,'Versão superada.');
      if(m[3]==='retry'){
        if(value.state!=='failed'||value.attempt>=3||value.externalCalls===true)deny(409,'Retry somente após falha offline conhecida; envio externo exige reconciliação.');
        await candidate({...current,result:JSON.stringify({...value,state:'queued'})});
        await change(current,{...value,state:'queued',updatedAt:now()},202);
      }else{
        // An uncertain external/expired attempt is closed, never resent automatically.
        if(!['failed','interrupted'].includes(value.state))deny(409,'Reconciliação exige tentativa finalizada ou interrompida.');
        await change(current,{...value,state:'superseded',reconciledAt:now(),updatedAt:now()},200);
      }
      await audit(actor,row.id,'draft-job.'+m[3]+':'+value.id);return {status:200,data:{job:dto({...value,state:m[3]==='retry'?'queued':'superseded'},actor),externalCalls:false}};
    });
  }
  const timer=configuration.enabled===true&&configuration.poll!==false?setInterval(()=>{flush().catch(()=>{});},15000):null;timer?.unref?.();
  return {observeLocked,flush,handle,available,async close(){closed=true;if(timer)clearInterval(timer);for(const controller of controllers)controller.abort();if(draining)await draining;}};
}
