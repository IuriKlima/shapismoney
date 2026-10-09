# Rascunhos de treino com provider externo

Implementação integrada disponível para avaliação local, desativada por padrão. Produção recusa o gate externo nesta fatia. Nenhum método Bruno foi aprovado pelo código, nenhum segredo foi criado, nenhum piloto integrado está autorizado. Nutrição permanece fora deste fluxo.

## Comportamento

O modo local e o fluxo manual continuam disponíveis conforme configuração anterior. O modo `external-reviewed` usa o adapter Responses explicitamente real (`responses`, `network`, `mockOnly:false`). Qualquer transporte injetado é rotulado `responses-offline-test` / `fake-test`, exige opt-in `offlineTest:true` somente em testes e nunca é apresentado como real. O bootstrap não oferece esse opt-in de teste.

O aluno escolhe finalidade externa própria em `training-external-consent`, `SIM_TRAINING_PROPOSAL_EXTERNAL_V1`, vinculada à revisão da anamnese. Consentimento local e autorização administrativa não substituem essa escolha. UI explica OpenAI, categorias transferidas e revisão profissional; omite contatos/carta/dieta do contexto. Riscos pendentes bloqueiam geração. Organização, equipe ativa, revisão atual e credencial de sessão são conferidas no servidor.

Método privado exige formato `SIM_PRIVATE_METHOD_V1`, kind training, status reviewed, revisão de coach/admin ativo da mesma organização, catálogo aprovado, fontes/version/hash/seção, transferência expressamente aprovada no método e em todas as regras. FixtureOnly e IDs fixture são bloqueados externamente. É responsabilidade de Bruno revisar o conteúdo clínico e as permissões; um marcador reviewed sem evidência humana real não autoriza uso.

`prepare` registra reserva e job duráveis antes de enviar, com locks de actor/student/orçamento. Snapshot inclui revisão/vínculos/finalidade/risco/método/modelo/configuração do budget. Chamadas têm timeout até20s, contexto até8000 tokens conservadores, output até4000, sem retries/refunds/fallback. Jobs running impedem outra geração para o aluno; após crash continuam bloqueados até reconciliação explícita, sem nova chamada automática.

Schema contextual V3 e validator independente validam referências/doses/catálogo/contagens. Após resposta, revalida contexto e sessão sob locks antes de gravar proposta temporária durável. A confirmação explícita revalida novamente e cria só `draft`, nunca approved/published. Mesma sessão pode recuperar proposta após reinicialização, com TTL20min e idempotência. Edição cria nova versão, preserva a anterior e exige nova revisão. Aprovação/publicação continuam ações profissionais separadas e conferem referências atuais.

Falhas conservam a reserva e apenas diagnóstico seguro stage/field/rule no journal; nenhum envelope, header, segredo ou resposta inválida bruta é armazenado. Propostas válidas guardam conteúdo de treino e proveniência em operações privadas, com TTL de uso, e depois em plans; TTL não apaga histórico. Antes de dados reais é preciso aprovar política de retenção desse histórico privado.

## Configuração explícita — não ativada nesta entrega

Bootstrap requer `SIM_TRAINING_EXTERNAL_ENABLED=true`, somente fora de produção. Variáveis próprias: `SIM_TRAINING_MODEL`, `SIM_TRAINING_EXPIRES_AT` (timestamp ms, janela máxima24h), `SIM_TRAINING_METHOD_FILE` (arquivo privado revisado sob .qa), `SIM_TRAINING_GLOBAL_MONTHLY_USD`, `SIM_TRAINING_ADMIN_MONTHLY_USD`, `SIM_TRAINING_INPUT_RATE`, `SIM_TRAINING_OUTPUT_RATE` (USD/M tokens). Não há defaults de tarifas/caps vindos do chat. Alterar modelo ou orçamento após inicialização fecha o gate; configuração nova exige reinicialização explícita. Reutiliza a resolução segura do segredo OpenAI existente, sem novo arquivo/serviço/credencial; o gate fechado não lê método nem chave.

O budget usa o ledger mensal existente: reservas treino identificadas por purpose training-proposals e modelo explícito. Seu input/caps vêm somente da configuração de treino; contabilização conservadora continua somando consumo da instalação/aluno, inclusive chat, para não contornar caps compartilhados. Não equivale a saldo/fatura OpenAI ou carteira financeira isolada. Falhas permanecem reservadas. Sem migração: operações, reservas mensais e plans existentes suportam journal/snapshots/idempotência.

## Conferência e limites

Integração HTTP ponta a ponta offline com credenciais/pessoas/método fictícios e transporte fake identificado; confirmação draft, versões humanas imutáveis, finalidade separada, autorização/tenant/reviewer/gates, budget insuficiente, concorrência lógica, contextos obsoletos, timeout/diagnóstico/reserva e recuperação em nova instância. Não prova concorrência PostgreSQL entre conexões reais, qualidade clínica nem integração externa live. Piloto standalone V3 anterior não é piloto integrado do app.

## O que falta de Bruno para habilitar

1. Método real, regras/doses/limitações, catálogo e alternativas explicitamente revisados, com fontes/version/hash/seção e organização/profissional responsável corretos.
2. Decisão expressa sobre transferência à OpenAI por regra e método, categorias e retenção, além da finalidade externa opcional de cada aluno para revisão atual.
3. Modelo, tarifas e verba de treino, responsáveis pela revisão/publicação e janela de piloto aprovados. Nenhuma aprovação presumida de fixture ou dos testes.
4. Autorização específica de piloto integrado; antes de produção, revisão própria do gate de produção, retenção, limites e concorrência real PostgreSQL. Produção continua bloqueada por código.
