import assert from "node:assert/strict";
import test from "node:test";
import { OWN_CPF_MESSAGE, OWN_NAME_MESSAGE, OWN_PHONE_MESSAGE, OWN_POSTAL_CODE_MESSAGE, PASSWORD_CURRENT_REQUIRED_MESSAGE, PASSWORD_SAME_MESSAGE, PASSWORD_TOO_LONG_MESSAGE, isMaskedCpf, maskCpf, parseOwnProfile, validatePasswordChange } from "../src/lib/own-profile-rules.ts";
import { PASSWORD_RULE_MESSAGE } from "../src/lib/password-rules.ts";
import { AVATAR_MAX_UPLOAD_BYTES, checkAvatarContentLength, checkAvatarFile } from "../src/lib/avatar-upload-rules.ts";

test("maskCpf mostra só os 2 últimos dígitos e nunca o CPF completo", () => {
  assert.equal(maskCpf("52998224725"), "***.***.***-25");
  assert.equal(maskCpf("529.982.247-25"), "***.***.***-25");
  assert.equal(maskCpf(null), null);
  assert.equal(maskCpf(""), null);
  assert.ok(!maskCpf("52998224725").includes("5299"));
  assert.equal(isMaskedCpf("***.***.***-25"), true);
  assert.equal(isMaskedCpf("529.982.247-25"), false);
});

test("parseOwnProfile: campo ausente mantém; vazio limpa (exceto nome); normaliza", () => {
  assert.deepEqual(parseOwnProfile({}), { ok: true, value: {} });
  assert.deepEqual(parseOwnProfile({ name: " Ana Souza ", phone: "(11) 98888-7777", cpf: "529.982.247-25", postalCode: "01310-100", address: " Rua A ", country: "", state: "SP", city: "São Paulo" }), {
    ok: true,
    value: { name: "Ana Souza", phone: "11988887777", cpf: "52998224725", postalCode: "01310100", address: "Rua A", country: null, state: "SP", city: "São Paulo" },
  });
  assert.deepEqual(parseOwnProfile({ phone: "", postalCode: "", address: "" }).value, { phone: null, postalCode: null, address: null });
});

test("parseOwnProfile: nome obrigatório (não exige sobrenome) e até 100", () => {
  assert.deepEqual(parseOwnProfile({ name: "Ana" }).value, { name: "Ana" });
  assert.equal(parseOwnProfile({ name: "   " }).fields.name, OWN_NAME_MESSAGE);
  assert.equal(parseOwnProfile({ name: "a".repeat(101) }).fields.name, OWN_NAME_MESSAGE);
  assert.equal(parseOwnProfile({ name: 5 }).fields.name, OWN_NAME_MESSAGE);
});

test("parseOwnProfile: CPF vazio ou mascarado mantém o atual; informado precisa ser válido", () => {
  assert.equal("cpf" in parseOwnProfile({ cpf: "" }).value, false);
  assert.equal("cpf" in parseOwnProfile({ cpf: "***.***.***-25" }).value, false);
  assert.equal(parseOwnProfile({ cpf: "111.111.111-11" }).fields.cpf, OWN_CPF_MESSAGE);
  assert.equal(parseOwnProfile({ cpf: "123" }).fields.cpf, OWN_CPF_MESSAGE);
});

test("parseOwnProfile: telefone BR (10 ou 11 dígitos), CEP de 8 dígitos e limites de texto", () => {
  assert.equal(parseOwnProfile({ phone: "1234" }).fields.phone, OWN_PHONE_MESSAGE);
  assert.equal(parseOwnProfile({ phone: "(11) 3333-4444" }).value.phone, "1133334444");
  assert.equal(parseOwnProfile({ postalCode: "0131" }).fields.postalCode, OWN_POSTAL_CODE_MESSAGE);
  assert.equal(parseOwnProfile({ address: "a".repeat(201) }).ok, false);
  assert.equal(parseOwnProfile({ city: "a".repeat(101) }).ok, false);
  const many = parseOwnProfile({ name: "", phone: "1", cpf: "1" });
  assert.equal(many.ok, false);
  assert.deepEqual(Object.keys(many.fields).sort(), ["cpf", "name", "phone"]);
});

test("parseOwnProfile ignora e-mail, papel e clínica", () => {
  assert.deepEqual(parseOwnProfile({ email: "x@y.com", role: "ADMIN", clinicId: "c1", userId: "u2", name: "Ana" }), { ok: true, value: { name: "Ana" } });
});

test("validatePasswordChange: exige atual, nova forte, ≤72 bytes e diferente da atual", () => {
  assert.deepEqual(validatePasswordChange({ currentPassword: "", newPassword: "Abcdef1!" }), { ok: false, field: "currentPassword", message: PASSWORD_CURRENT_REQUIRED_MESSAGE });
  assert.deepEqual(validatePasswordChange({ currentPassword: "x", newPassword: "fraca" }), { ok: false, field: "newPassword", message: PASSWORD_RULE_MESSAGE });
  assert.deepEqual(validatePasswordChange({ currentPassword: "Abcdef1!", newPassword: "Abcdef1!" }), { ok: false, field: "newPassword", message: PASSWORD_SAME_MESSAGE });
  assert.deepEqual(validatePasswordChange({ currentPassword: "x", newPassword: `Aa1!${"b".repeat(69)}` }), { ok: false, field: "newPassword", message: PASSWORD_TOO_LONG_MESSAGE });
  // 72 bytes exatos passam; caracteres multibyte contam por byte.
  assert.equal(validatePasswordChange({ currentPassword: "x", newPassword: `Aa1!${"b".repeat(68)}` }).ok, true);
  assert.equal(validatePasswordChange({ currentPassword: "x", newPassword: `Aa1!${"é".repeat(35)}` }).message, PASSWORD_TOO_LONG_MESSAGE);
  assert.deepEqual(validatePasswordChange({ currentPassword: "Antiga1!", newPassword: "Nova#Senha9" }), { ok: true, currentPassword: "Antiga1!", newPassword: "Nova#Senha9" });
  assert.equal(validatePasswordChange(null).ok, false);
});

test("avatar: Content-Length obrigatório e limitado; arquivo só JPG/PNG/WebP até 5 MB", () => {
  assert.deepEqual(checkAvatarContentLength(null), { status: 411, message: "Requisição inválida." });
  assert.equal(checkAvatarContentLength("0")?.status, 411);
  assert.equal(checkAvatarContentLength("abc")?.status, 411);
  assert.equal(checkAvatarContentLength(String(AVATAR_MAX_UPLOAD_BYTES + 64 * 1024 + 1))?.status, 413);
  assert.equal(checkAvatarContentLength(String(1024)), null);
  assert.equal(checkAvatarFile(null)?.status, 400);
  assert.equal(checkAvatarFile({ type: "image/gif", size: 10 })?.status, 400);
  assert.equal(checkAvatarFile({ type: "image/png", size: AVATAR_MAX_UPLOAD_BYTES + 1 })?.status, 413);
  for (const type of ["image/jpeg", "image/png", "image/webp"]) assert.equal(checkAvatarFile({ type, size: AVATAR_MAX_UPLOAD_BYTES }), null);
});
