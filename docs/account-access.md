# Cadastro, autorização manual e senha

Bruno cadastra nome e e-mail normalizado e escolhe o acesso manual. Nota e vencimento são opcionais. Níveis técnicos: **Treino** (`training`) e **Treino e Nutrição** (`training-nutrition`); não são preços, planos comerciais ou papéis administrativos. Contas antigas mantêm suas permissões até alteração explícita. Cadastros antigos sem conta precisam de nível explicitado para o novo fluxo por e-mail; convites privados continuam disponíveis.

Com transporte habilitado, o cadastro enfileira boas-vindas com o endereço normal do aplicativo. O aluno escolhe **Criar conta**, informa o mesmo e-mail autorizado, confirma acesso à caixa postal e define sua senha. A identidade só é criada após essa prova e nova conferência da autorização. O registro e os planos pré-atribuídos são preservados. Destinatários desconhecidos, sem autorização ou ambíguos entre organizações recebem a mesma resposta pública, sem criação de conta. O aluno nunca escolhe nível, organização ou papel.

**Esqueci minha senha** recupera uma conta existente, preserva papel e autorização e revoga todas as sessões antigas. Não concede acesso pago. Links aleatórios de 256 bits expiram em 15 minutos e são consumidos atomicamente uma única vez; mudanças de autorização invalidam links anteriores. Senhas de 14–128 caracteres usam scrypt. Limites persistentes por IP/e-mail e validação de origem incluem destinatários ausentes.

## Transporte pendente

### Contrato exato de ambiente SMTP

| Variável | Valor/condição do runtime |
| --- | --- |
| `SIM_ACCESS_EMAIL_ENABLED` | `false` ou ausente desliga tudo e não lê segredo; somente a string `true` habilita a conferência |
| `SIM_ACCESS_EMAIL_REVIEWED` | Deve ser exatamente `true` para ativação; manter `false` enquanto pendente |
| `SIM_MAIL_PROVIDER` | `smtp`, sem valor padrão no código |
| `SIM_MAIL_FROM` | Endereço simples do remetente, sem nome de exibição, até 254 caracteres ASCII |
| `SIM_SMTP_HOST` | Host DNS confirmado do provedor; não há padrão no código |
| `SIM_SMTP_PORT` | String `465` para TLS implícito ou `587` para STARTTLS obrigatório; ausente falha fechado. O template público sugere `465` |
| `SIM_SMTP_USER` | Endereço completo da caixa, exatamente igual a `SIM_MAIL_FROM` |
| `SIM_SMTP_PASSWORD_FILE` | Em produção, caminho exato `/run/secrets/sim_smtp_password`, montado privadamente |
| `SIM_PUBLIC_ORIGIN` | Origem HTTPS canônica aprovada, sem caminho, query ou credenciais; usada para os links e conferida pelo contrato de segurança de produção |

Não existem variáveis para desligar TLS ou a verificação de certificado. `secure` é `true` somente na porta 465; `requireTLS=true`, `tls.servername=SIM_SMTP_HOST`, `tls.rejectUnauthorized=true` e `tls.minVersion=TLSv1.2` permanecem fixos. Conexão e saudação têm limite de 5 segundos; socket, 8 segundos; o worker limita o despacho a 10 segundos. `pool`, `logger` e `debug` ficam desabilitados. Nenhuma conexão é aberta pela simples leitura da configuração: o transporte é carregado quando o worker despacha uma mensagem autorizada.

O servidor lê `process.env` no startup e, somente com os dois gates habilitados e metadados válidos, lê o arquivo privado uma vez. A imagem inicia `node backend/server.mjs`, sem carregar `.env.local` automaticamente; suas variáveis devem vir da configuração do container. O script local `dev:backend` usa `--env-file-if-exists=.env.local`. Não há recarga dinâmica: mudar metadados ou arquivo exige reinício coordenado. Os gates preexistentes de produção, origem/proxy e banco continuam obrigatórios.

