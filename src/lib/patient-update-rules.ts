import { formatCep, formatCpf, formatPhone } from "./input-masks.ts";
import { isMaskedCpf } from "./patient-cpf-mask.ts";
import { birthDateFromPtBr, fieldMaxLength, normalizeName, validateRegistration, parseSexUpdate, type RegistrationValues } from "./patient-registration-rules.ts";

// Valores do formulário de cadastro/edição (tudo texto, como nos campos da tela).
export type PatientFormValues = RegistrationValues & {
  socialName: string; sex: string; profession: string; referralSource: string;
  address: string; addressNumber: string; addressComplement: string; neighborhood: string; city: string; state: string;
  emergencyContactName: string; emergencyContactRelationship: string;
  whatsappReminders: boolean;
};

// Registro como o GET /api/patients/:id?form=edit devolve (datas chegam como ISO).
export type PatientEditRecord = {
  name: string; cpf: string | null; phone: string; age: number; birthDate: string | Date | null; email: string | null;
  socialName: string | null; sex: string | null; profession: string | null; referralSource: string | null;
  postalCode: string | null; address: string | null; addressNumber: string | null; addressComplement: string | null;
  neighborhood: string | null; city: string | null; state: string | null;
  emergencyContactName: string | null; emergencyContactPhone: string | null; emergencyContactRelationship: string | null;
  legalGuardianName: string | null; legalGuardianCpf: string | null; legalGuardianPhone: string | null; legalGuardianRelationship: string | null;
  careType: string; insuranceProvider: string | null; insuranceCardNumber: string | null;
  privacyConsentAt: string | Date | null; whatsappReminders: boolean;
};

export const emptyPatientFormValues: PatientFormValues = {
  name: "", birthDate: "", cpf: "", phone: "", email: "", postalCode: "", emergencyContactPhone: "",
  legalGuardianName: "", legalGuardianCpf: "", legalGuardianPhone: "", legalGuardianRelationship: "",
  careType: "Particular", insuranceProvider: "", insuranceCardNumber: "", privacyConsent: false,
  socialName: "", sex: "", profession: "", referralSource: "", address: "", addressNumber: "", addressComplement: "", neighborhood: "", city: "", state: "",
  emergencyContactName: "", emergencyContactRelationship: "", whatsappReminders: false,
};

const isoDay = (value: string | Date | null) => (value ? (value instanceof Date ? value.toISOString() : value).slice(0, 10) : "");

// Registro salvo -> valores do formulário (data como dd/mm/aaaa, máscaras de CPF, telefone e CEP).
export function formValuesFromRecord(record: PatientEditRecord): PatientFormValues {
  const iso = isoDay(record.birthDate);
  const phone = (value: string | null) => (value ? formatPhone(value) : "");
  return {
    name: record.name, birthDate: iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "",
    cpf: record.cpf ?? "", phone: phone(record.phone), email: record.email ?? "", postalCode: record.postalCode ? formatCep(record.postalCode) : "",
    emergencyContactPhone: phone(record.emergencyContactPhone),
    legalGuardianName: record.legalGuardianName ?? "", legalGuardianCpf: record.legalGuardianCpf ?? "", legalGuardianPhone: phone(record.legalGuardianPhone), legalGuardianRelationship: record.legalGuardianRelationship ?? "",
    careType: record.careType === "Convênio" ? "Convênio" : "Particular", insuranceProvider: record.insuranceProvider ?? "", insuranceCardNumber: record.insuranceCardNumber ?? "",
    privacyConsent: Boolean(record.privacyConsentAt),
    socialName: record.socialName ?? "", sex: record.sex ?? "", profession: record.profession ?? "", referralSource: record.referralSource ?? "",
    address: record.address ?? "", addressNumber: record.addressNumber ?? "", addressComplement: record.addressComplement ?? "",
    neighborhood: record.neighborhood ?? "", city: record.city ?? "", state: record.state ?? "",
    emergencyContactName: record.emergencyContactName ?? "", emergencyContactRelationship: record.emergencyContactRelationship ?? "",
    whatsappReminders: record.whatsappReminders,
  };
}

