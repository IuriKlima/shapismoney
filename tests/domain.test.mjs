import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlines, planStatus, applyAction, createState } from '../lib/domain.ts';

test('prazo público pula fim de semana e entrega prevista é após 48 horas', () => {
  const d = deadlines('2026-10-02T12:00:00.000Z');
  assert.equal(d.readyAt, '2026-10-04T12:00:00.000Z');
  assert.equal(d.deadlineAt, '2026-10-07T12:00:00.000Z');
});
test('prazo passado não libera plano sem aprovação do personal', () => {
  assert.equal(planStatus({submittedAt:'2026-09-01T12:00:00Z',planApproved:false}, new Date('2026-10-04')), 'pending');
});
test('check-in repetido não multiplica pontos', () => {
  const s = createState();
  applyAction(s, {type:'checkin',role:'student',studentId:'marina',workout:'a'});
  const count = s.students[0].checkins.length;
  assert.throws(() => applyAction(s, {type:'checkin',role:'student',studentId:'marina',workout:'a'}), /registrado/);
  assert.equal(s.students[0].checkins.length, count);
});
test('visão de aluno não pode editar plano', () => {
  assert.throws(() => applyAction(createState(), {type:'plan',role:'student',studentId:'marina',plan:[]}), /personal/);
});
test('post vazio e medidas inválidas são rejeitados', () => {
  assert.throws(() => applyAction(createState(), {type:'post',role:'student',text:'   '}), /Escreva/);
  assert.throws(() => applyAction(createState(), {type:'measure',role:'student',weight:-2}), /peso/);
});

test('IA demonstrativa libera o plano apenas após 48 horas',()=>{const s={submittedAt:'2026-10-02T12:00:00Z',planApproved:true};assert.equal(planStatus(s,new Date('2026-10-04T11:59:59Z')),'pending');assert.equal(planStatus(s,new Date('2026-10-04T12:00:00Z')),'ready');});
test('antecipação da demonstração exige a visão de personal',()=>{const s=createState();assert.throws(()=>applyAction(s,{type:'releaseDemo',role:'student'}),/personal/);applyAction(s,{type:'releaseDemo',role:'personal',studentId:'juliana'});assert.equal(planStatus(s.students.find(x=>x.id==='juliana')),'ready');});
test('anamnese prepara exemplo sem cobrar e sem liberar antes do prazo',()=>{const s=createState();applyAction(s,{type:'checkout',name:'Pessoa Teste',email:'nova@exemplo.com'});applyAction(s,{type:'assessment',answers:{age:'28',height:'170',weight:'70',days:'3',goal:'Condicionamento',experience:'Iniciante',restrictions:'Nenhuma'},consent:true});const student=s.students.find(x=>x.id===s.currentStudentId);assert.equal(planStatus(student),'pending');assert.ok(student.plan.length>0);assert.equal(student.measurements[0].weight,70);});
test('apenas autor e personal podem excluir publicação',()=>{const s=createState();assert.throws(()=>applyAction(s,{type:'deletePost',role:'student',postId:'first'}),/excluir/);applyAction(s,{type:'deletePost',role:'personal',postId:'first'});assert.ok(!s.posts.some(p=>p.id==='first'));});
