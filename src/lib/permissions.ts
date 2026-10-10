import type { SectionId } from "../types/clinic";

export type Role = "ADMIN" | "PROFESSIONAL" | "STAFF";
export type Permission =
  | "clinical:read" // fotos, avaliação por id, notas, materiais usados, observações clínicas
  | "clinical:write" // gravar avaliação e procedimentos do paciente
  | "appointment:run" // iniciar/finalizar atendimento e conferir materiais
  | "payments:access" // ver e registrar pagamentos
  | "payments:delete"
  | "quote:edit-closed"; // alterar orçamento já aprovado ou pago
export type ObservationKind = "clinical" | "administrative";

const grants: Record<Permission, readonly Role[]> = {
  "clinical:read": ["ADMIN", "PROFESSIONAL"],
  "clinical:write": ["ADMIN", "PROFESSIONAL"],
  "appointment:run": ["ADMIN", "PROFESSIONAL"],
  "payments:access": ["ADMIN", "STAFF"],
  "payments:delete": ["ADMIN"],
  "quote:edit-closed": ["ADMIN", "PROFESSIONAL"],
};

export function can(role: string | null | undefined, permission: Permission) {
  return (grants[permission] as readonly string[]).includes(role ?? "");
}

const allSections: SectionId[] = ["dashboard", "agenda", "clientes", "procedimentos", "estoque", "orcamentos", "pagamentos", "financeiro", "relatorios", "calculadora", "configuracoes"];

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
