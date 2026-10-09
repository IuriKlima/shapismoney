# Jornada integrada persistente — conferência fictícia

A jornada técnica usa banco SQLite isolado, pessoas/catálogos/metas fictícios e dois adapters Responses com fetch fake explicitamente `responses-offline-test`. Nenhum endpoint da OpenAI, email ou dado real participa. Os opt-ins de runtime continuam desligados por padrão e produção permanece bloqueada. A demo em memória na porta 57885 é independente e não é reiniciada por essa conferência.

## Passos disponíveis

| Passo | Interface existente / integração mínima |
|---|---|
| Cadastro, atribuição e convite manual | Administração: Alunos e Equipe. Ativação e login na tela de entrada; nenhum email no fixture. |
| Anamnese original e autorizações por finalidade | Aluno: Perfil. Personal: Alunos, revisão humana. Supervisão administrativa depende da escolha própria do aluno. |
| Consentimentos externos separados | Aluno: Perfil, seção de treino e seção Minha alimentação. Chat mantém finalidade distinta. Fake transport recebe aviso explícito. |
| Treino assistido, edição, revisão, aprovação, publicação | Personal/admin: Treino. Salvamento cria apenas rascunho; sessões e fontes permanecem conferíveis. Edição canônica cria nova versão, preservando a anterior. |
| Contexto, metas e catálogo nutricional | Nutricionista habilitado/atribuído: Nutrição; não são metas produzidas pela IA. UI mínima registra uma fonte/regra por revisão; backend admite múltiplas. |
| Proposta nutricional, edição e publicação | Nutrição: preparar, editar, confirmar rascunho, enviar à revisão, aprovar explicitamente e publicar. Publicação técnica permanece com o nutricionista; administração não substitui sua habilitação. |
| Plano do aluno, escolhas e histórico | Aluno: Treino e Perfil → Minha alimentação. Apenas alternativas já aprovadas no plano atual podem ser escolhidas; totais recalculados no servidor. Não há equivalência automática. |
| Vídeos do plano | Exibição mínima no treino publicado, por UUID de vídeo e exercício. Associação é independente da aprovação da prescrição. |
| Aprovar/configurar associação de mídia | Administração: Treino, seção Revisar associação exercício → vídeo. Seleciona IDs existentes, oferece prévia privada e registra decisão pendente, aprovada ou rejeitada, justificativa e confirmação explícita. Default off; não há loader de produção. O catálogo fictício permanece rotulado e não representa aprovação real de Bruno. |
| Reiniciar e consultar histórico | Sessões, anamnese, versões, escolhas, reservas e associações publicadas ficam no banco/journal. Arquivos de vídeo precisam continuar no armazenamento autorizado. |

## Persistência e autorização de mídia

`training-videos.mjs` exige sessão, organização e vínculo; aluno exige acesso de treino ativo e plano publicado. Decisões administrativas sobre IDs existentes ficam persistidas e auditadas, com controle de revisão para impedir sobrescrita concorrente. Somente associações aprovadas por administrador ativo ou personal atribuído e mídias em allowlist de UUID/SHA256 são registradas no journal durante publicação, na mesma transação. A configuração programática anterior permanece somente nos fixtures explicitamente fictícios. Paths ficam privados; basename, raiz real, tamanho e hash são conferidos. Trocar o conteúdo do arquivo, desligar/expirar o gate ou revogar o acesso impede servir o vídeo. Range validado; sem URL pública ou caminho arbitrário. O manifesto é um snapshot por versão publicada. Rejeitar ou manter pendente bloqueia novas solicitações de mídia mesmo em snapshots publicados, sem reescrever a prescrição. Uma transmissão já iniciada não é interrompida. Trocar o vídeo exige nova publicação para incluir a nova associação. Mudanças no catálogo invalidam a decisão anterior e exigem revisão. A marca fictícia é fixada ao iniciar o serviço; alterar a flag não promove decisões de teste a decisões reais. Configuração deve ser confiável, e não conteúdo fornecido pelo modelo. As associações de teste são rotuladas fictícias. Não há migração nova.

## Consentimentos e orçamento

A autorização nutricional da anamnese regula acesso aos campos compartilháveis das respostas originais; o consentimento externo nutricional autoriza contexto profissional separado para proposta e não amplia esse acesso. Metadados de conclusão/revisão vinculam o contexto sem ler respostas adicionais. Revogação externa bloqueia novo envio e confirmação pendente; não apaga planos publicados nem reservas já feitas.

Chat, treino e nutrição compartilham `ai_monthly_reservations`. Finalidades e modelos são registrados separadamente, mas os gastos acumulam no mesmo teto da instalação e aluno. A UI agora explicita esse compartilhamento e distingue o gate do chat dos gates de propostas. Reservas conservadoras não representam fatura, saldo externo ou recarga.

## Evidência e limites

