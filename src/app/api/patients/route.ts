import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rejectInvalidCpf } from "@/lib/patient-cpf";
import { patientListSelect, searchPatientIds, withCurrentStage } from "@/lib/patient-list-server";
import { cpfForRole, isMaskedCpf, patientsForRole } from "@/lib/patient-cpf-mask";
import { paginationMeta, parsePatientListQuery, type PatientSort } from "@/lib/patient-list-rules";
import { prisma } from "@/lib/prisma";

// Lista paginada no servidor. Sem parâmetros: página 1, 20 por página, ordem por nome. page/pageSize inválidos viram valores
// seguros (pageSize máx. 100); página além do fim devolve lista vazia com o total correto. `summary` conta a clínica toda.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const { page, pageSize, q, status, sort } = parsePatientListQuery(new URL(request.url).searchParams);
  const skip = (page - 1) * pageSize;
  const clinicId = user.clinicId;

  const [listed, statusGroups] = await Promise.all([
    q ? listBySearch(clinicId, { q, status, sort, skip, take: pageSize }) : listPlain(clinicId, { status, sort, skip, take: pageSize }),
    prisma.patient.groupBy({ by: ["status"], where: { clinicId }, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(statusGroups.map((group) => [group.status, group._count._all]));
  const summary = { total: statusGroups.reduce((sum, group) => sum + group._count._all, 0), byStatus };
  return NextResponse.json({ patients: patientsForRole(user.role, await withCurrentStage(clinicId, listed.patients)), pagination: paginationMeta(page, pageSize, listed.total), summary });
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

  const body = await request.json().catch(() => null) as {
    name?: string;
    cpf?: string;
    phone?: string;
    age?: number;
    status?: string;
    lastVisit?: string;
    nextReturn?: string;
    totalValue?: number;
  } | null;

  const name = body?.name?.trim();
  const cpf = body?.cpf?.trim() || undefined;
  const phone = body?.phone?.trim();
  const age = Number(body?.age);
  if (!name || !phone || !Number.isInteger(age) || age < 0 || age > 130) {
    return NextResponse.json({ message: "Nome, telefone e idade válida são obrigatórios." }, { status: 400 });
  }
  if (isMaskedCpf(cpf)) return NextResponse.json({ message: "Informe o CPF completo, sem asteriscos." }, { status: 400 });
  const cpfError = await rejectInvalidCpf(user.clinicId, cpf);
  if (cpfError) return cpfError;

  const patient = await prisma.patient.create({
    data: {
      name,
      cpf,
      phone,
      age,
      status: body?.status?.trim() || "Ativa",
      lastVisit: parseDate(body?.lastVisit),
      nextReturn: parseDate(body?.nextReturn),
      totalValue: Number.isFinite(body?.totalValue) ? Math.max(0, Number(body?.totalValue)) : 0,
      clinicId: user.clinicId,
    },
  });
  return NextResponse.json({ patient: cpfForRole(user.role, patient) }, { status: 201 });
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
