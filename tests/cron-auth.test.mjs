import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCronAuth } from "../src/lib/cron-auth.ts";

test("cron: sem CRON_SECRET = unconfigured (503), mesmo com credencial", () => {
  assert.equal(checkCronAuth("Bearer x", undefined), "unconfigured");
  assert.equal(checkCronAuth("Bearer x", ""), "unconfigured");
  assert.equal(checkCronAuth("Bearer x", "   "), "unconfigured");
});

test("cron: sem credencial, esquema errado ou segredo errado = unauthorized (401)", () => {
  const secret = "s3cr3t-valor-longo-0123456789";
  assert.equal(checkCronAuth(null, secret), "unauthorized");
  assert.equal(checkCronAuth("", secret), "unauthorized");
  assert.equal(checkCronAuth(secret, secret), "unauthorized");
  assert.equal(checkCronAuth("Basic " + secret, secret), "unauthorized");
  assert.equal(checkCronAuth("Bearer outro", secret), "unauthorized");
  assert.equal(checkCronAuth("Bearer " + secret + "x", secret), "unauthorized");
  assert.equal(checkCronAuth("Bearer", secret), "unauthorized");
});

test("cron: Bearer correto = ok (esquema sem diferenciar caixa)", () => {
  const secret = "s3cr3t-valor-longo-0123456789";
  assert.equal(checkCronAuth(`Bearer ${secret}`, secret), "ok");
  assert.equal(checkCronAuth(`bearer ${secret}`, ` ${secret} `), "ok");
});
