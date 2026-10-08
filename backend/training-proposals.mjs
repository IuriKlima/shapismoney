import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {monthlyBudget} from './ai-monthly-budget.mjs';
import {INTAKE_VERSION,CONSENT_VERSION,validateIntake} from '../public/sim/intake-fields.js';
export const TRAINING_INPUT_FIELDS=Object.freeze(['age','height_m','weight_kg','main_goal','training_history','current_training','environment','days','schedule','liked_exercises','difficult_exercises','injuries','fractures','restrictions']);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Explicit local file only; never bundled, auto-loaded, or sent to an API.
export function readPrivateTrainingMethod(filename,workspace){
 const base=realpathSync(path.join(workspace,'.qa')),resolved=path.resolve(filename);
 if(!resolved.startsWith(base+path.sep)||lstatSync(resolved).isSymbolicLink()||realpathSync(resolved)!==resolved||lstatSync(resolved).size>65536)throw Error('Private method configuration unavailable');
 return JSON.parse(readFileSync(resolved,'utf8'));
}

export function trainingProposalFlow({store,now,deny,exact,text,read,mutation,student,audit,safety,security,configuration={},budgetConfiguration={}}){
 const proposals=new Map(),ttl=20*60*1000;
 const budget=monthlyBudget({store,now,deny,exact,text,read,mutation,student,audit,configuration:{...budgetConfiguration,model:'local-training-simulation'}});
 const method=()=>configuration.methodology;
 function available(){const m=method();return !security.production&&configuration.enabled===true&&configuration.mode==='local-simulation'&&configuration.provider?.kind==='local-simulation'&&typeof configuration.provider.generate==='function'&&budget.enabled&&configuration.expiresAt>now()&&configuration.expiresAt-now()<=86400000&&m?.status==='synthetic-fixture'&&m.version&&Array.isArray(m.rules)&&m.rules.length>0&&Array.isArray(m.exercises)&&m.exercises.length>0;}
 const prune=()=>{for(const [id,p] of proposals)if(p.expiresAt<=now())proposals.delete(id);};
 const timer=setInterval(prune,60000);timer.unref?.();
 async function current(actor,id){
  const row=await student(actor,id);
  const reviewer=await store.get("SELECT id FROM users WHERE id=? AND org_id=? AND role='coach' AND active=1",row.coach_id,row.org_id);
  if(!reviewer||!(actor.role==='coach'&&actor.id===row.coach_id||actor.role==='admin'))deny(403,'Proposta exige personal vinculado ativo ou supervisão administrativa autorizada.');
  const intake=await store.get('SELECT * FROM anamneses WHERE student_id=? AND org_id=?',id,row.org_id),consent=await safety.consent(row);
  if(!intake?.training_consent||intake.version!==INTAKE_VERSION||intake.status!=='complete'||intake.reviewed_by!==reviewer.id||intake.reviewed_revision!==intake.revision)deny(409,'Conclua e revise a anamnese atual antes de preparar uma proposta.');
  if(actor.role==='admin'&&intake.consent_version!==CONSENT_VERSION)deny(403,'Supervisão administrativa da anamnese não autorizada.');
  if(consent.enabled!==true||consent.anamnesisRevision!==intake.revision)deny(409,'O aluno precisa escolher a finalidade específica desta simulação local.');
  const risk=await safety.risk(row,intake);let answers;try{answers=validateIntake(JSON.parse(intake.answers),{complete:true});}catch{deny(409,'Respostas atuais incompletas ou inválidas. Reabra a anamnese para conferência.');}
  const facts=Object.fromEntries(TRAINING_INPUT_FIELDS.filter(k=>k in answers).map(k=>[k,answers[k]]));
  const fingerprint=hash({actor:actor.id,role:actor.role,org:actor.org_id,student:id,studentRevision:row.revision,coach:row.coach_id,user:row.user_id,intakeRevision:intake.revision,reviewer:intake.reviewed_by,consentSequence:consent.sequence,riskSequence:risk.sequence||0,riskResolved:risk.resolved,method:method()});
  return {row,intake,consent,risk,facts,fingerprint};
 }
 function validate(payload,c){
  exact(payload,['title','daysPerWeek','exercises']);text(payload.title,2,100);
  if(!Number.isInteger(payload.daysPerWeek)||payload.daysPerWeek<1||payload.daysPerWeek>c.facts.days)deny(400,'Frequência deve respeitar os dias disponíveis informados.');
  if(!Array.isArray(payload.exercises)||payload.exercises.length<1||payload.exercises.length>12)deny(400,'Use 1-12 exercícios do catálogo conferido.');
  const exercises=payload.exercises.map(e=>{exact(e,['exerciseId','sets','reps','restSeconds','rir','reason','evidence','ruleId']);
   const item=method().exercises.find(x=>x.id===e.exerciseId&&x.status==='approved');
   if(!item||!item.environments.some(v=>c.facts.environment.includes(v)))deny(400,'Exercício não aprovado ou incompatível com o ambiente informado.');
   if(!Number.isInteger(e.sets)||e.sets<1||e.sets>10||!Number.isInteger(e.reps)||e.reps<1||e.reps>50||!Number.isInteger(e.restSeconds)||e.restSeconds<0||e.restSeconds>600||!Number.isInteger(e.rir)||e.rir<0||e.rir>10)deny(400,'Parâmetros de exercício inválidos.');
   if(!Array.isArray(e.evidence)||e.evidence.length<1||e.evidence.length>5||e.evidence.some(k=>!Object.hasOwn(c.facts,k))||!method().rules.some(r=>r.id===e.ruleId))deny(400,'Justifique cada exercício com evidências e referência disponíveis.');
   return {exerciseId:e.exerciseId,name:text(item.name,2,100),sets:e.sets,reps:e.reps,restSeconds:e.restSeconds,rir:e.rir,reason:text(e.reason,8,500),evidence:e.evidence,ruleId:e.ruleId};
  });return {title:payload.title.trim(),daysPerWeek:payload.daysPerWeek,exercises};
 }
 const editable=payload=>({...payload,exercises:payload.exercises.map(({name,...e})=>{void name;return e;})});
 return {async assertPlanApproval(actor,plan){
  const source=JSON.parse(plan.content).proposalSource;if(!source)return;
  if(security.production)deny(409,'Rascunho de simulação local não pode ser aprovado ou publicado em produção.');
  const c=await current(actor,plan.student_id);if(c.intake.revision!==source.anamnesisRevision||c.consent.sequence!==source.consentSequence||method()?.version!==source.methodVersion)deny(409,'Referências ou finalidade do rascunho mudaram. Prepare nova proposta.');
 },close(){clearInterval(timer);proposals.clear();},clearAuth(authHash){for(const [id,p] of proposals)if(p.authHash===authHash)proposals.delete(id);},async handle(actor,auth,req,route){
  if(route==='/api/local/training-proposals/capabilities'&&req.method==='GET')return {status:200,data:{available:available()&&['admin','coach'].includes(actor.role),consentAvailable:available()&&actor.role==='student',mode:'local-simulation',externalCalls:false,methodStatus:method()?.status||'unconfigured',writesRequireConfirmation:true,...(available()&&['admin','coach'].includes(actor.role)?{exerciseOptions:method().exercises.filter(e=>e.status==='approved').map(({id,name})=>({id,name}))}:{})}};
  const edit=/^\/api\/local\/training-proposals\/plans\/([a-f0-9-]{36})$/.exec(route);
  if(edit){
   if(!available())deny(503,'Edição deste bloco exige a simulação local configurada.');if(req.method!=='PUT')deny(405,'Use edição explícita do rascunho.');
   const plan=await store.get('SELECT * FROM plans WHERE id=?',edit[1]);if(!plan)deny(404,'Rascunho não encontrado.');await current(actor,plan.student_id);
   const body=await read(req);exact(body,['revision','payload','confirmed']);if(body.confirmed!==true)deny(400,'Confirme os parâmetros editados.');
   return mutation(actor,req,body,async()=>{await store.lockStudent(plan.student_id);const c=await current(actor,plan.student_id),p=await store.get('SELECT * FROM plans WHERE id=?',plan.id),source=JSON.parse(p.content).proposalSource;
    if(p.status==='published'||p.revision!==body.revision||source?.mode!=='local-simulation')deny(409,'Somente rascunhos deste fluxo; plano publicado é imutável.');
    if(source.anamnesisRevision!==c.intake.revision||source.consentSequence!==c.consent.sequence||source.methodVersion!==method().version)deny(409,'Referências mudaram. Prepare nova proposta.');
    const payload=validate(body.payload,c),content={daysPerWeek:payload.daysPerWeek,exercises:payload.exercises,proposalSource:{...source,editedBy:actor.id}};
    const changed=await store.run("UPDATE plans SET title=?,content=?,status='draft',approved_by=NULL,approved_revision=NULL,revision=revision+1 WHERE id=? AND revision=?",payload.title,JSON.stringify(content),p.id,body.revision);if(changed.changes!==1)deny(409,'Plano mudou.');await audit(actor,p.student_id,'training.proposal.draft-edited:'+p.id);
    return {status:200,data:{plan:{id:p.id,title:payload.title,content,status:'draft',revision:p.revision+1}}};
   });
  }
  const m=/^\/api\/local\/students\/([a-f0-9-]{36})\/training-proposals(\/(prepare|confirm))?$/.exec(route);if(!m)return null;
  if(!available())deny(503,'Motor personalizado desativado. Este bloco permite somente simulação local com catálogo fictício.');
  if(req.method!=='POST'||!m[3])deny(405,'Use preparar ou confirmar.');prune();const body=await read(req);
  if(m[3]==='prepare'){
   exact(body,['anamnesisRevision','consentSequence','confirmed']);if(body.confirmed!==true)deny(400,'Confirme a preparação da proposta local.');
   if(proposals.size>=1000||[...proposals.values()].filter(p=>p.actorId===actor.id).length>=8)deny(429,'Limite de propostas temporárias.');
   const c=await current(actor,m[1]);if(body.anamnesisRevision!==c.intake.revision||body.consentSequence!==c.consent.sequence)deny(409,'Respostas ou finalidade mudaram.');
   const key=req.headers['idempotency-key'];
   // Reuse the durable installation/student caps. Only the isolated fixture enables this.
   const input={untrustedFacts:c.facts,untrustedMethod:{version:method().version,rules:method().rules,exercises:method().exercises},attentionRequiresHumanResolution:c.risk.required&&!c.risk.resolved};
   const bytes=Buffer.byteLength(JSON.stringify(input));if(bytes>18000)deny(413,'Contexto excedeu o limite da proposta.');
   const rateIn=budgetConfiguration.inputRate,rateOut=budgetConfiguration.outputRate;
   if(!Number.isFinite(rateIn)||rateIn<=0||!Number.isFinite(rateOut)||rateOut<=0)deny(503,'Reserva conservadora não configurada.');
   const cost=((bytes+2048)*rateIn+700*rateOut)/1000000;let reservation;
   await store.transaction(async()=>{await store.lockActor(actor.id);await store.lockStudent(c.row.id);await store.lockAIBudget();const active=await store.get('SELECT active,org_id,role FROM users WHERE id=?',actor.id);if(!active?.active||active.org_id!==actor.org_id||active.role!==actor.role)deny(401,'Acesso mudou.');if((await current(actor,m[1])).fingerprint!==c.fingerprint)deny(409,'Contexto mudou.');
    const recent=await store.all("SELECT result FROM operations WHERE actor_id=? AND operation_key LIKE 'ai-budget-%'",actor.id);if(recent.filter(r=>JSON.parse(r.result).createdAt>now()-60000).length>=5)deny(429,'Limite de cinco preparações ou mensagens por minuto.');
    reservation=await budget.reserveLocked(actor,c.row.id,cost,key,input);
    if(!reservation.blocked)await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,'ai-budget-'+randomUUID(),hash('local-training-reservation'),202,JSON.stringify({budgetMode:'monthly-per-student',monthlyReservationId:reservation.id,studentId:c.row.id,reservedUSD:cost,createdAt:now(),model:'local-training-simulation',promptVersion:'training-proposal-local-v1',externalCalls:false}));
   });
   if(reservation.blocked){await budget.recordBlocked(actor,reservation);deny(503,'Verba interna insuficiente. Nenhuma proposta substituta foi gerada.');}
   let output,timeout;try{output=await Promise.race([configuration.provider.generate(input),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Simulation timeout')),20000);timeout.unref?.();})]);}catch{deny(502,'O provedor simulado não concluiu. Nenhuma repetição automática.');}finally{clearTimeout(timeout);}
   if(!available())deny(503,'Simulação expirou ou foi desativada.');
   const fresh=await current(actor,m[1]);if(fresh.fingerprint!==c.fingerprint)deny(409,'Contexto mudou durante a preparação.');
   const active=await store.get('SELECT u.active,u.role,u.org_id FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.token_hash=? AND s.expires_at>?',actor.id,auth.hash,now());if(!active?.active||active.role!==actor.role||active.org_id!==actor.org_id)deny(401,'Sessão ou acesso mudou.');
   const payload=validate(output,c),id=randomUUID(),expiresAt=now()+ttl;
   const p={id,actorId:actor.id,orgId:actor.org_id,authHash:auth.hash,studentId:c.row.id,fingerprint:c.fingerprint,expiresAt,payload,methodVersion:method().version};p.hash=hash({id,payload,actor:actor.id,org:actor.org_id,auth:auth.hash,fingerprint:p.fingerprint,expiresAt});proposals.set(id,p);await audit(actor,c.row.id,'training.proposal.prepared:'+id);
   return {status:200,data:{proposal:{id,hash:p.hash,payload:editable(payload),expiresAt,anamnesisRevision:c.intake.revision,consentSequence:c.consent.sequence,methodVersion:p.methodVersion,mode:'local-simulation',riskPending:c.risk.required&&!c.risk.resolved},reservedUSD:cost,writesPerformed:false,externalCalls:false}};
  }
  exact(body,['proposalId','proposalHash','payload','confirmed']);if(body.confirmed!==true)deny(400,'Confira e confirme o rascunho editável.');
  const p=proposals.get(body.proposalId);if(!p||p.studentId!==m[1]||p.actorId!==actor.id||p.orgId!==actor.org_id||p.authHash!==auth.hash||p.hash!==body.proposalHash)deny(409,'Proposta ausente, expirada ou de outra sessão.');
  if(p.confirmationKey&&p.confirmationKey!==req.headers['idempotency-key'])deny(409,'Proposta já confirmada.');
  const result=await mutation(actor,req,body,async()=>{await store.lockStudent(p.studentId);if(!available()||p.expiresAt<=now())deny(409,'Simulação ou proposta expirada.');if(await store.get('SELECT operation_key FROM operations WHERE actor_id=? AND operation_key=?',actor.id,'training-proposal-confirmed-'+p.id))deny(409,'Proposta já confirmada com outra operação.');const c=await current(actor,p.studentId);if(c.fingerprint!==p.fingerprint)deny(409,'Respostas, finalidade, vínculo ou referência mudaram. Prepare novamente.');
   const payload=validate(body.payload,c),id=randomUUID();const content={daysPerWeek:payload.daysPerWeek,exercises:payload.exercises,proposalSource:{mode:'local-simulation',proposalId:p.id,methodVersion:p.methodVersion,anamnesisRevision:c.intake.revision,consentSequence:c.consent.sequence,preparedBy:actor.id,confirmedBy:actor.id}};
   await store.run('INSERT INTO plans(id,student_id,author_id,title,content,status) VALUES (?,?,?,?,?,?)',id,p.studentId,actor.id,payload.title,JSON.stringify(content),'draft');await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,'training-proposal-confirmed-'+p.id,hash('proposal-confirmation'),201,JSON.stringify({planId:id,proposalId:p.id}));await audit(actor,p.studentId,'training.proposal.draft-confirmed:'+p.id);
   return {status:201,data:{plan:{id,title:payload.title,content,status:'draft',revision:1},externalCalls:false}};
  });p.confirmationKey=req.headers['idempotency-key'];return result;
 }};
}
