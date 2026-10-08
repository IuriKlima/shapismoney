# Verba interna mensal da IA

Implementação 8/10/2026, migração aditiva 005 após 004. Sem cobrança externa, recarga automática, saldo OpenAI consultado ou chamada real neste incremento.

## Unidade e ciclo

US$1 inicial por aluno e por mês civil em America/Sao_Paulo. Identidade contábil é organização + cadastro do aluno + YYYY-MM. O ciclo muda à meia-noite local no primeiro dia; histórico de meses anteriores permanece. Não há transferência de verba extra/sobra para o mês seguinte.

Reservas em inteiros de milionésimos de dólar, arredondadas para cima antes do provedor. Estimativa conservadora usa limite superior de tokens de entrada por bytes UTF-8 + margem e saída máxima, com tarifas revisadas explícitas. Reserva permanece após timeout, recusa ou resposta inválida, evitando gasto adicional inadvertido. Não é fatura real/consumo liquidado: reconciliação com billing da OpenAI não está integrada; saldo externo é desconhecido.

Chamadas do aluno usam somente seu próprio cadastro. Administrador com aluno selecionado usa a verba desse aluno autorizado; sem aluno, usa grupo administrativo separado por organização. Nenhum aluno fictício é criado para ocultar custo. Também existe limite global mensal da instalação, compartilhado por todos os grupos/organizações; reservas antigas do chat legado no mesmo mês contam nesse limite. Aporte por aluno nunca aumenta o limite global ou administrativo.

## Concorrência e repetição

Transação e advisory lock do PostgreSQL serializam reservas entre réplicas; SQLite usa fila transacional. Limites individual/administrativo/global são conferidos antes do provedor. Sessão tem uma mensagem em andamento; uma mesma Idempotency-Key registrada não faz nova chamada nem nova reserva e retorna 409 com orientação. Uma nova chave representa nova tentativa autorizada pelo usuário e nova reserva. Reinício não apaga os registros.

Alertas 70%, 90% e 100% ficam no painel administrativo da organização, deduplicados por mês/escopo/faixa. 100% também registra quando a próxima reserva excederia a verba restante, mesmo havendo pequeno saldo insuficiente; não permite ultrapassar o limite. São eventos históricos e continuam visíveis após um aporte. Não há envio automático de e-mail/mensagem.

## Aporte interno

Admin autenticado confirma aluno, mês atual, valor e motivo. POST /api/local/ai/budget/allocations exige Idempotency-Key; aporte US$0,01–20 por operação, precisão de centavos e teto US$100 extra/aluno/mês. Transação registra autor/motivo/data e auditoria. Nenhuma API financeira é chamada. O painel explica que adicionar verba interna não adiciona saldo externo e que o limite global permanece. Aluno vê apenas sua própria verba; profissionais não recebem controles administrativos.

Ao bloquear reserva, o sistema exibe limite atingido e contato humano; não inventa resposta. Login, plano publicado e acompanhamento persistente continuam disponíveis.

## Configuração e gates

Modo padrão do runtime: monthly-per-student. Requer SIM_AI_CHAT_GLOBAL_MONTHLY_BUDGET_USD e SIM_AI_CHAT_ADMIN_MONTHLY_BUDGET_USD explicitamente revisados, positivos, grupo administrativo ≤ global e global ≤ US$100.000. Nenhum valor global foi configurado/aumentado no VPS por este trabalho. US$1 individual é o valor interno aprovado; permitir novas chamadas reais ainda exige flags revisadas, modelo, tarifas recentes, prazo, allowlist e consentimento do contexto enviado. SIM_AI_ENABLED permanece false no staging.

legacy-review é modo explícito separado para smoke administrativo limitado, com SIM_AI_CHAT_BUDGET_USD cumulativo ≤ US$5; nunca apresentá-lo como orçamento mensal por aluno. Entrada 0,125 usada nos mocks/reservas anteriores é conservadora (cache-write), não a tarifa Standard de entrada 0,10 conferida em 8/10/2026. Tarifas não são eternas: configuração expira revisão de preço em 30 dias. Modelo atual gpt-6-luna; preços e política em https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-6-luna.

## Aceite e implantação

Testes sintéticos cobrem calendário/precisão, concorrência/isolamento, persistência entre instâncias, histórico, alertas deduplicados, orçamento global e administrativo, reservas legadas, idempotência, timeout sem refund, aporte confirmado/auditado e UI sem saldo falso. PostgreSQL embarcado executa sob sim_app sem CREATE.

Aplicar migrations 004 e 005 usando sim_migrator, verificando o catálogo/checksums antes de implantar a branch correspondente. O runtime recusa catálogo diferente; rollback precisa manter o catálogo aditivo esperado. Não alterar volume, contas, papéis, senha, allowlist ou flags de produção para completar a implantação. QA visual desktop de nutrição realizado; viewport móvel real continua pendente porque as abas de QA ocultas permaneceram em 1280px e a abertura do painel local ficou queued enquanto esta tarefa estava oculta.