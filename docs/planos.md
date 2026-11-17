# Planos, assinatura e limites comerciais

Estado: etapas 1 a 7 (catálogo, persistência, autorização, limites, dependências entre módulos, relatórios, financeiro, Google Agenda
e automações). Não há gateway nem cobrança.

## Arquitetura

| Peça | Arquivo | Papel |
|---|---|---|
| Catálogo | `src/lib/plans.ts` | Planos Start/Pro/Premium, recursos restritos, dependências entre recursos e limites. Única fonte dos direitos. |
| Resolução | `src/lib/entitlements.ts` | `resolveEntitlements(assinatura, agora)` → modo (`full`/`readonly`), recursos e limites; `checkFeature`, `checkLimit`. Puro. |
| Erros | `src/lib/plan-errors.ts` | Corpo dos 403 comerciais (`PLAN_FEATURE`, `PLAN_LIMIT`, `SUBSCRIPTION_READONLY`) e leitura no cliente. |
| Guards | `src/lib/plan-guards.ts` | `denyIfReadonly`, `denyUnlessFeature`, `denyIfOverLimit`, `planErrorResponse` (Response 403). |
| Uso | `src/lib/plan-usage.ts` | Contagem, trava por clínica e `reserveCapacity` (limites de pacientes e profissionais). |
| Dados | `ClinicSubscription`, `ClinicSubscriptionEvent` | Plano, status e datas por clínica; histórico. Um trigger cria a assinatura de toda clínica nova. |

Autorização final = permissão do papel (`denyUnless`) **e** recurso do plano. O servidor decide; a interface só reflete.

## Estados da assinatura

- Teste (TRIALING): recursos do Premium. Sem data de término = clínica legada, nunca expira. Vencido = somente leitura.
- ACTIVE: acesso completo até `currentPeriodEnd` (sem data = completo). Depois, somente leitura.
- CANCELED: completo até o fim do período pago; depois, somente leitura.
- PAST_DUE: 7 dias de carência depois do vencimento; depois, somente leitura.
- EXPIRED: somente leitura imediato.
- Qualquer dado inválido (sem assinatura, plano ausente, data inválida, status desconhecido) falha fechado: somente leitura.

Somente leitura: GET sempre funciona; escrita responde 403 `SUBSCRIPTION_READONLY` (nunca 401, não encerra a sessão).
Nenhum dado é apagado ou ocultado.

## Limites (etapa 4)

| Recurso | Start | Pro | Premium |
|---|---|---|---|
| Profissionais (ADMIN + PROFESSIONAL) | 2 | 5 | sem limite |
| Pacientes | 100 | sem limite | sem limite |

- STAFF não consome vaga de profissional.
- **Convites pendentes (não vencidos) de ADMIN/PROFESSIONAL reservam vaga.** Convite de STAFF não. Convite vencido não reserva;
  reenviar um vencido volta a reservar (e pode ser negado).
- **Aceite:** o convite já reserva a própria vaga, então é excluído da contagem (não conta duas vezes). A vaga é checada
  **antes** de consumir o convite; negado = o convite continua pendente e nada é criado (a criação do usuário também é desfeita).
  Vale para os três caminhos (aceite com sessão, registro por senha e registro com Google), todos por `acceptInTx`. O limite é o
  da clínica de **destino**, lido do banco na própria transação.
- **Cargo:** passar de STAFF para ADMIN/PROFESSIONAL consome vaga; ADMIN↔PROFESSIONAL não; para STAFF libera.
- **Pacientes:** todos contam (não há arquivamento). Só o **cadastro** é limitado.

### Concorrência

`reserveCapacity` toma `pg_advisory_xact_lock` por (recurso, clínica), lê a assinatura, conta e decide, **na mesma transação**
que grava. Duas requisições da mesma clínica disputando a última vaga se serializam; a segunda recebe `PLAN_LIMIT`.
Clínicas diferentes não se bloqueiam. A chave do lock é gerada só em `plan-usage.ts`. Os testes provam a causalidade (sem a
trava o limite estoura) e cobrem a corrida entre criação de convite, cadastro direto e promoção de cargo.

### Downgrade

Nada é removido. Pacientes e profissionais acima do limite continuam existindo e acessíveis; consultar, editar e atender
pacientes já cadastrados nunca depende do limite. Só novos cadastros/convites/aceites/promoções são bloqueados enquanto o uso
estiver no limite ou acima dele.

