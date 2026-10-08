import {nutritionTotals} from './nutrition.mjs';
import {CONSENT_VERSION} from '../public/sim/intake-fields.js';
import {executionDay,executionWeek} from './execution.mjs';

export function supervisionFlow({store,now,deny,exact,text,read,mutation,student,audit,serviceSnapshot}){
 const admin=actor=>{if(actor.role!=='admin')deny(403,'Supervisão restrita à administração da sua organização.');};
 async function dashboard(actor,row){
  const intake=await store.get('SELECT * FROM anamneses WHERE student_id=? AND org_id=?',row.id,actor.org_id);
  const permitted=intake?.training_consent===1&&intake?.consent_version===CONSENT_VERSION;
  const workouts=await store.all('SELECT * FROM workouts WHERE student_id=? AND org_id=? ORDER BY day DESC LIMIT 100',row.id,actor.org_id);
  const history=[];for(const w of workouts){const sets=await store.all('SELECT exercise_index,set_index,reps,load,completed FROM workout_sets WHERE workout_id=? ORDER BY exercise_index,set_index',w.id);history.push({id:w.id,day:w.day,completed:Boolean(w.completed),planId:w.plan_id,prescription:JSON.parse(w.prescription),sets:sets.map(s=>({exerciseIndex:s.exercise_index,setIndex:s.set_index,reps:s.reps,load:s.load,completed:Boolean(s.completed)}))});}
  const day=executionDay(now()),week=executionWeek(day),current=workouts.filter(w=>w.day>=week&&w.day<=day);
  const training=await store.all('SELECT id,title,status,revision,author_id,approved_by,approved_revision,published_at FROM plans WHERE student_id=? ORDER BY published_at DESC,id DESC LIMIT 20',row.id);
  const nutrition=await store.all('SELECT id,title,status,revision,author_id,approved_by,approved_revision,published_at,content FROM nutrition_plans WHERE student_id=? AND org_id=? ORDER BY created_at DESC LIMIT 20',row.id,actor.org_id);
  for(const p of nutrition){const content=JSON.parse(p.content);delete p.content;if(permitted&&intake.nutrition_consent===1){p.content=content;p.totals=nutritionTotals(content.meals||[]);p.clinicalDetailsRestricted=false;}else p.clinicalDetailsRestricted=true;}
  const published=await store.get("SELECT content FROM plans WHERE student_id=? AND status='published' ORDER BY published_at DESC LIMIT 1",row.id);
  const target=published?JSON.parse(published.content).daysPerWeek||3:null,completed=current.filter(w=>w.completed).length;
  const activity=await store.all('SELECT actor_id,event,created_at FROM audit WHERE student_id=? AND org_id=? ORDER BY created_at DESC,id DESC LIMIT 100',row.id,actor.org_id);
  await audit(actor,row.id,'supervision.dashboard.read'+(permitted?':anamnesis='+intake.revision+(intake.nutrition_consent===1?':nutrition':''):':metadata'));
  return {student:{id:row.id,name:row.name,revision:row.revision,internalNote:row.internal_note,coachId:row.coach_id,nutritionId:row.nutrition_id},anamnesis:{version:intake?.version||null,revision:intake?.revision||0,status:intake?.status||'not_started',consentVersion:intake?.consent_version||null,consents:{training:intake?.training_consent===1,nutrition:intake?.nutrition_consent===1},completedAt:intake?.completed_at||null,reviewedBy:intake?.reviewed_by||null,reviewedRevision:intake?.reviewed_revision??null,answers:permitted?JSON.parse(intake.answers):undefined,adminAccessAuthorized:permitted},execution:{day,week,timeZone:'America/Sao_Paulo',weeklyTarget:target,completedThisWeek:completed,startedThisWeek:current.length,weeklyAdherencePercent:target?Math.min(100,Math.round(completed/target*100)):null,lastRecordedDay:workouts[0]?.day||null,history,historyLimit:100,nutritionAdherence:null},plans:{training,nutrition},service:await serviceSnapshot(row,actor),activity};
 }
 return {async handle(actor,req,route){
  const m=/^\/api\/local\/students\/([a-f0-9-]{36})\/supervision(?:\/(return-plan))?$/.exec(route);if(!m)return null;
  admin(actor);const row=await student(actor,m[1]);
  if(!m[2]&&req.method==='GET')return {status:200,data:{dashboard:await dashboard(actor,row)}};
  if(!m[2]&&req.method==='PUT'){
   const b=await read(req);exact(b,['revision','note','confirmed']);if(!Number.isInteger(b.revision)||b.confirmed!==true)deny(400,'Confirme a revisão e os próximos passos.');const note=text(b.note,0,1000);
   return mutation(actor,req,b,async()=>{await store.lockStudent(row.id);const current=await student(actor,row.id);if(current.revision!==b.revision)deny(409,'Cadastro mudou. Recarregue.');const update=await store.run('UPDATE students SET internal_note=?,revision=revision+1 WHERE id=? AND org_id=? AND revision=?',note,row.id,actor.org_id,b.revision);if(update.changes!==1)deny(409,'Cadastro mudou. Recarregue.');await audit(actor,row.id,'supervision.next_steps.updated:revision='+String(b.revision+1));return {status:200,data:{saved:true,revision:b.revision+1}};});
  }
  if(m[2]==='return-plan'&&req.method==='POST'){
   const b=await read(req);exact(b,['kind','planId','revision','reason','confirmed']);if(!['training','nutrition'].includes(b.kind)||typeof b.planId!=='string'||! /^[a-f0-9-]{36}$/.test(b.planId)||!Number.isInteger(b.revision)||b.confirmed!==true)deny(400,'Confirme plano, versão e devolução.');const reason=text(b.reason,3,1000),table=b.kind==='training'?'plans':'nutrition_plans';
   return mutation(actor,req,b,async()=>{await store.lockStudent(row.id);const profile=await student(actor,row.id);const nextNote=(profile.internal_note?profile.internal_note+'\n':'')+(b.kind==='training'?'Treino: ':'Alimentação: ')+reason;if(nextNote.length>1000)deny(409,'A nota interna atingiu o limite. Revise os próximos passos antes de devolver o plano.');const p=await store.get('SELECT * FROM '+table+' WHERE id=? AND student_id=?',b.planId,row.id);if(!p)deny(404,'Plano não encontrado.');if(p.status==='published'||p.revision!==b.revision)deny(409,'Plano publicado é imutável; solicite uma nova versão.');const update=await store.run("UPDATE "+table+" SET status='draft',approved_by=NULL,approved_revision=NULL,revision=revision+1 WHERE id=? AND student_id=? AND revision=?",p.id,row.id,b.revision);if(update.changes!==1)deny(409,'Plano mudou.');await store.run('UPDATE students SET internal_note=?,revision=revision+1 WHERE id=? AND org_id=?',nextNote,row.id,actor.org_id);await audit(actor,row.id,'supervision.plan.returned:'+b.kind+':'+p.id+':revision='+String(b.revision+1));return {status:200,data:{returned:true,clinicalApprovalPerformed:false,revision:b.revision+1}};});
  }
  deny(405,'Método não permitido.');
 }};
}
