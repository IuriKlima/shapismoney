# Comércio local integrado — simulação, sem venda habilitada

Base `5db29b5758aadbd15d15d0d68dc6c9017961a97c`, branch `codex/asaas-commerce-local`. O incremento trabalha no servidor, autenticação, política de acesso e UI persistente existentes. Produção, credenciais, `.env.local`, e-mails externos, API Asaas/OpenAI, cobranças, push e deploy estão fora desta etapa.

## Jornada implementada

O catálogo server-side fixa os totais BRL em centavos: mensal R$499, trimestral R$1.197 e semestral R$1.794. Anual/projeto específico usam formulário de interesse, sem pedido cobrável. Mensal permanece bloqueado. A UI informa simulação local e bloqueia checkout real; não coleta cartão. O runtime ensaia trimestral/semestral avulsos. Limites 3/6 existem somente nas fixtures do núcleo, sem política comercial aprovada.

Cadastro usa somente `@fixture.invalid` e cria comprador pendente, customer fictício e sessão HttpOnly opaca. E-mail coincidente não recupera comprador: um segundo navegador não recebe a sessão de um cadastro existente. Recuperação exige nova prova de uso único. IDs, papéis, preço, duração, organização e customer do navegador não são autoridade.

A confirmação comercial entra pelo endpoint existente `password-access/confirm`. A prévia de e-mail é gerada pelo admin fictício, entregue manualmente para o ensaio e claramente identificada como **nenhum e-mail enviado**. Tokens são armazenados somente por hash, expiram em 15 minutos e são consumidos atomicamente com usuário, vínculo de aluno e identidade do comprador. Não comprova uma entrega real de e-mail. O aluno escolhe a própria senha; recuperação revoga sessões antigas. Links manuais existentes continuam no fluxo original.

Uma origem comercial persistida em `operations`, com hash próprio, impede o fallback `legacy-existing` mesmo se o comércio for desabilitado após reiniciar. Isso não é uma autorização `access-grant-*`. Alunos anteriores e a exceção manual auditada do Bruno mantêm a política existente. Uma autorização manual explícita continua separada do pagamento.

Somente pagamento reconciliado **e** identidade comprovada autorizam o onboarding comercial. Não inicia prazo de vigência nem concede treino/nutrição enquanto serviços/período estiverem pendentes. Onboarding e anamnese usam os módulos existentes. Pagamento não publica treino/cardápio, não escreve anamnese nem inicia/resetta SLA: conclusão da anamnese e revisão profissional permanecem responsáveis por essas etapas.

## Regras de domínio e contratos compartilhados

`catalog.mjs`, `asaas-mock.mjs` e `flow.mjs` preservam o núcleo inicial. `runtime.mjs` adapta esse mesmo núcleo às sessões, prova de identidade, rotas e CRM do `service.mjs`; não há uma segunda implementação financeira para a UI. O adapter de banco é o já existente (`asyncLocalStore` ou `postgresStore`). SQL usa os mesmos placeholders/transactions e locks do pedido/comprador previstos para PostgreSQL.

Pedidos preservam snapshot imutável de total/duração. Chave de idempotência é persistida por comprador, com fingerprint do pedido. Checkout interrompido permanece `creating/unknown`; uma nova chave/segundo pedido não pode criar outra cobrança enquanto houver tentativa inconclusiva. A UI conserva a chave após resposta perdida, recupera pedidos pela sessão e não transforma retorno em pagamento.

Webhook autentica `asaas-access-token`, confere conta/ambiente e persiste allowlist antes do HTTP200. Nunca persiste payload, `creditCardToken`, cartão ou credencial do provedor. Unicidade por conta/ambiente/evento protege replays; fila usa CAS/lease e retomada durável. Um lote tenta cada evento uma vez; falha transitória não esgota todas as tentativas no mesmo lote.

