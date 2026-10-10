# Contingência funcional com catálogo 008

Preparada localmente em 10/10/2026, na branch `codex/rollback-compatible-008`, a partir de `5db29b5758aadbd15d15d0d68dc6c9017961a97c`. Não foi enviada ao remoto nem implantada. Não houve acesso a VPS, credenciais ou dados reais. A branch UX e o checkout de comércio não foram alterados.

## Mudança mínima

O comportamento da aplicação é o publicado em `5db29b5`: página inicial privada, rotas antigas, autorização, treinamento, anamnese, SLA e contratos anteriores. Backend, frontend, arquivos de implantação, manifests e locks permanecem iguais à base em conteúdo Git. As diferenças de CRLF do checkout Windows são normalizadas por Git; os SQLs têm LF obrigatório.

A única adição de produção são os dois arquivos `008-radar-profile.sql`, copiados sem modificar os bytes da versão UX `f5d7f94764e28f8fe8c31468f2a7b70d92108671`:

| Catálogo | SHA256 do SQL |
| --- | --- |
| PostgreSQL | `2b13954ef16fefe54babebede9e3413d0d89f7ccdede111fdf10506c59ad5a9c` |
| SQLite de fixtures | `ec030cd2a7f748db78351135f83996852d9bcc15f0ea9042855c20f164b14490` |

`verifyRuntimeRole`, `postgresMigrations`, o migrador e o startup permanecem intactos. O catálogo esperado passa a ter oito entradas porque o SQL 008 está presente. A igualdade de quantidade, nomes e checksums continua obrigatória. O runtime recusa um banco de sete migrações, checksum diferente ou catálogo futuro desconhecido; não executa DDL. Não há DROP, remoção de 008 ou restauração de banco antigo.

O Dockerfile antigo já copia `backend`, cuja regra de contexto inclui os SQLs. O QA precisa confirmar a presença efetiva do arquivo e checksum na imagem construída; nenhum Docker está disponível neste Windows. Sete arquivos de testes anteriores mudam somente onze contagens esperadas de sete para oito. O teste do pacote histórico 007 seleciona explicitamente seu SQL pelo nome, mantendo seu checksum, idempotência e catálogos de seis/sete; esse pacote não foi alterado para aplicar 008. Nenhuma regra de autorização foi flexibilizada.

## Efeito e limites

As seis tabelas novas permanecem no banco: `radar_leads`, `radar_runs`, `radar_events`, `radar_registrations`, `radar_limits` e `student_profiles`. A aplicação de contingência não usa essas tabelas. Leads, consentimentos, abandono, nome de exibição, bio e foto permanecem armazenados; as funções novas ficam indisponíveis temporariamente. A página inicial volta ao acesso privado; `/radar`, `/vendas` e `/privacidade` retornam 404. As APIs novas também não estão presentes. Uma requisição anônima desconhecida pode receber 401 pelo contrato antigo, sem gravar contato.

O nome antigo do cadastro reaparece na interface enquanto o nome de exibição novo fica preservado em `student_profiles`. Foto e bio privadas não passam a ser públicas. Sessões antigas continuam sujeitas à expiração, desativação de usuário e papéis existentes. Configuração, papel de banco e origem HTTPS devem continuar seguros; nenhuma configuração real foi feita aqui.

O candidato cobre exatamente 001–008. Não é uma contingência pronta para uma integração que inclua outra migração ou modifique contratos anteriores. Se comércio/AI mudar o catálogo, reconciliar os arquivos ainda não aplicados e preparar outro candidato compatível com o catálogo final. O runtime deve continuar recusando catálogos inesperados.

## Evidências locais

`tests/sim-contingency-008.test.mjs` verifica o conteúdo Git do runtime antigo, os hashes exatos dos dois SQLs, os catálogos inválidos e a ausência de CREATE/escrita de catálogo para `sim_app`. Em banco PGlite persistido e exclusivamente sintético, escreve nas seis tabelas novas com o papel da aplicação, incluindo execução concluída, abandono e uma foto WebP de um pixel. Fecha/reabre o banco, inicia o backend antigo, autentica usuários, publica um treino, registra execução idempotente e bloqueia outro tenant/papel. Compara todas as linhas novas, catálogo, anamnese e bytes da foto antes/depois; reabre novamente e confirma sessão e treino persistidos.

A prova adicional `tests/contingency-forward-return-fixture.mjs` usa os dois runtimes: APIs da UX criam o lead, eventos, repetição, perfil e foto sanitizada; o mesmo banco é reaberto com o runtime antigo, que publica um treino; depois a UX é iniciada novamente e recupera CRM, perfil, foto e treino. Nenhuma resposta de saúde é enviada. A foto é um retângulo sintético, sem pessoa. Evidência privada em `.qa/forward-return-008-result.json`, sem inclusão no contexto Docker.

