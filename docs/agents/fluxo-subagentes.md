# Fluxo com subagentes

Guia do coordenador (Claude principal) para decidir quando e como delegar. Consulte sob demanda.

## Quando usar cada caminho

| Mudança | Caminho |
|---|---|
| Trivial: texto, estilo pontual, ajuste de poucas linhas, sem API/schema/permissão | Claude principal direto; `typecheck` + testes do arquivo |
| Pequena com lógica, sem dado clínico, segurança ou schema | Claude principal implementa; `typecheck`, `npm test`, lint dos arquivos |
| Relevante: funcionalidade nova, API, schema, regra de negócio, dado clínico, auth, permissões, isolamento multi-clínica | Fluxo completo (abaixo) |
| Pergunta factual sobre o código, localizar arquivos/usos | `explorador` (Haiku) ou o próprio coordenador com Grep |

Revisão independente (`revisor-senior` e/ou `tenant-isolation-reviewer`) é **obrigatória** sempre que a mudança tocar segurança, autenticação, dados clínicos, Prisma/migrations ou isolamento entre clínicas, mesmo que pequena.

## Fluxo completo

1. Coordenador define critérios de aceite e, em tarefa grande, pede ao `desenvolvedor` um plano em `.scratch/<funcionalidade>/plano.md`.
2. `desenvolvedor` implementa.
3. `revisor-senior` revisa o diff.
4. `e2e-tester` (se houver rota em `src/app/api`) e depois `qa-validador`.
5. Problemas relevantes voltam ao `desenvolvedor`; a re-revisão cobre só as correções.
6. Coordenador reporta: Aprovado / Aprovado com ressalvas / Reprovado / Não verificado.

## Economia de tokens

- **Passe contexto, não peça redescoberta.** Cada delegação leva: requisitos/critérios, lista de arquivos alterados, rotas novas, achados anteriores relevantes e caminho do plano. Nunca peça a um agente que audite o repositório de novo.
- **Relatórios curtos** viram a entrada da próxima etapa: arquivos, rotas, decisões, resultados reais, pendências.
- **Revisor:** diff primeiro; arquivos inteiros só quando o contexto exigir. Re-revisão só das correções.
- **QA:** testes ligados aos arquivos alterados primeiro; amplie para regressões quando tocar regra compartilhada, cache, permissões ou dado clínico. Revalidação só do que mudou.
- **Sem revisão repetida** quando não houve mudança relevante desde a última.
- **Correções pequenas** pedidas pelo revisor/QA (UX, rótulos, ajustes locais) podem ser feitas pelo coordenador, com verificação proporcional, sem nova rodada completa.
- **Continue o mesmo agente** (SendMessage) em vez de abrir outro quando ele já tem o contexto.
- **Sem paralelismo** sem benefício claro; nunca rode QA/e2e enquanto o código ainda está sendo alterado, nem dois agentes disputando o mesmo servidor ou banco.

## Modelos e limites

| Agente | Modelo | effort | maxTurns |
|---|---|---|---|
| desenvolvedor | sonnet | medium | sem limite (implementações longas) |
| revisor-senior | sonnet | medium | 40 |
| tenant-isolation-reviewer | sonnet | medium | 30 |
| qa-validador | sonnet | low | 60 |
| e2e-tester | sonnet | low | 60 |
| test-writer | sonnet | low | 30 |
| explorador | haiku | low | 20 |

## Bloqueios

Nenhum agente repete indefinidamente: após duas falhas pela mesma causa (ambiente, credencial, banco, permissão, dependência), para e reporta causa, o que foi feito e a decisão necessária. O coordenador leva a decisão ao usuário; nunca contorna permissão negada por outro agente.
