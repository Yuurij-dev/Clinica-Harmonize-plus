import assert from "node:assert/strict";
import { test } from "node:test";
import { getAuthSecret } from "../src/lib/auth-secret.ts";

test("session secret must be configured with at least 32 bytes", () => {
  const original = process.env.AUTH_SECRET;
  try {
    delete process.env.AUTH_SECRET;
    assert.throws(() => getAuthSecret(), /AUTH_SECRET/);
    process.env.AUTH_SECRET = "too-short";
    assert.throws(() => getAuthSecret(), /AUTH_SECRET/);
    process.env.AUTH_SECRET = "a".repeat(32);
    assert.equal(getAuthSecret().length, 32);
  } finally {
    if (original === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = original;
  }
});