`sim-persistent-journey.test.mjs` percorre cadastro → convite/ativação/login → anamnese/conclusão/revisão → dois consentimentos → propostas offline → edição profissional → publicação → vídeos autenticados → alternativa alimentar → nova versão → reinício real do servidor e reabertura do arquivo SQLite. Confere isolamento, retirada antes do envio/confirmar, reservas compartilhadas, ID inválido, histórico imutável, preparo e totais. As suítes específicas cobrem traços de alergênicos, equivalência inexistente, limites, timeouts e mudanças de sessão/gate/revisão durante a chamada.

Revisão independente estática local: nenhum achado material demonstrável nos módulos examinados; não certifica adequação clínica ou concorrência distribuída em PostgreSQL real. QA de interface é separado da jornada API e não significa que cada ação foi repetida manualmente no navegador.

## Liberação real — quatro decisões concretas

1. **Bruno:** revisar e assinar a versão já preparada da metodologia, referências e restrições usando os documentos/corpus enviados; conferir as associações exercício–UUID–vídeo e alternativas. Não é necessário recriar a metodologia. O pacote privado já extraído (`.qa/training-review-pack.md`, fora do Git) referencia `SIM_Training_Intelligence_Spec_v1_0.docx` e `Shape_Is_Money_PRD_Atendimento_Relacionamento_v1.pdf`; revisar seus critérios e o lote inicial, sem aprovar automaticamente todo o acervo.
2. **Nutricionista identificado e habilitado:** conferir o catálogo com fonte por 100 g, estado de preparo, alergênicos/traços e, para cada aluno, metas, tolerâncias, estrutura e alternativas. Usar as referências já enviadas como regras, sem tratá-las como composição alimentar.
3. **Aluno e responsáveis:** obter as escolhas separadas e atuais de anamnese/supervisão/treino externo/nutrição externa; aprovar escopo de transferência, modelo, tarifas e teto compartilhado. Resolução clínica de sinais exige o fluxo humano; geração externa de treino com sinais continua fechada.
4. **Operação antes de produção:** revisar gates de produção em tarefa específica, armazenamento privado de mídia, backup/restauração, retenção e reconciliação de jobs interrompidos, além de concorrência/roles em PostgreSQL real. Nenhum push/deploy faz parte desta conferência.

## Editor administrativo: validação e liberação

A suíte completa local passou com 210 testes e zero falhas. Os três testes novos verificam catálogo e prévia restritos ao administrador e à organização, IDs existentes, confirmação explícita, conflito de revisão, auditoria, persistência após reinício, bloqueio de mídia após rejeição e preservação da marca fictícia. O teste de interface usa jsdom e HTTP local. A conferência manual do editor foi feita no navegador em desktop e 390 px, com pessoas fictícias; não é uma validação clínica.

Esta alteração não cria migração, dependência, credencial ou variável de ambiente. Reutiliza o journal `operations` e a auditoria existentes; a base continua no esquema 007. Com gates desligados, continuam disponíveis os fluxos manuais já existentes; o editor mostra que o catálogo privado está desativado. Nenhuma mídia é habilitada por esta entrega.

Para liberar vídeos reais, Bruno precisa conferir a metodologia preparada e cada associação com o vídeo correto e seu contexto. A operação precisa carregar um catálogo privado confiável com UUIDs e hashes, separar integralmente os fixtures, validar permissões e revogação com PostgreSQL real e definir armazenamento, expiração e backup. A configuração atual bloqueia produção independentemente do formulário; remover esse bloqueio e publicar exige uma tarefa própria e revisão antes da liberação.

Os adapters Responses de treino e nutrição estão implementados, mas a jornada executada usa transporte fake e não houve chamada real à OpenAI. Antes de liberar geração real, ainda faltam smoke test autorizado com dados fictícios, validação do modelo e schema de saída, consumo e tarifas, consentimentos e contexto mínimo, limites e timeouts, retirada durante chamada, reconciliação de reservas e revisão profissional. Não se deve tratar o sucesso offline como validação de API real.

## Área do aluno: linguagem e consentimento

O painel de verba interna consulta e renderiza somente para administradores, inclusive após mudança de papel; o endpoint de resumo também exige administrador. Limites, reservas e alertas do backend permanecem intactos. A área do aluno mostra indisponibilidade em linguagem simples e mantém seus planos disponíveis, sem revelar orçamento, saldo ou motivo técnico do chat.

As autorizações continuam opcionais e explícitas: resumo de finalidade, destinatário OpenAI e dados, detalhes expansíveis com política de privacidade e instrução de retirada. Uma nova escolha não vem marcada. Treino e nutrição mantêm suas versões e revisões existentes; a autorização de chat registra SIM_CHAT_EXTERNAL_V1 na sessão e em evento de auditoria persistido, sem migração. O transporte de teste continua identificado discretamente como demonstração fictícia sem envio externo.

Foto, capa, bio e evolução para o perfil ficam para depois da v1 de pagamentos; esta mudança não cria feed nem publica dados de saúde.
