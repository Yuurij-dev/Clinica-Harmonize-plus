import assert from "node:assert/strict";
import test from "node:test";
import * as inv from "../src/lib/invitations.ts";
import { hashInviteToken } from "../src/lib/invitation-rules.ts";
import * as emailLib from "../src/lib/email.ts";

const T0 = new Date("2026-06-01T12:00:00.000Z");
const later = (ms) => new Date(T0.getTime() + ms);
const DAY = 86400000;

import { makeRepo } from "./helpers/fake-invitation-repo.mjs";

const addUser = (db, id, email) => db.users.push({ id, email, name: id });
const create = (repo, over = {}, now = T0) => inv.createInvitation(repo, { clinicId: "c1", invitedById: "admin", email: "Ana@X.com", role: "STAFF", deliveryReady: true, ...over }, now);

test("criar: normaliza e-mail, grava so o hash e devolve o token uma vez", async () => {
  const { repo, db } = makeRepo();
  const r = await create(repo, { email: "  Ana@X.COM " });
  assert.equal(r.ok, true);
  assert.equal(r.invitation.email, "ana@x.com");
  assert.equal(db.invitations[0].tokenHash, hashInviteToken(r.token));
  assert.notEqual(db.invitations[0].tokenHash, r.token);
  assert.equal(JSON.stringify(db.invitations).includes(r.token), false);
  assert.equal(db.invitations[0].invitedById, "admin");
  assert.equal(r.invitation.expiresAt.getTime() - T0.getTime(), 7 * DAY);
});

test("criar: papel invalido e e-mail invalido", async () => {
  const { repo } = makeRepo();
  for (const role of ["ADMIN", "admin", "", null, undefined]) assert.equal((await create(repo, { role })).code, "invalid_role");
  for (const email of ["", "x", "a@b", null]) assert.equal((await create(repo, { email })).code, "invalid_email");
});

test("criar: duplicado PENDING => 409; vencido vira EXPIRED e permite novo", async () => {
  const { repo, db } = makeRepo();
  assert.equal((await create(repo)).ok, true);
  const dup = await create(repo, { email: "ANA@x.com" }, later(1000));
  assert.deepEqual([dup.ok, dup.status, dup.code], [false, 409, "pending_exists"]);
  const again = await create(repo, {}, later(8 * DAY));
  assert.equal(again.ok, true);
  assert.deepEqual(db.invitations.map((i) => i.status), ["EXPIRED", "PENDING"]);
  // mesmo e-mail em outra clinica nao conflita
  assert.equal((await create(repo, { clinicId: "c2" })).ok, true);
});

test("criar: ja membro => 409; limite de 25 pendentes", async () => {
  const { repo, db } = makeRepo();
  addUser(db, "u1", "ana@x.com");
  db.memberships.push({ id: "m", userId: "u1", clinicId: "c1", role: "STAFF", isOwner: false });
  assert.equal((await create(repo)).code, "already_member");
  assert.equal((await create(repo, { clinicId: "c2" })).ok, true); // membro de outra clinica pode ser convidado
  for (let i = 0; i < 25; i++) assert.equal((await create(repo, { email: `p${i}@x.com` })).ok, true);
  const over = await create(repo, { email: "extra@x.com" });
  assert.deepEqual([over.ok, over.status, over.code], [false, 429, "pending_limit"]);
});

test("reenviar: gira o token (hash antigo deixa de funcionar) e conta envios", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const r = await inv.resendInvitation(repo, { clinicId: "c1", id: c.invitation.id, deliveryReady: true }, later(61_000));
  assert.equal(r.ok, true);
  assert.notEqual(r.token, c.token);
  assert.equal(await inv.previewInvitation(repo, c.token, later(61_000)), null);
  assert.equal((await inv.previewInvitation(repo, r.token, later(61_000))).status, "pending");
  assert.equal(db.invitations[0].sendCount, 2);
  assert.equal(r.invitation.expiresAt.getTime(), later(61_000 + 7 * DAY).getTime());
});

