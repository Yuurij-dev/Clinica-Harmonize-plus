import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { checkUpload, maxUploadBytes, sanitizeFileName } from "@/lib/clinical-files-rules";
import { auditEntry, findPatientScoped, readUploadForm } from "@/lib/clinical-files-server";
import { parseEvaluationPhotoFields, resolvePhotoDimensions } from "@/lib/evaluation-photo-rules";
import { appendAfterPhoto, afterPhase, sessionNotStartedMessage } from "@/lib/session-after-photo-rules";
import { readImageSize } from "@/lib/thumb";

// Anexa UMA foto "Imediatamente após" à sessão em execução da jornada (app mobile). Só acrescenta: as demais fotos da sessão ficam intactas.
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
  const fields = parseEvaluationPhotoFields({ category: form.get("category"), width: form.get("width"), height: form.get("height"), name: form.get("name"), journeyId: form.get("journeyId") });
  if (!fields.ok) return NextResponse.json({ message: fields.message }, { status: fields.status });
  const input = fields.value;
  if (!input.journeyId) return NextResponse.json({ message: "Informe o tratamento." }, { status: 400 });
  const journeyId = input.journeyId;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes, file.type || undefined, { imageOnly: true });
  if (!check.ok) return NextResponse.json({ message: check.message }, { status: check.status });
  const size = resolvePhotoDimensions(input, await readImageSize(bytes));
  if (!size.ok) return NextResponse.json({ message: size.message }, { status: 400 });
  const name = sanitizeFileName(input.name || file.name, "Foto").replace(/\.(jpe?g|png|webp)$/i, "");
  const imageUrl = `data:${check.file.mime};base64,${Buffer.from(bytes).toString("base64")}`;

  if (!await prisma.patientJourney.findFirst({ where: { id: journeyId, patientId, clinicId, archivedAt: null }, select: { id: true } })) {
    return NextResponse.json({ message: "Tratamento não encontrado." }, { status: 404 });
  }

  const photo = { id: crypto.randomUUID().replace(/-/g, ""), phase: afterPhase, name, category: input.category, width: size.width, height: size.height, imageUrl };
  const outcome = await prisma.$transaction(async (tx) => {
    // Lock por paciente: o JSON de fotos é lido, ampliado e regravado; envios simultâneos não podem perder foto um do outro.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`session-photo:${patientId}`}, 0))`;
    const session = await tx.patientProcedureSession.findFirst({ where: { patientId, clinicId, journeyId, status: "Em execução" }, orderBy: { updatedAt: "desc" }, select: { id: true, status: true, photos: true, auditLog: true, updatedAt: true } });
    if (!session) return { error: NextResponse.json({ message: sessionNotStartedMessage }, { status: 409 }) };
    const appended = appendAfterPhoto(session.photos, photo);
    if (!appended.ok) return { error: NextResponse.json({ message: appended.message }, { status: appended.status }) };
    let log: unknown[] = [];
    try { const parsed: unknown = JSON.parse(session.auditLog); if (Array.isArray(parsed)) log = parsed; } catch { /* histórico ilegível: recomeça */ }
    const auditLog = JSON.stringify([...log, { at: new Date().toISOString(), actor: user.name, action: "Foto de depois enviada pelo app", fields: ["photos"] }].slice(-100));
    // O PATCH do web não toma o lock: a gravação só vale se a sessão não mudou desde a leitura (mesma checagem de updatedAt do PATCH); senão não sobrescreve.
    const saved = await tx.patientProcedureSession.updateMany({ where: { id: session.id, patientId, clinicId, status: "Em execução", updatedAt: session.updatedAt }, data: { photos: appended.json, auditLog, updatedBy: user.name } });
    if (!saved.count) return { error: NextResponse.json({ message: "A sessão foi alterada ou encerrada. Tente enviar a foto novamente." }, { status: 409 }) };
    await auditEntry(user, patientId, "PHOTO", `session:${photo.id}`, "UPLOAD", { fileName: name, category: input.category }, tx);
    return { session: { id: session.id, status: session.status } };
  }, { maxWait: 10_000, timeout: 30_000 });

  if ("error" in outcome) return outcome.error;
  return NextResponse.json({ session: outcome.session, photo: { id: photo.id, name, category: input.category, width: size.width, height: size.height } }, { status: 201 });
}
