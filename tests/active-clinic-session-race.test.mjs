import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Regressão: o cache de autenticação (src/lib/auth.ts) é chaveado por `userId:sid:activeClinicId`. A troca de clínica ativa
// em outra aba (mesmo usuário, mesma sessão/sid) NUNCA deve devolver o perfil/permissões da clínica anterior: cada
// requisição revalida `activeClinicId` no banco (AuthSession.user.activeClinicId) e usa esse MESMO valor tanto para montar
// a chave do cache quanto para escolher a membership — nunca o frontend decide a clínica.
//
// O bug corrigido aqui: antes, `loadAuthenticatedUser` relia numa SEGUNDA leitura própria de `user.activeClinicId` para
// escolher a membership, separada da leitura que montou a chave do cache. Entre essas duas leituras, uma troca de clínica
// em outra aba podia fazer o perfil da clínica NOVA (B) ser gravado sob a chave da clínica ANTIGA (A) — ou vice-versa —
// e aí uma aba que ainda achava estar em A recebia, por até 15 s, dados/permissões de B. A correção faz uma ÚNICA leitura
// (`sessionRow.user.activeClinicId`) alimentar as duas coisas, então a chave do cache e a clínica escolhida nunca podem
// divergir dentro da mesma requisição. Este teste é estrutural (lê o código-fonte) porque `src/lib/auth.ts` importa
// `next/headers`, cuja resolução de módulo exige o bundler do Next — não é importável num `node --test` puro (nem com DB).
const auth = readFileSync(join(process.cwd(), "src", "lib", "auth.ts"), "utf8");

test("troca de clínica entre abas: a chave do cache e a membership escolhida vêm da MESMA leitura de activeClinicId (sem corrida)", () => {
  // loadAuthenticatedUser recebe activeClinicId por parâmetro (não relê sozinho) e o usa para escolher a membership.
  assert.match(auth, /async function loadAuthenticatedUser\(userId: string, sid: string, activeClinicId: string \| null\)/);
  assert.ok(auth.includes("pickMembership(user.memberships, activeClinicId)"), "deve usar o parâmetro, não uma segunda leitura de user.activeClinicId");
  assert.ok(!/pickMembership\(user\.memberships, user\.activeClinicId\)/.test(auth), "regressão do bug antigo: escolher a membership por uma leitura própria de activeClinicId, diferente da que montou a chave do cache");

  // resolveCurrentUser lê activeClinicId UMA vez (sessionRow.user.activeClinicId) e usa o MESMO valor na chave do cache e no loader.
  const sessionRowLine = auth.match(/const sessionRow = await prisma\.authSession\.findUnique\([^;]*\);/s)?.[0] ?? "";
  assert.ok(sessionRowLine.includes("activeClinicId: true"), "a leitura da AuthSession deve trazer activeClinicId do usuário");
  const cacheKeyLine = auth.match(/const cacheKey = [^\n]+;/)?.[0] ?? "";
  assert.match(cacheKeyLine, /sessionRow\.user\?\.activeClinicId/, "a chave do cache deve vir dessa mesma leitura");
  const loaderCallLine = auth.match(/const pending = loadAuthenticatedUser\([^;]+\);/)?.[0] ?? "";
  assert.match(loaderCallLine, /sessionRow\.user\?\.activeClinicId/, "o loader deve receber o MESMO activeClinicId usado na chave, não relê-lo");

  // Sessão revogada/expirada: as entradas de cache da sessão (qualquer activeClinicId) são descartadas, nunca servidas.
  assert.ok(auth.includes("for (const key of [...authCache.keys()]) if (key.startsWith(`${userId}:${sid}:`)) authCache.delete(key);"));
});
