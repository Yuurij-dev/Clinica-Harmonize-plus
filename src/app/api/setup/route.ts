import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { prisma } from "@/lib/prisma";
import { loadSetupSnapshot } from "@/lib/setup-snapshot";
import { SETUP_FIRST_STEP, canDecide, evaluateSetup, isSetupStatus, isSetupStepKey, parseSetupDecisions, type SetupStatus, type SetupStepKey } from "@/lib/setup-rules";

type SetupRow = { status: string; currentStep: string; decisions: Prisma.JsonValue; };

const setupSelect = { status: true, currentStep: true, decisions: true } as const;

async function buildPayload(clinicId: string) {
  const [row, snapshot] = await Promise.all([
    prisma.clinicSetup.findUnique({ where: { clinicId }, select: setupSelect }),
    loadSetupSnapshot(clinicId),
  ]);
  if (!snapshot) return null;
  return payloadFrom(row, snapshot);
}

function payloadFrom(row: SetupRow | null, snapshot: NonNullable<Awaited<ReturnType<typeof loadSetupSnapshot>>>) {
  const status: SetupStatus = row && isSetupStatus(row.status) ? row.status : "pending";
  const currentStep: SetupStepKey = row && isSetupStepKey(row.currentStep) ? row.currentStep : SETUP_FIRST_STEP;
  const evaluation = evaluateSetup(snapshot, parseSetupDecisions(row?.decisions), status === "completed");
  return {
    status,
    currentStep,
    ...evaluation,
    summary: {
      clinicName: snapshot.name,
      clinicFields: { name: Boolean(snapshot.name.trim()), phone: Boolean(snapshot.phone?.trim()), address: Boolean(snapshot.address?.trim()) },
      professionals: snapshot.professionalCount,
      pendingInvitations: snapshot.pendingInvitations,
      procedures: snapshot.procedureCount,
      materials: snapshot.materialCount,
      products: snapshot.productCount,
      recurringExpenses: snapshot.recurringExpenseCount,
      hours: { opening: snapshot.openingTime, closing: snapshot.closingTime, professionalOpening: snapshot.professionalOpeningTime, professionalClosing: snapshot.professionalClosingTime },
      alerts: {
        appointments: snapshot.appointmentNotificationsEnabled,
        sound: snapshot.appointmentNotificationSoundEnabled,
        stock: snapshot.stockNotificationsEnabled,
        expiryWarningDays: snapshot.expiryWarningDays,
      },
    },
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user, "settings:manage");
  if (denied) return denied;
  const payload = await buildPayload(user.clinicId);
  if (!payload) return NextResponse.json({ message: "Clínica não encontrada." }, { status: 404 });
  return NextResponse.json(payload);
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user, "settings:manage");
  if (denied) return denied;

  const body = await request.json().catch(() => null) as { action?: unknown; step?: unknown; decision?: unknown } | null;
  const action = body?.action;
  const clinicId = user.clinicId; // sempre da sessão; o corpo nunca traz clínica
  const invalid = (message: string) => NextResponse.json({ message }, { status: 400 });

  const [row, snapshot] = await Promise.all([
    prisma.clinicSetup.findUnique({ where: { clinicId }, select: setupSelect }),
    loadSetupSnapshot(clinicId),
  ]);
  if (!snapshot) return NextResponse.json({ message: "Clínica não encontrada." }, { status: 404 });

  const now = new Date();
  const completed = row?.status === "completed";
  const decisions = parseSetupDecisions(row?.decisions);
  let data: Prisma.ClinicSetupUpdateInput | null = null;

  if (action === "start") {
    // Rever depois de concluído não reabre o assistente.
    if (!completed) data = { status: "in_progress", startedAt: now, dismissedAt: null };
  } else if (action === "dismiss") {
    if (!completed) data = { status: "dismissed", dismissedAt: now };
  } else if (action === "goto") {
    if (!isSetupStepKey(body?.step)) return invalid("Etapa inválida.");
    data = { currentStep: body.step };
  } else if (action === "decide") {
    const step = body?.step;
    const decision = body?.decision;
    if (!canDecide(step, decision)) return invalid("Esta decisão não é permitida para a etapa.");
    decisions[step as SetupStepKey] = { decision: decision as "confirmed" | "skipped", by: user.id, at: now.toISOString() };
    data = { decisions: decisions as Prisma.InputJsonObject };
  } else if (action === "undo") {
    if (!isSetupStepKey(body?.step)) return invalid("Etapa inválida.");
    delete decisions[body.step];
    data = { decisions: decisions as Prisma.InputJsonObject };
  } else if (action === "finish") {
    if (!evaluateSetup(snapshot, decisions).canFinish) return NextResponse.json({ message: "Ainda há etapas obrigatórias pendentes." }, { status: 409 });
    if (!completed) data = { status: "completed", completedAt: now };
  } else {
    return invalid("Ação inválida.");
  }

  const saved = data ? await prisma.clinicSetup.upsert({
    where: { clinicId },
    create: { clinic: { connect: { id: clinicId } }, ...(data as Prisma.ClinicSetupCreateWithoutClinicInput) },
    update: data,
    select: setupSelect,
  }) : row;
  return NextResponse.json(payloadFrom(saved, snapshot));
}
