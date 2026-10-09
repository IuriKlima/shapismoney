import {INTAKE_VERSION} from '../public/sim/intake-fields.js';
import {randomUUID,createHash} from 'node:crypto';
import {normalizeAllergens,nutritionScaled,NUTRIENT_KEYS} from './nutrition-validation.mjs';
export const NUTRITION_EXTERNAL_PURPOSE='SIM_NUTRITION_PROPOSAL_EXTERNAL_V1';
export const NUTRITION_EVIDENCE_FIELDS=Object.freeze(['targets','tolerances','allergies','preferences','meals']);
export const nutritionHash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function nutritionContextFlow({store,now,deny,exact,text,read,mutation,student,audit,nutrition,assertNutritionAccess,enabled}){
 const marker=type=>'nutrition-'+type+'-v1';
 async function records(type,row){return (await store.all('SELECT actor_id,result FROM operations WHERE request_hash=?',marker(type))).map(r=>({...JSON.parse(r.result),actorId:r.actor_id})).filter(r=>r.orgId===row.org_id&&r.studentId===row.id).sort((a,b)=>b.revision-a.revision);}
 const latest=async(type,row)=>(await records(type,row))[0]||null;
 async function consent(row){return (await records('external-consent',row)).find(r=>r.actorId===row.user_id)||{revision:0,enabled:false};}
 async function append(actor,type,row,value){await store.run('INSERT INTO operations VALUES (?,?,?,?,?)',actor.id,'nutrition-record-'+randomUUID(),marker(type),200,JSON.stringify({...value,orgId:row.org_id,studentId:row.id,createdAt:now()}));}
 async function intake(row){const a=await store.get('SELECT revision,status,version FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id);if(!a||a.status!=='complete'||a.version!==INTAKE_VERSION)deny(409,'Conclua a anamnese. O nutricionista fornece seu contexto separado, sem acesso ampliado às respostas.');return a;}
 async function valid(actor,id,{requireConsent=false,requireTransfer=false}={}){
  const row=await nutrition.manager(actor,id),accessState=await assertNutritionAccess(row),credential=await nutrition.qualified(actor),a=await intake(row),context=await latest('context',row);
  if(!context||context.actorId!==actor.id||context.credentialRevision!==credential.revision||context.anamnesisRevision!==a.revision||context.intakeVersion!==a.version||context.studentRevision!==row.revision||context.reviewed!==true)deny(409,'Contexto profissional, habilitação ou revisão mudou.');
  const catalog=[];for(const id of context.catalogIds)catalog.push(await nutrition.food(actor,id));
  if(nutritionHash(catalog.map(c=>({id:c.id,name:c.name,authorId:c.author_id,revision:c.revision,preparation:c.preparation,composition:c.composition,allergens:c.allergens,mayContain:c.may_contain,provenance:c.provenance,approvedBy:c.approved_by})))!==context.catalogHash)deny(409,'Catálogo mudou. Revise o contexto.');
  if(requireTransfer&&(!context.transferApproved||context.rules.some(r=>r.providerTransferApproved!==true)))deny(409,'Autorize explicitamente a transferência das regras revisadas.');
  const choice=await consent(row);
  if(requireConsent&&(!choice.enabled||choice.contextRevision!==context.revision||choice.anamnesisRevision!==a.revision||choice.purpose!==NUTRITION_EXTERNAL_PURPOSE))deny(409,'O aluno precisa escolher a finalidade nutricional externa atual.');
  return {row,credential,intake:a,context,catalog,consent:choice,fingerprint:nutritionHash({actor:actor.id,org:actor.org_id,student:row.id,studentRevision:row.revision,access:{sequence:accessState.sequence,level:accessState.level,expiresAt:accessState.expiresAt,active:accessState.active,features:accessState.features},nutrition:row.nutrition_id,user:row.user_id,credentialRevision:credential.revision,context,consent:choice,intake:a,catalogHash:context.catalogHash})};
 }
 async function validateContext(actor,row,body){
  exact(body,['revision','anamnesisRevision','reviewed','targets','tolerances','allergies','preferences','meals','catalogIds','rules','sources','transferApproved']);
  if(!Number.isSafeInteger(body.revision)||body.revision<0||body.reviewed!==true||typeof body.transferApproved!=='boolean')deny(400,'Confirme a revisão nutricional.');
  exact(body.targets,NUTRIENT_KEYS);exact(body.tolerances,NUTRIENT_KEYS);
  const targets={},tolerances={};for(const k of NUTRIENT_KEYS){const max=k==='energyKcal'?10000:1000;targets[k]=nutritionScaled(body.targets[k],max,100,deny)/100;tolerances[k]=nutritionScaled(body.tolerances[k],max,100,deny)/100;if(targets[k]<=0||tolerances[k]>targets[k])deny(400,'Metas positivas e tolerâncias absolutas precisam de revisão profissional.');}
  const allergies=normalizeAllergens(body.allergies,deny);
  if(!Array.isArray(body.catalogIds)||body.catalogIds.length<1||body.catalogIds.length>40||new Set(body.catalogIds).size!==body.catalogIds.length)deny(400,'Selecione 1-40 alimentos aprovados.');
  const catalog=[];for(const id of body.catalogIds)catalog.push(await nutrition.food(actor,id));
  exact(body.preferences,['preferredFoodIds','excludedFoodIds']);for(const ids of Object.values(body.preferences)){if(!Array.isArray(ids)||ids.length>40||new Set(ids).size!==ids.length||ids.some(id=>!body.catalogIds.includes(id)))deny(400,'Preferências precisam de alimentos exatos do contexto.');}
  if(body.preferences.preferredFoodIds.some(id=>body.preferences.excludedFoodIds.includes(id)))deny(400,'Preferências conflitantes.');
  if(!Array.isArray(body.meals)||body.meals.length<1||body.meals.length>6)deny(400,'Defina 1-6 refeições.');
  const meals=body.meals.map(m=>{exact(m,['name','itemCount']);if(!Number.isInteger(m.itemCount)||m.itemCount<1||m.itemCount>6)deny(400,'Estrutura de refeição inválida.');return {name:text(m.name,2,80),itemCount:m.itemCount};});if(new Set(meals.map(m=>m.name)).size!==meals.length)deny(400,'Refeições precisam de nomes únicos.');
  if(!Array.isArray(body.sources)||body.sources.length<1||body.sources.length>10||!Array.isArray(body.rules)||body.rules.length<1||body.rules.length>15)deny(400,'Declare regras e fontes revisadas.');
  const sources=body.sources.map(s=>{exact(s,['id','reference','version','sha256']);if(!/^[a-f0-9]{64}$/.test(s.sha256))deny(400,'Confira hash e versão da fonte.');return {id:text(s.id,2,80),reference:text(s.reference,3,300),version:text(s.version,1,80),sha256:s.sha256};});
  const rules=body.rules.map(r=>{exact(r,['id','sourceId','section','text','providerTransferApproved']);if(!sources.some(s=>s.id===r.sourceId)||typeof r.providerTransferApproved!=='boolean')deny(400,'Regra precisa de fonte e decisão de transferência.');return {id:text(r.id,2,80),sourceId:r.sourceId,section:text(r.section,1,120),text:text(r.text,8,500),providerTransferApproved:r.providerTransferApproved};});
  if(new Set(sources.map(s=>s.id)).size!==sources.length||new Set(rules.map(r=>r.id)).size!==rules.length)deny(400,'IDs de referências precisam ser únicos.');
  const credential=await nutrition.qualified(actor),a=await intake(row);if(body.anamnesisRevision!==a.revision)deny(409,'Revisão da anamnese mudou.');
  const catalogHash=nutritionHash(catalog.map(c=>({id:c.id,name:c.name,authorId:c.author_id,revision:c.revision,preparation:c.preparation,composition:c.composition,allergens:c.allergens,mayContain:c.may_contain,provenance:c.provenance,approvedBy:c.approved_by})));
  return {revision:body.revision+1,version:'nutrition-context-v'+(body.revision+1),anamnesisRevision:a.revision,intakeVersion:a.version,credentialRevision:credential.revision,studentRevision:row.revision,targets,tolerances,allergies,preferences:body.preferences,meals,catalogIds:body.catalogIds,catalogHash,rules,sources,reviewed:true,transferApproved:body.transferApproved};
 }
 return {valid,consent,latest,async handle(actor,req,route){
  const m=/^\/api\/local\/students\/([a-f0-9-]{36})\/nutrition\/(context|external-consent)$/.exec(route);if(!m)return null;
  if(!['nutrition','student'].includes(actor.role))deny(403,'Contexto nutricional restrito ao responsável e aluno.');
  const row=await student(actor,m[1]);
  if(m[2]==='context'){
   if(actor.role!=='nutrition')deny(403,'Contexto exige nutricionista habilitado vinculado.');await nutrition.manager(actor,row.id);
   if(req.method==='GET'){const a=await store.get('SELECT revision,status FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id);return {status:200,data:{context:await latest('context',row),anamnesisRevision:a?.revision||0,anamnesisComplete:a?.status==='complete'}};}
   if(req.method!=='PUT')deny(405,'Use edição explícita.');const body=await read(req);
   return mutation(actor,req,body,async()=>{await store.lockStudent(row.id);const current=await nutrition.manager(actor,row.id),old=await latest('context',current);if(body.revision!==(old?.revision||0))deny(409,'Contexto mudou.');const context=await validateContext(actor,current,body);await append(actor,'context',current,context);await audit(actor,row.id,'nutrition.context.reviewed:'+context.revision);return {status:200,data:{context}};});
  }
  const c=await consent(row),context=await latest('context',row),a=await store.get('SELECT revision,status FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id);
  if(req.method==='GET')return {status:200,data:{consent:{purpose:NUTRITION_EXTERNAL_PURPOSE,revision:c.revision,enabled:c.enabled===true&&context?.revision===c.contextRevision&&a?.revision===c.anamnesisRevision&&enabled(),contextRevision:context?.revision||0,anamnesisRevision:a?.revision||0},providerFields:NUTRITION_EVIDENCE_FIELDS,description:'Transferência opcional à OpenAI de metas, tolerâncias, alergias, preferências e estrutura fornecidas pelo nutricionista, catálogo e regras aprovadas; sem respostas ampliadas da anamnese.'}};
  if(req.method!=='PUT'||actor.role!=='student'||row.user_id!==actor.id)deny(403,'Esta escolha pertence ao aluno.');
  const body=await read(req);exact(body,['purpose','revision','contextRevision','anamnesisRevision','enabled','confirmed']);if(body.purpose!==NUTRITION_EXTERNAL_PURPOSE||typeof body.enabled!=='boolean'||body.confirmed!==true)deny(400,'Confirme a finalidade nutricional externa.');
  return mutation(actor,req,body,async()=>{await store.lockStudent(row.id);const current=await student(actor,row.id),choice=await consent(current),ctx=await latest('context',current),a=await store.get('SELECT revision,status FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id);if(choice.revision!==body.revision||body.contextRevision!==(ctx?.revision||0)||body.anamnesisRevision!==(a?.revision||0))deny(409,'Contexto ou escolha mudou.');
   if(body.enabled){if(!enabled())deny(503,'Geração nutricional externa desativada.');const n=await store.get("SELECT * FROM users WHERE id=? AND org_id=? AND role='nutrition' AND active=1",current.nutrition_id,current.org_id);if(!n)deny(409,'Responsável indisponível.');await valid(n,current.id,{requireTransfer:true});}
   const value={revision:choice.revision+1,purpose:NUTRITION_EXTERNAL_PURPOSE,enabled:body.enabled,contextRevision:body.contextRevision,anamnesisRevision:body.anamnesisRevision};await append(actor,'external-consent',current,value);await audit(actor,row.id,'nutrition.external-consent.'+(body.enabled?'granted':'withdrawn'));return {status:200,data:{consent:value}};});
 }};
}
