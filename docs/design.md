# Shape IS Money — design da demonstração

Identidade: logo fornecido pelo usuário, menus pretos, botões dourados e fundo branco. Landing page na raiz, compra/anamnese em /comecar, plataforma em /app. Navegação inferior no celular.

Fluxo: compra demonstrativa sem cobrança → anamnese simples → perfil. O sistema simula IA para preparar exemplos de treino, alimentação e performance. A disponibilidade é calculada após 48 horas. O aviso público é de até 3 dias úteis (segunda a sexta, sem calendário de feriados configurado). O personal pode antecipar explicitamente a simulação para testar a entrega.

Área do aluno: dashboard, plano com três abas, check-in diário de treino, histórico de peso/cintura, ranking mensal, perfil e comunidade com fotos/textos, curtidas e comentários.

Área do personal: gestão dos perfis de exemplo, consulta de anamnese, editor de exercícios, aprovação de planos, pausa/reativação de alunos e moderação do feed.

Dados: D1 armazena um workspace demonstrativo por identidade autenticada com revisão otimista; R2 guarda as fotos com prefixo da identidade. A prévia publicada é privada e os papéis Aluno/Personal são visões de simulação do proprietário. Não existe cobrança, integração com modelo de IA, comunidade entre contas reais ou autenticação pública independente nesta entrega.

Verificações: testes das regras temporais, duplicação de check-in, limites de medidas, restrição dos controles de gestão na visão aluno, geração simulada, moderação, compilação TypeScript, build e percurso no navegador desktop/mobile.
