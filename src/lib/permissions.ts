import type { SectionId } from "../types/clinic";

export type Role = "ADMIN" | "PROFESSIONAL" | "STAFF";
export type Permission =
  | "clinical:read" // fotos, avaliação por id, notas, materiais usados, observações clínicas
  | "clinical:write" // gravar avaliação e procedimentos do paciente
  | "anamnesis:read" // conteúdo da anamnese (o atendente só vê se existe)
  | "anamnesis:write" // preencher, concluir e revisar a anamnese
  | "appointment:run" // iniciar/finalizar atendimento e conferir materiais
  | "clinical:archive" // arquivar/desarquivar documentos e fotos clínicos
  | "clinical:delete" // exclusão definitiva de documentos e fotos clínicos
  | "payments:access" // ver e registrar pagamentos
  | "payments:delete"
  | "quote:edit-closed"; // alterar orçamento já aprovado ou pago
export type ObservationKind = "clinical" | "administrative";

const grants: Record<Permission, readonly Role[]> = {
  "clinical:read": ["ADMIN", "PROFESSIONAL"],
  "clinical:write": ["ADMIN", "PROFESSIONAL"],
  "anamnesis:read": ["ADMIN", "PROFESSIONAL"],
  "anamnesis:write": ["ADMIN", "PROFESSIONAL"],
  "appointment:run": ["ADMIN", "PROFESSIONAL"],
  "clinical:archive": ["ADMIN", "PROFESSIONAL"],
  "clinical:delete": ["ADMIN"],
  "payments:access": ["ADMIN", "STAFF"],
  "payments:delete": ["ADMIN"],
  "quote:edit-closed": ["ADMIN", "PROFESSIONAL"],
};

export function can(role: string | null | undefined, permission: Permission) {
  return (grants[permission] as readonly string[]).includes(role ?? "");
}

const allSections: SectionId[] = ["dashboard", "agenda", "clientes", "procedimentos", "estoque", "compras", "orcamentos", "pagamentos", "financeiro", "relatorios", "calculadora", "configuracoes"];

export function visibleSections(role: string | null | undefined): SectionId[] {
  if (role === "ADMIN") return allSections;
  if (role === "PROFESSIONAL") return ["agenda", "clientes", "orcamentos"];
  if (role === "STAFF") return ["agenda", "clientes", "orcamentos", "pagamentos"];
  return [];
}

// Tipos de observação que o papel lê e pode criar (as administrativas são de todos).
export function observationKindsFor(role: string | null | undefined): ObservationKind[] {
  if (role === "ADMIN" || role === "PROFESSIONAL") return ["clinical", "administrative"];
  if (role === "STAFF") return ["administrative"];
  return [];
}

const closedQuoteStatuses = ["Aprovado", "Pago"];

// Orçamento fechado gerou procedimento no prontuário: só administrador/profissional mexem no conteúdo ou desfazem.
// O atendente pode apenas avançar de "Aprovado" para "Pago" (ou repetir o mesmo status).
export function quoteChangeAllowed(role: string | null | undefined, change: { current: string; next?: string; editsContent: boolean }) {
  if (role !== "ADMIN" && role !== "PROFESSIONAL" && role !== "STAFF") return false;
  if (can(role, "quote:edit-closed")) return true;
  if (!closedQuoteStatuses.includes(change.current)) return true;
  if (change.editsContent) return false;
  if (change.next === undefined || change.next === change.current) return true;
  return change.current === "Aprovado" && change.next === "Pago";
}

// Quem aprova o orçamento não é, necessariamente, quem executa o procedimento.
export function quoteProfessional(role: string | null | undefined, userName: string) {
  return can(role, "clinical:write") ? userName : "";
}

// Atendimento em curso ou concluído: só quem conduz o atendimento mexe nele.
export const runningAppointmentStatuses = ["Em atendimento", "Atendido", "Finalizado"] as const;
// Status que o atendente define: falta e cancelamento (agenda) e reabrir como agendado ao remarcar.
const staffAppointmentStatuses = ["Agendado", "Faltou", "Cancelado"];

export function appointmentStatusChangeAllowed(role: string | null | undefined, current: string, next: string | undefined) {
  if (can(role, "appointment:run")) return true;
  if (role !== "STAFF") return false;
  if ((runningAppointmentStatuses as readonly string[]).includes(current)) return false;
  if (next === undefined || next === current) return true;
  return staffAppointmentStatuses.includes(next);
}

export function appointmentDeleteAllowed(role: string | null | undefined, current: string) {
  if (can(role, "appointment:run")) return true;
  return role === "STAFF" && !(runningAppointmentStatuses as readonly string[]).includes(current);
}

export const OWN_APPOINTMENT_ONLY_MESSAGE = "Você só pode agendar atendimentos para você mesmo.";

// Mesma normalização de `professionalKey` (appointment-conflict-rules.ts); repetida aqui porque este módulo não importa runtime.
function normalizedProfessional(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

// PROFESSIONAL só agenda para si mesmo. Vazio/ausente (PATCH sem trocar o profissional) e manter o profissional
// atual do agendamento (`currentProfessional`, só no PATCH) são permitidos; só trocar para outro é recusado.
export function appointmentProfessionalAllowed(role: string | null | undefined, userName: string, professional: string | null | undefined, currentProfessional?: string | null) {
  if (role !== "PROFESSIONAL") return true;
  const next = normalizedProfessional(professional);
  if (!next) return true;
  if (next === normalizedProfessional(userName)) return true;
  return currentProfessional !== undefined && next === normalizedProfessional(currentProfessional);
}
