import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { saveErrorReason } from "@/lib/save-errors";

const maxFileBytes = 5 * 1024 * 1024;
const fileDataPattern = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
const signaturePattern = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  try {
    const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
    if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
    const [documents, clinic] = await Promise.all([prisma.patientDocument.findMany({
      where: { patientId, clinicId: user.clinicId }, orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, name: true, category: true, mimeType: true, signedAt: true, createdAt: true, consentText: true, signatureData: true },
    }), prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { consentTemplate: true } })]);
    return NextResponse.json({ documents, consentTemplate: clinic?.consentTemplate ?? null });
  } catch (error) {
    console.error("Failed to load patient documents", error);
    return NextResponse.json({ message: "Não foi possível carregar os documentos deste paciente." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (body?.kind === "consent") {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
    const category = typeof body.category === "string" ? body.category.trim().slice(0, 80) : "";
    const consentText = typeof body.consentText === "string" ? body.consentText.trim() : "";
    const signatureData = typeof body.signatureData === "string" ? body.signatureData : "";
    const template = typeof body.consentTemplate === "string" ? body.consentTemplate.trim() : "";
    if (!name || !category || consentText.length < 20 || consentText.length > 20000 || template.length < 20 || template.length > 20000 || !signaturePattern.test(signatureData)) {
      return NextResponse.json({ message: "Preencha o termo e assine antes de salvar." }, { status: 400 });
    }
    if (Buffer.byteLength(signatureData, "utf8") > maxFileBytes) return NextResponse.json({ message: "A assinatura excede o limite permitido." }, { status: 413 });
    try {
      const document = await prisma.$transaction(async (transaction) => {
        const savedDocument = await transaction.patientDocument.create({ data: {
          id: randomUUID(), clinicId: user.clinicId, patientId, kind: "consent", name,
          category, mimeType: "application/x-consent", consentText, signatureData, signedAt: new Date(),
        }, select: { id: true, kind: true, name: true, category: true, mimeType: true, signedAt: true, createdAt: true, consentText: true, signatureData: true } });
        const updatedClinics = await transaction.$executeRaw`UPDATE "Clinic" SET "consentTemplate" = ${template} WHERE "id" = ${user.clinicId}`;
        if (!updatedClinics) throw new Error("A clínica associada ao paciente não foi encontrada.");
        return savedDocument;
      });
      return NextResponse.json({ document }, { status: 201 });
    } catch (error) {
      console.error("Failed to save patient consent", error);
      return NextResponse.json({ message: `Não foi possível salvar o termo. Motivo: ${saveErrorReason(error)}` }, { status: 500 });
    }
  }
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 160) : "";
  const category = typeof body?.category === "string" ? body.category.trim().slice(0, 80) : "";
  const fileData = typeof body?.fileData === "string" ? body.fileData : "";
  const match = fileData.match(fileDataPattern);
  if (!name || !category || !match) return NextResponse.json({ message: "Envie um PDF ou imagem JPG, PNG ou WEBP." }, { status: 400 });
  const byteLength = Buffer.from(match[2], "base64").byteLength;
  if (byteLength > maxFileBytes) return NextResponse.json({ message: "O arquivo deve ter até 5 MB." }, { status: 413 });
  try {
    const document = await prisma.patientDocument.create({ data: {
      id: randomUUID(), clinicId: user.clinicId, patientId, name, category,
      mimeType: match[1].toLowerCase(), fileData,
    }, select: { id: true, kind: true, name: true, category: true, mimeType: true, signedAt: true, createdAt: true } });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    console.error("Failed to save patient document", error);
    return NextResponse.json({ message: `Não foi possível enviar o documento. Motivo: ${saveErrorReason(error)}` }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as { documentId?: string } | null;
  if (!body?.documentId) return NextResponse.json({ message: "Documento não informado." }, { status: 400 });
  try {
    const result = await prisma.patientDocument.deleteMany({ where: { id: body.documentId, patientId, clinicId: user.clinicId } });
    if (!result.count) return NextResponse.json({ message: "Documento não encontrado." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete patient document", error);
    return NextResponse.json({ message: `Não foi possível excluir o documento. Motivo: ${saveErrorReason(error)}` }, { status: 500 });
  }
}
