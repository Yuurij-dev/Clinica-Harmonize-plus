// O que o usuário pode ver nos Relatórios (puro, sem banco).
// - reports:access libera a página; receita/despesas exigem finance:access, orçamentos quotes:access, estoque stock:access.
// - PROFESSIONAL (filtro forçado) nunca vê o financeiro, mesmo com finance:access: receita e despesas são da clínica, não dele.
// - PROFESSIONAL vê só os próprios atendimentos: o filtro de profissional é forçado pelo nome do usuário e o
//   parâmetro da query é ignorado. ADMIN (e qualquer outro papel com reports:access) pode filtrar por nome.
import { cleanProfessionalName } from "./appointment-conflict-rules.ts";
import { canForUser, type PermissionPrincipal } from "./permissions.ts";
import type { Feature } from "./plans.ts";
import type { ReportKind } from "./reports-document.ts";

// `features` (opcional) = recursos do plano da clinica; ausente = sem restricao de plano (usado por testes puros).
export type ReportUser = PermissionPrincipal & { name: string; features?: ReadonlySet<string> };
export type ReportAccess = {
  allowed: boolean;
  /** Papel E plano: o que realmente pode ser aberto/exportado (alimenta allowedReportIds). */
  capabilities: { finance: boolean; quotes: boolean; stock: boolean };
  /** So o papel (sem plano): a rota checa o papel antes do plano, entao o erro comercial nunca aparece para quem nao tem o papel. */
  roleCapabilities: { finance: boolean; quotes: boolean; stock: boolean };
  forcedProfessional: string | null;
  canChooseProfessional: boolean;
  /** Custos derivados de estoque/ficha tecnica nao saem (PROFESSIONAL ou clinica sem o recurso stock). */
  costsHidden: boolean;
};

export function resolveReportAccess(user: ReportUser): ReportAccess {
  const isProfessional = user.role === "PROFESSIONAL";
  const ownName = isProfessional ? cleanProfessionalName(user.name) : "";
  const forcedProfessional = ownName && isValidProfessionalParam(ownName) ? ownName : null;
  // Falha fechada: PROFESSIONAL sem nome utilizável não teria escopo para restringir, então não acessa os relatórios.
  if (isProfessional && !forcedProfessional) {
    const none = { finance: false, quotes: false, stock: false };
    return { allowed: false, capabilities: none, roleCapabilities: none, forcedProfessional: null, canChooseProfessional: false, costsHidden: true };
  }
  const allowed = canForUser(user, "reports:access");
  const hasStock = user.features ? user.features.has("stock") : true;
  const hasFinance = user.features ? user.features.has("finance") : true;
  const roleCapabilities = {
    finance: allowed && !forcedProfessional && canForUser(user, "finance:access"),
    quotes: allowed && canForUser(user, "quotes:access"),
    stock: allowed && canForUser(user, "stock:access"),
  };
  return {
    allowed,
    capabilities: { finance: roleCapabilities.finance && hasFinance, quotes: roleCapabilities.quotes, stock: roleCapabilities.stock && hasStock },
    roleCapabilities,
    forcedProfessional: allowed ? forcedProfessional : null,
    canChooseProfessional: allowed && !isProfessional,
    costsHidden: !allowed || Boolean(forcedProfessional) || !hasStock,
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

// Custos derivados de estoque ocultos? Escopo de profissional OU clinica sem o recurso stock. O escopo e checado tambem aqui
// (nao so em costsHidden) para contextos montados/alterados depois de resolveReportAccess continuarem fail-closed.
export function costsAreHidden(access: Pick<ReportAccess, "forcedProfessional"> & { costsHidden?: boolean }) {
  return Boolean(access.forcedProfessional) || Boolean(access.costsHidden);
}

// Recursos do plano que cada relatorio exige, na ordem em que o 403 PLAN_FEATURE deve citar o primeiro que faltar.
// `reports` vale para tudo (Start nao tem a pagina); visao geral = reportsAdvanced; consolidado = reportsConsolidated;
// financeiro e estoque exigem o proprio modulo; exportar (xlsx/csv/pdf) exige reportsExport. A regra comercial de cada
// recurso (quem tem o que) fica em plans.ts; aqui so o mapeamento relatorio -> recurso.
export function reportFeaturesRequired(kind: ReportKind | null, options: { exporting?: boolean } = {}): Feature[] {
  const required: Feature[] = ["reports"];
  if (options.exporting) required.push("reportsExport");
  if (kind === "overview") required.push("reportsAdvanced");
  else if (kind === "all") required.push("reportsConsolidated");
  else if (kind === "finance") required.push("finance");
  else if (kind === "stock") required.push("stock");
  return required;
}

// Primeiro recurso que a clinica nao tem para o relatorio (null = liberado). `features` ausente = sem restricao de plano.
export function missingReportFeature(features: ReadonlySet<string> | undefined, kind: ReportKind | null, options: { exporting?: boolean } = {}): Feature | null {
  if (!features) return null;
  return reportFeaturesRequired(kind, options).find((feature) => !features.has(feature)) ?? null;
}
