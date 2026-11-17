// Resolução dos direitos de acesso de UMA clínica a partir da assinatura dela. Puro (sem Prisma, sem relógio:
// `now` é injetado). A assinatura é a fonte oficial dos direitos; src/lib/auth.ts chama resolveEntitlements ao
// carregar a sessão e src/lib/plan-guards.ts transforma as decisões em respostas HTTP 403.
//
// A autorização final de uma ação é: permissão do usuário (permissions.ts) E recurso do plano (aqui).
// Uma permissão de usuário nunca libera o que o plano não inclui, e o plano nunca libera o que o papel nega.
import {
  FALLBACK_LIMITS, isLimitResource, isPlanId, lowestPlanWith, planCatalog, resolvePlanFeatures, TRIAL_PLAN,
  type Feature, type LimitResource, type PlanId, type PlanLimits,
} from "./plans.ts";

export const subscriptionStatuses = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

// Forma mínima da assinatura da clínica (compatível com o modelo Prisma ClinicSubscription).
export type SubscriptionInput = {
  plan: string | null;
  status: string;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
} | null | undefined;

// Carência de PAST_DUE: dias de acesso completo DEPOIS do vencimento (currentPeriodEnd) antes de virar somente leitura.
export const PAST_DUE_GRACE_DAYS = 7;
const dayMs = 86_400_000;

// full: leitura e escrita. readonly: só leitura (nenhum dado é ocultado nem apagado).
export type AccessMode = "full" | "readonly";
export type AccessReason =
  | "trial"                      // teste grátis em andamento (ou legado sem data de término)
  | "subscription"               // assinatura ativa e dentro do período
  | "canceled_until_period_end"  // cancelada, mas o período pago ainda não acabou: acesso completo até o fim
  | "grace_period"               // vencida (PAST_DUE), dentro dos dias de carência
  | "trial_expired"              // teste terminou sem assinatura
  | "subscription_inactive"      // período terminou, cancelada sem período, em atraso após a carência ou expirada
  | "no_subscription";           // sem registro de assinatura, plano inválido ou status desconhecido (falha fechada)

export type Entitlements = {
  /** Plano cujos recursos valem agora (o Premium durante o teste). null só quando não há assinatura válida. */
  plan: PlanId | null;
  /** Plano contratado de fato (null durante o teste sem plano escolhido). */
  contractedPlan: PlanId | null;
  accessMode: AccessMode;
  reason: AccessReason;
  /** Quando o acesso completo termina (fim do teste, do período pago ou da carência); null = sem fim conhecido ou já somente leitura. */
  accessEndsAt: Date | null;
  features: ReadonlySet<Feature>;
  limits: PlanLimits;
};

// Data opcional vinda do banco: ausente (null/undefined), válida ou inválida. Inválida NUNCA é tratada como "sem fim".
type OptionalDate = { kind: "none" } | { kind: "invalid" } | { kind: "valid"; ms: number };
function optionalDate(value: unknown): OptionalDate {
  if (value === null || value === undefined) return { kind: "none" };
  if (value instanceof Date && Number.isFinite(value.getTime())) return { kind: "valid", ms: value.getTime() };
  return { kind: "invalid" };
}

