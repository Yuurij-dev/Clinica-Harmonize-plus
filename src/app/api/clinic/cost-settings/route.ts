import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id: user.clinicId },
      select: { name: true, laborCost: true, facilityCost: true, medicationCost: true },
    });
    let appointmentToleranceMinutes = 15;
    let openingTime = "08:00";
    let closingTime = "19:00";
    let professionalOpeningTime = "09:00";
    let professionalClosingTime = "18:00";
    let professionalHourlyCost = 0;
    try {
      const tolerance = await prisma.clinic.findUnique({
        where: { id: user.clinicId },
        select: { appointmentToleranceMinutes: true, openingTime: true, closingTime: true, professionalOpeningTime: true, professionalClosingTime: true, professionalHourlyCost: true },
      });
      appointmentToleranceMinutes = tolerance?.appointmentToleranceMinutes ?? 15;
      openingTime = tolerance?.openingTime ?? openingTime;
      closingTime = tolerance?.closingTime ?? closingTime;
      professionalOpeningTime = tolerance?.professionalOpeningTime ?? professionalOpeningTime;
      professionalClosingTime = tolerance?.professionalClosingTime ?? professionalClosingTime;
      professionalHourlyCost = tolerance?.professionalHourlyCost ?? professionalHourlyCost;
    } catch {
      // Keep the default until the tolerance column is applied to the database.
    }
    return NextResponse.json({ settings: { ...(clinic ?? { name: "Harmonize+", laborCost: 0, facilityCost: 0, medicationCost: 0 }), appointmentToleranceMinutes, openingTime, closingTime, professionalOpeningTime, professionalClosingTime, professionalHourlyCost } });
  } catch {
    return NextResponse.json({ message: "As colunas de custos ainda não foram criadas no banco da clínica." }, { status: 500 });
  }
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
  const openingMinutes = openingTime ? parseClockMinutes(openingTime) : null;
  const closingMinutes = closingTime ? parseClockMinutes(closingTime) : null;
  const professionalOpeningMinutes = professionalOpeningTime ? parseClockMinutes(professionalOpeningTime) : null;
  const professionalClosingMinutes = professionalClosingTime ? parseClockMinutes(professionalClosingTime) : null;
  const hasBusinessHours = openingTime !== null || closingTime !== null;
  const hasProfessionalHours = professionalOpeningTime !== null || professionalClosingTime !== null;
  if ((body?.name !== undefined && (name.length < 2 || name.length > 120)) || ![laborCost, facilityCost, medicationCost, appointmentToleranceMinutes, professionalHourlyCost].every((value) => Number.isFinite(value) && value >= 0) || !Number.isInteger(appointmentToleranceMinutes) || appointmentToleranceMinutes > 180 || (hasBusinessHours && (!openingTime || !closingTime || openingMinutes === null || closingMinutes === null || closingMinutes <= openingMinutes)) || (hasProfessionalHours && (!professionalOpeningTime || !professionalClosingTime || professionalOpeningMinutes === null || professionalClosingMinutes === null || professionalClosingMinutes <= professionalOpeningMinutes))) {
    return NextResponse.json({ message: "Informe valores válidos para os custos e a tolerância." }, { status: 400 });
  }

  try {
    const settings = await prisma.clinic.update({
      where: { id: user.clinicId },
      data: { ...(body?.name !== undefined ? { name } : {}), laborCost: Math.round(laborCost), facilityCost: Math.round(facilityCost), medicationCost: Math.round(medicationCost), professionalHourlyCost, ...(professionalOpeningTime !== null ? { professionalOpeningTime } : {}), ...(professionalClosingTime !== null ? { professionalClosingTime } : {}) },
      select: { name: true, laborCost: true, facilityCost: true, medicationCost: true, professionalHourlyCost: true, professionalOpeningTime: true, professionalClosingTime: true },
    });
    let savedTolerance = 15;
    let savedOpeningTime = "08:00";
    let savedClosingTime = "19:00";
    try {
      const tolerance = await prisma.clinic.update({
        where: { id: user.clinicId },
        data: { appointmentToleranceMinutes, ...(openingTime !== null ? { openingTime } : {}), ...(closingTime !== null ? { closingTime } : {}) },
        select: { appointmentToleranceMinutes: true, openingTime: true, closingTime: true },
      });
      savedTolerance = tolerance.appointmentToleranceMinutes;
      savedOpeningTime = tolerance.openingTime;
      savedClosingTime = tolerance.closingTime;
    } catch {
      // Costs can still be saved while the tolerance migration is pending.
    }
    return NextResponse.json({ settings: { ...settings, appointmentToleranceMinutes: savedTolerance, openingTime: savedOpeningTime, closingTime: savedClosingTime } });
  } catch {
    return NextResponse.json({ message: "As colunas de custos ainda não foram criadas no banco da clínica." }, { status: 500 });
  }
}

function parseClockMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}
