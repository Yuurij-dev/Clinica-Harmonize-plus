import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpAtStep,
  verifyTotp,
  formatSecretForManualEntry,
} from "../src/lib/totp.ts";

const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

test("base32 segue o RFC 4648", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(base32Decode("MZXW6YTBOI").toString(), "foobar");
  assert.equal(base32Decode("mzxw 6ytb-oi===").toString(), "foobar");
  assert.throws(() => base32Decode("1!"));
});

test("vetores oficiais do RFC 6238 (SHA1)", () => {
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, code] of vectors) {
    assert.equal(totpAtStep(RFC_SECRET, Math.floor(seconds / 30), 8), code);
  }
  assert.equal(totpAtStep(RFC_SECRET, 1), "287082");
});

test("verifyTotp aceita a janela +-1 e devolve o passo", () => {
  const now = 59_000; // passo 1
  assert.equal(verifyTotp(RFC_SECRET, "287082", now), 1);
  assert.equal(verifyTotp(RFC_SECRET, "287 082", now), 1);
  // codigo do passo 1 aceito 30 s depois (passo 2) e 30 s antes de ser gerado.
  assert.equal(verifyTotp(RFC_SECRET, "287082", now + 30_000), 1);
  assert.equal(verifyTotp(RFC_SECRET, totpAtStep(RFC_SECRET, 2), now), 2);
  assert.equal(verifyTotp(RFC_SECRET, totpAtStep(RFC_SECRET, 0), now), 0);
});

test("verifyTotp rejeita codigo expirado, invalido e mal formado", () => {
  const now = 59_000;
  assert.equal(verifyTotp(RFC_SECRET, "287082", now + 60_000), null); // 2 passos depois
  assert.equal(verifyTotp(RFC_SECRET, "000000", now), null);
  assert.equal(verifyTotp(RFC_SECRET, "28708", now), null);
  assert.equal(verifyTotp(RFC_SECRET, "abcdef", now), null);
  assert.equal(verifyTotp(RFC_SECRET, "", now), null);
  assert.equal(verifyTotp("@@@", "287082", now), null);
});

test("segredo gerado tem 20 bytes e funciona", () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(secret).length, 20);
  assert.notEqual(secret, generateTotpSecret());
  const now = Date.now();
  const step = Math.floor(now / 30_000);
  assert.equal(verifyTotp(secret, totpAtStep(secret, step), now), step);
});

test("otpauth URI e chave manual", () => {
  const uri = otpauthUri("ABCDEFGH", "ana+x@clinica.com");
  assert.ok(uri.startsWith("otpauth://totp/Harmonize%2B:ana%2Bx%40clinica.com?"));
  const params = new URL(uri).searchParams;
  assert.equal(params.get("secret"), "ABCDEFGH");
  assert.equal(params.get("issuer"), "Harmonize+");
  assert.equal(params.get("digits"), "6");
  assert.equal(params.get("period"), "30");
  assert.equal(formatSecretForManualEntry("ABCDEFGHIJ"), "ABCD EFGH IJ");
});
