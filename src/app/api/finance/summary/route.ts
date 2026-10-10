import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { clinicToday, dateOnly } from "@/lib/clinic-time";
import { dateBounds, rangeFor, requestedPeriod } from "@/lib/finance";
import { addDays, financeTotals } from "@/lib/finance-rules";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  const period = requestedPeriod(request);
  const range = rangeFor(period);
  // Pagamentos são timestamptz: busca com folga de um dia e filtra pela data da clínica nas regras.
  const paymentWindow = { gte: new Date(`${addDays(range.start, -1)}T00:00:00Z`), lte: new Date(`${addDays(range.end, 2)}T00:00:00Z`) };
  const bounds = dateBounds(range);
  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({ where: { clinicId: user.clinicId, date: paymentWindow }, select: { value: true, status: true, date: true } }),
    prisma.expense.findMany({ where: { clinicId: user.clinicId, status: { not: "cancelled" }, OR: [{ dueOn: bounds }, { paidOn: bounds }] }, select: { amountCents: true, status: true, dueOn: true, paidOn: true } }),
  ]);
  const totals = financeTotals({
    range,
    payments: payments.map((payment) => ({ value: payment.value, status: payment.status, date: clinicToday(payment.date) })),
    expenses: expenses.map((expense) => ({ amountCents: expense.amountCents, status: expense.status, dueOn: dateOnly(expense.dueOn), paidOn: expense.paidOn ? dateOnly(expense.paidOn) : null })),
  });
  return NextResponse.json({ period, range, totals });
}
