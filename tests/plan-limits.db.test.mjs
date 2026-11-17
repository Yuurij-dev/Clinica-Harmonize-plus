import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import * as inv from "../src/lib/invitations.ts";
import { createPrismaInvitationRepo } from "../src/lib/invitations-repo.ts";
import { countPatients, countProfessionalSlots, lockPlanResource, reserveCapacity } from "../src/lib/plan-usage.ts";
import { disconnectCalendar } from "../src/lib/google-calendar-connection-service.ts";
import { clinicHasActiveConnection } from "../src/lib/calendar-sync-queue.ts";
import { countsAsProfessional } from "../src/lib/plans.ts";

// Limites comerciais (profissionais e pacientes) contra o Postgres LOCAL, com concorrência real: advisory lock por clínica,
// convites pendentes reservando vaga, aceite sem contar duas vezes, downgrade preservando tudo e isolamento entre clínicas.
// Ignora se DATABASE_URL não for localhost/127.0.0.1, banco harmonize. Cria só dados com prefixo único e remove no fim.
// As rotas HTTP (team, patients, convites) são cobertas pelo e2e (parte planos_limites); aqui valem os serviços e a transação.

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
    skipReason = "DATABASE_URL nao aponta para o banco local de dev (localhost/127.0.0.1, banco harmonize): teste de banco ignorado";
  } else {
    prisma = new PrismaClient({ datasourceUrl: `${url}${url.includes("?") ? "&" : "?"}connection_limit=40&pool_timeout=20` });
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.clinicSubscription.count();
    } catch {
      skipReason = "banco local sem a migration clinic_subscriptions: teste de banco ignorado";
      await prisma.$disconnect().catch(() => {});
      prisma = null;
    }
  }
}
const opts = { skip: skipReason ?? false };
const repo = prisma ? createPrismaInvitationRepo(prisma) : null;

const tag = `zzlim${Date.now().toString(36)}`;
const created = { clinics: [], users: [] };
let seq = 0;

async function makeClinic(label, subscription = { plan: "start", status: "ACTIVE" }) {
  const clinic = await prisma.clinic.create({ data: { name: `${tag} ${label}`, slug: `${tag}-${label}` }, select: { id: true } });
  created.clinics.push(clinic.id);
  // O trigger já criou a assinatura TRIALING; aqui ela passa ao estado do cenário.
  await prisma.clinicSubscription.update({ where: { clinicId: clinic.id }, data: subscription });
  return clinic.id;
}
async function makeUser(label) {
  seq += 1;
  const email = `${tag}-${label}-${seq}@example.test`;
  const user = await prisma.user.create({ data: { name: `${tag}-${label}`, email, passwordHash: "x", role: "STAFF" }, select: { id: true } });
  created.users.push(user.id);
  return { id: user.id, email };
}
async function addMember(clinicId, role, { owner = false } = {}) {
  const user = await makeUser(role.toLowerCase());
  await prisma.clinicMembership.create({ data: { userId: user.id, clinicId, role, isOwner: owner } });
  return user;
}
// Espelha POST /api/team (mesma sequência: trava + contagem + criação na MESMA transação).
async function addMemberLikeTeamRoute(clinicId, role) {
  return prisma.$transaction(async (tx) => {
    if (countsAsProfessional(role)) {
      const capacity = await reserveCapacity(tx, clinicId, "professionals");
      if (!capacity.ok) return { denied: capacity.body };
    }
    seq += 1;
    const user = await tx.user.create({ data: { name: `${tag}-team`, email: `${tag}-team-${seq}@example.test`, passwordHash: "x", role: "STAFF" }, select: { id: true } });
    created.users.push(user.id);
    await tx.clinicMembership.create({ data: { userId: user.id, clinicId, role } });
    return { userId: user.id };
  });
}
// Espelha POST /api/patients.
async function addPatientLikeRoute(clinicId, label) {
  return prisma.$transaction(async (tx) => {
    const capacity = await reserveCapacity(tx, clinicId, "patients");
    if (!capacity.ok) return { denied: capacity.body };
    const patient = await tx.patient.create({ data: { clinicId, name: `${tag} ${label}`, phone: "11999990000", age: 30 }, select: { id: true } });
    return { patient };
  });
}
async function bulkPatients(clinicId, count) {
  await prisma.patient.createMany({ data: Array.from({ length: count }, (_, i) => ({ clinicId, name: `${tag} bulk ${i}`, phone: "11999990000", age: 30 })) });
}
const slots = (clinicId) => countProfessionalSlots(prisma, clinicId);
const invite = (clinicId, invitedById, label, role, now = new Date(Date.now() - 120_000)) => {
  seq += 1;
  return inv.createInvitation(repo, { clinicId, invitedById, email: `${tag}-${label}-${seq}@example.test`, role, deliveryReady: true }, now);
};
const row = (id) => prisma.clinicInvitation.findUnique({ where: { id } });
// O aceite exige que o e-mail da conta seja o do convite: cria o usuario convidado com esse e-mail.
async function guestOf(invitationId) {
  const { email } = await row(invitationId);
  const user = await prisma.user.create({ data: { name: `${tag}-guest`, email, passwordHash: "x", role: "STAFF" }, select: { id: true } });
  created.users.push(user.id);
  return { id: user.id, email };
}

