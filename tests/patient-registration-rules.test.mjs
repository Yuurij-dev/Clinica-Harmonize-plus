import assert from "node:assert/strict";
import { test } from "node:test";
import { birthDateFromPtBr, calculateAge, referralSources, relationshipOptions, sexOptions, clinicReferenceDate, fieldMaxLength, isMinorBirthDate, normalizeName, validNameFormat, phoneError, validBrazilianPhone, validCpf, validateRegistration, parseSexUpdate } from "../src/lib/patient-registration-rules.ts";

const now = new Date(2026, 10, 3, 10, 0, 0); // 03/11/2026
const adult = { name: "Maria Silva", birthDate: "10/05/1990", cpf: "529.982.247-25", phone: "(11) 91234-5678", email: "", postalCode: "", emergencyContactPhone: "",
  legalGuardianName: "", legalGuardianCpf: "", legalGuardianPhone: "", legalGuardianRelationship: "", careType: "Particular", insuranceProvider: "", insuranceCardNumber: "", privacyConsent: true };

test("validCpf checks verifier digits and rejects repeated sequences", () => {
  assert.equal(validCpf("529.982.247-25"), true);
  assert.equal(validCpf("52998224725"), true);
  assert.equal(validCpf("529.982.247-24"), false);
  assert.equal(validCpf("111.111.111-11"), false);
  assert.equal(validCpf("123"), false);
  assert.equal(validCpf(""), false);
});

test("phone: length, existing DDD, mobile 9 and landline 2-5", () => {
  assert.equal(validBrazilianPhone("(11) 91234-5678"), true);
  assert.equal(validBrazilianPhone("(11) 3123-4567"), true);
  assert.equal(validBrazilianPhone("(10) 91234-5678"), false);
  assert.equal(phoneError("(10) 91234-5678"), "Esse DDD não existe. Confira os dois primeiros dígitos.");
  assert.match(phoneError("(11) 81234-5678"), /dígito 9/);
  assert.match(phoneError("(11) 9123-4567"), /fixo/);
  assert.match(phoneError("(11) 9123"), /10 ou 11/);
  assert.equal(phoneError("(21) 98888-7777"), null);
});

test("birth date rejects nonexistent, future, malformed and over 130 years", () => {
  assert.equal(birthDateFromPtBr("31/02/2000", now).ok, false);
  assert.equal(birthDateFromPtBr("29/02/2001", now).ok, false);
  assert.equal(birthDateFromPtBr("29/02/2000", now).ok, true);
  assert.equal(birthDateFromPtBr("04/11/2026", now).ok, false);
  assert.equal(birthDateFromPtBr("01/01/1800", now).ok, false);
  assert.equal(birthDateFromPtBr("1/1/2000", now).ok, false);
  assert.equal(birthDateFromPtBr("03/11/2026", now).ok, true);
});

test("age accounts for a birthday that has not happened yet", () => {
  assert.equal(calculateAge(new Date(1990, 10, 4), now).years, 35);
  assert.equal(calculateAge(new Date(1990, 10, 3), now).years, 36);
  assert.equal(calculateAge(new Date(1990, 11, 1), now).years, 35);
  const ok = birthDateFromPtBr("10/05/1990", now);
  assert.equal(ok.ok && ok.age, 36);
  assert.equal(ok.ok && ok.label, "36 anos");
});

test("age label for babies and exactly one year", () => {
  const label = (value) => { const r = birthDateFromPtBr(value, now); return r.ok ? r.label : null; };
  assert.equal(label("03/11/2025"), "1 ano");
  assert.equal(label("04/11/2025"), "11 meses");
  assert.equal(label("03/04/2026"), "7 meses");
  assert.equal(label("03/10/2026"), "1 mês");
  assert.equal(label("15/10/2026"), "Menos de 1 mês");
  assert.equal(label("03/11/2026"), "Menos de 1 mês");
});

test("valid adult has no errors", () => {
  assert.deepEqual(validateRegistration(adult, now), {});
});

