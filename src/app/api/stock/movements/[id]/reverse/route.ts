import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { movementTypes } from "@/lib/stock";

// Estorna uma saída de atendimento registrada errada: devolve a quantidade ao lote e guarda
// quem estornou, quando e por quê. Depois é possível registrar a saída correta.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const id = (await params).id;
  const body = await request.json().catch(() => null) as { reason?: string } | null;
  const reason = body?.reason?.trim();
  if (!reason) return NextResponse.json({ message: "Informe o motivo do estorno." }, { status: 400 });
  const movement = await prisma.stockMovement.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true, type: true, productId: true, lotId: true, quantity: true, reversedBy: { select: { id: true } } } });
  if (!movement) return NextResponse.json({ message: "Movimentação não encontrada." }, { status: 404 });
  if (movement.type !== movementTypes.attendance) return NextResponse.json({ message: "Só saídas de atendimento podem ser estornadas." }, { status: 400 });
  if (movement.reversedBy) return NextResponse.json({ message: "Esta saída já foi estornada." }, { status: 409 });
  try {
    // reversesId é único: dois estornos simultâneos da mesma saída não passam.
    await prisma.stockMovement.create({ data: { clinicId: user.clinicId, productId: movement.productId, lotId: movement.lotId, type: movementTypes.reversal, quantity: -movement.quantity, reversesId: movement.id, notes: reason, userId: user.id, userName: user.name } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ message: "Esta saída já foi estornada." }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
