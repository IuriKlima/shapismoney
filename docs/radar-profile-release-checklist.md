# Radar e perfil: checklist de liberação

Estado em 09/10/2026: candidato local validado, ainda sem autorização de publicação. Não houve push, deploy, migração de produção, uso de dados reais, configuração Asaas, cobrança ou envio de respostas a terceiros. Base publicada: `5db29b5758aadbd15d15d0d68dc6c9017961a97c`; branch: `codex/radar-premium-ux`.

## Verificado neste Windows

- [x] 219/219 testes, zero falhas, exit 0, suíte serial após correção do lock em cerca de 204 segundos, com backend instalado limpo. A rodada anterior do candidato ad276ca tinha 218/218.
- [x] Build, lint e typecheck; rotas públicas `/`, `/radar`, `/vendas`, `/privacidade` e área privada existente `/local`.
- [x] Chrome isolado em 1440px, 390px e 320px: sem overflow, Radar voltar/cancelar/sair/repetir, resultado com empates, interesse nos planos, CRM administrativo, perfil cancelar/salvar/recarregar/foto/sair; reduced-motion conferido.
- [x] Perfil editável somente pelo aluno dono; leitura privada segue organização/vínculo; conflitos de revisão e repetição idempotente. Upload com limite de 2 MB, assinatura de JPEG/PNG/WebP, 16 MP, sem animação/SVG; WebP sanitizado e metadados removidos.
- [x] Consentimentos separados e desmarcados; eventos ordenados/idempotentes de cadastro, início, conclusão, resultado e CTA; isolamento do CRM. Respostas, pontuações e fotos não entram nos eventos ou URLs. Não há campanha de marketing automática.
- [x] Cadastro e repetição compartilham limite de 30 requisições de criação por IP/hora. CRM retorna até 200 contatos e as últimas 50 execuções de cada contato; informa o total e preserva o histórico anterior no banco.
- [x] Os sete SQL PostgreSQL anteriores são idênticos, por SHA256, aos do commit publicado. Teste PGlite com registros exclusivamente sintéticos preservou usuários, aluno, anamnese, plano publicado e SLA ao aplicar 008. Uma falha injetada após o DDL deixou sete migrações e nenhuma das seis tabelas novas. A aplicação bem-sucedida e sua repetição preservaram também os novos leads, eventos e conteúdo de foto sintético.
- [x] Runtime de oito migrações rejeita banco com sete; runtime mantém DML nas tabelas novas, sem CREATE no schema ou escrita no catálogo. O teste em memória não substitui PostgreSQL e imagem reais em staging.
- [x] Contexto Docker usa inclusão explícita de fontes/SQL/pacotes e do WebP de marca; exclusões privadas ficam por último. Sentinelas de nomes `.env`, `.npmrc`, bancos, dumps, chaves, fixtures, testes e `.qa` foram conferidas sem ler ou criar dados privados. O teste usa somente o subconjunto comum de padrões; a imagem efetiva continua pendente.

## Bloqueios antes de publicar

- [ ] Foto real de Bruno: receber o caminho local autorizado, ver os pixels, preservar original, otimizar e revisar cortes desktop/390/320. As tentativas anteriores deram 403. Uma nova tentativa única, explicitamente autorizada para `C:\Users\andre\Documents\Brunão\fotos-bruno`, chegou à aplicação de metadados mas falhou com `AttributeError: module 'os' has no attribute 'setxattr'`. A pasta foi criada e continua sem arquivos materializados; as outras quatro transferências não foram executadas. Não houve contorno nem alteração do helper oficial. A captura atual está explicitamente sem foto.
- [ ] Aprovação editorial da regra `SIM_RADAR_SELF_REPORT_V1`, baseada no código fornecido de 15 perguntas; não afirmar reprodução exata das etapas não observadas da versão pública atual. Resultado orientativo por regras locais, sem diagnóstico ou validação científica.
- [ ] Responsável confirmar retenção/remoção dos contatos e fotos, canal de privacidade e texto de uso. E-mail/WhatsApp declarados ainda não são verificados: o formulário não prova a identidade nem legitima campanha automática.
- [ ] Confirmar organização de destino existente e autorizada. Definir `SIM_RADAR_ORG_ID` apenas na configuração operacional segura; ausência ou organização inválida retorna 503. Não escolher tenant por inferência ou configurar credenciais aqui.
- [ ] Conferir HTTPS, origem pública e proxy confiável em staging. Testar o IP observado atrás do proxy para que o limite não agrupe todos os visitantes nem aceite cabeçalhos falsificados.
- [ ] Docker não está disponível neste computador. No servidor autorizado, construir a imagem, fixar commit/digest, testar importação do Sharp 0.35.4 e processamento sanitizado no Linux, conferir usuário sem root, sistema de arquivos somente leitura, conteúdo efetivo e catálogo 001-008. Nenhuma imagem foi construída ou validada aqui.
- [ ] Estabelecer limites operacionais de CPU/memória/processos e validar uploads simultâneos. O Compose atual define `read_only`, mas não define esses limites; tamanho e pixels limitados não substituem teste de carga do Sharp.
- [ ] Restaurar backup autorizado em staging privado, aplicar 008 com migrador dedicado, conferir preservação, permissões e readiness; repetir migração. Não usar credenciais do runtime para DDL, nem criar fixtures em produção.
- [ ] Coordenar migrações ainda não aplicadas com a branch de comércio, sem tocar seu checkout. Não alterar número/checksum de migração já aplicada. Reexecutar testes após a integração.
- [ ] Preços publicados: mensal R$ 499, trimestral R$ 1.197 total e semestral R$ 1.794 total; anual/específico por contato. Renovação, parcelamento máximo e início da vigência seguem pendentes, sem promessa na LP. Asaas, splits, cobrança e provedores externos permanecem fora desta etapa.
- [ ] Autorização explícita final de publicação depois dos itens acima e da revisão visual/conteúdo.

