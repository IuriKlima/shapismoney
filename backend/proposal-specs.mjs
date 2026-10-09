import {INTAKE_VERSION,CONSENT_VERSION,validateIntake} from '../public/sim/intake-fields.js';
export const TRAINING_INPUT_FIELDS=Object.freeze(['age','height_m','weight_kg','main_goal','training_history','current_training','environment','days','schedule','liked_exercises','difficult_exercises','injuries','fractures','restrictions']);
export function proposalSpecs({store,deny,exact,text,student,safety,configuration={}}){
 const mode=()=>configuration.mode||'local-simulation';
 const method=kind=>configuration.methodologies?.[kind]||configuration.methodology;
 async function intakeFor(row){const a=await store.get('SELECT * FROM anamneses WHERE student_id=? AND org_id=?',row.id,row.org_id);if(!a?.training_consent||a.version!==INTAKE_VERSION||a.status!=='complete'||a.reviewed_revision!==a.revision)deny(409,'Conclua e revise a anamnese atual antes de preparar uma proposta.');let answers;try{answers=validateIntake(JSON.parse(a.answers),{complete:true});}catch{deny(409,'Respostas atuais incompletas ou inválidas.');}const c=await safety.consent(row,{kind:'training',mode:mode()});return {a,answers,c};}
 async function trainingCurrent(actor,id){const row=await student(actor,id),reviewer=await store.get("SELECT id FROM users WHERE id=? AND org_id=? AND role='coach' AND active=1",row.coach_id,row.org_id);
  if(!reviewer||!(actor.role==='coach'&&actor.id===row.coach_id||actor.role==='admin'))deny(403,'Proposta exige personal vinculado ativo ou supervisão administrativa autorizada.');
  const {a,answers,c}=await intakeFor(row);if(a.reviewed_by!==reviewer.id)deny(409,'Revisão exige o personal atualmente vinculado.');if(actor.role==='admin'&&a.consent_version!==CONSENT_VERSION)deny(403,'Supervisão administrativa da anamnese não autorizada.');if(c.enabled!==true||c.anamnesisRevision!==a.revision)deny(409,'O aluno precisa escolher a finalidade específica desta proposta.');
  const risk=await safety.risk(row,a);if(mode()==='external-reviewed'&&risk.required&&!risk.resolved)deny(409,'Resolva o sinal com decisão profissional antes de geração externa.');
  return {row,intake:a,consent:c,risk,facts:Object.fromEntries(TRAINING_INPUT_FIELDS.filter(k=>k in answers).map(k=>[k,answers[k]])),references:{studentRevision:row.revision,coach:row.coach_id,user:row.user_id,intakeRevision:a.revision,reviewer:a.reviewed_by,consentSequence:c.sequence,riskSequence:risk.sequence||0,riskResolved:risk.resolved}};
 }
 function trainingValidate(payload,c){
  // Diagnostics contain trusted field paths/rule codes only, never submitted values.
  const reject=(status,message,field,rule)=>{try{deny(status,message);}catch(error){error.validationDiagnostic={stage:'prescription',field,rule};throw error;}throw Error('Validator deny must throw');};
  const shape=(value,keys,field)=>{try{exact(value,keys);}catch{reject(400,'Campos inválidos.',field,'object-fields');}};
  const label=(value,min,max,field)=>{try{return text(value,min,max);}catch{reject(400,'Texto inválido.',field,'string-length-or-control');}};
  const methodology=method('training');
  if(!methodology||!Array.isArray(methodology.exercises)||!Array.isArray(methodology.rules))reject(503,'Metodologia indisponível para validação.','$.configuration.methodology','methodology-required');
  if(!c?.facts||!Number.isInteger(c.facts.days)||c.facts.days<1||c.facts.days>7||!Array.isArray(c.facts.environment))reject(400,'Contexto indisponível para validação.','$.facts','context-required');
  const canonical=Object.hasOwn(payload||{},'sessions');shape(payload,canonical?['title','daysPerWeek','sessions']:['title','daysPerWeek','exercises'],'$');label(payload.title,2,100,'$.title');
  if(!canonical&&mode()!=='local-simulation')reject(400,'Proposta externa exige sessões completas.','$.sessions','complete-sessions-required');
  if(!Number.isInteger(payload.daysPerWeek)||payload.daysPerWeek<1||payload.daysPerWeek>c.facts.days)reject(400,'Frequência deve respeitar os dias disponíveis informados.','$.daysPerWeek','available-days');
  const sessions=canonical?payload.sessions:[{id:'session-1',name:'Sessão de teste',weekday:1,exercises:payload.exercises}];
  if(!Array.isArray(sessions)||sessions.length<1||sessions.length>7||canonical&&sessions.length!==payload.daysPerWeek)reject(400,'Cada dia prescrito exige uma sessão única.','$.sessions','session-count');
  const ids=new Set(),weekdays=new Set();
  const output=sessions.map((s,i)=>{const field='$.sessions['+i+']';if(canonical)shape(s,['id','name','weekday','exercises'],field);
   if(typeof s.id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(s.id))reject(400,'Sessão ou dia semanal inválido.',field+'.id','session-id');
   if(ids.has(s.id))reject(400,'Cada dia prescrito exige uma sessão única.',field+'.id','unique-session-id');ids.add(s.id);
   if(!Number.isInteger(s.weekday)||s.weekday<1||s.weekday>7)reject(400,'Sessão ou dia semanal inválido.',field+'.weekday','weekday-range');
   if(weekdays.has(s.weekday))reject(400,'Cada dia prescrito exige uma sessão única.',field+'.weekday','unique-weekday');weekdays.add(s.weekday);label(s.name,2,100,field+'.name');
   if(!Array.isArray(s.exercises)||s.exercises.length<1||s.exercises.length>12)reject(400,'Use 1-12 exercícios por sessão.',field+'.exercises','exercise-count');
   const exercises=s.exercises.map((e,j)=>{const ef=field+'.exercises['+j+']';shape(e,['exerciseId','sets','reps','restSeconds','rir','reason','evidence','ruleId',...(canonical?['alternatives']:[])],ef);
    const item=methodology.exercises.find(x=>x?.id===e.exerciseId&&x.status==='approved');
    if(!item||!Array.isArray(item.environments)||!item.environments.some(v=>c.facts.environment.includes(v)))reject(400,'Exercício não aprovado ou incompatível com o ambiente informado.',ef+'.exerciseId','approved-context-exercise');
    for(const [key,min,max] of [['sets',1,10],['reps',1,50],['restSeconds',0,600],['rir',0,10]])if(!Number.isInteger(e[key])||e[key]<min||e[key]>max)reject(400,'Parâmetros de exercício inválidos.',ef+'.'+key,'dose-range');
    if(!Array.isArray(e.evidence)||e.evidence.length<1||e.evidence.length>5||e.evidence.some(k=>typeof k!=='string'||!Object.hasOwn(c.facts,k)))reject(400,'Justifique cada exercício com evidências e referência disponíveis.',ef+'.evidence','fact-evidence');
    const rule=methodology.rules.find(r=>r?.id===e.ruleId);if(!rule)reject(400,'Justifique cada exercício com evidências e referência disponíveis.',ef+'.ruleId','method-rule');
    const source=methodology.sources?.find(s=>s?.id===rule.sourceId);if(canonical&&(!source||! /^[a-f0-9]{64}$/.test(source.sha256)||!source.version||!rule.section))reject(400,'Source provenance unavailable',ef+'.ruleId','source-provenance');
    const reference=source?{ruleId:rule.id,sourceId:source.id,sourceVersion:source.version,sourceSha256:source.sha256,section:rule.section}:undefined;
    let alternatives;if(canonical){if(!Array.isArray(e.alternatives)||e.alternatives.length>4)reject(400,'Alternatives require distinct catalog IDs',ef+'.alternatives','alternative-count');
     const alternativeIds=new Set();alternatives=e.alternatives.map((a,k)=>{const af=ef+'.alternatives['+k+']';shape(a,['exerciseId','reason','evidence','ruleId'],af);
      if(alternativeIds.has(a.exerciseId))reject(400,'Alternatives require distinct catalog IDs',af+'.exerciseId','unique-alternative');alternativeIds.add(a.exerciseId);
      const alternative=methodology.exercises.find(x=>x?.id===a.exerciseId&&x.status==='approved');
      if(!alternative||a.exerciseId===e.exerciseId||!item.allowedAlternativeIds?.includes(a.exerciseId)||!Array.isArray(alternative.environments)||!alternative.environments.some(v=>c.facts.environment.includes(v)))reject(400,'Alternative is not explicitly reviewed for this exercise and context',af+'.exerciseId','approved-context-alternative');
      if(a.ruleId!==e.ruleId)reject(400,'Alternative is not explicitly reviewed for this exercise and context',af+'.ruleId','alternative-rule');
      if(!Array.isArray(a.evidence)||!a.evidence.length||a.evidence.length>5||a.evidence.some(k=>typeof k!=='string'||!Object.hasOwn(c.facts,k)))reject(400,'Alternative is not explicitly reviewed for this exercise and context',af+'.evidence','fact-evidence');
      return {...a,name:label(alternative.name,2,100,af+'.catalogName'),reason:label(a.reason,8,500,af+'.reason'),reference};
     });
    }
    return {...e,name:label(item.name,2,100,ef+'.catalogName'),reason:label(e.reason,8,500,ef+'.reason'),...(reference?{reference}:{}),...(canonical?{alternatives}: {})};
   });return {...s,exercises};
  });return {title:payload.title.trim(),daysPerWeek:payload.daysPerWeek,sessions:output,exercises:output.flatMap(s=>s.exercises),canonical};
 }
 const trainingEditable=v=>{const strip=exercises=>exercises.map(({name,reference,...e})=>{void name;void reference;return {...e,...(e.alternatives?{alternatives:e.alternatives.map(({name,reference,...a})=>{void name;void reference;return a;})}: {})};});return v.canonical?{title:v.title,daysPerWeek:v.daysPerWeek,sessions:v.sessions.map(s=>({...s,exercises:strip(s.exercises)}))}:{title:v.title,daysPerWeek:v.daysPerWeek,exercises:strip(v.exercises)};};
 return {training:{current:trainingCurrent,validate:trainingValidate,editable:trainingEditable}};
}
