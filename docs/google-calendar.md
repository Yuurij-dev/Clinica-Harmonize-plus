# Integração Google Agenda

O Harmonize+ envia os agendamentos para o Google Agenda por OAuth. Há dois tipos de conexão:

- **Central (ADMIN)**: uma agenda Google da clínica recebe **todos** os agendamentos e convida o profissional de cada um. No máximo **uma** conexão central ativa por clínica (índice único parcial `GoogleCalendarConnection_one_central_per_clinic_idx`; a segunda tentativa vira "a clínica já tem agenda central conectada").
- **Individual (PROFESSIONAL)**: opcional. O profissional conecta a própria conta Google. Não é necessária para receber convites (o convite chega pelo e-mail do cadastro).

Os e-mails personalizados (Resend) ao profissional continuam e são **independentes** do Google: falha de um nunca repete nem bloqueia o outro.

## Arquitetura

```
Rota de agendamento ──grava──► Appointment
        │
        ├─ calendarAppointmentChanged (src/lib/calendar-runtime.ts)
        │     1. enqueue (outbox, CalendarSyncJob)      ◄── síncrono, curto, try/catch
        │     2. after(): e-mail ao profissional (Resend) + drenagem best-effort da fila da clínica
        ▼
CalendarSyncJob (PENDING) ──► processCalendarSyncJobs ──► calendar-sync-service ──► Google Calendar API
        ▲                          ▲
        │                          └─ cron `*/5 * * * *` (GET/POST /api/cron/calendar-sync) + botão "Sincronizar agora"
        └─ backfill ao conectar / sincronizar
```

| Peça | Arquivo | Papel |
|---|---|---|
| Regras puras | `calendar-sync-rules.ts`, `google-calendar-rules.ts`, `calendar-notification-rules.ts` | plano de ações, backoff, coalescência, payload do evento, dedupe de e-mail |
| Cliente REST | `google-calendar-client.ts` | `fetch` injetável, erros tipados (sem corpo/segredo), sem SDK |
| Config | `google-calendar-config.ts` | envs, redirect URI, fábrica do cliente |
| Tokens | `secret-box.ts`, `google-calendar-token-service.ts` | AES-256-GCM com contexto; refresh com margem de 60 s |
| OAuth | `google-calendar-oauth-service.ts` | início (PKCE + state + cookie `typ:"gcal"`), callback com todas as validações |
| Conexões | `google-calendar-connection-service.ts` | status por papel, desconexão |
| Fila | `calendar-sync-queue.ts` | enqueue com dedupe, snapshot para DELETE, backfill paginado, limpeza |
| Execução | `calendar-sync-service.ts`, `calendar-sync-job-processor.ts` | ações idempotentes; reserva atômica de jobs |
| E-mails | `calendar-notification-service.ts`, `calendar-appointment-hooks.ts` | templates, `CalendarNotificationLog` |
| Cola | `calendar-runtime.ts` | Prisma real + `after()` para as rotas e o cron |

Rotas (`src/app/api`): `integrations/google-calendar/{status,connect,callback,disconnect,sync}` e `cron/calendar-sync`.

### Ganchos de agendamento

| Rota | O que enfileira |
|---|---|
| `POST /api/appointments` | CREATE + e-mail NEW |
| `PATCH /api/appointments/[id]` | UPDATE quando muda data, hora, profissional, procedimento ou cancelamento/reativação |
| `DELETE /api/appointments/[id]` | DELETE com snapshot dos vínculos lido **antes** do `deleteMany` |
| `DELETE /api/patients/[id]/journeys/[journeyId]` | um DELETE por agendamento (snapshot lido dentro da transação, antes do delete) |
| `PATCH /api/patients/[id]/procedure-sessions/[sessionId]` | UPDATE quando o início efetivo move data/hora do agendamento |

Mudança só de status **Atendido / Faltou / Em atendimento** e edição só de notas **não sincronizam** e não enviam e-mail. Nenhuma rotina automática reescreve atendimentos em andamento ou concluídos: a integração nunca altera `Appointment`.

O enfileiramento só acontece se a clínica tem alguma conexão `CONNECTED` (senão não há o que sincronizar). Falha ao enfileirar, ao enviar e-mail ou ao drenar é engolida (log só com código estável, nunca segredo) e nunca afeta a resposta do agendamento.