## Retorno sem apagar novos dados

1. Registrar imagem/configuração anteriores e candidato com digest; preparar e testar uma imagem de retorno compatível com oito migrações. Ela ainda não existe como artefato Docker validado nesta tarefa.
2. Antes de migrar, parar escritores, criar backup completo novo e privado, verificar hash e comprovar restauração em banco isolado. Fotos privadas fazem parte do banco e do backup.
3. Se houver falha antes de reabrir escrita: manter escritores parados, preservar cópia migrada e restaurar o backup comprovado com a imagem anterior de sete migrações.
4. Depois de aceitar novos leads/fotos/edições: manter catálogo 008 e preferir correção ou imagem compatível com 008. A imagem publicada em `5db29b5` espera sete migrações e não pode operar diretamente esse banco.
5. Não dar DROP nas seis tabelas nem apagar o registro 008. Não restaurar um backup antigo como se fosse retorno sem perda: primeiro parar escrita, preservar backup completo atual e submeter os dados posteriores à reconciliação pelo operador.
6. Retenção do histórico ainda depende de decisão operacional. A resposta do CRM está limitada; o banco preserva registros antigos. O limite por IP não elimina abuso distribuído; avaliar controles de borda e monitoramento mínimo em staging.

Detalhamento operacional: [radar-profile-rollout.md](radar-profile-rollout.md). Inventário, origens e comportamento: [radar-profile-ux.md](radar-profile-ux.md).

## Evidência de revisão

Servidor local de QA: `http://127.0.0.1:5191`, somente fixtures sintéticas e adaptadores externos desativados. Evidências privadas em `.qa/full-tests-serial.log`, `.qa/screenshots/` e roteiros Chrome; não incluídas no contexto da imagem.

A captura `shape-is-money-vendas-revisao-sem-foto.png` foi salva na Library, ID `libfile_5220ec715a808191a7212ba8bb2acabd`, versão 0. Ela mostra a LP sem foto de Bruno e sem alunos reais. A identidade exata foi preservada num arquivo privado de metadados local; o helper oficial não pôde aplicar atributos estendidos neste Windows. A tentativa posterior das fotos e seu bloqueio estão descritos acima; a LP continua sem foto.

## Correção do lock após QA do candidato ad276ca

O QA reportou `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` com EUSAGE no build Docker do commit `ad276ca30b4def6fb0ef3b1591e98c37f710b962`. A mesma falha foi reproduzida localmente, com Node 24.19.0 e npm 11.6.2 em diretório isolado: `Invalid: lock file's @emnapi/runtime@1.10.0 does not satisfy @emnapi/runtime@1.11.3`. O npm foi obtido do registry oficial e seu SHA512 conferido; não foi instalado no sistema. Configurações de usuário/global vazias, cache e diretórios isolados evitaram leitura do `.npmrc`, uso de credenciais ou alteração das dependências do checkout original.

A causa foi a resolução de dependências ao copiar a cadeia do Sharp para o lock do backend: os dois pacotes WASM opcionais exigem `@emnapi/runtime ^1.11.3`, enquanto o registro compartilhado era `1.10.0`. O lock principal já possui os dois registros aninhados em `1.11.3` e permanece inalterado. A correção muda somente versão, URL pública e integridade do registro no lock do backend, usando metadados idênticos aos desses registros existentes. Sharp continua em 0.35.4; pg, nodemailer, manifests e todas as outras versões permanecem iguais.

`npm ci` limpo do backend passou no Windows e também com seleção explícita `--os=linux --cpu=x64 --libc=glibc`; nenhum dos dois alterou o lock. A segunda instalação contém Sharp/libvips Linux x64 (glibc e musl) e não o binário Windows. Isso verifica resolução e seleção de pacotes em um host Windows, não execução nativa Linux. Smoke nativo Windows da instalação nova conferiu Sharp 0.35.4, libvips 8.18.6, conversão WebP e remoção de EXIF/ICC. O grafo do lock principal passou em `npm ci --include=dev --dry-run`, sem modificar seu arquivo.

O teste `tests/sim-backend-lock.test.mjs` confere resolução e compatibilidade de todas as dependências obrigatórias/opcionais do backend, inclusive os caminhos WASM de plataformas que não são o host atual. Build, lint, typecheck e 219/219 testes passaram com o backend apontando temporariamente para a instalação limpa; o vínculo anterior foi restaurado ao fim da suíte e os módulos originais não foram alterados. As dependências de frontend permanecem no vínculo de leitura anterior, e o grafo do seu lock foi validado pelo dry-run isolado. Evidências privadas em `.qa/npm-ci-backend-before/`, `.qa/npm-ci-backend-after/`, `.qa/npm-ci-backend-linux-after/`, `.qa/clean-sharp-smoke.json` e `.qa/lock-validation-*.log`. O build Docker e a execução nativa Linux devem ser repetidos pelo QA no novo SHA; nenhuma imagem Linux/Sharp é declarada aprovada aqui.
