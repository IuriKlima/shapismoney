# Shape IS Money

Demonstração privada funcional, em português, com a marca fornecida.

## Funcionalidades
- Landing page com plano ilustrativo de R$ 149, FAQ e acesso à plataforma.
- Compra demonstrativa sem cobrança → anamnese → perfil.
- IA simulada: exemplos de treino, alimentação e performance. Nenhuma chamada a modelo ou prescrição individual.
- Planos liberados após 48 horas; aviso de até 3 dias úteis. O prazo demonstrativo considera segunda a sexta, sem calendário de feriados.
- Aluno: dashboard, treinos, check-in diário, histórico de peso e cintura, ranking mensal (100 pontos por dia de treino), perfil e comunidade.
- Personal: alunos, anamnese, editor de treinos, aprovação, pausa de aluno e moderação de publicações.
- Fotos JPG/PNG/WebP até 5 MB em R2; dados em D1 com controle de revisão para evitar perda de atualizações.
- Interface mobile com navegação inferior.

## Demonstração
A chave Aluno / Personal no cabeçalho alterna as duas experiências. Os perfis são fictícios. Cada identidade autenticada possui um ambiente demonstrativo isolado: não há comunidade compartilhada entre contas reais nesta versão. No editor do personal, “Simular entrega da IA agora” permite testar os três planos sem esperar dois dias. Os botões de gestão são controles de simulação do proprietário; ainda não há autorização de papéis para operação com alunos reais.

## Rodar localmente
Node 22.13+.

1. npm install
2. npm run db:generate (somente se alterar schema)
3. npm run build
4. node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_peaceful_random.sql (uma vez)
5. npm run dev
6. Abrir a URL local impressa e entrar pelo acesso à plataforma.

Os auxiliares do starter simulam autenticação apenas em loopback durante desenvolvimento. Em produção privada, a plataforma Sites autentica o proprietário. Se o wrapper npm deste Windows falhar, use node scripts/run-framework.mjs dev/build, ou o npm-cli.js instalado no Node.

## Validação
node --test tests/domain.test.mjs
node node_modules/typescript/bin/tsc --noEmit

## Antes de operação real
Definir provedor de pagamento, autenticação pública e papéis independentes, comunidade compartilhada, provedor de IA, revisão dos planos por profissionais, perguntas finais da anamnese e tratamento/consentimento para dados de saúde. Esta entrega é uma demonstração, conforme solicitado.

## Imagem
Logo fornecido pelo usuário. Fotografia: Anastase Maragos / Unsplash, https://unsplash.com/photos/athlete-holding-heavy-kettlebells-in-a-dark-gym-NY6uRbKx89M, Unsplash License.
