import {createHash,randomUUID} from 'node:crypto';

// Immutable purpose/risk decisions reuse the existing private operation journal.
// These records never expand an actor's role or the student's consent.
export const TRAINING_PROPOSAL_PURPOSE='SIM_TRAINING_PROPOSAL_LOCAL_V1';
const marker=type=>createHash('sha256').update('sim-private-record:'+type).digest('hex');
export function trainingSafety({store,now,deny,exact,text,read,mutation,student,audit}){
 async function records(type,id){
  const rows=await store.all('SELECT o.actor_id,o.result FROM operations o JOIN users u ON u.id=o.actor_id WHERE o.request_hash=? AND u.org_id=?',marker(type),(await store.get('SELECT org_id FROM students WHERE id=?',id)).org_id);
  try{return rows.map(r=>({...JSON.parse(r.result),actorId:r.actor_id})).filter(r=>r.studentId===id).sort((a,b)=>b.sequence-a.sequence);}catch{deny(503,'Registro de finalidade indisponível.');}
 }
 async function append(actor,type,value){await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,'training-record-'+randomUUID(),marker(type),200,JSON.stringify(value));}
 async function consent(row){const values=await records('consent',row.id);return values.find(r=>r.actorId===row.user_id)||{sequence:0,enabled:false};}
 async function risk(row,intake){
  if(!intake?.attention_review)return {required:false,resolved:true};
  const reviewer=await store.get("SELECT id FROM users WHERE id=? AND org_id=? AND role='coach' AND active=1",row.coach_id,row.org_id);
  const record=(await records('risk',row.id))[0];
  const current=reviewer&&record?.actorId===reviewer.id&&record.studentRevision===row.revision&&record.anamnesisRevision===intake.revision&&intake.reviewed_by===reviewer.id&&intake.reviewed_revision===intake.revision;
  return {required:true,resolved:!!current&&record.decision==='allow-with-limitations',decision:current?record.decision:'pending',sequence:record?.sequence||0,...(current?{note:record.note,reviewerId:record.actorId}:{} )};
 }
 async function assertPublishable(actor,row){
  const intake=await store.get('SELECT * FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id);
  const state=await risk(row,intake);
  if(state.required&&(!intake.training_consent||intake.status!=='complete'||!state.resolved))deny(409,'Sinal de atenção: o personal vinculado precisa registrar resolução explícita da revisão atual antes de aprovar ou publicar.');
  return state;
 }
 async function handle(actor,req,route){
  const m=/^\/api\/local\/students\/([a-f0-9-]{36})\/training-(proposal-consent|risk)$/.exec(route);if(!m)return null;
  const row=await student(actor,m[1]);if(!['admin','coach','student'].includes(actor.role))deny(403,'Finalidade restrita ao acompanhamento de treino.');
  const intake=await store.get('SELECT * FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id);
  if(req.method==='GET'){const c=await consent(row),r=await risk(row,intake);const {note,...meta}=r;void note;return {status:200,data:m[2]==='proposal-consent'?{consent:{purpose:TRAINING_PROPOSAL_PURPOSE,sequence:c.sequence,enabled:c.enabled===true&&c.anamnesisRevision===intake?.revision&&intake.training_consent===1,anamnesisRevision:intake?.revision||0,externalTransferAuthorized:false}}:{risk:meta}};}
  const body=await read(req);
  if(m[2]==='proposal-consent'){
   if(actor.role!=='student'||row.user_id!==actor.id||req.method!=='PUT')deny(403,'A escolha pertence ao aluno.');
   exact(body,['purpose','sequence','anamnesisRevision','enabled','confirmed']);
   if(body.purpose!==TRAINING_PROPOSAL_PURPOSE||typeof body.enabled!=='boolean'||body.confirmed!==true)deny(400,'Confirme a finalidade de simulação local.');
   return mutation(actor,req,body,async()=>{await store.lockStudent(row.id);const current=await student(actor,row.id),a=await store.get('SELECT * FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id),c=await consent(current);
    if(body.sequence!==c.sequence||body.anamnesisRevision!==(a?.revision||0))deny(409,'Finalidade ou respostas mudaram. Recarregue.');
    if(body.enabled&&(!a?.training_consent||a.status!=='complete'))deny(409,'Conclua a anamnese e autorize o acompanhamento antes desta escolha opcional.');
    await append(actor,'consent',{studentId:row.id,purpose:TRAINING_PROPOSAL_PURPOSE,sequence:c.sequence+1,anamnesisRevision:body.anamnesisRevision,enabled:body.enabled,createdAt:now(),externalTransferAuthorized:false});await audit(actor,row.id,'training.proposal-consent.'+(body.enabled?'granted':'withdrawn')+':'+(c.sequence+1));
    return {status:200,data:{consent:{sequence:c.sequence+1,enabled:body.enabled,externalTransferAuthorized:false}}};
   });
  }
  if(actor.role!=='coach'||row.coach_id!==actor.id||req.method!=='PUT')deny(403,'Resolução exige o personal atualmente vinculado.');
  exact(body,['sequence','anamnesisRevision','decision','note','confirmed']);
  if(!['hold','allow-with-limitations'].includes(body.decision)||body.confirmed!==true)deny(400,'Confirme uma decisão profissional explícita.');const note=text(body.note,10,1000);
  return mutation(actor,req,body,async()=>{await store.lockStudent(row.id);const current=await student(actor,row.id),a=await store.get('SELECT * FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id),r=await risk(current,a);
   if(current.coach_id!==actor.id||body.sequence!==(r.sequence||0)||body.anamnesisRevision!==a?.revision)deny(409,'Vínculo, sinal ou revisão mudou.');
   if(!a?.attention_review||!a.training_consent||a.status!=='complete'||a.reviewed_by!==actor.id||a.reviewed_revision!==a.revision)deny(409,'Conclua e revise a anamnese atual antes de resolver o sinal.');
   await append(actor,'risk',{studentId:row.id,studentRevision:current.revision,sequence:(r.sequence||0)+1,anamnesisRevision:a.revision,decision:body.decision,note,createdAt:now()});await audit(actor,row.id,'training.risk.'+body.decision+':'+a.revision);
   return {status:200,data:{risk:await risk(current,a)}};
  });
 }
 return {consent,risk,assertPublishable,handle};
}