test("reenviar: intervalo de 60 s, limite de 5, status e escopo", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const id = c.invitation.id;
  assert.equal((await inv.resendInvitation(repo, { clinicId: "c1", id, deliveryReady: true }, later(30_000))).code, "too_soon");
  let t = 61_000;
  for (let n = 2; n <= 5; n++, t += 61_000) assert.equal((await inv.resendInvitation(repo, { clinicId: "c1", id, deliveryReady: true }, later(t))).ok, true);
  assert.equal((await inv.resendInvitation(repo, { clinicId: "c1", id, deliveryReady: true }, later(t))).code, "send_limit");
  // outra clinica nao enxerga o convite
  assert.equal((await inv.resendInvitation(repo, { clinicId: "c2", id, deliveryReady: true }, later(t))).code, "not_found");
  db.invitations[0].status = "ACCEPTED";
  assert.equal((await inv.resendInvitation(repo, { clinicId: "c1", id, deliveryReady: true }, later(t))).code, "not_resendable");
  db.invitations[0].status = "CANCELLED";
  assert.equal((await inv.resendInvitation(repo, { clinicId: "c1", id, deliveryReady: true }, later(t))).code, "not_resendable");
});

test("reenviar: convite vencido e renovado; membro ativo bloqueia", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const r = await inv.resendInvitation(repo, { clinicId: "c1", id: c.invitation.id, deliveryReady: true }, later(9 * DAY));
  assert.equal(r.ok, true);
  assert.equal(db.invitations[0].status, "PENDING");
  addUser(db, "u1", "ana@x.com");
  db.memberships.push({ id: "m", userId: "u1", clinicId: "c1", role: "STAFF", isOwner: false });
  assert.equal((await inv.resendInvitation(repo, { clinicId: "c1", id: c.invitation.id, deliveryReady: true }, later(20 * DAY))).code, "already_member");
});

test("cancelar: so PENDING e com escopo", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const id = c.invitation.id;
  assert.equal((await inv.cancelInvitation(repo, { clinicId: "c2", id })).code, "not_found");
  assert.equal(db.invitations[0].status, "PENDING");
  assert.equal((await inv.cancelInvitation(repo, { clinicId: "c1", id })).ok, true);
  assert.equal((await inv.cancelInvitation(repo, { clinicId: "c1", id })).code, "not_pending");
  assert.equal((await inv.cancelInvitation(repo, { clinicId: "c1", id: "nao-existe" })).code, "not_found");
});

test("listar: sem tokenHash, so da clinica, com status efetivo", async () => {
  const { repo } = makeRepo();
  await create(repo);
  await create(repo, { clinicId: "c2", email: "outra@x.com" });
  const list = await inv.listInvitations(repo, { clinicId: "c1" }, later(8 * DAY));
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "expired");
  assert.equal("tokenHash" in list[0], false);
  assert.equal(list[0].invitedBy, "Admin");
});

test("preview: inexistente, malformado e vazio sao identicos (null)", async () => {
  const { repo } = makeRepo();
  const c = await create(repo);
  assert.deepEqual(await inv.previewInvitation(repo, c.token, T0), { clinicName: "Clinica Um", role: "STAFF", email: "ana@x.com", status: "pending" });
  const nulls = [await inv.previewInvitation(repo, "x".repeat(43)), await inv.previewInvitation(repo, "curto"), await inv.previewInvitation(repo, null), await inv.previewInvitation(repo, undefined), await inv.previewInvitation(repo, "y".repeat(500))];
  for (const n of nulls) assert.equal(n, null);
});

const user = (id, email) => ({ id, email });

test("aceitar: valido cria membership com papel do convite e isOwner false", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo, { role: "PROFESSIONAL" });
  addUser(db, "u1", "ana@x.com");
  const r = await inv.acceptInvitation(repo, { token: c.token, user: user("u1", "ANA@x.com") }, later(1000));
  assert.deepEqual(r, { ok: true, alreadyInOtherClinic: false });
  assert.deepEqual(db.memberships, [{ id: db.memberships[0].id, userId: "u1", clinicId: "c1", role: "PROFESSIONAL", isOwner: false }]);
  assert.equal(db.invitations[0].status, "ACCEPTED");
  assert.equal(db.invitations[0].acceptedById, "u1");
});