after(async () => {
  if (!prisma) return;
  try {
    const { clinics, users } = created;
    await prisma.googleCalendarEvent.deleteMany({ where: { clinicId: { in: clinics } } });
    await prisma.googleCalendarConnection.deleteMany({ where: { clinicId: { in: clinics } } });
    await prisma.appointment.deleteMany({ where: { clinicId: { in: clinics } } });
    await prisma.clinicInvitation.deleteMany({ where: { clinicId: { in: clinics } } });
    await prisma.clinicMembership.deleteMany({ where: { OR: [{ clinicId: { in: clinics } }, { userId: { in: users } }] } });
    await prisma.patient.deleteMany({ where: { clinicId: { in: clinics } } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinics } } });
    await prisma.user.deleteMany({ where: { OR: [{ id: { in: users } }, { email: { startsWith: tag } }] } });
  } finally {
    await prisma.$disconnect();
  }
});

// ===== Profissionais =====

test("Start: 2 profissionais (ADMIN + PROFESSIONAL) e o terceiro é bloqueado com PLAN_LIMIT", opts, async () => {
  const clinic = await makeClinic("start-prof");
  await addMember(clinic, "ADMIN", { owner: true });
  assert.equal((await addMemberLikeTeamRoute(clinic, "PROFESSIONAL")).denied, undefined);
  assert.equal(await slots(clinic), 2);
  const third = await addMemberLikeTeamRoute(clinic, "PROFESSIONAL");
  assert.deepEqual({ code: third.denied.code, resource: third.denied.resource, limit: third.denied.limit, used: third.denied.used }, { code: "PLAN_LIMIT", resource: "professionals", limit: 2, used: 2 });
  assert.equal((await addMemberLikeTeamRoute(clinic, "ADMIN")).denied.code, "PLAN_LIMIT"); // ADMIN também consome
  assert.equal(await slots(clinic), 2);
});

test("Pro: 5 profissionais e o sexto é bloqueado", opts, async () => {
  const clinic = await makeClinic("pro-prof", { plan: "pro", status: "ACTIVE" });
  await addMember(clinic, "ADMIN", { owner: true });
  for (let i = 0; i < 4; i += 1) assert.equal((await addMemberLikeTeamRoute(clinic, "PROFESSIONAL")).denied, undefined);
  assert.equal(await slots(clinic), 5);
  assert.equal((await addMemberLikeTeamRoute(clinic, "PROFESSIONAL")).denied.limit, 5);
  assert.equal(await slots(clinic), 5);
});

test("Premium e teste grátis: sem limite de profissionais", opts, async () => {
  const premium = await makeClinic("premium-prof", { plan: "premium", status: "ACTIVE" });
  await addMember(premium, "ADMIN", { owner: true });
  for (let i = 0; i < 8; i += 1) assert.equal((await addMemberLikeTeamRoute(premium, "PROFESSIONAL")).denied, undefined);
  assert.equal(await slots(premium), 9);
  const trial = await makeClinic("trial-prof", { plan: null, status: "TRIALING", trialEndsAt: new Date(Date.now() + 86_400_000) });
  await addMember(trial, "ADMIN", { owner: true });
  for (let i = 0; i < 4; i += 1) assert.equal((await addMemberLikeTeamRoute(trial, "PROFESSIONAL")).denied, undefined);
});

test("STAFF não consome vaga (nem na criação, nem na contagem)", opts, async () => {
  const clinic = await makeClinic("staff");
  await addMember(clinic, "ADMIN", { owner: true });
  for (let i = 0; i < 5; i += 1) assert.equal((await addMemberLikeTeamRoute(clinic, "STAFF")).denied, undefined);
  assert.equal(await slots(clinic), 1);
  assert.equal((await addMemberLikeTeamRoute(clinic, "PROFESSIONAL")).denied, undefined); // ainda cabe um profissional
  assert.equal((await addMemberLikeTeamRoute(clinic, "PROFESSIONAL")).denied.code, "PLAN_LIMIT");
});

