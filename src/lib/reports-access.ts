// O que o usuário pode ver nos Relatórios (puro, sem banco).
// - reports:access libera a página; receita/despesas exigem finance:access, orçamentos quotes:access, estoque stock:access.
// - PROFESSIONAL (filtro forçado) nunca vê o financeiro, mesmo com finance:access: receita e despesas são da clínica, não dele.
// - PROFESSIONAL vê só os próprios atendimentos: o filtro de profissional é forçado pelo nome do usuário e o
//   parâmetro da query é ignorado. ADMIN (e qualquer outro papel com reports:access) pode filtrar por nome.
import { cleanProfessionalName } from "./appointment-conflict-rules.ts";
import { canForUser, type PermissionPrincipal } from "./permissions.ts";

export type ReportUser = PermissionPrincipal & { name: string };
export type ReportAccess = {
  allowed: boolean;
  capabilities: { finance: boolean; quotes: boolean; stock: boolean };
  forcedProfessional: string | null;
  canChooseProfessional: boolean;
};

export function resolveReportAccess(user: ReportUser): ReportAccess {
  const isProfessional = user.role === "PROFESSIONAL";
  const ownName = isProfessional ? cleanProfessionalName(user.name) : "";
  const forcedProfessional = ownName && isValidProfessionalParam(ownName) ? ownName : null;
  // Falha fechada: PROFESSIONAL sem nome utilizável não teria escopo para restringir, então não acessa os relatórios.
  if (isProfessional && !forcedProfessional) {
    return { allowed: false, capabilities: { finance: false, quotes: false, stock: false }, forcedProfessional: null, canChooseProfessional: false };
  }
  const allowed = canForUser(user, "reports:access");
  return {
    allowed,
    capabilities: {
      finance: allowed && !forcedProfessional && canForUser(user, "finance:access"),
      quotes: allowed && canForUser(user, "quotes:access"),
      stock: allowed && canForUser(user, "stock:access"),
    },
    forcedProfessional: allowed ? forcedProfessional : null,
    canChooseProfessional: allowed && !isProfessional,
  };
}

// Profissional efetivamente aplicado: o forçado (PROFESSIONAL) ou, para quem pode escolher, o pedido na query (vazio = todos).
export function appliedProfessional(access: ReportAccess, requested: string | null | undefined) {
  if (access.forcedProfessional) return access.forcedProfessional;
  if (!access.canChooseProfessional) return null;
  // Mesma normalização da gravação do agendamento (cleanProfessionalName), para o filtro casar com o nome gravado.
  const name = cleanProfessionalName(requested);
  return name || null;
}

// Parâmetro professional válido: até 120 caracteres e sem caracteres de controle (NUL quebraria a consulta).
export function isValidProfessionalParam(value: string | null | undefined) {
  return value === null || value === undefined || (value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value));
}
