// Original Google Form checked read-only 2026-10-08: 28 questions, 26 required.
export const INTAKE_VERSION='BRUNO_FORM_V1';
export const CONSENT_VERSION='SIM_INTAKE_PURPOSES_V2';
export const PROFESSIONAL_CONSENT_VERSION='SIM_INTAKE_PURPOSES_V1';
export const INTAKE_SOURCE='https://docs.google.com/forms/d/e/1FAIpQLSeDEB5JBxVCqJTPgeFLuB0BC0lBXfjqU2r9CnJlG8oAtQTdRw/viewform';
export const INTAKE_FIELDS=[
 {
  "key": "full_name",
  "label": "Nome completo:",
  "kind": "text",
  "required": true,
  "maxLength": 150
 },
 {
  "key": "whatsapp",
  "label": "Qual o número do WhatsApp (ddd + número)",
  "kind": "text",
  "required": true,
  "maxLength": 150
 },
 {
  "key": "instagram",
  "label": "Qual seu usuário no instagram?",
  "kind": "text",
  "required": true,
  "maxLength": 150
 },
 {
  "key": "profession",
  "label": "Profissão:",
  "kind": "text",
  "required": true,
  "maxLength": 150
 },
 {
  "key": "age",
  "label": "Idade (anos)",
  "kind": "number",
  "required": true,
  "maxLength": 2000,
  "min": 1,
  "max": 130,
  "integer": true
 },
 {
  "key": "weight_kg",
  "label": "Peso (kilos)",
  "kind": "number",
  "required": false,
  "maxLength": 2000,
  "min": 1,
  "max": 500
 },
 {
  "key": "height_m",
  "label": "Altura (metros)",
  "kind": "number",
  "required": true,
  "maxLength": 2000,
  "min": 0.3,
  "max": 3
 },
 {
  "key": "training_history",
  "label": "Há quanto tempo você treina?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "environment",
  "label": "Você vai treinar:",
  "kind": "multiple",
  "required": true,
  "maxLength": 2000,
  "options": [
   "Na academia",
   "Na academia do prédio (mande fotos dos equipamentos no grupo da equipe)",
   "Em casa (se tiver, mande fotos dos material no grupo da equipe)"
  ]
 },
 {
  "key": "main_goal",
  "label": "Qual seu maior objetivo?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "goals",
  "label": "Quais os seus objetivos a curto, médio e longo prazo?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "motivation",
  "label": "Por qual motivo começou a treinar?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "importance",
  "label": "Qual a importância para você em atingir o seu objetivo?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "willingness",
  "label": "Até onde está disposto a ir para alcançar seu objetivo?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "trust",
  "label": "Quanto confia no seu treinador para chegar lá?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "current_training",
  "label": "Treino atual: (Se você já treina, é de suma importância que nos informe para sabermos o que já esta acostumado(a), qual é o seu ritmo atual - pode encaminhar depois no grupo, mas não se esqueça de nos informar)",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "difficult_exercises",
  "label": "Dificuldades em exercícios:",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "liked_exercises",
  "label": "Exercícios prediletos:",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "injuries",
  "label": "Tem alguma lesão? Qual (quais)?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "fractures",
  "label": "Já teve alguma fratura? Qual (quais)?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "days",
  "label": "Quantas vezes por semana você pode treinar? Seja realista.",
  "kind": "number",
  "required": true,
  "maxLength": 2000,
  "min": 1,
  "max": 7,
  "integer": true
 },
 {
  "key": "schedule",
  "label": "Em qual horário você pretende treinar?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "aerobic",
  "label": "Você pode fazer exercício aeróbico? Se sim, em quais horários e quantas vezes na semana?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "restrictions",
  "label": "Tem alguma dificuldade ou restrição treinando?",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "daily_routine",
  "label": "Conte-me sobre sua rotina diária (tudo o que você faz ao longo do dia)",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "current_diet",
  "label": "Conte-me sobre sua dieta atual",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "personal_context",
  "label": "Esse é o espaço que você vai me contar tudo a seu respeito.",
  "kind": "text",
  "required": true,
  "maxLength": 2000
 },
 {
  "key": "letter",
  "label": "Aqui queremos que você escreva uma carta para você mesmo respondendo as seguintes perguntas: 1) O que costuma fazer você desistir de permanecer na academia? 2) O que não vai te fazer desistir desta vez?",
  "kind": "text",
  "required": false,
  "maxLength": 2000
 }
];

export function validateIntake(input,{complete=false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Respostas inválidas.');
 if(Object.keys(input).some(k=>!INTAKE_FIELDS.some(f=>f.key===k)))throw Error('Campo desconhecido.');
 const answers={};for(const f of INTAKE_FIELDS){const v=input[f.key];if(v===undefined||v===''||v===null){if(complete&&f.required)throw Error('Preencha: '+f.label);continue;}if(f.kind==='multiple'){if(!Array.isArray(v)||!v.length||v.length>f.options.length||new Set(v).size!==v.length||v.some(x=>!f.options.includes(x)))throw Error('Ambiente inválido.');answers[f.key]=v;continue;}if(f.kind==='number'){if(typeof v!=='number'||!Number.isFinite(v)||v<f.min||v>f.max||f.integer&&!Number.isInteger(v))throw Error('Valor inválido: '+f.label);answers[f.key]=v;continue;}if(typeof v!=='string'||!v.trim()||v.length>f.maxLength)throw Error('Resposta inválida: '+f.label);answers[f.key]=v.trim();}
 if(new TextEncoder().encode(JSON.stringify(answers)).length>14000)throw Error('Respostas excedem o limite total de 14 KB. Resuma os relatos.');
 return answers;
}
export const attentionReview=answers=>['injuries','fractures','restrictions'].some(key=>!!answers[key]&&!['não','nao','nenhum','nenhuma','não tenho','nao tenho','sem restrições','sem restricoes'].includes(answers[key].trim().toLowerCase()));
