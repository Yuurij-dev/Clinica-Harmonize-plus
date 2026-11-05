import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const clinicalDenied = denyUnless(user, "clinical:read");
  if (clinicalDenied) return clinicalDenied;

  const sessions = await prisma.patientProcedureSession.findMany({
    where: { clinicId: user.clinicId, status: "Em execução" },
    orderBy: { startedAt: "asc" },
    take: 50,
    select: { id: true, patientId: true, journeyId: true, procedureName: true, patient: { select: { name: true } }, journey: { select: { name: true } } },
  });
  return NextResponse.json({ sessions: sessions.map(({ id, patientId, journeyId, procedureName, patient, journey }) => ({ id, patientId, journeyId, procedureName, patientName: patient.name, journeyName: journey.name })) });
}