test("convite pendente de PROFESSIONAL reserva vaga; STAFF não; convite vencido não reserva", opts, async () => {
  const clinic = await makeClinic("pending");
  const owner = await addMember(clinic, "ADMIN", { owner: true });
  const first = await invite(clinic, owner.id, "prof", "PROFESSIONAL");
  assert.equal(first.ok, true);
  assert.equal(await slots(clinic), 2); // membro + convite pendente
  const second = await invite(clinic, owner.id, "prof2", "PROFESSIONAL");
  assert.equal(second.ok, false);
  assert.equal(second.status, 403);
  assert.equal(second.code, "PLAN_LIMIT");
  assert.equal(second.plan.limit, 2);
  assert.equal((await invite(clinic, owner.id, "staff", "STAFF")).ok, true); // STAFF passa com o limite cheio
  // vencido deixa de reservar
  await prisma.clinicInvitation.update({ where: { id: first.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await slots(clinic), 1);
  assert.equal((await invite(clinic, owner.id, "prof3", "PROFESSIONAL", new Date())).ok, true); // agora real: o vencido já passou
  // reenviar o vencido volta a PENDING e exige a vaga de novo: agora está cheio
  const resend = await inv.resendInvitation(repo, { clinicId: clinic, id: first.invitation.id, deliveryReady: true }, new Date(Date.now() + 120_000));
  assert.equal(resend.ok, false);
  assert.equal(resend.code, "PLAN_LIMIT");
});

test("aceite: convite aceito não é contado duas vezes e a vaga reservada garante o aceite", opts, async () => {
  const clinic = await makeClinic("accept");
  const owner = await addMember(clinic, "ADMIN", { owner: true });
  const sent = await invite(clinic, owner.id, "guest", "PROFESSIONAL");
  assert.equal(sent.ok, true);
  assert.equal(await slots(clinic), 2);
  const guest = await guestOf(sent.invitation.id);
  const accepted = await inv.acceptInvitation(repo, { token: sent.token, user: guest });
  assert.equal(accepted.ok, true);
  assert.equal(await slots(clinic), 2); // 2 membros, 0 pendentes: sem dupla contagem
  assert.equal((await row(sent.invitation.id)).status, "ACCEPTED");
  assert.equal((await invite(clinic, owner.id, "late", "PROFESSIONAL")).code, "PLAN_LIMIT");
});

test("aceite de convite de STAFF e de quem já é membro nunca consome nem checa vaga", opts, async () => {
  const clinic = await makeClinic("accept-staff");
  const owner = await addMember(clinic, "ADMIN", { owner: true });
  await addMember(clinic, "PROFESSIONAL");
  const staffInvite = await invite(clinic, owner.id, "staff", "STAFF");
  const guest = await guestOf(staffInvite.invitation.id);
  assert.equal((await inv.acceptInvitation(repo, { token: staffInvite.token, user: guest })).ok, true);
  assert.equal(await slots(clinic), 2);
});

test("dois aceites simultâneos, cada um com a vaga já reservada, dão certo sem passar do limite", opts, async () => {
  const clinic = await makeClinic("two-accepts", { plan: "pro", status: "ACTIVE" });
  const owner = await addMember(clinic, "ADMIN", { owner: true });
  for (let i = 0; i < 2; i += 1) await addMember(clinic, "PROFESSIONAL"); // 3 membros
  const a = await invite(clinic, owner.id, "a", "PROFESSIONAL");
  const b = await invite(clinic, owner.id, "b", "PROFESSIONAL"); // 5 reservados = limite do Pro
  assert.equal(a.ok && b.ok, true);
  const [ga, gb] = [await guestOf(a.invitation.id), await guestOf(b.invitation.id)];
  const results = await Promise.all([
    inv.acceptInvitation(repo, { token: a.token, user: ga }),
    inv.acceptInvitation(repo, { token: b.token, user: gb }),
  ]);
  assert.deepEqual(results.map((r) => r.ok), [true, true]);
  assert.equal(await slots(clinic), 5);
  assert.equal((await addMemberLikeTeamRoute(clinic, "PROFESSIONAL")).denied.code, "PLAN_LIMIT");
});

test("disputa pela última vaga: criação de convite x criação direta x cadastro, exatamente uma vence", opts, async () => {
  const clinic = await makeClinic("last-slot", { plan: "pro", status: "ACTIVE" });
  const owner = await addMember(clinic, "ADMIN", { owner: true });
  for (let i = 0; i < 3; i += 1) await addMember(clinic, "PROFESSIONAL"); // 4 de 5
  const attempts = [
    ...Array.from({ length: 5 }, (_, i) => invite(clinic, owner.id, `race${i}`, "PROFESSIONAL").then((r) => ({ ok: r.ok, code: r.code }))),
    ...Array.from({ length: 5 }, () => addMemberLikeTeamRoute(clinic, "PROFESSIONAL").then((r) => ({ ok: !r.denied, code: r.denied?.code }))),
  ];
  const settled = await Promise.all(attempts);
  assert.equal(settled.filter((r) => r.ok).length, 1, JSON.stringify(settled));
  assert.equal(settled.filter((r) => r.code === "PLAN_LIMIT").length, 9);
  assert.equal(await slots(clinic), 5); // nunca passa do limite
});

test("dois aceites disputando a vaga depois de um downgrade: nenhum passa do limite e nenhum convite é consumido", opts, async () => {
  const clinic = await makeClinic("downgrade-accept", { plan: "pro", status: "ACTIVE" });
  const owner = await addMember(clinic, "ADMIN", { owner: true });
  await addMember(clinic, "PROFESSIONAL"); // 2 membros
  const a = await invite(clinic, owner.id, "da", "PROFESSIONAL");
  const b = await invite(clinic, owner.id, "db", "PROFESSIONAL"); // 4 reservados
  await prisma.clinicSubscription.update({ where: { clinicId: clinic }, data: { plan: "start" } }); // limite cai para 2
  const [ga, gb] = [await guestOf(a.invitation.id), await guestOf(b.invitation.id)];
  const results = await Promise.all([
    inv.acceptInvitation(repo, { token: a.token, user: ga }),
    inv.acceptInvitation(repo, { token: b.token, user: gb }),
  ]);
  assert.deepEqual(results.map((r) => r.code), ["plan_limit", "plan_limit"]);
  assert.equal(results[0].plan.code, "PLAN_LIMIT");
  assert.equal((await row(a.invitation.id)).status, "PENDING"); // não foi consumido
  assert.equal((await row(b.invitation.id)).status, "PENDING");
  assert.equal(await prisma.clinicMembership.count({ where: { clinicId: clinic } }), 2);
});

test("registro por convite (conta nova por senha e por Google) respeita o limite e desfaz o usuário", opts, async () => {
  const clinic = await makeClinic("register-limit", { plan: "pro", status: "ACTIVE" });
  const owner = await addMember(clinic, "ADMIN", { owner: true });
  await addMember(clinic, "PROFESSIONAL");
  const a = await invite(clinic, owner.id, "ra", "PROFESSIONAL");
  const b = await invite(clinic, owner.id, "rb", "PROFESSIONAL");
  assert.equal(a.ok && b.ok, true);
  await prisma.clinicSubscription.update({ where: { clinicId: clinic }, data: { plan: "start" } }); // convites pendentes ficam acima do limite
  const profile = { name: "Convidado", cpf: "52998224725", postalCode: "01310100", address: "Rua A, 1", country: "Brasil", state: "SP", city: "Sao Paulo" };
  const emailA = (await row(a.invitation.id)).email;
  const byPassword = await inv.registerByInvite(repo, { token: a.token, ...profile, password: "senha-forte-1", hashPassword: async () => "hash" });
  assert.equal(byPassword.ok, false);
  assert.equal(byPassword.status, 403);
  assert.equal(byPassword.plan.code, "PLAN_LIMIT");
  assert.equal(await prisma.user.count({ where: { email: emailA } }), 0, "a criação do usuário foi desfeita");
  const emailB = (await row(b.invitation.id)).email;
  const byGoogle = await inv.registerGoogleByInvite(repo, { token: b.token, google: { sub: `sub-${tag}`, email: emailB }, profile, passwordHash: "x" });
  assert.deepEqual({ ok: byGoogle.ok, code: byGoogle.code }, { ok: false, code: "plan_limit" });
  assert.equal(await prisma.user.count({ where: { email: emailB } }), 0);
  assert.equal((await row(a.invitation.id)).status, "PENDING");
});

test("downgrade com membros acima do limite: preserva todos, bloqueia só novas inclusões", opts, async () => {
  const clinic = await makeClinic("downgrade-prof", { plan: "premium", status: "ACTIVE" });
  await addMember(clinic, "ADMIN", { owner: true });
  for (let i = 0; i < 6; i += 1) await addMember(clinic, "PROFESSIONAL"); // 7 profissionais
  await prisma.clinicSubscription.update({ where: { clinicId: clinic }, data: { plan: "start" } });
  assert.equal(await prisma.clinicMembership.count({ where: { clinicId: clinic } }), 7); // ninguém foi removido
  const denied = await addMemberLikeTeamRoute(clinic, "PROFESSIONAL");
  assert.deepEqual({ code: denied.denied.code, limit: denied.denied.limit, used: denied.denied.used }, { code: "PLAN_LIMIT", limit: 2, used: 7 });
  assert.equal((await addMemberLikeTeamRoute(clinic, "STAFF")).denied, undefined); // STAFF continua permitido
  assert.equal(await slots(clinic), 7);
});

test("promoção de STAFF para PROFESSIONAL consome vaga; ADMIN<->PROFESSIONAL não (lógica do PATCH /api/team)", opts, async () => {
  const clinic = await makeClinic("promote");
  await addMember(clinic, "ADMIN", { owner: true });
  const prof = await addMember(clinic, "PROFESSIONAL"); // cheio (2/2)
  const staff = await addMember(clinic, "STAFF");
  // Mesma sequência do PATCH: trava, relê o cargo atual e só pede vaga quem estava fora (STAFF).
  const change = (userId, newRole) => prisma.$transaction(async (tx) => {
    const membership = await tx.clinicMembership.findFirst({ where: { userId, clinicId: clinic }, select: { id: true, role: true } });
    if (countsAsProfessional(newRole)) {
      await lockPlanResource(tx, clinic, "professionals");
      const current = await tx.clinicMembership.findFirst({ where: { id: membership.id }, select: { role: true } });
      if (!countsAsProfessional(current.role)) {
        const capacity = await reserveCapacity(tx, clinic, "professionals");
        if (!capacity.ok) return { denied: capacity.body };
      }
    }
    await tx.clinicMembership.update({ where: { id: membership.id }, data: { role: newRole } });
    return { ok: true };
  });
  assert.equal((await change(staff.id, "PROFESSIONAL")).denied.code, "PLAN_LIMIT");
  assert.equal((await change(prof.id, "ADMIN")).ok, true); // já contava: sem custo
  assert.equal((await change(prof.id, "STAFF")).ok, true); // libera a vaga
  assert.equal((await change(staff.id, "PROFESSIONAL")).ok, true);
  // duas promoções simultâneas disputando uma única vaga
  const clinic2 = await makeClinic("promote2");
  await addMember(clinic2, "ADMIN", { owner: true });
  const s1 = await addMember(clinic2, "STAFF");
  const s2 = await addMember(clinic2, "STAFF");
  const promote = (userId) => prisma.$transaction(async (tx) => {
    await lockPlanResource(tx, clinic2, "professionals");
    const capacity = await reserveCapacity(tx, clinic2, "professionals");
    if (!capacity.ok) return { denied: capacity.body };
    await tx.clinicMembership.updateMany({ where: { userId, clinicId: clinic2 }, data: { role: "PROFESSIONAL" } });
    return { ok: true };
  });
  const both = await Promise.all([promote(s1.id), promote(s2.id)]);
  assert.equal(both.filter((r) => r.ok).length, 1);
  assert.equal(await slots(clinic2), 2);
});

// ===== Pacientes =====

test("Start: 100 pacientes e o 101º é bloqueado; Pro e Premium sem limite", opts, async () => {
  const clinic = await makeClinic("start-pat");
  await bulkPatients(clinic, 99);
  assert.equal((await addPatientLikeRoute(clinic, "n100")).denied, undefined);
  assert.equal(await countPatients(prisma, clinic), 100);
  const blocked = await addPatientLikeRoute(clinic, "n101");
  assert.deepEqual({ code: blocked.denied.code, resource: blocked.denied.resource, limit: blocked.denied.limit, used: blocked.denied.used }, { code: "PLAN_LIMIT", resource: "patients", limit: 100, used: 100 });
  assert.equal(await countPatients(prisma, clinic), 100);
  for (const plan of ["pro", "premium"]) {
    const other = await makeClinic(`${plan}-pat`, { plan, status: "ACTIVE" });
    await bulkPatients(other, 120);
    assert.equal((await addPatientLikeRoute(other, "extra")).denied, undefined, plan);
    assert.equal(await countPatients(prisma, other), 121);
  }
});

test("dois cadastros simultâneos disputando o último paciente: exatamente um vence", opts, async () => {
  const clinic = await makeClinic("race-pat");
  await bulkPatients(clinic, 99);
  const settled = await Promise.all(Array.from({ length: 8 }, (_, i) => addPatientLikeRoute(clinic, `race${i}`)));
  assert.equal(settled.filter((r) => !r.denied).length, 1);
  assert.equal(settled.filter((r) => r.denied?.code === "PLAN_LIMIT").length, 7);
  assert.equal(await countPatients(prisma, clinic), 100);
});

test("prova de causalidade: sem a trava por clínica o limite de pacientes estoura (a trava é a causa)", opts, async () => {
  const clinic = await makeClinic("nolock-pat");
  await bulkPatients(clinic, 95);
  const N = 12;
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const timer = setTimeout(release, 4000);
  const unlocked = () => prisma.$transaction(async (tx) => {
    const used = await tx.patient.count({ where: { clinicId: clinic } });
    if (++arrived >= N) { clearTimeout(timer); release(); }
    await gate; // todas contam antes de qualquer criação
    if (used + 1 > 100) return { denied: true };
    await tx.patient.create({ data: { clinicId: clinic, name: `${tag} nolock`, phone: "11999990000", age: 30 } });
    return { ok: true };
  });
  await Promise.all(Array.from({ length: N }, unlocked));
  clearTimeout(timer);
  assert.ok((await countPatients(prisma, clinic)) > 100, "sem trava, a corrida ultrapassa 100");
});

test("downgrade com mais de 100 pacientes: tudo preservado e editável, só o novo cadastro é bloqueado", opts, async () => {
  const clinic = await makeClinic("downgrade-pat", { plan: "premium", status: "ACTIVE" });
  await bulkPatients(clinic, 150);
  await prisma.clinicSubscription.update({ where: { clinicId: clinic }, data: { plan: "start" } });
  assert.equal(await countPatients(prisma, clinic), 150);
  const denied = await addPatientLikeRoute(clinic, "novo");
  assert.deepEqual({ code: denied.denied.code, used: denied.denied.used, limit: denied.denied.limit }, { code: "PLAN_LIMIT", used: 150, limit: 100 });
  // consulta e edição de paciente existente não dependem do limite
  const existing = await prisma.patient.findFirst({ where: { clinicId: clinic }, select: { id: true } });
  const updated = await prisma.patient.update({ where: { id: existing.id }, data: { phone: "11888887777" }, select: { phone: true } });
  assert.equal(updated.phone, "11888887777");
  assert.equal(await countPatients(prisma, clinic), 150);
});

test("somente leitura bloqueia novo cadastro mesmo abaixo do limite (SUBSCRIPTION_READONLY)", opts, async () => {
  const clinic = await makeClinic("ro-pat", { plan: "pro", status: "EXPIRED" });
  const denied = await addPatientLikeRoute(clinic, "x");
  assert.equal(denied.denied.code, "SUBSCRIPTION_READONLY");
  assert.equal(await countPatients(prisma, clinic), 0);
  const staff = await makeClinic("ro-prof", { plan: "pro", status: "EXPIRED" });
  assert.equal((await addMemberLikeTeamRoute(staff, "PROFESSIONAL")).denied.code, "SUBSCRIPTION_READONLY");
});

// ===== Isolamento =====

test("clínicas com planos diferentes são independentes (limites, contagens e locks por clínica)", opts, async () => {
  const start = await makeClinic("iso-start");
  const premium = await makeClinic("iso-premium", { plan: "premium", status: "ACTIVE" });
  await bulkPatients(start, 100);
  await bulkPatients(premium, 100);
  assert.equal((await addPatientLikeRoute(start, "a")).denied.code, "PLAN_LIMIT");
  assert.equal((await addPatientLikeRoute(premium, "a")).denied, undefined);
  assert.equal(await countPatients(prisma, start), 100);
  assert.equal(await countPatients(prisma, premium), 101);
  // convite pendente da clínica A não ocupa vaga da B, e membros de uma não aparecem na outra
  const ownerA = await addMember(start, "ADMIN", { owner: true });
  const ownerB = await addMember(premium, "ADMIN", { owner: true });
  await addMember(premium, "PROFESSIONAL");
  assert.equal((await invite(start, ownerA.id, "iso", "PROFESSIONAL")).ok, true);
  assert.equal(await slots(start), 2);
  assert.equal(await slots(premium), 2);
  // trocar o plano de uma não afeta a outra
  await prisma.clinicSubscription.update({ where: { clinicId: premium }, data: { plan: "start" } });
  assert.equal((await invite(start, ownerA.id, "iso2", "PROFESSIONAL")).code, "PLAN_LIMIT");
  assert.equal((await invite(premium, ownerB.id, "iso3", "PROFESSIONAL")).code, "PLAN_LIMIT");
  await prisma.clinicSubscription.update({ where: { clinicId: premium }, data: { plan: "premium" } });
  assert.equal((await invite(premium, ownerB.id, "iso4", "PROFESSIONAL")).ok, true);
});

test("uma clínica disputando a última vaga não trava a outra (locks independentes)", opts, async () => {
  const a = await makeClinic("lock-a", { plan: "pro", status: "ACTIVE" });
  const b = await makeClinic("lock-b", { plan: "pro", status: "ACTIVE" });
  await addMember(a, "ADMIN", { owner: true });
  await addMember(b, "ADMIN", { owner: true });
  const results = await Promise.all([
    ...Array.from({ length: 4 }, () => addMemberLikeTeamRoute(a, "PROFESSIONAL")),
    ...Array.from({ length: 4 }, () => addMemberLikeTeamRoute(b, "PROFESSIONAL")),
  ]);
  assert.equal(results.filter((r) => !r.denied).length, 8); // cada clínica tinha 4 vagas livres (limite 5)
  assert.equal(await slots(a), 5);
  assert.equal(await slots(b), 5);
});

// ===== Google Agenda: desconexão em somente leitura =====

test("desconectar o Google Agenda em somente leitura: revoga o token, apaga os tokens locais, para novas sincronizações e preserva os dados", opts, async () => {
  const clinic = await makeClinic("gcal-ro", { plan: "premium", status: "EXPIRED" });
  const admin = await addMember(clinic, "ADMIN", { owner: true });
  const patient = await prisma.patient.create({ data: { clinicId: clinic, name: `${tag} gcal`, phone: "11999990000", age: 30 }, select: { id: true } });
  const appointment = await prisma.appointment.create({ data: { clinicId: clinic, patientId: patient.id, procedure: "X", professional: "Y", date: new Date(), time: "10:00", durationMinutes: 30, status: "Agendado" }, select: { id: true } }).catch(() => null);
  const connection = await prisma.googleCalendarConnection.create({
    data: { clinicId: clinic, userId: admin.id, googleEmail: `${tag}@example.test`, googleAccountId: `acc-${tag}`, connectionType: "ADMIN", status: "CONNECTED", accessTokenEncrypted: "enc", refreshTokenEncrypted: null, tokenExpiresAt: new Date(Date.now() + 3600_000) },
    select: { id: true },
  });
  if (appointment) await prisma.googleCalendarEvent.create({ data: { clinicId: clinic, appointmentId: appointment.id, connectionId: connection.id, googleEventId: `ev-${tag}`, role: "CENTRAL" } });
  assert.equal(await clinicHasActiveConnection(prisma, clinic), true);

  const revoked = [];
  const result = await disconnectCalendar(
    { db: prisma, client: { revokeToken: async (token) => { revoked.push(token); } }, env: process.env },
    { user: { id: admin.id, clinicId: clinic, role: "ADMIN", isOwner: true, rolePermissions: undefined }, type: "ADMIN" },
  );
  assert.equal(result.ok, true);
  const after = await prisma.googleCalendarConnection.findUnique({ where: { id: connection.id } });
  assert.equal(after.status, "DISCONNECTED");
  assert.equal(after.accessTokenEncrypted, null);
  assert.equal(after.refreshTokenEncrypted, null);
  assert.equal(after.tokenExpiresAt, null);
  assert.equal(await clinicHasActiveConnection(prisma, clinic), false); // futuras sincronizações não entram na fila
  // nada além da conexão foi apagado
  assert.equal(await prisma.patient.count({ where: { id: patient.id } }), 1);
  if (appointment) {
    assert.equal(await prisma.appointment.count({ where: { id: appointment.id } }), 1);
    assert.equal(await prisma.googleCalendarEvent.count({ where: { connectionId: connection.id } }), 1);
  }
});

// ===== Revisão da etapa 4: deadlock, causalidade para profissionais e atalho sem limite =====

test("sem deadlock: criar convite (com convite vencido do mesmo e-mail) x PATCH de cargo que cancela convites do mesmo autor", opts, async () => {
  const { cancelPendingByInviter } = await import("../src/lib/invitations-repo.ts");
  const clinic = await makeClinic("deadlock", { plan: "pro", status: "ACTIVE" });
  const admin = await addMember(clinic, "ADMIN", { owner: true });
  const inviter = await addMember(clinic, "ADMIN");
  let failures = 0;
  for (let round = 0; round < 12; round += 1) {
    const email = `${tag}-dl-${round}@example.test`;
    // convite PENDING ja vencido do mesmo e-mail (o expireStalePending atualiza esta linha) criado pelo mesmo autor
    await prisma.clinicInvitation.create({ data: { clinicId: clinic, email, role: "PROFESSIONAL", tokenHash: `h-${tag}-${round}`, expiresAt: new Date(Date.now() - 60_000), invitedById: inviter.id, status: "PENDING", lastSentAt: new Date(Date.now() - 120_000) } });
    const create = inv.createInvitation(repo, { clinicId: clinic, invitedById: admin.id, email, role: "PROFESSIONAL", deliveryReady: true }, new Date());
    // mesma sequencia do PATCH de cargo: lock do plano e depois atualiza convites pendentes do autor
    const patch = prisma.$transaction(async (tx) => {
      await lockPlanResource(tx, clinic, "professionals");
      await cancelPendingByInviter(tx, { clinicId: clinic, invitedById: inviter.id });
    });
    const settled = await Promise.allSettled([create, patch]);
    failures += settled.filter((r) => r.status === "rejected").length;
  }
  assert.equal(failures, 0, "nenhuma das transacoes pode ser abortada por deadlock");
});

test("prova de causalidade: sem a trava por clínica o limite de profissionais estoura", opts, async () => {
  const clinic = await makeClinic("nolock-prof");
  await addMember(clinic, "ADMIN", { owner: true }); // 1 de 2
  const N = 10;
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const timer = setTimeout(release, 4000);
  const unlocked = () => prisma.$transaction(async (tx) => {
    const used = await countProfessionalSlots(tx, clinic);
    if (++arrived >= N) { clearTimeout(timer); release(); }
    await gate;
    if (used + 1 > 2) return { denied: true };
    seq += 1;
    const user = await tx.user.create({ data: { name: `${tag}-nl`, email: `${tag}-nl-${seq}@example.test`, passwordHash: "x", role: "STAFF" }, select: { id: true } });
    created.users.push(user.id);
    await tx.clinicMembership.create({ data: { userId: user.id, clinicId: clinic, role: "PROFESSIONAL" } });
    return { ok: true };
  });
  await Promise.all(Array.from({ length: N }, unlocked));
  clearTimeout(timer);
  assert.ok((await slots(clinic)) > 2, "sem trava, a corrida ultrapassa o limite de 2");
});

test("planos sem limite não travam nem contam: cadastros do Premium não esperam o lock de outra transação", opts, async () => {
  const premium = await makeClinic("nolimit-fast", { plan: "premium", status: "ACTIVE" });
  let releaseHolder;
  const holding = new Promise((resolve) => { releaseHolder = resolve; });
  let locked;
  const lockTaken = new Promise((resolve) => { locked = resolve; });
  const holder = prisma.$transaction(async (tx) => {
    await lockPlanResource(tx, premium, "patients");
    locked();
    await holding;
  });
  await lockTaken;
  const started = Date.now();
  const result = await Promise.race([
    prisma.$transaction((tx) => reserveCapacity(tx, premium, "patients")),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 3000)),
  ]);
  releaseHolder();
  await holder;
  assert.deepEqual(result, { ok: true });
  assert.ok(Date.now() - started < 2500, "o atalho sem limite não aguarda o lock");
  // e um plano COM limite continua se serializando nesse lock (a trava segue valendo onde há limite)
  const start = await makeClinic("limit-waits");
  let releaseHolder2;
  const holding2 = new Promise((resolve) => { releaseHolder2 = resolve; });
  let locked2;
  const lockTaken2 = new Promise((resolve) => { locked2 = resolve; });
  const holder2 = prisma.$transaction(async (tx) => { await lockPlanResource(tx, start, "patients"); locked2(); await holding2; });
  await lockTaken2;
  const waiting = await Promise.race([
    prisma.$transaction((tx) => reserveCapacity(tx, start, "patients")),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 800)),
  ]);
  assert.equal(waiting, "blocked", "com limite, a reserva espera o lock da outra transação");
  releaseHolder2();
  await holder2;
});

