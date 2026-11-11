import assert from "node:assert/strict";
import test from "node:test";
import * as r from "../src/lib/signup-verification-rules.ts";

const secret = new TextEncoder().encode("x".repeat(32));

test("generateCode: 6 digitos, com zeros a esquerda possiveis", () => {
  for (let i = 0; i < 200; i++) assert.match(r.generateCode(), /^\d{6}$/);
});

test("normalizeCode: so digitos, aceita colar com espacos, corta em 6", () => {
  assert.equal(r.normalizeCode("123 456"), "123456");
  assert.equal(r.normalizeCode("12-34-56-78"), "123456");
  assert.equal(r.normalizeCode(undefined), "");
  assert.equal(r.normalizeCode(123456), "");
  assert.equal(r.isValidCodeFormat("12345"), false);
  assert.equal(r.isValidCodeFormat("123456"), true);
});

test("hashCode/codeMatches: certo passa, errado/outro e-mail/formato invalido falham", () => {
  const h = r.hashCode("123456", "A@x.com", secret);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(r.codeMatches("123456", "a@x.com", h, secret), true);
  assert.equal(r.codeMatches("654321", "a@x.com", h, secret), false);
  assert.equal(r.codeMatches("123456", "b@x.com", h, secret), false);
  assert.equal(r.codeMatches("123456", "a@x.com", h, new TextEncoder().encode("y".repeat(32))), false);
  assert.equal(r.codeMatches("abc", "a@x.com", h, secret), false);
  assert.equal(r.codeMatches("123456", "a@x.com", "zz", secret), false);
});

test("expiracao: 10 minutos", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const exp = r.expiresAtFrom(now);
  assert.equal(exp.getTime() - now.getTime(), 10 * 60 * 1000);
  assert.equal(r.isExpired(exp, new Date(exp.getTime() - 1)), false);
  assert.equal(r.isExpired(exp, exp), true);
});

test("tentativas: maximo 5", () => {
  assert.equal(r.attemptsLeft(1), 4);
  assert.equal(r.attemptsLeft(9), 0);
  assert.equal(r.isLockedOut(4), false);
  assert.equal(r.isLockedOut(5), true);
});

test("cooldown de reenvio: 60 s e limite de envios", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  assert.equal(r.cooldownRemainingSeconds(new Date(now.getTime() - 10_000), now), 50);
  assert.equal(r.cooldownRemainingSeconds(new Date(now.getTime() - 60_000), now), 0);
  assert.equal(r.cooldownRemainingSeconds(new Date(now.getTime() - 90_000), now), 0);
  assert.equal(r.canSendAgain(r.MAX_SENDS - 1), true);
  assert.equal(r.canSendAgain(r.MAX_SENDS), false);
});

test("signupDeliveryMode: com provedor verifica; sem provedor direto fora de producao e indisponivel em producao", () => {
  assert.equal(r.signupDeliveryMode({ NODE_ENV: "production" }, true), "verify");
  assert.equal(r.signupDeliveryMode({ NODE_ENV: "development" }, true), "verify");
  assert.equal(r.signupDeliveryMode({ NODE_ENV: "development" }, false), "direct");
  assert.equal(r.signupDeliveryMode({}, false), "direct");
  assert.equal(r.signupDeliveryMode({ NODE_ENV: "test" }, false), "direct");
  assert.equal(r.signupDeliveryMode({ NODE_ENV: "production" }, false), "unavailable");
});

test("isPlausibleEmail", () => {
  assert.equal(r.isPlausibleEmail("a@b.co"), true);
  assert.equal(r.isPlausibleEmail("a@b"), false);
  assert.equal(r.isPlausibleEmail("a b@c.com"), false);
});

const T0 = new Date("2026-01-01T10:00:00Z");
const at = (ms) => new Date(T0.getTime() + ms);
const MIN = 60 * 1000;
const pend = (over = {}) => ({ expiresAt: at(10 * MIN), lastSentAt: T0, sends: 1, windowStartedAt: T0, lockedUntil: null, attempts: 0, totalAttempts: 0, ...over });

