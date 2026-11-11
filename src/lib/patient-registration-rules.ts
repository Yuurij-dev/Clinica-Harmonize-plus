import { clinicToday } from "./clinic-time.ts";

// "Hoje" no fuso da clínica (meio-dia local, só para os getters de data). Cliente e servidor usam o mesmo dia,
// mesmo entre 21h e meia-noite em Brasília, quando o servidor (UTC) já está no dia seguinte.
export function clinicReferenceDate(now = new Date()) {
  const [year, month, day] = clinicToday(now).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export type BirthDateResult = { ok: true; iso: string; age: number; label: string } | { ok: false; message: string };

export function calculateAge(birth: Date, now = clinicReferenceDate()) {
  let years = now.getFullYear() - birth.getFullYear();
  const beforeBirthday = now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) years -= 1;
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months -= 1;
  if (years >= 1) return { years, months };
  return { years: 0, months: Math.max(0, months) };
}

export function birthDateFromPtBr(value: string, now = clinicReferenceDate()): BirthDateResult {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return { ok: false, message: "Informe a data no formato dd/mm/aaaa." };
  const [, d, m, y] = match;
  const birth = new Date(Number(y), Number(m) - 1, Number(d));
  if (birth.getFullYear() !== Number(y) || birth.getMonth() !== Number(m) - 1 || birth.getDate() !== Number(d)) return { ok: false, message: "Informe uma data de nascimento existente." };
  if (birth > now) return { ok: false, message: "A data de nascimento não pode estar no futuro." };
  const age = calculateAge(birth, now);
  if (age.years > 130) return { ok: false, message: "A idade máxima aceita é 130 anos." };
  const label = age.years ? `${age.years} ${age.years === 1 ? "ano" : "anos"}` : age.months ? `${age.months} ${age.months === 1 ? "mês" : "meses"}` : "Menos de 1 mês";
  return { ok: true, iso: `${y}-${m}-${d}`, age: age.years, label };
}

export function validCpf(value: string) {
  const cpf = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => { let sum = 0; for (let i = 0; i < length; i += 1) sum += Number(cpf[i]) * (length + 1 - i); const rest = (sum * 10) % 11; return rest === 10 ? 0 : rest; };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

const validDdds = new Set([11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99]);

export function validBrazilianPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10 && digits.length !== 11) return false;
  const ddd = Number(digits.slice(0, 2));
  const subscriber = digits.slice(2);
  return validDdds.has(ddd) && (digits.length === 11 ? subscriber[0] === "9" : /^[2-5]/.test(subscriber));
}

// Versão do texto de consentimento exibido no cadastro; é gravada junto da data/hora do aceite.
export const PRIVACY_CONSENT_VERSION = "2026-11-03";
export const PRIVACY_CONSENT_TEXT = "O cliente ou responsável leu a política de privacidade e foi informado sobre o uso dos dados.";

// Aceita acentos (inclusive decompostos), ponto (Jr., M.), apóstrofo reto ou tipográfico e hífen; sem números. Exige nome e sobrenome.
export const normalizeName = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");
export const validNameFormat = (value: string) => /^\p{L}[\p{L}\p{M}.'’-]*(?: \p{L}[\p{L}\p{M}.'’-]*)+$/u.test(normalizeName(value));

// Limite de tamanho por campo de texto livre (aplicado no servidor).
export const fieldMaxLength = (key: string) => (key === "email" ? 254 : 200);
export const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
export const validPostalCode = (value: string) => value.replace(/\D/g, "").length === 8;

// Mensagem específica de telefone (null = válido). Mesma regra de validBrazilianPhone, com a causa do erro.
export function phoneError(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10 && digits.length !== 11) return "O telefone precisa ter DDD e 10 ou 11 números.";
  if (!validDdds.has(Number(digits.slice(0, 2)))) return "Esse DDD não existe. Confira os dois primeiros dígitos.";
  if (digits.length === 11 && digits[2] !== "9") return "Celular com 11 números precisa ter o dígito 9 depois do DDD.";
  if (digits.length === 10 && !/^[2-5]/.test(digits.slice(2))) return "Telefone fixo com 10 números deve começar com 2 a 5 depois do DDD.";
  return null;
}

// Listas fechadas (cliente e servidor usam as mesmas): sem texto livre para "Outro".
export const sexOptions = ["Feminino", "Masculino", "Outro"] as const;
export const referralSources = ["Indicação de paciente", "Indicação de profissional", "Instagram", "Facebook", "Google", "WhatsApp", "TikTok", "Passou em frente", "Já era paciente", "Outro"] as const;
export const relationshipOptions = ["Mãe", "Pai", "Avó", "Avô", "Madrasta", "Padrasto", "Irmã", "Irmão", "Tia", "Tio", "Cônjuge", "Filha", "Filho", "Responsável legal", "Outro"] as const;
const inList = (list: readonly string[], value: string) => list.includes(value);

