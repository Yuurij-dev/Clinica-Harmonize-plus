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

test("isDevTestLoginEmail: fail-closed — exige NODE_ENV development/test E a flag opt-in, nunca so 'nao ser production'", () => {
  const on = { NODE_ENV: "development", ENABLE_DEV_TEST_LOGIN: "1" };
  assert.equal(r.isDevTestLoginEmail("ana@teste.com", on), true);
  assert.equal(r.isDevTestLoginEmail("ANA@TESTE.COM", { NODE_ENV: "test", ENABLE_DEV_TEST_LOGIN: "1" }), true);
  assert.equal(r.isDevTestLoginEmail("  ana@teste.com  ", on), true);
  // Sem a flag, mesmo em development, nao libera (fail-closed; nada liga isso por acidente).
  assert.equal(r.isDevTestLoginEmail("ana@teste.com", { NODE_ENV: "development" }), false);
  assert.equal(r.isDevTestLoginEmail("ana@teste.com", { NODE_ENV: "development", ENABLE_DEV_TEST_LOGIN: "true" }), false);
  // NODE_ENV fora da lista (staging mal configurado, ausente, "production") nunca libera, com ou sem a flag.
  assert.equal(r.isDevTestLoginEmail("ana@teste.com", { ENABLE_DEV_TEST_LOGIN: "1" }), false);
  assert.equal(r.isDevTestLoginEmail("ana@teste.com", { NODE_ENV: "staging", ENABLE_DEV_TEST_LOGIN: "1" }), false);
  assert.equal(r.isDevTestLoginEmail("ana@teste.com", { NODE_ENV: "production", ENABLE_DEV_TEST_LOGIN: "1" }), false);
  assert.equal(r.isDevTestLoginEmail("ana@teste.com.br", on), false);
  assert.equal(r.isDevTestLoginEmail("ana@gmail.com", on), false);
  assert.equal(r.DEV_TEST_LOGIN_CODE, "000000");
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
