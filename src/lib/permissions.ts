import type { SectionId } from "../types/clinic";

export type Role = "ADMIN" | "PROFESSIONAL" | "STAFF";
export type Permission =
  | "dashboard:access"
  | "agenda:access" | "agenda:manage" | "appointment:run" | "appointments:delete"
  | "patients:access" | "patients:manage" | "patients:delete" | "patients:cpf-full"
  | "clinical:read" | "clinical:write" | "clinical:archive" | "clinical:delete"
  | "anamnesis:read" | "anamnesis:write"
  | "procedures:access" | "procedures:manage"
  | "stock:access" | "stock:manage"
  | "purchases:access" | "purchases:manage"
  | "quotes:access" | "quotes:manage" | "quote:edit-closed"
  | "payments:access" | "payments:manage" | "payments:delete"
  | "finance:access" | "finance:manage"
  | "reports:access"
  | "settings:access" | "settings:manage" | "settings:team" | "settings:permissions";
export type RolePermissionMatrix = Record<Role, Record<Permission, boolean>>;
export type ObservationKind = "clinical" | "administrative";

export const roles: Role[] = ["ADMIN", "PROFESSIONAL", "STAFF"];
export const roleLabels: Record<Role, string> = { ADMIN: "Administrador", PROFESSIONAL: "Profissional", STAFF: "Atendente" };

