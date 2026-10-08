# Propostas personalizadas de treino — bloco local

Este incremento prepara e edita propostas de treino usando exclusivamente um provedor simulado, catálogo fictício e banco isolado de QA. Está desligado por padrão, não é conectado ao chat OpenAI e recusa ativação com segurança de produção. Nenhum cardápio IA foi implementado neste bloco.

## Fluxo entregue

O aluno conclui a anamnese, o personal vinculado ativo registra a revisão, e o próprio aluno escolhe a finalidade opcional `SIM_TRAINING_PROPOSAL_LOCAL_V1` para a revisão atual. Essa escolha não autoriza transferência externa. A finalidade profissional e a finalidade administrativa continuam separadas; administração exige autorização V2 para usar as respostas.

`POST /api/local/students/:id/training-proposals/prepare` recebe revisão, sequência de consentimento e confirmação. O servidor monta o contexto a partir de uma lista explícita: idade/altura/peso quando fornecidos, objetivo, histórico/treino atual, disponibilidade/horário, ambiente, preferências e limitações. Não inclui nome, contatos, dieta, carta pessoal, narrativa livre, notas internas ou dados de outro aluno. Os textos autorizados continuam sendo dados não confiáveis. Nenhuma foto ou diagnóstico integra este contexto.

Cada exercício referencia um ID de catálogo aprovado e compatível com o ambiente, uma justificativa, chaves de evidência disponíveis e ID de regra existente. A frequência não excede a disponibilidade declarada. Limites numéricos são limites técnicos de entrada, não faixas clínicas da metodologia. A saída contém séries, repetições, descanso e RIR; a estrutura atual ainda representa uma única lista de exercícios, não uma divisão completa por sessões.

A proposta fica somente na memória por 20 minutos, ligada ao ator, organização, sessão autenticada, vínculo, revisão, consentimento e versão/hash de configuração. `POST .../training-proposals/confirm` recebe ID/hash, parâmetros editados e confirmação. Revalida o contexto sob bloqueio do aluno e salva apenas `draft`, com referências e autoria. Repetição idempotente não cria cópia; confirmação concorrente com outra chave é rejeitada. Logout/inatividade, retirada de consentimento, revisão ou vínculo alterados invalidam a proposta.

`PUT /api/local/training-proposals/plans/:id` permite editar um rascunho deste fluxo, confere revisão/referências, retira a aprovação e volta a `draft`. Publicados são imutáveis. Os endpoints existentes de revisão/aprovação/publicação continuam separados. Rascunhos de simulação não podem ser aprovados ou publicados em produção.

## Risco e decisão humana

`GET/PUT /api/local/students/:id/training-risk` consulta estado e registra decisão `hold` ou `allow-with-limitations`, com justificativa e confirmação. Somente o personal atualmente vinculado pode resolver um sinal após revisar a anamnese atual. Revisão ou vínculo alterados invalidam a resolução. Administração e aluno não recebem esse poder; justificativas internas não aparecem no GET do aluno/admin.

Treinos manuais e gerados com sinal de atenção não podem ser aprovados ou publicados sem resolução explícita atual. A heurística de lesões/fraturas/restrições já existente continua sendo somente um sinal para revisão, não diagnóstico, triagem completa ou liberação médica. Dor registrada em execução, novas regras clínicas e análise de texto avançada não foram adicionadas. Uma resolução não aprova automaticamente um treino.

## Orçamento, privacidade e implantação

As reservas conservadoras reutilizam as tabelas de orçamento/operation journal existentes, limites globais/por aluno e trava transacional. A tentativa simulada é identificada como `local-training-simulation`, sem chamada externa e sem valor de fatura. Recusa/erro não devolvem a reserva; chave repetida não repete geração. O limite compartilhado é de cinco mensagens/preparações por minuto. Nenhum ledger, limite, allowlist ou prazo do piloto foi alterado.

Consentimentos e resoluções são registros privados imutáveis no journal de operações existente, com sequência sob bloqueio do aluno; auditoria inclui apenas IDs, versões e decisões. Não há DDL ou migração nova. Isso evita alterar o catálogo 001–007 neste bloco; uma modelagem longitudinal mais ampla terá avaliação própria de esquema e retenção.

## Metodologia privada

Spec DOCX e PRD PDF do Bruno foram lidos somente localmente. Critérios derivados e proveniência ficam em `.qa/training-method.json`, ignorado no Git e excluído do contexto Docker. Status `pending-bruno-validation`, catálogo vazio: o arquivo não autoriza geração real. Nenhum corpus, trecho integral ou regra específica de dose foi incluído no repositório público ou enviado a uma API. O leitor privado é explícito; o servidor não carrega o arquivo automaticamente. Fixtures públicas contêm somente regras/exercícios inventados e identificados como fictícios para testes.

Bruno ainda precisa validar a configuração privada, prioridades/ciclos, catálogo, equipamentos, limitações, alternativas e parâmetros técnicos. Geração externa exigirá finalidade específica, política de retenção/minimização, integração revisada e autorização própria de gasto. Nutrição depende de profissional habilitado vinculado, metas definidas por ele e catálogo aprovado; os totais determinísticos existentes podem ser reaproveitados, mas geração de cardápio permanece pendente. Não publicar este bloco como motor clínico pronto ou metodologia completa.