// Sexo na edição: undefined = manter o atual, "" = limpar (null), valor fora da lista = inválido.
export function parseSexUpdate(value: unknown): { ok: true; sex: string | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, sex: undefined };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, sex: null };
  return inList(sexOptions, trimmed) ? { ok: true, sex: trimmed } : { ok: false };
}

export type RegistrationValues = {
  name: string; birthDate: string; cpf: string; phone: string; email: string; postalCode: string;
  emergencyContactPhone: string;
  legalGuardianName: string; legalGuardianCpf: string; legalGuardianPhone: string; legalGuardianRelationship: string;
  sex?: string; referralSource?: string; emergencyContactRelationship?: string;
  careType: string; insuranceProvider: string; insuranceCardNumber: string; privacyConsent: boolean;
};

export function isMinorBirthDate(birthDate: string, now = clinicReferenceDate()) {
  const birth = birthDateFromPtBr(birthDate, now);
  return birth.ok && birth.age < 18;
}

// Única fonte das regras do cadastro, usada pelo modal e pela API. Campo oculto (responsável, convênio) não é validado.
// Devolve { campo: mensagem } só com o que está inválido.
export function validateRegistration(values: RegistrationValues, now = clinicReferenceDate()): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  if (!name) errors.name = "Informe o nome completo.";
  else if (!validNameFormat(name)) errors.name = "Informe nome e sobrenome, sem números.";

  const birth = birthDateFromPtBr(values.birthDate, now);
  if (!values.birthDate.trim()) errors.birthDate = "Informe a data de nascimento.";
  else if (!birth.ok) errors.birthDate = birth.message;
  const minor = birth.ok && birth.age < 18;

  const cpfFilled = values.cpf.replace(/\D/g, "").length > 0;
  if (!minor && !cpfFilled) errors.cpf = "Informe o CPF do cliente.";
  else if (cpfFilled && !validCpf(values.cpf)) errors.cpf = "CPF inválido. Confira os números digitados.";

  if (!minor && !values.phone.replace(/\D/g, "")) errors.phone = "Informe o telefone ou WhatsApp.";
  else if (values.phone.replace(/\D/g, "")) { const message = phoneError(values.phone); if (message) errors.phone = message; }

  if (values.sex && !inList(sexOptions, values.sex)) errors.sex = "Escolha uma das opções de sexo.";
  if (values.referralSource && !inList(referralSources, values.referralSource)) errors.referralSource = "Escolha uma das opções de como nos conheceu.";
  if (values.emergencyContactRelationship && !inList(relationshipOptions, values.emergencyContactRelationship)) errors.emergencyContactRelationship = "Escolha uma das opções de parentesco.";
  if (values.email.trim() && !validEmail(values.email)) errors.email = "Informe um e-mail válido, como nome@email.com.";
  if (values.postalCode.trim() && !validPostalCode(values.postalCode)) errors.postalCode = "O CEP precisa ter 8 números.";
  if (values.emergencyContactPhone.replace(/\D/g, "")) { const message = phoneError(values.emergencyContactPhone); if (message) errors.emergencyContactPhone = message; }

  if (minor) {
    if (!values.legalGuardianName.trim()) errors.legalGuardianName = "Informe o nome do responsável legal.";
    else if (!validNameFormat(values.legalGuardianName)) errors.legalGuardianName = "Informe nome e sobrenome do responsável, sem números.";
    if (!values.legalGuardianCpf.replace(/\D/g, "")) errors.legalGuardianCpf = "Informe o CPF do responsável.";
    else if (!validCpf(values.legalGuardianCpf)) errors.legalGuardianCpf = "CPF do responsável inválido. Confira os números digitados.";
    else if (cpfFilled && values.legalGuardianCpf.replace(/\D/g, "") === values.cpf.replace(/\D/g, "")) errors.legalGuardianCpf = "O CPF do responsável não pode ser igual ao do cliente. Confira os números.";
    if (!values.legalGuardianPhone.replace(/\D/g, "")) errors.legalGuardianPhone = "Informe o telefone do responsável.";
    else { const message = phoneError(values.legalGuardianPhone); if (message) errors.legalGuardianPhone = message; }
    if (!values.legalGuardianRelationship.trim()) errors.legalGuardianRelationship = "Escolha o parentesco do responsável.";
    else if (!inList(relationshipOptions, values.legalGuardianRelationship)) errors.legalGuardianRelationship = "Escolha uma das opções de parentesco.";
  }

  if (values.careType === "Convênio") {
    if (!values.insuranceProvider.trim()) errors.insuranceProvider = "Informe a operadora do convênio.";
    if (!values.insuranceCardNumber.trim()) errors.insuranceCardNumber = "Informe o número da carteirinha.";
  }
  if (!values.privacyConsent) errors.privacyConsent = "Confirme que a política de privacidade foi apresentada.";
  return errors;
}
