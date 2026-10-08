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

## Pacote manual 007 e janela de manutenção

Integração por fast-forward preserva f2995b2 e contém a implementação adbd692. Scripts locais preparados, não executados na VPS: deploy/backup-verify-007.sh e deploy/manual-migrate-007.sh. O primeiro cria dump custom de todo o schema sim **com os dados**, não apenas DDL, em diretório root 700/arquivo 600; restaura em container temporário da mesma imagem já instalada, sem rede e sem portas, com armazenamento descartável. Compara catálogo e contagens de usuários/alunos/atendimentos; pg_restore precisa concluir sem erro. Não imprime registros ou respostas. Não restaura permissões no container descartável; a verificação de papéis/permissões de produção ocorre no SQL da migração. Não substitui teste de recuperação do servidor inteiro, roles, secrets ou uploads: esse backup é do schema sim.

O segundo exige prova de restauração com SHA256 igual ao dump, backup com menos de uma hora, serviço medsi_shapismoney configurado com zero réplicas e nenhuma tarefa app ainda rodando. Recusa catálogo diferente de 001–006 conhecidos (ou 007 já aplicada com checksum esperado), fixtures, papéis amplos, CREATE para sim_app ou escrita no catálogo. Usa lock transacional, aplica apenas 007, concede DML somente em anamneses e permite repetição segura. Testes PostgreSQL embarcados verificam catálogos incompletos/corrompidos, rollback injetado, idempotência, preservação de respostas e datas de casos legados e limites de runtime. Scripts shell/Docker ainda precisam de execução supervisionada na VPS; não alegar backup novo/restauração real realizados nesta tarefa.

Sequência de publicação, após autorização operacional e janela acordada:

1. Fixar o commit integrado e verificar SHA256 dos dois scripts baixados por URL raw **com SHA de commit**, sem usar a ponta móvel da branch. Preparar/conferir a imagem com sete migrações e os módulos intake-fields/intake-ui antes de interromper o app. Manter staging, HTTPS, proxy confiável, credenciais por arquivo e IA desabilitada. Não publicar secrets, dump ou documentos privados no GitHub.
2. Coordenar um único operador e suspender outras escritas no banco. Parar somente medsi_shapismoney (`docker service scale medsi_shapismoney=0`); não parar o banco nem outros serviços. Esperar todas as tarefas do app saírem. Não executar agora: a manutenção ainda não foi autorizada nesta delegação.
3. Rodar `sh backup-verify-007.sh`. Guardar o novo caminho privado exibido e a prova; o backup antigo de antes de 004–006 não satisfaz esta etapa. Se falhar, investigar sem aplicar 007. Antes de 007, retomar a imagem antiga é compatível com o catálogo de seis migrações.
4. Rodar `sh manual-migrate-007.sh /root/shape-backup007-XXXXXX/schema-sim.dump` usando o caminho real retornado. Exigir COMMIT, catálogo 001–007, CREATE=f e anamnesis_dml_allowed=t. Se falhar antes de COMMIT, confirmar rollback e catálogo antes de retomar.
5. Implantar somente imagem fixada e compatível com sete migrações e retomar uma réplica. Conferir Docker health, versão/commit, login existente de Bruno, CRM e ausência de resets; não repetir cadastro nem usar informações de saúde reais como teste. Confirmar rotas e RBAC com fixture isolada ou contas de teste aprovadas.
6. Depois de COMMIT, **não** voltar diretamente a f2995b2: esse runtime exige exatamente seis migrações e falhará no readiness. Reversão preferencial usa imagem compatível com sete migrações. Se precisar restaurar o banco, parar escritas, preservar dump atual para não perder respostas novas, avaliar/reconciliar alterações posteriores e restaurar somente em recuperação coordenada com operador e autorização. Não apagar anamneses nem remover linha 007 para contornar readiness.

O menor próximo passo é revisar hashes/commit do pacote e aprovar a janela para preparação da imagem e operação supervisionada. Nenhum comando de manutenção, backup novo, DDL ou deploy foi executado nesta integração.

Arquivos SQL e scripts POSIX têm LF fixado em .gitattributes para que checkouts Windows não alterem checksums. Os bytes das migrações 001–007 permanecem idênticos aos blobs já versionados; nenhuma migração anterior foi reescrita semanticamente.