PGlite e HTTP local não comprovam Docker, PostgreSQL nativo, proxy HTTPS, digest de imagem, limites de processo ou integração futura. Esses itens continuam como validação do executor QA, não como operação já aprovada.

Validação final neste Windows: build, typecheck e lint com exit 0; suíte serial de 213/213 testes, zero falhas, exit 0, em aproximadamente 307 segundos. O primeiro ciclo teve 212/213 porque o teste histórico selecionava a última migração como 007; a seleção por nome foi corrigida sem alterar o pacote, seus três testes passaram separadamente e a suíte inteira foi repetida com sucesso. A prova independente entre runtimes também passou. Seus snapshots antes/depois têm SHA256 idêntico `48c578efdd06432b8ad4a06883ebf1fbbae6a74e5948074eb3b3106411a66e79`, e os bytes da foto sintética têm SHA256 `7fc09cbbcc25621a7cd618f876cbe21605e3674cd607d37003e827be3b31bdf7`. Logs, resultados e auditoria de escopo estão em `.qa/contingency-*` e `.qa/forward-return-008-result.json`; os dados sintéticos persistidos foram removidos somente dos diretórios temporários isolados ao encerrar os testes.

## Comparação com feature flags

| Caminho | Esforço de código | O que resolve | Limite |
| --- | --- | --- | --- |
| Base antiga com SQL 008 idêntico | Dois SQLs de produção, sem patch de runtime; regressões e teste de preservação | Retorna comportamento anterior e mantém catálogo/dados novos | Precisa de imagem distinta construída e testada; funções novas ficam indisponíveis |
| Flags na aplicação nova | Alterar configuração, roteamento do backend e composição do frontend; testar combinações e transições | Suspende seletivamente captura/CRM/edição/upload, mantendo o runtime novo | Não retorna automaticamente ao código antigo nem corrige uma regressão do runtime; o catálogo 008 continua obrigatório |

Para o gap encontrado, o candidato antigo compatível é a opção mínima e mais direta. Flags podem complementar mitigação futura, mas não foram implementadas nesta tarefa. Não serviria apenas esconder botões: também precisariam impedir gravação nas APIs e cobrir abas abertas/repetição, mantendo o acesso privado aos dados autorizados e a validação de schema.

## Roteiro do QA antes de qualquer aprovação de uso

1. Construir uma imagem da UX fixada e outra deste candidato, sem reutilizar apenas uma tag da mesma imagem. Registrar commits, IDs/digests e confirmar que os dois IDs são diferentes. Conferir runtime antigo, SQL 008, usuário sem root e contexto sem segredos/dados/testes.
2. Usar PostgreSQL isolado, dados sintéticos e papéis dedicados. Aplicar 008 pela versão avançada/migrador autorizado; cadastrar lead e eventos, editar perfil e fazer upload pela API. Registrar catálogo/checksums, snapshot canônico das seis tabelas, hash dos bytes da foto e registros antigos relevantes.
3. Encerrar os escritores da UX e aguardar requisições em andamento. Guardar backup completo atual e privado sem substituir o banco por uma cópia anterior. Iniciar a imagem de contingência com o mesmo banco já migrado; não rodar down migration nem DDL pelo runtime.
4. Confirmar startup e readiness, login, leitura/publicação de treino, execução e autorização de dono/tenant. Confirmar página inicial antiga e indisponibilidade das funções novas. Comparar catálogo, snapshots e hash da foto: todos devem continuar iguais, além das escritas antigas intencionais de sessão/auditoria/treino.
5. Reiniciar a imagem de contingência e repetir leitura/persistência. Encerrar seus escritores, voltar à imagem UX fixada e confirmar recuperação do CRM, consentimento, abandono, perfil e foto. Registrar os digests realmente executados em cada etapa.
6. Repetir no catálogo final integrado antes de aceitar este artefato como contingência operacional. Ausência de Docker local e autorização de push/deploy continuam pendentes; nenhum desses passos de infraestrutura foi executado aqui.

Com dependências de testes instaladas, executar na raiz do candidato:

```text
node --test tests/sim-contingency-008.test.mjs
node tests/contingency-forward-return-fixture.mjs CAMINHO_DO_CHECKOUT_UX_F5D7F94
node --test --test-concurrency=1 tests/*.test.mjs
```

A prova entre runtimes exige o checkout UX exato e limpo, com suas dependências instaladas. Não aceita inferir a imagem a partir de uma tag e não acessa infraestrutura real.
