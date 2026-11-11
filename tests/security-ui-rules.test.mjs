import assert from "node:assert/strict";
import { test } from "node:test";
import { SECURITY_EVENT_TYPES } from "../src/lib/security-events.ts";
import {
  SECURITY_EVENT_LABELS,
  emptyOtp,
  formatRecoveryInput,
  isLowOnRecoveryCodes,
  isRecoveryInputComplete,
  otpDigits,
  otpInsert,
  recoveryCodesFileText,
  securityEventLabel,
} from "../src/lib/security-ui-rules.ts";

test("otpInsert avança a cada dígito e apaga com vazio", () => {
  let state = otpInsert(emptyOtp(), 0, "1");
  assert.deepEqual(state, { cells: ["1", "", "", "", "", ""], focus: 1 });
  state = otpInsert(state.cells, 1, "2");
  assert.equal(state.focus, 2);
  state = otpInsert(state.cells, 1, "");
  assert.deepEqual(state.cells, ["1", "", "", "", "", ""]);
  assert.equal(state.focus, 1);
});

test("otpInsert aceita o código colado inteiro, com separadores, a partir de qualquer célula", () => {
  assert.deepEqual(otpInsert(emptyOtp(), 3, "123 456"), { cells: ["1", "2", "3", "4", "5", "6"], focus: 5 });
  assert.deepEqual(otpInsert(emptyOtp(), 0, "123-456789").cells, ["1", "2", "3", "4", "5", "6"]);
});

test("otpInsert ignora letras e mantém o dígito novo ao digitar sobre uma célula preenchida", () => {
  assert.deepEqual(otpInsert(emptyOtp(), 0, "ab"), { cells: emptyOtp(), focus: 0 });
  const filled = ["1", "", "", "", "", ""];
  assert.equal(otpInsert(filled, 0, "12").cells[0], "2");
  assert.equal(otpInsert(filled, 0, "21").cells[0], "2");
});

test("otpInsert no fim do campo mantém o foco na última célula", () => {
  assert.equal(otpInsert(["1", "2", "3", "4", "5", ""], 5, "6").focus, 5);
});

test("otpDigits limpa e limita", () => {
  assert.equal(otpDigits(" 12a3-456 78"), "123456");
});

test("formatRecoveryInput insere o hífen e normaliza", () => {
  assert.equal(formatRecoveryInput("ABCDE"), "abcde");
  assert.equal(formatRecoveryInput("ABCDEfghjk"), "abcde-fghjk");
  assert.equal(formatRecoveryInput("abcde-fghjk-extra"), "abcde-fghjk");
  assert.equal(isRecoveryInputComplete("abcde-fghjk"), true);
  assert.equal(isRecoveryInputComplete("abcde-fgh"), false);
});

test("todo tipo de evento do servidor tem rótulo em português", () => {
  for (const type of SECURITY_EVENT_TYPES) assert.ok(SECURITY_EVENT_LABELS[type], type);
  assert.equal(securityEventLabel("LOGIN"), "Login realizado");
  assert.equal(securityEventLabel("OUTRO"), "Evento de segurança");
  assert.equal(securityEventLabel("toString"), "Evento de segurança");
});

test("arquivo de códigos de recuperação lista os códigos e o aviso de uso único", () => {
  const text = recoveryCodesFileText(["aaaaa-bbbbb", "ccccc-ddddd"], new Date("2026-01-02T03:04:05Z"));
  assert.match(text, /aaaaa-bbbbb\nccccc-ddddd/);
  assert.match(text, /única vez/);
});

test("aviso de poucos códigos de recuperação", () => {
  assert.equal(isLowOnRecoveryCodes(3), true);
  assert.equal(isLowOnRecoveryCodes(4), false);
});

test("qrSvgDataUrl só aceita <svg> simples", async () => {
  const { qrSvgDataUrl } = await import("../src/lib/security-ui-rules.ts");
  assert.match(qrSvgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>'), /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.equal(qrSvgDataUrl('<svg><script>alert(1)</script></svg>'), null);
  assert.equal(qrSvgDataUrl('<svg onload="x()"></svg>'), null);
  assert.equal(qrSvgDataUrl('<div></div>'), null);
  assert.equal(qrSvgDataUrl(undefined), null);
});