O arquivo e seus diretórios não podem ser symlinks. Em Linux, proprietário deve ser root ou o UID do processo; escrita/execução de grupo e qualquer acesso de outros são rejeitados (`mode & 0o037` deve ser zero). Exemplo admissível: arquivo `0440`, proprietário root e grupo do processo. Conteúdo de 1–4096 bytes, após `trim`, deve conter somente ASCII imprimível sem espaços. Nenhum valor de senha é aceito via variável de ambiente pelo adaptador. `SIM_MAIL_API_KEY_FILE` pertence somente ao candidato Resend e não é usado com `SIM_MAIL_PROVIDER=smtp`.

A preferência é concentrar o e-mail na Hostinger. O adaptador SMTP está preparado, sem pressupor caixa ou plano já contratado. Metadados necessários: `SIM_MAIL_PROVIDER=smtp`, host confirmado em `SIM_SMTP_HOST`, porta 465 (TLS direto) ou 587 (STARTTLS obrigatório), `SIM_SMTP_USER` igual ao remetente em `SIM_MAIL_FROM` e `SIM_SMTP_PASSWORD_FILE=/run/secrets/sim_smtp_password`. A senha deve existir somente no armazenamento privado do servidor. Verificação de certificado e hostname permanece obrigatória, com TLS mínimo 1.2; não há logs de SMTP, pooling, acesso a arquivo/URL nas mensagens ou retentativa automática. Consulte o [contrato SMTP do Nodemailer](https://nodemailer.com/smtp). O remetente e o domínio ainda dependem da conferência da caixa no hPanel. Não há criação de conta, compra de plano, servidor de e-mail na VPS ou envio real nesta entrega.

Não há SMTP/provedor/remetente existente nos exemplos do repositório. Nenhuma conta externa, credencial ou mensagem real foi criada. Resend é apenas adaptador candidato, sujeito à escolha do responsável; consulte o [contrato oficial de envio](https://resend.com/docs/api-reference/emails/send-email).

Entrega externa fica desligada por padrão com `SIM_ACCESS_EMAIL_ENABLED=false` e `SIM_ACCESS_EMAIL_REVIEWED=false`. A interface desabilita pedidos por e-mail, explica o bloqueio e mantém login e **Recebi um convite**. O backend retorna indisponibilidade sem alegar envio. Cadastro manual continua salvo e pode receber convite privado.

Para ativar futuramente, faltam decidir/revisar provedor, remetente/domínio verificado, origem HTTPS canônica e referência privada da credencial. O candidato exige `SIM_MAIL_PROVIDER=resend`, endereço simples em `SIM_MAIL_FROM` e `SIM_MAIL_API_KEY_FILE=/run/secrets/sim_mail_api_key` em produção. Monte o segredo no servidor com permissões restritas, sem symlinks, fora de Git, argumentos e imagem. Nunca coloque a chave no formulário ou documentação. Configuração incompleta falha fechada. Esta entrega não configura ou publica essas opções.

## Persistência

Sem nova migração: autorizações versionadas e outbox usam `operations`. Origem manual, organização, aluno, nível, vencimento e emissor são auditáveis. Identidade e autorização ficam separadas. Outbox contém metadados e estados, nunca senha, chave, token em texto ou link. Worker gera token em memória no despacho e persiste apenas hash. O fragmento do link é apagado da URL pela interface e não entra em query, storage ou auditoria. Mensagens contêm somente acesso, sem treino, PDF ou dados de saúde.

Envio ocorre fora da resposta HTTP. `accepted` indica aceitação pelo provedor, sem afirmar entrega na caixa postal. Falha recebe diagnóstico genérico e não tem retentativa automática. Lease interrompido vira `delivery-unknown`, sem duplicar mensagem. Organização, emissor, autorização e destino são revalidados antes do envio e consumo. Transporte simulado é proibido em produção.

## Asaas futuro

Não há webhook, cobrança ou liberação automática implementada. Um futuro adaptador deve validar autenticação/assinatura conforme contrato oficial vigente, conferir evento e pagamento no servidor, aplicar idempotência por evento, vincular organização/e-mail normalizado e mapear níveis permitidos pelo servidor. O navegador não fornece origem Asaas nem prova de pagamento. Autorizações manuais permanecem exceções auditáveis. Revogação, duplicação e eventos fora de ordem precisam de regras aprovadas antes de habilitar integração.
