import { NextResponse } from "next/server";
import { AttendanceMaterialsError, attendanceCheckData, findAttendance, registerAttendanceOutputs } from "@/lib/attendance-materials";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Conferência de materiais do atendimento. Qualquer membro da clínica que finaliza o
// atendimento pode conferir; a resposta não traz custos.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const data = await attendanceCheckData(user.clinicId, (await params).id);
  if (!data) return NextResponse.json({ message: "Atendimento não encontrado." }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const attendance = await findAttendance(user.clinicId, (await params).id);
  if (!attendance) return NextResponse.json({ message: "Atendimento não encontrado." }, { status: 404 });
  if (attendance.status !== "Atendido") return NextResponse.json({ message: "Finalize o atendimento antes de conferir os materiais." }, { status: 409 });
  if (attendance.materialsCheck === "done" || attendance.materialsCheck === "skipped") return NextResponse.json({ message: "Os materiais deste atendimento já foram conferidos." }, { status: 409 });

  const body = await request.json().catch(() => null) as { skip?: boolean; items?: unknown } | null;
  const items = Array.isArray(body?.items) ? body.items.map((raw) => {
    const item = raw as { productId?: unknown; quantity?: unknown; allocations?: unknown };
    return {
      productId: String(item.productId ?? ""),
      quantity: Number(item.quantity),
      allocations: Array.isArray(item.allocations) ? item.allocations.map((allocation) => ({ lotId: String((allocation as { lotId?: unknown }).lotId ?? ""), quantity: Number((allocation as { quantity?: unknown }).quantity) })) : undefined,
    };
  }) : [];
  if (body?.skip && attendance.kind === "procedure") return NextResponse.json({ message: "Num procedimento, confirme os materiais usados (ou remova todos)." }, { status: 400 });

  try {
    const pending = await prisma.$transaction(async (tx) => {
      // Trava o atendimento: duas conferências ao mesmo tempo não registram saídas em dobro.
      const claimed = await tx.appointment.updateMany({ where: { id: attendance.id, clinicId: user.clinicId, OR: [{ materialsCheck: null }, { materialsCheck: "pending" }] }, data: { materialsCheck: body?.skip ? "skipped" : "done", materialsCheckedAt: new Date() } });
      if (!claimed.count) throw new AttendanceMaterialsError("Os materiais deste atendimento já foram conferidos.");
      return body?.skip ? [] : registerAttendanceOutputs(tx, { clinicId: user.clinicId, userId: user.id, userName: user.name, attendance, items });
    });
    return NextResponse.json({ pending });
  } catch (error) {
    if (error instanceof AttendanceMaterialsError) return NextResponse.json({ message: error.message }, { status: 400 });
    throw error;
  }
}
