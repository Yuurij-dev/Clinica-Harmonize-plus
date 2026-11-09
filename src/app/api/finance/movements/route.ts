import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { clinicToday, dateOnly } from "@/lib/clinic-time";
import { parsePagination, paymentDayBounds, requestedDateRange } from "@/lib/finance";
import { expenseCategories, mergeMovements } from "@/lib/finance-rules";
import { prisma } from "@/lib/prisma";

const revenueCategory = "Receita";
type ExpenseRow = { id: string; description: string; category: string; amountCents: number; status: string; paymentMethod: string; source: string; date: Date };

// Histórico unificado de receitas (Payment, por date) e despesas (Expense não cancelada, por paidOn ?? dueOn).
// ?type=all|revenue|expense &from &to &category &q &sort=desc|asc &page &pageSize(<=50)
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "finance:access")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const type = params.get("type") || "all";
  const sort = params.get("sort") || "desc";
  const category = params.get("category") || "";
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const range = requestedDateRange(params);
  const pagination = parsePagination(params);
  const categories = [revenueCategory, ...expenseCategories];
  if (!["all", "revenue", "expense"].includes(type) || !["asc", "desc"].includes(sort) || !range || !pagination || (category && !categories.includes(category as never))) return NextResponse.json({ message: "Filtros inválidos." }, { status: 400 });

  const canRevenue = canForUser(user, "payments:access");
  const canExpense = canForUser(user, "finance:manage");
  if ((type === "revenue" && !canRevenue) || (type === "expense" && !canExpense)) return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
  const wantRevenue = canRevenue && type !== "expense" && (!category || category === revenueCategory);
  const wantExpense = canExpense && type !== "revenue" && category !== revenueCategory;
  const take = pagination.skip + pagination.pageSize;

  const paymentWhere: Prisma.PaymentWhereInput = {
    clinicId: user.clinicId,
    ...(range.start || range.end ? { date: paymentDayBounds(range) } : {}),
    ...(q ? { patient: { name: { contains: q, mode: "insensitive" } } } : {}),
  };
  const sqlDirection = Prisma.raw(sort === "asc" ? "ASC" : "DESC");
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const expenseFilter = Prisma.sql`"clinicId" = ${user.clinicId} AND status <> 'cancelled'
    ${range.start ? Prisma.sql`AND COALESCE("paidOn", "dueOn") >= ${range.start}::date` : Prisma.empty}
    ${range.end ? Prisma.sql`AND COALESCE("paidOn", "dueOn") <= ${range.end}::date` : Prisma.empty}
    ${category && category !== revenueCategory ? Prisma.sql`AND category = ${category}` : Prisma.empty}
    ${q ? Prisma.sql`AND description ILIKE ${like}` : Prisma.empty}`;

  const [payments, paymentTotal, expenses, expenseTotal] = await Promise.all([
    wantRevenue ? prisma.payment.findMany({
      where: paymentWhere,
      orderBy: [{ date: sort as "asc" | "desc" }, { id: sort as "asc" | "desc" }],
      take,
      select: { id: true, valueCents: true, method: true, date: true, status: true, patientId: true, patient: { select: { name: true } } },
    }) : [],
    wantRevenue ? prisma.payment.count({ where: paymentWhere }) : 0,
    wantExpense ? prisma.$queryRaw<ExpenseRow[]>`
      SELECT id, description, category, "amountCents", status, "paymentMethod", source, COALESCE("paidOn", "dueOn") AS date
      FROM "Expense" WHERE ${expenseFilter}
      ORDER BY COALESCE("paidOn", "dueOn") ${sqlDirection}, id ${sqlDirection}
      LIMIT ${take}` : [],
    wantExpense ? prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM "Expense" WHERE ${expenseFilter}`.then((rows) => Number(rows[0]?.count ?? 0)) : 0,
  ]);

  const revenueItems = payments.map((payment) => ({
    id: payment.id,
    kind: "revenue" as const,
    date: clinicToday(payment.date),
    description: `Pagamento – ${payment.patient?.name ?? "Paciente"}`,
    category: revenueCategory,
    amountCents: payment.valueCents,
    status: payment.status,
    method: payment.method,
    patientId: payment.patientId,
    patientName: payment.patient?.name ?? null,
  }));
  const expenseItems = expenses.map((expense) => ({
    id: expense.id,
    kind: "expense" as const,
    date: dateOnly(expense.date),
    description: expense.description,
    category: expense.category,
    amountCents: expense.amountCents,
    status: expense.status,
    method: expense.paymentMethod,
    source: expense.source,
  }));
  return NextResponse.json({
    items: mergeMovements(revenueItems, expenseItems, sort as "asc" | "desc", pagination.skip, pagination.pageSize),
    total: paymentTotal + expenseTotal,
    page: pagination.page,
    pageSize: pagination.pageSize,
    categories: [...(canRevenue ? [revenueCategory] : []), ...(canExpense ? expenseCategories : [])],
  });
}