test("aceitar: recusas (e-mail, vencido, cancelado, reuso, inexistente)", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const tok = c.token;
  assert.equal((await inv.acceptInvitation(repo, { token: tok, user: user("u1", "outra@x.com") }, later(1000))).code, "email_mismatch");
  assert.equal(db.memberships.length, 0);
  assert.equal((await inv.acceptInvitation(repo, { token: tok, user: user("u1", "ana@x.com") }, later(8 * DAY))).code, "expired");
  assert.equal((await inv.acceptInvitation(repo, { token: "z".repeat(43), user: user("u1", "ana@x.com") })).code, "not_found");
  assert.equal((await inv.acceptInvitation(repo, { token: undefined, user: user("u1", "ana@x.com") })).code, "not_found");
  assert.equal((await inv.acceptInvitation(repo, { token: tok, user: user("u1", "ana@x.com") }, later(1000))).ok, true);
  assert.equal((await inv.acceptInvitation(repo, { token: tok, user: user("u1", "ana@x.com") }, later(2000))).code, "accepted");
  const c2 = await create(repo, { email: "bia@x.com" });
  await inv.cancelInvitation(repo, { clinicId: "c1", id: c2.invitation.id });
  assert.equal((await inv.acceptInvitation(repo, { token: c2.token, user: user("u2", "bia@x.com") }, later(1000))).code, "cancelled");
  assert.equal(db.memberships.length, 1);
});

test("aceitar: duas chamadas simultaneas => so uma vence, uma membership", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const results = await Promise.all([
    inv.acceptInvitation(repo, { token: c.token, user: user("u1", "ana@x.com") }, later(1000)),
    inv.acceptInvitation(repo, { token: c.token, user: user("u1", "ana@x.com") }, later(1000)),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.find((r) => !r.ok).code, "accepted");
  assert.equal(db.memberships.length, 1);
});

test("aceitar: ja membro nao muda papel nem isOwner; outra clinica => alreadyInOtherClinic", async () => {
  const { repo, db } = makeRepo();
  db.memberships.push({ id: "m1", userId: "u1", clinicId: "c1", role: "ADMIN", isOwner: true });
  db.memberships.push({ id: "m2", userId: "u1", clinicId: "c2", role: "STAFF", isOwner: false });
  const c = await create(repo, { role: "STAFF" });
  const r = await inv.acceptInvitation(repo, { token: c.token, user: user("u1", "ana@x.com") }, later(1000));
  assert.deepEqual(r, { ok: true, alreadyInOtherClinic: true });
  assert.deepEqual(db.memberships.find((m) => m.id === "m1"), { id: "m1", userId: "u1", clinicId: "c1", role: "ADMIN", isOwner: true });
  assert.equal(db.memberships.filter((m) => m.clinicId === "c1").length, 1);

  const { repo: repo2, db: db2 } = makeRepo();
  db2.memberships.push({ id: "mx", userId: "u9", clinicId: "c2", role: "ADMIN", isOwner: true });
  const c2 = await create(repo2);
  const r2 = await inv.acceptInvitation(repo2, { token: c2.token, user: user("u9", "ana@x.com") }, later(1000));
  assert.deepEqual(r2, { ok: true, alreadyInOtherClinic: true });
  assert.equal(db2.memberships.find((m) => m.clinicId === "c1").isOwner, false);
});

test("aceitar: role ADMIN adulterado no banco => recusa sem membership", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  db.invitations[0].role = "ADMIN";
  assert.equal((await inv.acceptInvitation(repo, { token: c.token, user: user("u1", "ana@x.com") }, later(1000))).code, "invalid_role");
  assert.equal(db.memberships.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
});

const hashPassword = async (p) => `hash:${p}`;
const personal = { cpf: "529.982.247-25", postalCode: "01310-100", address: "Rua A, 1", country: "Brasil", state: "SP", city: "Sao Paulo" };

