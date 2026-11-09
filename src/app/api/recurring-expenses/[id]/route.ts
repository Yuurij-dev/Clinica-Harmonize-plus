import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { clinicToday, parseDateOnly } from "@/lib/clinic-time";
import { ensureRecurringOccurrences, expenseSelect, isExpenseCategory, parseRecurringSchedule, recurringNextInfo, recurringSelect, serializeExpense, serializeRecurring } from "@/lib/finance";
import { isRecurringActive, recurringCycleStart, recurringScheduleChanged } from "@/lib/finance-rules";
import { prisma } from "@/lib/prisma";

const historyLimit = 24;

// Detalhe da despesa fixa + histórico de ocorrências (mais recentes primeiro; ?limit=1..100, padrão 24).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "finance:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const id = (await params).id;
  const rawLimit = new URL(request.url).searchParams.get("limit");
  const limit = rawLimit === null ? historyLimit : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ message: "Limite inválido." }, { status: 400 });
  const item = await prisma.recurringExpense.findFirst({ where: { id, clinicId: user.clinicId }, select: recurringSelect });
  if (!item) return NextResponse.json({ message: "Despesa fixa não encontrada." }, { status: 404 });
  await ensureRecurringOccurrences(user.clinicId);
  const today = clinicToday();
  const [occurrences, info] = await Promise.all([
    prisma.expense.findMany({ where: { clinicId: user.clinicId, recurringExpenseId: id }, orderBy: [{ occurrenceOn: "desc" }, { id: "asc" }], take: limit, select: expenseSelect }),
    recurringNextInfo(user.clinicId, [item], today),
  ]);
  const serialized = serializeRecurring(item);
  const next = info.get(id);
  return NextResponse.json({
    recurringExpense: { ...serialized, nextDueOn: next?.nextDueOn ?? null, nextStatus: next?.nextStatus ?? null, overdueCount: next?.overdueCount ?? 0, active: isRecurringActive(serialized.endsOn, today) },
    occurrences: occurrences.map(serializeExpense),
  });
}

// Edita descrição, categoria, valor e forma de pagamento (vale para as próximas ocorrências),
// encerra a despesa fixa (endsOn) ou muda a agenda (frequency/weekday/dayOfMonth/month): nesse caso as
// ocorrências em aberto (source recurring) com vencimento de hoje em diante são refeitas pela regra;
// pagas, canceladas e as já vencidas ficam intactas.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "finance:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const id = (await params).id;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const current = await prisma.recurringExpense.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true, startsOn: true, endsOn: true, frequency: true, weekday: true, dayOfMonth: true, month: true } });
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

  const scheduleKeys = ["frequency", "weekday", "dayOfMonth", "month"];
  let schedule: ReturnType<typeof parseRecurringSchedule> = null;
  if (scheduleKeys.some((key) => body?.[key] !== undefined)) {
    schedule = parseRecurringSchedule({ frequency: current.frequency, weekday: current.weekday, dayOfMonth: current.dayOfMonth, month: current.month, ...body });
    if (!schedule) return NextResponse.json({ message: "Informe a frequência e o dia do vencimento." }, { status: 400 });
  }
  const scheduleChanged = Boolean(schedule) && recurringScheduleChanged(current, { frequency: schedule!.frequency, weekday: schedule!.weekday, dayOfMonth: schedule!.dayOfMonth, month: schedule!.month });

  // As ocorrências que já deviam existir ficam com o valor antigo; a mudança vale dali em diante.
  await ensureRecurringOccurrences(user.clinicId);
  // Agenda nova vale dali em diante: o início passa a ser o começo do ciclo corrente (sem recriar ciclos passados,
  // mas gerando a data nova do ciclo atual, mesmo que já tenha passado).
  const today = new Date(`${clinicToday()}T00:00:00Z`);
  const cycleStart = new Date(`${recurringCycleStart(schedule?.frequency ?? current.frequency, clinicToday())}T00:00:00Z`);
  const effectiveEndsOn = data.endsOn !== undefined ? data.endsOn : current.endsOn;
  const moveStart = scheduleChanged && current.startsOn < cycleStart && (!effectiveEndsOn || effectiveEndsOn >= cycleStart);
  const item = await prisma.$transaction(async (tx) => {
    // Ao encerrar, as ocorrências futuras ainda em aberto (geradas automaticamente e nunca pagas)
    // são removidas; se o fim for adiado depois, elas são geradas de novo.
    if (data.endsOn) await tx.expense.deleteMany({ where: { clinicId: user.clinicId, recurringExpenseId: id, status: "open", occurrenceOn: { gt: data.endsOn } } });
    if (scheduleChanged) {
      await tx.expense.deleteMany({ where: { clinicId: user.clinicId, recurringExpenseId: id, status: "open", source: "recurring", occurrenceOn: { gte: today } } });
    }
    const updated = await tx.recurringExpense.update({ where: { id }, data: { ...data, ...(scheduleChanged ? schedule : {}), ...(moveStart ? { startsOn: cycleStart } : {}) }, select: recurringSelect });
    // Regera só as datas que faltam (idempotente: índice único e skipDuplicates).
    if (scheduleChanged) await ensureRecurringOccurrences(user.clinicId, tx, id);
    return updated;
  });
  return NextResponse.json({ recurringExpense: serializeRecurring(item) });
}

// Remove a despesa fixa e as ocorrências não pagas. Com alguma ocorrência paga: 409 (use "encerrar", endsOn).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "finance:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const id = (await params).id;
  const current = await prisma.recurringExpense.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true } });
  if (!current) return NextResponse.json({ message: "Despesa fixa não encontrada." }, { status: 404 });
  const result = await prisma.$transaction(async (tx) => {
    if (await tx.expense.count({ where: { clinicId: user.clinicId, recurringExpenseId: id, status: "paid" } })) return null;
    const removed = await tx.expense.deleteMany({ where: { clinicId: user.clinicId, recurringExpenseId: id, status: { not: "paid" } } });
    await tx.recurringExpense.deleteMany({ where: { id, clinicId: user.clinicId } });
    return removed.count;
  });
  if (result === null) return NextResponse.json({ message: "Há ocorrências já pagas. Encerre a despesa fixa em vez de excluir." }, { status: 409 });
  return NextResponse.json({ ok: true, removedOccurrences: result });
}
