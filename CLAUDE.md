@AGENTS.md

# Harmonize+

SaaS multi-clínica (estética/harmonização). Next 16 (App Router, SPA em `src/app/[section]`),
React 19, Tailwind 4, Prisma 6 + PostgreSQL (Supabase só como hospedagem do banco).
Auth própria: JWT (`jose`) em cookie `harmonize_session` + bcrypt. NÃO usa Supabase Auth.
Editor de fotos: Konva (`photo-editor/`). Atrament ainda não adotado.

## Comandos
- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck`
- `npm test` (node:test, `tests/*.test.mjs`) · `npm run test:e2e` (conta de teste)
- Banco local: `npm run db:local:up` → `db:migrate:deploy` → `db:generate`
- Nova migration: `db:migrate:dev -- --name x` + `db:migration:check` (ver docs/prisma-migrations.md)

## Arquitetura
- `src/app/api/**`: Route Handlers. `src/lib/*-rules.ts`: regras puras com testes.
  `src/lib/permissions.ts` + `api-guards.ts`: papéis ADMIN/PROFESSIONAL/STAFF.
- Telas em `src/components/harmonize`; primitivos em `src/components/ui`.
- Jornada: lead → avaliação → orçamento → procedimento → retorno → pós.
  Cadeia: PatientJourney → Evaluation → Quote → PatientProcedure → ProcedureSession → FollowUp.

## Regras permanentes
1. Multi-tenant: toda query privada filtra por `clinicId` da sessão; update/delete por id
   só depois de um find escopado por clínica. Nunca misturar dados entre clínicas/pacientes.
2. Dados clínicos: exigir `can(role, "clinical:*")`; STAFF não vê avaliação, fotos nem notas clínicas.
3. Cache e telas: seguir `docs/data-loading.md` (getCachedJson, invalidateClientCache, escopo
   por usuário/clínica). Nada de dado de paciente em localStorage/sessionStorage.
4. Endpoints de lista: `select` enxuto, sem imagens base64.
5. Schema: sem alterar sem avaliar impacto; migration nova nunca edita existente; sem
   `migrate reset`, nem comandos destrutivos ou em produção sem autorização.
6. Reaproveitar o que existe; sem dependência nova sem justificativa.
7. Rota nova/alterada em `src/app/api` → agente `e2e-tester` antes de dar como pronta;
   mexeu em API/cache → `tenant-isolation-reviewer`.
8. Não fazer commit/merge sem pedido. Não editar `.env*`.
9. Atendimentos em andamento/concluídos só mudam por ação do profissional (ver
   `runningAppointmentStatuses`); nenhuma rotina automática reescreve esses registros.

## Fluxo com subagentes
Mudança relevante (funcionalidade nova, API, schema, regra de negócio, dado clínico): `desenvolvedor` → `revisor-senior`
→ `e2e-tester` (se tocar `src/app/api`) → `qa-validador`; correções voltam ao desenvolvedor e só elas são re-revisadas.
Mudança pequena: Claude principal direto, com verificação proporcional ao risco. Revisão independente é obrigatória
em segurança, auth, dado clínico, Prisma e isolamento multi-clínica. Exploração simples: `explorador` (Haiku).
Passe a cada agente só requisitos, arquivos, diffs e achados; nunca peça auditoria completa de novo.
Detalhes, modelos e limites: `docs/agents/fluxo-subagentes.md`.

## Docs
`docs/data-loading.md`, `docs/prisma-migrations.md`, `docs/agents/`. Specs em `.scratch/` (ignorado pelo Git).

## Agent skills

### Issue tracker

Especificações e tarefas ficam em arquivos markdown locais em `.scratch/<funcionalidade>/` (pasta ignorada pelo Git). See `docs/agents/issue-tracker.md`.

### Testes ponta a ponta

Depois de adicionar ou alterar uma funcionalidade com rota em `src/app/api`, use o agente `e2e-tester` antes de dizer que está pronta. Ele acrescenta testes para a funcionalidade em `tests/e2e/smoke.mjs` e roda, com a conta de teste (clínica isolada), só as partes do roteiro ligadas à mudança (`npm run test:e2e -- <partes>`), não o roteiro inteiro.

### Domain docs

Single-context: um `GLOSSARY.md` e `docs/adr/` na raiz do repositório. See `docs/agents/domain.md`.

### Skills do projeto

Em `.claude/skills`: use `new-data-screen` ao criar ou alterar tela com dados ou mudar resposta de API, `create-migration` ao criar migration, `ponytail` em tarefas de código (menor mudança que resolve) e `graphify` para perguntas de arquitetura/relações entre arquivos (a CLI `graphify` precisa estar no PATH; a saída fica em `graphify-out/`, ignorada pelo Git).
