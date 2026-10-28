import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { checkUpload, maxUploadBytes, sanitizeFileName } from "@/lib/clinical-files-rules";
import { auditEntry, findPatientScoped, readUploadForm } from "@/lib/clinical-files-server";
import { decideTargetEvaluation, draftStatus, evaluationPhotosFull, parseEvaluationPhotoFields, resolvePhotoDimensions } from "@/lib/evaluation-photo-rules";
import { ensurePatientJourney } from "@/lib/patient-journey";
import { readImageSize } from "@/lib/thumb";

// Anexa UMA foto à avaliação (app mobile). Só acrescenta: nunca apaga nem recria as outras fotos, ao contrário do PUT da avaliação.
// O PUT (deleteMany + createMany, mesmo lock deste POST) mantém a foto gravada que o editor não conhecia (knownPhotoIds) e não enviou; o editor
// também busca sozinho (~5 s) as fotos novas e as anexa ao estado. Limitação residual: cliente antigo, sem knownPhotoIds, ainda recria a lista inteira
// e descarta fotos enviadas pelo app depois do seu carregamento. Com knownPhotoIds, o PUT cruzando com este POST não perde foto.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:write");
  if (denied) return denied;
  const patientId = (await params).id;
  const clinicId = user.clinicId;
  if (!await findPatientScoped(clinicId, patientId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  // 413 antes de bufferizar o corpo.
  const read = await readUploadForm(request);
  if ("response" in read) return read.response;
  const form = read.form;
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Envie uma foto." }, { status: 400 });
  if (file.size > maxUploadBytes) return NextResponse.json({ message: "A foto excede 4 MB." }, { status: 413 });
  const fields = parseEvaluationPhotoFields({ category: form.get("category"), width: form.get("width"), height: form.get("height"), name: form.get("name"), evaluationId: form.get("evaluationId"), journeyId: form.get("journeyId") });
  if (!fields.ok) return NextResponse.json({ message: fields.message }, { status: fields.status });
  const input = fields.value;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes, file.type || undefined, { imageOnly: true });
  if (!check.ok) return NextResponse.json({ message: check.message }, { status: check.status });
  const size = resolvePhotoDimensions(input, await readImageSize(bytes));
  if (!size.ok) return NextResponse.json({ message: size.message }, { status: 400 });
  const name = sanitizeFileName(input.name || file.name, "Foto").replace(/\.(jpe?g|png|webp)$/i, "");
  const imageUrl = `data:${check.file.mime};base64,${Buffer.from(bytes).toString("base64")}`;

  if (input.journeyId && !await prisma.patientJourney.findFirst({ where: { id: input.journeyId, patientId, clinicId, archivedAt: null }, select: { id: true } })) {
    return NextResponse.json({ message: "Tratamento não encontrado." }, { status: 404 });
  }

  const outcome = await prisma.$transaction(async (tx) => {
    // Um lock por paciente serializa envios simultâneos: sortOrder sem colisão e uma única avaliação rascunho criada.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evaluation-photo:${patientId}`}, 0))`;

    const requested = input.evaluationId ? await tx.evaluation.findFirst({ where: { id: input.evaluationId, patientId, clinicId }, select: { id: true, status: true, journeyId: true } }) : null;
    if (requested && input.journeyId && requested.journeyId !== input.journeyId) return { error: NextResponse.json({ message: "A avaliação pertence a outro tratamento." }, { status: 400 }) };
    // Sem avaliação pedida, o rascunho mais recente da jornada ativa (a pedida ou a mais antiga ativa).
    const journey = input.evaluationId ? null : await ensurePatientJourney(patientId, clinicId, input.journeyId, tx);
    const latestDraft = journey ? await tx.evaluation.findFirst({ where: { patientId, clinicId, journeyId: journey.id, status: draftStatus }, orderBy: { updatedAt: "desc" }, select: { id: true } }) : null;
    const decision = decideTargetEvaluation({ requestedId: input.evaluationId, requested, latestDraft });
    if (decision.action === "notFound") return { error: NextResponse.json({ message: "Avaliação não encontrada." }, { status: 404 }) };
    if (decision.action === "closed") return { error: NextResponse.json({ message: "Avaliação já concluída; crie uma nova avaliação pelo sistema." }, { status: 409 }) };

    const created = decision.action === "create";
    const evaluation = decision.action === "use"
      ? { id: decision.evaluationId, status: draftStatus }
      : await tx.evaluation.create({ data: { patientId, clinicId, journeyId: journey?.id, professional: journey?.professional?.trim() || user.name, status: draftStatus }, select: { id: true, status: true } });

    const stats = await tx.evaluationPhoto.aggregate({ where: { evaluationId: evaluation.id }, _count: { _all: true }, _max: { sortOrder: true } });
    if (evaluationPhotosFull(stats._count._all)) return { error: NextResponse.json({ message: "A avaliação já tem o máximo de 20 fotos." }, { status: 409 }) };

    const photo = await tx.evaluationPhoto.create({
      data: { evaluationId: evaluation.id, name, imageUrl, width: size.width, height: size.height, category: input.category, sortOrder: (stats._max.sortOrder ?? -1) + 1, annotations: "[]" },
      select: { id: true, name: true, category: true, width: true, height: true, sortOrder: true },
    });
    // Traz a avaliação para o topo da lista (o editor abre a mais recente).
    await tx.evaluation.update({ where: { id: evaluation.id }, data: { updatedAt: new Date() }, select: { id: true } });
    await auditEntry(user, patientId, "PHOTO", `evaluation:${photo.id}`, "UPLOAD", { fileName: name, category: input.category }, tx);
    return { evaluation, created, photo, photoCount: stats._count._all + 1 };
  }, { maxWait: 10_000, timeout: 30_000 });

  if ("error" in outcome) return outcome.error;
  return NextResponse.json({ evaluation: { id: outcome.evaluation.id, status: outcome.evaluation.status, photoCount: outcome.photoCount, created: outcome.created }, photo: outcome.photo }, { status: 201 });
}
