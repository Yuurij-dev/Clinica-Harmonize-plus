import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { anamnesisFullSelect, anamnesisMetaSelect, serializeFull } from "@/lib/anamnesis-store";
import { appendAudit, canTransition, completionCheck, currentVersion, normalizeAnamnesisContent, parseAnamnesisContent, pruneEmptyRows, revisionConflict, staleDraftMessage } from "@/lib/anamnesis-rules";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; versionId: string }> };

async function findPatient(patientId: string, clinicId: string) {
  return prisma.patient.findFirst({ where: { id: patientId, clinicId }, select: { id: true } });
}

export async function GET(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "anamnesis:read");
  if (denied) return denied;
  const { id: patientId, versionId } = await params;
  if (!await findPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const version = await prisma.patientAnamnesis.findFirst({ where: { id: versionId, clinicId: user.clinicId, patientId }, select: anamnesisFullSelect });
  if (!version) return NextResponse.json({ message: "Versão da anamnese não encontrada." }, { status: 404 });
  return NextResponse.json({ version: serializeFull(version) });
}

// Ações sobre uma versão: concluir o rascunho, confirmar que a versão atual continua válida ou marcá-la para revisão.
export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "anamnesis:write");
  if (denied) return denied;
  const { id: patientId, versionId } = await params;
  if (!await findPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const raw = await request.text();
  if (raw.length > 120_000) return NextResponse.json({ message: "O conteúdo da anamnese é grande demais." }, { status: 413 });
  type ActionBody = { action?: string; content?: unknown; note?: unknown; expectedUpdatedAt?: unknown };
  let body: ActionBody | null = null;
  try { body = JSON.parse(raw) as ActionBody; } catch { body = null; }
  const action = body?.action;
  if (action !== "complete" && action !== "confirm-review" && action !== "request-review") return NextResponse.json({ message: "Ação inválida." }, { status: 400 });

  const version = await prisma.patientAnamnesis.findFirst({ where: { id: versionId, clinicId: user.clinicId, patientId }, select: { id: true, version: true, status: true, content: true, auditLog: true, updatedAt: true } });
  if (!version) return NextResponse.json({ message: "Versão da anamnese não encontrada." }, { status: 404 });
  const now = new Date();
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  const audit = (name: string) => appendAudit(version.auditLog, { at: now.toISOString(), by: user.name, userId: user.id, action: name, ...(note ? { note } : {}) });

  if (action === "complete") {
    if (!canTransition(version.status, "CONCLUIDA") || version.status !== "RASCUNHO") return NextResponse.json({ message: "Esta versão já foi concluída." }, { status: 409 });
    if (typeof body?.expectedUpdatedAt !== "string" || !body.expectedUpdatedAt) return NextResponse.json({ message: "Informe a revisão do rascunho (expectedUpdatedAt)." }, { status: 400 });
    if (revisionConflict(body.expectedUpdatedAt, version.updatedAt)) return NextResponse.json({ message: staleDraftMessage, code: "stale" }, { status: 409 });
    const content = pruneEmptyRows(normalizeAnamnesisContent(body?.content ?? parseAnamnesisContent(version.content)));
    const check = completionCheck(content);
    if (!check.ok) return NextResponse.json({ message: check.errors[0], errors: check.errors }, { status: 400 });
    const result = await prisma.patientAnamnesis.updateMany({
      where: { id: version.id, clinicId: user.clinicId, patientId, status: "RASCUNHO", updatedAt: version.updatedAt },
      data: { status: "CONCLUIDA", content: JSON.stringify(content), completedBy: user.name, completedAt: now, updatedBy: user.name, auditLog: audit("completed") },
    });
    if (!result.count) return NextResponse.json({ message: staleDraftMessage, code: "stale" }, { status: 409 });
  } else {
    // Revisão só se aplica à versão atual (a concluída de maior número).
    const finals = await prisma.patientAnamnesis.findMany({ where: { clinicId: user.clinicId, patientId, status: { in: ["CONCLUIDA", "PENDENTE_REVISAO"] } }, select: { id: true, version: true, status: true } });
    if (currentVersion(finals)?.id !== version.id) return NextResponse.json({ message: "Só a versão atual da anamnese pode ser revisada." }, { status: 409 });
    if (action === "confirm-review") {
      // Confirmar sobre uma versão já válida só registra a conferência; sobre PENDENTE_REVISAO devolve a versão a CONCLUIDA.
      const result = await prisma.patientAnamnesis.updateMany({
        where: { id: version.id, clinicId: user.clinicId, patientId, status: { in: ["CONCLUIDA", "PENDENTE_REVISAO"] } },
        data: { status: "CONCLUIDA", reviewConfirmedBy: user.name, reviewConfirmedAt: now, updatedBy: user.name, auditLog: audit("review-confirmed") },
      });
      if (!result.count) return NextResponse.json({ message: "O estado da anamnese mudou. Atualize a página." }, { status: 409 });
    } else {
      if (!note) return NextResponse.json({ message: "Informe o motivo da revisão." }, { status: 400 });
      if (!canTransition(version.status, "PENDENTE_REVISAO")) return NextResponse.json({ message: "Esta versão já está marcada para revisão." }, { status: 409 });
      const result = await prisma.patientAnamnesis.updateMany({
        where: { id: version.id, clinicId: user.clinicId, patientId, status: "CONCLUIDA" },
        data: { status: "PENDENTE_REVISAO", reviewRequestedBy: user.name, reviewRequestedAt: now, reviewReason: note, updatedBy: user.name, auditLog: audit("review-requested") },
      });
      if (!result.count) return NextResponse.json({ message: "O estado da anamnese mudou. Atualize a página." }, { status: 409 });
    }
  }
  const updated = await prisma.patientAnamnesis.findFirst({ where: { id: version.id, clinicId: user.clinicId, patientId }, select: anamnesisMetaSelect });
  return NextResponse.json({ version: updated });
}