export type PatientUpdateResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string; fields?: Record<string, string> };

const guardianKeys = ["legalGuardianName", "legalGuardianCpf", "legalGuardianPhone", "legalGuardianRelationship"];
const plainTextKeys = ["socialName", "profession", "referralSource", "address", "addressNumber", "addressComplement", "neighborhood", "city", "emergencyContactName", "emergencyContactRelationship"];

// Edição parcial: só os campos presentes no corpo mudam (ausente = manter). As regras são as do cadastro (validateRegistration)
// aplicadas sobre o registro atual + o que veio no corpo; só os erros dos campos enviados contam. `age` isolado (clientes
// antigos da API) continua valendo; com `birthDate` a idade é derivada da data. Aceite de privacidade nunca é alterado aqui.
// CPF ausente ou mascarado = manter; vazio = limpar, exceto para quem não vê o CPF inteiro (mantém sem erro).
export function buildPatientUpdate(body: Record<string, unknown>, existing: PatientEditRecord, options: { fullCpf: boolean }): PatientUpdateResult {
  const has = (key: string) => body[key] !== undefined;
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
  const digits = (key: string) => text(key).replace(/\D/g, "");

  const tooLong = Object.keys(body).find((key) => text(key).length > fieldMaxLength(key));
  if (tooLong) return { ok: false, message: `O texto informado é longo demais (máximo de ${fieldMaxLength(tooLong)} caracteres).`, fields: { [tooLong]: "Texto longo demais." } };

  // Responsável legal depende da data de nascimento (menor/maior); sem ela não dá para saber se o dado se aplica.
  const guardianWithoutBirth = !has("birthDate") ? guardianKeys.filter(has) : [];
  if (guardianWithoutBirth.length) {
    const message = "Informe a data de nascimento para alterar os dados do responsável legal.";
    return { ok: false, message, fields: Object.fromEntries(guardianWithoutBirth.map((key) => [key, message])) };
  }

  const sexUpdate = parseSexUpdate(body.sex);
  if (!sexUpdate.ok) return { ok: false, message: "Escolha uma das opções de sexo.", fields: { sex: "Escolha uma das opções de sexo." } };

  const keepCpf = typeof body.cpf !== "string" || isMaskedCpf(body.cpf) || (!body.cpf.trim() && !options.fullCpf);
  const keepGuardianCpf = !has("legalGuardianCpf") || typeof body.legalGuardianCpf !== "string" || isMaskedCpf(body.legalGuardianCpf) || (!text("legalGuardianCpf") && !options.fullCpf);

  const base = formValuesFromRecord(existing);
  const pick = (key: keyof PatientFormValues & string) => (has(key) ? text(key) : String(base[key]));
  const careType = has("careType") ? (text("careType") === "Convênio" ? "Convênio" : "Particular") : base.careType;
  const merged: PatientFormValues = {
    ...base,
    name: has("name") ? normalizeName(text("name")) : base.name,
    birthDate: pick("birthDate"), cpf: keepCpf ? base.cpf : text("cpf"), phone: pick("phone"), email: pick("email"), postalCode: pick("postalCode"),
    emergencyContactPhone: pick("emergencyContactPhone"),
    legalGuardianName: pick("legalGuardianName"), legalGuardianCpf: keepGuardianCpf ? base.legalGuardianCpf : text("legalGuardianCpf"),
    legalGuardianPhone: pick("legalGuardianPhone"), legalGuardianRelationship: pick("legalGuardianRelationship"),
    sex: pick("sex"), referralSource: pick("referralSource"), emergencyContactRelationship: pick("emergencyContactRelationship"),
    careType, insuranceProvider: pick("insuranceProvider"), insuranceCardNumber: pick("insuranceCardNumber"), privacyConsent: true,
  };

  const relevant = new Set([...Object.keys(body), ...(has("birthDate") ? [...guardianKeys, "cpf"] : []), ...(has("careType") ? ["insuranceProvider", "insuranceCardNumber"] : [])]);
  const errors: Record<string, string> = {};
  for (const [key, message] of Object.entries(validateRegistration(merged, undefined, { editing: true }))) if (relevant.has(key)) errors[key] = message;
  // Cadastro antigo fora do padrão novo: nome e telefone só são cobrados quando mudam (permite corrigir outros campos).
  if (has("name") && merged.name === normalizeName(base.name)) delete errors.name;
  if (has("phone") && base.phone && digits("phone") === base.phone.replace(/\D/g, "")) delete errors.phone;

  let age: number | undefined;
  // Com data de nascimento no registro a idade é derivada dela: `age` isolado é ignorado.
  if (!has("birthDate") && has("age") && !existing.birthDate) {
    const legacyAge = Number(body.age);
    if (!Number.isInteger(legacyAge) || legacyAge < 0 || legacyAge > 130) errors.age = "Informe uma idade válida.";
    else age = legacyAge;
  }
  const firstError = Object.values(errors)[0];
  if (firstError) return { ok: false, message: firstError, fields: errors };

  const data: Record<string, unknown> = {};
  if (has("name")) data.name = merged.name;
  if (!keepCpf) data.cpf = digits("cpf") ? formatCpf(digits("cpf")) : null;
  if (age !== undefined) data.age = age;

  let minor = false;
  if (has("birthDate")) {
    const birth = birthDateFromPtBr(text("birthDate"));
    if (!birth.ok) return { ok: false, message: birth.message, fields: { birthDate: birth.message } };
    minor = birth.age < 18;
    data.age = birth.age;
    data.birthDate = new Date(`${birth.iso}T12:00:00.000Z`);
  }
  // Menor sem telefone próprio usa o do responsável (igual ao cadastro).
  if (has("phone")) data.phone = formatPhone(digits("phone") || merged.legalGuardianPhone.replace(/\D/g, ""));
  if (has("email")) data.email = text("email").toLowerCase() || null;
  if (has("sex") && sexUpdate.sex !== undefined) data.sex = sexUpdate.sex;
  for (const key of plainTextKeys) if (has(key)) data[key] = text(key) || null;
  if (has("state")) data.state = text("state").toUpperCase().slice(0, 2) || null;
  if (has("postalCode")) data.postalCode = digits("postalCode") || null;
  if (has("emergencyContactPhone")) data.emergencyContactPhone = digits("emergencyContactPhone") ? formatPhone(digits("emergencyContactPhone")) : null;

  // Responsável legal só existe para menor: ao virar maior de idade os dados dele saem; só é tratado quando a data vem junto.
  if (has("birthDate")) {
    data.legalGuardianName = minor ? normalizeName(merged.legalGuardianName) : null;
    if (!minor) data.legalGuardianCpf = null;
    else if (!keepGuardianCpf) data.legalGuardianCpf = formatCpf(merged.legalGuardianCpf.replace(/\D/g, ""));
    data.legalGuardianPhone = minor ? formatPhone(merged.legalGuardianPhone.replace(/\D/g, "")) : null;
    data.legalGuardianRelationship = minor ? merged.legalGuardianRelationship : null;
  }

  if (has("careType") || has("insuranceProvider") || has("insuranceCardNumber")) {
    data.careType = careType;
    data.insuranceProvider = careType === "Convênio" ? merged.insuranceProvider : null;
    data.insuranceCardNumber = careType === "Convênio" ? merged.insuranceCardNumber : null;
  }
  if (typeof body.whatsappReminders === "boolean") data.whatsappReminders = body.whatsappReminders;
  return { ok: true, data };
}