test("register por convite: cria conta com e-mail do convite, aceita e nao grava senha em claro", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo, { role: "PROFESSIONAL" });
  const r = await inv.registerByInvite(repo, { token: c.token, name: " Ana ", password: "senha-forte-1", ...personal, hashPassword }, later(1000));
  assert.equal(r.ok, true);
  assert.equal(db.users[0].email, "ana@x.com");
  assert.equal(db.users[0].name, "Ana");
  assert.equal(db.users[0].passwordHash, "hash:senha-forte-1");
  assert.deepEqual([db.memberships[0].clinicId, db.memberships[0].role, db.memberships[0].isOwner], ["c1", "PROFESSIONAL", false]);
  assert.equal(db.invitations[0].status, "ACCEPTED");
});

test("register por convite: grava os dados pessoais normalizados; sem eles => 400 e nada criado", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const run = (over = {}) => inv.registerByInvite(repo, { token: c.token, name: "Ana", password: "senha-forte-1", ...personal, hashPassword, ...over }, later(1000));
  for (const bad of [{ cpf: "123" }, { cpf: undefined }, { address: " " }, { country: "" }, { state: undefined }, { city: "" }, { postalCode: "123" }]) {
    const r = await run(bad);
    assert.deepEqual([r.ok, r.status, r.code], [false, 400, "invalid_input"], JSON.stringify(bad));
  }
  assert.equal(db.users.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
  assert.equal((await run({ postalCode: "" })).ok, true); // CEP opcional
  assert.deepEqual(
    [db.users[0].cpf, db.users[0].postalCode, db.users[0].address, db.users[0].country, db.users[0].state, db.users[0].city],
    ["52998224725", null, "Rua A, 1", "Brasil", "SP", "Sao Paulo"],
  );
});

test("google (conta nova): completeGoogleInvite valida e grava os dados pessoais na mesma transacao", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const row = db.invitations[0];
  const pending = { invite: c.token, invitationId: row.id, clinicId: "c1", sub: "sub-1", email: "ana@x.com" };
  const run = (profile, over = {}) => inv.completeGoogleInvite(repo, { pending: { ...pending, ...over }, profile: profile === null ? null : { name: "Ana", ...personal, ...profile }, makePasswordHash: async () => "unusable" }, later(1000));
  const invalid = await run({ cpf: "1" });
  assert.deepEqual([invalid.ok, invalid.code], [false, "invalid_profile"]);
  assert.equal((await run(null)).code, "invalid_profile");
  assert.equal(db.users.length, 0);
  assert.equal(db.identities.length, 0);
  // cookie de outro convite/clinica nao conclui este
  assert.equal((await run({}, { invitationId: "outro" })).code, "invite_invalid");
  assert.equal((await run({}, { clinicId: "c2" })).code, "invite_invalid");
  assert.equal((await run({}, { email: "outra@x.com" })).code, "invite_email_mismatch");
  assert.equal(db.users.length, 0);

  const ok = await run({});
  assert.equal(ok.ok, true);
  assert.equal(db.users[0].cpf, "52998224725");
  assert.equal(db.users[0].city, "Sao Paulo");
  assert.equal(db.users[0].passwordHash, "unusable");
  assert.deepEqual(db.identities.map((i) => [i.provider, i.sub]), [["google", "sub-1"]]);
  assert.equal(db.memberships.length, 1);
  assert.equal(row.status, "ACCEPTED");
  // uso unico: repetir nao cria nada
  assert.equal((await run({})).code, "invite_invalid");
  assert.equal(db.users.length, 1);
});

test("google (conta nova): convite vencido ou cancelado entre o callback e a conclusao => invite_invalid", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const pending = { invite: c.token, invitationId: db.invitations[0].id, clinicId: "c1", sub: "sub-1", email: "ana@x.com" };
  const profile = { name: "Ana", ...personal };
  assert.equal((await inv.completeGoogleInvite(repo, { pending, profile, makePasswordHash: async () => "x" }, later(8 * DAY))).code, "invite_invalid");
  await inv.cancelInvitation(repo, { clinicId: "c1", id: c.invitation.id });
  assert.equal((await inv.completeGoogleInvite(repo, { pending, profile, makePasswordHash: async () => "x" }, later(1000))).code, "invite_invalid");
  assert.equal(db.users.length, 0);
});

