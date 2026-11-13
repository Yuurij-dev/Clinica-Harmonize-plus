import { professionalKey } from "./appointment-conflict-rules.ts";
import { COLLABORATOR_ADDRESS_MAX, COLLABORATOR_NAME_MAX, COLLABORATOR_PLACE_MAX } from "./collaborator-profile-rules.ts";
import { PASSWORD_RULE_MESSAGE, isStrongPassword } from "./password-rules.ts";
import { validCpf } from "./patient-registration-rules.ts";

// "Meu perfil": regras puras do próprio usuário (dados pessoais e troca de senha). Sem Prisma, sem Next.
// O e-mail (login), o papel e a clínica NUNCA entram aqui.

export type OwnProfileField = "name" | "phone" | "cpf" | "postalCode" | "address" | "country" | "state" | "city";

// Só os campos enviados: ausente = manter. Vazio limpa (null), exceto nome. CPF vazio ou mascarado mantém o atual.
export type OwnProfileUpdate = Partial<{ name: string; phone: string | null; cpf: string; postalCode: string | null; address: string | null; country: string | null; state: string | null; city: string | null }>;

export type OwnProfileResult = { ok: true; value: OwnProfileUpdate } | { ok: false; message: string; fields: Partial<Record<OwnProfileField, string>> };

export const OWN_NAME_MESSAGE = "Informe seu nome com até 100 caracteres.";
export const OWN_PHONE_MESSAGE = "Informe um telefone com DDD (10 ou 11 dígitos).";
export const OWN_CPF_MESSAGE = "Informe um CPF válido.";
export const OWN_POSTAL_CODE_MESSAGE = "O CEP deve ter 8 dígitos.";
export const OWN_ADDRESS_MESSAGE = `Use até ${COLLABORATOR_ADDRESS_MAX} caracteres.`;
export const OWN_PLACE_MESSAGE = `Use até ${COLLABORATOR_PLACE_MAX} caracteres.`;
export const OWN_PROFILE_MESSAGE = "Confira os campos destacados.";

const digits = (value: string) => value.replace(/\D/g, "");

/** CPF para exibição: só os 2 últimos dígitos aparecem (***.***.***-34). Sem CPF devolve null. */
export function maskCpf(cpf: string | null | undefined): string | null {
  const d = digits(cpf ?? "");
  return d.length >= 2 ? `***.***.***-${d.slice(-2)}` : null;
}

/** Valor devolvido por maskCpf (ou qualquer texto com asterisco) significa "não mexi no CPF". */
export const isMaskedCpf = (value: string) => value.includes("*");

export function parseOwnProfile(input: Record<string, unknown> | null | undefined): OwnProfileResult {
  const source = input ?? {};
  const fields: Partial<Record<OwnProfileField, string>> = {};
  const value: OwnProfileUpdate = {};
  const has = (key: OwnProfileField) => source[key] !== undefined && source[key] !== null;
  const str = (key: OwnProfileField) => (typeof source[key] === "string" ? (source[key] as string).trim() : null);

  if (has("name")) {
    const name = str("name");
    if (!name || name.length > COLLABORATOR_NAME_MAX) fields.name = OWN_NAME_MESSAGE;
    else value.name = name;
  }
  if (has("phone")) {
    const phone = str("phone");
    const d = phone === null ? "" : digits(phone);
    if (phone === null || (d && d.length !== 10 && d.length !== 11)) fields.phone = OWN_PHONE_MESSAGE;
    else value.phone = d || null;
  }
  if (has("cpf")) {
    const cpf = str("cpf");
    if (cpf === null) fields.cpf = OWN_CPF_MESSAGE;
    else if (cpf && !isMaskedCpf(cpf)) {
      if (validCpf(digits(cpf))) value.cpf = digits(cpf);
      else fields.cpf = OWN_CPF_MESSAGE;
    }
  }
  if (has("postalCode")) {
    const postalCode = str("postalCode");
    const d = postalCode === null ? "" : digits(postalCode);
    if (postalCode === null || (d && d.length !== 8)) fields.postalCode = OWN_POSTAL_CODE_MESSAGE;
    else value.postalCode = d || null;
  }
  const text = (key: "address" | "country" | "state" | "city", max: number, message: string) => {
    if (!has(key)) return;
    const t = str(key);
    if (t === null || t.length > max) fields[key] = message;
    else value[key] = t || null;
  };
  text("address", COLLABORATOR_ADDRESS_MAX, OWN_ADDRESS_MESSAGE);
  text("country", COLLABORATOR_PLACE_MAX, OWN_PLACE_MESSAGE);
  text("state", COLLABORATOR_PLACE_MAX, OWN_PLACE_MESSAGE);
  text("city", COLLABORATOR_PLACE_MAX, OWN_PLACE_MESSAGE);

  return Object.keys(fields).length ? { ok: false, message: OWN_PROFILE_MESSAGE, fields } : { ok: true, value };
}

export type PasswordChangeField = "currentPassword" | "newPassword";
export type PasswordChangeResult = { ok: true; currentPassword: string; newPassword: string } | { ok: false; field: PasswordChangeField; message: string };

export const PASSWORD_CURRENT_REQUIRED_MESSAGE = "Informe a senha atual.";
export const PASSWORD_SAME_MESSAGE = "A nova senha deve ser diferente da atual.";
export const PASSWORD_TOO_LONG_MESSAGE = "A senha pode ter no máximo 72 bytes (cerca de 72 caracteres simples).";

// bcrypt só considera os 72 primeiros BYTES: acima disso a senha seria truncada em silêncio.
const BCRYPT_MAX_BYTES = 72;

export function validatePasswordChange(input: Record<string, unknown> | null | undefined): PasswordChangeResult {
  const currentPassword = typeof input?.currentPassword === "string" ? input.currentPassword : "";
  const newPassword = typeof input?.newPassword === "string" ? input.newPassword : "";
  if (!currentPassword) return { ok: false, field: "currentPassword", message: PASSWORD_CURRENT_REQUIRED_MESSAGE };
  if (!isStrongPassword(newPassword)) return { ok: false, field: "newPassword", message: PASSWORD_RULE_MESSAGE };
  if (new TextEncoder().encode(newPassword).length > BCRYPT_MAX_BYTES) return { ok: false, field: "newPassword", message: PASSWORD_TOO_LONG_MESSAGE };
  if (newPassword === currentPassword) return { ok: false, field: "newPassword", message: PASSWORD_SAME_MESSAGE };
  return { ok: true, currentPassword, newPassword };
}

export const OWN_NAME_TAKEN_MESSAGE = "Já existe outro profissional com este nome na sua clínica. Use um nome diferente (por exemplo, acrescente o sobrenome) para que os relatórios e agendamentos não se misturem.";

/**
 * O escopo dos relatórios de um PROFISSIONAL é por NOME (Appointment.professional é texto). Um nome igual ao de outro
 * membro das clínicas em que ele é profissional misturaria os atendimentos. Compara como o agendamento (espaços colapsados,
 * sem diferenciar maiúsculas). Não bloqueia manter o nome atual nem mudar só as maiúsculas do próprio nome.
 */
export function professionalNameTaken(newName: string, currentName: string, otherNames: readonly string[]): boolean {
  const key = professionalKey(newName);
  if (!key || key === professionalKey(currentName)) return false;
  return otherNames.some((other) => professionalKey(other) === key);
}
