import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { auditEntry } from "@/lib/clinical-files-server";
import { removeStoredBytes, type StoredRef } from "@/lib/clinical-storage";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; journeyId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:write");
  if (denied) return denied;
  const { id: patientId, journeyId } = await params;
  const result = await prisma.$transaction(async (transaction) => {
    const journey = await transaction.patientJourney.findFirst({ where: { id: journeyId, patientId, clinicId: user.clinicId }, select: { id: true, name: true, quotes: { select: { status: true } } } });
    if (!journey) return { error: "Jornada não encontrada.", status: 404 as const };
    if (journey.quotes.some((quote) => ["Pago", "Aprovado"].includes(quote.status))) return { error: "Não é possível excluir uma jornada vinculada a orçamento aprovado ou pago.", status: 409 as const };

    const [appointments, evaluations, followUps, sessions] = await Promise.all([
      transaction.appointment.findMany({ where: { patientId, clinicId: user.clinicId, journeyId }, select: { id: true } }),
      transaction.evaluation.findMany({ where: { patientId, clinicId: user.clinicId, journeyId }, select: { id: true } }),
      transaction.patientProcedureFollowUp.findMany({ where: { patientId, clinicId: user.clinicId, journeyId }, select: { id: true, appointmentId: true } }),
      transaction.patientProcedureSession.findMany({ where: { patientId, clinicId: user.clinicId, journeyId }, select: { id: true } }),
    ]);
    const followUpAppointmentIds = followUps.flatMap(({ appointmentId }) => appointmentId ? [appointmentId] : []);
    const followUpAppointments = followUpAppointmentIds.length ? await transaction.appointment.findMany({ where: { id: { in: followUpAppointmentIds }, patientId, clinicId: user.clinicId }, select: { id: true } }) : [];
    const appointmentIds = [...new Set([...appointments.map(({ id }) => id), ...followUpAppointments.map(({ id }) => id)])];
    const encounterLinks = [
      ...(evaluations.length ? [{ encounterType: "evaluation", encounterId: { in: evaluations.map(({ id }) => id) } }] : []),
      ...(sessions.length ? [{ encounterType: "session", encounterId: { in: sessions.map(({ id }) => id) } }] : []),
      ...(followUps.length ? [{ encounterType: "followup", encounterId: { in: followUps.map(({ id }) => id) } }] : []),
    ];
    const [documents, photos] = await Promise.all([
      transaction.clinicalDocument.findMany({ where: { clinicId: user.clinicId, patientId, OR: [{ journeyId }, ...encounterLinks] }, select: { id: true, name: true, category: true, storageDriver: true, storageKey: true } }),
      transaction.clinicalPhoto.findMany({ where: { clinicId: user.clinicId, patientId, OR: [{ journeyId }, ...encounterLinks] }, select: { id: true, name: true, category: true, storageDriver: true, storageKey: true } }),
    ]);

    await Promise.all([
      ...documents.map((document) => auditEntry(user, patientId, "DOCUMENT", document.id, "DELETE", { fileName: document.name, category: document.category, note: `Excluído junto com a jornada "${journey.name}".` }, transaction)),
      ...photos.map((photo) => auditEntry(user, patientId, "PHOTO", photo.id, "DELETE", { fileName: photo.name, category: photo.category, note: `Excluído junto com a jornada "${journey.name}".` }, transaction)),
    ]);

    const pendingOutputLinks = [
      ...(appointmentIds.length ? [{ appointmentId: { in: appointmentIds } }] : []),
      ...(sessions.length ? [{ procedureSessionId: { in: sessions.map(({ id }) => id) } }] : []),
    ];
    if (pendingOutputLinks.length) await transaction.pendingStockOutput.deleteMany({ where: { clinicId: user.clinicId, OR: pendingOutputLinks } });
    await transaction.patientProcedureFollowUp.deleteMany({ where: { patientId, clinicId: user.clinicId, journeyId } });
    if (appointmentIds.length) await transaction.appointment.deleteMany({ where: { id: { in: appointmentIds }, patientId, clinicId: user.clinicId } });
    await transaction.patientProcedureSession.deleteMany({ where: { patientId, clinicId: user.clinicId, journeyId } });
    await transaction.patientProcedure.deleteMany({ where: { patientId, clinicId: user.clinicId, journeyId } });
    await transaction.evaluation.deleteMany({ where: { patientId, clinicId: user.clinicId, journeyId } });
    await transaction.quote.deleteMany({ where: { patientId, clinicId: user.clinicId, journeyId } });
    await transaction.payment.deleteMany({ where: { patientId, clinicId: user.clinicId, journeyId } });
    await transaction.clinicalDocument.deleteMany({ where: { clinicId: user.clinicId, patientId, OR: [{ journeyId }, ...encounterLinks] } });
    await transaction.clinicalPhoto.deleteMany({ where: { clinicId: user.clinicId, patientId, OR: [{ journeyId }, ...encounterLinks] } });
    await transaction.patientJourney.delete({ where: { id: journey.id } });
    return { journey: { id: journey.id, name: journey.name }, storedFiles: [...documents, ...photos] satisfies StoredRef[] };
  });
  if ("error" in result) return NextResponse.json({ message: result.error }, { status: result.status });
  await Promise.all(result.storedFiles.map(removeStoredBytes));
  return NextResponse.json({ journey: result.journey });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; journeyId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const { id: patientId, journeyId } = await params;
  const body = await request.json().catch(() => ({})) as { status?: string };
  const denied = denyUnless(user.role, "clinical:write");
  if (denied) return denied;
  if (body.status === "Cancelado") {
    const journey = await prisma.patientJourney.findFirst({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: null }, select: { id: true, quotes: { select: { status: true } } } });
    if (!journey) return NextResponse.json({ message: "Jornada não encontrada." }, { status: 404 });
    if (journey.quotes.some((quote) => ["Pago", "Aprovado"].includes(quote.status))) return NextResponse.json({ message: "Não é possível cancelar uma jornada vinculada a orçamento aprovado ou pago." }, { status: 409 });
    await prisma.patientJourney.update({ where: { id: journey.id }, data: { status: "Cancelado", archivedAt: new Date() } });
    return NextResponse.json({ status: "Cancelado" });
  }
  if (body.status !== "Concluído") {
    const restored = await prisma.patientJourney.updateMany({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: { not: null } }, data: { status: "Em andamento", archivedAt: null } });
    if (restored.count) return NextResponse.json({ restored: true });
    return NextResponse.json({ message: "Ação de jornada inválida." }, { status: 400 });
  }
  const journey = await prisma.patientJourney.findFirst({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: null }, select: { id: true, status: true, procedures: { select: { id: true } }, procedureSessions: { select: { status: true } } } });
  if (!journey) return NextResponse.json({ message: "Jornada não encontrada." }, { status: 404 });
  if (!journey.procedures.length && !journey.procedureSessions.some((session) => session.status === "Concluída")) return NextResponse.json({ message: "Registre ao menos uma sessão ou procedimento antes de concluir o tratamento." }, { status: 409 });
  if (journey.procedureSessions.some((session) => session.status !== "Concluída")) return NextResponse.json({ message: "Finalize as sessões em aberto antes de concluir o tratamento." }, { status: 409 });
  const completed = await prisma.patientJourney.updateMany({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: null, status: "Em andamento" }, data: { status: "Concluído" } });
  if (!completed.count && journey.status !== "Concluído") return NextResponse.json({ message: "Não foi possível concluir o tratamento. Atualize a página e tente novamente." }, { status: 409 });
  return NextResponse.json({ status: "Concluído" });
}