Reconciliação consulta a lista completa do checkout, soma valor bruto, confere referência/customer/tipo/IDs e, para cenários parcelados do núcleo, consulta a operação parcelada completa. `netValue`, redirect e parcela isolada não autorizam a compra total. Divergências vão para revisão. `externalReference` não é chave externa de idempotência.

Estorno/chargeback ficam retidos; paid atrasado não apaga esse estado nem cria outro entitlement. Estorno total impede a autorização local de onboarding. Estorno parcial e chargeback registram revisão, preservando a autorização anterior até pausa administrativa, sem inventar política de sanção/estorno parcial. Entitlement, tarefas e auditoria são únicos/transacionais; pausa não é revertida por replay.

## HTTP e UI existentes

Rotas públicas locais: `GET commerce/capabilities`, `GET commerce/session`, `POST commerce/register`, `POST commerce/recover`, `POST commerce/webhook` e confirmação em `password-access/confirm`. Compra exige sessão de comprador confiável: `POST commerce/orders`, `GET commerce/orders/:id`, `POST commerce/orders/:id/checkout`, `POST commerce/orders/:id/reconcile` e `POST commerce/interest`.

CRM restrito ao admin ativo da organização: `commerce/admin/crm`, `/process`, `/outbox/:id/preview` e `/orders/:id/simulate|pause`. Os cenários `simulate` e as prévias existem somente no opt-in de fixture. Origin, loopback e autenticação do servidor existente continuam aplicados. O webhook local usa token explicitamente fictício, distinto de qualquer API key.

`commerce-ui.js` está montado no `persistent.js`; planos aparecem antes do cadastro, compra pendente/retorno/recuperação têm ações explícitas e o admin encontra pedidos, interesses e avisos no painel de alunos. Dados de sessão/compra não são gravados em localStorage. O fragmento de prova é removido da URL ao abrir e não é colocado no HTML/storage do comprador.

Outbox é durável, com UNIQUE comprador+dedupe_key, para identidade, pagamento, onboarding, revisão financeira e interesses. Não possui dispatcher real nem chamada de transporte; `emailsSent=0`. A prévia não é marcada como envio. A sincronização deriva avisos das tarefas/pedidos duráveis, permitindo recuperação após interrupção sem duplicação por replay.

## O que é harness, migração e PostgreSQL

`scripts/commerce-local-fixture.mjs` cria banco **novo em diretório temporário** e inicia loopback. SQLite, seed de `tests/backend-fixtures.mjs`, `commerce_mock_checkouts`, `commerce_fixture_scenarios`, token de webhook `mock-only-*` e emissão manual de prévias são harness. Não são credenciais nem cadastro/customer reais. O launcher não lê arquivo env.

Opt-in programático requer `commerce: {enabled:true, fixtureOnly:true, adminId:<admin fictício>}`. O runtime exige identidades fictícias e migração explícita; produção é rejeitada. Para o teste pelo adapter PostgreSQL existente, exige adicionalmente `embeddedPostgresFixture:true`; não abre pool real nem lê configurações de conexão. Sem opt-in, o servidor normal continua sem comércio habilitado.

`backend/commerce/migrations/001-local-commerce.sql` é migração aditiva revisável: núcleo inicial, cadastro/origem, sessões, provas, outbox e tabelas de harness. `migrate-fixture.mjs` aplica com checksum/transaction somente em SQLite fictício. O Dockerfile local inclui o módulo estático de comércio para resolver o import da UI; helpers e SQL de fixture são excluídos da imagem. Nenhuma imagem foi publicada. Não integra `backend/migrations` ou `pg-migrations`; a lista atual de sete migrações de produção não mudou. `001-review-grants.sql` exercita permissões limitadas em PGlite e exclui DDL e tabelas de provedor fictício. As permissões adicionais do harness PG são declaradas só no teste.

