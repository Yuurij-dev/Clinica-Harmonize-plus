import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { clinicToday, parseDateOnly } from "@/lib/clinic-time";
import { expenseSelect, isExpenseCategory, serializeExpense } from "@/lib/finance";
import { prisma } from "@/lib/prisma";

// Ações: pay (marca como paga), unpay (volta para a pagar), cancel, ou edição dos campos enquanto está a pagar.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const id = (await params).id;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const expense = await prisma.expense.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true, status: true, source: true } });
  if (!expense) return NextResponse.json({ message: "Despesa não encontrada." }, { status: 404 });

  let data: Prisma.ExpenseUpdateInput;
  if (body?.action === "pay") {
    if (expense.status !== "open") return NextResponse.json({ message: "Só despesas a pagar podem ser marcadas como pagas." }, { status: 409 });
    const paidOn = parseDateOnly(body.paidOn ?? clinicToday());
    if (!paidOn) return NextResponse.json({ message: "Informe a data do pagamento." }, { status: 400 });
    data = { status: "paid", paidOn };
  } else if (body?.action === "unpay") {
    if (expense.status !== "paid") return NextResponse.json({ message: "Esta despesa não está paga." }, { status: 409 });
    data = { status: "open", paidOn: null };
  } else if (body?.action === "cancel") {
    if (expense.source === "purchase") return NextResponse.json({ message: "Esta despesa veio de uma compra. Cancele a compra no Estoque." }, { status: 409 });
    if (expense.status === "cancelled") return NextResponse.json({ message: "Esta despesa já está cancelada." }, { status: 409 });
    data = { status: "cancelled", paidOn: null };
  } else {
    if (expense.status !== "open") return NextResponse.json({ message: "Só despesas a pagar podem ser editadas." }, { status: 409 });
    if (expense.source === "purchase") return NextResponse.json({ message: "Despesas de compra são editadas pela compra." }, { status: 409 });
    data = {};
    if (body?.description !== undefined) {
      if (typeof body.description !== "string" || !body.description.trim()) return NextResponse.json({ message: "Informe a descrição." }, { status: 400 });
      data.description = body.description.trim();
    }
    if (body?.category !== undefined) {
      if (!isExpenseCategory(body.category)) return NextResponse.json({ message: "Categoria inválida." }, { status: 400 });
      data.category = body.category;
    }
    if (body?.amountCents !== undefined) {
      const amountCents = Number(body.amountCents);
      if (!Number.isInteger(amountCents) || amountCents <= 0) return NextResponse.json({ message: "Informe um valor válido." }, { status: 400 });
      data.amountCents = amountCents;
    }
    if (body?.dueOn !== undefined) {
      const dueOn = parseDateOnly(body.dueOn);
      if (!dueOn) return NextResponse.json({ message: "Informe um vencimento válido." }, { status: 400 });
      data.dueOn = dueOn;
    }
    if (body?.paymentMethod !== undefined) {
      if (typeof body.paymentMethod !== "string" || !body.paymentMethod.trim()) return NextResponse.json({ message: "Informe a forma de pagamento." }, { status: 400 });
      data.paymentMethod = body.paymentMethod.trim();
    }
  }

  const updated = await prisma.expense.update({ where: { id }, data, select: expenseSelect });
  return NextResponse.json({ expense: serializeExpense(updated) });
}