export const permissionGroups: Array<{ label: string; permissions: Array<{ key: Permission; label: string; description: string; defaultRoles: Role[] }> }> = [
  { label: "Acesso às áreas", permissions: [
    { key: "dashboard:access", label: "Painel inicial", description: "Resumo e indicadores da clínica.", defaultRoles: ["ADMIN"] },
    { key: "agenda:access", label: "Agenda", description: "Visualizar agendamentos e horários.", defaultRoles: roles },
    { key: "patients:access", label: "Pacientes", description: "Ver a lista e os cadastros de pacientes.", defaultRoles: roles },
    { key: "procedures:access", label: "Procedimentos", description: "Consultar o catálogo de procedimentos para orientar o atendimento.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
    { key: "stock:access", label: "Estoque", description: "Ver produtos, materiais, lotes e alertas.", defaultRoles: ["ADMIN"] },
    { key: "purchases:access", label: "Compras", description: "Ver compras e pendências de estoque.", defaultRoles: ["ADMIN"] },
    { key: "quotes:access", label: "Orçamentos", description: "Ver e preparar orçamentos de pacientes.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
    { key: "payments:access", label: "Pagamentos", description: "Ver pagamentos e dados financeiros dos pacientes.", defaultRoles: ["ADMIN"] },
    { key: "finance:access", label: "Financeiro", description: "Ver despesas, receitas e relatórios financeiros.", defaultRoles: ["ADMIN"] },
    { key: "reports:access", label: "Relatórios", description: "Acessar relatórios da clínica.", defaultRoles: ["ADMIN"] },
    { key: "settings:access", label: "Configurações", description: "Acessar as configurações permitidas para o cargo.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
  ] },
  { label: "Agendamentos e pacientes", permissions: [
    { key: "agenda:manage", label: "Criar e editar agendamentos", description: "Agendar e alterar horários, pacientes e procedimentos.", defaultRoles: roles },
    { key: "appointments:delete", label: "Excluir agendamentos", description: "Remover agendamentos que ainda podem ser alterados.", defaultRoles: ["ADMIN"] },
    { key: "patients:manage", label: "Criar e editar pacientes", description: "Cadastrar pacientes e atualizar dados básicos.", defaultRoles: roles },
    { key: "patients:delete", label: "Excluir pacientes", description: "Excluir definitivamente cadastros de pacientes.", defaultRoles: ["ADMIN"] },
    { key: "patients:cpf-full", label: "Visualizar CPF completo", description: "Exibir todos os dígitos do CPF nos cadastros e buscas.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
  ] },
  { label: "Dados clínicos", permissions: [
    { key: "clinical:read", label: "Visualizar dados clínicos", description: "Acessar avaliações, fotos, observações e histórico clínico.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
    { key: "clinical:write", label: "Editar dados clínicos", description: "Registrar avaliações, procedimentos e informações clínicas.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
    { key: "anamnesis:read", label: "Visualizar anamnese", description: "Ler respostas e detalhes da anamnese.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
    { key: "anamnesis:write", label: "Editar anamnese", description: "Preencher, concluir e revisar a anamnese.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
    { key: "appointment:run", label: "Conduzir atendimentos", description: "Iniciar e finalizar atendimentos e conferir materiais usados.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
    { key: "clinical:archive", label: "Arquivar documentos e fotos", description: "Arquivar ou restaurar arquivos clínicos.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
    { key: "clinical:delete", label: "Excluir arquivos clínicos", description: "Apagar definitivamente documentos e fotos.", defaultRoles: ["ADMIN"] },
  ] },
  { label: "Gestão e operações", permissions: [
    { key: "procedures:manage", label: "Gerenciar procedimentos", description: "Cadastrar, editar e remover procedimentos e imagens.", defaultRoles: ["ADMIN"] },
    { key: "stock:manage", label: "Gerenciar estoque", description: "Cadastrar itens, movimentar lotes e ajustar saldos.", defaultRoles: ["ADMIN"] },
    { key: "purchases:manage", label: "Gerenciar compras", description: "Registrar compras, entradas e pendências de estoque.", defaultRoles: ["ADMIN"] },
    { key: "quotes:manage", label: "Criar e editar orçamentos", description: "Criar orçamentos e atualizar conteúdo e status.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
    { key: "quote:edit-closed", label: "Alterar orçamentos aprovados ou pagos", description: "Editar conteúdo ou reabrir um orçamento fechado.", defaultRoles: ["ADMIN", "PROFESSIONAL"] },
    { key: "payments:manage", label: "Registrar pagamentos", description: "Lançar e atualizar pagamentos de pacientes.", defaultRoles: ["ADMIN"] },
    { key: "payments:delete", label: "Excluir pagamentos", description: "Remover ou estornar pagamentos registrados.", defaultRoles: ["ADMIN"] },
    { key: "finance:manage", label: "Gerenciar financeiro", description: "Criar, editar e cancelar despesas e recorrências.", defaultRoles: ["ADMIN"] },
    { key: "settings:manage", label: "Alterar configurações da clínica", description: "Editar dados, horários, preferências e notificações.", defaultRoles: ["ADMIN"] },
    { key: "settings:team", label: "Gerenciar equipe", description: "Cadastrar colaboradores e alterar cargos e custos.", defaultRoles: ["ADMIN"] },
    { key: "settings:permissions", label: "Gerenciar permissões por cargo", description: "Alterar esta matriz de acesso.", defaultRoles: ["ADMIN"] },
  ] },
];

const permissionDefinitions = permissionGroups.flatMap((group) => group.permissions);
const allPermissions = permissionDefinitions.map(({ key }) => key);

export function createDefaultRolePermissionMatrix(): RolePermissionMatrix {
  return Object.fromEntries(roles.map((role) => [role, Object.fromEntries(permissionDefinitions.map(({ key, defaultRoles }) => [key, defaultRoles.includes(role)]))])) as RolePermissionMatrix;
}

export function normalizeRolePermissionMatrix(value: unknown): RolePermissionMatrix {
  const matrix = createDefaultRolePermissionMatrix();
  if (!value || typeof value !== "object" || Array.isArray(value)) return matrix;
  for (const role of roles) {
    const roleValue = (value as Record<string, unknown>)[role];
    if (!roleValue || typeof roleValue !== "object" || Array.isArray(roleValue)) continue;
    for (const permission of allPermissions) {
      const enabled = (roleValue as Record<string, unknown>)[permission];
      if (typeof enabled === "boolean") matrix[role][permission] = enabled;
    }
  }
  return matrix;
}

export type PermissionPrincipal = { role: string | null | undefined; isOwner?: boolean; rolePermissions?: unknown };

export function can(role: string | null | undefined, permission: Permission, matrix?: unknown) {
  if (!roles.includes(role as Role)) return false;
  return normalizeRolePermissionMatrix(matrix)[role as Role][permission];
}

export function canForUser(user: PermissionPrincipal, permission: Permission) {
  if (user.isOwner && (permission === "settings:access" || permission === "settings:permissions")) return true;
  return can(user.role, permission, user.rolePermissions);
}

const allSections: SectionId[] = ["dashboard", "agenda", "clientes", "procedimentos", "estoque", "compras", "orcamentos", "pagamentos", "financeiro", "relatorios", "configuracoes"];
const sectionPermission: Record<SectionId, Permission> = {
  dashboard: "dashboard:access", agenda: "agenda:access", clientes: "patients:access", procedimentos: "procedures:access",
  estoque: "stock:access", compras: "purchases:access", orcamentos: "quotes:access", pagamentos: "payments:access",
  financeiro: "finance:access", relatorios: "reports:access", configuracoes: "settings:access",
};

export function visibleSections(role: string | null | undefined, matrix?: unknown, isOwner = false): SectionId[] {
  return allSections.filter((section) => canForUser({ role, rolePermissions: matrix, isOwner }, sectionPermission[section]));
}

export function observationKindsFor(role: string | null | undefined, matrix?: unknown): ObservationKind[] {
  if (can(role, "clinical:read", matrix)) return ["clinical", "administrative"];
  if (roles.includes(role as Role)) return ["administrative"];
  return [];
}

const closedQuoteStatuses = ["Aprovado", "Pago"];

export function quoteChangeAllowed(role: string | null | undefined, change: { current: string; next?: string; editsContent: boolean }, matrix?: unknown) {
  if (!can(role, "quotes:manage", matrix)) return false;
  if (can(role, "quote:edit-closed", matrix)) return true;
  if (!closedQuoteStatuses.includes(change.current)) return true;
  if (change.editsContent) return false;
  if (change.next === undefined || change.next === change.current) return true;
  return change.current === "Aprovado" && change.next === "Pago";
}

export function quoteProfessional(role: string | null | undefined, userName: string, matrix?: unknown) {
  return can(role, "clinical:write", matrix) ? userName : "";
}

export const runningAppointmentStatuses = ["Em atendimento", "Atendido", "Finalizado"] as const;
const staffAppointmentStatuses = ["Agendado", "Faltou", "Cancelado"];

export function appointmentStatusChangeAllowed(role: string | null | undefined, current: string, next: string | undefined, matrix?: unknown) {
  if (can(role, "appointment:run", matrix)) return true;
  if (role !== "STAFF") return false;
  if ((runningAppointmentStatuses as readonly string[]).includes(current)) return false;
  if (next === undefined || next === current) return true;
  return staffAppointmentStatuses.includes(next);
}

export function appointmentDeleteAllowed(role: string | null | undefined, current: string, matrix?: unknown) {
  if (!can(role, "appointments:delete", matrix)) return false;
  if (can(role, "appointment:run", matrix)) return true;
  return role === "STAFF" && !(runningAppointmentStatuses as readonly string[]).includes(current);
}
