import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { duplicateCpfResponse, rejectInvalidCpf } from "@/lib/patient-cpf";
import { patientCreatedSelect, patientListSelect, searchPatientIds, withCurrentStage } from "@/lib/patient-list-server";
import { cpfForRole, patientsForRole } from "@/lib/patient-cpf-mask";
import { paginationMeta, parsePatientListQuery, type PatientSort } from "@/lib/patient-list-rules";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { formatCpf, formatPhone } from "@/lib/input-masks";
import { birthDateFromPtBr, fieldMaxLength, normalizeName, PRIVACY_CONSENT_VERSION, validateRegistration } from "@/lib/patient-registration-rules";

// Lista paginada no servidor. Sem parâmetros: página 1, 20 por página, ordem por nome. page/pageSize inválidos viram valores
// seguros (pageSize máx. 100); página além do fim devolve lista vazia com o total correto. `summary` conta a clínica toda.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user, "patients:access");
  if (denied) return denied;

  const { page, pageSize, q, status, sort } = parsePatientListQuery(new URL(request.url).searchParams);
  const skip = (page - 1) * pageSize;
  const clinicId = user.clinicId;

  const [listed, statusGroups, clinic] = await Promise.all([
    q ? listBySearch(clinicId, { q, status, sort, skip, take: pageSize }) : listPlain(clinicId, { status, sort, skip, take: pageSize }),
    prisma.patient.groupBy({ by: ["status"], where: { clinicId }, _count: { _all: true } }),
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { autoAdvancePatientJourneyEnabled: true } }),
  ]);
  const byStatus = Object.fromEntries(statusGroups.map((group) => [group.status, group._count._all]));
  const summary = { total: statusGroups.reduce((sum, group) => sum + group._count._all, 0), byStatus };
  return NextResponse.json({ patients: patientsForRole(user.role, await withCurrentStage(clinicId, listed.patients, clinic?.autoAdvancePatientJourneyEnabled ?? true), user.rolePermissions), pagination: paginationMeta(page, pageSize, listed.total), summary });
}

async function listPlain(clinicId: string, options: { status: string; sort: PatientSort; skip: number; take: number }) {
  const where = { clinicId, ...(options.status ? { status: options.status } : {}) };
  const [patients, total] = await Promise.all([
    prisma.patient.findMany({
      where,
      orderBy: options.sort === "recent" ? [{ createdAt: "desc" }, { id: "asc" }] : [{ name: "asc" }, { id: "asc" }],
      skip: options.skip,
      take: options.take,
      select: patientListSelect,
    }),
    prisma.patient.count({ where }),
  ]);
  return { patients, total };
}

