# Piloto de treino manual

O administrador da organização cadastra o aluno, gera um convite para entrega privada e escreve seu treino ou guarda um PDF. O convite não envia email; o destinatário define sua própria senha. A criação do cadastro não cria conta automaticamente.

## Fluxo

1. Em **Alunos**, cadastrar e conferir nome/email, gerar o convite e entregá-lo privadamente ao destinatário correto.
2. Em **Treinos**, selecionar o aluno e escrever título, frequência, exercícios e orientações. Outros exercícios usam uma linha `nome | séries | repetições`, até 12 no total. Orientações livres permitem registrar descanso, esforço, faixas, alternativas e cuidado com dor definidos pelo responsável.
3. Alternativamente, **Subir arquivo de treino / PDF privado** aceita até 1 MB. O servidor confere MIME declarado, assinatura, base64, índice clássico, catálogo/página e rejeita recursos ativos identificados, criptografia, formulários e objetos comprimidos. Exporte PDF simples; isto não é um serviço de análise antivírus ou interpretação da prescrição.
4. Salvar cria rascunho. **Enviar à revisão**, **Aprovar como responsável** e **Publicar ao aluno** são ações separadas. O aluno só acessa planos publicados.
5. **Editar treino / criar nova versão** funciona também em plano publicado: exige motivo e confirmação, cria outro ID em rascunho, sem aprovação, e preserva plano anterior, assinatura e execuções. As versões anteriores continuam consultáveis; publicação da nova versão exige as três etapas. Uma execução já iniciada conserva a prescrição original. PDFs existentes são preservados na nova versão; trocar arquivo exige um novo rascunho de PDF.

## Privacidade e persistência

PDFs ficam no campo privado `plans.content` do banco existente, sem novo volume, diretório público ou migração. Os backups do banco também passam a conter esses arquivos. A listagem entrega apenas tipo/tamanho/hash. Os bytes não entram no contexto de IA ou em snapshots de execução. O download `GET /api/local/plans/:id/file` exige sessão, organização e vínculo; nutricionista não recebe acesso ao arquivo de treino. Download força `attachment`, nome gerado, `nosniff`, CSP sandbox e ausência de cache. Não há visualização HTML ou extração por IA.

Plano somente em PDF permite download após publicação; registro de execução por série exige exercícios estruturados. Treino manual pode ser publicado pelo administrador sem personal ou nutricionista atribuído, quando não há sinal de atenção. Se a anamnese indicar atenção, aprovação/publicação continuam exigindo resolução explícita da revisão atual pelo personal vinculado. O administrador não ganha papel clínico implicitamente. Nutrição e sua entrega permanecem separadas; não marcar entrega completa do pacote sem plano alimentar realmente publicado.

## Liberação

Este bloco não muda aprovação de produção, allowlist, domínio, contas reais ou piloto de IA. Antes de abrir aos alunos, conferir o administrador real, HTTPS/origem/proxy autorizados, banco e backup, convite individual e versão da imagem contendo este bloco. O código foi validado com contas fictícias; cadastro/consentimentos reais precisam ser conferidos no ambiente responsável pela liberação.
