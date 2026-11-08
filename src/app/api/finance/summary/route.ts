import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { clinicToday, dateOnly } from "@/lib/clinic-time";
import { dateBounds, ensureRecurringOccurrences, rangeFor, requestedPeriod, requestedReference } from "@/lib/finance";
import { addDays, financeCounts, financeTotals, previousRange } from "@/lib/finance-rules";
import { prisma } from "@/lib/prisma";

// ?period=today|week|month (padrão month) relativo a ?date=AAAA-MM-DD (padrão hoje).
// Mantém period/range/totals e acrescenta date, previousTotals (período anterior) e counts.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "finance:access")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  const date = requestedReference(new URL(request.url).searchParams);
  if (!date) return NextResponse.json({ message: "Data inválida." }, { status: 400 });
  await ensureRecurringOccurrences(user.clinicId);
  const period = requestedPeriod(request);
  const range = rangeFor(period, date);
  const previous = previousRange(period, range);
  const whole = { start: previous.start, end: range.end };
  // Pagamentos são timestamptz: busca com folga de um dia e filtra pela data da clínica nas regras.
  const paymentWindow = { gte: new Date(`${addDays(whole.start, -1)}T00:00:00Z`), lte: new Date(`${addDays(whole.end, 2)}T00:00:00Z`) };
  const bounds = dateBounds(whole);
  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({ where: { clinicId: user.clinicId, date: paymentWindow }, select: { valueCents: true, status: true, date: true } }),
    prisma.expense.findMany({ where: { clinicId: user.clinicId, status: { not: "cancelled" }, OR: [{ dueOn: bounds }, { paidOn: bounds }] }, select: { amountCents: true, status: true, dueOn: true, paidOn: true } }),
  ]);
  const paymentInputs = payments.map((payment) => ({ valueCents: payment.valueCents, status: payment.status, date: clinicToday(payment.date) }));
  const expenseInputs = expenses.map((expense) => ({ amountCents: expense.amountCents, status: expense.status, dueOn: dateOnly(expense.dueOn), paidOn: expense.paidOn ? dateOnly(expense.paidOn) : null }));
  return NextResponse.json({
    period,
    date,
    range,
    totals: financeTotals({ range, payments: paymentInputs, expenses: expenseInputs }),
    previousRange: previous,
    previousTotals: financeTotals({ range: previous, payments: paymentInputs, expenses: expenseInputs }),
    counts: financeCounts({ range, payments: paymentInputs, expenses: expenseInputs }),
  });
}
