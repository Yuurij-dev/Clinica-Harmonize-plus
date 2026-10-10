import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseDateOnly } from "@/lib/clinic-time";
import { ensureRecurringOccurrences, isExpenseCategory, recurringSelect, serializeRecurring } from "@/lib/finance";
import { prisma } from "@/lib/prisma";

// Edita descrição, categoria, valor e forma de pagamento (vale para as próximas ocorrências)
// ou encerra a despesa fixa (endsOn). O agendamento não muda: para isso, crie outra.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const id = (await params).id;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const current = await prisma.recurringExpense.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true, startsOn: true } });
  if (!current) return NextResponse.json({ message: "Despesa fixa não encontrada." }, { status: 404 });

  const data: { description?: string; category?: string; amountCents?: number; paymentMethod?: string; endsOn?: Date | null } = {};
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
  if (body?.paymentMethod !== undefined) {
    if (typeof body.paymentMethod !== "string" || !body.paymentMethod.trim()) return NextResponse.json({ message: "Informe a forma de pagamento." }, { status: 400 });
    data.paymentMethod = body.paymentMethod.trim();
  }
  if (body?.endsOn !== undefined) {
    const endsOn = body.endsOn === null || body.endsOn === "" ? null : parseDateOnly(body.endsOn);
    if (endsOn === null && body.endsOn) return NextResponse.json({ message: "Informe uma data de fim válida." }, { status: 400 });
    if (endsOn && endsOn < current.startsOn) return NextResponse.json({ message: "A data de fim deve ser depois do início." }, { status: 400 });
    data.endsOn = endsOn;
  }

  // As ocorrências que já deviam existir ficam com o valor antigo; a mudança vale dali em diante.
  await ensureRecurringOccurrences(user.clinicId);
  const item = await prisma.$transaction(async (tx) => {
    // Ao encerrar, as ocorrências futuras ainda em aberto (geradas automaticamente e nunca pagas)
    // são removidas; se o fim for adiado depois, elas são geradas de novo.
    if (data.endsOn) await tx.expense.deleteMany({ where: { clinicId: user.clinicId, recurringExpenseId: id, status: "open", occurrenceOn: { gt: data.endsOn } } });
    return tx.recurringExpense.update({ where: { id }, data, select: recurringSelect });
  });
  return NextResponse.json({ recurringExpense: serializeRecurring(item) });
}