## Estratégia anti-duplicidade

Regra central: **no máximo um evento por agenda de pessoa por agendamento**.

1. **Id determinístico**: o id do evento no Google é `base32hex(sha256("harmonize:{connectionId}:{appointmentId}"))`. Reenviar o mesmo agendamento na mesma conexão gera o mesmo id.
2. **Insert idempotente**: `events.insert` com esse id; `409` (já existe: crash entre Google e banco, reconexão, reativação) vira `patch`. Se o id estiver "queimado" (evento apagado no Google), usa-se um id alternativo derivado (`:r1`, `:r2`).
3. **Vínculo único** `GoogleCalendarEvent(appointmentId, connectionId)` guarda o `googleEventId` real.
4. **Com central conectada**: um evento na central com `attendees=[profissional]` e `sendUpdates=all`. O convidado é o e-mail da **conta Google conectada pelo profissional** (se houver conexão individual) ou o `User.email`. A conexão individual **não cria cópia**: o serviço procura o convite na agenda dele (`events.list` por `iCalUID`) e registra `RECEIVED` ou `PENDING_INVITE` (somente vínculo).
5. **Sem central, com individual**: um evento **independente** na agenda do profissional (sem attendees). Se depois a clínica conectar a central, o backfill cria o evento central **sem convidar** esse profissional e mantém o independente.
6. **Mesma conta Google** na central e na individual: nada de convite nem cópia.
7. **Troca de profissional**: o patch central troca o attendee; o independente do anterior é apagado; o recebido por convite só é desvinculado (o Google retira ao remover o attendee).
8. **Cancelamento**: central recebe `status=cancelled` (com `sendUpdates=all` se havia convidado), independentes são apagados. Reativar volta o mesmo evento a `confirmed`.
9. **Exclusão**: o `Appointment` apaga os vínculos em cascata, então o job DELETE usa o **snapshot** (`CalendarSyncJob.snapshot`) lido antes. `404/410` no delete é sucesso.
10. **Profissional não identificado** (nome livre não casa com nenhum membro, ou casa com 2+): não convida ninguém, o evento central guarda `lastError="profissional não identificado"` e **eventos individuais independentes já existentes são preservados** (decisão conservadora); só convites recebidos são desvinculados.
11. **Fila**: no máximo um job PENDING por agendamento (UPDATEs coalescem; DELETE sobrepõe CREATE/UPDATE e bloqueia novos). Reserva por `UPDATE` condicional; um job por agendamento por vez; o processamento é por **estado**, então reexecutar nunca duplica.

Conteúdo do evento: título `Atendimento - {procedimento}`; descrição com paciente (só o nome), procedimento, horário/duração, profissional e link para `/agenda`; `extendedProperties.private` com `harmonizeAppointmentId` e `clinicId`. Nunca notas, diagnóstico, fotos, telefone ou CPF. Duração = duração do procedimento no catálogo da clínica (fallback 60 min), no fuso `America/Sao_Paulo`.

## Jobs, retry e erros

