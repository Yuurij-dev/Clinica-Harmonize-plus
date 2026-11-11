import assert from "node:assert/strict";
import test from "node:test";
import { isStrongPassword, passwordChecks, passwordStrength, PASSWORD_RULE_LABELS } from "../src/lib/password-rules.ts";

test("passwordChecks avalia cada regra isoladamente", () => {
  assert.deepEqual(passwordChecks(""), { length: false, letters: false, number: false, special: false });
  assert.deepEqual(passwordChecks("abcdefgh"), { length: true, letters: false, number: false, special: false });
  assert.deepEqual(passwordChecks("Abcdefgh"), { length: true, letters: true, number: false, special: false });
  assert.deepEqual(passwordChecks("Ab1!"), { length: false, letters: true, number: true, special: true });
  assert.equal(passwordChecks("ABCDEFG1").letters, false);
  assert.equal(passwordChecks("abcdefg1").letters, false);
});

test("caractere especial e simbolo/pontuacao (espaco e acento nao contam)", () => {
  assert.equal(passwordChecks("Senhaa1ç").special, false);
  assert.equal(passwordChecks("Senha 123").special, false);
  assert.equal(passwordChecks("Senha1_").special, true);
  assert.equal(passwordChecks("Senha1@").special, true);
});

test("isStrongPassword exige as 4 regras", () => {
  assert.equal(isStrongPassword("Senha@123"), true);
  assert.equal(isStrongPassword("senha@123"), false);
  assert.equal(isStrongPassword("Senha@abc"), false);
  assert.equal(isStrongPassword("Senha123"), false);
  assert.equal(isStrongPassword("Se@1"), false);
});

test("passwordStrength: 0 vazio, 1-4 pelas regras cumpridas, com rotulo", () => {
  assert.deepEqual(passwordStrength(""), { score: 0, label: "fraca" });
  assert.deepEqual(passwordStrength("abcdefgh"), { score: 1, label: "fraca" });
  assert.deepEqual(passwordStrength("Abcdefgh"), { score: 2, label: "média" });
  assert.deepEqual(passwordStrength("Abcdefg1"), { score: 3, label: "boa" });
  assert.deepEqual(passwordStrength("Abcdef1!"), { score: 4, label: "forte" });
});

test("ha um rotulo para cada regra", () => {
  assert.deepEqual(PASSWORD_RULE_LABELS.map((rule) => rule.key), ["length", "letters", "number", "special"]);
});
