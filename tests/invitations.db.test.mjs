import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import * as inv from "../src/lib/invitations.ts";
import { cancelPendingByInviter, deleteAcceptedByAccepter, createPrismaInvitationRepo } from "../src/lib/invitations-repo.ts";
import { hashInviteToken } from "../src/lib/invitation-rules.ts";

// Concorrencia, indice parcial e CHECKs contra o Postgres LOCAL. Recusa-se a rodar (skip) se o host
// de DATABASE_URL nao for localhost/127.0.0.1 ou se o banco nao responder. Cria so dados com prefixo
// unico e remove tudo no final, sempre por IDs que ele mesmo criou.

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (match) return match[1];
  }
  return null;
}

let prisma = null;
let skipReason = null;
const url = databaseUrl();
if (!url) {
  skipReason = "DATABASE_URL ausente";
} else {
  let host = "";
  let dbName = "";
  try { const u = new URL(url); host = u.hostname; dbName = u.pathname.slice(1); } catch { /* url invalida */ }
  if ((host !== "localhost" && host !== "127.0.0.1") || dbName !== "harmonize") {
    // Tuneis locais para bancos remotos tambem sao ignorados: so o banco de dev "harmonize".
    skipReason = "DATABASE_URL nao aponta para o banco local de dev (localhost/127.0.0.1, banco harmonize): teste de banco ignorado";
  } else {
    // Pool maior: a variante sem lock precisa de todas as transacoes ativas ao mesmo tempo.
    prisma = new PrismaClient({ datasourceUrl: `${url}${url.includes("?") ? "&" : "?"}connection_limit=40&pool_timeout=20` });
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      skipReason = "banco local nao respondeu: teste de banco ignorado";
      await prisma.$disconnect().catch(() => {});
      prisma = null;
    }
  }
}
const opts = { skip: skipReason ?? false };

const tag = `zz-e2e-conv-${Date.now()}`;
const created = { clinics: [], users: [] };
const repo = prisma ? createPrismaInvitationRepo(prisma) : null;

async function makeClinic(label) {
  const clinic = await prisma.clinic.create({ data: { name: `${tag}-${label}`, slug: `${tag}-${label}` }, select: { id: true } });
  created.clinics.push(clinic.id);
  return clinic.id;
}
async function makeUser(label) {
  const email = `${tag}-${label}@example.test`;
  const user = await prisma.user.create({ data: { name: `${tag}-${label}`, email, passwordHash: "x", role: "STAFF" }, select: { id: true } });
  created.users.push(user.id);
  return { id: user.id, email };
}
// Quem convida precisa ser membro da clinica (o aceite exige): garante a membership do autor no teste.
async function newInvite(clinicId, invitedById, email, role = "STAFF", now = new Date(Date.now() - 120_000)) {
  await prisma.clinicMembership.createMany({ data: [{ userId: invitedById, clinicId, role: "ADMIN", isOwner: false }], skipDuplicates: true });
  return inv.createInvitation(repo, { clinicId, invitedById, email, role, deliveryReady: true }, now);
}
const profile = { name: "Convidado", cpf: "52998224725", postalCode: "01310100", address: "Rua A, 1", country: "Brasil", state: "SP", city: "Sao Paulo" };
const row = (id) => prisma.clinicInvitation.findUnique({ where: { id } });
const memberships = (userId, clinicId) => prisma.clinicMembership.count({ where: { userId, clinicId } });

after(async () => {
  if (!prisma) return;
  try {
    const { clinics, users } = created;
    await prisma.clinicInvitation.deleteMany({ where: { clinicId: { in: clinics } } });
    await prisma.clinicMembership.deleteMany({ where: { OR: [{ clinicId: { in: clinics } }, { userId: { in: users } }] } });
    await prisma.userIdentity.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinics } } });
  } finally {
    await prisma.$disconnect();
  }
});

test("db: dois resend simultaneos => no maximo um vence dentro dos 60 s", opts, async () => {
  const clinic = await makeClinic("resend");
  const admin = await makeUser("resend-admin");
  const c = await newInvite(clinic, admin.id, `${tag}-r@example.test`);
  assert.equal(c.ok, true);
  const results = await Promise.all([
    inv.resendInvitation(repo, { clinicId: clinic, id: c.invitation.id, deliveryReady: true }),
    inv.resendInvitation(repo, { clinicId: clinic, id: c.invitation.id, deliveryReady: true }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => r.code ?? "ok")));
  const after = await row(c.invitation.id);
  assert.equal(after.sendCount, 2);
  const winner = results.find((r) => r.ok);
  assert.equal(after.tokenHash, hashInviteToken(winner.token));
});