async function listBySearch(clinicId: string, options: { q: string; status: string; sort: PatientSort; skip: number; take: number }) {
  const found = await searchPatientIds(clinicId, { ...options, fields: "list" });
  const rows = found.ids.length ? await prisma.patient.findMany({ where: { id: { in: found.ids }, clinicId }, select: patientListSelect }) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return { patients: found.ids.map((id) => byId.get(id)).filter((row): row is (typeof rows)[number] => Boolean(row)), total: found.total };
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "patients:manage");
  if (denied) return denied;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ message: "Dados do cadastro inválidos." }, { status: 400 });
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
  const tooLong = Object.keys(body).find((key) => text(key).length > fieldMaxLength(key));
  if (tooLong) return NextResponse.json({ message: `O texto informado é longo demais (máximo de ${fieldMaxLength(tooLong)} caracteres).`, fields: { [tooLong]: "Texto longo demais." } }, { status: 400 });
  const digits = (key: string) => text(key).replace(/\D/g, "");

  if (text("cpf").includes("*") || text("legalGuardianCpf").includes("*")) return NextResponse.json({ message: "Informe o CPF completo, sem asteriscos." }, { status: 400 });
  const careType = text("careType") === "Convênio" ? "Convênio" : "Particular";
  const errors = validateRegistration({
    name: normalizeName(text("name")), birthDate: text("birthDate"), cpf: text("cpf"), phone: text("phone"), email: text("email"), postalCode: text("postalCode"),
    emergencyContactPhone: text("emergencyContactPhone"),
    legalGuardianName: text("legalGuardianName"), legalGuardianCpf: text("legalGuardianCpf"), legalGuardianPhone: text("legalGuardianPhone"), legalGuardianRelationship: text("legalGuardianRelationship"),
    sex: text("sex"), referralSource: text("referralSource"), emergencyContactRelationship: text("emergencyContactRelationship"),
    careType, insuranceProvider: text("insuranceProvider"), insuranceCardNumber: text("insuranceCardNumber"), privacyConsent: body.privacyConsent === true,
  });
  const firstError = Object.values(errors)[0];
  if (firstError) return NextResponse.json({ message: firstError, fields: errors }, { status: 400 });

  const birth = birthDateFromPtBr(text("birthDate"));
  if (!birth.ok) return NextResponse.json({ message: birth.message }, { status: 400 });
  const minor = birth.age < 18;
  // CPF e telefone gravados no mesmo formato dos cadastros existentes (a unicidade compara o texto). Vazio vira NULL,
  // porque o índice único (clínica + CPF) aceita vários NULL, mas não várias strings vazias.
  const cpf = digits("cpf") ? formatCpf(digits("cpf")) : null;
  const phone = formatPhone(digits("phone") || digits("legalGuardianPhone"));

  const cpfError = await rejectInvalidCpf(user.clinicId, cpf);
  if (cpfError) return cpfError;

  const now = new Date();
  const optional = (key: string) => text(key) || null;

  const patient = await prisma.patient.create({
    data: {
      name: normalizeName(text("name")),
      cpf,
      phone,
      age: birth.age,
      birthDate: new Date(`${birth.iso}T12:00:00.000Z`),
      email: text("email").toLowerCase() || null, socialName: optional("socialName"), sex: optional("sex"),
      profession: optional("profession"), referralSource: optional("referralSource"),
      postalCode: digits("postalCode") || null, address: optional("address"),
      addressNumber: optional("addressNumber"), addressComplement: optional("addressComplement"),
      neighborhood: optional("neighborhood"), city: optional("city"), state: optional("state")?.toUpperCase().slice(0, 2) ?? null,
      emergencyContactName: optional("emergencyContactName"),
      emergencyContactPhone: digits("emergencyContactPhone") ? formatPhone(digits("emergencyContactPhone")) : null,
      emergencyContactRelationship: optional("emergencyContactRelationship"),
      legalGuardianName: minor ? normalizeName(text("legalGuardianName")) : null,
      legalGuardianCpf: minor ? formatCpf(digits("legalGuardianCpf")) : null,
      legalGuardianPhone: minor ? formatPhone(digits("legalGuardianPhone")) : null,
      legalGuardianRelationship: minor ? text("legalGuardianRelationship") : null,
      careType,
      insuranceProvider: careType === "Convênio" ? text("insuranceProvider") : null,
      insuranceCardNumber: careType === "Convênio" ? text("insuranceCardNumber") : null,
      privacyConsentAt: now, privacyConsentVersion: PRIVACY_CONSENT_VERSION, whatsappReminders: body.whatsappReminders === true,
      status: text("status") || "Ativa",
      lastVisit: parseDate(text("lastVisit")),
      nextReturn: parseDate(text("nextReturn")),
      totalValue: typeof body.totalValue === "number" && Number.isFinite(body.totalValue) ? Math.max(0, Math.round(body.totalValue)) : 0,
      clinicId: user.clinicId,
    },
    // Resposta enxuta: só os campos que a tela usa (nunca o auditLog nem o CPF do responsável).
    select: patientCreatedSelect,
  }).catch((error: unknown) => duplicateCpfResponse(error) ?? Promise.reject(error));
  if (patient instanceof NextResponse) return patient;
  return NextResponse.json({ patient: cpfForRole(user.role, patient, user.rolePermissions) }, { status: 201 });
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