test("register por convite: conta existente => 409 sem anexar membership", async () => {
  const { repo, db } = makeRepo();
  addUser(db, "u1", "ana@x.com");
  const c = await create(repo);
  const r = await inv.registerByInvite(repo, { token: c.token, name: "Ana", password: "senha-forte-1", ...personal, hashPassword }, later(1000));
  assert.deepEqual([r.ok, r.status, r.code], [false, 409, "account_exists"]);
  assert.equal(db.memberships.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
});

test("register por convite: token invalido/vencido/cancelado => mesmo erro; entrada invalida => 400", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const run = (token, over = {}) => inv.registerByInvite(repo, { token, name: "Ana", password: "senha-forte-1", ...personal, hashPassword, ...over }, later(1000));
  const a = await run("q".repeat(43));
  const b = await inv.registerByInvite(repo, { token: c.token, name: "Ana", password: "senha-forte-1", ...personal, hashPassword }, later(8 * DAY));
  assert.deepEqual([a.status, a.code, a.message], [b.status, b.code, b.message]);
  await inv.cancelInvitation(repo, { clinicId: "c1", id: c.invitation.id });
  assert.equal((await run(c.token)).code, "invalid_token");
  assert.equal((await run(c.token, { password: "curta" })).status, 400);
  assert.equal((await run(c.token, { name: "  " })).status, 400);
  assert.equal(db.users.length, 0);
});

test("register por convite: falha no aceite desfaz a criacao do usuario; corrida P2002 => 409", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const orig = repo.markAccepted;
  // markAccepted perdendo a corrida (count 0) dentro da transacao
  const failing = { ...repo, transaction: (fn) => repo.transaction((tx) => fn({ ...tx, markAccepted: async () => 0 })) };
  const r = await inv.registerByInvite(failing, { token: c.token, name: "Ana", password: "senha-forte-1", ...personal, hashPassword }, later(1000));
  assert.equal(r.ok, false);
  assert.equal(db.users.length, 0);
  assert.equal(db.memberships.length, 0);
  void orig;
  // outra conta criada entre a checagem e o insert
  const racing = { ...repo, transaction: (fn) => repo.transaction((tx) => fn({ ...tx, findUserByEmail: async () => null, createUser: async () => { throw Object.assign(new Error("u"), { code: "P2002" }); } })) };
  const r2 = await inv.registerByInvite(racing, { token: c.token, name: "Ana", password: "senha-forte-1", ...personal, hashPassword }, later(1000));
  assert.deepEqual([r2.ok, r2.status], [false, 409]);
});

test("entrega: URL nunca volta em producao; so volta fora dela e sem provedor", async () => {
  const input = { token: "tok", email: "a@x.com", role: "STAFF", clinicName: "C", inviterName: "N" };
  const url = (t) => `https://app/convite/${t}`;
  const mk = (send, revealUrl) => ({ buildUrl: url, send: async () => send, revealUrl });
  const notConfigured = { sent: false, reason: "not_configured" };
  assert.deepEqual(await inv.deliverInvitation(mk({ sent: true }, true), input), { emailSent: true });
  assert.deepEqual(await inv.deliverInvitation(mk(notConfigured, true), input), { emailSent: false, emailFailureReason: "not_configured", inviteUrl: "https://app/convite/tok" });
  assert.deepEqual(await inv.deliverInvitation(mk(notConfigured, false), input), { emailSent: false, emailFailureReason: "not_configured" });
  assert.deepEqual(await inv.deliverInvitation(mk({ sent: false, reason: "provider_error" }, true), input), { emailSent: false, emailFailureReason: "provider_error" });
  assert.deepEqual(await inv.deliverInvitation({ buildUrl: () => null, revealUrl: true, send: async () => notConfigured }, input), { emailSent: false, emailFailureReason: "not_configured" });
  assert.equal(emailLib.canRevealInviteUrl({ NODE_ENV: "production" }), false);
  assert.equal(emailLib.canRevealInviteUrl({ NODE_ENV: "development" }), true);
});

