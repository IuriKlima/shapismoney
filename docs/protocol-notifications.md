# Avisos de publicação — incremento local

Base: `5db29b5`. Publicar treino ou alimentação após a aprovação profissional grava um aviso na mesma transação, usando `operations`; não há migração nova. Falha ao gravar o aviso faz rollback da publicação. Repetição idempotente não duplica aviso ou e-mail. Planos anteriores ao incremento não recebem avisos retroativos.

O aluno encontra as atualizações na página inicial e pode marcar a leitura explicitamente. Apenas avisos dos próprios planos publicados e das funcionalidades com acesso atual são exibidos. A administração consulta os estados do aluno selecionado. Avisos e leitura persistem após reinício; nenhum título, exercício, refeição ou anexo entra no aviso ou no e-mail.

O despacho reutiliza o transporte SMTP/Resend de acesso já existente, com opt-in separado: `SIM_PROTOCOL_EMAIL_ENABLED=true` e `SIM_PROTOCOL_EMAIL_REVIEWED=true`. Ausentes, mantém somente avisos na conta. Não configura credencial e não altera os gates SMTP existentes. Se habilitado sem transporte de acesso revisado, startup falha fechado. O destinatário precisa ter conta de aluno ativa, e-mail correspondente e acesso atual à funcionalidade publicada. Vínculo, identidade, e-mail, plano e autorização são revalidados antes do despacho.

O worker opera fora da resposta HTTP, com CAS, lease e limite por lote. `accepted` significa aceitação pelo provedor, não entrega na caixa postal. Timeout, exceção ou lease interrompido ficam como `delivery-unknown`, sem reenvio automático. Desabilitar o transporte não promove avisos antigos a novos envios. Uma mensagem já em trânsito não pode ser recolhida. Remetente/domínio, entrega e operação PostgreSQL real permanecem dependências de liberação.

API autenticada: `GET /api/local/notifications`; `POST /api/local/notifications/:id/read` exige `{confirmed:true}`, origem correta e chave de idempotência. `GET /api/local/students/:id/notifications` é restrito à administração da mesma organização. Não há endpoint de envio livre nem possibilidade de informar destinatário/conteúdo pelo navegador.

CRM/SLA agora exige os planos do nível de acesso atual: Treino não exige cardápio; Treino e Nutrição exige ambos. Acesso expirado/inativo impede marcar entrega. A revisão das respostas e o responsável permanecem obrigatórios; meta de 48h e promessa de 72h não mudam.

Validação: fixtures sintéticas, SQLite isolado, SQL pelo `postgresStore` com PGlite e papel limitado, transporte mock, DOM e contrato Docker. Nenhuma chamada OpenAI/Asaas, e-mail real ou alteração de produção faz parte deste incremento. Isto fecha publicação→aviso local, não prova compra→IA→protocolo em produção.
