import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { cleanSearchQuery, parsePatientLookupLimit, patientLookupMinLength } from "@/lib/patient-list-rules";
import { searchPatientIds } from "@/lib/patient-list-server";
import { canSeeFullCpf, patientsForRole } from "@/lib/patient-cpf-mask";
import { prisma } from "@/lib/prisma";

// Busca limitada para seletores de paciente (agendamento, orçamento, pagamento): nome ou CPF, sem acento, no máximo `limit`
// (padrão 8, máx. 20) resultados. Sem termo devolve lista vazia: os seletores pesquisam sob demanda, nunca baixam todos.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const q = cleanSearchQuery(params.get("q"));
  const limit = parsePatientLookupLimit(params.get("limit"));
  if (q.length < patientLookupMinLength) return NextResponse.json({ patients: [] });

  const found = await searchPatientIds(user.clinicId, { q, fields: "lookup", fullCpfAccess: canSeeFullCpf(user.role), sort: "name", skip: 0, take: limit });
  const rows = found.ids.length ? await prisma.patient.findMany({ where: { id: { in: found.ids }, clinicId: user.clinicId }, select: { id: true, name: true, cpf: true } }) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const patients = found.ids.map((id) => byId.get(id)).filter((row): row is (typeof rows)[number] => Boolean(row));
  return NextResponse.json({ patients: patientsForRole(user.role, patients), total: found.total });
}
