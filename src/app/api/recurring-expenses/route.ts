import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { clinicToday, parseDateOnly } from "@/lib/clinic-time";
import { ensureRecurringOccurrences, isExpenseCategory, parseRecurringSchedule, recurringNextInfo, recurringSelect, serializeRecurring } from "@/lib/finance";
import { isRecurringActive, monthlyEquivalentCents } from "@/lib/finance-rules";
import { prisma } from "@/lib/prisma";

// Lista com próximo vencimento, situação dele e se está ativa; totais: ativas, equivalente mensal e próximo vencimento geral.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "finance:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  await ensureRecurringOccurrences(user.clinicId);
  const today = clinicToday();
  const items = await prisma.recurringExpense.findMany({ where: { clinicId: user.clinicId }, orderBy: [{ endsOn: { sort: "asc", nulls: "first" } }, { description: "asc" }], select: recurringSelect });
  const info = await recurringNextInfo(user.clinicId, items, today);
  const recurringExpenses = items.map((item) => {
    const serialized = serializeRecurring(item);
    const next = info.get(item.id);
    return { ...serialized, nextDueOn: next?.nextDueOn ?? null, nextStatus: next?.nextStatus ?? null, overdueCount: next?.overdueCount ?? 0, active: isRecurringActive(serialized.endsOn, today) };
  });
  const active = recurringExpenses.filter((item) => item.active);
  const nextDates = active.flatMap((item) => item.nextDueOn ? [item.nextDueOn] : []).sort();
  return NextResponse.json({
    recurringExpenses,
    totals: { activeCount: active.length, monthlyTotalCents: active.reduce((sum, item) => sum + monthlyEquivalentCents(item.frequency, item.amountCents), 0), nextDueOn: nextDates[0] ?? null },
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "finance:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const schedule = parseRecurringSchedule(body);
  const startsOn = parseDateOnly(body?.startsOn);
  const endsOn = body?.endsOn ? parseDateOnly(body.endsOn) : null;
  const amountCents = Number(body?.amountCents);
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const paymentMethod = typeof body?.paymentMethod === "string" ? body.paymentMethod.trim() : "";
  const category = body?.category;
  if (!description || !isExpenseCategory(category) || !paymentMethod || !Number.isInteger(amountCents) || amountCents <= 0) return NextResponse.json({ message: "Preencha descrição, categoria, valor e forma de pagamento." }, { status: 400 });
  if (!schedule) return NextResponse.json({ message: "Informe a frequência e o dia do vencimento." }, { status: 400 });
  if (!startsOn) return NextResponse.json({ message: "Informe a data de início." }, { status: 400 });
  if (body?.endsOn && (!endsOn || endsOn < startsOn)) return NextResponse.json({ message: "A data de fim deve ser depois do início." }, { status: 400 });
  const item = await prisma.recurringExpense.create({
    data: { clinicId: user.clinicId, description, category, amountCents, paymentMethod, ...schedule, startsOn, endsOn },
    select: recurringSelect,
  });
  return NextResponse.json({ recurringExpense: serializeRecurring(item) }, { status: 201 });
}
