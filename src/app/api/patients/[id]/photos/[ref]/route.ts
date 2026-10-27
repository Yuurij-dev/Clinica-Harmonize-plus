import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { cleanDisplayName, editActions, isPhotoPhase, photoCategoryNames } from "@/lib/clinical-files-rules";
import { auditEntry, resolveLinks } from "@/lib/clinical-files-server";
import { removeStoredBytes } from "@/lib/clinical-storage";
import { decodeRefParam, parsePhotoRef } from "@/lib/photo-gallery-rules";

const badRef = () => NextResponse.json({ message: "Referência inválida." }, { status: 400 });

// Marcações (vetores do editor) de uma foto de avaliação, para exibir "original x com marcações" sem pesar a lista.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; ref: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:read");
  if (denied) return denied;
  const { id: patientId, ref: rawRef } = await params;
  const ref = decodeRefParam(rawRef);
  if (!ref) return badRef();
  const parsed = parsePhotoRef(ref);
  if (!parsed || parsed.source !== "evaluation" || parsed.parts.length !== 1) return NextResponse.json({ annotations: [], width: 0, height: 0 });
  const photo = await prisma.evaluationPhoto.findFirst({ where: { id: parsed.parts[0], evaluation: { clinicId: user.clinicId, patientId } }, select: { annotations: true, width: true, height: true } });
  if (!photo) return NextResponse.json({ message: "Foto não encontrada." }, { status: 404 });
  let annotations: unknown = [];
  try { annotations = JSON.parse(photo.annotations); } catch { annotations = []; }
  return NextResponse.json({ annotations: Array.isArray(annotations) ? annotations : [], width: photo.width, height: photo.height });
}

// Edição/arquivamento só de fotos novas da galeria (ClinicalPhoto). Fotos de avaliação, sessão e retorno são registros clínicos e não mudam aqui.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; ref: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  // Permissão clínica antes de qualquer consulta: quem não pode ver foto não distingue "existe" de "não existe".
  const readDenied = denyUnless(user, "clinical:read");
  if (readDenied) return readDenied;
  const { id: patientId, ref: rawRef } = await params;
  const ref = decodeRefParam(rawRef);
  if (!ref) return badRef();
  const parsed = parsePhotoRef(ref);
  if (!parsed || parsed.source !== "gallery") return NextResponse.json({ message: "Esta foto faz parte de um atendimento e não pode ser alterada aqui." }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ message: "Requisição inválida." }, { status: 400 });
  const current = await prisma.clinicalPhoto.findFirst({ where: { id: parsed.parts[0], clinicId: user.clinicId, patientId }, select: { id: true, name: true, category: true, phase: true, journeyId: true, encounterType: true, encounterId: true, archivedAt: true } });
  if (!current) return NextResponse.json({ message: "Foto não encontrada." }, { status: 404 });

  if (typeof body.archived === "boolean") {
    const denied = denyUnless(user, "clinical:archive");
    if (denied) return denied;
    await prisma.$transaction([
      prisma.clinicalPhoto.update({ where: { id: current.id }, data: body.archived ? { archivedAt: new Date(), archivedBy: user.id } : { archivedAt: null, archivedBy: null } }),
      auditEntry(user, patientId, "PHOTO", current.id, body.archived ? "ARCHIVE" : "UNARCHIVE", { fileName: current.name, category: current.category }),
    ]);
    return NextResponse.json({ ok: true });
  }
  const denied = denyUnless(user, "clinical:write");
  if (denied) return denied;
  if (current.archivedAt) return NextResponse.json({ message: "Desarquive a foto para editar." }, { status: 409 });
  const next = { name: current.name, category: current.category, phase: current.phase, journeyId: current.journeyId, encounterType: current.encounterType, encounterId: current.encounterId };
  if (body.name !== undefined) { const name = cleanDisplayName(body.name); if (!name) return NextResponse.json({ message: "Informe um nome válido." }, { status: 400 }); next.name = name; }
  if (body.category !== undefined) { if (typeof body.category !== "string" || !(photoCategoryNames as readonly string[]).includes(body.category)) return NextResponse.json({ message: "Categoria inválida." }, { status: 400 }); next.category = body.category; }
  if (body.phase !== undefined) { if (!isPhotoPhase(body.phase)) return NextResponse.json({ message: "Fase inválida." }, { status: 400 }); next.phase = body.phase; }
  if (body.journeyId !== undefined || body.encounterType !== undefined || body.encounterId !== undefined) {
    const links = await resolveLinks(user.clinicId, patientId, { journeyId: body.journeyId ?? null, encounterType: body.encounterType ?? null, encounterId: body.encounterId ?? null }, true);
    if (!links.ok) return NextResponse.json({ message: links.message }, { status: 400 });
    if (links.links.encounterType === "followup") return NextResponse.json({ message: "Vincule a foto a uma avaliação ou procedimento." }, { status: 400 });
    Object.assign(next, links.links);
  }
  const actions = editActions(current, next);
  const phaseChanged = next.phase !== current.phase;
  if (!actions.length && !phaseChanged) return NextResponse.json({ ok: true });
  await prisma.$transaction([
    prisma.clinicalPhoto.update({ where: { id: current.id }, data: next }),
    ...actions.map((action) => auditEntry(user, patientId, "PHOTO", current.id, action, { fileName: next.name, category: next.category })),
    ...(phaseChanged ? [auditEntry(user, patientId, "PHOTO", current.id, "RECATEGORIZE", { fileName: next.name, category: next.category, note: `fase ${current.phase} -> ${next.phase}` })] : []),
  ]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; ref: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:delete");
  if (denied) return denied;
  const { id: patientId, ref: rawRef } = await params;
  const ref = decodeRefParam(rawRef);
  if (!ref) return badRef();
  const parsed = parsePhotoRef(ref);
  if (!parsed || parsed.source !== "gallery") return NextResponse.json({ message: "Apenas fotos enviadas pela galeria podem ser excluídas aqui." }, { status: 400 });
  const current = await prisma.clinicalPhoto.findFirst({ where: { id: parsed.parts[0], clinicId: user.clinicId, patientId }, select: { id: true, name: true, category: true, storageDriver: true, storageKey: true } });
  if (!current) return NextResponse.json({ message: "Foto não encontrada." }, { status: 404 });
  const body = await request.json().catch(() => null) as { confirm?: unknown; reason?: unknown } | null;
  if (body?.confirm !== true) return NextResponse.json({ message: "Confirme a exclusão definitiva." }, { status: 400 });
  await prisma.$transaction([
    auditEntry(user, patientId, "PHOTO", current.id, "DELETE", { fileName: current.name, category: current.category, note: typeof body.reason === "string" ? body.reason.trim() : "" }),
    prisma.clinicalPhoto.deleteMany({ where: { id: current.id, clinicId: user.clinicId, patientId } }),
  ]);
  await removeStoredBytes(current);
  return NextResponse.json({ ok: true });
}
