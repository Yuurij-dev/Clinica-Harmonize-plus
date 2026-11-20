import assert from "node:assert/strict";
import test from "node:test";
import * as r from "../src/lib/login-code-rules.ts";

const secret = new TextEncoder().encode("x".repeat(32));

test("hashLoginCode/loginCodeMatches: certo passa, errado/outro usuario/formato invalido falham", () => {
  const h = r.hashLoginCode("123456", "user-1", secret);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(r.loginCodeMatches("123456", "user-1", h, secret), true);
  assert.equal(r.loginCodeMatches("654321", "user-1", h, secret), false);
  assert.equal(r.loginCodeMatches("123456", "user-2", h, secret), false);
  assert.equal(r.loginCodeMatches("123456", "user-1", h, new TextEncoder().encode("y".repeat(32))), false);
  assert.equal(r.loginCodeMatches("abc", "user-1", h, secret), false);
  assert.equal(r.loginCodeMatches("123456", "user-1", "zz", secret), false);
});

test("hashLoginCode: rotulo distinto do hash de cadastro (mesmo codigo e segredo geram hashes diferentes)", async () => {
  const { hashCode } = await import("../src/lib/signup-verification-rules.ts");
  const loginHash = r.hashLoginCode("123456", "user-1", secret);
  const signupHash = hashCode("123456", "user-1", secret);
  assert.notEqual(loginHash, signupHash);
});

test("reexporta as mesmas constantes/regras genericas do cadastro", () => {
  assert.equal(r.CODE_LENGTH, 6);
  assert.equal(r.CODE_TTL_MS, 10 * 60 * 1000);
  assert.equal(r.MAX_ATTEMPTS, 5);
  assert.equal(r.MAX_SENDS, 6);
  assert.equal(r.MAX_TOTAL_ATTEMPTS, 15);
  assert.equal(r.WINDOW_MS, 24 * 60 * 60 * 1000);
  assert.match(r.generateCode(), /^\d{6}$/);
  assert.equal(r.normalizeCode("12 34 56"), "123456");
  assert.equal(r.isValidCodeFormat("123456"), true);
});