export function resolveEntitlements(subscription: SubscriptionInput, now: Date): Entitlements {
  if (!subscription) return noSubscription();
  const contractedPlan = isPlanId(subscription.plan) ? subscription.plan : null;
  const nowMs = now.getTime();
  const readonly = (plan: PlanId, reason: AccessReason) => build(plan, contractedPlan, "readonly", reason, null);

  switch (subscription.status) {
    case "TRIALING": {
      // Mesma regra de hoje (auth.ts): sem data de término o teste não expira (legado, sem expiração artificial); com data,
      // expira em `trialEndsAt <= agora`. Data inválida ou `now` inválido contam como teste VENCIDO (falha fechada).
      const end = optionalDate(subscription.trialEndsAt);
      if (end.kind === "none") return build(TRIAL_PLAN, contractedPlan, "full", "trial", null);
      if (end.kind === "valid" && end.ms > nowMs) return build(TRIAL_PLAN, contractedPlan, "full", "trial", new Date(end.ms));
      return readonly(TRIAL_PLAN, "trial_expired");
    }
    case "ACTIVE": {
      // ACTIVE sem plano válido é dado inconsistente: falha fechada em vez de liberar tudo.
      if (!contractedPlan) return noSubscription();
      // Respeita currentPeriodEnd quando existe: depois do vencimento não há escrita. Sem data, vale o status.
      const end = optionalDate(subscription.currentPeriodEnd);
      if (end.kind === "none") return build(contractedPlan, contractedPlan, "full", "subscription", null);
      if (end.kind === "valid" && end.ms > nowMs) return build(contractedPlan, contractedPlan, "full", "subscription", new Date(end.ms));
      return readonly(contractedPlan, "subscription_inactive");
    }
    case "CANCELED": {
      if (!contractedPlan) return noSubscription();
      // Acesso completo até o fim do período pago; sem período conhecido (ou já vencido) não há o que honrar.
      const end = optionalDate(subscription.currentPeriodEnd);
      if (end.kind === "valid" && end.ms > nowMs) return build(contractedPlan, contractedPlan, "full", "canceled_until_period_end", new Date(end.ms));
      return readonly(contractedPlan, "subscription_inactive");
    }
    case "PAST_DUE": {
      if (!contractedPlan) return noSubscription();
      // Carência de PAST_DUE_GRACE_DAYS dias contados do vencimento (currentPeriodEnd); sem vencimento conhecido, falha fechada.
      const end = optionalDate(subscription.currentPeriodEnd);
      if (end.kind === "valid") {
        const graceEndMs = end.ms + PAST_DUE_GRACE_DAYS * dayMs;
        if (graceEndMs > nowMs) return build(contractedPlan, contractedPlan, "full", "grace_period", new Date(graceEndMs));
      }
      return readonly(contractedPlan, "subscription_inactive");
    }
    case "EXPIRED":
      // Somente leitura imediatamente; os recursos do plano continuam visíveis (nada é ocultado).
      return contractedPlan ? readonly(contractedPlan, "subscription_inactive") : noSubscription();
    default:
      return noSubscription(); // status desconhecido
  }
}

function build(plan: PlanId, contractedPlan: PlanId | null, accessMode: AccessMode, reason: AccessReason, accessEndsAt: Date | null): Entitlements {
  return { plan, contractedPlan, accessMode, reason, accessEndsAt, features: resolvePlanFeatures(plan), limits: planCatalog[plan].limits };
}

// Sem assinatura: nenhum recurso de plano e somente leitura. Os dados do núcleo continuam consultáveis.
function noSubscription(): Entitlements {
  return { plan: null, contractedPlan: null, accessMode: "readonly", reason: "no_subscription", accessEndsAt: null, features: new Set(), limits: FALLBACK_LIMITS };
}

export type FeatureOperation = "read" | "write";
export type FeatureDecision =
  | { allowed: true }
  | { allowed: false; code: "PLAN_FEATURE"; feature: Feature; requiredPlan: PlanId | null }
  | { allowed: false; code: "SUBSCRIPTION_READONLY"; feature: Feature };

// A funcionalidade precisa estar no plano; escrever exige ainda acesso completo (teste/assinatura vigente).
export function checkFeature(entitlements: Entitlements, feature: Feature, operation: FeatureOperation = "read"): FeatureDecision {
  if (!entitlements.features.has(feature)) return { allowed: false, code: "PLAN_FEATURE", feature, requiredPlan: lowestPlanWith(feature) };
  if (operation === "write" && entitlements.accessMode !== "full") return { allowed: false, code: "SUBSCRIPTION_READONLY", feature };
  return { allowed: true };
}

