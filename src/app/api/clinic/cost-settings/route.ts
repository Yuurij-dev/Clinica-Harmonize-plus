import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseClockMinutes } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";

const settingsSelect = { name: true, cnpj: true, phone: true, email: true, address: true, appointmentNotificationsEnabled: true, appointmentNotificationSoundEnabled: true, stockNotificationsEnabled: true, requireCancellationReason: true, autoMarkMissedAppointmentsEnabled: true, autoCompleteAppointmentsEnabled: true, autoAdvancePatientJourneyEnabled: true, allowAppointmentsOutsideHours: true, laborCost: true, facilityCost: true, medicationCost: true, appointmentToleranceMinutes: true, openingTime: true, closingTime: true, professionalOpeningTime: true, professionalClosingTime: true, professionalHourlyCost: true } as const;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const settings = await prisma.clinic.findUnique({ where: { id: user.clinicId }, select: settingsSelect });
  return NextResponse.json({ settings });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

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
  if (invalidPreference || (body?.name !== undefined && (name.length < 2 || name.length > 120)) || (cnpj !== null && cnpj.length > 24) || (phone !== null && phone.length > 32) || (email !== null && (email.length > 254 || (email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) || (address !== null && address.length > 240) || ![laborCost, facilityCost, medicationCost, appointmentToleranceMinutes, professionalHourlyCost].every((value) => Number.isFinite(value) && value >= 0) || !Number.isInteger(appointmentToleranceMinutes) || appointmentToleranceMinutes > 180 || (hasBusinessHours && (!openingTime || !closingTime || openingMinutes === null || closingMinutes === null || closingMinutes <= openingMinutes)) || (hasProfessionalHours && (!professionalOpeningTime || !professionalClosingTime || professionalOpeningMinutes === null || professionalClosingMinutes === null || professionalClosingMinutes <= professionalOpeningMinutes))) {
    return NextResponse.json({ message: "Confira os dados, horários, custos e a tolerância informados." }, { status: 400 });
  }

  const settings = await prisma.clinic.update({
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
    select: settingsSelect,
  });
  return NextResponse.json({ settings });
}
