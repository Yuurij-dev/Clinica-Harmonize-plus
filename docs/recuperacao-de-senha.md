# Recuperação de senha por e-mail

## Fluxo
1. `/recuperar-senha` → `POST /api/auth/password-reset/request` `{ email }`. Responde sempre `200 { ok: true }`; consulta,
   token e envio rodam depois da resposta (`after`). Não há como descobrir se a conta existe.
2. O e-mail traz `${origem}/redefinir-senha#token=...`. O token vai no fragmento (não chega a log nem a `Referer`); a tela
   o retira do endereço. Recarregar a página perde o token: basta abrir o link do e-mail de novo.
3. A tela confere com `POST .../validate` `{ token }` → `{ valid }` e salva com `POST .../confirm`
   `{ token, password, confirmation }`.
4. A confirmação troca a senha, limpa bloqueio e senha provisória, marca o e-mail como verificado, revoga sessões
   (web e app) e dispositivos confiáveis, apaga o código de login pendente, registra `PASSWORD_RESET` e avisa por e-mail.
   Não mexe em 2FA, códigos de recuperação, identidades ou clínicas e não faz login.

Os tokens pendentes de 2FA e de troca de senha provisória levam uma impressão (HMAC) do hash da senha e deixam de valer em
qualquer troca de senha. A sessão só é criada se o hash ainda for o conferido no login (`SELECT ... FOR SHARE` na mesma
transação), então um login com a senha antiga em andamento não sobrevive à redefinição. Pendentes emitidos antes deste deploy
(até 15 min) são recusados: basta entrar de novo. Falha no envio invalida o link, exceto por timeout (o e-mail pode ter
chegado; o link expira sozinho).
Conta que só entra com o Google não recebe link: recebe a orientação de usar “Entrar com Google”.

## Token
32 bytes aleatórios; o banco guarda só o SHA-256 (`PasswordResetToken`). Vale 30 minutos, uma vez. Pedido novo ou troca de
senha por outro caminho invalida os anteriores. Linhas vencidas são apagadas a cada nova solicitação.

## Limites (tabela `PasswordResetRateLimit`, chaves em HMAC; janela fixa a partir do primeiro pedido)
| Chave | Limite | Resposta |
|---|---|---|
| par e-mail + IP | 1 a cada 60 s, 5 por hora, 10 por 24 h | neutra (nada é enviado) |
| e-mail (qualquer IP) | 1 a cada 60 s, 30 por 24 h | neutra (nada é enviado) |
| IP, solicitação | 20 por hora | 429 |
| IP, validação + confirmação | 30 por 15 min | 429 |

As chaves do e-mail são contadas numa transação só: um pedido barrado não gasta nenhuma. Um terceiro em um único IP consome
no máximo 10 dos 30 envios diários e ocupa o intervalo global por 60 s a cada envio dele (até 5 por hora).

**Risco residual:** quem usa 3 ou mais IPs (ou os forja, fora da Vercel) pode esgotar o teto global e impedir novos pedidos
da vítima por até 24 h, ou manter ocupado o intervalo de 60 s. Cada pedido aceito invalida o link anterior, mas manda um novo
para a caixa da vítima, válido por 30 minutos.

O IP é o primeiro valor de `x-forwarded-for` (depois `x-real-ip`). Na Vercel a borda sobrescreve o cabeçalho. Fora dela, ou
sem proxy confiável, o cliente pode forjá-lo (restam os limites por e-mail e o tamanho do token); com outro proxy/CDN na
frente da Vercel, o IP visto seria o dele. Cada endereço IPv6 conta separadamente. Sem IP, todos dividem um limite.

Em desenvolvimento, para zerar os limites: apague as linhas de `PasswordResetRateLimit` no banco local.

## Configuração
| Variável | Uso |
|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM` | envio dos e-mails |
| `NEXT_PUBLIC_SITE_URL` | origem do link; obrigatória em produção (nunca vem do header `Host`). Fora dela o padrão é `http://localhost:3000` |
| `AUTH_SECRET` | também gera o HMAC das chaves de limite |
| `E2E_RESEND_URL` | só fora de produção, endereço local que recebe os envios nos testes |

Sem configuração, a resposta continua igual, o log mostra só `[password-reset] not_configured` e nenhum token é criado.

**Teste local:** com `NODE_ENV` development/test, `ENABLE_DEV_TEST_LOGIN=1` e e-mail `@teste.com`, nenhum e-mail é enviado e
o link sai no console do servidor. É a única exceção à regra de nunca logar links, e não existe em produção. Para testar com
`E2E_RESEND_URL`, use um e-mail de outro domínio.

## Deploy
A migration `add_password_reset` precisa estar aplicada antes do código: sem ela falham as três rotas de recuperação e as
trocas de senha (`/api/me/password` e `/api/auth/change-password`, que invalidam os links pendentes). O build de produção da
Vercel já aplica; Preview não migra e compartilha o banco de produção, então esses fluxos por lá só funcionam depois do deploy
de produção.
