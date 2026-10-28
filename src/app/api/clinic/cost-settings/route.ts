import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { parseClockMinutes } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";

type ClinicSettings = {
  name: string;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  appointmentNotificationsEnabled: boolean;
  appointmentNotificationSoundEnabled: boolean;
  stockNotificationsEnabled: boolean;
  requireCancellationReason: boolean;
  autoMarkMissedAppointmentsEnabled: boolean;
  autoCompleteAppointmentsEnabled: boolean;
  autoAdvancePatientJourneyEnabled: boolean;
  allowAppointmentsOutsideHours: boolean;
  laborCost: number;
  facilityCost: number;
  medicationCost: number;
  appointmentToleranceMinutes: number;
  openingTime: string;
  closingTime: string;
  professionalOpeningTime: string;
  professionalClosingTime: string;
  professionalHourlyCost: number;
};

async function loadClinicSettings(clinicId: string): Promise<ClinicSettings | null> {
  const rows = await prisma.$queryRaw<Array<{ settings: ClinicSettings }>>`
    SELECT jsonb_build_object(
      'name', to_jsonb(c)->'name',
      'cnpj', to_jsonb(c)->'cnpj',
      'phone', to_jsonb(c)->'phone',
      'email', to_jsonb(c)->'email',
      'address', to_jsonb(c)->'address',
      'appointmentNotificationsEnabled', to_jsonb(c)->'appointmentNotificationsEnabled',
      'appointmentNotificationSoundEnabled', to_jsonb(c)->'appointmentNotificationSoundEnabled',
      'stockNotificationsEnabled', to_jsonb(c)->'stockNotificationsEnabled',
      'requireCancellationReason', COALESCE(to_jsonb(c)->'requireCancellationReason', 'false'::jsonb),
      'autoMarkMissedAppointmentsEnabled', COALESCE(to_jsonb(c)->'autoMarkMissedAppointmentsEnabled', 'true'::jsonb),
      'autoCompleteAppointmentsEnabled', COALESCE(to_jsonb(c)->'autoCompleteAppointmentsEnabled', 'true'::jsonb),
      'autoAdvancePatientJourneyEnabled', COALESCE(to_jsonb(c)->'autoAdvancePatientJourneyEnabled', 'true'::jsonb),
      'allowAppointmentsOutsideHours', COALESCE(to_jsonb(c)->'allowAppointmentsOutsideHours', 'false'::jsonb),
      'laborCost', to_jsonb(c)->'laborCost',
      'facilityCost', to_jsonb(c)->'facilityCost',
      'medicationCost', to_jsonb(c)->'medicationCost',
      'appointmentToleranceMinutes', to_jsonb(c)->'appointmentToleranceMinutes',
      'openingTime', to_jsonb(c)->'openingTime',
      'closingTime', to_jsonb(c)->'closingTime',
      'professionalOpeningTime', to_jsonb(c)->'professionalOpeningTime',
      'professionalClosingTime', to_jsonb(c)->'professionalClosingTime',
      'professionalHourlyCost', to_jsonb(c)->'professionalHourlyCost'
    ) AS settings
    FROM "Clinic" AS c
    WHERE c."id" = ${clinicId}
  `;
  return rows[0]?.settings ?? null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:manage")) return NextResponse.json({ message: "Acesso restrito à administração da clínica." }, { status: 403 });

  const settings = await loadClinicSettings(user.clinicId);
  return NextResponse.json({ settings });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const laborCost = Number(body?.laborCost);
  const facilityCost = Number(body?.facilityCost);
  const medicationCost = Number(body?.medicationCost);
  const appointmentToleranceMinutes = Number(body?.appointmentToleranceMinutes);
  const openingTime = typeof body?.openingTime === "string" ? body.openingTime : null;
  const closingTime = typeof body?.closingTime === "string" ? body.closingTime : null;
  const professionalOpeningTime = typeof body?.professionalOpeningTime === "string" ? body.professionalOpeningTime : null;
  const professionalClosingTime = typeof body?.professionalClosingTime === "string" ? body.professionalClosingTime : null;
  const professionalHourlyCost = Number(body?.professionalHourlyCost ?? 0);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const cnpj = typeof body?.cnpj === "string" ? body.cnpj.trim() : null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : null;
  const email = typeof body?.email === "string" ? body.email.trim() : null;
  const address = typeof body?.address === "string" ? body.address.trim() : null;
  const openingMinutes = openingTime ? parseClockMinutes(openingTime) : null;
  const closingMinutes = closingTime ? parseClockMinutes(closingTime) : null;
  const professionalOpeningMinutes = professionalOpeningTime ? parseClockMinutes(professionalOpeningTime) : null;
  const professionalClosingMinutes = professionalClosingTime ? parseClockMinutes(professionalClosingTime) : null;
  const hasBusinessHours = openingTime !== null || closingTime !== null;
  const hasProfessionalHours = professionalOpeningTime !== null || professionalClosingTime !== null;
  const preferenceKeys = ["appointmentNotificationsEnabled", "appointmentNotificationSoundEnabled", "stockNotificationsEnabled", "requireCancellationReason"] as const;
  const invalidPreference = preferenceKeys.some((key) => body?.[key] !== undefined && typeof body[key] !== "boolean");
  if (invalidPreference || (body?.name !== undefined && (name.length < 2 || name.length > 120)) || (cnpj !== null && cnpj.length > 18) || (phone !== null && phone.length > 15) || (email !== null && (email.length > 254 || (email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) || (address !== null && address.length > 240) || ![laborCost, facilityCost, medicationCost, appointmentToleranceMinutes, professionalHourlyCost].every((value) => Number.isFinite(value) && value >= 0) || !Number.isInteger(appointmentToleranceMinutes) || appointmentToleranceMinutes > 180 || (hasBusinessHours && (!openingTime || !closingTime || openingMinutes === null || closingMinutes === null || closingMinutes <= openingMinutes)) || (hasProfessionalHours && (!professionalOpeningTime || !professionalClosingTime || professionalOpeningMinutes === null || professionalClosingMinutes === null || professionalClosingMinutes <= professionalOpeningMinutes))) {
    return NextResponse.json({ message: "Confira os dados, horários, custos e a tolerância informados." }, { status: 400 });
  }

  await prisma.clinic.update({
    where: { id: user.clinicId },
    data: {
      ...(body?.name !== undefined ? { name } : {}),
      ...(body?.cnpj !== undefined ? { cnpj: cnpj || null } : {}),
      ...(body?.phone !== undefined ? { phone: phone || null } : {}),
      ...(body?.email !== undefined ? { email: email || null } : {}),
      ...(body?.address !== undefined ? { address: address || null } : {}),
      ...(typeof body?.appointmentNotificationsEnabled === "boolean" ? { appointmentNotificationsEnabled: body.appointmentNotificationsEnabled } : {}),
      ...(typeof body?.appointmentNotificationSoundEnabled === "boolean" ? { appointmentNotificationSoundEnabled: body.appointmentNotificationSoundEnabled } : {}),
      ...(typeof body?.stockNotificationsEnabled === "boolean" ? { stockNotificationsEnabled: body.stockNotificationsEnabled } : {}),
      ...(typeof body?.requireCancellationReason === "boolean" ? { requireCancellationReason: body.requireCancellationReason } : {}),
      laborCost: Math.round(laborCost),
      facilityCost: Math.round(facilityCost),
      medicationCost: Math.round(medicationCost),
      professionalHourlyCost,
      appointmentToleranceMinutes,
      ...(openingTime !== null ? { openingTime } : {}),
      ...(closingTime !== null ? { closingTime } : {}),
      ...(professionalOpeningTime !== null ? { professionalOpeningTime } : {}),
      ...(professionalClosingTime !== null ? { professionalClosingTime } : {}),
    },
    select: { id: true },
  });
  const settings = await loadClinicSettings(user.clinicId);
  return NextResponse.json({ settings });
}