test("producao sem provedor/site => 503 e nenhum convite criado nem envio consumido", async () => {
  const prodEnv = { NODE_ENV: "production" };
  assert.equal(emailLib.isInviteDeliveryReady(prodEnv), false);
  assert.equal(emailLib.isInviteDeliveryReady({ ...prodEnv, RESEND_API_KEY: "k", EMAIL_FROM: "f" }), false); // sem site
  assert.equal(emailLib.isInviteDeliveryReady({ ...prodEnv, RESEND_API_KEY: "k", EMAIL_FROM: "f", NEXT_PUBLIC_SITE_URL: "https://a" }), true);
  assert.equal(emailLib.isInviteDeliveryReady({ NODE_ENV: "development" }), true); // dev sem provedor segue (devolve a URL)
  const { repo, db } = makeRepo();
  const blocked = await create(repo, { deliveryReady: emailLib.isInviteDeliveryReady(prodEnv) });
  assert.deepEqual([blocked.ok, blocked.status, blocked.message], [false, 503, "O envio de e-mails ainda não está configurado."]);
  assert.equal(db.invitations.length, 0);
  const c = await create(repo);
  const before = db.invitations[0].sendCount;
  const r = await inv.resendInvitation(repo, { clinicId: "c1", id: c.invitation.id, deliveryReady: false }, later(61_000));
  assert.equal(r.status, 503);
  assert.equal(db.invitations[0].sendCount, before);
  assert.equal(db.invitations[0].tokenHash, hashInviteToken(c.token)); // token nao girou
});

test("aceite com token rotado (reenvio concorrente) falha e nao cria membership", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  const row = await repo.findByTokenHash(hashInviteToken(c.token));
  await inv.resendInvitation(repo, { clinicId: "c1", id: c.invitation.id, deliveryReady: true }, later(61_000));
  // aceite que ja tinha lido o hash antigo
  assert.equal(await repo.markAccepted({ id: row.id, clinicId: "c1", tokenHash: row.tokenHash, userId: "u1", now: later(62_000) }), 0);
  assert.equal(db.invitations[0].status, "PENDING");
  assert.equal(db.memberships.length, 0);
});

test("teto de 40 envios em 24 h: criar+cancelar em ciclo e barrado; janela anda", async () => {
  const { repo } = makeRepo();
  for (let n = 0; n < 40; n++) {
    const c = await create(repo, { email: `c${n}@x.com` }, later(n * 1000));
    assert.equal(c.ok, true, `criacao ${n}`);
    await inv.cancelInvitation(repo, { clinicId: "c1", id: c.invitation.id });
  }
  const blocked = await create(repo, { email: "novo@x.com" }, later(60_000));
  assert.deepEqual([blocked.ok, blocked.status, blocked.message], [false, 429, "Limite de convites enviados nas últimas 24 horas atingido."]);
  assert.equal((await create(repo, { clinicId: "c2", email: "novo@x.com" }, later(60_000))).ok, true); // outra clinica
  assert.equal((await create(repo, { email: "novo@x.com" }, later(DAY + 60_000))).ok, true); // fora da janela
});

test("reenvio de convite vencido reaplica o teto de 25 pendentes", async () => {
  const { repo } = makeRepo();
  const old = await create(repo, { email: "velho@x.com" });
  for (let i = 0; i < 25; i++) assert.equal((await create(repo, { email: `p${i}@x.com` }, later(8 * DAY))).ok, true);
  const r = await inv.resendInvitation(repo, { clinicId: "c1", id: old.invitation.id, deliveryReady: true }, later(8 * DAY + 61_000));
  assert.deepEqual([r.ok, r.status, r.code], [false, 429, "pending_limit"]);
});