test("db: accept e cancel simultaneos => exatamente um vence e o estado e consistente", opts, async () => {
  const clinic = await makeClinic("acc-cancel");
  const admin = await makeUser("ac-admin");
  for (let round = 0; round < 5; round++) {
    const email = `${tag}-ac${round}@example.test`;
    const guest = await prisma.user.create({ data: { name: email, email, passwordHash: "x", role: "STAFF" }, select: { id: true } });
    created.users.push(guest.id);
    const c = await newInvite(clinic, admin.id, email);
    const [accepted, cancelled] = await Promise.all([
      inv.acceptInvitation(repo, { token: c.token, user: { id: guest.id, email } }),
      inv.cancelInvitation(repo, { clinicId: clinic, id: c.invitation.id }),
    ]);
    assert.equal(Number(accepted.ok) + Number(cancelled.ok), 1, `rodada ${round}`);
    const final = await row(c.invitation.id);
    assert.equal(final.status, accepted.ok ? "ACCEPTED" : "CANCELLED");
    assert.equal(await memberships(guest.id, clinic), accepted.ok ? 1 : 0);
  }
});

test("db: dois accept simultaneos => uma membership", opts, async () => {
  const clinic = await makeClinic("acc2");
  const admin = await makeUser("a2-admin");
  const guest = await makeUser("a2-guest");
  const c = await newInvite(clinic, admin.id, guest.email, "PROFESSIONAL");
  const results = await Promise.all([
    inv.acceptInvitation(repo, { token: c.token, user: guest }).catch((e) => ({ ok: false, code: e.code ?? "throw" })),
    inv.acceptInvitation(repo, { token: c.token, user: guest }).catch((e) => ({ ok: false, code: e.code ?? "throw" })),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.equal(await memberships(guest.id, clinic), 1);
  const m = await prisma.clinicMembership.findFirst({ where: { userId: guest.id, clinicId: clinic } });
  assert.deepEqual([m.role, m.isOwner], ["PROFESSIONAL", false]);
});

test("db: create do mesmo e-mail em paralelo => indice parcial barra (409), um so PENDING", opts, async () => {
  const clinic = await makeClinic("dup");
  const admin = await makeUser("dup-admin");
  const email = `${tag}-dup@example.test`;
  const results = await Promise.all([newInvite(clinic, admin.id, email), newInvite(clinic, admin.id, email)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  const lost = results.find((r) => !r.ok);
  assert.deepEqual([lost.status, lost.code], [409, "pending_exists"]);
  assert.equal(await prisma.clinicInvitation.count({ where: { clinicId: clinic, email, status: "PENDING" } }), 1);
  // o indice em si (sem passar pela biblioteca): segundo PENDING direto no banco e recusado
  await assert.rejects(
    prisma.clinicInvitation.create({ data: { clinicId: clinic, email, role: "STAFF", tokenHash: `${tag}-h-dup`, expiresAt: new Date(Date.now() + 1e6) } }),
    (e) => e.code === "P2002",
  );
});

test("db: CHECKs do banco recusam e-mail com maiusculas e papel ADMIN", opts, async () => {
  const clinic = await makeClinic("check");
  const base = { clinicId: clinic, expiresAt: new Date(Date.now() + 1e6) };
  await assert.rejects(prisma.clinicInvitation.create({ data: { ...base, email: `${tag}-UP@example.test`, role: "STAFF", tokenHash: `${tag}-h1` } }));
  await assert.rejects(prisma.clinicInvitation.create({ data: { ...base, email: `${tag}-ok@example.test`, role: "ADMIN", tokenHash: `${tag}-h2` } }));
  assert.equal(await prisma.clinicInvitation.count({ where: { clinicId: clinic } }), 0);
});

test("db: convite de OUTRA clinica nunca e lido nem alterado pelo id", opts, async () => {
  const a = await makeClinic("iso-a");
  const b = await makeClinic("iso-b");
  const admin = await makeUser("iso-admin");
  const c = await newInvite(a, admin.id, `${tag}-iso@example.test`);
  const before = await row(c.invitation.id);
  assert.equal((await inv.resendInvitation(repo, { clinicId: b, id: c.invitation.id, deliveryReady: true })).code, "not_found");
  assert.equal((await inv.cancelInvitation(repo, { clinicId: b, id: c.invitation.id })).code, "not_found");
  assert.equal(await repo.findInClinic({ id: c.invitation.id, clinicId: b }), null);
  assert.deepEqual(await inv.listInvitations(repo, { clinicId: b }), []);
  assert.deepEqual(await row(c.invitation.id), before);
});

test("db: aceite amarrado ao tokenHash — token rotado nao consome", opts, async () => {
  const clinic = await makeClinic("rot");
  const admin = await makeUser("rot-admin");
  const guest = await makeUser("rot-guest");
  const c = await newInvite(clinic, admin.id, guest.email);
  const old = await repo.findByTokenHash(hashInviteToken(c.token));
  const r = await inv.resendInvitation(repo, { clinicId: clinic, id: c.invitation.id, deliveryReady: true });
  assert.equal(r.ok, true);
  assert.equal(await repo.markAccepted({ id: old.id, clinicId: clinic, tokenHash: old.tokenHash, userId: guest.id, now: new Date() }), 0);
  assert.equal((await row(c.invitation.id)).status, "PENDING");
  assert.equal((await inv.acceptInvitation(repo, { token: c.token, user: guest })).code, "not_found");
  assert.equal(await memberships(guest.id, clinic), 0);
  assert.equal((await inv.acceptInvitation(repo, { token: r.token, user: guest })).ok, true);
});

test("db: 30 criacoes concorrentes nao passam do teto de 25 pendentes", opts, async () => {
  const clinic = await makeClinic("cap");
  const admin = await makeUser("cap-admin");
  const settled = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => newInvite(clinic, admin.id, `${tag}-cap${i}@example.test`)));
  const oks = settled.filter((s) => s.status === "fulfilled" && s.value.ok).length;
  const pending = await prisma.clinicInvitation.count({ where: { clinicId: clinic, status: "PENDING" } });
  assert.equal(pending, 25, `fulfilled ok=${oks}, rejeitados=${settled.filter((s) => s.status === "rejected").length}`);
  assert.equal(oks, 25);
});

// Prova de causalidade: sem o advisory lock, uma barreira faz todas as transacoes contarem PENDING antes
// de qualquer create, e o teto de 25 estoura. Com o lock (teste anterior) fica exatamente em 25.
test("db: sem lockClinicInvites o teto de 25 estoura (o lock e a causa do teto)", opts, async () => {
  const clinic = await makeClinic("nolock");
  const admin = await makeUser("nolock-admin");
  const N = 30;
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const timer = setTimeout(release, 3000); // rede de seguranca contra deadlock da barreira
  const unlocked = {
    ...repo,
    transaction: (fn) => repo.transaction((tx) => fn({
      ...tx,
      lockClinicInvites: async () => {},
      countPending: async (input) => {
        const n = await tx.countPending(input);
        if (++arrived >= N) { clearTimeout(timer); release(); }
        await gate;
        return n;
      },
    })),
  };
  const settled = await Promise.allSettled(Array.from({ length: N }, (_, i) =>
    inv.createInvitation(unlocked, { clinicId: clinic, invitedById: admin.id, email: `${tag}-nl${i}@example.test`, role: "STAFF", deliveryReady: true }, new Date(Date.now() - 120_000))));
  clearTimeout(timer);
  const pending = await prisma.clinicInvitation.count({ where: { clinicId: clinic, status: "PENDING" } });
  assert.equal(arrived, N, "todas as transacoes precisam ter passado pela barreira (senao o teste nao prova nada)");
  assert.ok(pending > 25, `sem o lock esperava-se estourar o teto, mas pending=${pending} (rejeitados=${settled.filter((x) => x.status === "rejected").length})`);
});

test("db: aceite via Google (b) cria User+Identity+membership atomicamente; falha no aceite desfaz tudo", opts, async () => {
  const clinic = await makeClinic("goog");
  const admin = await makeUser("goog-admin");
  const email = `${tag}-goog@example.test`;
  const c = await newInvite(clinic, admin.id, email, "PROFESSIONAL");
  const google = { sub: `${tag}-sub`, email };

  // falha no aceite (markAccepted perde a corrida) => nada de User nem Identity
  const failing = { ...repo, transaction: (fn) => repo.transaction((tx) => fn({ ...tx, markAccepted: async () => 0 })) };
  const bad = await inv.registerGoogleByInvite(failing, { token: c.token, google, profile, passwordHash: "x" });
  assert.deepEqual([bad.ok, bad.code], [false, "invite_invalid"]);
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  assert.equal(await prisma.userIdentity.count({ where: { providerSubject: google.sub } }), 0);
  assert.equal((await row(c.invitation.id)).status, "PENDING");

  const ok = await inv.registerGoogleByInvite(repo, { token: c.token, google, profile, passwordHash: "x" });
  assert.equal(ok.ok, true);
  created.users.push(ok.userId);
  assert.equal(await prisma.userIdentity.count({ where: { userId: ok.userId, provider: "google", providerSubject: google.sub } }), 1);
  const m = await prisma.clinicMembership.findFirst({ where: { userId: ok.userId, clinicId: clinic } });
  assert.deepEqual([m.role, m.isOwner], ["PROFESSIONAL", false]);
  assert.equal((await row(c.invitation.id)).status, "ACCEPTED");
  const saved = await prisma.user.findUnique({ where: { id: ok.userId } });
  assert.equal(saved.role, "STAFF");
  assert.deepEqual([saved.name, saved.cpf, saved.postalCode, saved.address, saved.country, saved.state, saved.city], [profile.name, profile.cpf, profile.postalCode, profile.address, profile.country, profile.state, profile.city]);

  // reuso do convite e e-mail ja existente
  const again = await inv.registerGoogleByInvite(repo, { token: c.token, google, profile, passwordHash: "x" });
  assert.equal(again.code, "invite_invalid");
});

test("db: B3 cancela so os PENDING do convidante, na clinica certa", opts, async () => {
  const a = await makeClinic("b3-a");
  const b = await makeClinic("b3-b");
  const inviter = await makeUser("b3-inviter");
  const other = await makeUser("b3-other");
  const mine = await newInvite(a, inviter.id, `${tag}-b3-1@example.test`);
  const alsoMine = await newInvite(a, inviter.id, `${tag}-b3-2@example.test`);
  const theirs = await newInvite(a, other.id, `${tag}-b3-3@example.test`);
  const otherClinic = await newInvite(b, inviter.id, `${tag}-b3-4@example.test`);
  await inv.cancelInvitation(repo, { clinicId: a, id: alsoMine.invitation.id }); // ja cancelado: segue cancelado
  const count = await cancelPendingByInviter(prisma, { clinicId: a, invitedById: inviter.id });
  assert.equal(count, 1);
  assert.equal((await row(mine.invitation.id)).status, "CANCELLED");
  assert.equal((await row(theirs.invitation.id)).status, "PENDING");
  assert.equal((await row(otherClinic.invitation.id)).status, "PENDING");
});

test("db: remover membro apaga so o convite ACCEPTED dele e so nessa clinica", opts, async () => {
  const x = await makeClinic("acc-x");
  const y = await makeClinic("acc-y");
  const a = await makeUser("acc-a"); // aceitante que sera removido da clinica X
  const b = await makeUser("acc-b"); // outro aceitante, fica
  const admin = await makeUser("acc-admin");
  const accA = await newInvite(x, admin.id, `${tag}-acc-a@example.test`);
  const accB = await newInvite(x, admin.id, `${tag}-acc-b@example.test`);
  const pend = await newInvite(x, admin.id, `${tag}-acc-p@example.test`);
  const canc = await newInvite(x, admin.id, `${tag}-acc-c@example.test`);
  const accAy = await newInvite(y, admin.id, `${tag}-acc-ay@example.test`); // A tambem aceitou na clinica Y
  const accept = (id, userId) => prisma.clinicInvitation.update({ where: { id }, data: { status: "ACCEPTED", acceptedById: userId, acceptedAt: new Date() } });
  await accept(accA.invitation.id, a.id);
  await accept(accB.invitation.id, b.id);
  await accept(accAy.invitation.id, a.id);
  await inv.cancelInvitation(repo, { clinicId: x, id: canc.invitation.id });

  const count = await deleteAcceptedByAccepter(prisma, { clinicId: x, acceptedById: a.id });
  assert.equal(count, 1);
  assert.equal(await row(accA.invitation.id), null); // (a) o ACCEPTED de A na clinica X e apagado
  assert.equal((await row(accAy.invitation.id)).status, "ACCEPTED"); // (b) ACCEPTED de A na clinica Y permanece
  assert.equal((await row(accB.invitation.id)).status, "ACCEPTED"); // (b) ACCEPTED de outro usuario na X permanece
  assert.equal((await row(pend.invitation.id)).status, "PENDING"); // (c) PENDING intacto
  assert.equal((await row(canc.invitation.id)).status, "CANCELLED"); // (c) CANCELLED intacto
});

test("db: autor removido da clinica (ou convite sem autor) => aceite recusado, convite segue PENDING", opts, async () => {
  const clinic = await makeClinic("inviter-gone");
  const admin = await makeUser("ig-admin");
  const guest = await makeUser("ig-guest");
  const c = await newInvite(clinic, admin.id, guest.email);
  await prisma.clinicMembership.deleteMany({ where: { userId: admin.id, clinicId: clinic } }); // autor saiu depois de criar o convite
  assert.equal((await inv.acceptInvitation(repo, { token: c.token, user: guest })).code, "not_found");
  assert.equal(await memberships(guest.id, clinic), 0);
  assert.equal((await row(c.invitation.id)).status, "PENDING");
  // registro Google (b) tambem recusa e nao deixa User nem Identity
  const google = { sub: `${tag}-ig-sub`, email: `${tag}-ig-new@example.test` };
  const c2 = await newInvite(clinic, admin.id, google.email);
  await prisma.clinicMembership.deleteMany({ where: { userId: admin.id, clinicId: clinic } });
  const r = await inv.registerGoogleByInvite(repo, { token: c2.token, google, profile, passwordHash: "x" });
  assert.deepEqual([r.ok, r.code], [false, "invite_invalid"]);
  assert.equal(await prisma.user.count({ where: { email: google.email } }), 0);
  assert.equal(await prisma.userIdentity.count({ where: { providerSubject: google.sub } }), 0);
  // convite sem autor (invitedById null, ex.: usuario apagado)
  await prisma.clinicMembership.create({ data: { userId: admin.id, clinicId: clinic, role: "ADMIN" } });
  await prisma.clinicInvitation.update({ where: { id: c.invitation.id }, data: { invitedById: null } });
  assert.equal((await inv.acceptInvitation(repo, { token: c.token, user: guest })).code, "not_found");
});

test("db: autor ainda membro mas sem settings:team (rebaixado/matriz) => aceite e registro Google recusados; ADMIN com matriz {} segue valido", opts, async () => {
  const clinic = await makeClinic("inviter-nomatrix");
  const admin = await makeUser("nm-admin");
  const guest = await makeUser("nm-guest");
  const google = { sub: `${tag}-nm-sub`, email: `${tag}-nm-new@example.test` };
  const c = await newInvite(clinic, admin.id, guest.email);
  const c2 = await newInvite(clinic, admin.id, google.email);
  // ADMIN com matriz vazia (default tem settings:team): valido, nao e consumido aqui
  await prisma.clinic.update({ where: { id: clinic }, data: { rolePermissions: {} } });
  assert.equal(await inv.inviterCanInvite(repo, { invitedById: admin.id, clinicId: clinic }), true);
  // rebaixa para STAFF mantendo a membership
  await prisma.clinicMembership.update({ where: { userId_clinicId: { userId: admin.id, clinicId: clinic } }, data: { role: "STAFF" } });
  assert.equal((await inv.acceptInvitation(repo, { token: c.token, user: guest })).code, "not_found");
  assert.equal(await memberships(guest.id, clinic), 0);
  assert.equal((await row(c.invitation.id)).status, "PENDING");
  const r = await inv.registerGoogleByInvite(repo, { token: c2.token, google, profile, passwordHash: "x" });
  assert.deepEqual([r.ok, r.code], [false, "invite_invalid"]);
  assert.equal(await prisma.user.count({ where: { email: google.email } }), 0);
  assert.equal(await prisma.userIdentity.count({ where: { providerSubject: google.sub } }), 0);
  assert.equal((await row(c2.invitation.id)).status, "PENDING");
  // revogacao pela matriz: STAFF com settings:team concedido aceita; revogado, recusa
  await prisma.clinic.update({ where: { id: clinic }, data: { rolePermissions: { STAFF: { "settings:team": true } } } });
  assert.equal(await inv.inviterCanInvite(repo, { invitedById: admin.id, clinicId: clinic }), true);
  await prisma.clinic.update({ where: { id: clinic }, data: { rolePermissions: { STAFF: { "settings:team": false } } } });
  assert.equal(await inv.inviterCanInvite(repo, { invitedById: admin.id, clinicId: clinic }), false);
});
