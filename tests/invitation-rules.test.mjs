import assert from "node:assert/strict";
import test from "node:test";

import * as rules from "../src/lib/invitation-rules.ts";

const now = new Date("2026-01-01T12:00:00.000Z");
const base = { status: "PENDING", email: "ana@clinica.com", expiresAt: new Date(now.getTime() + 1000) };
const accept = (over = {}, ctx = {}) =>
  rules.canAcceptInvitation({
    invitation: { ...base, ...over },
    accountEmail: "ana@clinica.com",
    emailVerified: true,
    now,
    ...ctx,
  });

test("token e aleatorio e tem 32 bytes em base64url", () => {
  const a = rules.generateInviteToken();
  const b = rules.generateInviteToken();
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, "base64url").length, rules.INVITE_TOKEN_BYTES);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("hash e deterministico, hex de 64 chars e diferente do token", () => {
  const t = rules.generateInviteToken();
  assert.equal(rules.hashInviteToken(t), rules.hashInviteToken(t));
  assert.match(rules.hashInviteToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(rules.hashInviteToken(t), t);
  assert.notEqual(rules.hashInviteToken(t), rules.hashInviteToken(`${t}x`));
});

test("normaliza e-mail com espacos e maiusculas", () => {
  assert.equal(rules.normalizeInviteEmail("  Ana@Clinica.COM \n"), "ana@clinica.com");
});

test("expiracao padrao de 7 dias e customizavel", () => {
  assert.equal(rules.inviteExpiryDate(now).getTime() - now.getTime(), 7 * 86400000);
  assert.equal(rules.inviteExpiryDate(now, 1).getTime() - now.getTime(), 86400000);
});

test("invitationState trata PENDING vencido como expirado, no limite inclusive", () => {
  assert.equal(rules.invitationState({ status: "PENDING", expiresAt: new Date(now.getTime() + 1) }, now), "pending");
  assert.equal(rules.invitationState({ status: "PENDING", expiresAt: now }, now), "expired");
  assert.equal(rules.invitationState({ status: "PENDING", expiresAt: new Date(now.getTime() - 1) }, now), "expired");
  assert.equal(rules.invitationState({ status: "ACCEPTED", expiresAt: now }, now), "accepted");
  assert.equal(rules.invitationState({ status: "CANCELLED", expiresAt: now }, now), "cancelled");
  assert.equal(rules.invitationState({ status: "EXPIRED", expiresAt: new Date(now.getTime() + 9e9) }, now), "expired");
});

test("canAcceptInvitation aceita convite valido, ignorando caixa/espacos do e-mail", () => {
  assert.deepEqual(accept(), { ok: true });
  assert.deepEqual(accept({}, { accountEmail: " ANA@clinica.com " }), { ok: true });
});

test("canAcceptInvitation devolve cada motivo de recusa", () => {
  assert.deepEqual(accept({ expiresAt: now }), { ok: false, reason: "expired" });
  assert.deepEqual(accept({ status: "EXPIRED" }), { ok: false, reason: "expired" });
  assert.deepEqual(accept({ status: "CANCELLED" }), { ok: false, reason: "cancelled" });
  assert.deepEqual(accept({ status: "ACCEPTED" }), { ok: false, reason: "accepted" });
  assert.deepEqual(accept({}, { accountEmail: "outra@x.com" }), { ok: false, reason: "email_mismatch" });
  assert.deepEqual(accept({}, { accountEmail: "" }), { ok: false, reason: "email_mismatch" });
  assert.deepEqual(accept({}, { emailVerified: false }), { ok: false, reason: "email_unverified" });
});

test("estado do convite tem precedencia sobre e-mail na recusa", () => {
  assert.deepEqual(accept({ status: "CANCELLED" }, { accountEmail: "outra@x.com", emailVerified: false }), {
    ok: false,
    reason: "cancelled",
  });
});

test("somente PROFESSIONAL e STAFF podem ser concedidos por convite", () => {
  assert.deepEqual([...rules.allowedInviteRoles()].sort(), ["PROFESSIONAL", "STAFF"]);
  assert.equal(rules.isAllowedInviteRole("STAFF"), true);
  assert.equal(rules.isAllowedInviteRole("PROFESSIONAL"), true);
  assert.equal(rules.isAllowedInviteRole("ADMIN"), false);
  assert.equal(rules.isAllowedInviteRole("OWNER"), false);
  assert.equal(rules.isAllowedInviteRole(undefined), false);
});

test("revisor: limite now-1ms, status desconhecido, e-mail do convite com caixa/espacos", () => {
  assert.equal(rules.invitationState({ status: "PENDING", expiresAt: new Date(now.getTime() - 1) }, now), "expired");
  // Status desconhecido nunca vira "pending" aceitavel: cai em expirado (falha segura).
  assert.equal(rules.invitationState({ status: "WHATEVER", expiresAt: new Date(now.getTime() + 9e9) }, now), "expired");
  assert.deepEqual(accept({ status: "WHATEVER" }), { ok: false, reason: "expired" });
  assert.deepEqual(accept({ email: "  ANA@Clinica.com " }), { ok: true });
});

test("revisor: isAllowedInviteRole e normalizeInviteEmail com entradas estranhas", () => {
  for (const v of ["admin", "", null, "ADMIN ", "staff"]) assert.equal(rules.isAllowedInviteRole(v), false);
  assert.equal(rules.normalizeInviteEmail(null), "");
  assert.equal(rules.normalizeInviteEmail(undefined), "");
});

test("revisor: ponto no Gmail nao e equivalente", () => {
  assert.notEqual(rules.normalizeInviteEmail("a.na@gmail.com"), rules.normalizeInviteEmail("ana@gmail.com"));
  assert.deepEqual(accept({ email: "ana@gmail.com" }, { accountEmail: "a.na@gmail.com" }), { ok: false, reason: "email_mismatch" });
});

test("isInviteTokenShape e isRoleDemotion", () => {
  assert.equal(rules.isInviteTokenShape(rules.generateInviteToken()), true);
  for (const v of ["", "curto", "a".repeat(44), "a".repeat(42) + " ", null, 5]) assert.equal(rules.isInviteTokenShape(v), false);
  assert.equal(rules.isRoleDemotion("ADMIN", "PROFESSIONAL"), true);
  assert.equal(rules.isRoleDemotion("ADMIN", "STAFF"), true);
  assert.equal(rules.isRoleDemotion("PROFESSIONAL", "STAFF"), true);
  assert.equal(rules.isRoleDemotion("STAFF", "PROFESSIONAL"), false);
  assert.equal(rules.isRoleDemotion("STAFF", "ADMIN"), false);
  assert.equal(rules.isRoleDemotion("STAFF", "STAFF"), false);
});
