import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyMfaCode } from "../src/lib/mfa-input.ts";

test("seis digitos (com espaco ou hifen) = TOTP", () => {
  assert.deepEqual(classifyMfaCode("123456"), { code: "123456" });
  assert.deepEqual(classifyMfaCode(" 123 456 "), { code: "123 456" });
});

test("outro formato = codigo de recuperacao", () => {
  assert.deepEqual(classifyMfaCode("abcde-fghjk"), { recoveryCode: "abcde-fghjk" });
});

test("vazio ou nao-string = nada", () => {
  assert.deepEqual(classifyMfaCode(""), {});
  assert.deepEqual(classifyMfaCode(undefined), {});
  assert.deepEqual(classifyMfaCode(123456), {});
});