- Estados: `PENDING → PROCESSING → COMPLETED | FAILED`. Lock travado há mais de 5 min é retomado (conta como tentativa; 6 tentativas esgotam).
- Backoff por falha transitória (`429`/`5xx`/rede): 1, 2, 4, 8, 16 min; na 6ª falha vira `FAILED`. `Retry-After` é respeitado.
- `invalid_grant`/`401` (token revogado, chave de cifra trocada): a **conexão** vai para `ERROR` com mensagem "reconecte a conta", o job vira `FAILED` **sem retry**. Reconectar dispara novo backfill.
- Erro permanente do Google (4xx): `FAILED`. Mensagens guardadas só com tipo/status/motivo, nunca corpo de resposta, token ou e-mail.
- Jobs `COMPLETED` com mais de 7 dias são apagados pelo cron. `FAILED` permanece para diagnóstico (contador em Configurações).
- Gatilhos: (i) `after()` logo depois de enfileirar (até 5 jobs da clínica), (ii) cron a cada 5 min, (iii) "Sincronizar agora" (backfill + drenagem).
- **Backfill**: CREATE para agendamentos de hoje em diante e não cancelados (páginas de 200, teto de 2000 por execução), sem duplicar jobs pendentes.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | sim | as mesmas do login com Google. Sem elas a integração fica "não configurada" (rotas respondem `configured:false`/503; agendamentos seguem normais). |
| `NEXT_PUBLIC_SITE_URL` | sim em produção | origem pública (`https://app.exemplo.com`). Base do redirect URI e dos links nos eventos/e-mails. Nunca derivada do header `Host`. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | **recomendada (obrigatória em produção)** | chave AES-256 de 32 bytes em hex (64 caracteres) ou base64. Sem ela deriva-se uma chave de `AUTH_SECRET` (HKDF, contexto `google-calendar-token`). **Trocar a chave invalida as conexões** (viram `ERROR`, é preciso reconectar). |
| `CRON_SECRET` | sim para o cron | segredo do cron. Sem ele `/api/cron/calendar-sync` responde `503`. A Vercel envia `Authorization: Bearer ${CRON_SECRET}` automaticamente. |
| `GOOGLE_CALENDAR_REDIRECT_URI` | não | sobrescreve o redirect URI. Padrão: `${origem de NEXT_PUBLIC_SITE_URL}/api/integrations/google-calendar/callback`. |
| `GOOGLE_CALENDAR_FAKE_BASE_URL` | só testes | aponta token/revoke/Calendar API/JWKS para um servidor Google **falso local**. Ignorada em produção e para qualquer host que não seja `localhost`/`127.0.0.1`. |

Gerar as chaves:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # GOOGLE_TOKEN_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # CRON_SECRET
```

## Google Cloud Console (passo a passo)

1. Em <https://console.cloud.google.com/> use o projeto do login com Google (ou crie um).
2. **APIs e serviços → Biblioteca**: ative **Google Calendar API**.
3. **Tela de consentimento OAuth**: tipo Externo; preencha nome, e-mail de suporte e domínios. Em **Escopos** adicione `openid`, `email` e `https://www.googleapis.com/auth/calendar.events`.
   - `calendar.events` é um escopo **sensível**: em produção o app precisa de **verificação do Google**. Até lá deixe em **modo de teste** e cadastre os e-mails em **Usuários de teste** (até 100); o token de refresh de apps em teste expira em 7 dias, então só use o modo de teste para validar.
4. **Credenciais → ID do cliente OAuth (Aplicativo da Web)**. Em **URIs de redirecionamento autorizados** adicione **exatamente** o redirect URI da integração (além do `/api/auth/google/callback` do login):
   - desenvolvimento: `http://localhost:3000/api/integrations/google-calendar/callback`
   - produção: `https://SEU-DOMINIO/api/integrations/google-calendar/callback`
5. Copie o ID e o segredo para `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.

O consentimento usa `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`, PKCE S256, `state` e `nonce`.

## Vercel

1. **Environment Variables** (Production/Preview): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_SITE_URL`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `CRON_SECRET` (e `GOOGLE_CALENDAR_REDIRECT_URI` se o domínio de callback for outro).
2. `vercel.json` define o cron **diário** `0 6 * * *` para `/api/cron/calendar-sync` (plano **Hobby**). Ao subir para o **Pro**, troque o `schedule` para `*/5 * * * *`.
3. **Plano**: no **Hobby** a Vercel só aceita crons **diários** (um `*/5` faz o deploy falhar). Com o cron diário, **retries de falhas transitórias podem levar até 24 h**; o tempo real é coberto pelo `after()` (drena até 5 jobs da clínica logo depois de cada alteração) e pelo botão "Sincronizar agora". No **Pro**, use `*/5 * * * *` e os retries (backoff de 1 a 16 min) são recuperados em minutos.
4. As rotas de cron e sincronização declaram `maxDuration = 60`.

## Como testar

