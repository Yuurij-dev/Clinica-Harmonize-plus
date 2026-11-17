// Proteções de API por plano/assinatura: devolvem a Response 403 pronta (ou null quando pode seguir), no mesmo estilo de
// denyUnless (api-guards.ts). A autorização final é permissão do papel (denyUnless) E recurso do plano (aqui).
// Todos respondem 403 com `code` (PLAN_FEATURE, PLAN_LIMIT, SUBSCRIPTION_READONLY), NUNCA 401: bloqueio comercial não é
// sessão inválida e não pode provocar logout. A fonte dos direitos é `user.entitlements`, calculado em auth.ts.
import { canWriteCore, checkFeature, checkLimit, type Entitlements, type FeatureOperation } from "./entitlements.ts";
import { planErrorBodyFromDecision, readonlyErrorBody, type PlanErrorBody } from "./plan-errors.ts";
import type { Feature, LimitResource } from "./plans.ts";

export type EntitledPrincipal = { entitlements: Entitlements };

// A clinica tem o recurso no plano (leitura de dados/respostas). Nao decide escrita: para isso use denyUnlessFeature(..., "write").
export function hasFeature(user: EntitledPrincipal, feature: Feature) {
  return user.entitlements.features.has(feature);
}

function planResponse(body: PlanErrorBody) {
  return Response.json(body, { status: 403, headers: { "Cache-Control": "private, no-store" } });
}

// Toda escrita (criar/editar/excluir) em dado da clínica: bloqueada em somente leitura. Leitura (GET) nunca chama isto.
export function denyIfReadonly(user: EntitledPrincipal) {
  return canWriteCore(user.entitlements) ? null : planResponse(readonlyErrorBody());
}

// Recurso restrito por plano. `operation` "write" também exige acesso completo (não somente leitura).
export function denyUnlessFeature(user: EntitledPrincipal, feature: Feature, operation: FeatureOperation = "read") {
  const body = planErrorBodyFromDecision(checkFeature(user.entitlements, feature, operation));
  return body ? planResponse(body) : null;
}

// Pode adicionar `adding` itens? `used` já inclui reservas (ex.: convites pendentes). Lança em entrada inválida (vira 500: falha fechada).
export function denyIfOverLimit(user: EntitledPrincipal, resource: LimitResource, used: number, adding = 1) {
  const body = planErrorBodyFromDecision(checkLimit(user.entitlements, resource, used, adding));
  return body ? planResponse(body) : null;
}

// Resposta 403 para um erro comercial já montado (ex.: PLAN_LIMIT devolvido por reserveCapacity dentro de uma transação).
export function planErrorResponse(body: PlanErrorBody) {
  return planResponse(body);
}
