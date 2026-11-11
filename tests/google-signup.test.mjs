import assert from "node:assert/strict";
import test from "node:test";
import * as rules from "../src/lib/google-oauth-rules.ts";
import * as flow from "../src/lib/google-oauth-flow.ts";
import * as signup from "../src/lib/google-signup.ts";
import * as clinicRules from "../src/lib/clinic-signup-rules.ts";

console.warn = () => {};

const secret = new TextEncoder().encode("a".repeat(40));
const CID = "cid.apps.googleusercontent.com";
const config = { clientId: CID, clientSecret: "s", redirectUri: "https://app/cb" };
const claims = (over = {}) => ({ iss: "https://accounts.google.com", aud: CID, exp: Math.floor(Date.now() / 1000) + 3600, nonce: "N", sub: "sub-1", email: "ana@x.com", email_verified: true, name: "Ana", ...over });
const flowToken = (intent = "signup") => rules.signOauthFlow({ state: "ST", nonce: "N", codeVerifier: "V", intent }, secret);
const profile = { clinicName: "Clínica Harmonia", name: "Ana Souza" };

function fakeDb() {
  const db = { users: [], identities: [], clinics: [], memberships: [] };
  return db;
}

// Repo em memoria com rollback: a transacao trabalha numa copia e so confirma se nao lancar.
function fakeSignupRepo(db, { failAfterClinic = false } = {}) {
  return {
    async transaction(fn) {
      const draft = structuredClone(db);
      const tx = {
        findUserByEmail: async (email) => draft.users.find((u) => u.email === email) ?? null,
        findIdentity: async (sub) => draft.identities.find((i) => i.sub === sub) ?? null,
        async createClinicOwner(input) {
          draft.clinics.push({ id: `c${draft.clinics.length + 1}`, name: input.clinicName, slug: input.slug, trialStartedAt: input.trialStartedAt, trialEndsAt: input.trialEndsAt });
          if (failAfterClinic) throw new Error("falha");
          const id = `u${draft.users.length + 1}`;
          draft.users.push({ id, email: input.user.email, passwordHash: input.user.passwordHash, role: "ADMIN", name: input.user.name });
          draft.identities.push({ userId: id, sub: input.sub });
          draft.memberships.push({ userId: id, clinicId: draft.clinics.at(-1).id, role: "ADMIN", isOwner: true });
          return id;
        },
      };
      const result = await fn(tx);
      Object.assign(db, draft);
      return result;
    },
  };
}

const complete = (repo, pending, body) => signup.completeGoogleSignup(repo, { pending, profile: body, makePasswordHash: async () => "unusable", newSuffix: () => "abcdef12-0000" });
const pending = { sub: "sub-1", email: "ana@x.com", name: "Ana" };

function callbackDeps(db, over = {}) {
  return {
    config, secret, now: () => new Date(), exchange: async () => "t", verify: async () => claims(),
    repo: {
      findIdentity: async (sub) => db.identities.find((i) => i.sub === sub) ?? null,
      findUserByEmail: async (e) => db.users.find((u) => u.email === e) ?? null,
      hasMembership: async () => { throw new Error("nao esperado"); },
      getUserAccess: async () => { throw new Error("nao esperado"); },
      touchIdentity: async () => { throw new Error("nao esperado"); },
      linkIdentity: async () => { throw new Error("nao esperado"); },
      createUserWithIdentity: async () => { throw new Error("nao esperado"); },
    },
    invitations: {}, getSessionUser: async () => null, makePasswordHash: async () => "x", ...over,
  };
}
const runCb = async (deps, intent) => flow.handleGoogleCallback(deps, { code: "c", state: "ST", flowToken: await flowToken(intent) });

test("intent=signup e aceito e vai no cookie de fluxo", async () => {
  assert.equal(rules.parseGoogleIntent("signup"), "signup");
  assert.equal(rules.parseGoogleIntent("x"), "login");
  const started = await flow.startGoogleFlow({ intent: "signup", config, secret });
  assert.equal((await rules.verifyOauthFlow(started.flowCookie.value, secret)).intent, "signup");
});

