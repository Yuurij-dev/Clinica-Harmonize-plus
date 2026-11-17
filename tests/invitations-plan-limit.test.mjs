import assert from "node:assert/strict";
import test from "node:test";
import * as inv from "../src/lib/invitations.ts";
import { INVITEE_LIMIT_MESSAGE } from "../src/lib/plan-errors.ts";
import { makeRepo } from "./helpers/fake-invitation-repo.mjs";

// Lógica de convites x limite de profissionais com o repositório falso (a contagem real e a concorrência estão em
// tests/plan-limits.db.test.mjs). `db.professionalSlot` injeta a decisão do plano da clínica de destino.

const T0 = new Date("2026-06-01T12:00:00.000Z");
const later = (ms) => new Date(T0.getTime() + ms);
const DAY = 86400000;
const PLAN = { code: "PLAN_LIMIT", message: "O plano atual permite até 2 profissionais. Para adicionar mais, faça upgrade do plano.", resource: "professionals", limit: 2, used: 2 };
const full = () => ({ ok: false, plan: PLAN });
// Quem ainda nao e membro (aceite/registro) recebe corpo generico, sem limit/used.
const GENERIC = { code: "PLAN_LIMIT", message: INVITEE_LIMIT_MESSAGE };

const create = (repo, over = {}, now = T0) => inv.createInvitation(repo, { clinicId: "c1", invitedById: "admin", email: "ana@x.com", role: "PROFESSIONAL", deliveryReady: true, ...over }, now);
const guest = (db, email = "ana@x.com") => { db.users.push({ id: "g1", email, name: "g1" }); return { id: "g1", email }; };

test("criar convite: sem vaga devolve 403 PLAN_LIMIT com o corpo do plano e nada é gravado", async () => {
  const { repo, db } = makeRepo();
  db.professionalSlot = full;
  const result = await create(repo);
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "PLAN_LIMIT");
  assert.deepEqual(result.plan, PLAN);
  assert.equal(db.invitations.length, 0);
});

test("criar convite de STAFF nunca consulta o limite de profissionais", async () => {
  const { repo, db } = makeRepo();
  let calls = 0;
  db.professionalSlot = () => { calls += 1; return full(); };
  assert.equal((await create(repo, { role: "STAFF" })).ok, true);
  assert.equal(calls, 0);
});

test("criar convite de PROFESSIONAL consulta a vaga na mesma transação; com vaga, cria", async () => {
  const { repo, db } = makeRepo();
  let calls = 0;
  db.professionalSlot = () => { calls += 1; return { ok: true }; };
  assert.equal((await create(repo)).ok, true);
  assert.equal(calls, 1);
  assert.equal(db.invitations.length, 1);
});

test("aceite sem vaga: plan_limit, convite continua PENDING e nenhum vínculo é criado", async () => {
  const { repo, db } = makeRepo();
  const sent = await create(repo);
  db.professionalSlot = full;
  const user = guest(db);
  const result = await inv.acceptInvitation(repo, { token: sent.token, user }, later(1000));
  assert.deepEqual([result.ok, result.code], [false, "plan_limit"]);
  assert.deepEqual(result.plan, GENERIC);
  assert.equal(db.invitations[0].status, "PENDING");
  assert.equal(db.memberships.length, 0);
});

test("aceite pede a vaga excluindo o próprio convite e só para quem ainda não é membro", async () => {
  const { repo, db } = makeRepo();
  const sent = await create(repo);
  const seen = [];
  db.professionalSlot = () => { seen.push(1); return { ok: true }; };
  // a fake ignora os argumentos; o que importa aqui é quando a consulta acontece
  const user = guest(db);
  assert.equal((await inv.acceptInvitation(repo, { token: sent.token, user }, later(1000))).ok, true);
  assert.equal(seen.length, 1);
  assert.equal(db.memberships.length, 1);

  // já é membro: o convite é consumido sem checar vaga
  const second = makeRepo();
  const s2 = await create(second.repo);
  let calls = 0;
  second.db.professionalSlot = () => { calls += 1; return full(); };
  second.db.users.push({ id: "g1", email: "ana@x.com", name: "g1" });
  second.db.memberships.push({ id: "m0", userId: "g1", clinicId: "c1", role: "STAFF", isOwner: false });
  const result = await inv.acceptInvitation(second.repo, { token: s2.token, user: { id: "g1", email: "ana@x.com" } }, later(1000));
  assert.equal(result.ok, true);
  assert.equal(calls, 0);
});

