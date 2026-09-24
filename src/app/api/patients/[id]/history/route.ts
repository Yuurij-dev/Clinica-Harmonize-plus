import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patient = await prisma.patient.findFirst({
    where: { id: (await params).id, clinicId: user.clinicId },
    include: {
      appointments: { orderBy: [{ date: "desc" }, { time: "desc" }] },
      payments: { orderBy: { date: "desc" } },
      quotes: { orderBy: { createdAt: "desc" }, select: { id: true, items: true, status: true, createdAt: true } },
      procedureRecords: { orderBy: { performedAt: "desc" } },
      evaluations: { include: { photos: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  let procedureRecords = patient.procedureRecords;
  const latestQuote = patient.quotes[0];
  if (latestQuote && procedureRecords.length === 0) {
    const procedureRecord = await prisma.patientProcedure.create({
      data: {
        clinicId: user.clinicId,
        patientId: patient.id,
        name: latestQuote.items,
        professional: user.name,
        performedAt: latestQuote.createdAt,
        notes: `__quote:${latestQuote.id}`,
      },
    });
    procedureRecords = [procedureRecord];
  }

  return NextResponse.json({ patient: { ...patient, procedureRecords } });
}
