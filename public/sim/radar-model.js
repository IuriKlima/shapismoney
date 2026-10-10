// Versioned self-report model. Source: supplied reputation-form.zip, sim-score.ts/onboarding.tsx.
export const RADAR_VERSION = 'SIM_RADAR_SELF_REPORT_V1';
export const RADAR_CONSENT = 'SIM_RADAR_NECESSARY_V1';
export const AXES = [
  {id:'construction',label:'Construção',description:'Forma e força',tip:'Combine uma frequência sustentável com acompanhamento da sua evolução.'},
  {id:'capacity',label:'Capacidade',description:'Energia disponível',tip:'Observe sono e recuperação. Se houver dor ou desconforto, procure orientação profissional antes de intensificar o treino.'},
  {id:'governance',label:'Governo',description:'Domínio da rotina',tip:'Reserve horários realistas para treino, descanso e refeições; comece pelo que cabe na sua agenda.'},
  {id:'perception',label:'Percepção',description:'Presença percebida',tip:'Reflita sobre os ambientes em que se sente confortável. Sua aparência não determina seu valor ou competência.'},
  {id:'execution',label:'Execução',description:'Evidência acumulada',tip:'Escolha um compromisso sustentável e registre sua execução, respeitando seus limites.'},
];
export const QUESTIONS = [
 ['construction_1','Quanto seu físico atual representa o físico que você deseja construir?','Ainda não representa','Representa plenamente'],
 ['construction_2','Como você avalia sua evolução física nos últimos meses?','Sem evolução','Evolução consistente'],
 ['construction_3','Qual é seu nível atual de consistência com treinamento?','Muito baixo','Muito alto'],
 ['capacity_1','Como você avalia a qualidade do seu sono?','Muito baixa','Excelente'],
 ['capacity_2','Como você avalia sua energia durante o horário de trabalho?','Muito baixa','Excelente'],
 ['capacity_3','Quanto dores ou desconfortos corporais interferem na sua rotina?','Não interferem','Interferem muito'],
 ['governance_1','Quanto controle você sente que possui sobre sua própria agenda?','Pouco controle','Controle completo'],
 ['governance_2','Quão consistente é sua rotina de alimentação e hidratação?','Inconsistente','Muito consistente'],
 ['governance_3','Com que frequência você cumpre os compromissos que estabelece consigo mesmo?','Raramente','Sempre'],
 ['perception_1','Quanto sua postura transmite a confiança que você deseja comunicar?','Pouco','Plenamente'],
 ['perception_2','Quanto sua imagem atual representa o nível profissional que você alcançou?','Pouco','Plenamente'],
 ['perception_3','Quão confiante você se sente ao entrar em ambientes importantes?','Pouco confiante','Muito confiante'],
 ['execution_1','Quanto daquilo que você planeja você realmente executa?','Muito pouco','Quase tudo'],
 ['execution_2','Qual sua capacidade de agir mesmo quando não está motivado?','Muito baixa','Muito alta'],
 ['execution_3','Como você avalia sua consistência nos últimos 30 dias?','Muito baixa','Muito alta'],
].map(([id,title,low,high])=>({id,title,low,high,axis:id.split('_')[0]}));
export function radarResult(answers){
  if(!answers||Object.keys(answers).sort().join()!==QUESTIONS.map(q=>q.id).sort().join()||QUESTIONS.some(q=>!Number.isInteger(answers[q.id])||answers[q.id]<1||answers[q.id]>5))throw Error('Responda as 15 perguntas com valores de 1 a 5.');
  const axes=AXES.map(a=>({...a,value:Math.round(QUESTIONS.filter(q=>q.axis===a.id).reduce((sum,q)=>sum+((q.id==='capacity_3'?6-answers[q.id]:answers[q.id])-1)*25,0)/3)}));
  const low=Math.min(...axes.map(a=>a.value)),high=Math.max(...axes.map(a=>a.value));
  return {version:RADAR_VERSION,axes,total:Math.round(axes.reduce((n,a)=>n+a.value,0)/5),priorities:axes.filter(a=>a.value===low),strengths:axes.filter(a=>a.value===high),discomfort:answers.capacity_3>=4};
}
