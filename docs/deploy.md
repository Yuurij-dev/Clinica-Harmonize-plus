# Deploy em produção — Vercel + registro.br + Resend

Objetivo: o link do convite usar o domínio real (não `localhost`) e o e-mail do convite
realmente sair. Em produção o código só libera o envio quando `NEXT_PUBLIC_SITE_URL`,
`EMAIL_FROM` e `RESEND_API_KEY` estão as três preenchidas (`src/lib/email.ts`), e o link
do convite / o redirect do Google vêm de `NEXT_PUBLIC_SITE_URL` — nunca do header Host.

Domínio de produção: **harmonizeplus.com.br** (registrado no registro.br). Os valores exatos de
DNS saem dos painéis da Vercel e do Resend (são por domínio); aqui vai o passo a passo.

> Status atual (já configurado no registro.br e verificado):
> - **A** `harmonizeplus.com.br` → `216.198.79.1` (Vercel) e CNAMEs `www`/`app` → vercel-dns.
> - **Resend**: domínio **Verified** (DKIM `resend._domainkey` + CNAMEs `send`/`rsend`).
> - **DMARC**: `_dmarc` TXT = `v=DMARC1; p=none;` (um único registro).

## 1. Apontar o domínio para a Vercel
1. Vercel → projeto → **Settings → Domains → Add** → digite `harmonizeplus.com.br` (e `www` se quiser).
2. A Vercel mostra os registros a criar. No **registro.br → painel do domínio → DNS → Editar zona**:
   - **Apex** (`harmonizeplus.com.br`): registro **A** apontando para o IP que a Vercel indicar (no seu caso `216.198.79.1`).
   - **www**: registro **CNAME** → `cname.vercel-dns.com`.
3. Salvar e aguardar a propagação. A Vercel marca o domínio como **Valid** quando reconhece.

## 2. Verificar o domínio no Resend e pegar a API key
> Você já tem a conta no Resend com o domínio adicionado.
1. Resend → **Domains → harmonizeplus.com.br** → a tela lista os registros **DKIM** (TXT/CNAME) e **SPF** (TXT),
   e opcionalmente **DMARC**.
2. Adicionar esses registros no **registro.br** (mesma zona DNS).
   - ⚠️ Se já existir um TXT de SPF no apex, **mesclar** num único registro, não criar dois.
3. No Resend, clicar **Verify** até ficar **Verified**.
4. Resend → **API Keys → Create** (uma key de produção) → copiar `re_...`.
5. O `EMAIL_FROM` precisa usar esse domínio verificado (ex.: `contato@harmonizeplus.com.br`),
   senão o Resend recusa o envio.

## 3. Variáveis de ambiente na Vercel (escopo Production)
Vercel → **Settings → Environment Variables**:

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://harmonizeplus.com.br` |
| `EMAIL_FROM` | `Harmonize+ <contato@harmonizeplus.com.br>` |
| `RESEND_API_KEY` | `re_...` (da etapa 2) |
| `GOOGLE_CLIENT_ID` | do Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | do Google Cloud Console |
| `AUTH_SECRET` | segredo forte (ex.: `openssl rand -base64 32`) |
| `DATABASE_URL` / `DIRECT_URL` | Postgres de produção (Supabase) |

Depois de salvar, **Redeploy** — a Vercel não aplica variáveis novas num deploy já existente.

## 4. Google OAuth em produção (login/cadastro com Google)
Google Cloud Console → **APIs & Services → Credentials → o seu OAuth Client**:
- **Authorized redirect URIs** → adicionar exatamente:
  `https://harmonizeplus.com.br/api/auth/google/callback`
- **Authorized JavaScript origins** → `https://harmonizeplus.com.br`
- Manter também as entradas de `http://localhost:3000` para o desenvolvimento.

## 5. Validar em produção
1. Abrir `https://harmonizeplus.com.br` e entrar.
2. Configurações → equipe → **enviar um convite** para um e-mail seu.
   - O link deve ser `https://harmonizeplus.com.br/convite/...` (não `localhost`).
   - O e-mail deve chegar (conferir também spam).
3. Testar **Entrar com Google** e **Criar conta com Google**.

## Se "O e-mail não foi enviado (provedor não configurado)" persistir
- Alguma das três — `NEXT_PUBLIC_SITE_URL`, `EMAIL_FROM`, `RESEND_API_KEY` — está vazia, OU
- o **Redeploy** não rodou depois de salvar as variáveis, OU
- o domínio do `EMAIL_FROM` ainda não está **Verified** no Resend.
Em produção a URL do convite nunca é mostrada ao admin (só sai por e-mail), então o aviso some
assim que as três variáveis estiverem válidas e o domínio verificado.
