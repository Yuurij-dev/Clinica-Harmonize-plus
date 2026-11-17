// Consumo e capacidade por clínica (servidor). Única implementação dos limites quantitativos: toda rota/fluxo que cria
// profissional ou paciente chama `reserveCapacity` DENTRO da mesma transação que grava, e as regras (limites por plano,
// somente leitura) vêm de entitlements.ts/plans.ts. Sem singleton do Prisma: recebe o cliente/transação (testável no banco local).
//
// Concorrência: `reserveCapacity` toma um advisory lock transacional por (recurso, clínica) ANTES de contar. Duas
// requisições da mesma clínica disputando a última vaga se serializam; a segunda conta já com o commit da primeira
// (READ COMMITTED enxerga a linha nova) e recebe PLAN_LIMIT. Clínicas diferentes nunca se bloqueiam.
// Os planos são lidos AQUI, do banco, na transação: o limite vale na hora (o cache de autenticação de 15 s não interfere).
import type { Prisma } from "@prisma/client";
import { checkLimit, resolveEntitlements, type Entitlements } from "./entitlements.ts";
import { planErrorBodyFromDecision, type PlanErrorBody } from "./plan-errors.ts";
import { professionalRoles, type Feature, type LimitResource } from "./plans.ts";

export type PlanDb = Prisma.TransactionClient;

export type CapacityResult = { ok: true } | { ok: false; body: PlanErrorBody };

// Chave do lock: a mesma em TODOS os caminhos que consomem o recurso (convite, aceite, cargo, cadastro direto, paciente).
export function planLockKey(resource: LimitResource, clinicId: string) {
  return `plan:${resource}:${clinicId}`;
}

export async function lockPlanResource(db: PlanDb, clinicId: string, resource: LimitResource) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${planLockKey(resource, clinicId)}, 0))`;
}

// Direitos da clínica a partir da assinatura gravada (fonte oficial). Sem assinatura: falha fechada (somente leitura).
export async function loadClinicEntitlements(db: PlanDb, clinicId: string, now: Date = new Date()): Promise<Entitlements> {
  const subscription = await db.clinicSubscription.findUnique({
    where: { clinicId },
    select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
  });
  return resolveEntitlements(subscription, now);
}

// A clínica tem o recurso no plano (leitura da assinatura no banco: serve a rotinas sem sessão, como fila e cron).
export async function clinicHasFeature(db: PlanDb, clinicId: string, feature: Feature, now: Date = new Date()) {
  return (await loadClinicEntitlements(db, clinicId, now)).features.has(feature);
}

// Dentre `clinicIds`, quem NÃO tem o recurso (uma consulta só). Clínica sem assinatura conta como sem recurso (falha fechada).
export async function clinicsWithoutFeature(db: PlanDb, clinicIds: readonly string[], feature: Feature, now: Date = new Date()) {
  if (!clinicIds.length) return [];
  const rows = await db.clinicSubscription.findMany({
    where: { clinicId: { in: [...clinicIds] } },
    select: { clinicId: true, plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
  });
  const entitled = new Set(rows.filter((row) => resolveEntitlements(row, now).features.has(feature)).map((row) => row.clinicId));
  return clinicIds.filter((id) => !entitled.has(id));
}

// Como clinicHasFeature, mas também exige acesso COMPLETO (não somente leitura): usado pela fila/cron do Google Agenda,
// cuja sincronização é uma escrita de fato (cria/move eventos de terceiros). Diferente de denyIfReadonly (sessão/rota), aqui
// não há sessão: a assinatura é lida direto do banco a cada ciclo, então o acesso completo volta a valer sem esperar o
// cache de 15 s. Teste vencido/assinatura inadimplente/cancelada sem período: a fila fica parada, mas os jobs não são
// tocados (nem FAILED, nem tentativa consumida) e voltam a processar quando o acesso completo é restabelecido.
export async function clinicCanSyncCalendar(db: PlanDb, clinicId: string, now: Date = new Date()) {
  const entitlements = await loadClinicEntitlements(db, clinicId, now);
  return entitlements.accessMode === "full" && entitlements.features.has("googleCalendar");
}

// Dentre `clinicIds`, quem NÃO pode sincronizar agora (sem o recurso OU em somente leitura). Clínica sem assinatura
// conta como bloqueada (falha fechada).
export async function clinicsBlockedForCalendarSync(db: PlanDb, clinicIds: readonly string[], now: Date = new Date()) {
  if (!clinicIds.length) return [];
  const rows = await db.clinicSubscription.findMany({
    where: { clinicId: { in: [...clinicIds] } },
    select: { clinicId: true, plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
  });
  const allowed = new Set(rows.filter((row) => {
    const entitlements = resolveEntitlements(row, now);
    return entitlements.accessMode === "full" && entitlements.features.has("googleCalendar");
  }).map((row) => row.clinicId));
  return clinicIds.filter((id) => !allowed.has(id));
}

// Todos os pacientes da clínica contam (ainda não existe arquivamento).
export async function countPatients(db: PlanDb, clinicId: string) {
  return db.patient.count({ where: { clinicId } });
}

// Vagas de profissional em uso: membros ADMIN e PROFESSIONAL (STAFF não conta) + convites PENDENTES e não vencidos desses
// cargos (reservam vaga). `excludeInvitationId` evita contar duas vezes o convite que está sendo aceito: ele sai de
// "pendente" e vira membro na mesma transação, então o consumo líquido não muda.
export async function countProfessionalSlots(db: PlanDb, clinicId: string, options: { now?: Date; excludeInvitationId?: string } = {}) {
  const now = options.now ?? new Date();
  const roles = [...professionalRoles];
  const [members, pending] = await Promise.all([
    db.clinicMembership.count({ where: { clinicId, role: { in: roles } } }),
    db.clinicInvitation.count({
      where: { clinicId, status: "PENDING", expiresAt: { gt: now }, role: { in: roles }, ...(options.excludeInvitationId ? { id: { not: options.excludeInvitationId } } : {}) },
    }),
  ]);
  return members + pending;
}

export async function usedFor(db: PlanDb, clinicId: string, resource: LimitResource, options: { now?: Date; excludeInvitationId?: string } = {}) {
  return resource === "patients" ? countPatients(db, clinicId) : countProfessionalSlots(db, clinicId, options);
}

// Reserva de capacidade: trava por clínica+recurso, conta e decide. DEVE rodar na mesma transação que cria o registro
// (a trava só vale até o fim da transação). `adding` é a quantidade que será criada (>= 1).
export async function reserveCapacity(
  db: PlanDb,
  clinicId: string,
  resource: LimitResource,
  options: { adding?: number; now?: Date; excludeInvitationId?: string } = {},
): Promise<CapacityResult> {
  const now = options.now ?? new Date();
  // Atalho: recurso SEM limite e acesso completo = nao ha corrida a proteger, entao nao trava nem conta (cadastro de paciente
  // em Pro/Premium nao se serializa). Uma troca de plano exatamente neste instante vale a partir do proximo cadastro.
  const early = await loadClinicEntitlements(db, clinicId, now);
  if (early.accessMode === "full" && early.limits[resource] === null) return { ok: true };
  await lockPlanResource(db, clinicId, resource);
  // Com a trava tomada, le de novo: a decisao vale para o estado atual da assinatura.
  const entitlements = await loadClinicEntitlements(db, clinicId, now);
  const used = await usedFor(db, clinicId, resource, { now, excludeInvitationId: options.excludeInvitationId });
  const body = planErrorBodyFromDecision(checkLimit(entitlements, resource, used, options.adding ?? 1));
  return body ? { ok: false, body } : { ok: true };
}
