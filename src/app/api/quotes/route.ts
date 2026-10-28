import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listLimit, listPeriodFilter, serializeQuote, toCents } from "@/lib/finance";
import { ensurePatientJourney } from "@/lib/patient-journey";
import type { QuoteLineInput } from "@/lib/quote-rules";
import { quoteDetails, quotePaymentMethods } from "@/lib/quote-server";
import { cpfForRole } from "@/lib/patient-cpf-mask";
import { matchPaymentQuotes } from "@/lib/patient-finance-rules";
import { denyUnless } from "@/lib/api-guards";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user, "quotes:access");
  if (denied) return denied;
  const searchParams = new URL(request.url).searchParams;
  const patientId = searchParams.get("patientId");
  const journeyId = searchParams.get("journeyId");
  if (!patientId) {
    // Lista da tela de Orçamentos: só as colunas da tabela, os mais recentes do período (sem details/notes, que crescem com o histórico).
    const createdAt = listPeriodFilter(searchParams);
    if (!createdAt) return NextResponse.json({ message: "Período inválido." }, { status: 400 });
    const recent = await prisma.quote.findMany({
      where: { clinicId: user.clinicId, ...(journeyId ? { journeyId } : {}), createdAt },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: listLimit + 1,
      select: { id: true, items: true, totalCents: true, status: true, expires: true, createdAt: true, patient: { select: { name: true } } },
    });
    return NextResponse.json({ quotes: recent.slice(0, listLimit).map(serializeQuote), hasMore: recent.length > listLimit });
  }
  const quotes = await prisma.quote.findMany({
    where: { clinicId: user.clinicId, patientId, ...(journeyId ? { journeyId } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      patient: { select: { name: true, cpf: true } },
      evaluation: { select: { professional: true } },
      clinic: { select: { name: true } },
    },
  });
  const serialized = quotes.map((quote) => serializeQuote({ ...quote, patient: cpfForRole(user.role, quote.patient, user.rolePermissions) }));

  const payments = await prisma.payment.findMany({
    where: { clinicId: user.clinicId, patientId, status: "Pago", ...(journeyId ? { journeyId } : {}) },
    orderBy: { date: "asc" },
    select: { id: true, journeyId: true, valueCents: true, status: true, date: true },
  });
  const matched = matchPaymentQuotes(
    payments.map(({ valueCents, date, ...payment }) => ({ ...payment, date: date.toISOString(), value: valueCents / 100 })),
    serialized.map((quote) => ({ ...quote, createdAt: quote.createdAt?.toISOString() })),
  );
  const paymentConfirmedQuoteIds = new Set([...matched.values()].map((quote) => quote.id));
  return NextResponse.json({ quotes: quotes.map((quote, index) => ({
    ...serialized[index],
    paymentConfirmed: paymentConfirmedQuoteIds.has(quote.id),
  })) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user, "quotes:manage");
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { patientId?: string; journeyId?: string; evaluationId?: string; items?: string; details?: QuoteLineInput[]; total?: number; expires?: string; paymentMethod?: string; installments?: number; notes?: string; status?: string } | null;
  const patient = body?.patientId ? await prisma.patient.findFirst({ where: { id: body.patientId, clinicId: user.clinicId } }) : null;
  const total = Number(body?.total);
  if (!patient) return NextResponse.json({ message: "Selecione um paciente para o orçamento." }, { status: 400 });
  if (body?.journeyId && !await prisma.patientJourney.findFirst({ where: { id: body.journeyId, patientId: patient.id, clinicId: user.clinicId, archivedAt: null }, select: { id: true } })) {
    return NextResponse.json({ message: "Tratamento não encontrado." }, { status: 404 });
  }
  const evaluation = body?.evaluationId ? await prisma.evaluation.findFirst({ where: { id: body.evaluationId, patientId: patient.id, clinicId: user.clinicId }, select: { id: true, journeyId: true } }) : null;
  if (body?.evaluationId && (!evaluation || (body.journeyId && evaluation.journeyId !== body.journeyId))) return NextResponse.json({ message: "A avaliação não pertence a este paciente ou tratamento." }, { status: 400 });
  const journeyId = body?.journeyId ?? evaluation?.journeyId ?? undefined;
  const journey = await ensurePatientJourney(patient.id, user.clinicId, journeyId);
  const paymentMethod = validPaymentMethod(body?.paymentMethod);
  let items = body?.items?.trim() ?? "";
  let totalCents = Number.isFinite(total) ? toCents(total) : 0;
  let details = "[]";
  if (body?.details !== undefined) {
    const calculated = await quoteDetails(body.details, user.clinicId);
    if (!calculated) return NextResponse.json({ message: "Revise os procedimentos, quantidades e descontos do orçamento." }, { status: 400 });
    items = calculated.items.map((item) => `${item.name} (${item.quantity}x)`).join(", ");
    totalCents = calculated.totalCents;
    details = JSON.stringify(calculated);
  }
  if (!items || (body?.details === undefined && !Number.isFinite(total))) return NextResponse.json({ message: "Selecione ao menos um procedimento e preencha o orçamento." }, { status: 400 });
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const installments = Number(body?.installments ?? 1);
  if (notes.length > 2000 || !Number.isInteger(installments) || installments < 1 || installments > 12) return NextResponse.json({ message: "Revise as observações e o número de parcelas." }, { status: 400 });
  const quote = await prisma.quote.create({ data: { clinicId: user.clinicId, patientId: patient.id, journeyId: journey.id, evaluationId: evaluation?.id, items, details, notes, installments, totalCents, paymentMethod, status: body?.status === "Rascunho" ? "Rascunho" : "Pendente", createdBy: user.name, updatedBy: user.name, expires: parseDate(body?.expires) }, include: { patient: { select: { name: true } } } });
  return NextResponse.json({ quote: serializeQuote(quote) }, { status: 201 });
}

function validPaymentMethod(value?: string) {
  return quotePaymentMethods.includes(value ?? "") ? value! : "Cartão de crédito";
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const parts = value.split("/");
  if (parts.length === 3) {
    const date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