test("limites da janela de 24 h", () => {
  assert.equal(r.WINDOW_MS, 24 * 60 * MIN);
  assert.equal(r.MAX_SENDS, 6);
  assert.equal(r.MAX_TOTAL_ATTEMPTS, 15);
  assert.equal(r.MAX_ATTEMPTS, 5);
  assert.equal(r.isWindowExpired(T0, at(24 * 60 * MIN - 1)), false);
  assert.equal(r.isWindowExpired(T0, at(24 * 60 * MIN)), true);
  assert.equal(r.windowEndsAt(T0).getTime(), T0.getTime() + r.WINDOW_MS);
  assert.equal(r.windowCutoff(at(r.WINDOW_MS)).getTime(), T0.getTime());
});

test("isLocked: so enquanto lockedUntil esta no futuro", () => {
  assert.equal(r.isLocked(null, T0), false);
  assert.equal(r.isLocked(at(1), T0), true);
  assert.equal(r.isLocked(T0, T0), false);
});

test("registerDecision: create / reject / overwrite / restart", () => {
  assert.equal(r.registerDecision(null, T0), "create");
  // codigo ainda valido: nunca sobrescreve (o dono pode estar com ele)
  assert.equal(r.registerDecision(pend(), at(5 * MIN)), "reject");
  // codigo expirado, fora do cooldown, janela ativa: sobrescreve
  assert.equal(r.registerDecision(pend(), at(11 * MIN)), "overwrite");
  // cooldown mesmo com codigo invalidado
  assert.equal(r.registerDecision(pend({ expiresAt: r.INVALIDATED_AT }), at(30_000)), "reject");
  // limite de envios
  assert.equal(r.registerDecision(pend({ sends: 6 }), at(11 * MIN)), "reject");
  assert.equal(r.registerDecision(pend({ sends: 5 }), at(11 * MIN)), "overwrite");
  // bloqueado
  assert.equal(r.registerDecision(pend({ lockedUntil: at(60 * MIN) }), at(11 * MIN)), "reject");
  // janela vencida: recomeca, mesmo bloqueado/no limite
  assert.equal(r.registerDecision(pend({ sends: 6, lockedUntil: at(60 * MIN) }), at(25 * 60 * MIN)), "restart");
});

test("canSendCode (reenvio): cooldown, limite, bloqueio e janela; nao depende da validade do codigo", () => {
  assert.equal(r.canSendCode(pend(), at(30_000)), false);
  assert.equal(r.canSendCode(pend(), at(61_000)), true);
  assert.equal(r.canSendCode(pend({ sends: 6 }), at(61_000)), false);
  assert.equal(r.canSendCode(pend({ lockedUntil: at(10 * 60 * MIN) }), at(61_000)), false);
  assert.equal(r.canSendCode(pend(), at(25 * 60 * MIN)), false);
});

test("canGuess: 5 por codigo, 15 por janela, bloqueio, expiracao e janela", () => {
  assert.equal(r.canGuess(pend(), at(MIN)), true);
  assert.equal(r.canGuess(pend({ attempts: 4 }), at(MIN)), true);
  assert.equal(r.canGuess(pend({ attempts: 5 }), at(MIN)), false);
  assert.equal(r.canGuess(pend({ totalAttempts: 14 }), at(MIN)), true);
  assert.equal(r.canGuess(pend({ totalAttempts: 15 }), at(MIN)), false);
  assert.equal(r.canGuess(pend({ lockedUntil: at(MIN * 100) }), at(MIN)), false);
  assert.equal(r.canGuess(pend({ expiresAt: r.INVALIDATED_AT }), at(MIN)), false);
  assert.equal(r.canGuess(pend(), at(11 * MIN)), false);
  assert.equal(r.canGuess(pend({ expiresAt: at(30 * 60 * MIN) }), at(25 * 60 * MIN)), false);
});

test("senha: limite de 72 bytes UTF-8 (bcrypt)", () => {
  assert.equal(r.passwordWithinBcryptLimit("a".repeat(72)), true);
  assert.equal(r.passwordWithinBcryptLimit("a".repeat(73)), false);
  assert.equal(r.passwordWithinBcryptLimit("é".repeat(36)), true);
  assert.equal(r.passwordWithinBcryptLimit("é".repeat(37)), false);
  assert.equal(r.MAX_BODY_BYTES, 10 * 1024);
});
