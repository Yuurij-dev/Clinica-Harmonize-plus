// Catálogo comercial do Harmonize+: planos, funcionalidades restritas, limites e dependências.
// Puro (sem Prisma, sem rede, sem Date.now): carregável por node:test e seguro para o bundle do cliente.
// É a ÚNICA fonte da verdade dos direitos de cada plano; o banco guarda só plano + status + datas
// (ver entitlements.ts) e a apresentação (nomes, preços, textos) vive em src/data/plans.ts.
//
// Só entram aqui as funcionalidades RESTRITAS por plano. O que não está listado (agenda, pacientes, prontuário,
// anamnese, termos, avaliações, procedimentos, orçamentos e PDFs, registro de pagamentos, 2FA...) é núcleo e
// existe em todos os planos. Preços, periodicidade e franquia de armazenamento NÃO estão definidos: não inventar.

export const planIds = ["start", "pro", "premium"] as const;
export type PlanId = (typeof planIds)[number];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (planIds as readonly string[]).includes(value);
}

export const features = [
  "stock",              // módulo de estoque: produtos, lotes, validade, movimentações, baixa automática de materiais
  "purchases",          // compras e fornecedores
  "finance",            // financeiro completo: despesas, recorrências, contas, movimentações e fluxo de caixa
  "technicalSheet",     // ficha técnica de procedimentos (materiais por procedimento)
  "costs",              // custos da clínica, margens e indicadores (independente da ficha técnica de materiais)
  "reports",            // página de Relatórios: relatórios por área
  "reportsExport",      // exportações individuais (PDF, CSV e Excel)
  "reportsAdvanced",    // visão geral com insights
  "reportsConsolidated",// exportação consolidada (Excel/PDF com todas as áreas)
  "rolePermissions",    // edição da matriz de permissões por cargo
  "agendaAutomations",  // automações da agenda (faltas, conclusão e avanço de jornada)
  "emailNotifications", // e-mails automáticos ao paciente e ao profissional
  "googleCalendar",     // integração com o Google Agenda
  "multiClinic",        // usuário em mais de uma clínica (a assinatura da clínica de destino é que vale)
] as const;
export type Feature = (typeof features)[number];

export function isFeature(value: unknown): value is Feature {
  return typeof value === "string" && (features as readonly string[]).includes(value);
}

// Uma funcionalidade só vale se TODAS as suas dependências também valerem no plano (resolvido em entitlements.ts).
// `costs` não depende de `stock`: mão de obra e estrutura existem sem materiais. Só `technicalSheet` precisa de produtos.
export const featureDependencies: Readonly<Record<Feature, readonly Feature[]>> = Object.freeze({
  stock: [],
  purchases: ["stock", "finance"], // compra cria lote (estoque) e despesa por parcela (financeiro)
  finance: [],
  technicalSheet: ["stock"],       // ProcedureMaterial referencia Product
  costs: [],
  reports: [],
  reportsExport: ["reports"],
  reportsAdvanced: ["reports"],
  reportsConsolidated: ["reportsAdvanced", "reportsExport"],
  rolePermissions: [],
  agendaAutomations: [],
  emailNotifications: [],
  googleCalendar: [],
  multiClinic: [],
});

// Limites quantitativos. `null` = sem limite comercial. Armazenamento ainda não definido: de propósito, não há chave.
export const limitResources = ["professionals", "patients"] as const;
export type LimitResource = (typeof limitResources)[number];
export type PlanLimits = Readonly<Record<LimitResource, number | null>>;

export type PlanDefinition = { id: PlanId; features: readonly Feature[]; limits: PlanLimits };

const startFeatures: readonly Feature[] = [];
const proFeatures: readonly Feature[] = [
  ...startFeatures,
  "stock", "purchases", "finance", "technicalSheet", "costs",
  "reports", "reportsExport", "rolePermissions", "agendaAutomations", "emailNotifications",
];
const premiumFeatures: readonly Feature[] = [...proFeatures, "reportsAdvanced", "reportsConsolidated", "googleCalendar", "multiClinic"];

// Congelado em tempo de execução (não só no tipo): nenhum consumidor consegue alterar o catálogo compartilhado.
export const planCatalog: Readonly<Record<PlanId, PlanDefinition>> = Object.freeze({
  start: Object.freeze({ id: "start", features: Object.freeze([...startFeatures]), limits: Object.freeze({ professionals: 2, patients: 100 }) }),
  pro: Object.freeze({ id: "pro", features: Object.freeze([...proFeatures]), limits: Object.freeze({ professionals: 5, patients: null }) }),
  premium: Object.freeze({ id: "premium", features: Object.freeze([...premiumFeatures]), limits: Object.freeze({ professionals: null, patients: null }) }),
} as const);

// Plano mais restritivo; usado onde não há plano válido (nunca se herda "sem limite" de uma clínica sem assinatura).
export const FALLBACK_LIMITS: PlanLimits = planCatalog.start.limits;

export function isLimitResource(value: unknown): value is LimitResource {
  return typeof value === "string" && (limitResources as readonly string[]).includes(value);
}

// Durante o teste grátis a clínica tem o plano mais completo.
export const TRIAL_PLAN: PlanId = "premium";

// Quem conta para o limite de profissionais: ADMIN e PROFESSIONAL (STAFF não). Convites pendentes dessas funções reservam vaga.
export const professionalRoles = ["ADMIN", "PROFESSIONAL"] as const;
export function countsAsProfessional(role: string | null | undefined) {
  return (professionalRoles as readonly string[]).includes(role ?? "");
}

// Menor plano que inclui a funcionalidade (para "disponível a partir do plano X"); null se nenhum plano a inclui.
export function lowestPlanWith(feature: Feature): PlanId | null {
  for (const id of planIds) {
    if (resolvePlanFeatures(id).has(feature)) return id;
  }
  return null;
}

// Remove as funcionalidades cujas dependências não estão no conjunto (ponto fixo: repete até estabilizar, então a
// remoção se propaga: sem `stock` saem `technicalSheet` e `purchases`).
export function applyDependencies(selected: Iterable<Feature>): Set<Feature> {
  const enabled = new Set<Feature>(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const feature of [...enabled]) {
      // Chave desconhecida (ou de protótipo, como "constructor") nunca fica habilitada.
      const dependencies = isFeature(feature) ? featureDependencies[feature] : null;
      if (!dependencies || dependencies.some((dependency) => !enabled.has(dependency))) {
        enabled.delete(feature);
        changed = true;
      }
    }
  }
  return enabled;
}

// Conjunto efetivo de funcionalidades do plano, já aplicando as dependências.
export function resolvePlanFeatures(plan: PlanId): ReadonlySet<Feature> {
  return isPlanId(plan) ? applyDependencies(planCatalog[plan].features) : new Set<Feature>();
}
