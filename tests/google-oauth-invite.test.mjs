import assert from "node:assert/strict";
import test from "node:test";
import * as rules from "../src/lib/google-oauth-rules.ts";
import * as flow from "../src/lib/google-oauth-flow.ts";
import * as inv from "../src/lib/invitations.ts";
import { generateInviteToken } from "../src/lib/invitation-rules.ts";
import { makeRepo } from "./helpers/fake-invitation-repo.mjs";

console.warn = () => {}; // diagnostico esperado

const secret = new TextEncoder().encode("a".repeat(40));
const CID = "cid.apps.googleusercontent.com";
const config = { clientId: CID, clientSecret: "s", redirectUri: "https://app/cb" };
const claimsFor = (email = "ana@x.com", sub = "sub-1") => ({
  iss: "https://accounts.google.com", aud: CID, exp: Math.floor(Date.now() / 1000) + 3600, nonce: "N", sub, email, email_verified: true, name: "Ana",
});
const flowToken = (invite) => rules.signOauthFlow({ state: "ST", nonce: "N", codeVerifier: "V", intent: "login", ...(invite ? { invite } : {}) }, secret);

function setup({ email = "ana@x.com" } = {}) {
  const { repo, db } = makeRepo();
  const touched = [];
  const googleRepo = {
    findIdentity: async (sub) => { const i = db.identities.find((x) => x.provider === "google" && x.sub === sub); return i ? { userId: i.userId } : null; },
    findUserByEmail: async (e) => db.users.find((u) => u.email === e) ?? null,
    hasMembership: async (userId) => db.memberships.some((m) => m.userId === userId),
    getUserAccess: async (userId) => { const u = db.users.find((x) => x.id === userId); return u ? { email: u.email, lockedUntil: u.lockedUntil ?? null, mustChangePassword: Boolean(u.mustChangePassword) } : null; },
    touchIdentity: async (sub) => { touched.push(sub); },
    linkIdentity: async () => { throw new Error("nao deve vincular"); },
    createUserWithIdentity: async () => { throw new Error("fluxo sem convite nao esperado"); },
  };
  const mk = async (over = {}) => {
    const c = await inv.createInvitation(repo, { clinicId: "c1", invitedById: "admin", email, role: "PROFESSIONAL", deliveryReady: true, ...over });
    return c;
  };
  const deps = (o = {}) => ({
    config, secret, now: () => new Date(), exchange: async () => "t", verify: async () => claimsFor(),
    repo: googleRepo, invitations: repo, getSessionUser: async () => null, makePasswordHash: async () => "unusable-hash", ...o,
  });
  const run = async (d, invite) => flow.handleGoogleCallback(d, { code: "c", state: "ST", flowToken: await flowToken(invite) });
  return { repo, db, deps, run, mk, touched };
}