test("callback signup: conta nova => nada criado, so cookie pendente e destino da conclusao", async () => {
  const db = fakeDb();
  const r = await runCb(callbackDeps(db), "signup");
  assert.equal(r.redirect, "/login?google=signup");
  assert.deepEqual(r.pendingSignup, pending);
  assert.equal(r.sessionUserId, undefined);
  assert.deepEqual([db.users.length, db.identities.length, db.clinics.length, db.memberships.length], [0, 0, 0, 0]);
});

test("callback signup: e-mail ou sub ja existentes => account_exists, sem pendente", async () => {
  const byEmail = fakeDb(); byEmail.users.push({ id: "u1", email: "ana@x.com" });
  let r = await runCb(callbackDeps(byEmail), "signup");
  assert.equal(r.redirect, "/login?google=account_exists");
  assert.equal(r.pendingSignup, undefined);
  const bySub = fakeDb(); bySub.identities.push({ userId: "u9", sub: "sub-1" });
  r = await runCb(callbackDeps(bySub), "signup");
  assert.equal(r.redirect, "/login?google=account_exists");
  assert.equal(r.pendingSignup, undefined);
});

test("callback signup: checagens de seguranca continuam valendo (email nao verificado, nonce, state)", async () => {
  const db = fakeDb();
  let r = await runCb(callbackDeps(db, { verify: async () => claims({ email_verified: false }) }), "signup");
  assert.equal(r.redirect, "/login?google=error");
  assert.equal(r.pendingSignup, undefined);
  r = await runCb(callbackDeps(db, { verify: async () => claims({ nonce: "outro" }) }), "signup");
  assert.equal(r.pendingSignup, undefined);
  r = await flow.handleGoogleCallback(callbackDeps(db), { code: "c", state: "errado", flowToken: await flowToken("signup") });
  assert.equal(r.pendingSignup, undefined);
});

test("cookie de signup pendente: typ proprio, nao vale como fluxo/convite/sessao e vice-versa", async () => {
  const cookie = await rules.signPendingSignup(pending, secret);
  assert.deepEqual(await rules.verifyPendingSignup(cookie, secret), pending);
  assert.equal(await rules.verifyPendingSignup(`${cookie.slice(0, -3)}AAA`, secret), null);
  assert.equal(await rules.verifyPendingSignup(cookie, new TextEncoder().encode("b".repeat(40))), null);
  assert.equal(await rules.verifyPendingSignup(await rules.signPendingSignup(pending, secret, -10), secret), null);
  assert.equal(await rules.verifyPendingSignup(await flowToken("signup"), secret), null);
  assert.equal(await rules.verifyOauthFlow(cookie, secret), null);
  assert.equal(await rules.verifyPendingGoogle(cookie, secret), null);
  const invitePending = await rules.signPendingGoogle({ invite: "x".repeat(43), invitationId: "i", clinicId: "c", sub: "s", email: "e@x.com" }, secret);
  assert.equal(await rules.verifyPendingSignup(invitePending, secret), null);
  assert.equal(await rules.verifyPendingSignup(null, secret), null);
});

test("conclusao: cria Clinic+User ADMIN+Identity+membership owner atomicamente, com trial de 3 dias", async () => {
  const db = fakeDb();
  const now = new Date("2026-01-10T12:00:00Z");
  const r = await signup.completeGoogleSignup(fakeSignupRepo(db), { pending, profile: profile, makePasswordHash: async () => "unusable", newSuffix: () => "abcdef12-0000" }, now);
  assert.equal(r.ok, true);
  assert.equal(db.clinics.length, 1);
  assert.equal(db.clinics[0].slug, "clinica-harmonia-abcdef12");
  assert.equal(db.clinics[0].trialEndsAt.getTime() - db.clinics[0].trialStartedAt.getTime(), 3 * 24 * 3600 * 1000);
  assert.deepEqual([db.users[0].email, db.users[0].role, db.users[0].passwordHash, db.users[0].name], ["ana@x.com", "ADMIN", "unusable", "Ana Souza"]);
  assert.deepEqual(db.identities, [{ userId: r.userId, sub: "sub-1" }]);
  assert.deepEqual(db.memberships, [{ userId: r.userId, clinicId: db.clinics[0].id, role: "ADMIN", isOwner: true }]);
});

