# Propostas de treino com sessões completas — etapa técnica com mocks

O fluxo técnico está integrado: anamnese concluída e revisada, finalidade específica do aluno, método e catálogo de fixture versionados, preparação com adaptador Responses e transporte simulado, edição, confirmação em rascunho, revisão/aprovação/publicação humana e execução de uma sessão escolhida pelo aluno. Não é uma metodologia aprovada do Bruno nem prescrição para uso real.

## Bloqueios de ativação

O runtime padrão não configura esse gerador. Produção continua recusando todas as propostas de simulação. A fatia canônica exige `local-simulation`, transporte `responses-mock` com `mockOnly=true`, fetch injetado diferente do fetch global e metodologia explicitamente `synthetic-fixture`/`fixtureOnly=true`, da mesma organização. Método real pendente, método aprovado sem marca de fixture e provedor Responses real não habilitam essa fatia. Nenhuma variável de ambiente ativa o gerador externo nesta entrega; o chat administrativo existente é independente.

As fontes privadas e o catálogo real permanecem fora do Git, sem aprovação inventada. O operador de preview/import está em `scripts/private-proposal-method.mjs`; importação cria candidato pendente, exige hash conferido e destino ignorado. Isso não ativa o runtime nem concede transferência externa de fontes ou dados de alunos. Nutrição não foi integrada nesta etapa.

## Contrato de proposta

Cada sessão tem ID, nome, dia semanal único e exercícios. O número de sessões coincide com a frequência prescrita, limitada aos dias informados na anamnese. Cada exercício contém ID aprovado do catálogo, séries, repetições, descanso, RIR, justificativa, campos de evidência existentes e regra válida. Alternativas exigem IDs distintos explicitamente associados ao exercício base e compatíveis com o ambiente; aprovação genérica no catálogo não presume equivalência. Referências de fonte/versão/hash/seção são reconstruídas pelo servidor, não fornecidas pelo modelo.

Sinais de atenção exigem resolução explícita atual pelo personal vinculado antes da preparação canônica. Consentimento, anamnese, vínculo, sessão autenticada, método, catálogo e resolução são revalidados após o transporte e na confirmação. Contatos, carta pessoal, notas internas e identificadores do aluno não entram no contexto do mock.

A interpretação do critério de dor relevante versus dor registrada permanece pendente de decisão do Bruno. Esta etapa não inventa um limiar nem autoriza progressão automática: sinais de atenção mantêm a revisão profissional conservadora e explícita.

## Orçamento e confirmação

O contrato Responses usa saída JSON Schema estrita, `store=false` e limite de 4.000 tokens de saída. A reserva usa um limite conservador de entrada incluindo instruções, schema e envelope, além do limite completo de saída. O ledger mensal existente é compartilhado; chave repetida não repete geração. Timeout cancela o sinal do transporte e falha fechada; falha, saída inválida ou contexto alterado não devolvem a reserva conservadora nem produzem substituto. Isso é reserva interna, não afirmação de cobrança efetiva pelo provedor.

Preparação não escreve plano. A proposta temporária, ligada à sessão e ao contexto, expira em 20 minutos. Confirmação explícita cria somente rascunho e é idempotente. A fonte do plano registra método/catálogo por hash, versões das fontes, revisão da anamnese, finalidade, prompt/schema e reserva. Alterar fonte ou finalidade invalida a continuidade da proposta.

## Edição e execução

Editar um plano canônico cria outro ID em estado rascunho, sem aprovação, com motivo e referência à versão anterior. O plano anterior e suas execuções ficam imutáveis. O formato antigo de simulação local preserva seu contrato de edição para compatibilidade; treinos manuais existentes continuam funcionando.

O aluno vê somente planos publicados e inicia uma sessão explicitamente. O snapshot de execução contém somente os exercícios dessa sessão; não executa a lista achatada de toda a semana. Há uma execução por aluno/dia e retomar outra sessão no mesmo dia exige respeitar a regra existente de execução.

Para um piloto externo futuro ainda faltam revisão do método/subconjunto real, autorização de transferência das fontes, finalidade externa específica do aluno e revisão de modelo, preços, configuração e orçamento. Nenhum destes bloqueios é suprido pelos mocks ou pela autorização do chat administrativo.

## Pré-flight de teste sintético externo separado

Esta etapa não executa o piloto. Antes dele, definir explicitamente modelo e preços atuais, teto de requisições/tokens/custo, prazo de expiração e ledger separado do piloto de chat. Usar somente identidade, anamnese, regras, fontes e catálogo inteiramente fictícios; não transferir arquivos privados ou dados reais de alunos. A credencial já provisionada no servidor deve continuar no mecanismo de secrets existente, sem ser copiada ao checkout ou a logs.

O runtime entregue continua fechado para transporte real. Uma futura habilitação exige alteração restrita e revisada do gate para um processo isolado, sem publicação de produção, sem fallback, com timeout, reserva integral e desligamento após o teste. Conferir resposta completa e referências, salvar somente rascunho, editar manualmente e comprovar que nova geração não sobrescreve a versão humana. Autorização e orçamento desse teste devem ser específicos; o piloto anterior de chat não os concede. O sucesso sintético não aprova o método ou catálogo reais, que continuam dependentes do Bruno.