- **Automático (sem Google nem Resend reais)**: `npm test` roda as regras, o cliente REST com `fetch` falso, os serviços (token, OAuth, e-mails) com dependências falsas e `tests/calendar-sync.db.test.mjs` contra o Postgres local (ignorado se o `DATABASE_URL` não for o banco local de dev) com um Google falso em memória.
- **Manual com Google real**: configure as envs, abra **Configurações → Integrações**, conecte, crie/remarque/cancele um agendamento e confira o evento. Use uma conta de teste.
- **Servidor Google falso local**: suba um servidor HTTP que implemente `POST /token`, `POST /revoke`, `GET /oauth2/v3/certs` e `/calendar/v3/calendars/{id}/events[/{eventId}]` e inicie o app com `GOOGLE_CALENDAR_FAKE_BASE_URL=http://127.0.0.1:PORTA`. Para exercitar o cron: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/calendar-sync`.

## Segurança e isolamento

- Toda rota deriva clínica e usuário da **sessão** (`getCurrentUser`), nunca do corpo/URL. Mutações (`connect`, `disconnect`, `sync`) exigem `isSameOrigin`. Respostas `Cache-Control: no-store`, sem tokens nem hashes.
- Tokens só cifrados (AES-256-GCM com contexto como dado autenticado). O cookie de fluxo (`harmonize_gcal_oauth`, httpOnly, `SameSite=Lax`, path `/api/integrations/google-calendar`, 10 min) amarra state, verifier, nonce, usuário, clínica e tipo; o callback revalida sessão e permissão. O cookie de fluxo do login (`typ:"oauth_flow"`) e o da agenda (`typ:"gcal"`) não se aceitam mutuamente.
- Callback: nunca coloca code/tokens na URL; o destino é fixo (`/configuracoes?gcal=<codigo>` com `connected`, `denied`, `error`, `forbidden`, `already_central`, `no_scope`, `no_refresh`, `unavailable`).
- Desconectar apaga os tokens cifrados e revoga no Google **só se** nenhuma outra conexão ativa usa a mesma conta (revogar derruba a concessão inteira da conta no nosso app). Eventos já criados e vínculos ficam como histórico.
- O profissional não vê e-mail, contadores nem erros de outras conexões. ADMIN nunca desconecta a individual de outra pessoa.
- O e-mail ao profissional não é enviado a quem fez a própria alteração.

## Privacidade

O evento criado no Google contém **nome do paciente, procedimento, horário e profissional** (necessário para identificar o atendimento na agenda). Nunca contém notas, diagnóstico, fotos, telefone ou CPF. Quem tem acesso à agenda Google conectada (e aos convidados) vê esses dados; trate a conta da agenda central como dado sensível da clínica.

## Chave de cifra em produção

Defina **sempre** `GOOGLE_TOKEN_ENCRYPTION_KEY` em produção. Sem ela a chave deriva do `AUTH_SECRET`, e **rotacionar o `AUTH_SECRET` invalida todas as conexões** (viram `ERROR`, é preciso reconectar).

## Limitações conhecidas

- Pulado de propósito: AAD por conexão/campo no `secret-box` (exigiria migrar os tokens já gravados) e DELETE perdido se a leitura do snapshot falhar (só há log de aviso `snapshot_failed`).
- Ao reconectar, jobs `FAILED` por falha de autenticação voltam a `PENDING` (tentativas zeradas); falhas de outro tipo continuam `FAILED`.
- E-mails de cancelamento/reatribuição só são enviados para agendamentos ainda `Agendado` e futuros.

- **Cascatas sem rota** (excluir paciente ou clínica apaga agendamentos e vínculos por `ON DELETE CASCADE`) **não geram job DELETE**: os eventos já criados ficam no Google. Só as rotas de exclusão de agendamento e de jornada (em lote) passam por `calendarAppointmentChanged`.
- Trocar a conta Google de uma conexão descarta os vínculos antigos (os eventos permanecem na agenda anterior; o backfill recria na nova).
- Um convite que o profissional ainda não aceitou aparece como `PENDING_INVITE` até a próxima sincronização do agendamento.
- Agenda usada é sempre a `primary` da conta conectada (escopo mínimo, sem listar agendas).
- Se o agendamento for excluído enquanto o evento está sendo criado, o evento recém-criado é removido em best-effort; num colapso nesse intervalo ele pode ficar órfão.
- Mudanças feitas direto no Google (editar/apagar) não voltam para o Harmonize+; a próxima sincronização do agendamento sobrescreve o evento. Exclusão do evento no Google é recriada na próxima sincronização.
- O e-mail Resend marcado `FAILED` não é reenviado para o mesmo estado (evita duplicidade).
- A entrega do e-mail de convite pelo Google depende das configurações de notificação de cada profissional.