test("conclusao: e-mail/sub do corpo sao ignorados (vem so do cookie)", async () => {
  const db = fakeDb();
  const r = await complete(fakeSignupRepo(db), pending, { ...profile, email: "invasor@x.com", sub: "sub-x" });
  assert.equal(r.ok, true);
  assert.equal(db.users[0].email, "ana@x.com");
  assert.equal(db.identities[0].sub, "sub-1");
});

test("conclusao: e-mail ja existente (ou sub) => account_exists sem criar nada", async () => {
  const db = fakeDb(); db.users.push({ id: "u0", email: "ana@x.com" });
  assert.deepEqual(await complete(fakeSignupRepo(db), pending, profile), { ok: false, code: "account_exists" });
  assert.deepEqual([db.clinics.length, db.identities.length, db.memberships.length, db.users.length], [0, 0, 0, 1]);
  const db2 = fakeDb(); db2.identities.push({ userId: "u0", sub: "sub-1" });
  assert.deepEqual(await complete(fakeSignupRepo(db2), pending, profile), { ok: false, code: "account_exists" });
  assert.equal(db2.clinics.length, 0);
});

test("conclusao: dados invalidos => recusa sem tocar o banco nem gerar hash", async () => {
  const db = fakeDb();
  let hashed = 0;
  const run = (body) => signup.completeGoogleSignup(fakeSignupRepo(db), { pending, profile: body, makePasswordHash: async () => { hashed++; return "h"; }, newSuffix: () => "s" });
  for (const body of [null, {}, { ...profile, clinicName: "" }, { ...profile, clinicName: "a".repeat(101) }, { ...profile, name: " " }, { ...profile, name: 5 }]) {
    const r = await run(body);
    assert.equal(r.ok, false);
    assert.equal(r.code, "invalid_profile");
  }
  assert.equal(hashed, 0);
  assert.equal(db.clinics.length + db.users.length, 0);
});

test("conclusao: falha na transacao => rollback total (nada de clinica orfa)", async () => {
  const db = fakeDb();
  await assert.rejects(() => complete(fakeSignupRepo(db, { failAfterClinic: true }), pending, profile));
  assert.deepEqual([db.clinics.length, db.users.length, db.identities.length, db.memberships.length], [0, 0, 0, 0]);
});

test("conclusao: corrida P2002 vira account_exists", async () => {
  const repo = { transaction: async () => { throw Object.assign(new Error("dup"), { code: "P2002" }); } };
  assert.deepEqual(await complete(repo, pending, profile), { ok: false, code: "account_exists" });
});

test("regras do cadastro de clinica: mesmas do register (limites, so clinica e nome, slug)", () => {
  assert.deepEqual(clinicRules.parseClinicProfile({ ...profile, phone: "x", profession: "y", hasSecretary: "Sim" }).value, { clinicName: "Clínica Harmonia", name: "Ana Souza" });
  assert.equal(clinicRules.parseClinicProfile({ ...profile, clinicName: "" }).code, "clinic_name");
  assert.equal(clinicRules.parseClinicProfile({ ...profile, name: "" }).code, "fields");
  assert.equal(clinicRules.parseClinicProfile({ ...profile, clinicName: "a".repeat(100) }).ok, true);
  assert.equal(clinicRules.slugPart("Clínica São João!"), "clinica-sao-joao");
  assert.equal(clinicRules.slugPart("!!!"), "clinica");
});
