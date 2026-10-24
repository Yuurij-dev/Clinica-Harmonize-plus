import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { canAssignSignatureStatus, canModifySignedTerm, canViewDocumentCategory, canWriteDocumentCategory, cleanDisplayName, editActions, isDocumentCategory, isSignatureStatus } from "@/lib/clinical-files-rules";
import { auditEntry, resolveLinks } from "@/lib/clinical-files-server";
import { can } from "@/lib/permissions";
import { removeStoredBytes } from "@/lib/clinical-storage";

const select = { id: true, name: true, category: true, mimeType: true, sizeBytes: true, signatureStatus: true, uploadedByName: true, uploadedAt: true, journeyId: true, encounterType: true, encounterId: true, archivedAt: true, storageDriver: true, storageKey: true } as const;

async function findDocument(clinicId: string, patientId: string, docId: string) {
  return prisma.clinicalDocument.findFirst({ where: { id: docId, clinicId, patientId }, select });
}

function present(row: NonNullable<Awaited<ReturnType<typeof findDocument>>>) {
  return { id: row.id, system: false as const, name: row.name, category: row.category, date: row.uploadedAt.toISOString(), mimeType: row.mimeType, sizeBytes: row.sizeBytes, signatureStatus: row.signatureStatus, professional: row.uploadedByName, journeyId: row.journeyId, encounterType: row.encounterType, encounterId: row.encounterId, archived: Boolean(row.archivedAt) };
}

// Renomear, recategorizar, vincular, assinatura (manual) e arquivar/desarquivar.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const { id: patientId, docId } = await params;
  const clinicId = user.clinicId;
  const current = await findDocument(clinicId, patientId, docId);
  // Categoria fora do que o papel enxerga responde igual a "não existe".
  if (!current || !canViewDocumentCategory(user.role, current.category)) return NextResponse.json({ message: "Documento não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ message: "Requisição inválida." }, { status: 400 });

  if (typeof body.archived === "boolean") {
    const denied = denyUnless(user.role, "clinical:archive");
    if (denied) return denied;
    if (body.archived === Boolean(current.archivedAt)) return NextResponse.json({ item: present(current) });
    const reasonText = typeof body.reason === "string" ? body.reason : "";
    const [updated] = await prisma.$transaction([prisma.clinicalDocument.update({ where: { id: current.id }, data: body.archived ? { archivedAt: new Date(), archivedBy: user.id, archiveReason: reasonText.slice(0, 300) } : { archivedAt: null, archivedBy: null, archiveReason: "" }, select }), auditEntry(user, patientId, "DOCUMENT", current.id, body.archived ? "ARCHIVE" : "UNARCHIVE", { fileName: current.name, category: current.category, note: reasonText })]);
    return NextResponse.json({ item: present(updated) });
  }

  if (current.archivedAt) return NextResponse.json({ message: "Desarquive o documento para editar." }, { status: 409 });
  if (!canWriteDocumentCategory(user.role, current.category)) return NextResponse.json({ message: "Seu perfil não pode editar documentos desta categoria." }, { status: 403 });
  const next = { name: current.name, category: current.category, journeyId: current.journeyId, encounterType: current.encounterType, encounterId: current.encounterId, signatureStatus: current.signatureStatus };
  if (body.name !== undefined) {
    const name = cleanDisplayName(body.name);
    if (!name) return NextResponse.json({ message: "Informe um nome válido." }, { status: 400 });
    next.name = name;
  }
  if (body.category !== undefined) {
    if (!isDocumentCategory(body.category)) return NextResponse.json({ message: "Categoria inválida." }, { status: 400 });
    if (!canWriteDocumentCategory(user.role, body.category)) return NextResponse.json({ message: "Seu perfil não pode usar esta categoria." }, { status: 403 });
    next.category = body.category;
  }
  if (body.signatureStatus !== undefined) {
    if (!isSignatureStatus(body.signatureStatus)) return NextResponse.json({ message: "Status de assinatura inválido." }, { status: 400 });
    next.signatureStatus = body.signatureStatus;
  }
  if (body.journeyId !== undefined || body.encounterType !== undefined || body.encounterId !== undefined) {
    // Campo de vínculo ausente no corpo preserva o valor atual (mudar só o tratamento não apaga o atendimento).
    const keepEncounter = body.encounterType === undefined && body.encounterId === undefined;
    const links = await resolveLinks(clinicId, patientId, {
      journeyId: body.journeyId !== undefined ? body.journeyId ?? null : current.journeyId,
      encounterType: keepEncounter ? current.encounterType : body.encounterType ?? null,
      encounterId: keepEncounter ? current.encounterId : body.encounterId ?? null,
    }, can(user.role, "clinical:read") || keepEncounter);
    if (!links.ok) return NextResponse.json({ message: links.message }, { status: 400 });
    Object.assign(next, links.links);
  }
  if (!canModifySignedTerm(user.role, current, next)) return NextResponse.json({ message: "Termo assinado só pode ser renomeado pelo seu perfil. Peça a um profissional ou administrador para alterar status, categoria ou vínculo." }, { status: 403 });
  // Só quem é clínico atribui "Assinado" a um termo (mudança de status ou de categoria para Termos).
  if (next.signatureStatus === "ASSINADO" && (next.signatureStatus !== current.signatureStatus || next.category !== current.category) && !canAssignSignatureStatus(user.role, next.category, next.signatureStatus)) return NextResponse.json({ message: "Seu perfil não pode marcar um termo como assinado." }, { status: 403 });
  const actions = editActions({ ...current }, next);
  if (!actions.length) return NextResponse.json({ item: present(current) });
  const [updated] = await prisma.$transaction([
    prisma.clinicalDocument.update({ where: { id: current.id }, data: next, select }),
    ...actions.map((action) => auditEntry(user, patientId, "DOCUMENT", current.id, action, { fileName: next.name, category: next.category, note: action === "RENAME" ? `de "${current.name}"` : "" })),
  ]);
  return NextResponse.json({ item: present(updated) });
}

// Exclusão definitiva: só ADMIN, com confirmação explícita. Apaga bytes e registro; a trilha mínima (quem, quando, nome, categoria, motivo) permanece.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:delete");
  if (denied) return denied;
  const { id: patientId, docId } = await params;
  const current = await findDocument(user.clinicId, patientId, docId);
  if (!current) return NextResponse.json({ message: "Documento não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as { confirm?: unknown; reason?: unknown } | null;
  if (body?.confirm !== true) return NextResponse.json({ message: "Confirme a exclusão definitiva." }, { status: 400 });
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  await prisma.$transaction([
    prisma.clinicalFileAudit.create({ data: { clinicId: user.clinicId, patientId, fileKind: "DOCUMENT", fileId: current.id, action: "DELETE", actorId: user.id, actorName: user.name, fileName: current.name.slice(0, 200), category: current.category, note: reason } }),
    prisma.clinicalDocument.deleteMany({ where: { id: current.id, clinicId: user.clinicId, patientId } }),
  ]);
  await removeStoredBytes(current);
  return NextResponse.json({ ok: true });
}
