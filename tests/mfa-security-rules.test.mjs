import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptMfaSecret, encryptMfaSecret, hmacHex } from "../src/lib/mfa-crypto.ts";
import {
  RECOVERY_ALPHABET,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "../src/lib/recovery-codes.ts";
import {
  TRUSTED_DEVICE_TTL_MS,
  generateTrustedDeviceToken,
  hashTrustedDeviceToken,
  isTrustedDeviceValid,
  trustedDeviceExpiry,
} from "../src/lib/trusted-device-rules.ts";
import {
  MFA_LOCK_MS,
  isMfaLocked,
  isRecentAuth,
  isStepFresh,
  mfaRequiredForMemberships,
  nextFailureState,
} from "../src/lib/mfa-rules.ts";
import { deviceLabel, parseUserAgent } from "../src/lib/user-agent.ts";
import { isSameOrigin } from "../src/lib/same-origin.ts";
import { clampEventDetail, isSecurityEventType, maskIp } from "../src/lib/security-events.ts";

process.env.AUTH_SECRET = "s".repeat(40);
const req = (headers) => ({ headers: { get: (name) => headers[name.toLowerCase()] ?? null } });

test("mfa-crypto: ida e volta, formato versionado e adulteracao", () => {
  const enc = encryptMfaSecret("JBSWY3DPEHPK3PXP");
  assert.match(enc, /^v1:[\w-]+:[\w-]+:[\w-]+$/);
  assert.ok(!enc.includes("JBSWY3DP"));
  assert.notEqual(enc, encryptMfaSecret("JBSWY3DPEHPK3PXP"));
  assert.equal(decryptMfaSecret(enc), "JBSWY3DPEHPK3PXP");
  const parts = enc.split(":");
  parts[3] = Buffer.from("x".repeat(16)).toString("base64url");
  assert.throws(() => decryptMfaSecret(parts.join(":")), /invalido/);
  assert.throws(() => decryptMfaSecret("v2:a:b:c"), /invalido/);
  assert.throws(() => decryptMfaSecret(""), /invalido/);
});

test("mfa-crypto: outra AUTH_SECRET nao decifra; contextos geram HMACs distintos", () => {
  const enc = encryptMfaSecret("segredo");
  const h1 = hmacHex("mfa-recovery", "abc");
  const h2 = hmacHex("trusted-device", "abc");
  assert.notEqual(h1, h2);
  assert.equal(h1, hmacHex("mfa-recovery", "abc"));
  const original = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "z".repeat(40);
  try {
    assert.throws(() => decryptMfaSecret(enc), /invalido/);
    assert.notEqual(hmacHex("mfa-recovery", "abc"), h1);
  } finally {
    process.env.AUTH_SECRET = original;
  }
});

test("codigos de recuperacao: 10 unicos, formato e sem ambiguos", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.match(code, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
    assert.ok(!/[01oil]/.test(code));
    assert.equal(normalizeRecoveryCode(code), code);
  }
  assert.ok(!/[01oil]/.test(RECOVERY_ALPHABET));
});

test("codigos de recuperacao: normalizacao e hash", () => {
  assert.equal(normalizeRecoveryCode("  ABCDE fghjk "), "abcde-fghjk");
  assert.equal(normalizeRecoveryCode("ABCDEFGHJK"), "abcde-fghjk");
  assert.equal(normalizeRecoveryCode("abcde-fghj"), null);
  assert.equal(normalizeRecoveryCode("abcde-fghi0"), null);
  assert.equal(hashRecoveryCode("ABCDE-FGHJK"), hashRecoveryCode("abcdefghjk"));
  assert.match(hashRecoveryCode("abcde-fghjk"), /^[0-9a-f]{64}$/);
  assert.equal(hashRecoveryCode("curto"), null);
});

test("dispositivo confiavel: token, hash, TTL e validade", () => {
  const token = generateTrustedDeviceToken();
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.notEqual(token, generateTrustedDeviceToken());
  assert.match(hashTrustedDeviceToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashTrustedDeviceToken(token), token);

  const now = new Date("2026-01-01T00:00:00Z");
  const expiresAt = trustedDeviceExpiry(now);
  assert.equal(expiresAt.getTime() - now.getTime(), 30 * 24 * 60 * 60 * 1000);
  assert.equal(TRUSTED_DEVICE_TTL_MS, 30 * 24 * 60 * 60 * 1000);

  const device = { userId: "u1", revokedAt: null, expiresAt };
  assert.equal(isTrustedDeviceValid(device, "u1", now), true);
  assert.equal(isTrustedDeviceValid(device, "u2", now), false);
  assert.equal(isTrustedDeviceValid({ ...device, revokedAt: now }, "u1", now), false);
  assert.equal(isTrustedDeviceValid(device, "u1", new Date(expiresAt.getTime())), false);
  assert.equal(isTrustedDeviceValid(device, "u1", new Date(expiresAt.getTime() - 1)), true);
  assert.equal(isTrustedDeviceValid(null, "u1", now), false);
});

test("obrigatoriedade: proprietario ou ADMIN em qualquer clinica", () => {
  assert.equal(mfaRequiredForMemberships([]), false);
  assert.equal(mfaRequiredForMemberships([{ role: "PROFESSIONAL", isOwner: false }]), false);
  assert.equal(mfaRequiredForMemberships([{ role: "STAFF", isOwner: false }]), false);
  assert.equal(mfaRequiredForMemberships([{ role: "STAFF", isOwner: true }]), true);
  assert.equal(
    mfaRequiredForMemberships([
      { role: "STAFF", isOwner: false },
      { role: "ADMIN", isOwner: false },
    ]),
    true,
  );
});

