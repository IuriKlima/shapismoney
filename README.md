# Shape IS Money

Interface demonstrativa em português, com a marca vetorial fornecida por Bruno. A fonte canônica da interface é `public/sim/`, montada por React em `components/SIMWorkspace.tsx`. As rotas `/`, `/app`, `/comecar` e `/crm` usam a mesma implementação.

## Rodar e validar

Node 22.13 ou superior, com npm no PATH:

```sh
npm ci
npm run dev
```

Abra a URL loopback impressa, normalmente http://127.0.0.1:5173. Em outro terminal, execute `npm run demo:media` para a biblioteca opcional e o preview independente em http://127.0.0.1:5174. Sem biblioteca, a interface informa que o vídeo está indisponível. Não há download nem upload dos vídeos.

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

Os testes de UI usam jsdom para verificar DOM e fluxos locais; não medem layout, desempenho de vídeo ou dimensões reais no navegador. Antes de publicar, confira visualmente em 320/390 px, orientação horizontal, teclado móvel e desktop.

## Biblioteca local

Copie `.env.example` para `.env.local` e preencha somente `SIM_VIDEO_DIR` com a pasta que contém `indice-videos.csv` e os MP4 originais. O servidor aceita também `--video-dir <pasta>` e `--port 5174`. O preview vincula vídeos sob demanda, sem autoplay ou preload de mídia. O catálogo contém somente metadados. Mudar a porta exige passar `mediaOrigin` ao mount da interface.

Não copie vídeos, PDFs privados, credenciais ou diretórios temporários para o Git. `.env.local`, `.qa/`, dependências e builds são ignorados; `.env.example` é apenas um template público sem chaves. O build não precisa de OpenAI.

## Planos e responsáveis

- Mensal: R$ 499.
- Trimestral: R$ 1.197, em 3x de R$ 399.
- Semestral: R$ 1.794, em 6x de R$ 299.
- Parcelamento sem acréscimo ao aluno; custo absorvido pelo vendedor. Gateway e taxas efetivas ainda precisam ser escolhidos.
- Anual/projeto personalizado: formulário de interesse que cria ou atualiza um lead **somente no CRM local da demonstração**, sem contato externo.

Bruno: @treinadorbrunobarbosa. Nutrição: Sanches; nome civil, CRN exato, base alimentar e porções validadas permanecem pendentes. O administrador pretendido é brunobarbosapersonal@yahoo.com.br; nenhum usuário privilegiado ou conta foi criado.

## Fronteira entre demonstração e produção

Em loopback, dados fictícios ficam em localStorage deste navegador. A troca Aluno/Equipe é um controle demonstrativo, sem autorização real de papéis. Não use dados pessoais, de saúde ou credenciais reais. Cadastro, interesse, revisão nutricional e chat não enviam convites, não realizam pagamentos e não chamam IA. Reload preserva registros e a etapa de onboarding; cadastro duplicado usa e-mail normalizado.

Fora de loopback, esta UI mostra uma prévia sem formulários ativos ou armazenamento demonstrativo. As rotas protegidas mantêm a autenticação ChatGPT/Sites antiga. `?legacy=1` fica disponível somente em desenvolvimento; a implementação antiga e seus testes permanecem no repo, mas não representam uma operação comercial pronta.

Antes de uso real: implementar autenticação independente e autorização de papéis, backend/persistência por usuário, convites seguros, gateway/webhooks/idempotência de pagamento, tratamento de consentimento e dados de saúde, IA no servidor com revisão profissional, anamnese completa e avaliação de 17 fotos. Nenhuma dessas integrações é apresentada como concluída por esta entrega. Não há commit, push ou deploy automático.

## Marca

`public/sim/logo.svg` contém os primeiros 12 paths da marca SHAPE IS/MONEY no PDF fornecido, região x75,59–242,62 / y295,89–432,39. TANGRAM e 75HARD foram excluídos. Os paths originais e seus transforms são preservados.

### Chat de IA local

Em outro terminal, execute `npm run dev:ai` (Node 24 com `--use-system-ca`). O serviço escuta somente `127.0.0.1:5174`; o chat da equipe em `http://127.0.0.1:5173/crm` envia apenas uma de três perguntas fictícias preparadas, após consentimento. Também pode abrir `http://127.0.0.1:5174/crm`. Configure `OPENAI_API_KEY` somente em `.env.local` e, opcionalmente, `OPENAI_MODEL`. A chave nunca integra os assets ou respostas. Erros de rede, credencial, cota e resposta incompleta aparecem como erros, sem respostas simuladas de sucesso.