## Respostas HTTP de limite

`403` com `{ code: "PLAN_LIMIT", message, resource, limit, used }`. Os formulários já mostram `message`
("O plano atual permite até N ... Para adicionar mais, faça upgrade do plano."). No fluxo Google existente, o callback redireciona
com `invite_plan_limit`. A experiência comercial completa (modal por limite, barras de uso) fica para a etapa de interface.

## Dependências entre módulos (etapa 5)

Recursos e o que cada um libera: `stock` (estoque, lotes, validade, movimentações, baixa automática e a conferência de materiais),
`purchases` (compras; exige `stock` **e** `finance` no plano), `technicalSheet` (ficha técnica; exige `stock`) e `costs` (custos de
mão de obra/estrutura, margens e retrato de custos; **independente** da ficha). A regra é uma só (`hasFeature` / `denyUnlessFeature`)
e vale no backend; a interface apenas reflete `user.access.features` de `/api/auth/me`.

- **Rotas de módulo bloqueadas** no Start (leitura e escrita): produtos, movimentações, saldo inicial, catálogo de estoque, alertas e
  pendências de estoque, estorno, ajustes de estoque, conferência de materiais do atendimento (`stock`); compras (`purchases`);
  ajustes de custos da clínica (`costs`). Resposta: 403 `PLAN_FEATURE` com o recurso e o plano mínimo.
- **Dados omitidos** (nunca zerados) quando falta o recurso: ficha técnica e marca de revisão nos procedimentos; `costs` em
  `/api/quotes/options`; `costs`/`costTotalCents` no retrato do orçamento (`Quote.details`) nas respostas; custo/hora por
  profissional (`laborCostCents: null`); materiais, lotes e saldos nas sessões de procedimento; materiais usados e pendências no
  histórico/encontros/perfil do paciente; resultados de busca de estoque/compras; etapas do assistente inicial.
- **Procedimentos, orçamentos e atendimento funcionam em todos os planos.** No Start: procedimento sem ficha (enviar materiais = 403),
  orçamento calculado e salvo **sem** retrato de custos, atendimento concluído **sem** `materialsCheck: "pending"` e sessão finalizada
  sem baixa de estoque.
- **Downgrade:** nenhuma linha é apagada (produtos, lotes, movimentos, compras, despesas, ficha, custos, histórico de materiais). Os
  dados ficam inacessíveis no plano sem o recurso e voltam intactos no upgrade. `PATCH` de procedimento sem o recurso **não** toca na
  ficha existente. Atendimentos que já estavam com conferência pendente deixam de aparecer (não ficam presos) e reaparecem no upgrade.
- **Relatórios (dependência apenas):** a aba Estoque e os custos derivados de material exigem `stock`; o restante dos relatórios por
  plano está na seção da etapa 6.
- **Orçamentos e custos históricos:** orçamento criado com `costs` guarda o retrato de custos em `Quote.details` e o total o inclui.
  No Start, editar os itens/descontos **preserva** o retrato e o total de custos já gravados (`storedQuoteCosts`; nunca recalcula
  como zero) e a resposta continua omitindo `costs`/`costTotalCents`. Novo orçamento no Start não consulta a formação de custos.
  A busca de jornadas só pesquisa `Quote.details` com `costs`. Atenção: a proposta enviada ao **paciente** continua listando os
  custos como linhas do valor (é a composição do preço cobrado, não tela interna).
- **Sessão finalizada sem estoque:** não dá baixa e zera o rascunho de materiais semeado (`materials: "[]"`), para não aparecer como
  "usado" depois de um upgrade. Rascunhos não finalizados ficam intactos.
- **Despesas parceladas de compra após downgrade:** continuam visíveis e podem ser pagas/desfeitas; cancelar/editar responde 403
  `PLAN_FEATURE` (recurso `purchases`) em vez de mandar "cancele no Estoque", que está indisponível.
- **Ordem das checagens:** login → somente leitura → permissão do papel → recurso do plano. Quem não tem o papel recebe o erro de
  papel e nunca a informação comercial.
- **Aceite de convite em somente leitura:** bloqueado para todos os cargos (STAFF inclusive), com corpo genérico ao convidado.

## Relatórios, financeiro, Google Agenda e automações (etapa 6)

Mesma regra de sempre: login (401) → somente leitura (escritas) → papel → recurso do plano. Falta de recurso = 403 `PLAN_FEATURE`.
Dados ocultos são omitidos, nunca zerados; nada é apagado no downgrade.

