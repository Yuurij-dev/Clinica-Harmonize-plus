import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accentFrom, accentTo, cpfSearchPlan, escapeLikePattern, normalizeSearchText, searchDigits, type PatientSort } from "@/lib/patient-list-rules";

// Pacientes da clínica que casam com a busca, sem acento nem caixa. "list" pesquisa nome, telefone e status (como a tela de
// Clientes sempre fez); "lookup" pesquisa nome e CPF (seletores de paciente). Devolve só ids + total; o chamador busca os campos.
// `fullCpfAccess` (só no lookup): false para STAFF, que busca CPF apenas pelo número inteiro (ver cpfSearchPlan); a lista não busca CPF.
export async function searchPatientIds(clinicId: string, options: { q: string; fields: "list" | "lookup"; fullCpfAccess?: boolean; status?: string; sort: PatientSort; skip: number; take: number }) {
  const pattern = `%${escapeLikePattern(normalizeSearchText(options.q))}%`;
  const fullCpf = options.fullCpfAccess ?? false;
  const cpfInText = options.fields === "lookup" && fullCpf;
  const haystack = options.fields === "lookup" ? (cpfInText ? Prisma.sql`coalesce("name", '') || ' ' || coalesce("cpf", '')` : Prisma.sql`coalesce("name", '')`) : Prisma.sql`"name" || ' ' || "phone" || ' ' || "status"`;
  // normalize(NFC) antes do translate: nome com acento decomposto (NFD, ex.: colado do macOS) também é achado. Exige Postgres 13+.
  const textMatch = Prisma.sql`lower(translate(normalize(${haystack}, NFC), ${accentFrom}::text, ${accentTo}::text)) LIKE ${pattern}::text ESCAPE '\\'`;
  // Busca só numérica (3+ dígitos) também compara dígitos: CPF no lookup, telefone na lista, com ou sem máscara.
  const plan = options.fields === "lookup" ? cpfSearchPlan(options.q, fullCpf) : (() => { const digits = searchDigits(options.q); return digits ? { digits, exact: false } : null; })();
  const digitColumn = options.fields === "lookup" ? Prisma.sql`"cpf"` : Prisma.sql`"phone"`;
  const digitMatch = !plan ? Prisma.empty
    : plan.exact ? Prisma.sql` OR regexp_replace(coalesce(${digitColumn}, ''), '\\D', '', 'g') = ${plan.digits}::text`
    : Prisma.sql` OR regexp_replace(coalesce(${digitColumn}, ''), '\\D', '', 'g') LIKE ${`%${plan.digits}%`}::text`;
  const where = Prisma.sql`"clinicId" = ${clinicId}
    ${options.status ? Prisma.sql`AND "status" = ${options.status}` : Prisma.empty}
    AND (${textMatch}${digitMatch})`;
  const order = options.sort === "recent" ? Prisma.sql`"createdAt" DESC, "id" ASC` : Prisma.sql`"name" ASC, "id" ASC`;
  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Patient" WHERE ${where} ORDER BY ${order} LIMIT ${options.take} OFFSET ${options.skip}`,
    prisma.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*) AS total FROM "Patient" WHERE ${where}`,
  ]);
  return { ids: rows.map((row) => row.id), total: Number(totals[0]?.total ?? 0) };
}

type StagePatient = { id: string; procedureRecords: Array<{ id: string }> };

// Etapa atual da jornada só para os pacientes informados (a página), nunca para a clínica inteira.
export async function currentStagesFor(clinicId: string, patients: StagePatient[]) {
  const patientIds = patients.map((patient) => patient.id);
  const procedureIds = patients.flatMap((patient) => patient.procedureRecords.map((record) => record.id));
  if (!patientIds.length) return new Map<string, "evaluation" | "quote" | "procedure" | "return">();
  const [withBefore, withAfter, approvedQuotes, anyQuotes, attended, evaluationsWithPhotos] = await Promise.all([
    prisma.patientProcedure.findMany({ where: { id: { in: procedureIds }, clinicId, AND: [{ beforePhoto: { not: null } }, { beforePhoto: { not: "" } }] }, select: { id: true } }),
    prisma.patientProcedure.findMany({ where: { id: { in: procedureIds }, clinicId, AND: [{ afterPhoto: { not: null } }, { afterPhoto: { not: "" } }] }, select: { id: true } }),
    prisma.quote.findMany({ where: { clinicId, patientId: { in: patientIds }, status: { in: ["Aprovado", "Pago"] } }, select: { patientId: true }, distinct: ["patientId"] }),
    prisma.quote.findMany({ where: { clinicId, patientId: { in: patientIds } }, select: { patientId: true }, distinct: ["patientId"] }),
    prisma.appointment.findMany({ where: { clinicId, patientId: { in: patientIds }, status: { in: ["Atendido", "Finalizado"] } }, select: { patientId: true }, distinct: ["patientId"] }),
    prisma.evaluation.findMany({ where: { clinicId, patientId: { in: patientIds }, photos: { some: {} } }, select: { patientId: true }, distinct: ["patientId"] }),
  ]);
  const beforeIds = new Set(withBefore.map((record) => record.id));
  const afterIds = new Set(withAfter.map((record) => record.id));
  const approvedPatientIds = new Set(approvedQuotes.map((quote) => quote.patientId));
  const quotedPatientIds = new Set(anyQuotes.map((quote) => quote.patientId));
  const attendedPatientIds = new Set(attended.map((appointment) => appointment.patientId));
  const evaluatedPatientIds = new Set(evaluationsWithPhotos.map((evaluation) => evaluation.patientId));
  const stages = new Map<string, "evaluation" | "quote" | "procedure" | "return">();
  for (const patient of patients) {
    const latestProcedureId = patient.procedureRecords[0]?.id;
    stages.set(patient.id, latestProcedureId && afterIds.has(latestProcedureId) ? "return"
      : (latestProcedureId && beforeIds.has(latestProcedureId)) || approvedPatientIds.has(patient.id) ? "procedure"
      : attendedPatientIds.has(patient.id) ? "return"
      : quotedPatientIds.has(patient.id) || evaluatedPatientIds.has(patient.id) ? "quote"
      : "evaluation");
  }
  return stages;
}

export const patientListSelect = {
  id: true, name: true, cpf: true, phone: true, age: true, status: true,
  lastVisit: true, nextReturn: true, totalValue: true, createdAt: true,
  procedureRecords: { orderBy: { performedAt: "desc" }, take: 1, select: { id: true } },
} satisfies Prisma.PatientSelect;

export async function withCurrentStage<T extends StagePatient>(clinicId: string, patients: T[]) {
  const stages = await currentStagesFor(clinicId, patients);
  return patients.map(({ procedureRecords, ...patient }) => {
    void procedureRecords;
    return { ...patient, currentStage: stages.get(patient.id) ?? "evaluation" };
  });
}
