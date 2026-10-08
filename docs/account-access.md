# Cadastro, autorização manual e senha

Bruno cadastra nome e e-mail normalizado e escolhe o acesso manual. Nota e vencimento são opcionais. Níveis técnicos: **Treino** (`training`) e **Treino e Nutrição** (`training-nutrition`); não são preços, planos comerciais ou papéis administrativos. Contas antigas mantêm suas permissões até alteração explícita. Cadastros antigos sem conta precisam de nível explicitado para o novo fluxo por e-mail; convites privados continuam disponíveis.

Com transporte habilitado, o cadastro enfileira boas-vindas com o endereço normal do aplicativo. O aluno escolhe **Criar conta**, informa o mesmo e-mail autorizado, confirma acesso à caixa postal e define sua senha. A identidade só é criada após essa prova e nova conferência da autorização. O registro e os planos pré-atribuídos são preservados. Destinatários desconhecidos, sem autorização ou ambíguos entre organizações recebem a mesma resposta pública, sem criação de conta. O aluno nunca escolhe nível, organização ou papel.

**Esqueci minha senha** recupera uma conta existente, preserva papel e autorização e revoga todas as sessões antigas. Não concede acesso pago. Links aleatórios de 256 bits expiram em 15 minutos e são consumidos atomicamente uma única vez; mudanças de autorização invalidam links anteriores. Senhas de 14–128 caracteres usam scrypt. Limites persistentes por IP/e-mail e validação de origem incluem destinatários ausentes.

## Transporte pendente

A preferência é concentrar o e-mail na Hostinger. O adaptador SMTP está preparado, sem pressupor caixa ou plano já contratado. Metadados necessários: `SIM_MAIL_PROVIDER=smtp`, host confirmado em `SIM_SMTP_HOST`, porta 465 (TLS direto) ou 587 (STARTTLS obrigatório), `SIM_SMTP_USER` igual ao remetente em `SIM_MAIL_FROM` e `SIM_SMTP_PASSWORD_FILE=/run/secrets/sim_smtp_password`. A senha deve existir somente no armazenamento privado do servidor. Verificação de certificado e hostname permanece obrigatória, com TLS mínimo 1.2; não há logs de SMTP, pooling, acesso a arquivo/URL nas mensagens ou retentativa automática. Consulte o [contrato SMTP do Nodemailer](https://nodemailer.com/smtp). O remetente e o domínio ainda dependem da conferência da caixa no hPanel. Não há criação de conta, compra de plano, servidor de e-mail na VPS ou envio real nesta entrega.

Não há SMTP/provedor/remetente existente nos exemplos do repositório. Nenhuma conta externa, credencial ou mensagem real foi criada. Resend é apenas adaptador candidato, sujeito à escolha do responsável; consulte o [contrato oficial de envio](https://resend.com/docs/api-reference/emails/send-email).

Entrega externa fica desligada por padrão com `SIM_ACCESS_EMAIL_ENABLED=false` e `SIM_ACCESS_EMAIL_REVIEWED=false`. A interface desabilita pedidos por e-mail, explica o bloqueio e mantém login e **Recebi um convite**. O backend retorna indisponibilidade sem alegar envio. Cadastro manual continua salvo e pode receber convite privado.

Para ativar futuramente, faltam decidir/revisar provedor, remetente/domínio verificado, origem HTTPS canônica e referência privada da credencial. O candidato exige `SIM_MAIL_PROVIDER=resend`, endereço simples em `SIM_MAIL_FROM` e `SIM_MAIL_API_KEY_FILE=/run/secrets/sim_mail_api_key` em produção. Monte o segredo no servidor com permissões restritas, sem symlinks, fora de Git, argumentos e imagem. Nunca coloque a chave no formulário ou documentação. Configuração incompleta falha fechada. Esta entrega não configura ou publica essas opções.

## Persistência

Sem nova migração: autorizações versionadas e outbox usam `operations`. Origem manual, organização, aluno, nível, vencimento e emissor são auditáveis. Identidade e autorização ficam separadas. Outbox contém metadados e estados, nunca senha, chave, token em texto ou link. Worker gera token em memória no despacho e persiste apenas hash. O fragmento do link é apagado da URL pela interface e não entra em query, storage ou auditoria. Mensagens contêm somente acesso, sem treino, PDF ou dados de saúde.

Envio ocorre fora da resposta HTTP. `accepted` indica aceitação pelo provedor, sem afirmar entrega na caixa postal. Falha recebe diagnóstico genérico e não tem retentativa automática. Lease interrompido vira `delivery-unknown`, sem duplicar mensagem. Organização, emissor, autorização e destino são revalidados antes do envio e consumo. Transporte simulado é proibido em produção.

## Asaas futuro

Não há webhook, cobrança ou liberação automática implementada. Um futuro adaptador deve validar autenticação/assinatura conforme contrato oficial vigente, conferir evento e pagamento no servidor, aplicar idempotência por evento, vincular organização/e-mail normalizado e mapear níveis permitidos pelo servidor. O navegador não fornece origem Asaas nem prova de pagamento. Autorizações manuais permanecem exceções auditáveis. Revogação, duplicação e eventos fora de ordem precisam de regras aprovadas antes de habilitar integração.