`sim-commerce-postgres.test.mjs` executa a mesma jornada HTTP pelo `postgresStore` real do repositório com engine **PGlite em memória** e papel limitado. Valida SQL, transactions, acesso pendente/ativo, entitlement/outbox únicos e ausência de publicação. A fila serializada de PGlite não comprova concorrência/deadlocks entre conexões PostgreSQL reais.

Pendente antes de qualquer venda: migração/grants definitivos de produção sem tabelas de harness; transporte financeiro e criação segura de customer reais; entrega de e-mail comprovada; worker/outbox real com tratamento de envio inconclusivo; PostgreSQL com múltiplas conexões; contratos e status de parcelamento em sandbox autorizado; decisões de renovação mensal, parcelas máximas, serviços, início/expiração da vigência e estorno parcial. A conta Asaas será criada pelo usuário. Nada foi presumido como aprovado.

## Verificação e revisão

Testes comerciais cobrem adulteração, escopo, total/parcelas, autenticação e sanitização, persistência antes de ACK, timeout, leases, rollback, restart, provas expiradas/repetidas, recuperação, refund/replay, pausas, UI repetida/interrompida e acesso sem fallback. Testes DOM usam 1440/390/320; não renderizam layout. QA visual completo continua pendente. Este executor encontrou inventário local `[]` e `Browser is not available: chrome/iab`; outro executor autorizado iniciou a inspeção no servidor Windows local 63349. Relatou login/onboarding após helper de identidade, pagamento repetido sem duplicação visível e revisão de estorno parcial/chargeback. O fragmento alterado na mesma aba foi corrigido e retestado no navegador. Dias/objetivo/experiência do onboarding foram corrigidos; regressão DOM confere payload numérico, banco, UI após salvar/recarregar e login em cliente com sessão nova. Reteste de dias no navegador continua pendente. O helper usou a prova de uso único e o endpoint HTTP existentes, sem inserir senha no navegador, enviar e-mail, editar diretamente o banco ou reiniciar o servidor. Criação de senha pela UI não foi validada. Não foi usado navegador compartilhado por este executor. O relatório do QA inspecionou desktop1440/mobile390/320, sem screenshots exportados; 320 foi exibido reduzido, portanto não há aprovação visual integral. Reportou timeout/recovery, reconciliação/restauração, pausa/replay, estorno total/paid tardio e interesses sem cobrança.

A comparação fictícia com a base `5db29b5` atribuiu o defeito dos dias à nova renderização comercial que fixava 3. A base já usa `onboarding.days`; este achado não indica hotfix de produção. `intake-ui.js`, `anamnesis.mjs` e `training-proposals.mjs` continuam idênticos à base: treino lê `days` da anamnese original validada. A regressão salva explicitamente `answers.days=5` com finalidade autorizada na fixture e preserva payload/banco/DTO/UI na nova sessão, mantendo rascunho e sem criar treino. Ver `.qa/commerce-days-base-comparison.md`.

Resultados finais ficam em `.qa/commerce-integrated-final-*`; conferir exit codes, contagens e hashes no manifesto final. O snapshot inicial foi preservado em `.qa/commerce-delegation-initial.patch`. O index inicial não foi substituído por esta integração.

A revisão independente do snapshot inicial foi bloqueada por `HTTP403 scope_violation` na materialização Library. Não há aprovação independente. IDs informados: patch `libfile_49d9ca9c3d2c81919ab10d2422c84097`, manifesto `libfile_d7ed4eca58c48191af8757269cf79dd6`. Patch final/manifesto são preservados localmente para compartilhamento autorizado; não foi publicada uma cópia alternativa para contornar a negativa.

Fontes oficiais consultadas por leitura de documentação, sem chamada de API: [criar checkout](https://docs.asaas.com/reference/criar-novo-checkout), [checkout](https://docs.asaas.com/docs/checkout-asaas), [listar cobranças](https://docs.asaas.com/reference/listar-cobrancas), [eventos financeiros](https://docs.asaas.com/docs/webhook-para-cobrancas) e [idempotência](https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks).
