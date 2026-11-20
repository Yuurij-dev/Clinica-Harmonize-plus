import assert from "node:assert/strict";
import test from "node:test";
import { DEV_TEST_CODE, isDevTestEmail } from "../src/lib/dev-test-auth.ts";

test("isDevTestEmail: fail-closed — exige NODE_ENV development/test E a flag opt-in, nunca so 'nao ser production'", () => {
  const on = { NODE_ENV: "development", ENABLE_DEV_TEST_LOGIN: "1" };
  assert.equal(isDevTestEmail("ana@teste.com", on), true);
  assert.equal(isDevTestEmail("ANA@TESTE.COM", { NODE_ENV: "test", ENABLE_DEV_TEST_LOGIN: "1" }), true);
  assert.equal(isDevTestEmail("  ana@teste.com  ", on), true);
  // Sem a flag, mesmo em development, nao libera (fail-closed; nada liga isso por acidente).
  assert.equal(isDevTestEmail("ana@teste.com", { NODE_ENV: "development" }), false);
  assert.equal(isDevTestEmail("ana@teste.com", { NODE_ENV: "development", ENABLE_DEV_TEST_LOGIN: "true" }), false);
  // NODE_ENV fora da lista (staging mal configurado, ausente, "production") nunca libera, com ou sem a flag.
  assert.equal(isDevTestEmail("ana@teste.com", { ENABLE_DEV_TEST_LOGIN: "1" }), false);
  assert.equal(isDevTestEmail("ana@teste.com", { NODE_ENV: "staging", ENABLE_DEV_TEST_LOGIN: "1" }), false);
  assert.equal(isDevTestEmail("ana@teste.com", { NODE_ENV: "production", ENABLE_DEV_TEST_LOGIN: "1" }), false);
  assert.equal(isDevTestEmail("ana@teste.com.br", on), false);
  assert.equal(isDevTestEmail("ana@gmail.com", on), false);
  assert.equal(DEV_TEST_CODE, "000000");
});