// ===== Etapa 5, decisão 1: aceite bloqueado em somente leitura (banco real) =====

test("clínica em somente leitura: aceite (sessão, senha e Google) de convite de STAFF é bloqueado e nada é criado/consumido", opts, async () => {
  const clinic = await makeClinic("ro-accept", { plan: "pro", status: "ACTIVE" });
  const owner = await addMember(clinic, "ADMIN", { owner: true });
  const staff = await invite(clinic, owner.id, "ro-staff", "STAFF");
  const prof = await invite(clinic, owner.id, "ro-prof", "PROFESSIONAL");
  const viaPassword = await invite(clinic, owner.id, "ro-pass", "STAFF");
  const viaGoogle = await invite(clinic, owner.id, "ro-goog", "STAFF");
  assert.equal(staff.ok && prof.ok && viaPassword.ok && viaGoogle.ok, true);
  await prisma.clinicSubscription.update({ where: { clinicId: clinic }, data: { status: "EXPIRED" } });
  const guestStaff = await guestOf(staff.invitation.id);
  const guestProf = await guestOf(prof.invitation.id);
  const sessionStaff = await inv.acceptInvitation(repo, { token: staff.token, user: guestStaff });
  const sessionProf = await inv.acceptInvitation(repo, { token: prof.token, user: guestProf });
  assert.deepEqual([sessionStaff.ok, sessionStaff.code], [false, "plan_limit"]);
  assert.deepEqual([sessionProf.ok, sessionProf.code], [false, "plan_limit"]);
  assert.equal(sessionStaff.plan.message.includes("limite"), false, "o corpo do convidado não revela limite/estado");
  const profile = { name: "Convidado", cpf: "52998224725", postalCode: "01310100", address: "Rua A, 1", country: "Brasil", state: "SP", city: "Sao Paulo" };
  const emailPass = (await row(viaPassword.invitation.id)).email;
  const byPassword = await inv.registerByInvite(repo, { token: viaPassword.token, ...profile, password: "senha-forte-1", hashPassword: async () => "hash" });
  assert.deepEqual([byPassword.ok, byPassword.status, byPassword.code], [false, 403, "PLAN_LIMIT"]);
  assert.equal(await prisma.user.count({ where: { email: emailPass } }), 0);
  const emailGoog = (await row(viaGoogle.invitation.id)).email;
  const byGoogle = await inv.registerGoogleByInvite(repo, { token: viaGoogle.token, google: { sub: `sub-ro-${tag}`, email: emailGoog }, profile, passwordHash: "x" });
  assert.deepEqual([byGoogle.ok, byGoogle.code], [false, "plan_limit"]);
  assert.equal(await prisma.user.count({ where: { email: emailGoog } }), 0);
  for (const id of [staff.invitation.id, prof.invitation.id, viaPassword.invitation.id, viaGoogle.invitation.id]) assert.equal((await row(id)).status, "PENDING");
  assert.equal(await prisma.clinicMembership.count({ where: { clinicId: clinic } }), 1);
  // ao voltar a ter escrita, o mesmo convite de STAFF é aceito
  await prisma.clinicSubscription.update({ where: { clinicId: clinic }, data: { status: "ACTIVE" } });
  assert.equal((await inv.acceptInvitation(repo, { token: staff.token, user: guestStaff })).ok, true);
});
