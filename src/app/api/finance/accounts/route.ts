import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { clinicToday, dateOnly } from "@/lib/clinic-time";
import { ensureRecurringOccurrences, optionalDateBounds, parsePagination, paymentDayBounds, requestedDateRange } from "@/lib/finance";
import { accountStatus } from "@/lib/finance-rules";
import { prisma } from "@/lib/prisma";

const statuses = ["open", "overdue", "settled", "all"];

// Contas a receber (Payment, vencimento = date) e a pagar (Expense não cancelada, vencimento = dueOn).
// ?kind=receivable|payable &from &to &status=open|overdue|settled|all (padrão open) &q &page &pageSize(<=50)
// Totais respeitam from/to/q, mas não o filtro de situação.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (kind !== "receivable" && kind !== "payable") return NextResponse.json({ message: "Informe kind=receivable ou kind=payable." }, { status: 400 });
  if (!canForUser(user, kind === "receivable" ? "payments:access" : "finance:manage")) return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });

  const status = params.get("status") || "open";
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const range = requestedDateRange(params);
  const pagination = parsePagination(params);
  if (!statuses.includes(status) || !range || !pagination) return NextResponse.json({ message: "Filtros inválidos." }, { status: 400 });
  const today = clinicToday();

  if (kind === "receivable") {
    const base: Prisma.PaymentWhereInput = { clinicId: user.clinicId, ...(q ? { patient: { name: { contains: q, mode: "insensitive" } } } : {}) };
    const dated = (extra: Prisma.PaymentWhereInput = {}): Prisma.PaymentWhereInput => ({
      AND: [base, extra, ...(range.start || range.end ? [{ date: paymentDayBounds(range) }] : [])],
    });
    const open = { status: { not: "Pago" } };
    // Vencidas: em aberto, dentro do filtro de datas e com vencimento antes de hoje.
    const overdueWhere: Prisma.PaymentWhereInput = { AND: [dated(open), { date: { lt: new Date(`${today}T00:00:00-03:00`) } }] };
    const listWhere = status === "open" ? dated(open) : status === "settled" ? dated({ status: "Pago" }) : status === "overdue" ? overdueWhere : dated();
    const [openAgg, settledAgg, overdueAgg, total, items] = await Promise.all([
      prisma.payment.aggregate({ where: dated(open), _sum: { valueCents: true }, _count: { _all: true } }),
      prisma.payment.aggregate({ where: dated({ status: "Pago" }), _sum: { valueCents: true } }),
      prisma.payment.aggregate({ where: overdueWhere, _sum: { valueCents: true }, _count: { _all: true } }),
      prisma.payment.count({ where: listWhere }),
      prisma.payment.findMany({
        where: listWhere,
        orderBy: [{ date: status === "settled" || status === "all" ? "desc" : "asc" }, { id: "asc" }],
        skip: pagination.skip,
        take: pagination.pageSize,
        select: { id: true, valueCents: true, method: true, date: true, status: true, installments: true, patientId: true, patient: { select: { name: true } } },
      }),
    ]);
    return NextResponse.json({
      kind,
      totals: { openCents: openAgg._sum.valueCents ?? 0, openCount: openAgg._count._all, settledCents: settledAgg._sum.valueCents ?? 0, overdueCents: overdueAgg._sum.valueCents ?? 0, overdueCount: overdueAgg._count._all },
      items: items.map((payment) => {
        const dueOn = clinicToday(payment.date);
        return {
          id: payment.id,
          patientId: payment.patientId,
          patientName: payment.patient?.name ?? null,
          description: `Pagamento – ${payment.patient?.name ?? "Paciente"}`,
          amountCents: payment.valueCents,
          dueOn,
          status: accountStatus(payment.status === "Pago", dueOn, today),
          paymentStatus: payment.status,
          method: payment.method,
          installments: payment.installments,
        };
      }),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    });
  }

  await ensureRecurringOccurrences(user.clinicId);
  const base: Prisma.ExpenseWhereInput = {
    clinicId: user.clinicId,
    status: { not: "cancelled" },
    ...(range.start || range.end ? { dueOn: optionalDateBounds(range) } : {}),
    ...(q ? { description: { contains: q, mode: "insensitive" } } : {}),
  };
  const todayDate = new Date(`${today}T00:00:00Z`);
  const overdueWhere: Prisma.ExpenseWhereInput = { AND: [base, { status: "open" }, { dueOn: { lt: todayDate } }] };
  const listWhere: Prisma.ExpenseWhereInput = status === "open" ? { ...base, status: "open" } : status === "settled" ? { ...base, status: "paid" } : status === "overdue" ? overdueWhere : base;
  const [openAgg, settledAgg, overdueAgg, total, items] = await Promise.all([
    prisma.expense.aggregate({ where: { ...base, status: "open" }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.expense.aggregate({ where: { ...base, status: "paid" }, _sum: { amountCents: true } }),
    prisma.expense.aggregate({ where: overdueWhere, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.expense.count({ where: listWhere }),
    prisma.expense.findMany({
      where: listWhere,
      orderBy: [{ dueOn: status === "settled" || status === "all" ? "desc" : "asc" }, { id: "asc" }],
      skip: pagination.skip,
      take: pagination.pageSize,
      select: { id: true, description: true, category: true, amountCents: true, dueOn: true, paidOn: true, status: true, source: true, paymentMethod: true },
    }),
  ]);
  return NextResponse.json({
    kind,
    totals: { openCents: openAgg._sum.amountCents ?? 0, openCount: openAgg._count._all, settledCents: settledAgg._sum.amountCents ?? 0, overdueCents: overdueAgg._sum.amountCents ?? 0, overdueCount: overdueAgg._count._all },
    items: items.map((expense) => ({
      id: expense.id,
      description: expense.description,
      category: expense.category,
      amountCents: expense.amountCents,
      dueOn: dateOnly(expense.dueOn),
      paidOn: expense.paidOn ? dateOnly(expense.paidOn) : null,
      status: accountStatus(expense.status === "paid", dateOnly(expense.dueOn), today),
      source: expense.source,
      paymentMethod: expense.paymentMethod,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
}
