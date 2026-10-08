# Chat IA revisável — incremento de 8/10/2026

Este incremento usa a arquitetura existente (backend próprio + Responses), sem sandbox, retrieval ou ferramentas executáveis pelo modelo. Publicar o código não habilita IA nem autoriza dados pessoais ou gastos adicionais.

## Fluxos implementados

Admin propõe cadastro ou treino para um aluno autorizado. Gerar a proposta não grava cadastro ou treino. A revisão mostra os dados exatos; confirmação envia ID e SHA256 vinculados ao payload, ator, organização, sessão autenticada e prazo. Corpo extra, proposta substituída/expirada, hash divergente, outro usuário ou sessão diferente são recusados. A execução usa os mesmos workers, validações, transação, bloqueios, RBAC, idempotência e auditoria dos formulários. Não existe publicação, convite, senha, SQL ou alteração de papel por IA. Um treino confirmado fica em draft e continua exigindo submit/approve/publish pelos endpoints existentes.

Aluno recebe somente até três planos publicados do próprio cadastro. Nome, e-mail, notas internas, onboarding e outros alunos não são fornecidos como contexto automático. Sua mensagem livre pode conter dados pessoais/saúde: o consentimento informa envio à OpenAI para esta conversa, junto do histórico e plano publicado. Não é autorização para campanhas, diagnóstico ou uso de dados de terceiros. Relatos não são compartilhados automaticamente: outro checkbox autoriza último relato e inferências aos administradores da mesma organização. O hash vincula esse consentimento à versão exibida. Fatos retornam do servidor; hipóteses do modelo aparecem separadas. Nutrição/prescrição alimentar não estão disponíveis neste módulo: dependem de fluxo próprio com profissional habilitado e responsável aprovado.

## Limites e retenção

- Mensagem: 1.200 caracteres; requisição JSON: 16 KiB; contexto completo: 18.000 bytes UTF-8. Exceder recusa antes do provedor.
- Até seis turnos por conversa, oito conversas abertas por usuário e mil conversas/relatos em memória por instância.
- Sessão vinculada a usuário, tenant, papel e hash de sessão HttpOnly, com acesso expirando em 20 minutos. Logout limpa suas conversas. Limpeza de memória ocorre também a cada minuto; restart elimina conversas e relatos. Histórico longitudinal ainda não está implementado. Uma réplica é o modo operacional deste incremento; sem afinidade, outro processo recusa sessão desconhecida.
- Respostas: máximo 700 tokens, 32 KiB recebidos, 2.000 caracteres de orientação e cinco inferências de até 400 caracteres. Timeout 20 segundos; uma mensagem concorrente por conversa, cinco reservas por minuto por usuário, sem retry automático.
- Responses usa store=false, service_tier=default, reasoning none e schema estrito; não envia tools. Isso não elimina regras de retenção operacional da OpenAI, que devem ser revisadas antes de dados reais.
- Orçamento em USD, acumulado globalmente nesta instalação, incluindo todos usuários/organizações/réplicas. Não é quota mensal nem fatura. Cada tentativa reserva conservadoramente `(bytes de input/instruções/schema + 2048) × tarifa input + 700 × tarifa output`, dividido por 1 milhão. Bytes fornecem teto conservador para tokens; margem cobre enquadramento. Usar a maior tarifa aplicável (inclusive escrita em cache). Não há refund em erro, recusa ou timeout.
- Reservas persistem na tabela operations, sob prefixo ai-budget-, sem mensagem/chave. Bloqueio PostgreSQL advisory transaction 519004 serializa cálculo/INSERT entre processos; papel sim_app existente basta. Ledger inválido ou orçamento insuficiente recusa sem chamar provedor. Reinício/deploy não renova saldo. Reservas são estimativas conservadoras, não billing real nem hard limit da conta OpenAI. Não apagar ledger para liberar gastos.

## Ativação limitada futura — NÃO aplicada

Bruno deve revisar finalidade, política de privacidade/retenção, acesso de responsáveis, dados autorizados e valor incremental. Primeiro teste administrativo pode usar somente dados fictícios; não criar contas reais para QA. Admin real já existente pode ser incluído por seu UUID; aluno real somente após consentimento apropriado e seleção explícita de seu UUID. Coach/nutrition não ganham chat real neste incremento; cenário sintético legado continua separado.

Exige simultaneamente:

- SIM_AI_ENABLED=true, SIM_AI_CHAT_ENABLED=true, SIM_AI_CHAT_REVIEWED=true.
- SIM_AI_CHAT_USER_IDS: 1–10 UUIDs autorizados separados por vírgula; somente papéis admin/student. Não aceita papel enviado pelo cliente.
- SIM_AI_CHAT_UNTIL: instante ISO futuro, no máximo sete dias à frente. Expiração desliga disponibilidade.
- SIM_AI_CHAT_MODEL=gpt-6-luna; outro modelo exige implementação e revisão própria.
- SIM_AI_CHAT_BUDGET_USD: >0 e <=5, valor cumulativo autorizado para a instalação, levando em conta reservas já existentes. Não presumir autorização adicional a partir do smoke de US$0,10.
- SIM_AI_CHAT_INPUT_USD_PER_MILLION e SIM_AI_CHAT_OUTPUT_USD_PER_MILLION: USD por milhão de tokens, positivos e explicitamente revisados. Referência consultada em 8/10/2026: input normal 0,10; escrita em cache 0,125; output 0,50. Usar input conservador 0,125 apenas enquanto continuar sendo maior tarifa aplicável. Preços não são eternos.
- SIM_AI_CHAT_PRICE_REVIEWED_AT: instante ISO da revisão de preço, no passado e há no máximo 30 dias. Configuração incompleta/antiga falha fechada.
- Secretfile já instalado continua no destino autorizado; não colocar chave em .env, Git, browser storage ou chat.

Staging publicado conserva SIM_AI_ENABLED=false. Flags de chat ausentes equivalem a false; não montar novo segredo, alterar origem, allowlist, banco ou outros projetos para este deploy.

## Fontes originais consultadas localmente

`C:\Users\andre\Documents\Brunão\SIM_Training_Intelligence_Spec_v1_0.docx`, versão 20/09/2026: motor de regras + LLM + revisão humana, níveis de autonomia 0–2 no MVP, cinco eixos, evidências versus hipóteses, sem diagnóstico ou plano alimentar sem profissional responsável.

`C:\Users\andre\Documents\Brunão\Shape_Is_Money_PRD_Atendimento_Relacionamento_v1.pdf`, versão 03/08/2026: menor privilégio, somente conteúdos publicados para o cliente, seção 15 de IA, não automatizar contatos sensíveis, não rotular alunos, não inventar causalidade entre treino e faturamento.

São fontes de implementação, não acervo conectado ao modelo. Este incremento não implementa avaliação por fotos, anamnese completa, ciclo, reavaliação, progressão ou memória longitudinal. Não copia documentos confidenciais para Git/OpenAI. Conectar corpus e prescrições completas exige etapa posterior própria.

Referências técnicas: https://developers.openai.com/api/docs/guides/structured-outputs , https://developers.openai.com/api/docs/models/gpt-6-luna , https://developers.openai.com/api/docs/pricing , https://developers.openai.com/api/docs/guides/your-data .