| Recurso | Start | Pro | Premium |
|---|---|---|---|
| Página de Relatórios (`reports`) | não | relatórios por área | sim |
| Exportação individual xlsx/csv/pdf (`reportsExport`) | não | sim | sim |
| Visão geral com insights (`reportsAdvanced`) | não | não | sim |
| Consolidado `tab=all` (`reportsConsolidated`) | não | não | sim |
| Financeiro (`finance`) | não (dados preservados) | sim | sim |
| Automações da agenda (`agendaAutomations`) | manual | sim | sim |
| E-mails automáticos (`emailNotifications`) | não | sim | sim |
| Matriz de permissões por cargo, edição (`rolePermissions`) | não | sim | sim |
| Google Agenda (`googleCalendar`) | não | não | sim |

### Rota → recurso exigido

| Rota | Recurso |
|---|---|
| `GET /api/reports/{appointments,clients,procedures,professionals,quotes}` | `reports` |
| `GET /api/reports/finance` | `reports` + `finance` |
| `GET /api/reports/stock` | `reports` + `stock` |
| `GET /api/reports/overview` | `reports` + `reportsAdvanced` |
| `GET /api/reports/filters` | `reports` (só `{ professionals: string[] }`; PROFESSIONAL recebe `[]`) |
| `GET /api/reports/document?tab=<id>` | `reports` + recurso do relatório; `tab=overview` → `reportsAdvanced`; `tab=all` → `reportsConsolidated` |
| `GET /api/reports/export` | o mesmo de `document` + `reportsExport` |
| `/api/finance/{accounts,flow,movements,summary}`, `/api/expenses*`, `/api/recurring-expenses*` (todos os métodos), `recurring-expenses/sync` | `finance` (escrita exige acesso completo) |
| `POST /api/integrations/google-calendar/{connect,sync}`, callback | `googleCalendar` |
| `GET /api/integrations/google-calendar/status` | papel (STAFF 403); sem `googleCalendar` responde 200 `{ planBlocked: true, central, individual }` (só "há conexão ativa?") |
| `POST /api/integrations/google-calendar/disconnect` | nenhum (permitido em qualquer plano e em somente leitura) |
| `POST /api/appointments/auto-process` | `agendaAutomations` |
| `PATCH /api/clinic/preferences` (`autoMarkMissed…`, `autoComplete…`, `autoAdvance…`) | `agendaAutomations` |
| `PATCH /api/clinic/role-permissions` | `rolePermissions` |

- **Composição em relatórios:** `reports-access.ts` mapeia relatório → recursos (`reportFeaturesRequired`/`missingReportFeature`) e a
  checagem roda uma vez em `reportContext` (`reports-http.ts`), depois do papel. `capabilities` = papel **e** plano (alimenta o
  consolidado e `allowedReportIds`); `roleCapabilities` = só o papel (o erro de papel nunca revela informação comercial). `document`
  e `export` passam pelo mesmo caminho, então não há como contornar o gate. Nenhuma rota auxiliar devolve relatório.
- **Financeiro:** pagamento do **orçamento** (`/api/payments`, status Pago, formas de pagamento, resumo de pagamentos do dashboard
  e do histórico/perfil do paciente) é núcleo e **não** depende do módulo. Contas a receber/a pagar, fluxo, movimentos, despesas e
  recorrências dependem de `finance`. A busca global só pesquisa despesas/recorrências com o recurso; a etapa "financeiro" do
  assistente inicial some sem ele. Despesas de compra seguem a regra da etapa 5 (pagar/desfazer; editar/cancelar → `purchases`).
- **Google Agenda:** sem o recurso, `enqueueAppointmentChange` não enfileira, `backfillCalendar` não roda e o processador/cron
  ignoram os jobs da clínica (ficam `PENDING`, intactos). `status` responde 200 com o mínimo seguro `{ planBlocked: true, central, individual }` (existe conexão ativa por escopo; nada de
  e-mail do Google, contadores, erros nem datas), e a interface oferece "Desconectar" só quando há conexão. O processador revalida
  `googleCalendar` no banco imediatamente antes de cada job: sem o recurso o job volta a `PENDING` sem consumir tentativa. Desconectar revoga o token, apaga os tokens locais e marca `DISCONNECTED`, preservando eventos e vínculos.
  **Downgrade:** conexão e dados ficam **inertes**, nada é apagado. **Upgrade:** a conexão volta a funcionar sozinha, sem
  reconectar (token preservado), e os jobs que ficaram na fila são processados; mudanças feitas **durante** o downgrade não foram
  enfileiradas, então depois do upgrade o ADMIN deve usar "Sincronizar agora" (backfill dos agendamentos futuros).