test("lockout: 5 falhas bloqueiam por 15 min e o lock expirado reinicia", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  let state = { failedAttempts: 0, lockedUntil: null };
  for (let i = 1; i <= 4; i++) {
    state = nextFailureState(state, now);
    assert.equal(state.failedAttempts, i);
    assert.equal(state.lockedUntil, null);
  }
  state = nextFailureState(state, now);
  assert.equal(state.lockedUntil.getTime(), now.getTime() + MFA_LOCK_MS);
  assert.equal(MFA_LOCK_MS, 15 * 60 * 1000);
  assert.equal(isMfaLocked(state.lockedUntil, now), true);
  const later = new Date(now.getTime() + MFA_LOCK_MS);
  assert.equal(isMfaLocked(state.lockedUntil, later), false);
  const after = nextFailureState({ failedAttempts: 4, lockedUntil: state.lockedUntil }, later);
  assert.deepEqual(after, { failedAttempts: 1, lockedUntil: null });
  assert.equal(isMfaLocked(null, now), false);
});

test("replay: so passo maior que o ultimo usado", () => {
  assert.equal(isStepFresh(10, null), true);
  assert.equal(isStepFresh(10, undefined), true);
  assert.equal(isStepFresh(11, 10), true);
  assert.equal(isStepFresh(10, 10), false);
  assert.equal(isStepFresh(9, 10n), false);
  assert.equal(isStepFresh(11, 10n), true);
});

test("reautenticacao recente", () => {
  const now = new Date("2026-01-01T00:10:00Z");
  assert.equal(isRecentAuth(new Date("2026-01-01T00:05:00Z"), now), true);
  assert.equal(isRecentAuth(new Date("2026-01-01T00:00:00Z"), now), false);
});

test("user-agent: navegador e SO", () => {
  const chromeWin =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const edge = chromeWin + " Edg/120.0.0.0";
  const safariMac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  const firefoxLinux = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
  const chromeIos =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
  const chromeAndroid =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
  assert.deepEqual(parseUserAgent(chromeWin), { browser: "Chrome", os: "Windows" });
  assert.deepEqual(parseUserAgent(edge), { browser: "Edge", os: "Windows" });
  assert.deepEqual(parseUserAgent(safariMac), { browser: "Safari", os: "macOS" });
  assert.deepEqual(parseUserAgent(firefoxLinux), { browser: "Firefox", os: "Linux" });
  assert.deepEqual(parseUserAgent(chromeIos), { browser: "Chrome", os: "iOS" });
  assert.deepEqual(parseUserAgent(chromeAndroid), { browser: "Chrome", os: "Android" });
  assert.equal(deviceLabel(chromeWin), "Chrome em Windows");
  assert.equal(deviceLabel(null), "Navegador desconhecido em Sistema desconhecido");
});

test("isSameOrigin: Sec-Fetch-Site, Origin x Host e ausencia de cabecalhos", () => {
  assert.equal(isSameOrigin(req({ "sec-fetch-site": "same-origin" })), true);
  assert.equal(isSameOrigin(req({ "sec-fetch-site": "cross-site", origin: "https://a.com", host: "a.com" })), false);
  assert.equal(isSameOrigin(req({ "sec-fetch-site": "same-site" })), false);
  assert.equal(isSameOrigin(req({ "sec-fetch-site": "none" })), false);
  assert.equal(isSameOrigin(req({ origin: "https://app.com", host: "app.com" })), true);
  assert.equal(isSameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" })), true);
  assert.equal(isSameOrigin(req({ origin: "https://evil.com", host: "app.com" })), false);
  assert.equal(isSameOrigin(req({ origin: "https://app.com.evil.com", host: "app.com" })), false);
  assert.equal(isSameOrigin(req({ origin: "https://app.com", "x-forwarded-host": "app.com", host: "internal:3000" })), true);
  assert.equal(isSameOrigin(req({ origin: "lixo", host: "app.com" })), false);
  assert.equal(isSameOrigin(req({ host: "app.com" })), false);
  assert.equal(isSameOrigin(req({})), false);
});

test("eventos de seguranca: tipos, detail e mascara de IP", () => {
  assert.equal(isSecurityEventType("MFA_ENABLED"), true);
  assert.equal(isSecurityEventType("OUTRO"), false);
  assert.equal(clampEventDetail("x".repeat(500)).length, 200);
  assert.equal(clampEventDetail(""), null);
  assert.equal(maskIp("187.12.34.56"), "187.12.xxx.xxx");
  assert.equal(maskIp("::ffff:10.1.2.3"), "10.1.xxx.xxx");
  assert.equal(maskIp("2001:db8:85a3::8a2e"), "2001:db8:xxxx:xxxx");
  assert.equal(maskIp(null), "—");
  assert.equal(maskIp("lixo"), "—");
});

test("isGoogleOnlyAccount: so identidade criada junto com o User; vinculo posterior exige senha", async () => {
  const { isGoogleOnlyAccount } = await import("../src/lib/mfa-rules.ts");
  const created = new Date("2026-01-01T10:00:00Z");
  assert.equal(isGoogleOnlyAccount(created, new Date("2026-01-01T10:00:02Z")), true);
  assert.equal(isGoogleOnlyAccount(created, new Date("2026-02-01T10:00:00Z")), false);
  assert.equal(isGoogleOnlyAccount(created, null), false);
  assert.equal(isGoogleOnlyAccount(created, undefined), false);
});
