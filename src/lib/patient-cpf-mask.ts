// Decisão: a recepção (STAFF) não precisa do CPF inteiro para identificar o cliente, então o servidor devolve só os 2 últimos
// dígitos (***.***.***-12). ADMIN e PROFESSIONAL recebem completo. A busca por CPF compara no servidor com o valor completo;
// só a resposta é mascarada. Um valor mascarado nunca deve voltar para o banco (ver isMaskedCpf no PATCH do paciente).

export function canSeeFullCpf(role: string | null | undefined) {
  return role === "ADMIN" || role === "PROFESSIONAL";
}

export function maskCpf(cpf: string | null | undefined) {
  if (!cpf) return cpf ?? null;
  const digits = cpf.replace(/\D/g, "");
  return `***.***.***-${digits.slice(-2).padStart(2, "*")}`;
}

export function isMaskedCpf(value: string | null | undefined) {
  return Boolean(value?.includes("*"));
}

export function cpfForRole<T extends { cpf?: string | null } | null | undefined>(role: string | null | undefined, record: T): T {
  if (!record || canSeeFullCpf(role) || !record.cpf) return record;
  return { ...record, cpf: maskCpf(record.cpf) } as T;
}

export function patientsForRole<T extends { cpf?: string | null }>(role: string | null | undefined, patients: T[]): T[] {
  return canSeeFullCpf(role) ? patients : patients.map((patient) => cpfForRole(role, patient));
}
