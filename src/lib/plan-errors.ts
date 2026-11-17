// Erros comerciais (plano/assinatura) como dados: corpo JSON das respostas HTTP 403 e leitura no cliente.
// Puro e seguro para o bundle do cliente (sem next/server, sem Prisma). Quem monta a Response é plan-guards.ts.
//
// Contrato: bloqueio comercial é SEMPRE 403 com `code`. Nunca 401: 401 significa sessão inválida e o app volta ao login.
import type { FeatureDecision, LimitDecision } from "./entitlements.ts";
import { isFeature, isLimitResource, isPlanId, type Feature, type LimitResource, type PlanId } from "./plans.ts";

export const PLAN_ERROR_CODES = ["PLAN_FEATURE", "PLAN_LIMIT", "SUBSCRIPTION_READONLY"] as const;
export type PlanErrorCode = (typeof PLAN_ERROR_CODES)[number];

export function isPlanErrorCode(value: unknown): value is PlanErrorCode {
  return typeof value === "string" && (PLAN_ERROR_CODES as readonly string[]).includes(value);
}

export type PlanErrorBody = {
  code: PlanErrorCode;
  message: string;
  feature?: Feature;
  requiredPlan?: PlanId | null;
  resource?: LimitResource;
  limit?: number | null;
  used?: number;
};

export const READONLY_MESSAGE = "Seu acesso está em modo somente leitura. Você pode consultar seus dados, mas é preciso contratar um plano para criar, editar ou excluir.";
export const FEATURE_MESSAGE = "Este recurso não está incluído no plano atual da clínica.";
const limitLabels: Record<LimitResource, string> = { professionals: "profissionais", patients: "pacientes" };

export function readonlyErrorBody(feature?: Feature): PlanErrorBody {
  return { code: "SUBSCRIPTION_READONLY", message: READONLY_MESSAGE, ...(feature ? { feature } : {}) };
}

export function featureErrorBody(feature: Feature, requiredPlan: PlanId | null): PlanErrorBody {
  return { code: "PLAN_FEATURE", message: FEATURE_MESSAGE, feature, requiredPlan };
}

export function limitErrorBody(resource: LimitResource, limit: number | null, used: number): PlanErrorBody {
  const label = limitLabels[resource];
  const message = limit === null ? `Não é possível adicionar ${label} no momento.` : `O plano atual permite até ${limit} ${label}. Para adicionar mais, faça upgrade do plano.`;
  return { code: "PLAN_LIMIT", message, resource, limit, used };
}

// Decisão negada de checkFeature/checkLimit -> corpo do erro. Decisão permitida não gera erro (null).
export function planErrorBodyFromDecision(decision: FeatureDecision | LimitDecision): PlanErrorBody | null {
  if (decision.allowed) return null;
  if (decision.code === "SUBSCRIPTION_READONLY") return readonlyErrorBody("feature" in decision ? decision.feature : undefined);
  if (decision.code === "PLAN_FEATURE") return featureErrorBody(decision.feature, decision.requiredPlan);
  return limitErrorBody(decision.resource, decision.limit, decision.used);
}

// Cliente: lê o corpo de uma resposta 403 e devolve o erro comercial, ou null se não for um (ex.: 403 de permissão do papel).
// Valida tudo (o corpo vem da rede) e nunca lança.
export function parsePlanErrorBody(value: unknown): PlanErrorBody | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!isPlanErrorCode(body.code)) return null;
  const parsed: PlanErrorBody = { code: body.code, message: typeof body.message === "string" && body.message ? body.message : READONLY_MESSAGE };
  if (isFeature(body.feature)) parsed.feature = body.feature;
  if (body.requiredPlan === null || isPlanId(body.requiredPlan)) parsed.requiredPlan = body.requiredPlan;
  if (isLimitResource(body.resource)) parsed.resource = body.resource;
  if (body.limit === null || (typeof body.limit === "number" && Number.isFinite(body.limit))) parsed.limit = body.limit;
  if (typeof body.used === "number" && Number.isFinite(body.used)) parsed.used = body.used;
  return parsed;
}

// Para quem ainda NÃO é membro (aceite de convite e registro por convite): só diz que a clínica não pode adicionar
// profissionais agora. Não revela teto do plano, tamanho da equipe, convites em aberto nem situação da assinatura
// (nem se o bloqueio é por limite ou por somente leitura). O administrador autenticado continua vendo o detalhe.
export const INVITEE_LIMIT_MESSAGE = "Esta clínica não pode adicionar novos membros no momento. Peça ao administrador da clínica para liberar uma vaga ou regularizar o plano.";
export function inviteeLimitBody(): PlanErrorBody {
  return { code: "PLAN_LIMIT", message: INVITEE_LIMIT_MESSAGE };
}
