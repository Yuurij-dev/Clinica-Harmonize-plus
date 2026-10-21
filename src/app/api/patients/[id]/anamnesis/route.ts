import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { anamnesisFullSelect, findEvaluationSource, loadAnamnesisOverview, serializeFull } from "@/lib/anamnesis-store";
import { appendAudit, contentFromEvaluation, currentVersion, emptyAnamnesisContent, nextVersionNumber, normalizeAnamnesisContent, openDraft, parseAnamnesisContent, revisionConflict, staleDraftMessage, type AnamnesisOrigin } from "@/lib/anamnesis-rules";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const maxBodyContentLength = 120_000;

async function findPatient(patientId: string, clinicId: string) {
  return prisma.patient.findFirst({ where: { id: patientId, clinicId }, select: { id: true } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  if (!await findPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  return NextResponse.json(await loadAnamnesisOverview(user.clinicId, patientId, can(user.role, "anamnesis:read")));
}

// Cria (ou devolve) o rascunho da anamnese. Nunca altera uma versão concluída: editar gera a versão seguinte.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "anamnesis:write");
  if (denied) return denied;
  const patientId = (await params).id;
  if (!await findPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as { from?: string; evaluationId?: unknown } | null;
  const from = body?.from ?? "empty";
  if (!["empty", "current", "evaluation"].includes(from)) return NextResponse.json({ message: "Origem inválida para a anamnese." }, { status: 400 });

  const versions = await prisma.patientAnamnesis.findMany({ where: { clinicId: user.clinicId, patientId }, select: { id: true, version: true, status: true } });
  const existingDraft = openDraft(versions);
  if (existingDraft) {
    const draft = await prisma.patientAnamnesis.findFirst({ where: { id: existingDraft.id, clinicId: user.clinicId, patientId }, select: anamnesisFullSelect });
    if (draft) return NextResponse.json({ draft: serializeFull(draft), created: false });
  }

  let content = emptyAnamnesisContent();
  let origin: AnamnesisOrigin = "empty";
  let basedOnVersion: number | null = null;
  if (from === "current") {
    const current = currentVersion(versions);
    const source = current ? await prisma.patientAnamnesis.findFirst({ where: { id: current.id, clinicId: user.clinicId, patientId }, select: { content: true, version: true } }) : null;
    if (!source) return NextResponse.json({ message: "Não há anamnese concluída para criar uma nova versão." }, { status: 409 });
    content = parseAnamnesisContent(source.content);
    origin = "current-version";
    basedOnVersion = source.version;
  } else if (from === "evaluation") {
    const requestedId = typeof body?.evaluationId === "string" && body.evaluationId ? body.evaluationId : null;
    const evaluation = await findEvaluationSource(user.clinicId, patientId, requestedId);
    if (!evaluation) return NextResponse.json({ message: "Nenhuma avaliação com dados de anamnese para importar." }, { status: 404 });
    content = contentFromEvaluation(evaluation);
    origin = "evaluation";
  }

  try {
    const created = await prisma.patientAnamnesis.create({
      data: {
        clinicId: user.clinicId, patientId, version: nextVersionNumber(versions), status: "RASCUNHO", content: JSON.stringify(content), origin, basedOnVersion,
        createdBy: user.name, updatedBy: user.name,
        auditLog: appendAudit("[]", { at: new Date().toISOString(), by: user.name, userId: user.id, action: "draft-created", note: origin }),
      },
      select: anamnesisFullSelect,
    });
    return NextResponse.json({ draft: serializeFull(created), created: true }, { status: 201 });
  } catch (error) {
    // Duas abas criando ao mesmo tempo: o índice (patientId, version) barra a segunda; devolve o rascunho já criado.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const latest = await prisma.patientAnamnesis.findMany({ where: { clinicId: user.clinicId, patientId, status: "RASCUNHO" }, orderBy: { version: "desc" }, take: 1, select: anamnesisFullSelect });
      if (latest[0]) return NextResponse.json({ draft: serializeFull(latest[0]), created: false });
      return NextResponse.json({ message: "Outra versão da anamnese foi criada agora. Atualize a página." }, { status: 409 });
    }
    throw error;
  }
}

// Autosave do rascunho. Só RASCUNHO aceita alteração de conteúdo.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "anamnesis:write");
  if (denied) return denied;
  const patientId = (await params).id;
  if (!await findPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const raw = await request.text();
  if (raw.length > maxBodyContentLength) return NextResponse.json({ message: "O conteúdo da anamnese é grande demais." }, { status: 413 });
  type SaveBody = { draftId?: unknown; content?: unknown; expectedUpdatedAt?: unknown };
  let body: SaveBody | null = null;
  try { body = JSON.parse(raw) as SaveBody; } catch { body = null; }
  if (!body || typeof body.draftId !== "string" || typeof body.content !== "object" || body.content === null) return NextResponse.json({ message: "Envie o rascunho e o conteúdo da anamnese." }, { status: 400 });
  if (typeof body.expectedUpdatedAt !== "string" || !body.expectedUpdatedAt) return NextResponse.json({ message: "Informe a revisão do rascunho (expectedUpdatedAt)." }, { status: 400 });

  const draft = await prisma.patientAnamnesis.findFirst({ where: { id: body.draftId, clinicId: user.clinicId, patientId }, select: { id: true, status: true, updatedAt: true } });
  if (!draft) return NextResponse.json({ message: "Rascunho não encontrado." }, { status: 404 });
  if (draft.status !== "RASCUNHO") return NextResponse.json({ message: "Esta versão já foi concluída e não pode ser alterada. Crie uma nova versão." }, { status: 409 });
  if (revisionConflict(body.expectedUpdatedAt, draft.updatedAt)) return NextResponse.json({ message: staleDraftMessage, code: "stale" }, { status: 409 });
  try {
    // A revisão entra no filtro da própria escrita: se alguém gravou entre a leitura e aqui, nada é sobrescrito.
    const saved = await prisma.patientAnamnesis.update({
      where: { id: draft.id, clinicId: user.clinicId, patientId, status: "RASCUNHO", updatedAt: draft.updatedAt },
      data: { content: JSON.stringify(normalizeAnamnesisContent(body.content)), updatedBy: user.name },
      select: { updatedAt: true, updatedBy: true },
    });
    return NextResponse.json({ updatedAt: saved.updatedAt, updatedBy: saved.updatedBy });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return NextResponse.json({ message: staleDraftMessage, code: "stale" }, { status: 409 });
    throw error;
  }
}

// Descarta apenas um rascunho ainda não concluído. Versões concluídas nunca são apagadas.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "anamnesis:write");
  if (denied) return denied;
  const patientId = (await params).id;
  if (!await findPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const searchParams = new URL(request.url).searchParams;
  const draftId = searchParams.get("draftId");
  const expectedUpdatedAt = searchParams.get("expectedUpdatedAt");
  if (!draftId) return NextResponse.json({ message: "Informe o rascunho a descartar." }, { status: 400 });
  if (!expectedUpdatedAt) return NextResponse.json({ message: "Informe a revisão do rascunho (expectedUpdatedAt)." }, { status: 400 });
  const draft = await prisma.patientAnamnesis.findFirst({ where: { id: draftId, clinicId: user.clinicId, patientId, status: "RASCUNHO" }, select: { id: true, updatedAt: true } });
  if (!draft) return NextResponse.json({ message: "Rascunho não encontrado." }, { status: 404 });
  if (revisionConflict(expectedUpdatedAt, draft.updatedAt)) return NextResponse.json({ message: staleDraftMessage, code: "stale" }, { status: 409 });
  // A revisão também entra no filtro da exclusão: se alguém gravou no meio, nada é apagado.
  const result = await prisma.patientAnamnesis.deleteMany({ where: { id: draft.id, clinicId: user.clinicId, patientId, status: "RASCUNHO", updatedAt: draft.updatedAt } });
  if (!result.count) return NextResponse.json({ message: staleDraftMessage, code: "stale" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
