# Radar e perfil: plano de implantação e retorno

Este documento prepara uma implantação futura. Não executa comandos, não concede autorização para produção e não contém credenciais. Nenhum push, deploy, migração de produção, cobrança, configuração de Asaas ou chamada a provedor externo foi feito nesta tarefa.

## Artefatos e compatibilidade

- Base publicada: `5db29b5758aadbd15d15d0d68dc6c9017961a97c`, com catálogo 001–007. Candidato local: branch `codex/radar-premium-ux`, catálogo 001–008.
- PostgreSQL: `backend/pg-migrations/008-radar-profile.sql`, SHA256 `2b13954ef16fefe54babebede9e3413d0d89f7ccdede111fdf10506c59ad5a9c`.
- SQLite de fixtures: `backend/migrations/008-radar-profile.sql`, SHA256 `ec030cd2a7f748db78351135f83996852d9bcc15f0ea9042855c20f164b14490`.
- Alteração aditiva: seis tabelas (`radar_leads`, `radar_runs`, `radar_events`, `radar_registrations`, `radar_limits`, `student_profiles`) e índice de leads. Não modifica tabelas, papéis, prescrições ou respostas anteriores.
- O migrador existente `backend/migrate.mjs` chama `migratePostgres`: transação, lock, verificação de checksum, registro de catálogo, DML ao `sim_app` e revogação de escrita do catálogo. O runtime permanece sem DDL. Não rodar migrador com credenciais do runtime.
- O pacote operacional histórico `manual-migrate-007.sh` continua sendo somente 007. Não editar suas migrações/checksums nem reutilizá-lo para 008.
- Coordenar o catálogo com qualquer trabalho de comércio antes de integrar. Se outra branch propõe um número 008, reconciliar apenas arquivos ainda não aplicados e testar o catálogo integrado; nunca renumerar ou alterar migração já aplicada. Nenhum checkout de comércio foi inspecionado ou alterado.

## Antes de autorização de produção

1. Resolver as fotos originais pelo fluxo autorizado e inspecionar os pixels; revisar texto, versão do Radar, retenção dos contatos e canal de privacidade com o responsável. Conferir preços e os termos ainda pendentes sem inventar renovação ou parcelamento.
2. Integrar a branch em uma revisão separada, comparar o diff com a base e executar novamente a suíte no catálogo integrado. Construir e verificar a imagem Docker em ambiente disponível; Docker não foi executado neste Windows.
3. Fixar commit e digest da imagem de oito migrações, registrar imagem anterior e sua configuração operacional, sem copiar segredos para repositório/logs. Manter Asaas e provedores externos desativados.
4. Em staging isolado, restaurar um backup autorizado sem tornar dados privados públicos. Validar catálogo 001–007 e checksums antes de aplicar 008. Aplicar com papel dedicado, repetir para comprovar idempotência e conferir catálogo 001–008/checksums, DML das seis tabelas e ausência de CREATE/escrita de catálogo para `sim_app`.
5. Conferir preservação de registros e autorizações existentes, CRM de outro tenant bloqueado, editor somente pelo aluno dono, imagem privada sem metadados, consentimentos desmarcados, ausência de respostas/score nos eventos e fluxo sem pagamento. Não criar fixtures em produção: o verificador de runtime rejeita contas `@fixture.invalid`.

## Janela futura autorizada

1. Parar e aguardar o encerramento dos escritores da aplicação. Criar backup completo novo e privado do banco, verificar hash e comprovar restauração em banco isolado. Fotos privadas passam a fazer parte do backup; não anexá-lo à revisão nem a uma Library pública.
2. Conferir catálogo real e compatibilidade da imagem fixada. Aplicar 008 pelo migrador existente com o papel dedicado, mantendo a aplicação parada. Uma falha antes do commit deve deixar catálogo e DDL anteriores intactos pela transação.
3. Conferir catálogo/checksums/permissões e iniciar somente a imagem compatível com oito migrações. Verificar readiness e navegação antes de reabrir tráfego de escrita. Não habilitar cadastro Radar sem escolher explicitamente a organização autorizada: `SIM_RADAR_ORG_ID` ausente/inválido retorna 503. Nenhum valor real dessa configuração foi definido aqui.
4. Observar status/erros e marcos mínimos, sem registrar corpos de questionário, fotos ou tokens. Confirmar formulário e consentimentos em staging; não inscrever terceiros em produção como teste.

## Retorno e limites

- Antes de reabrir escrita, se houver falha após a migração: manter aplicação parada, preservar cópia do banco migrado para análise, restaurar o backup prévio cuja restauração foi comprovada e recolocar a imagem/configuração anterior compatível com 001–007. Validar catálogo, readiness e acessos antes de abrir tráfego. A ausência de novas escritas nessa janela evita descartar contatos ou edições de alunos.
- Depois de reabrir escrita, preferir correção com catálogo 008 ou imagem de retorno preparada e testada para esse mesmo catálogo. Não recolocar diretamente a imagem publicada antiga: `verifyRuntimeRole` verifica quantidade/checksums e ela espera sete migrações.
- Não executar DROP das seis tabelas nem retirar o registro 008 para forçar startup. Isso descartaria leads, histórico de consentimento e perfis/fotos novos.
- Se restauração prévia for necessária após novas escritas, parar aplicação, criar e verificar primeiro um novo backup completo, levantar os dados criados/alterados após a migração e submeter a reconciliação ao operador responsável. A restauração antiga isoladamente perderia essas alterações; não prometemos retorno sem perda nessa situação.
- Manter backups e artefatos de retorno privados conforme a política aprovada. A revisão deste plano e a autorização final de implantação permanecem pendentes; nenhuma ação sobre infraestrutura real foi feita.
