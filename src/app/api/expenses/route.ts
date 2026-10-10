import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { clinicToday, parseDateOnly } from "@/lib/clinic-time";
import { dateBounds, ensureRecurringOccurrences, expenseSelect, isExpenseCategory, rangeFor, requestedPeriod, serializeExpense } from "@/lib/finance";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  await ensureRecurringOccurrences(user.clinicId);
  const bounds = dateBounds(rangeFor(requestedPeriod(request)));
  const expenses = await prisma.expense.findMany({
    where: { clinicId: user.clinicId, OR: [{ dueOn: bounds }, { paidOn: bounds }] },
    orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
    select: expenseSelect,
  });
  return NextResponse.json({ expenses: expenses.map(serializeExpense) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as { description?: string; category?: string; amountCents?: number; dueOn?: string; paymentMethod?: string; paid?: boolean; paidOn?: string } | null;
  const amountCents = Number(body?.amountCents);
  const dueOn = parseDateOnly(body?.dueOn);
  const paidOn = body?.paid ? parseDateOnly(body.paidOn ?? clinicToday()) : null;
  if (!body?.description?.trim() || !isExpenseCategory(body.category) || !body.paymentMethod?.trim() || !dueOn || !Number.isInteger(amountCents) || amountCents <= 0) return NextResponse.json({ message: "Preencha descrição, categoria, valor, vencimento e forma de pagamento." }, { status: 400 });
  if (body.paid && !paidOn) return NextResponse.json({ message: "Informe a data do pagamento." }, { status: 400 });
  const expense = await prisma.expense.create({
    data: { clinicId: user.clinicId, description: body.description.trim(), category: body.category, amountCents, dueOn, paymentMethod: body.paymentMethod.trim(), status: paidOn ? "paid" : "open", paidOn, createdById: user.id },
    select: expenseSelect,
  });
  return NextResponse.json({ expense: serializeExpense(expense) }, { status: 201 });
}
