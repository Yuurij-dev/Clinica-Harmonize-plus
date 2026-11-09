import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { clinicToday, dateOnly } from "@/lib/clinic-time";
import { dateBounds, rangeFor, requestedPeriod, requestedReference } from "@/lib/finance";
import { addDays, financeSeries, flowWindow, isFlowGranularity } from "@/lib/finance-rules";
import { prisma } from "@/lib/prisma";

// Série do fluxo financeiro. ?granularity=day|week|month (padrão day) &period= &date= como em /api/finance/summary.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "finance:access")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const granularity = params.get("granularity") ?? "day";
  const date = requestedReference(params);
  if (!isFlowGranularity(granularity)) return NextResponse.json({ message: "Granularidade inválida." }, { status: 400 });
  if (!date) return NextResponse.json({ message: "Data inválida." }, { status: 400 });
  const period = requestedPeriod(request);
  const range = rangeFor(period, date);
  const window = flowWindow(granularity, range, date);
  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({ where: { clinicId: user.clinicId, status: "Pago", date: { gte: new Date(`${addDays(window.start, -1)}T00:00:00Z`), lte: new Date(`${addDays(window.end, 2)}T00:00:00Z`) } }, select: { valueCents: true, status: true, date: true } }),
    prisma.expense.findMany({ where: { clinicId: user.clinicId, status: "paid", paidOn: dateBounds(window) }, select: { amountCents: true, status: true, dueOn: true, paidOn: true } }),
  ]);
  const series = financeSeries({
    granularity,
    range,
    reference: date,
    payments: payments.map((payment) => ({ valueCents: payment.valueCents, status: payment.status, date: clinicToday(payment.date) })),
    expenses: expenses.map((expense) => ({ amountCents: expense.amountCents, status: expense.status, dueOn: dateOnly(expense.dueOn), paidOn: expense.paidOn ? dateOnly(expense.paidOn) : null })),
  });
  return NextResponse.json({ granularity, period, date, range, series });
}
