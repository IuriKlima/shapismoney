# Shape IS Money Implementation Plan

Goal: entregar landing page e sistema de acompanhamento com compra demonstrativa.
Architecture: Vinext/React com API server-side, D1 e R2, privado via autenticação Sites. Demo de aluno/personal isolada por usuário autenticado.
Spec: docs/design.md.

- [ ] Modelar dados e testar prazo de 48h, limite de 3 dias úteis e publicação sem plano.
- [ ] Implementar API de perfis, anamnese, planos, evolução, comunidade e check-ins com validação e isolamento.
- [ ] Construir identidade, landing page e fluxo de adesão.
- [ ] Construir dashboard e navegação, treino, evolução, comunidade, ranking e perfil.
- [ ] Implementar gestão do personal e edição/publicação de planos.
- [ ] Gerar migrations, compilar e verificar desktop/mobile; publicar prévia privada.

Review focus: envio duplicado de check-in, acesso entre identidades, imagem inválida, formulário incompleto e prazo encerrado sem plano preparado.

## Prioridade atual: aplicativo real para o Bruno vender

O plano acima registra a etapa demonstrativa original. O acompanhamento persistente atual usa backend Node/PostgreSQL no staging restrito da VPS; a interface premium já foi publicada. A próxima prioridade é IA funcional e os fluxos essenciais, com Asaas ao final. Central de carrosséis permanece apenas exploratória e não é outro projeto ativo.

1. Preparar leitura privada de `OPENAI_API_KEY_FILE`, disponibilidade por papel e testes com mocks. Confirmar destino/escopo separado para chave de staging antes de provisionar ou ativar. Primeiro teste externo apenas sintético e neutro, autorizado separadamente.
2. Assistência administrativa: começar com propostas estruturadas sem escrita automática. Cada ação futura precisa reutilizar autorização por organização/aluno, validação, confirmação explícita e auditoria; testes devem impedir acesso cruzado e duplicação. Não conceder papel profissional implicitamente ao administrador.
3. Assistência ao estudante: limitar ao plano publicado e ao próprio registro, começando sem dados reais enviados ao provedor. Não diagnosticar nem alterar prescrições; respostas apoiadas no contexto autorizado e encaminhamento ao profissional quando faltar informação.
4. Nutrição: implementar primeiro o fluxo persistente com revisão, autoria e escopo do profissional. Só depois adicionar assistência de IA; o chat sintético atual não constitui prescrição nutricional.
5. Conhecimento: obter os documentos originais autorizados do Bruno, preservar fonte/versão e testar recuperação/citações com corpus fictício primeiro. Não apresentar os textos de marketing do demo como corpus PRISMA validado. Ausência de fonte deve produzir resposta de contexto insuficiente.
6. Asaas, provider escolhido pelo usuário: implementar adaptador e testes com mocks, depois sandbox com conta/token do proprietário e autorização específica. Antes da integração, verificar documentação oficial vigente para taxas, parcelamento, webhook/autenticidade e idempotência. Nenhuma conta, credencial, cobrança, contrato ou custo real é criado nesta preparação.

Valores comerciais confirmados: mensal R$499; trimestral R$1.197; semestral R$1.794; vendedor absorve juros. Plano anual encaminha lead ao CRM. Não assumir taxa fixa para pagamento parcelado nem converter esses valores em cobrança sem validar duração, parcelamento, política e aceite do proprietário. A conta Asaas e os tokens de sandbox/produção continuam pendentes.
## Incremento IA revisável

Implementado chat isolado e propostas confirmáveis para admin; orientação do aluno restrita ao plano publicado, hipóteses separadas e relato à administração apenas com consentimento específico. Workers/RBAC/auditoria/idempotência existentes reutilizados. Sem chamadas pagas nos testes. Gates adicionais, orçamento durável, limitações e documentos originais consultados: [ai-chat.md](ai-chat.md). Publicação mantém IA desativada; corpus original, memória longitudinal e prescrição nutricional continuam etapas posteriores.
