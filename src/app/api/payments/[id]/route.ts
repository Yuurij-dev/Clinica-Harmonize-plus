import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const { id } = await params;
  const result = await prisma.payment.deleteMany({ where: { id, clinicId: user.clinicId } });
  if (!result.count) return NextResponse.json({ message: "Pagamento não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
