import { can } from "./permissions.ts";

// Decisão: a recepção (STAFF) não precisa do CPF inteiro para identificar o cliente, então o servidor devolve só os 2 últimos
// dígitos (***.***.***-12). ADMIN e PROFESSIONAL recebem completo. A busca por CPF compara no servidor com o valor completo;
// só a resposta é mascarada. Um valor mascarado nunca deve voltar para o banco (ver isMaskedCpf no PATCH do paciente).

export function canSeeFullCpf(role: string | null | undefined, rolePermissions?: unknown) {
  return can(role, "patients:cpf-full", rolePermissions);
}

export function maskCpf(cpf: string | null | undefined) {
  if (!cpf) return cpf ?? null;
  const digits = cpf.replace(/\D/g, "");
  return `***.***.***-${digits.slice(-2).padStart(2, "*")}`;
}

export function isMaskedCpf(value: string | null | undefined) {
  return Boolean(value?.includes("*"));
}

export function cpfForRole<T extends { cpf?: string | null } | null | undefined>(role: string | null | undefined, record: T, rolePermissions?: unknown): T {
  if (!record || canSeeFullCpf(role, rolePermissions) || !record.cpf) return record;
  return { ...record, cpf: maskCpf(record.cpf) } as T;
}

export function patientsForRole<T extends { cpf?: string | null }>(role: string | null | undefined, patients: T[], rolePermissions?: unknown): T[] {
  return canSeeFullCpf(role, rolePermissions) ? patients : patients.map((patient) => cpfForRole(role, patient, rolePermissions));
}
