// Documento do relatório Financeiro: recebido (Pago) x previsto (a receber / a pagar) x pago (despesas). Sem paciente.
import type { financeExtras } from "../reports-datasets";
import {
  baseDocument, chart, col, compact, date, dateOr, EMPTY_NOTE, int, kpis, limitRows, money, note, percentOr, row, table, text, unknown, unknownReasons,
  type DocumentInput, type ReportDocument,
} from "../reports-document.ts";
import type { financeReport } from "../reports-server";
import { limitationText } from "../reports-ui-rules.ts";
import { kpi, kpisHaveData, moneyKpi, pctOf, previousCell, rateKpi, toneForSigned } from "./common.ts";

type Finance = Awaited<ReturnType<typeof financeReport>>;
type Extras = Awaited<ReturnType<typeof financeExtras>>;

const expenseStatusLabel = (status: string) => (status === "paid" ? "Pago" : status === "open" ? "Em aberto" : status);

export function buildFinanceDocument(input: DocumentInput, data: { report: Finance; extras: Extras }): ReportDocument {
  const { report, extras } = data;
  const { summary, previous } = report;
  const compare = Boolean(input.previous);

  const receivableChange = extras.receivable.previousCents !== null && extras.receivable.previousCents !== 0 ? ((extras.receivable.cents - extras.receivable.previousCents) / extras.receivable.previousCents) * 100 : null;
  const payableChange = extras.payable.previousCents !== null && extras.payable.previousCents !== 0 ? ((extras.payable.cents - extras.payable.previousCents) / extras.payable.previousCents) * 100 : null;
  const summarySection = kpis("summary", [
    moneyKpi("received", "Recebido", summary.revenueCents, previous?.revenueCents, unknownReasons.noData, "Pagamentos com status Pago, pela data do pagamento."),
    moneyKpi("expensesPaid", "Despesas pagas", summary.expensesCents, previous?.expensesCents, unknownReasons.noData, "Despesas pagas, pela data de pagamento."),
    moneyKpi("result", "Resultado", summary.resultCents, previous?.resultCents, unknownReasons.noData, "Recebido menos despesas pagas.", toneForSigned(summary.resultCents)),
    rateKpi("margin", "Margem", summary.marginPct, previous?.marginPct, "Resultado ÷ recebido; sem recebimentos não há margem."),
    kpi("receivable", "A receber (previsto)", money(extras.receivable.cents), { previous: extras.receivable.previousCents === null ? null : money(extras.receivable.previousCents), change: receivableChange, hint: `${extras.receivable.count} pagamentos Pendentes/Parciais com data no período.` }),
    kpi("payable", "A pagar (previsto)", money(extras.payable.cents), { previous: extras.payable.previousCents === null ? null : money(extras.payable.previousCents), change: payableChange, hint: `${extras.payable.count} despesas em aberto com vencimento no período.` }),
  ]);

  const hasData = summary.revenueCents > 0 || summary.expensesCents > 0 || extras.receivable.count > 0 || extras.payable.count > 0 || extras.payments.paid.total > 0 || extras.payments.pending.total > 0 || extras.expenses.paid.total > 0 || extras.expenses.open.total > 0 || kpisHaveData(summarySection.items);
  if (!hasData) return baseDocument("finance", input, { hasData, sections: [summarySection, note("empty", EMPTY_NOTE)] });

  const receivedTotal = extras.receivedByMethod.reduce((sum, item) => sum + item.valueCents, 0);
  const byMethod = table({
    id: "by-method",
    title: "Recebido por forma de pagamento",
    columns: [col("method", "Forma de pagamento", "text", { width: 24 }), col("count", "Pagamentos", "int", { total: "sum" }), col("value", "Valor recebido", "money", { total: "sum" }), col("pct", "% do recebido", "percent", { total: "sum" })],
    rows: extras.receivedByMethod.map((item) => row([text(item.method), int(item.count), money(item.valueCents), percentOr(pctOf(item.valueCents, receivedTotal), unknownReasons.noData)])),
    withTotal: true,
  });

  const categoryTotal = report.expensesByCategory.reduce((sum, item) => sum + item.valueCents, 0);
  const byCategory = table({
    id: "expenses-by-category",
    title: "Despesas pagas por categoria",
    columns: [col("category", "Categoria", "text", { width: 24 }), col("value", "Valor pago", "money", { total: "sum" }), col("pct", "% das despesas", "percent", { total: "sum" })],
    rows: report.expensesByCategory.map((item) => row([text(item.category), money(item.valueCents), percentOr(pctOf(item.valueCents, categoryTotal), unknownReasons.noData)])),
    withTotal: true,
  });

  const evolution = table({
    id: "evolution",
    title: compare ? "Evolução por período (atual x anterior)" : "Evolução por período",
    columns: compact([
      col("period", "Período", "text", { width: 18 }),
      col("revenue", "Recebido", "money", { total: "sum" }),
      compare && col("revenuePrev", "Recebido (anterior)", "money", { total: "sum" }),
      col("expenses", "Despesas pagas", "money", { total: "sum" }),
      compare && col("expensesPrev", "Despesas pagas (anterior)", "money", { total: "sum" }),
    ]),
    rows: report.series.revenue.map((point, index) => {
      const expense = report.series.expenses[index];
      return row(compact([
        text(point.label),
        money(point.current),
        compare && previousCell(point, money),
        money(expense?.current ?? 0),
        compare && (expense ? previousCell(expense, money) : unknown(unknownReasons.noBase)),
      ]));
    }),
    withTotal: true,
  });

  const labels = report.series.revenue.map((point) => point.label);
  const evolutionChart = chart({
    id: "evolution-chart",
    title: "Recebido x despesas pagas",
    kind: "bar",
    unit: "money",
    categories: labels,
    series: [
      { name: "Recebido", values: report.series.revenue.map((point) => point.current), style: "current" },
      { name: "Despesas pagas", values: report.series.expenses.map((point) => point.current), style: "current" },
    ],
  });
  const previousChart = compare
    ? chart({ id: "revenue-previous-chart", title: "Recebido: período atual x anterior", kind: "line", unit: "money", categories: labels, series: [{ name: "Atual", values: report.series.revenue.map((point) => point.current), style: "current" }, { name: "Anterior", values: report.series.revenue.map((point) => point.previous), style: "previous" }] })
    : null;

  // Detalhamento sem paciente. A lista do banco é limitada; o total real vem de count.
  const paidLimit = limitRows(extras.payments.paid.rows, extras.payments.paid.rows.length, extras.payments.paid.total);
  const pendingLimit = limitRows(extras.payments.pending.rows, extras.payments.pending.rows.length, extras.payments.pending.total);
  const paymentColumns = [col("date", "Data", "date", { width: 12 }), col("method", "Forma", "text", { width: 18 }), col("installments", "Parcelas", "text", { width: 10, align: "center" }), col("status", "Status", "text", { width: 12 }), col("value", "Valor", "money", { total: "sum" })];
  const paymentRow = (item: Extras["payments"]["paid"]["rows"][number]) => row([date(item.date), text(item.method), text(item.installments), text(item.status), money(item.valueCents)], item.status === "Pago" ? undefined : "warning");
  const paidTable = table({ id: "payments-paid", title: "Recebimentos (pagos)", columns: paymentColumns, rows: paidLimit.rows.map(paymentRow), withTotal: true, truncated: paidLimit.truncated, detail: true });
  const pendingTable = table({ id: "payments-pending", title: "A receber (pendentes e parciais)", columns: paymentColumns, rows: pendingLimit.rows.map(paymentRow), withTotal: true, truncated: pendingLimit.truncated, detail: true, notes: ["Pagamento Parcial é contado pelo valor total lançado (o saldo restante não é registrado)."] });

  const paidExpenseLimit = limitRows(extras.expenses.paid.rows, extras.expenses.paid.rows.length, extras.expenses.paid.total);
  const openExpenseLimit = limitRows(extras.expenses.open.rows, extras.expenses.open.rows.length, extras.expenses.open.total);
  const expensePaidTable = table({
    id: "expenses-paid",
    title: "Despesas pagas",
    columns: [col("due", "Vencimento", "date", { width: 12 }), col("paidOn", "Pago em", "date", { width: 12 }), col("category", "Categoria", "text", { width: 32 }), col("status", "Status", "text", { width: 12 }), col("value", "Valor", "money", { total: "sum" })],
    rows: paidExpenseLimit.rows.map((item) => row([date(item.dueOn), dateOr(item.paidOn, unknownReasons.notApplicable), text(item.category), text(expenseStatusLabel(item.status)), money(item.amountCents)])),
    withTotal: true,
    truncated: paidExpenseLimit.truncated,
    detail: true,
  });
  const expenseOpenTable = table({
    id: "expenses-open",
    title: "A pagar (em aberto)",
    columns: [col("due", "Vencimento", "date", { width: 12 }), col("category", "Categoria", "text", { width: 32 }), col("status", "Status", "text", { width: 12 }), col("value", "Valor", "money", { total: "sum" })],
    rows: openExpenseLimit.rows.map((item) => row([date(item.dueOn), text(item.category), text(expenseStatusLabel(item.status)), money(item.amountCents)], "warning")),
    withTotal: true,
    truncated: openExpenseLimit.truncated,
    detail: true,
  });

  const limitation = limitationText(report.limitation);
  return baseDocument("finance", input, {
    hasData,
    subtitle: "Recebido, previsto (a receber e a pagar) e pago, sem identificar pacientes.",
    sections: compact([
      summarySection,
      note("definitions", "Previsto = a receber (pagamentos Pendentes/Parciais) e a pagar (despesas em aberto) com data/vencimento no período. Recebido e pago só contam o que já foi quitado."),
      limitation ? note("limitation", `Filtro de profissional não se aplica ao financeiro. ${limitation}`, "warning") : null,
      byMethod,
      byCategory,
      evolutionChart,
      previousChart,
      evolution,
      paidTable,
      pendingTable,
      expensePaidTable,
      expenseOpenTable,
    ]),
  });
}
