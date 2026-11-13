// XLSX do Financeiro: uma linha por transação (recebimento ou despesa), sem paciente e sem descrição livre.
import { date, money, text, unknown, unknownReasons, MAX_TABLE_ROWS, type Cell, type ReportDocument } from "../reports-document.ts";
import { count, div, is, isKey, sub, sum, type AggregateSpec, type DataSheet, type XlsxSpec } from "../reports-xlsx-types.ts";
import { baseSpec, cellByKey, kpiGroupsOf, tableOf, textOfCell } from "./common.ts";

type PaymentRow = { date: string; method: string; installments: string; status: string; valueCents: number };
type ExpenseRow = { dueOn: string; paidOn: string | null; category: string; status: string; amountCents: number };
type Group<T> = { total: number; rows: T[] };
// Mesmo formato de financeExtras (só os campos usados aqui).
export type FinanceSource = { payments: { paid: Group<PaymentRow>; pending: Group<PaymentRow> }; expenses: { paid: Group<ExpenseRow>; open: Group<ExpenseRow> } };

const NAME = "Financeiro";
const expenseStatus = (status: string) => (status === "paid" ? "Pago" : status === "open" ? "Em aberto" : status);

export function buildFinanceSpec(doc: ReportDocument, source: FinanceSource): XlsxSpec {
  const all: Array<{ day: string; type: string; kind: string; status: string; installments: string | null; cents: number }> = [
    ...[...source.payments.paid.rows, ...source.payments.pending.rows].map((row) => ({ day: row.date, type: "Recebimento", kind: row.method, status: row.status, installments: row.installments, cents: row.valueCents })),
    ...[...source.expenses.paid.rows, ...source.expenses.open.rows].map((row) => ({ day: row.paidOn ?? row.dueOn, type: "Despesa", kind: row.category, status: expenseStatus(row.status), installments: null, cents: row.amountCents })),
  ];
  const totalCount = source.payments.paid.total + source.payments.pending.total + source.expenses.paid.total + source.expenses.open.total;
  // Os mais recentes primeiro para o corte; a planilha segue em ordem cronológica.
  const newest = [...all].sort((a, b) => b.day.localeCompare(a.day)).slice(0, MAX_TABLE_ROWS);
  const ordered = newest.sort((a, b) => a.day.localeCompare(b.day) || a.type.localeCompare(b.type));
  const truncated = totalCount > ordered.length ? { shown: ordered.length, total: totalCount } : null;
  const rows: Cell[][] = ordered.map((item) => [date(item.day), text(item.type), text(item.kind), text(item.status), item.installments === null ? unknown(unknownReasons.notApplicable) : text(item.installments), money(item.cents)]);
  const sheet: DataSheet = {
    name: NAME,
    columns: [
      { key: "day", label: "Data", type: "date" },
      { key: "type", label: "Tipo", type: "text", width: 14 },
      { key: "kind", label: "Forma / Categoria", type: "text", width: 22 },
      { key: "status", label: "Situação", type: "text", width: 14 },
      { key: "installments", label: "Parcelas", type: "text", width: 10 },
      // Sem total: a coluna mistura recebimentos, despesas, pagos e pendentes (somar não tem significado).
      { key: "value", label: "Valor", type: "money" },
    ],
    rows,
    truncated,
  };
  const received = sum(NAME, "value", [is("type", "Recebimento"), is("status", "Pago")]);
  const expensesPaid = sum(NAME, "value", [is("type", "Despesa"), is("status", "Pago")]);
  const result = sub(received, expensesPaid);
  const byMethod = tableOf(doc, "by-method");
  const placeholder = unknown(unknownReasons.noData);
  const aggregate: AggregateSpec | null = byMethod
    ? {
        title: "Recebido por forma de pagamento",
        keyLabel: "Forma de pagamento",
        metrics: [{ label: "Pagamentos", type: "int" }, { label: "Valor recebido", type: "money" }, { label: "Participação", type: "percent", share: 1 }],
        rows: byMethod.rows.map((row) => {
          const label = textOfCell(cellByKey(byMethod, row, "method"));
          const criteria = [isKey("kind", label), is("type", "Recebimento"), is("status", "Pago")];
          return { key: label, cells: [cellByKey(byMethod, row, "count") ?? placeholder, cellByKey(byMethod, row, "value") ?? placeholder, placeholder], exprs: [count(NAME, "day", criteria), sum(NAME, "value", criteria), null] };
        }),
      }
    : null;
  return baseSpec(doc, {
    kpiGroups: kpiGroupsOf(doc, {
      received,
      expensesPaid,
      result,
      margin: div(result, received),
      receivable: sum(NAME, "value", [is("type", "Recebimento"), is("status", "<>Pago")]),
      payable: sum(NAME, "value", [is("type", "Despesa"), is("status", "Em aberto")]),
    }),
    aggregate,
    sheets: [sheet],
    notes: ["Sem identificação de pacientes nem descrição livre. Previsto = a receber (Pendente/Parcial) e a pagar (despesas em aberto); recebido e pago só contam o quitado."],
  });
}