O endpoint verifica Host, Origin e endereço loopback; limita requisição a 2 KB, resposta upstream a 32 KB, texto a 4.000 caracteres, tempo a 20 segundos e cinco solicitações por minuto, sem concorrência. Em NODE_ENV=production retorna 404. Não existe endpoint de IA público autenticado nesta etapa. Nenhuma escrita de CRM, aluno ou plano é executada pela IA; propostas dependem de revisão profissional. Login próprio, RBAC e banco persistente serão necessários antes de ativar dados reais ou publicar na VPS. Não reutilizar serviços dos projetos existentes no EasyPanel sem uma avaliação e autorização específicas.

### Primeira fatia persistente independente

`npm run dev:backend` abre `http://127.0.0.1:5190/local`, com a mesma identidade visual e assets canônicos, mas separado da demo/localStorage. Requer Node 24. O SQLite local fica em `.qa/local-backend/app.sqlite`, ignorado no Git; migrations versionadas com checksum rodam na inicialização. O banco começa vazio e **nenhuma conta ou administrador é provisionado**. Contas fictícias existem apenas nas fixtures de testes, em diretórios temporários isolados. A UI permite login, cadastro manual com revisão/confirmação, onboarding no servidor e treino rascunho → revisão → aprovação profissional → publicação. Cadastro de aluno não cria acesso nem envia convite.

Sessões opacas aleatórias têm somente o hash armazenado no banco, expiram em oito horas e são revogadas no logout; cookies locais HttpOnly/SameSite=Strict. Senhas usam scrypt N=32768/r=8/p=1, sal aleatório e comparação constante via Node crypto. O papel e vínculo são sempre consultados no servidor. Personal vê seus alunos; nutri vê apenas alunos vinculados; aluno vê somente seu registro e treinos publicados, sem notas internas. Mutações exigem Origin da mesma origem; cadastro/planos/onboarding exigem chave de idempotência, validam entradas, detectam duplicatas e registram auditoria. Ações futuras do chat devem usar esse mesmo serviço validado, sem conceder escrita direta ao modelo.

**Checkpoint de release, sem deploy realizado:** a camada de persistência é assíncrona; PostgreSQL tem adaptador, migrations transacionais/checksummed e testes SQL em PostgreSQL embarcado. O SQLite continua exclusivo de desenvolvimento. A inicialização de produção exige origem HTTPS canônica, IPs explícitos do proxy, papel de banco limitado e migrations correspondentes; não há fallback SQLite nem seeds. Cookies de produção são Secure/HttpOnly/SameSite e usam prefixo __Host-. Dockerfile, Compose isolado, healthcheck e handoff estão em [deploy/README.md](deploy/README.md). Falta homologar imagens/containers, conexão real pg pela rede, HTTPS/proxy e backup/restore em ambiente aprovado: esta máquina não possui Docker/PostgreSQL nativo. O destino é o novo serviço `medsi/shape-is-money`; preservar `medsi/app` e todos os serviços de `askadia`, com banco/volume/configuração exclusivos. Nenhum dado da demo será migrado automaticamente.

Handoff de acesso: após aprovação explícita, provisionar a organização e o administrador pretendido pelo comando interativo `node backend/bootstrap-admin.mjs` no servidor, com senha definida pelo próprio usuário/fluxo seguro e nunca em argumentos, arquivos públicos ou logs. `brunobarbosapersonal@yahoo.com.br` ainda não é uma conta deste backend. O bootstrap manual está implementado, mas não foi executado para contas reais. Envio de e-mail, reset de senha, nutrição persistente, edição/versionamento de planos e uploads autenticados seguem pendentes; os endpoints de upload retornam indisponibilidade, sem processamento de arquivo. Pagamentos ficam para depois. Usar somente dados fictícios nesta fase local.

