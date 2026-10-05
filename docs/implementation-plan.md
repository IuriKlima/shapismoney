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