test("convite (b): sem usuario => NAO cria nada; devolve registro pendente e leva ao passo de dados pessoais", async () => {
  const { db, deps, run, mk } = setup();
  const c = await mk();
  const r = await run(deps(), c.token);
  assert.equal(r.redirect, `/convite/${c.token}?google=complete`);
  assert.equal(r.sessionUserId, undefined);
  assert.deepEqual(r.pendingGoogle, { invite: c.token, invitationId: db.invitations[0].id, clinicId: "c1", sub: "sub-1", email: "ana@x.com" });
  assert.equal(db.users.length, 0);
  assert.equal(db.identities.length, 0);
  assert.equal(db.memberships.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
});

test("convite (b): conclusao com dados pessoais cria User+Identity+aceite; reuso e invalido", async () => {
  const { db, deps, run, mk, repo } = setup();
  const c = await mk();
  const r = await run(deps(), c.token);
  const personal = { name: "Ana Souza", cpf: "529.982.247-25", address: "Rua A, 1", country: "Brasil", state: "SP", city: "Sao Paulo" };
  const done = await inv.completeGoogleInvite(repo, { pending: r.pendingGoogle, profile: personal, makePasswordHash: async () => "unusable-hash" });
  assert.equal(done.ok, true);
  assert.equal(db.users.length, 1);
  assert.equal(db.users[0].email, "ana@x.com");
  assert.equal(db.users[0].cpf, "52998224725");
  assert.equal(db.users[0].passwordHash, "unusable-hash");
  assert.deepEqual(db.identities.map((i) => [i.provider, i.sub, i.userId]), [["google", "sub-1", done.userId]]);
  assert.deepEqual(db.memberships.map((m) => [m.clinicId, m.role, m.isOwner]), [["c1", "PROFESSIONAL", false]]);
  assert.equal(db.invitations[0].status, "ACCEPTED");
  // novo fluxo com o mesmo convite => invalido
  const again = await run(deps(), c.token);
  assert.equal(again.redirect, "/login?google=invite_invalid");
  assert.equal(again.pendingGoogle, undefined);
});

test("registro Google pendente: cookie assinado (typ proprio), adulteracao/expiracao/outro typ rejeitados", async () => {
  const pending = { invite: generateInviteToken(), invitationId: "i1", clinicId: "c1", sub: "sub-1", email: "ana@x.com" };
  const cookie = await rules.signPendingGoogle(pending, secret);
  assert.deepEqual(await rules.verifyPendingGoogle(cookie, secret), pending);
  assert.equal(await rules.verifyPendingGoogle(`${cookie.slice(0, -3)}AAA`, secret), null);
  assert.equal(await rules.verifyPendingGoogle(cookie, new TextEncoder().encode("b".repeat(40))), null);
  assert.equal(await rules.verifyPendingGoogle(null, secret), null);
  assert.equal(await rules.verifyPendingGoogle(await rules.signPendingGoogle(pending, secret, -10), secret), null);
  // cookie de fluxo OAuth nao vale como pendente (e vice-versa)
  assert.equal(await rules.verifyPendingGoogle(await flowToken(pending.invite), secret), null);
  assert.equal(await rules.verifyOauthFlow(cookie, secret), null);
  // payload sem convite com formato valido
  assert.equal(await rules.verifyPendingGoogle(await rules.signPendingGoogle({ ...pending, invite: "curto" }, secret), secret), null);
});

test("convite (a): identidade Google existente => aceita para esse usuario e emite sessao", async () => {
  const { db, deps, run, mk, touched } = setup();
  db.users.push({ id: "u1", email: "ana@x.com", name: "Ana" });
  db.identities.push({ userId: "u1", provider: "google", sub: "sub-1", email: "ana@x.com" });
  const c = await mk();
  const r = await run(deps(), c.token);
  assert.deepEqual(r, { redirect: "/?google=ok", sessionUserId: "u1" });
  assert.equal(db.memberships.length, 1);
  assert.deepEqual(touched, ["sub-1"]);
});

test("convite (a): bloqueio e senha provisoria recusam antes de aceitar", async () => {
  for (const [patch, code] of [[{ lockedUntil: new Date(Date.now() + 60_000) }, "locked"], [{ mustChangePassword: true }, "must_change_password"]]) {
    const { db, deps, run, mk } = setup();
    db.users.push({ id: "u1", email: "ana@x.com", name: "Ana", ...patch });
    db.identities.push({ userId: "u1", provider: "google", sub: "sub-1", email: "ana@x.com" });
    const c = await mk();
    const r = await run(deps(), c.token);
    assert.deepEqual(r, { redirect: `/login?google=${code}` });
    assert.equal(db.memberships.length, 0);
    assert.equal(db.invitations[0].status, "PENDING");
  }
});

test("convite (c): usuario com o e-mail e sem identidade => account_exists, nada vinculado nem aceito", async () => {
  const { db, deps, run, mk } = setup();
  db.users.push({ id: "u1", email: "ana@x.com", name: "Ana" });
  const c = await mk();
  const r = await run(deps(), c.token);
  assert.deepEqual(r, { redirect: `/convite/${c.token}?google=account_exists` });
  assert.equal(db.identities.length, 0);
  assert.equal(db.memberships.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
});

test("convite (d): inexistente, vencido e cancelado => invite_invalid sem criar nada", async () => {
  const { db, deps, run, mk, repo } = setup();
  const expected = { redirect: "/login?google=invite_invalid" };
  assert.deepEqual(await run(deps(), generateInviteToken()), expected);
  const old = await inv.createInvitation(repo, { clinicId: "c1", invitedById: "admin", email: "ana@x.com", role: "STAFF", deliveryReady: true }, new Date(Date.now() - 9 * 86400000));
  assert.deepEqual(await run(deps(), old.token), expected);
  const fresh = await mk(); // o vencido vira EXPIRED ao criar o novo
  await inv.cancelInvitation(repo, { clinicId: "c1", id: fresh.invitation.id });
  assert.deepEqual(await run(deps(), fresh.token), expected);
  assert.equal(db.users.length, 0);
  assert.equal(db.memberships.length, 0);
});

test("convite: e-mail do Google diferente do convite => invite_email_mismatch, sem criar conta", async () => {
  const { db, deps, run, mk } = setup({ email: "outra@x.com" });
  const c = await mk();
  const r = await run(deps(), c.token); // google devolve ana@x.com
  assert.deepEqual(r, { redirect: `/convite/${c.token}?google=invite_email_mismatch` });
  assert.equal(db.users.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
});

test("convite (b): falha no aceite desfaz a criacao do User e da Identity (atomico)", async () => {
  const { db, deps, run, mk, repo } = setup();
  const c = await mk();
  const pending = (await run(deps(), c.token)).pendingGoogle;
  const failing = { ...repo, transaction: (fn) => repo.transaction((tx) => fn({ ...tx, markAccepted: async () => 0 })) };
  const r = await inv.completeGoogleInvite(failing, { pending, profile: { name: "Ana", cpf: "52998224725", address: "R", country: "Brasil", state: "SP", city: "SP" }, makePasswordHash: async () => "x" });
  assert.deepEqual([r.ok, r.code], [false, "invite_invalid"]);
  assert.equal(db.users.length, 0);
  assert.equal(db.identities.length, 0);
  assert.equal(db.memberships.length, 0);
});

test("convite: cookie adulterado ou claims invalidas => nada e criado", async () => {
  const { db, deps, mk } = setup();
  const c = await mk();
  const good = await flowToken(c.token);
  const tampered = `${good.slice(0, -3)}AAA`;
  assert.deepEqual(await flow.handleGoogleCallback(deps(), { code: "c", state: "ST", flowToken: tampered }), { redirect: "/login?google=error" });
  // invite trocado por outro depois de assinado = assinatura invalida
  const [h, , s] = good.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ typ: "oauth_flow", state: "ST", nonce: "N", codeVerifier: "V", intent: "login", invite: generateInviteToken(), exp: 9999999999 })).toString("base64url");
  assert.deepEqual(await flow.handleGoogleCallback(deps(), { code: "c", state: "ST", flowToken: `${h}.${forgedPayload}.${s}` }), { redirect: "/login?google=error" });
  // e-mail nao verificado: recusa antes de qualquer logica de convite
  const unverified = deps({ verify: async () => ({ ...claimsFor(), email_verified: false }) });
  assert.deepEqual(await flow.handleGoogleCallback(unverified, { code: "c", state: "ST", flowToken: good }), { redirect: "/login?google=error" });
  assert.equal(db.users.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
});

test("start: invite so entra no cookie assinado (formato valido, intent login), nunca na URL do Google", async () => {
  const token = generateInviteToken();
  const r = await flow.startGoogleFlow({ intent: "login", config, secret, invite: token });
  assert.equal((await rules.verifyOauthFlow(r.flowCookie.value, secret)).invite, token);
  assert.equal(r.redirect.includes(token), false);
  for (const bad of ["curto", `${token}x`, "a b".padEnd(43, "c"), null, 42]) {
    assert.equal((await rules.verifyOauthFlow((await flow.startGoogleFlow({ intent: "login", config, secret, invite: bad })).flowCookie.value, secret)).invite, undefined);
  }
  assert.equal((await rules.verifyOauthFlow((await flow.startGoogleFlow({ intent: "link", config, secret, invite: token })).flowCookie.value, secret)).invite, undefined);
  // cookie assinado com invite malformado: o verify descarta
  const forged = await rules.signOauthFlow({ state: "s", nonce: "n", codeVerifier: "v", intent: "login", invite: "malformado" }, secret);
  assert.equal((await rules.verifyOauthFlow(forged, secret)).invite, undefined);
});

test("convite (a): usuario ja com outra clinica => other_clinic=1 na URL de retorno", async () => {
  const { db, deps, run, mk } = setup();
  db.users.push({ id: "u1", email: "ana@x.com", name: "Ana" });
  db.identities.push({ userId: "u1", provider: "google", sub: "sub-1", email: "ana@x.com" });
  db.memberships.push({ id: "mx", userId: "u1", clinicId: "c2", role: "ADMIN", isOwner: true });
  const c = await mk();
  const r = await run(deps(), c.token);
  assert.deepEqual(r, { redirect: "/?google=ok&other_clinic=1", sessionUserId: "u1" });
  assert.equal(db.memberships.filter((m) => m.clinicId === "c1").length, 1);
  assert.equal(db.memberships.find((m) => m.id === "mx").isOwner, true);
});

test("convite (a): e-mail do User diverge do convite => invite_email_mismatch sem criar nada", async () => {
  const { db, deps, run, mk } = setup();
  db.users.push({ id: "u1", email: "antigo@x.com", name: "Ana" }); // identidade Google ligada a conta com outro e-mail
  db.identities.push({ userId: "u1", provider: "google", sub: "sub-1", email: "antigo@x.com" });
  const c = await mk();
  const r = await run(deps(), c.token);
  assert.deepEqual(r, { redirect: `/convite/${c.token}?google=invite_email_mismatch` });
  assert.equal(db.memberships.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
});

test("convite (a): falha em touchIdentity NAO derruba o acesso (convite ja consumido)", async () => {
  const { db, deps, run, mk } = setup();
  db.users.push({ id: "u1", email: "ana@x.com", name: "Ana" });
  db.identities.push({ userId: "u1", provider: "google", sub: "sub-1", email: "ana@x.com" });
  const c = await mk();
  const d = deps();
  d.repo = { ...d.repo, touchIdentity: async () => { throw Object.assign(new Error("db"), { code: "P1001" }); } };
  const r = await run(d, c.token);
  assert.deepEqual(r, { redirect: "/?google=ok", sessionUserId: "u1" });
  assert.equal(db.invitations[0].status, "ACCEPTED");
});

test("convite: autor removido da clinica => invite_invalid, nada criado (b) nem aceito (a)", async () => {
  const b = setup();
  const cb = await b.mk();
  b.db.staff.length = 0; // admin saiu
  assert.deepEqual(await b.run(b.deps(), cb.token), { redirect: "/login?google=invite_invalid" });
  assert.equal(b.db.users.length, 0);
  assert.equal(b.db.identities.length, 0);
  const a = setup();
  a.db.users.push({ id: "u1", email: "ana@x.com", name: "Ana" });
  a.db.identities.push({ userId: "u1", provider: "google", sub: "sub-1", email: "ana@x.com" });
  const ca = await a.mk();
  a.db.staff.length = 0;
  assert.deepEqual(await a.run(a.deps(), ca.token), { redirect: "/login?google=invite_invalid" });
  assert.equal(a.db.memberships.length, 0);
  assert.equal(a.db.invitations[0].status, "PENDING");
});

test("pendente: cookie do convite A com token do convite B (ou sem token) => recusado", async () => {
  const a = generateInviteToken();
  const b = generateInviteToken();
  const cookie = await rules.signPendingGoogle({ invite: a, invitationId: "i1", clinicId: "c1", sub: "s", email: "ana@x.com" }, secret);
  assert.equal((await rules.pendingGoogleForToken(cookie, a, secret)).invite, a);
  for (const token of [b, undefined, null, 42, ""]) assert.equal(await rules.pendingGoogleForToken(cookie, token, secret), null);
  assert.equal(await rules.pendingGoogleForToken(null, a, secret), null);
});

test("completeGoogleInvite: perfil invalido nao gera hash de senha (sem bcrypt)", async () => {
  const { repo } = makeRepo();
  let hashed = 0;
  const r = await inv.completeGoogleInvite(repo, { pending: { invite: generateInviteToken(), invitationId: "i", clinicId: "c1", sub: "s", email: "a@x.com" }, profile: { name: "Ana" }, makePasswordHash: async () => { hashed++; return "x"; } });
  assert.equal(r.code, "invalid_profile");
  assert.equal(hashed, 0);
});
