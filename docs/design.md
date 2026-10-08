# Shape IS Money — design da demonstração

Identidade: logo fornecido pelo usuário, menus pretos, botões dourados e fundo branco. Landing page na raiz, compra/anamnese em /comecar, plataforma em /app. Navegação inferior no celular.

Fluxo: compra demonstrativa sem cobrança → anamnese simples → perfil. O sistema simula IA para preparar exemplos de treino, alimentação e performance. A disponibilidade é calculada após 48 horas. O aviso público é de até 3 dias úteis (segunda a sexta, sem calendário de feriados configurado). O personal pode antecipar explicitamente a simulação para testar a entrega.

Área do aluno: dashboard, plano com três abas, check-in diário de treino, histórico de peso/cintura, ranking mensal, perfil e comunidade com fotos/textos, curtidas e comentários.

Área do personal: gestão dos perfis de exemplo, consulta de anamnese, editor de exercícios, aprovação de planos, pausa/reativação de alunos e moderação do feed.

Dados: D1 armazena um workspace demonstrativo por identidade autenticada com revisão otimista; R2 guarda as fotos com prefixo da identidade. A prévia publicada é privada e os papéis Aluno/Personal são visões de simulação do proprietário. Não existe cobrança, integração com modelo de IA, comunidade entre contas reais ou autenticação pública independente nesta entrega.

Verificações: testes das regras temporais, duplicação de check-in, limites de medidas, restrição dos controles de gestão na visão aluno, geração simulada, moderação, compilação TypeScript, build e percurso no navegador desktop/mobile.

## Interface persistente premium — revisão de outubro de 2026

A superfície `/local` usa a marca vetorial existente e os cinco eixos presentes nas fontes locais: Construção, Capacidade, Governo, Percepção e Execução. Tema escuro, dourado, tipografia sem serifa legível e hierarquia orientada à tarefa. A interface da demonstração permanece separada.

Aluno: Hoje, Treino, Evolução (histórico de registros), Consistência e Perfil. Execução organiza séries por exercício, guarda registros no servidor e permite retomada; o ranking depende de consentimento. Equipe: visão geral, alunos, treinos, equipe/convites e consistência, de acordo com o papel autenticado. Cadastro, onboarding, responsabilidades e propostas aparecem em disclosures independentes. Busca filtra somente os cadastros já autorizados pelo servidor. Navegar entre telas não submete formulários nem apaga campos ainda não salvos.

Os cartões usam contagens reais, sem tendências ou métricas inventadas. Vídeos não vinculados, CRM, avaliações e nutrição persistente apresentam estado indisponível. A IA permanece desativada neste staging. Sem vídeos de reprodução automática, fontes externas ou ativos das referências comerciais. A navegação respeita o papel apresentado; a autorização efetiva continua no backend.

Layout planejado para 320/390px e desktop, controles de pelo menos 44px, foco visível, sem animação obrigatória e respeito a reduced-motion. Inspeção em pixels realizada com fixture isolado nas visões de administração e aluno em 320px, 390px e desktop de 1280px. Sem overflow horizontal; botões visíveis de pelo menos 44px. Conferidos formulário por tarefa, diálogo cancelável com retorno de foco, título abaixo do cabeçalho, ranking opt-in/opt-out, início e salvamento repetidos, Voltar e reload com registros preservados. A captura original da Library não foi materializada (403 pelo helper oficial); o QA usou o código local e dados sintéticos, sem contas reais. Referências comerciais orientaram organização e hierarquia, sem cópia de ativos. Esta verificação técnica não equivale à aprovação visual final do usuário.
