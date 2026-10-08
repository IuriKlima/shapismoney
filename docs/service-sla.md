# Atendimento persistente e SLA

A migração 006-service-sla adiciona somente service_cases e um índice. Não altera dados existentes, planos, contas ou credenciais. SQLite aplica em ambiente local; PostgreSQL requer execução revisada por sim_migrator, e sim_app continua sem CREATE. A versão do runtime valida exatamente o catálogo esperado: não implantar esta revisão com somente 001–005.

## Início e prazos

Salvar respostas não inicia o SLA. POST /api/local/students/:id/onboarding/complete exige respostas atuais válidas, a revisão do cadastro e confirmação explícita. Neste incremento o questionário persistente disponível contém objetivo, dias, experiência e contexto; isso não significa que o protocolo clínico completo foi implementado. A conclusão é uma ação explícita do aluno ou responsável pelo cadastro, separada da revisão profissional.

A primeira conclusão grava started_at, target_at = início + 48h e promised_at = início + 72h. São horas corridas em timestamps UTC; a interface exibe America/Sao_Paulo, inclusive na virada de mês/ano. A meta de 48h é mostrada à equipe; o aluno vê a promessa de 72h. Repetição, reconclusão e edição posterior não reiniciam nem pausam o relógio. Edição das respostas invalida a conferência administrativa, reabre pendência e exige nova revisão; não modifica planos publicados.

## Central

GET /api/local/crm é exclusivo do administrador da própria organização. Mostra alunos, contatos, notas internas, responsáveis, pendências, metadados dos planos e até 200 eventos de auditoria. Não concede ao admin papel de nutricionista ou acesso à composição clínica. Profissionais vinculados e aluno podem consultar seu atendimento individual; o aluno não recebe notas, responsáveis internos ou metadados de rascunhos.

PUT /api/local/students/:id/service exige admin, confirmação, revisão CAS e chave de idempotência. Responsável precisa ser profissional/admin ativo da mesma organização. Estados: waiting, in_progress, needs_info, delivered. Nota é interna. Auditoria registra ator, instante, estados/responsáveis antes e depois e indicação de mudança da nota; não guarda o texto completo da nota anterior.

Entrega exige responsável, respostas atuais conferidas, treino e alimentação publicados a partir do início do atendimento e solicitações de alimentação resolvidas. Não publica, aprova, altera prescrição ou transmite dados à IA. As validações profissionais existentes continuam obrigatórias.

Alertas de 48/72h são calculados pelo servidor ao carregar a central. Não há envio de email/WhatsApp, pausa automática, tarefas comerciais completas ou liberação por prazo. Atualize a página para obter os alertas atuais. Pagamentos Asaas continuam em espera.

## Validação

Testes de prazos UTC/São Paulo, conclusão explícita, concorrência e idempotência, reinício, edição sem reset, isolamento por papel/organização, CAS, responsáveis e entrega incompleta. Testes de UI verificam payload confirmado, escaping, filtros e ausência de campos internos no aluno. PostgreSQL embarcado executa o fluxo como sim_app e confirma que DDL e escrita no catálogo são negadas.
