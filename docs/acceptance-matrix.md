# Matriz de aceite para venda — Shape IS Money

Checkpoint 8/10/2026. Esta matriz descreve evidência e faltas; staging restrito não equivale a produto liberado para venda. Fontes: SIM Training Intelligence Spec v1.0 (20/09/2026), PRD Atendimento e Relacionamento v1.0 (03/08/2026), requisitos comerciais registrados na implementação. Nenhum diagnóstico ou conteúdo confidencial é publicado como dados de QA.

| Requisito | Estado comprovado | Próximo aceite concreto |
| --- | --- | --- |
| Login individual, papéis, organizações, CSRF, auditoria | Persistente e testado em SQLite/PostgreSQL; staging publicado | Bruno validar seus fluxos reais; recuperação de senha e entrega de e-mail ainda faltam |
| Cadastro, convite manual, atribuição profissional, onboarding básico | Implementado, sem criação automática de acesso | Aceite operacional; anamnese completa e consentimentos de saúde por finalidade |
| Treino draft → revisão → aprovação → publicação | Implementado, aluno vê apenas publicado | Ampliar prescrição para RIR/RPE, descanso, alternativas, evidências e ciclo conforme original |
| Execução persistente, histórico e consistência opt-in | Implementado, testes de concorrência/reload/revogação | Validação com dispositivo e rotina do cliente; ranking não mede saúde |
| IA admin e aluno | Incremento com mocks, isolamento, proposta confirmável e orçamento durável; staging desativado | Teste administrativo sintético com orçamento específico; liberação real e política de privacidade próprias |
| Método original do Bruno | DOCX e PRD localizados e consultados, regras de segurança incorporadas | Corpus versionado/retrieval autorizado e explicações com referência; não há memória longitudinal conectada |
| Nutrição prescrita | Backend/migração 004/UI implementados localmente; fixtures sintéticas verificam unidades, fontes, alergias, RBAC e concorrência | Aplicar migração com papel dedicado, deploy e QA móvel; aceite profissional de fontes e adequação. IA não substitui responsável |
| 17 fotos iniciais e avaliação física/postural | Requisito original confirmado, sem implementação persistente | 17 slots configuráveis; aguardar nomes/ordem/assets oficiais, uploads privados, consentimento, revisão humana, comparação longitudinal |
| Vídeos de exercício e anexos | Acervo local de vídeos encontrado; fluxo persistente sem integração | Catálogo autorizado, acesso privado, vínculo à prescrição, limites/retencão e revisão de técnica |
| Check-in semanal, ciclos, reavaliação, decisão e contingências | Ausentes no backend persistente | Memória de decisões com evidências, motivo, autor, aprovação e escopo; sem progressão automática clínica |
| Atendimento/relacionamento | Notas e auditoria existentes; PRD localizado | Fila por pessoa, responsáveis, próxima ação, tarefas/SLA/interações e sinais; não rotular cliente nem automatizar mensagem sensível |
| Operação para venda | Staging HTTPS restrito e banco limitado; produção não liberada | Backup/restauração verificados, reset/SMTP, termos/privacidade/retenção, suporte, monitoramento e aceite do Bruno |
| Asaas | Planejamento apenas; nenhuma cobrança/token novo | Integração final em sandbox com mocks/webhooks idempotentes, valores/parcelamentos e encargos conferidos; produção só autorizada especificamente |

Ordem seguinte: método original e nutrição persistente → vídeos/arquivos → operação/atendimento → Asaas final. Desenvolver/testar/publicar incrementos sem ligar consumo ou transmitir dados reais automaticamente. Pendências de conteúdo ou credenciais não bloqueiam implementação de contratos e mocks; bloqueiam somente sua ativação real.

Orçamento IA aprovado: US$1 por aluno por mês, com alertas administrativos e aporte interno manual auditado. Implementação mensal ainda pendente; o ledger existente é cumulativo por instalação e não representa saldo externo da OpenAI. Nenhuma recarga ou ativação real realizada.
