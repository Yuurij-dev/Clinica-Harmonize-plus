import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; procedureId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const { id: patientId, procedureId } = await params;
  const body = await request.json().catch(() => null) as { photoType?: "beforePhoto" | "afterPhoto"; photo?: string | null } | null;
  if (!body?.photoType || (body.photo !== null && !body.photo?.startsWith("data:image/"))) {
    return NextResponse.json({ message: "Envie uma foto válida." }, { status: 400 });
  }

  const procedure = await prisma.patientProcedure.findFirst({ where: { id: procedureId, patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!procedure) return NextResponse.json({ message: "Procedimento não encontrado." }, { status: 404 });

  const updated = await prisma.patientProcedure.update({ where: { id: procedure.id }, data: { [body.photoType]: body.photo } });
  return NextResponse.json({ procedure: updated });
}