Referências de implementação: [Node 24 SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) e [Node 24 crypto/scrypt](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

### IA no fluxo autenticado

No backend persistente, a rota legada `/api/local/ai` permanece desativada (HTTP 503), inclusive com `SIM_AI_ENABLED=true`; suas capabilities nunca anunciam disponibilidade. O runtime e a imagem de produção não incluem o handler de demonstração. Somente `/api/local/ai/chat/*` pode chamar o provedor, sujeito a papel, allowlist, prazo, consentimento e reserva durável de orçamento. `SIM_AI_ENABLED=false` continua sendo o padrão. O protótipo local separado `dev:ai` usa apenas exemplos fictícios e não faz parte da imagem persistente. Testes usam providers mock, sem chamadas pagas. Produção não recebe automaticamente a chave dev; acesso e segredos de produção exigem handoff separado aprovado.

Homologação HTTPS restrita: usar `SIM_DEPLOYMENT_STAGE=staging`, IPs exatos em `SIM_STAGING_CLIENT_IPS` e `SIM_PRODUCTION_REVIEWED=false`; mantém os requisitos de DB/proxy/cookies de produção. Ver [handoff](deploy/README.md) antes de autorizar produção ou provisionamento.


## Administração de alunos e treino

O administrador autenticado pode cadastrar alunos, registrar onboarding informado por eles e conduzir treino manual de rascunho até revisão, aprovação e publicação, somente na própria organização. O personal continua limitado aos seus alunos vinculados. O servidor verifica o papel na sessão; alterações de onboarding e treino exigem revisão atual e chave de idempotência, com auditoria. O onboarding direto do aluno continua restrito à própria conta.

Cadastro não cria conta, senha ou convite para o aluno. O administrador não recebe papel de nutricionista nem acesso à IA profissional automaticamente. Recuperação de senha, nutrição persistente e uploads seguem pendentes. Primeiro administrador continua exigindo bootstrap interativo e aprovação; não há seed ou conta automática.


### Convites com entrega manual

O administrador autenticado gera convites somente na própria organização. Alunos são vinculados a cadastro existente com e-mail correspondente; profissionais usam um fluxo separado com personal ou nutrição, sem conceder administrador ou comprovar certificação. Nenhuma conta existente tem papel alterado. O administrador deve conferir a identidade do destinatário e entregar o código em canal privado; posse do código e e-mail correspondente autorizam a ativação, sem alegar verificação automática de caixa postal.

O aplicativo não configura SMTP nem envia e-mail. Código aleatório de 256 bits, validade de 30 minutos, hash SHA-256 no banco, retorno somente na primeira criação e nunca no cache de idempotência/auditoria. Novo convite invalida códigos anteriores do mesmo destinatário na organização. Ativação usa POST JSON com código/e-mail/senha de 14–128 caracteres definida pelo destinatário, consumo atômico e rollback completo quando o vínculo mudou. Limites por IP (8 ativações/15 min) e administrador (10 criações/15 min), proteção de origem e HTTPS mantidas. Código não entra em URL, localStorage, analytics ou referrer; a interface o apaga ao sair, ocultar ou perder sessão. Após ativar, entre normalmente e preencha onboarding.

Antes de atualizar o staging, aplicar **002-invitations.sql** usando somente `sim_migrator`, preservando banco/volume e as migrações antigas; a aplicação continua `sim_app`. Sem a migração nova, startup falha fechado pela conferência de checksums. Não iniciar deploy antes de preparar essa migração. Nenhum administrador, convite, código persistente ou destinatário real foi criado por esta implementação. Envio de e-mail, recuperação de senha e atribuição/reafetação de alunos a novos profissionais permanecem etapas separadas.

### Supervisão administrativa do Bruno

A navegação **Supervisão** reúne o aluno selecionado, execução registrada (até 100 treinos), meta semanal do último treino publicado, prazos de 48h/72h, responsáveis técnicos, estados dos planos e eventos auditados. Alimentação sem registro de consumo não recebe indicador de aderência; evolução física não é inferida de cargas ou repetições.

A administração da própria organização pode consultar a anamnese original com consentimento de treinamento **SIM_INTAKE_PURPOSES_V2**, que menciona explicitamente a supervisão do Bruno. Consentimentos V1 não liberam esse novo acesso. A autorização administrativa é uma opção separada: o aluno pode concluir e atualizar sua anamnese mantendo apenas o acompanhamento profissional V1, sem consentir com a supervisão do Bruno. A autorização nutricional V2 permite a Bruno consultar refeições, porções e alternativas já prescritas para supervisão; sem ela o dashboard mostra somente estados e responsáveis. Retirada de autorização bloqueia as respostas para a equipe/admin; o aluno conserva acesso às suas respostas. Cada leitura administrativa de respostas ou dashboard gera auditoria sem copiar narrativas sensíveis. São exibidas a versão do questionário, a revisão atual e a identidade/revisão da conferência técnica; o banco mantém as respostas atuais, não um arquivo de respostas de todas as revisões anteriores.

Bruno registra próximos passos internos com confirmação e controle de concorrência. Pode devolver planos não publicados, acrescentando o motivo à nota interna e retirando a aprovação para nova revisão pelo responsável. Planos publicados são imutáveis e exigem nova versão. A supervisão não concede CRN, prescrição alimentar ou assinatura técnica à administração. Não há envio destes dados à IA nesta funcionalidade, alteração de papel, nova migração ou publicação automática.

### Propostas de treino personalizadas — bloco local

O fluxo local simulado prepara propostas pela anamnese revisada, exige escolha opcional específica do aluno e salva somente rascunhos conferidos/editáveis. Sinais de atenção exigem resolução explícita do personal antes de aprovar ou publicar qualquer treino, inclusive manual. Desligado por padrão e sem conexão externa; metodologia privada aguarda validação do Bruno. Geração de cardápio permanece pendente. Consulte [escopo e limites](docs/training-proposals.md).