- **Automações (Pro+):** `auto-process` (faltas e conclusão), a marcação automática de falta no `GET .../history` e o avanço
  automático de etapa da jornada (lista e detalhe de pacientes) só ocorrem com `agendaAutomations`. Sem o recurso o fluxo é manual:
  a etapa exibida é a gravada (`manualJourneyStage`). Atendimentos em andamento/concluídos continuam só mudando por ação do
  profissional (regra permanente 9); a rotina nunca reescreve esses registros. Os flags `auto*Enabled` gravados ficam intactos
  (voltam a valer no upgrade); alterá-los sem o recurso é 403.
- **E-mails (Pro+):** confirmação/remarcação/cancelamento ao paciente (rotas de agendamento) e e-mails ao profissional
  (`notifyAppointmentChange`) exigem `emailNotifications`. Ficam fora: e-mails de orçamento (envio manual), convites, recuperação
  de senha e MFA (núcleo/segurança). `patientEmailsEnabled` continua editável em qualquer plano porque também vale para o orçamento.
- **`rolePermissions`:** só a **edição** da matriz exige o recurso; a matriz já gravada continua valendo no Start e o `GET` segue
  livre (é a própria matriz efetiva). **`multiClinic`:** sem rota nova; a troca de clínica não tem gate e a assinatura da clínica de
  **destino** é a que vale (já é assim, pois os direitos vêm da clínica ativa).

## Etapa 7 (correções)

- **Filtro por profissional (Pro):** a lista vem de `GET /api/reports/filters` (só `reports`); no Premium continua a do overview.
- **Cache após downgrade:** uma leitura que falha com 403 comercial (`PlanBlockedError`) **remove** a entrada antiga da chave (não a restaura).
  Um `PLAN_FEATURE` faz o app recarregar `/api/auth/me` (no máximo 1 a cada 10 s, uma por vez); o escopo do cache inclui a assinatura do
  plano (modo + recursos ordenados, `buildClientCacheScope`), então mudança de plano limpa respostas em memória. Nada vai ao localStorage.
- **Tour:** o passo "Dashboard" só cita resultados financeiros com o recurso `finance`.

## Decisões registradas

- `recurring-expenses/sync` exige `finance:access` + recurso `finance` + acesso completo; só **insere** ocorrências que faltam.
- Desconectar o Google Agenda continua permitido em somente leitura: revoga o token no Google, apaga os tokens locais, marca
  `DISCONNECTED` (novas mudanças deixam de entrar na fila) e preserva eventos, vínculos e demais dados.

## Pendências e riscos conhecidos

1. **Cache de autenticação (15 s, por `userId:sid:activeClinicId`)**: a clínica ativa entra na chave (trocar de clínica não serve
   o perfil da anterior em nenhuma instância). Plano/assinatura mudam em outra instância **em até 15 s**. Com pagamentos/webhooks será
   preciso invalidar o cache **por clínica** (ainda não implementado). Detalhe anterior:: guards de recurso e somente leitura usam o `entitlements` do cache, então
   uma mudança de plano/assinatura pode levar até 15 s por instância. Os **limites** quantitativos não sofrem isso: leem a
   assinatura no banco dentro da transação. Quando houver webhook de pagamento, invalidar o cache por clínica (hoje só há
   `invalidateUserAuthCache` por usuário) ou aceitar a janela explicitamente.
2. **`Clinic.trialEndsAt` legado** ainda é devolvido por `mobile/auth/login` e `login.ts` apenas para exibição. A assinatura é a
   fonte oficial; os dois podem divergir depois que a clínica sair do teste. Não afeta limites nem permissões.
3. **`invitations/accept`** em clínica em somente leitura: aceite de convite de PROFESSIONAL/ADMIN é negado (`SUBSCRIPTION_READONLY`
   via `checkLimit`); convite de STAFF continua aceitável.
4. Sem política para o `PAST_DUE` sem `currentPeriodEnd` (falha fechada) e sem job que atualize status por tempo.
5. Armazenamento, preços e periodicidade seguem indefinidos.
