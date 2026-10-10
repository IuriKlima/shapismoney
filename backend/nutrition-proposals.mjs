import {selectApprovedReferences,referenceConfigurationHash} from './private-retrieval.mjs';
import {randomUUID} from 'node:crypto';
import {monthlyBudget} from './ai-monthly-budget.mjs';
import {nutritionContextFlow,nutritionHash} from './nutrition-context.mjs';
import {nutritionProviderInput,validateNutritionProposal,assertNutritionContextContent} from './nutrition-proposal-validation.mjs';
import {proposalInputTokenUpperBound,proposalFailureDiagnostic,PROPOSAL_MAX_OUTPUT_TOKENS,NUTRITION_PROPOSAL_PROMPT_VERSION} from './proposal-responses.mjs';
export function nutritionProposalFlow({store,now,deny,exact,text,read,mutation,student,audit,security,nutrition,assertNutritionAccess,configuration={}}){
 const b=configuration.budget||{},provider=()=>configuration.provider;
 const stamp=()=>nutritionHash({references:referenceConfigurationHash(configuration.privateReferences),budget:b,mode:configuration.mode,expiresAt:configuration.expiresAt,provider:{kind:provider()?.kind,model:provider()?.model,transportKind:provider()?.transportKind,mockOnly:provider()?.mockOnly}});
 const initialStamp=stamp(),budget=monthlyBudget({store,now,deny,exact,text,read,mutation,student,audit,configuration:{...b,model:provider()?.model}});
 const live=()=>provider()?.kind==='responses'&&provider()?.transportKind==='network'&&provider()?.mockOnly===false;
 const available=()=>!security.production&&configuration.enabled===true&&configuration.externalGate===true&&configuration.mode==='external-reviewed'&&configuration.budget===b&&stamp()===initialStamp&&b.purpose==='nutrition-proposals'&&budget.enabled&&configuration.expiresAt>now()&&configuration.expiresAt-now()<=86400000&&typeof provider()?.generate==='function'&&(live()||configuration.offlineTest===true&&provider()?.kind==='responses-offline-test'&&provider()?.transportKind==='fake-test'&&provider()?.mockOnly===true);
 const contextFlow=nutritionContextFlow({store,now,deny,exact,text,read,mutation,student,audit,nutrition,assertNutritionAccess,enabled:available});
 const current=async(actor,id)=>{const c=await contextFlow.valid(actor,id,{requireConsent:true,requireTransfer:true});c.references=await selectApprovedReferences({configuration:configuration.privateReferences,store,now,actor,kind:'nutrition',facts:nutritionProviderInput(c).untrustedFacts,method:c.context,external:true,production:security.production});if(c.references)c.fingerprint=nutritionHash({clinical:c.fingerprint,references:c.references.provenance});return c;};
 const providerInput=c=>{const input=nutritionProviderInput(c);if(c.references)input.untrustedMethod.retrievedReferences=c.references.references;return input;};
 async function session(actor,auth){const live=await store.get('SELECT u.active,u.role,u.org_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.id=? AND s.expires_at>?',auth.hash,actor.id,now());if(!live?.active||live.role!==actor.role||live.org_id!==actor.org_id)deny(401,'Sessão nutricional expirou ou foi revogada.');if(!available())deny(503,'Geração nutricional externa desativada ou expirada.');}
 async function reference(actor,id,fingerprint){const c=await current(actor,id);if(c.fingerprint!==fingerprint)deny(409,'Consentimento, habilitação, contexto, vínculo, anamnese ou catálogo mudou.');return c;}
 const validated=async(payload,c)=>{try{return await validateNutritionProposal(payload,c,{deny,exact,text});}catch(error){if(error.validationDiagnostic)throw Object.assign(Error('Proposta nutricional fora do schema/contexto aprovado.'),{safe:true,status:400,validationDiagnostic:error.validationDiagnostic});throw error;}};
 const job={
  async ready(actor,id){try{await current(actor,id);return true;}catch{return false;}},
  version:()=>stamp(),
  async snapshot(actor,id){
   if(!available())deny(503,'Motor nutricional indisponível.');const c=await current(actor,id),input=providerInput(c),inputTokens=proposalInputTokenUpperBound(input),outputTokens=PROPOSAL_MAX_OUTPUT_TOKENS;
   if(inputTokens>8000||Buffer.byteLength(JSON.stringify(input))>18000)deny(413,'Entrada excede o limite.');
   if(!Number.isFinite(b.inputRate)||b.inputRate<=0||!Number.isFinite(b.outputRate)||b.outputRate<=0)deny(503,'Reserva indisponível.');
   return {c,input,fingerprint:c.fingerprint,budget,inputTokens,outputTokens,cost:(inputTokens*b.inputRate+outputTokens*b.outputRate)/1000000,externalCalls:live(),model:provider().model,timeoutMs:configuration.timeoutMs||20000};
  },
  generate:(s,options)=>provider().generate(s.input,options),
  async saveLocked(actor,s,reservationId,jobId,version){
   if(!available())deny(503,'Motor desativado.');const c=await reference(actor,s.c.row.id,s.fingerprint),content=await validated(s.output,c),id=randomUUID();
   content.proposalSource={mode:'external-reviewed',reviewRequired:true,automaticDraft:true,jobId,jobVersion:version,proposalId:jobId,contextFingerprint:c.fingerprint,runtimeStamp:initialStamp,providerKind:provider().kind,externalCalls:live(),model:provider().model,reservationId,promptVersion:NUTRITION_PROPOSAL_PROMPT_VERSION,schemaVersion:'SIM_NUTRITION_CONTEXT_V1',contextRevision:c.context.revision,contextHash:nutritionHash(c.context),catalogHash:c.context.catalogHash,inputHash:nutritionHash(s.input),credentialRevision:c.credential.revision,consentRevision:c.consent.revision,anamnesisRevision:c.intake.revision,preparedBy:actor.id,budgetAccounting:'shared-installation-student-ledger',sources:c.context.sources,...(c.references?{referenceRetrieval:c.references.provenance}:{})};
   await store.run('INSERT INTO nutrition_plans(id,org_id,student_id,author_id,title,content,status,created_at) VALUES (?,?,?,?,?,?,?,?)',id,actor.org_id,c.row.id,actor.id,text(s.output.title,2,100),JSON.stringify(content),'draft',now());await audit(actor,c.row.id,'nutrition.automatic-draft:'+jobId);return id;
  }
 };
 return {job,available,async assertPlanApproval(actor,plan){
  const content=JSON.parse(plan.content),source=content.proposalSource;if(!source)return;
  if(!available()||source.mode!==configuration.mode||source.runtimeStamp!==initialStamp)deny(409,'Gate/referências do rascunho gerado indisponíveis. Fluxo manual continua disponível.');
  const c=await reference(actor,plan.student_id,source.contextFingerprint);
  assertNutritionContextContent(content,c.context,deny);
  // Revalidate immutable snapshots against approved current catalog; human edits share validator.
  for(const meal of content.meals)for(const item of meal.items)for(const p of [item,...item.alternatives]){const row=c.catalog.find(r=>r.id===p.foodId);if(!row||row.preparation!==p.preparation||row.revision!==p.catalogRevision||JSON.stringify(JSON.parse(row.composition))!==JSON.stringify(p.composition))deny(409,'Snapshot nutricional mudou.');}
 },async handle(actor,auth,req,route){
  const contextResult=await contextFlow.handle(actor,req,route);if(contextResult)return contextResult;
  if(route==='/api/local/nutrition-proposals/capabilities'&&req.method==='GET')return {status:200,data:{available:available()&&actor.role==='nutrition',consentAvailable:available()&&actor.role==='student',mode:'external-reviewed',providerKind:provider()?.kind||'unconfigured',externalCalls:available()&&live(),realProductionGate:false,accounting:'shared-installation-student-ledger-with-chat-and-training',reviewRequired:true}};
  const m=/^\/api\/local\/students\/([a-f0-9-]{36})\/nutrition-proposals\/(prepare|confirm)$/.exec(route);if(!m)return null;
  if(!available())deny(503,'Geração nutricional externa desativada. Nenhuma resposta simulada substitui o provider.');
  if(req.method!=='POST')deny(405,'Use preparar ou confirmar.');const body=await read(req);
  if(m[2]==='prepare'){
   exact(body,['contextRevision','consentRevision','confirmed']);if(body.confirmed!==true)deny(400,'Confirme a preparação do rascunho.');
   const c=await current(actor,m[1]);await session(actor,auth);if(body.contextRevision!==c.context.revision||body.consentRevision!==c.consent.revision)deny(409,'Contexto ou finalidade mudou.');
   const input=providerInput(c);let upper;try{upper=proposalInputTokenUpperBound(input);}catch{deny(409,'Não há catálogo/regra elegível para o contexto nutricional revisado.');}if(upper>8000||Buffer.byteLength(JSON.stringify(input))>18000)deny(413,'Contexto excede a reserva conservadora.');
   if(!Number.isFinite(b.inputRate)||b.inputRate<=0||!Number.isFinite(b.outputRate)||b.outputRate<=0)deny(503,'Taxas de reserva precisam de configuração revisada.');
   const cost=(upper*b.inputRate+PROPOSAL_MAX_OUTPUT_TOKENS*b.outputRate)/1000000,key=req.headers['idempotency-key'],jobKey='nutrition-external-job-'+nutritionHash({actor:actor.id,key});let reservation;
   await store.transaction(async()=>{
    await store.lockActor(actor.id);await store.lockStudent(c.row.id);await store.lockAIBudget();await session(actor,auth);await reference(actor,c.row.id,c.fingerprint);
    if(await store.get('SELECT operation_key FROM operations WHERE actor_id=? AND operation_key=?',actor.id,jobKey))deny(409,'Operação já preparada ou tentada; não repetimos o provider.');
    const jobs=(await store.all("SELECT result FROM operations WHERE operation_key LIKE 'nutrition-external-job-%'")).map(r=>JSON.parse(r.result));
    if(jobs.some(j=>j.orgId===actor.org_id&&j.studentId===c.row.id&&j.state==='running'))deny(409,'Há geração pendente. Exige reconciliação explícita, sem repetição automática.');
    const recent=(await store.all("SELECT result FROM operations WHERE actor_id=? AND operation_key LIKE 'ai-budget-%'",actor.id)).map(r=>JSON.parse(r.result));if(recent.filter(r=>r.createdAt>now()-60000).length>=5)deny(429,'Limite compartilhado de cinco operações por minuto.');
    reservation=await budget.reserveLocked(actor,c.row.id,cost,key,input);if(reservation.blocked)return;
    await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,jobKey,c.fingerprint,202,JSON.stringify({state:'running',orgId:actor.org_id,studentId:c.row.id,reservationId:reservation.id,startedAt:now(),providerKind:provider().kind,externalCalls:live()}));
    await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,'ai-budget-'+randomUUID(),nutritionHash('nutrition-reservation'),202,JSON.stringify({budgetMode:'monthly-per-student',purpose:'nutrition-proposals',monthlyReservationId:reservation.id,studentId:c.row.id,reservedUSD:cost,createdAt:now(),model:provider().model,promptVersion:NUTRITION_PROPOSAL_PROMPT_VERSION,inputTokenUpperBound:upper,maxOutputTokens:PROPOSAL_MAX_OUTPUT_TOKENS,externalCalls:live()}));
    await session(actor,auth);
   });
   if(reservation.blocked){await budget.recordBlocked(actor,reservation);deny(503,'Verba compartilhada insuficiente. Nenhuma proposta substituta.');}
   const controller=new AbortController();const timeoutMs=Number.isSafeInteger(configuration.timeoutMs)&&configuration.timeoutMs>0&&configuration.timeoutMs<=20000?configuration.timeoutMs:20000;let timer;
   try{
    // Fresh check immediately before invoking provider, after durable reservation commit.
    await reference(actor,c.row.id,c.fingerprint);await session(actor,auth);
    const output=await Promise.race([provider().generate(input,{signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Nutrition generation timeout'));},timeoutMs);timer.unref?.();})]);
    await session(actor,auth);const fresh=await reference(actor,c.row.id,c.fingerprint),content=await validated(output,fresh);
    const id=randomUUID(),expiresAt=now()+1200000,p={...(c.references?{referenceRetrieval:c.references.provenance}:{}),id,actorId:actor.id,orgId:actor.org_id,studentId:c.row.id,authHash:auth.hash,contextFingerprint:c.fingerprint,runtimeStamp:initialStamp,expiresAt,payload:output,content,reservationId:reservation.id,model:provider().model,providerKind:provider().kind,externalCalls:live(),contextRevision:c.context.revision,consentRevision:c.consent.revision,anamnesisRevision:c.intake.revision,credentialRevision:c.credential.revision,catalogHash:c.context.catalogHash,contextHash:nutritionHash(c.context),inputHash:nutritionHash(input),promptVersion:NUTRITION_PROPOSAL_PROMPT_VERSION,schemaVersion:'SIM_NUTRITION_CONTEXT_V1'};
    p.hash=nutritionHash(p);
    await store.transaction(async()=>{await store.lockActor(actor.id);await store.lockStudent(c.row.id);await session(actor,auth);await reference(actor,c.row.id,c.fingerprint);await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,'nutrition-external-proposal-'+id,p.hash,200,JSON.stringify(p));await store.run('UPDATE operations SET result=? WHERE actor_id=? AND operation_key=?',JSON.stringify({state:'prepared',orgId:actor.org_id,studentId:c.row.id,proposalId:id,reservationId:reservation.id,finishedAt:now(),externalCalls:live()}),actor.id,jobKey);await audit(actor,c.row.id,'nutrition.proposal.prepared:'+id);});
    return {status:200,data:{proposal:{id,hash:p.hash,payload:output,expiresAt,contextRevision:p.contextRevision,consentRevision:p.consentRevision,providerKind:p.providerKind,externalCalls:p.externalCalls,totals:assertNutritionContextContent(content,c.context,deny)},reservedUSD:cost,draftCreated:false}};
   }catch(error){await store.run('UPDATE operations SET result=? WHERE actor_id=? AND operation_key=?',JSON.stringify({state:'failed',orgId:actor.org_id,studentId:c.row.id,reservationId:reservation.id,finishedAt:now(),diagnostic:proposalFailureDiagnostic(error),externalCalls:live()}),actor.id,jobKey);throw error.status&&error.status!==400?error:Object.assign(Error('Provider nutricional não concluiu; reserva preservada, sem repetição.'),{safe:true,status:502});}finally{clearTimeout(timer);}
  }
  exact(body,['proposalId','proposalHash','payload','confirmed']);if(body.confirmed!==true)deny(400,'Confirme a criação apenas do rascunho.');
  const saved=await store.get('SELECT result FROM operations WHERE actor_id=? AND operation_key=?',actor.id,'nutrition-external-proposal-'+body.proposalId),p=saved?JSON.parse(saved.result):null;
  if(!p||p.studentId!==m[1]||p.orgId!==actor.org_id||p.authHash!==auth.hash||p.hash!==body.proposalHash||p.runtimeStamp!==initialStamp||p.expiresAt<=now())deny(409,'Proposta ausente, expirada ou de outra sessão/contexto.');
  return mutation(actor,req,body,async()=>{await store.lockStudent(p.studentId);if(p.expiresAt<=now())deny(409,'Proposta expirou enquanto aguardava confirmação.');await session(actor,auth);const c=await reference(actor,p.studentId,p.contextFingerprint);if(await store.get('SELECT operation_key FROM operations WHERE actor_id=? AND operation_key=?',actor.id,'nutrition-proposal-confirmed-'+p.id))deny(409,'Proposta já confirmada com outra operação.');
   const content=await validated(body.payload,c),id=randomUUID();content.proposalSource={mode:'external-reviewed',reviewRequired:true,proposalId:p.id,contextFingerprint:p.contextFingerprint,runtimeStamp:initialStamp,providerKind:p.providerKind,externalCalls:p.externalCalls,model:p.model,reservationId:p.reservationId,promptVersion:p.promptVersion,schemaVersion:p.schemaVersion,contextRevision:p.contextRevision,contextHash:p.contextHash,catalogHash:p.catalogHash,inputHash:p.inputHash,credentialRevision:p.credentialRevision,consentRevision:p.consentRevision,anamnesisRevision:p.anamnesisRevision,preparedBy:actor.id,confirmedBy:actor.id,budgetAccounting:'shared-installation-student-ledger',sources:c.context.sources,...(c.references?{referenceRetrieval:c.references.provenance}:{})};
   await store.run('INSERT INTO nutrition_plans(id,org_id,student_id,author_id,title,content,status,created_at) VALUES (?,?,?,?,?,?,?,?)',id,actor.org_id,p.studentId,actor.id,text(body.payload.title,2,100),JSON.stringify(content),'draft',now());await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,'nutrition-proposal-confirmed-'+p.id,nutritionHash('nutrition-confirmation'),201,JSON.stringify({planId:id,proposalId:p.id}));await audit(actor,p.studentId,'nutrition.proposal.draft-confirmed:'+p.id);return {status:201,data:{plan:await nutrition.planDTO(await store.get('SELECT * FROM nutrition_plans WHERE id=?',id),actor),externalCalls:live()}};
  });
 }};
}