test("adult requires CPF, phone, name with surname and consent", () => {
  const errors = validateRegistration({ ...adult, name: "Maria", cpf: "", phone: "", privacyConsent: false }, now);
  assert.deepEqual(Object.keys(errors).sort(), ["cpf", "name", "phone", "privacyConsent"]);
  assert.ok(validateRegistration({ ...adult, name: "Maria 2 Silva" }, now).name);
});

test("optional email and postal code are validated only when filled", () => {
  assert.deepEqual(validateRegistration({ ...adult, email: "", postalCode: "" }, now), {});
  assert.ok(validateRegistration({ ...adult, email: "maria@" }, now).email);
  assert.ok(validateRegistration({ ...adult, postalCode: "1234-567" }, now).postalCode);
  assert.deepEqual(validateRegistration({ ...adult, email: "m@x.com", postalCode: "01310-100" }, now), {});
});

test("minor: guardian required, own CPF and phone optional, hidden guardian fields skipped for adults", () => {
  const minor = { ...adult, birthDate: "10/05/2015", cpf: "", phone: "" };
  assert.equal(isMinorBirthDate(minor.birthDate, now), true);
  assert.deepEqual(Object.keys(validateRegistration(minor, now)).sort(), ["legalGuardianCpf", "legalGuardianName", "legalGuardianPhone", "legalGuardianRelationship"]);
  const filled = { ...minor, legalGuardianName: "Ana Souza", legalGuardianCpf: "529.982.247-25", legalGuardianPhone: "(11) 91234-5678", legalGuardianRelationship: "Mãe" };
  assert.deepEqual(validateRegistration(filled, now), {});
  assert.ok(validateRegistration({ ...filled, cpf: "111.111.111-11" }, now).cpf, "a CPF typed for the minor must still be valid");
  assert.ok(validateRegistration({ ...filled, legalGuardianCpf: "123.456.789-00" }, now).legalGuardianCpf);
  assert.equal(isMinorBirthDate("03/11/2008", now), false);
  assert.equal(isMinorBirthDate("04/11/2008", now), true);
  assert.equal(validateRegistration({ ...adult, legalGuardianName: "" }, now).legalGuardianName, undefined);
});

test("insurance provider and card are required only for Convênio", () => {
  assert.deepEqual(validateRegistration({ ...adult, careType: "Particular" }, now), {});
  assert.deepEqual(Object.keys(validateRegistration({ ...adult, careType: "Convênio" }, now)).sort(), ["insuranceCardNumber", "insuranceProvider"]);
  assert.deepEqual(validateRegistration({ ...adult, careType: "Convênio", insuranceProvider: "Unimed", insuranceCardNumber: "123" }, now), {});
});

test("names accept dots, typographic apostrophes, hyphens and decomposed accents; reject digits and single names", () => {
  for (const name of ["João Silva Jr.", "Ana M. Lima", "D’Ávila Souza", "D'Ávila Souza", "Maria-Clara Dias", "José Silva"]) assert.equal(validNameFormat(name), true, name);
  for (const name of ["Maria", "Maria 2 Silva", "Maria S1lva", "", "   ", ". Silva"]) assert.equal(validNameFormat(name), false, name);
  assert.equal(normalizeName("José   Silva"), "José Silva");
});

test("clinic reference date uses the Brasília day even when the server is already on the next UTC day", () => {
  const lateEveningBrt = new Date("2026-11-04T01:30:00Z"); // 22:30 de 03/11 em Brasília
  assert.equal(birthDateFromPtBr("04/11/2026", clinicReferenceDate(lateEveningBrt)).ok, false, "amanhã continua futuro");
  assert.equal(isMinorBirthDate("04/11/2008", clinicReferenceDate(lateEveningBrt)), true, "faz 18 anos só amanhã");
  assert.equal(isMinorBirthDate("03/11/2008", clinicReferenceDate(lateEveningBrt)), false);
  const result = birthDateFromPtBr("04/11/2008", clinicReferenceDate(lateEveningBrt));
  assert.equal(result.ok && result.age, 17);
});

