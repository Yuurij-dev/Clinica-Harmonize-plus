import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPatientUpdate, formValuesFromRecord } from "../src/lib/patient-update-rules.ts";

const existing = {
  name: "Maria Silva", cpf: "529.982.247-25", phone: "(11) 91234-5678", age: 30, birthDate: "1996-05-10T00:00:00.000Z", email: null,
  socialName: null, sex: "Feminino", profession: null, referralSource: null, postalCode: null, address: null, addressNumber: null, addressComplement: null,
  neighborhood: null, city: null, state: null, emergencyContactName: null, emergencyContactPhone: null, emergencyContactRelationship: null,
  legalGuardianName: null, legalGuardianCpf: null, legalGuardianPhone: null, legalGuardianRelationship: null,
  careType: "Particular", insuranceProvider: null, insuranceCardNumber: null, privacyConsentAt: "2026-11-03T12:00:00.000Z", whatsappReminders: false,
};
const full = { fullCpf: true };

test("formValuesFromRecord converte data, CEP e telefone para o formato do formulário", () => {
  const values = formValuesFromRecord({ ...existing, postalCode: "01310100", emergencyContactPhone: "11987654321" });
  assert.equal(values.birthDate, "10/05/1996");
  assert.equal(values.postalCode, "01310-100");
  assert.equal(values.emergencyContactPhone, "(11) 98765-4321");
  assert.equal(values.privacyConsent, true);
});

test("corpo legado (name, cpf, phone, age, sex) continua valendo", () => {
  const result = buildPatientUpdate({ name: "Maria Souza", cpf: "529.982.247-25", phone: "(11) 98888-7777", age: 31, sex: "Feminino" }, { ...existing, birthDate: null }, full);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { name: "Maria Souza", cpf: "529.982.247-25", phone: "(11) 98888-7777", age: 31, sex: "Feminino" });
});

test("campos ausentes não são alterados; sexo vazio limpa", () => {
  assert.deepEqual(buildPatientUpdate({}, existing, full).data, {});
  assert.deepEqual(buildPatientUpdate({ sex: "" }, existing, full).data, { sex: null });
  assert.equal(buildPatientUpdate({ sex: "X" }, existing, full).ok, false);
});

test("idade legada inválida e telefone vazio são recusados", () => {
  assert.equal(buildPatientUpdate({ age: 200 }, { ...existing, birthDate: null }, full).ok, false);
  assert.equal(buildPatientUpdate({ phone: "" }, existing, full).ok, false);
});

test("data de nascimento deriva a idade e valida futuro/formato", () => {
  const ok = buildPatientUpdate({ birthDate: "10/05/1996" }, existing, full);
  assert.equal(ok.ok, true);
  assert.equal(typeof ok.data.age, "number");
  assert.equal(ok.data.birthDate.toISOString(), "1996-05-10T12:00:00.000Z");
  assert.equal(buildPatientUpdate({ birthDate: "10/05/2999" }, existing, full).ok, false);
  assert.equal(buildPatientUpdate({ birthDate: "31/02/1990" }, existing, full).ok, false);
  assert.equal(buildPatientUpdate({ birthDate: "" }, existing, full).ok, false);
});

test("CPF mascarado ou ausente mantém; vazio limpa só para quem vê o CPF inteiro", () => {
  assert.equal("cpf" in buildPatientUpdate({ name: "Maria Souza", cpf: "***.***.***-25" }, existing, full).data, false);
  assert.equal("cpf" in buildPatientUpdate({ cpf: "" }, existing, { fullCpf: false }).data, false);
  assert.equal(buildPatientUpdate({ cpf: "" }, existing, full).data.cpf, null);
  assert.equal(buildPatientUpdate({ cpf: "111.111.111-11" }, existing, full).ok, false);
});

test("e-mail, UF, CEP e tamanhos são validados e normalizados", () => {
  const ok = buildPatientUpdate({ email: " Maria@Email.com ", state: "sp", postalCode: "01310-100", city: "  ", address: "Rua A" }, existing, full);
  assert.deepEqual(ok.data, { email: "maria@email.com", state: "SP", postalCode: "01310100", city: null, address: "Rua A" });
  assert.equal(buildPatientUpdate({ email: "invalido" }, existing, full).fields.email.length > 0, true);
  assert.equal(buildPatientUpdate({ postalCode: "123" }, existing, full).ok, false);
  assert.equal(buildPatientUpdate({ profession: "x".repeat(201) }, existing, full).ok, false);
  assert.equal(buildPatientUpdate({ referralSource: "Inventado" }, existing, full).ok, false);
});

test("menor exige responsável e maior de idade apaga os dados dele", () => {
  const year = new Date().getFullYear() - 10;
  const minor = buildPatientUpdate({ birthDate: `01/01/${year}` }, existing, full);
  assert.equal(minor.ok, false);
  assert.ok(minor.fields.legalGuardianName);
  const good = buildPatientUpdate({ birthDate: `01/01/${year}`, legalGuardianName: "Ana Silva", legalGuardianCpf: "390.533.447-05", legalGuardianPhone: "(11) 91234-0000", legalGuardianRelationship: "Mãe" }, existing, full);
  assert.equal(good.ok, true);
  assert.equal(good.data.legalGuardianCpf, "390.533.447-05");
  const adult = buildPatientUpdate({ birthDate: "10/05/1996" }, { ...existing, legalGuardianName: "Ana Silva" }, full);
  assert.equal(adult.data.legalGuardianName, null);
  assert.equal(adult.data.legalGuardianCpf, null);
});

test("convênio exige operadora e carteirinha; particular limpa os dois", () => {
  assert.equal(buildPatientUpdate({ careType: "Convênio" }, existing, full).ok, false);
  const ok = buildPatientUpdate({ careType: "Convênio", insuranceProvider: "Unimed", insuranceCardNumber: "123" }, existing, full);
  assert.equal(ok.data.insuranceProvider, "Unimed");
  const back = buildPatientUpdate({ careType: "Particular", insuranceProvider: "Unimed" }, { ...existing, careType: "Convênio", insuranceProvider: "Unimed", insuranceCardNumber: "1" }, full);
  assert.deepEqual([back.data.insuranceProvider, back.data.insuranceCardNumber], [null, null]);
});

test("whatsapp só como booleano e privacidade nunca é alterada", () => {
  assert.deepEqual(buildPatientUpdate({ whatsappReminders: true, privacyConsent: false }, existing, full).data, { whatsappReminders: true });
});

test("cadastro antigo: nome e telefone fora do padrão só são cobrados quando mudam", () => {
  const old = { ...existing, name: "Maria", phone: "(11) 1234-567" };
  const same = buildPatientUpdate({ name: "Maria", phone: "(11) 1234-567", email: "maria@email.com" }, old, full);
  assert.equal(same.ok, true);
  assert.equal(same.data.email, "maria@email.com");
  assert.equal(buildPatientUpdate({ name: "Joana" }, old, full).ok, false);
  assert.equal(buildPatientUpdate({ phone: "(11) 1234" }, old, full).ok, false);
});

test("responsável legal sem birthDate é recusado com fields", () => {
  const result = buildPatientUpdate({ legalGuardianName: "Ana Silva" }, existing, full);
  assert.equal(result.ok, false);
  assert.ok(result.fields.legalGuardianName);
});

test("age isolado é ignorado quando o registro já tem data de nascimento", () => {
  assert.deepEqual(buildPatientUpdate({ age: 50 }, existing, full).data, {});
  assert.equal(buildPatientUpdate({ age: 50 }, { ...existing, birthDate: null }, full).data.age, 50);
});
