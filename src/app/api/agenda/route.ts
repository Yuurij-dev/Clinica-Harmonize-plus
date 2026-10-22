import { NextResponse } from "next/server";
import { parseAgendaRange } from "@/lib/agenda-period-rules";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Agendamentos do período [from, to] (dias AAAA-MM-DD, extremos incluídos, máx. 93 dias). A agenda carrega só o período visível
// e consulta de novo ao navegar. O dia do agendamento é guardado ao meio-dia em São Paulo, então o intervalo em UTC cobre o dia inteiro.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const parsed = parseAgendaRange(params.get("from"), params.get("to"));
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });

  const appointments = await prisma.appointment.findMany({
    where: { clinicId: user.clinicId, date: { gte: parsed.start, lt: parsed.endExclusive } },
    orderBy: [{ date: "asc" }, { time: "asc" }, { id: "asc" }],
    select: { id: true, patientId: true, date: true, time: true, procedure: true, professional: true, status: true, patient: { select: { name: true } } },
  });
  return NextResponse.json({ appointments, range: parsed.range, total: appointments.length });
}
