import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withSaveErrors } from "@/lib/save-errors";

export const DELETE = withSaveErrors("excluir o pagamento", async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const { id } = await params;
  const result = await prisma.payment.deleteMany({ where: { id, clinicId: user.clinicId } });
  if (!result.count) return NextResponse.json({ message: "Pagamento não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
});