test("guardian CPF equal to the minor's CPF is rejected", () => {
  const minor = { ...adult, birthDate: "10/05/2015", cpf: "529.982.247-25", legalGuardianName: "Ana Souza", legalGuardianCpf: "52998224725", legalGuardianPhone: "(11) 91234-5678", legalGuardianRelationship: "Mãe" };
  assert.ok(validateRegistration(minor, now).legalGuardianCpf);
});

test("free-text length limits", () => {
  assert.equal(fieldMaxLength("email"), 254);
  assert.equal(fieldMaxLength("address"), 200);
});

test("decomposed (NFD) accents are accepted and normalized to NFC", () => {
  const nfd = "José Silva";
  const nfc = "José Silva";
  assert.notEqual(nfd, nfc, "o literal precisa estar de fato decomposto");
  assert.equal(nfd.length, nfc.length + 1);
  assert.equal(validNameFormat(nfd), true);
  assert.equal(normalizeName(nfd), nfc);
  assert.deepEqual(validateRegistration({ ...adult, name: nfd }, now), {});
});

test("punctuation-only and combining-mark-only names are rejected", () => {
  for (const name of [". .", "- -", "' '", "́ ́", "Maria ́"]) assert.equal(validNameFormat(name), false, JSON.stringify(name));
});

test("referral source and relationships are closed lists (valid passes, outside is rejected, empty is allowed when optional)", () => {
  assert.equal(validateRegistration({ ...adult, referralSource: "Instagram", emergencyContactRelationship: "Tia" }, now).referralSource, undefined);
  for (const option of referralSources) assert.equal(validateRegistration({ ...adult, referralSource: option }, now).referralSource, undefined, option);
  for (const option of relationshipOptions) assert.equal(validateRegistration({ ...adult, emergencyContactRelationship: option }, now).emergencyContactRelationship, undefined, option);
  assert.ok(validateRegistration({ ...adult, referralSource: "Panfleto" }, now).referralSource);
  assert.ok(validateRegistration({ ...adult, emergencyContactRelationship: "Vizinho" }, now).emergencyContactRelationship);
  assert.deepEqual(validateRegistration({ ...adult, referralSource: "", emergencyContactRelationship: "" }, now), {});
  assert.deepEqual(validateRegistration(adult, now), {});
});

test("guardian relationship is required for a minor and must come from the list", () => {
  const minor = { ...adult, birthDate: "10/05/2015", cpf: "", phone: "", legalGuardianName: "Ana Souza", legalGuardianCpf: "529.982.247-25", legalGuardianPhone: "(11) 91234-5678" };
  assert.ok(validateRegistration({ ...minor, legalGuardianRelationship: "" }, now).legalGuardianRelationship);
  assert.ok(validateRegistration({ ...minor, legalGuardianRelationship: "Vizinha" }, now).legalGuardianRelationship);
  assert.deepEqual(validateRegistration({ ...minor, legalGuardianRelationship: "Responsável legal" }, now), {});
  assert.equal(validateRegistration({ ...adult, legalGuardianRelationship: "Vizinha" }, now).legalGuardianRelationship, undefined, "oculto para adulto: não validado");
});

test("sex is a closed list; empty is allowed", () => {
  for (const option of sexOptions) assert.equal(validateRegistration({ ...adult, sex: option }, now).sex, undefined, option);
  assert.ok(validateRegistration({ ...adult, sex: "Outro gênero" }, now).sex);
  assert.ok(validateRegistration({ ...adult, sex: "feminino" }, now).sex);
  assert.deepEqual(validateRegistration({ ...adult, sex: "" }, now), {});
});

test("parseSexUpdate: ausente mantém, vazio limpa, fora da lista é inválido", () => {
  assert.deepEqual(parseSexUpdate(undefined), { ok: true, sex: undefined });
  assert.deepEqual(parseSexUpdate(""), { ok: true, sex: null });
  assert.deepEqual(parseSexUpdate("Feminino"), { ok: true, sex: "Feminino" });
  assert.deepEqual(parseSexUpdate("Outro"), { ok: true, sex: "Outro" });
  assert.equal(parseSexUpdate("Xyz").ok, false);
  assert.equal(parseSexUpdate(1).ok, false);
});