test("aceite de convite de STAFF não consulta vaga", async () => {
  const { repo, db } = makeRepo();
  const sent = await create(repo, { role: "STAFF" });
  let calls = 0;
  db.professionalSlot = () => { calls += 1; return full(); };
  assert.equal((await inv.acceptInvitation(repo, { token: sent.token, user: guest(db) }, later(1000))).ok, true);
  assert.equal(calls, 0);
});

test("registro por senha sem vaga: 403 PLAN_LIMIT, usuário não é criado e o convite segue pendente", async () => {
  const { repo, db } = makeRepo();
  const sent = await create(repo);
  db.professionalSlot = full;
  const result = await inv.registerByInvite(repo, {
    token: sent.token, name: "Ana", password: "senha-forte-1", cpf: "52998224725", postalCode: "01310100", address: "Rua A, 1", country: "Brasil", state: "SP", city: "Sao Paulo",
    hashPassword: async () => "hash",
  }, later(1000));
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "PLAN_LIMIT");
  assert.deepEqual(result.plan, GENERIC);
  assert.equal(db.users.length, 0, "a criação do usuário foi desfeita");
  assert.equal(db.invitations[0].status, "PENDING");
});

test("registro por Google sem vaga: plan_limit com o corpo do plano, sem usuário nem identidade", async () => {
  const { repo, db } = makeRepo();
  const sent = await create(repo);
  db.professionalSlot = full;
  const result = await inv.registerGoogleByInvite(repo, {
    token: sent.token, google: { sub: "sub1", email: "ana@x.com" },
    profile: { name: "Ana", cpf: "52998224725", postalCode: "01310100", address: "Rua A, 1", country: "Brasil", state: "SP", city: "Sao Paulo" }, passwordHash: "x",
  }, later(1000));
  assert.deepEqual([result.ok, result.code], [false, "plan_limit"]);
  assert.deepEqual(result.plan, GENERIC);
  assert.equal(db.users.length, 0);
  assert.equal(db.identities.length, 0);
});

test("reenvio: convite ainda pendente não pede vaga; vencido que volta a PENDING pede", async () => {
  const { repo, db } = makeRepo();
  const sent = await create(repo);
  let calls = 0;
  db.professionalSlot = () => { calls += 1; return full(); };
  const resent = await inv.resendInvitation(repo, { clinicId: "c1", id: sent.invitation.id, deliveryReady: true }, later(2 * 60_000));
  assert.equal(resent.ok, true);
  assert.equal(calls, 0);
  const expired = await inv.resendInvitation(repo, { clinicId: "c1", id: sent.invitation.id, deliveryReady: true }, later(9 * DAY));
  assert.equal(expired.ok, false);
  assert.equal(expired.code, "PLAN_LIMIT");
  assert.equal(calls, 1);
});

test("somente leitura: o aceite de QUALQUER convite (STAFF inclusive) é bloqueado, com corpo genérico e nada consumido", async () => {
  for (const role of ["STAFF", "PROFESSIONAL"]) {
    const { repo, db } = makeRepo();
    const sent = await create(repo, { role });
    db.clinicReadonly = true;
    const user = guest(db);
    const result = await inv.acceptInvitation(repo, { token: sent.token, user }, later(1000));
    assert.deepEqual([result.ok, result.code], [false, "plan_limit"], role);
    assert.deepEqual(result.plan, GENERIC, role);
    assert.equal(db.invitations[0].status, "PENDING", role);
    assert.equal(db.memberships.length, 0, role);
  }
});

test("somente leitura: registro por senha de convite de STAFF recusa (403) sem criar o usuário", async () => {
  const { repo, db } = makeRepo();
  const sent = await create(repo, { role: "STAFF" });
  db.clinicReadonly = true;
  const result = await inv.registerByInvite(repo, {
    token: sent.token, name: "Ana", password: "senha-forte-1", cpf: "52998224725", postalCode: "01310100", address: "Rua A, 1", country: "Brasil", state: "SP", city: "Sao Paulo",
    hashPassword: async () => "hash",
  }, later(1000));
  assert.deepEqual([result.ok, result.status, result.code], [false, 403, "PLAN_LIMIT"]);
  assert.deepEqual(result.plan, GENERIC);
  assert.equal(db.users.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
});

test("acesso completo volta a aceitar: o mesmo convite bloqueado é aceito depois que a clínica volta a ter escrita", async () => {
  const { repo, db } = makeRepo();
  const sent = await create(repo, { role: "STAFF" });
  db.clinicReadonly = true;
  const user = guest(db);
  assert.equal((await inv.acceptInvitation(repo, { token: sent.token, user }, later(1000))).ok, false);
  db.clinicReadonly = false;
  assert.equal((await inv.acceptInvitation(repo, { token: sent.token, user }, later(2000))).ok, true);
});
