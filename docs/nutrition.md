# Nutrição persistente

Incremento local 8/10/2026. Nenhuma dieta real, catálogo pronto ou chamada de IA integra este incremento. Migração 004 aditiva para SQLite e PostgreSQL; aplicar com sim_migrator antes de implantar o runtime que exige quatro migrations. sim_app continua sem CREATE de schema/tabelas.

## Responsabilidade e estados

Admin confere identidade e habilitação no órgão competente e registra número, decisão, autor, data e revisão. O sistema não consulta registro profissional externo; marcar verificado é uma declaração humana auditada. Admin não recebe papel de nutricionista nem detalhes de composição do cardápio. Coach não acessa o fluxo. Somente nutricionista ativo, habilitado e atualmente vinculado ao aluno cria ou altera a prescrição.

Rascunho → revisão → aprovação explícita → publicação. Cada transição usa revisão otimista, transação, bloqueio do aluno, idempotência e auditoria. Alterar um plano antes da publicação apaga aprovação e volta a rascunho; trocar responsável faz o mesmo para planos pendentes. Planos publicados são imutáveis, permanecem acessíveis ao próprio aluno e exigem nova versão para mudanças. Revogar habilitação impede novas prescrições sem apagar o histórico publicado. A interface compõe até seis refeições, seis itens/refeição e quatro alternativas/item; servidor limita o total a 60 porções/opções.

## Composição e proveniência

Catálogo começa vazio. Profissional registra alimento, estado cru/cozido/como vendido, energia e macros por 100 g (duas casas), alergênicos presentes e possíveis traços, fonte, referência e versão. Primeiro salva rascunho; depois confirma conferência da fonte e aprova versão. Versões aprovadas são imutáveis. O plano guarda snapshot com revisão do catálogo e autor da aprovação, evitando alterações retroativas.

Porções em gramas com uma casa decimal; nenhuma conversão cru↔cozido é inferida. Multiplicação usa inteiros (centésimos por 100 g × décimos de grama), soma antes de arredondar totais a três casas. Energia da fonte é separada de 4×proteínas + 4×carboidratos + 9×gorduras: composição rotulada pode diferir. Nenhuma meta clínica, BMR ou prescrição automática é calculada. Catálogo deve usar dados conferidos, adequados ao preparo e à finalidade, não inferência de IA.

Alergias e alergênicos usam códigos explícitos compartilhados pelo profissional: lista de contém e pode conter é obrigatória, mesmo vazia. Toda opção e alternativa com interseção com alergias declaradas é rejeitada. Lista vazia significa somente nenhuma alergia declarada/conferida, não garantia de segurança. Não há diagnóstico automático de alergias.

## Escolhas e solicitações

Aluno vê somente seus próprios planos publicados. Pode escolher base ou alternativa previamente aprovada, com atualização dos totais e controle de concorrência. Não recebe editor de alimento, gramas ou dieta. Pedir outra opção cria solicitação pendente; resposta do profissional registra revisão/recusa sem alterar a prescrição. Mudança efetiva exige nova versão revisada, aprovada e publicada. Admin vê somente estado da solicitação.

## Referências privadas do método

SIM_Training_Intelligence_Spec_v1_0.docx e Shape_Is_Money_PRD_Atendimento_Relacionamento_v1.pdf, fornecidos no diretório local do Bruno, orientam responsabilidade humana, rastreabilidade e restrições clínicas. Esses arquivos não constituem tabela de composição nutricional. Nenhum livro/documento completo é copiado para Git, publicado ou enviado à OpenAI; integração do corpus versionado e fontes nutricionais conferidas permanece um aceite separado. Conteúdo dos documentos nunca modifica RBAC, consentimento ou exigência de aprovação.

## Validação e implantação

Fixtures estritamente sintéticas em diretórios temporários: cálculo, unidades/precisão, alergias e traços em alternativas, catálogo não aprovado, RBAC/crossorg, revisão e publicação, edição que invalida aprovação, escolha concorrente e pedido fora do plano. PostgreSQL embarcado valida o fluxo usando sim_app sem DDL. UI automatizada cobre composição de múltiplas refeições, gramas e alternativas, além de metadados administrativos.

Bloqueio de publicação atual: console root oficial indisponível/bloqueado no navegador. Não elevar sim_app nem aplicar migração com credencial de runtime. Código pode ser revisado e enviado à branch, mas não clicar Deploy antes da migração 004 pelo papel dedicado e confirmação do catálogo. IA continua false. Matriz de aceite não declara produto pronto para venda.