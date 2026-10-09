# Rascunhos nutricionais externos

Esta fatia reutiliza o fluxo manual de nutrição e o adapter Responses existente. Preparar uma proposta não cria plano; confirmar cria somente nutrition_plans em draft. Submeter, aprovar e publicar continuam ações distintas do nutricionista habilitado e vinculado. Admin não recebe esse papel. Não houve API real, credencial resolvida, envio de mensagem, migração ou deploy nesta implementação.

## Gate e pré-condições

Desativado por padrão. SIM_NUTRITION_EXTERNAL_ENABLED=true é um opt-in independente do chat e do treino. Produção permanece bloqueada no runtime e no fluxo, inclusive com a variável habilitada. Antes de eventual ativação local autorizada são necessários:
- Identidade e registro profissional conferidos pela administração; essa conferência não consulta automaticamente um registro externo.
- Catálogo inicial com fonte, composição por 100 g, estado e alergênicos aprovados.
- Contexto fornecido e revisado pelo nutricionista: metas positivas, tolerâncias absolutas, alergias, alimentos preferidos/excluídos, estrutura de refeições e regras com referência, versão, hash e seção. Livro é referência de regra, nunca composição alimentar.
- Anamnese completa na versão atual, contexto vinculado à sua revisão, à habilitação e ao vínculo do aluno. Nenhuma resposta adicional da anamnese é liberada ao nutricionista ou transferida por este módulo.
- Escolha opcional do próprio aluno: SIM_NUTRITION_PROPOSAL_EXTERNAL_V1, vinculada ao contexto e à anamnese atuais. A escolha de treino ou de acesso não a substitui.
- Transferência do contexto/regras explicitamente aprovada pelo responsável.

Configuração independente: SIM_NUTRITION_MODEL, SIM_NUTRITION_EXPIRES_AT (janela máxima de 24h), SIM_NUTRITION_GLOBAL_MONTHLY_USD, SIM_NUTRITION_ADMIN_MONTHLY_USD, SIM_NUTRITION_INPUT_RATE e SIM_NUTRITION_OUTPUT_RATE. O resolver já existente é usado somente quando o opt-in está habilitado; esta implementação não o executou. Transportes fake requerem offlineTest explícito na configuração injetada de testes, são responses-offline-test/fake-test e nunca são escolhidos pelo bootstrap.

## Validação e cálculos

Manual e gerado compartilham nutrition-validation.mjs. Somente alimento aprovado da mesma organização, preparo exato, gramas em décimos e composição inteira aprovada em centésimos por 100 g. Não há conversão cru/cozido, catálogo fabricado, total inventado pelo modelo ou equivalência automática. Alternativas não podem repetir o item principal ou outra opção.

Alergênicos são normalizados, incluindo leite/milk e ovo/egg; contains e mayContain são checados. Esse vocabulário limitado não é uma garantia clínica nem substitui avaliação profissional/fonte verificada.

nutritionProposalSchemaFor fornece enums contextuais de alimento, regra e evidence. O validador independente exige a estrutura aprovada e usa nutritionTotals no servidor. Metas são fornecidas pelo profissional, não calculadas pelo LLM. Além do total base, limites mínimos/máximos por nutriente verificam que todas as combinações permitidas de alternativas cabem nas tolerâncias aprovadas, sem enumerar exponencialmente nem ajustar porções automaticamente. Energia informada pela fonte e cálculo 4/4/9 continuam distintos.

## Persistência, versões e custo

Nenhuma migração é necessária: operations guarda versões do contexto, escolhas, jobs, propostas preparadas e marcadores de confirmação/plano atual; nutrition_plans e nutrition_choices existentes guardam snapshots e escolhas. Nada dessa persistência depende da demo em memória.

O ledger mensal de instalação/aluno é compartilhado com chat e treino, com finalidade nutrition-proposals na reserva. Não é carteira separada nem fatura ou saldo conhecido da OpenAI. Reserva conservadora antes do envio; teto 8000 tokens de entrada/4000 saída, timeout até 20s, limite compartilhado por minuto. Falhas não repetem, não reembolsam automaticamente e não geram resposta substituta.

Sessão, gate, consentimento, acesso nutricional ativo, habilitação, contexto, vínculo, anamnese e catálogo são rechecados antes da reserva, imediatamente antes do provider, após o retorno e no salvamento/confirmar. Configuração de budget/provider fica vinculada ao startup; alteração exige reiniciar a instância autorizada. Retomada em nova instância recupera a proposta durável na mesma sessão sem chamar o provider novamente. Uma queda com job running bloqueia o aluno até reconciliação explícita; não há API de reconciliação nesta fatia.

Editar rascunho usa controle de revisão, mantém origem/contexto e invalida aprovação. Publicado é imutável: endpoint versions cria nova versão draft com previousVersion e motivo; só a nova publicação muda o plano atual. Planos e escolhas anteriores continuam consultáveis no histórico do aluno, mas novas escolhas só podem ser feitas no plano atual. Referências alteradas ou consentimento retirado impedem aprovar/publicar o rascunho gerado; o plano já publicado não é apagado.

A UI existente agora hidrata e edita planos/propostas e exibe totais e desvios calculados pelo servidor. O formulário de contexto registra uma fonte/regra por revisão; o backend admite múltiplas referências. Nada publica automaticamente.

## Limites de ativação

Todo dado de testes é fictício e todo provider de testes usa transporte fake rotulado. Não há evidência de adequação clínica, avaliação médica, composição real validada ou geração real bem-sucedida. Ativação real aguarda profissional identificado, catálogo/metas/regras revisados e escolha do aluno; produção exige revisão separada. Política de retenção e reconciliação de jobs precisam ser definidas antes de uso com dados reais. Journal privado preserva propostas/conteúdo: expiração de 20 minutos impede confirmação, mas não apaga registros automaticamente. Não foi feita prova independente de concorrência em PostgreSQL real.

A demonstração em 127.0.0.1:57885 segue servida pelo processo anterior, intacta para avaliação. Este código não reinicia nem converte aquele histórico em dados reais.
