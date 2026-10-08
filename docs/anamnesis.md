# Anamnese original e finalidade

Fonte conferida somente por leitura em 08/10/2026: [Consultoria Individual do Treinador Bruno Barbosa](https://docs.google.com/forms/d/e/1FAIpQLSeDEB5JBxVCqJTPgeFLuB0BC0lBXfjqU2r9CnJlG8oAtQTdRw/viewform). São 28 perguntas, 26 obrigatórias; peso e carta final são opcionais. Não foi submetida resposta ao Google. Labels e três alternativas de ambiente estão versionados em public/sim/intake-fields.js (BRUNO_FORM_V1). Importância, disposição e confiança são textos do original, não escalas clínicas. Limites de entrada e tipos numéricos são validações técnicas do app; não foram apresentados como avaliações clínicas. Soma das respostas limitada a 14 KB dentro do limite HTTP de 16 KB.

O contrato local anterior public/sim/anamnesis-fields.js foi preservado sem alteração e permanece fora do commit. A calibração cinematográfica e os quatro campos básicos anteriores não representam conclusão da anamnese original. Respostas anteriores em students.onboarding são preservadas; não foram copiadas para a tabela clínica ou reinterpretadas. Nenhuma pose/foto, diagnóstico, medicamento ou resultado financeiro foi inventado.

## Persistência e acesso

Migração aditiva 007-anamnesis cria somente tabela anamneses e índice, SQLite e PostgreSQL. Guarda versão, respostas estruturadas, status, revisão CAS, versões/instantes de consentimento, conclusão, necessidade de revisão humana e autoria/revisão profissional. Sem backfill de alunos ou serviços existentes.

GET /api/local/students/:id/anamnesis: aluno próprio vê respostas; personal vinculado vê somente com autorização de treinamento; nutricionista vinculado e verificado vê somente dieta atual, lesões, fraturas e restrições com autorizações de treinamento e nutrição. Admin recebe apenas metadados. ACL por organização e atribuição continua obrigatória; não há acesso por identificador sozinho. Respostas não entram em CRM, auditoria, ranking ou contexto da IA. Auditoria registra ação/revisão/autorizações, não narrativas. Formulário não inclui consentimento de IA; a autorização de nutrição é opcional e separada.

PUT no mesmo endpoint pertence ao aluno, aceita version/revision/answers/consents exatos. Rascunho aceita respostas parciais e não inicia SLA. POST /complete exige confirmação, versão e todos os campos obrigatórios com autorização de treinamento. POST /review exige personal vinculado, consentimento e respostas concluídas; apenas registra revisão humana, não aprova/publica plano. Relatos de lesão/fratura/restrição diferentes de negativas explícitas geram indicação conservadora de avaliação humana, não diagnóstico nem liberação automática. Todos os relatos completos exigem conferência do personal antes de registrar entrega no SLA.

Retirada das autorizações bloqueia imediatamente novas leituras profissionais, invalida conclusão e conferência, mantém respostas acessíveis somente ao aluno e preserva o prazo já iniciado. Não implementa exclusão automática: retenção, pedido de exclusão, backups e bases legais precisam de definição operacional antes do uso com dados reais. Responsabilidade/consentimento para menores ainda precisam de política aprovada; não presumir que uma conferência do personal resolve esse requisito. Reatribuição de profissional é revalidada dentro das mutações após o lock.

## Prazo e legado

Primeira conclusão da anamnese original inicia 48h de meta interna/72h de promessa em horas corridas. Reconclusão e complementação não alteram started_at, target_at ou promised_at existentes. Ao editar ou retirar autorizações, um atendimento existente passa a needs_info, com revisão invalidada. Ao instalar 007, um atendimento antigo sem anamnese original recebe estado de complementação pendente na leitura e na UI; seus registros e datas não são apagados ou reiniciados silenciosamente. A rota antiga de conclusão dos quatro campos básicos passa a exigir a anamnese original completa.

Entrega administrativa exige anamnese original completa e revisão pelo personal, além das verificações existentes de responsável, ambos os planos publicados e solicitações alimentares resolvidas. Revisão administrativa de contexto não substitui a conferência profissional. Ausência de consentimento nutricional não força compartilhamento nem altera autorização de prescrição.

## Handoff de banco e publicação

Não aplicar 007 em paralelo com outro operador. Banco existente deve estar no catálogo 001–006 com checksums conhecidos; backup privado novo e teste de restauração compatível precedem publicação de dados reais. Aplicar somente 007 como sim_migrator e registrar seu SHA256 exato no catálogo; sim_app recebe DML da nova tabela, sem CREATE ou escrita em schema_migrations. Nesta tarefa nenhum SQL foi executado na VPS.

Runtime desta branch espera sete migrações. A imagem publicada f2995b2 espera seis: não reiniciá-la depois de 007, nem implantar esta branch antes de 007. Coordenar transação seguida da imagem compatível. Rollback de aplicativo deve conservar compreensão de sete migrações; não remover a tabela clínica para voltar ao binário antigo. Se DDL falhar antes de COMMIT, transação pode ser revertida sem alterar 001–006; depois de COMMIT, investigar e usar imagem compatível. Plano de restauração deve considerar quaisquer escritas posteriores, não restaurar backup antigo cegamente.

## Validação

Testes de 28/26, opcionais, campos desconhecidos e inválidos; rascunho sem SLA; consentimento por finalidade; isolamento de papéis/organizações; revisão humana; concorrência/idempotência; retirada de autorização sem reset; preservação de respostas legadas; serialização mínima do admin. PostgreSQL embarcado executa persistência/conclusão/CRM como sim_app e recusa DDL/escrita no catálogo. Fixture de navegador isolada concluiu respostas sintéticas e confirmou 72h; formulário medido em 320px (scrollWidth 305) e 390px (scrollWidth 375), overflow de controles zero. Não houve chamadas IA ou envio de dados reais.

Aceite operacional com Bruno e alunos, política de privacidade/retencão/menores, recuperação de senha, restauração de backup, monitoramento e homologação real dos planos continuam pendentes. Asaas e IA permanecem em espera. Produção não é liberada por esta implementação.
