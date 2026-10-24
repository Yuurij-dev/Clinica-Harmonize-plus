import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { clinicToday } from "../../src/lib/clinic-time.ts";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const password = `Autosave-${suffix}-test`;
const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let clinicId;
let userId;

async function request(path, method = "GET", body, cookie = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return { response, data };
}

async function main() {
  const clinic = await prisma.clinic.create({ data: { name: `Autosave Test ${suffix}`, slug: `autosave-test-${suffix}` } });
  clinicId = clinic.id;
  const user = await prisma.user.create({ data: { name: "Professional Test", email: `autosave-${suffix}@example.test`, passwordHash: await hash(password, 12), role: "ADMIN", emailVerifiedAt: new Date() } });
  userId = user.id;
  await prisma.clinicMembership.create({ data: { clinicId, userId, role: "ADMIN", isOwner: true } });
  const patient = await prisma.patient.create({ data: { clinicId, name: "Patient Autosave Test", phone: "11999990000", age: 30 } });
  const journey = await prisma.patientJourney.create({ data: { clinicId, patientId: patient.id, name: "Test Journey", professional: user.name } });
  const procedure = await prisma.procedure.create({ data: { clinicId, name: `Test Procedure ${suffix}`, category: "Test", price: 100, durationMinutes: 60, materials: "", margin: 0 } });
  const evaluation = await prisma.evaluation.create({ data: { clinicId, patientId: patient.id, journeyId: journey.id, professional: user.name, chiefComplaint: "Test", status: "Concluída" } });
  const quote = await prisma.quote.create({ data: { clinicId, patientId: patient.id, journeyId: journey.id, evaluationId: evaluation.id, items: procedure.name, totalCents: 10000, status: "Pago" } });
  const record = await prisma.patientProcedure.create({ data: { clinicId, patientId: patient.id, journeyId: journey.id, quoteId: quote.id, name: procedure.name, professional: user.name, performedAt: new Date() } });
  const session = await prisma.patientProcedureSession.create({ data: { clinicId, patientId: patient.id, journeyId: journey.id, evaluationId: evaluation.id, procedureId: record.id, quoteId: quote.id, procedureName: procedure.name, professional: user.name, performedAt: new Date(), status: "Concluída", createdBy: user.name, updatedBy: user.name } });
  const login = await request("/api/auth/login", "POST", { login: user.email, password });
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login did not set a session cookie.");
  const path = `/api/patients/${patient.id}/procedure-sessions/${session.id}/follow-ups?journeyId=${journey.id}`;
  const today = clinicToday();
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const futureDate = tomorrow.toISOString().slice(0, 10);
  const futureReturn = await prisma.appointment.create({ data: { clinicId, patientId: patient.id, journeyId: journey.id, procedure: `Retorno - ${procedure.name}`, professional: user.name, date: new Date(`${futureDate}T12:00:00-03:00`), time: "10:00", status: "Agendado" } });
  const earlyStart = await fetch(`${baseUrl}${path}`, { method: "PATCH", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "start-return", appointmentId: futureReturn.id }) });
  if (earlyStart.status !== 409) throw new Error("A future return was allowed to start early.");
  const returnAppointment = await prisma.appointment.create({ data: { clinicId, patientId: patient.id, journeyId: journey.id, procedure: `Retorno - ${procedure.name}`, professional: user.name, date: new Date(`${today}T12:00:00-03:00`), time: "10:00", status: "Agendado" } });
  const earlyRecord = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ complaints: "Before start", appointmentId: returnAppointment.id, photos: [] }) });
  if (earlyRecord.status !== 400) throw new Error("Return complaints were recorded before the appointment started.");
  await request(path, "PATCH", { action: "start-return", appointmentId: returnAppointment.id }, cookie);

  await request(path, "PUT", { complaints: "Draft complaint", observations: "Draft observation", guidanceText: "Draft guidance", appointmentId: returnAppointment.id, photos: [] }, cookie);
  const reopened = (await request(path, "GET", undefined, cookie)).data;
  if (reopened.draft?.complaints !== "Draft complaint" || reopened.draft?.observations !== "Draft observation" || reopened.followUps.length !== 0) throw new Error("Draft was not restored separately from clinical history.");

  await request(path, "PUT", { complaints: "Updated complaint", observations: "Updated draft", appointmentId: returnAppointment.id, photos: [] }, cookie);
  const updated = (await request(path, "GET", undefined, cookie)).data;
  if (updated.draft?.complaints !== "Updated complaint" || updated.draft?.observations !== "Updated draft" || updated.draft?.guidanceText !== "") throw new Error("Draft update was not persisted.");

  await request(path, "POST", { complaints: "Registered complaint", observations: "Registered evolution", appointmentId: returnAppointment.id, photos: [] }, cookie);
  const finalized = (await request(path, "GET", undefined, cookie)).data;
  if (finalized.draft !== null || finalized.followUps.length !== 1 || finalized.followUps[0].complaints !== "Registered complaint" || finalized.followUps[0].observations !== "Registered evolution" || finalized.followUps[0].appointment?.status !== "Atendido") throw new Error("Final record did not complete the return and replace the draft.");
  console.log("Follow-up draft API: save, restore, update, and register passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (clinicId) await prisma.clinic.delete({ where: { id: clinicId } }).catch((error) => { console.error("Test clinic cleanup failed:", error); process.exitCode = 1; });
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch((error) => { console.error("Test user cleanup failed:", error); process.exitCode = 1; });
  await prisma.$disconnect();
});