// Escrita em dados do núcleo (sem funcionalidade de plano): só depende do modo de acesso.
export function canWriteCore(entitlements: Entitlements) {
  return entitlements.accessMode === "full";
}

export type LimitDecision =
  | { allowed: true; limit: number | null; used: number; remaining: number | null }
  | { allowed: false; code: "PLAN_LIMIT" | "SUBSCRIPTION_READONLY"; resource: LimitResource; limit: number | null; used: number; remaining: 0 };

// Erros de CHAMADA (recurso desconhecido, contador quebrado, quantidade inválida) lançam em vez de decidir: um contador
// corrompido ou um recurso mal digitado nunca pode virar "permitido" em silêncio. Na rota isso vira 500 (falha fechada).
function validUsed(used: number) {
  if (!Number.isInteger(used) || used < 0) throw new TypeError("Uso inválido: esperado inteiro >= 0.");
  return used;
}
function validResource(resource: unknown): LimitResource {
  if (!isLimitResource(resource)) throw new TypeError("Recurso de limite desconhecido.");
  return resource;
}

// Pode ADICIONAR `adding` (>= 1) itens? `used` já inclui reservas (ex.: convites pendentes). Excedido por downgrade
// (used > limit) só impede novos cadastros; nada aqui remove ou esconde registros existentes. Somente leitura também impede adicionar.
export function checkLimit(entitlements: Entitlements, resource: LimitResource, used: number, adding = 1): LimitDecision {
  const key = validResource(resource);
  const safeUsed = validUsed(used);
  if (!Number.isInteger(adding) || adding < 1) throw new TypeError("Quantidade inválida: esperado inteiro >= 1.");
  const limit = entitlements.limits[key];
  if (entitlements.accessMode !== "full") return { allowed: false, code: "SUBSCRIPTION_READONLY", resource: key, limit, used: safeUsed, remaining: 0 };
  if (limit === null) return { allowed: true, limit, used: safeUsed, remaining: null };
  if (safeUsed + adding > limit) return { allowed: false, code: "PLAN_LIMIT", resource: key, limit, used: safeUsed, remaining: 0 };
  return { allowed: true, limit, used: safeUsed, remaining: limit - safeUsed - adding };
}

// Situação de uso para a interface (barra de uso e avisos); não decide nada de segurança.
export type LimitStatus = { resource: LimitResource; limit: number | null; used: number; level: "ok" | "near" | "reached" | "exceeded" };
export const NEAR_LIMIT_RATIO = 0.8;

export function limitStatus(entitlements: Entitlements, resource: LimitResource, used: number): LimitStatus {
  const key = validResource(resource);
  const safeUsed = validUsed(used);
  const limit = entitlements.limits[key];
  if (limit === null) return { resource: key, limit, used: safeUsed, level: "ok" };
  const level = safeUsed > limit ? "exceeded" : safeUsed === limit ? "reached" : safeUsed >= limit * NEAR_LIMIT_RATIO ? "near" : "ok";
  return { resource: key, limit, used: safeUsed, level };
}

// Resumo serializável para o cliente (/api/auth/me): só informa; a decisão de segurança é SEMPRE do servidor.
export type PublicAccess = {
  mode: AccessMode;
  reason: AccessReason;
  plan: PlanId | null;
  contractedPlan: PlanId | null;
  accessEndsAt: string | null;
  features: Feature[];
  limits: PlanLimits;
};

export function serializeAccess(entitlements: Entitlements): PublicAccess {
  return {
    mode: entitlements.accessMode,
    reason: entitlements.reason,
    plan: entitlements.plan,
    contractedPlan: entitlements.contractedPlan,
    accessEndsAt: entitlements.accessEndsAt ? entitlements.accessEndsAt.toISOString() : null,
    features: [...entitlements.features].sort(),
    limits: { ...entitlements.limits },
  };
}