test("e-mail do convite: rejeita injecao de cabecalho/lista/aspas/espacos", async () => {
  const { repo, db } = makeRepo();
  for (const email of ["evil<a@x.com>", "a@b.com,c@d.com", '"a"@b.com', "a b@x.com", "a@x.com;b@y.com", "a@@x.com", "a(b)@x.com", "a\\b@x.com", "a\u0008b@x.com", "a\nb@x.com", "a[b]@x.com"]) {
    assert.equal((await create(repo, { email })).code, "invalid_email", email);
  }
  assert.equal(db.invitations.length, 0);
  assert.equal((await create(repo, { email: "ana.silva+tag@sub.dominio.com.br" })).ok, true);
});

test("aceitar: autor sem settings:team (cargo/matriz) => not_found; ADMIN com matriz {} vale", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  db.staff[0].rolePermissions = {};
  assert.equal(await inv.inviterCanInvite(repo, db.invitations[0]), true);
  db.staff[0].role = "STAFF";
  assert.equal((await inv.acceptInvitation(repo, { token: c.token, user: user("u1", "ana@x.com") }, later(1000))).code, "not_found");
  assert.equal(db.memberships.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
  db.staff[0].role = "PROFESSIONAL";
  db.staff[0].rolePermissions = { PROFESSIONAL: { "settings:team": true } };
  assert.equal((await inv.acceptInvitation(repo, { token: c.token, user: user("u1", "ana@x.com") }, later(1000))).ok, true);
});

test("aceitar: autor que saiu da clinica (ou convite sem autor) => not_found, convite segue PENDING", async () => {
  const { repo, db } = makeRepo();
  const c = await create(repo);
  db.staff.length = 0;
  assert.equal((await inv.acceptInvitation(repo, { token: c.token, user: user("u1", "ana@x.com") }, later(1000))).code, "not_found");
  assert.equal(db.memberships.length, 0);
  assert.equal(db.invitations[0].status, "PENDING");
  db.staff.push({ userId: "admin", clinicId: "c1" });
  db.invitations[0].invitedById = null;
  assert.equal((await inv.acceptInvitation(repo, { token: c.token, user: user("u1", "ana@x.com") }, later(1000))).code, "not_found");
  // register por convite tambem recusa e nao cria o usuario
  const r = await inv.registerByInvite(repo, { token: c.token, name: "Ana", password: "senha-forte-1", ...personal, hashPassword: async (p) => p }, later(1000));
  assert.equal(r.ok, false);
  assert.equal(db.users.length, 0);
});

test("fake respeita @@unique([userId, provider]) de UserIdentity", async () => {
  const { repo } = makeRepo();
  await repo.createIdentity({ userId: "u1", provider: "google", sub: "s1", email: "a@x.com", now: T0 });
  await assert.rejects(repo.createIdentity({ userId: "u1", provider: "google", sub: "s2", email: "a@x.com", now: T0 }), (e) => e.code === "P2002");
  await assert.rejects(repo.createIdentity({ userId: "u2", provider: "google", sub: "s1", email: "b@x.com", now: T0 }), (e) => e.code === "P2002");
  await repo.createIdentity({ userId: "u1", provider: "outro", sub: "s1", email: "a@x.com", now: T0 });
});

test("entrega: o motivo estavel da falha acompanha emailSent:false na criacao e no reenvio (e so ele)", async () => {
  const { repo } = makeRepo();
  const send = async () => ({ sent: false, reason: "unverified_domain_or_test_recipient" });
  const deps = { buildUrl: (t) => `https://app/convite/${t}`, revealUrl: false, send };
  const c = await create(repo);
  const d1 = await inv.deliverInvitation(deps, { token: c.token, email: c.invitation.email, role: "STAFF", clinicName: "C", inviterName: "N" });
  assert.deepEqual(d1, { emailSent: false, emailFailureReason: "unverified_domain_or_test_recipient" });
  const r = await inv.resendInvitation(repo, { clinicId: "c1", id: c.invitation.id, deliveryReady: true }, later(61_000));
  const d2 = await inv.deliverInvitation(deps, { token: r.token, email: r.email, role: r.role, clinicName: "C", inviterName: "N" });
  assert.deepEqual(d2, { emailSent: false, emailFailureReason: "unverified_domain_or_test_recipient" });
  assert.equal(JSON.stringify([d1, d2]).includes(c.token), false); // sem URL nem token quando o provedor esta configurado
});
