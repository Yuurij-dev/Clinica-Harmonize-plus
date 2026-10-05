import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; procedureId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const { id: patientId, procedureId } = await params;
  const body = await request.json().catch(() => null) as { photoType?: "beforePhoto" | "afterPhoto"; photo?: string | null; sessionId?: string; name?: string } | null;
  if (!body?.photoType && body?.name === undefined) {
    return NextResponse.json({ message: "Envie uma foto válida." }, { status: 400 });
  }

  const procedure = await prisma.patientProcedure.findFirst({ where: { id: procedureId, patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!procedure) return NextResponse.json({ message: "Procedimento não encontrado." }, { status: 404 });

  if (body.name !== undefined) {
    if (!body.sessionId || !body.name.trim()) return NextResponse.json({ message: "Informe um nome para a sessão de fotos." }, { status: 400 });
    const session = await prisma.patientProcedurePhotoSession.findFirst({ where: { id: body.sessionId, procedureId: procedure.id }, select: { id: true } });
    if (!session) return NextResponse.json({ message: "Sessão de fotos não encontrada." }, { status: 404 });
    const updatedSession = await prisma.patientProcedurePhotoSession.update({ where: { id: session.id }, data: { name: body.name.trim() } });
    return NextResponse.json({ session: updatedSession });
  }

  if (body.photo !== null && !body.photo?.startsWith("data:image/")) {
    return NextResponse.json({ message: "Envie uma foto válida." }, { status: 400 });
  }
  if (!body.photoType) return NextResponse.json({ message: "Informe o tipo da foto." }, { status: 400 });

  if (body.sessionId) {
    const session = await prisma.patientProcedurePhotoSession.findFirst({ where: { id: body.sessionId, procedureId: procedure.id }, select: { id: true } });
    if (!session) return NextResponse.json({ message: "Sessão de fotos não encontrada." }, { status: 404 });
    const updatedSession = await prisma.patientProcedurePhotoSession.update({ where: { id: session.id }, data: { [body.photoType]: body.photo } });
    return NextResponse.json({ session: updatedSession });
  }

  const updated = await prisma.patientProcedure.update({ where: { id: procedure.id }, data: { [body.photoType]: body.photo } });
  return NextResponse.json({ procedure: updated });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; procedureId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const { id: patientId, procedureId } = await params;
  const body = await request.json().catch(() => null) as { name?: string } | null;
  const procedure = await prisma.patientProcedure.findFirst({ where: { id: procedureId, patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!procedure) return NextResponse.json({ message: "Procedimento não encontrado." }, { status: 404 });
  const name = body?.name?.trim() || "Nova sessão";
  const session = await prisma.patientProcedurePhotoSession.create({ data: { procedureId: procedure.id, name } });
  return NextResponse.json({ session }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; procedureId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const { id: patientId, procedureId } = await params;
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ message: "Sessão de fotos não informada." }, { status: 400 });

  const procedure = await prisma.patientProcedure.findFirst({ where: { id: procedureId, patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!procedure) return NextResponse.json({ message: "Procedimento não encontrado." }, { status: 404 });

  const deleted = await prisma.patientProcedurePhotoSession.deleteMany({ where: { id: sessionId, procedureId: procedure.id } });
  if (!deleted.count) return NextResponse.json({ message: "Sessão de fotos não encontrada." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
