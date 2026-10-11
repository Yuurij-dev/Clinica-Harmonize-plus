@AGENTS.md

## Agent skills

### Issue tracker

Especificações e tarefas ficam em arquivos markdown locais em `.scratch/<funcionalidade>/` (pasta ignorada pelo Git). See `docs/agents/issue-tracker.md`.

### Testes ponta a ponta

Depois de adicionar ou alterar uma funcionalidade com rota em `src/app/api`, use o agente `e2e-tester` antes de dizer que está pronta. Ele roda `npm run test:e2e` com a conta de teste (clínica isolada) e acrescenta testes para a funcionalidade em `tests/e2e/smoke.mjs`.

### Domain docs

Single-context: um `GLOSSARY.md` e `docs/adr/` na raiz do repositório. See `docs/agents/domain.md`.
