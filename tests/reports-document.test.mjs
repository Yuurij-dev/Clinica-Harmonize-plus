import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_TABLE_ROWS, allowedReportIds, baseDocument, cellDisplay, cellNumber, cellReason, chart, col, date, datetime, decimal, int, intOr, isReportKind, isUnknown, limitRows, money,
  moneyOr, percent, percentOr, reportCategories, reportDefinitions, reportFileName, reportIds, row, sheetName, table, text, totalRow, unknown, unknownReasons, truncatedNote,
} from "../src/lib/reports-document.ts";

test("catalog: every report has category, permission, icon and a safe file label", () => {
  for (const id of reportIds) {
    const definition = reportDefinitions[id];
    assert.equal(definition.id, id);
    assert.ok(reportCategories.includes(definition.category), id);
    assert.ok(definition.description.length > 10 && definition.icon);
    assert.match(definition.fileLabel, /^[A-Za-z0-9]+$/);
  }
  assert.equal(reportDefinitions.finance.permission, "finance:access");
  assert.equal(reportDefinitions.stock.permission, "stock:access");
  assert.equal(reportDefinitions.quotes.permission, "quotes:access");
  assert.equal(reportDefinitions.appointments.permission, "reports:access");
  assert.deepEqual(reportCategories, ["Financeiro", "Operação", "Clientes", "Estoque"]);
  assert.ok(isReportKind("all") && isReportKind("overview") && isReportKind("stock"));
  assert.ok(!isReportKind("../x") && !isReportKind("constructor") && !isReportKind(null));
});

test("allowedReportIds follows capabilities", () => {
  assert.deepEqual(allowedReportIds({ finance: false, quotes: false, stock: false }), ["procedures", "professionals", "appointments", "clients"]);
  assert.equal(allowedReportIds({ finance: true, quotes: true, stock: true }).length, 7);
  assert.ok(!allowedReportIds({ finance: false, quotes: true, stock: true }).includes("finance"));
});

test("unknown is not zero: null becomes an unknown cell with reason, zero stays zero", () => {
  assert.deepEqual(moneyOr(null, unknownReasons.noCost), { type: "unknown", reason: "sem custo cadastrado" });
  assert.deepEqual(moneyOr(undefined, "x"), { type: "unknown", reason: "x" });
  assert.deepEqual(moneyOr(Number.NaN, "x"), { type: "unknown", reason: "x" });
  assert.deepEqual(moneyOr(0, "x"), { type: "money", value: 0 });
  assert.deepEqual(intOr(0, "x"), { type: "int", value: 0 });
  assert.deepEqual(percentOr(0, "x"), { type: "percent", value: 0 });
  assert.equal(cellDisplay(moneyOr(0, "x")), "R$ 0,00");
  assert.equal(cellDisplay(moneyOr(null, "x")), "—");
  assert.equal(cellDisplay(percentOr(0, "x")), "0%");
  assert.ok(isUnknown(unknown("a")) && !isUnknown(money(0)));
  assert.equal(cellReason(unknown("sem ficha técnica")), "sem ficha técnica");
  assert.equal(cellReason(money(1)), null);
  assert.equal(cellNumber(unknown("a")), null);
  assert.equal(cellNumber(text("1")), null);
  assert.equal(cellNumber(money(150)), 150);
});

test("typed cells render pt-BR", () => {
  assert.equal(cellDisplay(money(123456)), "R$ 1.234,56");
  assert.equal(cellDisplay(money(-500)), "-R$ 5,00");
  assert.equal(cellDisplay(int(1234)), "1.234");
  assert.equal(cellDisplay(decimal(1.5)), "1,5");
  assert.equal(cellDisplay(percent(12.34)), "12,3%");
  assert.equal(cellDisplay(date("2026-11-05")), "05/11/2026");
  assert.equal(cellDisplay(datetime("2026-11-05T15:30:00Z")), "05/11/2026 12:30");
  assert.equal(cellDisplay(text("Olá")), "Olá");
});

test("totalRow sums only numeric known cells and keeps all-unknown columns unknown", () => {
  const columns = [col("n", "Nome", "text"), col("q", "Qtd", "int", { total: "sum" }), col("c", "Custo", "money", { total: "sum" }), col("p", "%", "percent")];
  const rows = [row([text("a"), int(2), money(100), percent(10)]), row([text("b"), int(3), unknown(unknownReasons.noCost), percent(20)])];
  const total = totalRow(columns, rows);
  assert.deepEqual(total.cells, [text("Total (parcial)"), int(5), money(100), text("")]); // há célula desconhecida em coluna somável
  assert.deepEqual(totalRow(columns, [rows[0]]).cells[0], text("Total")); // sem desconhecido: total completo
  const allUnknown = totalRow(columns, [row([text("a"), int(1), unknown("x"), percent(1)])]);
  assert.deepEqual(allUnknown.cells[2], unknown(unknownReasons.noData));
  assert.deepEqual(totalRow(columns, []).cells[2], money(0));
});

test("table(): total only when requested, rows exist and the list is not truncated; truncation adds the note", () => {
  const columns = [col("n", "Nome", "text"), col("v", "Valor", "money", { total: "sum" })];
  const rows = [row([text("a"), money(1)]), row([text("b"), money(2)])];
  assert.equal(table({ id: "t", title: "T", columns, rows }).total, null);
  assert.deepEqual(table({ id: "t", title: "T", columns, rows, withTotal: true }).total?.cells[1], money(3));
  assert.equal(table({ id: "t", title: "T", columns, rows: [], withTotal: true }).total, null);
  const truncated = table({ id: "t", title: "T", columns, rows, withTotal: true, truncated: { shown: 2, total: 9 } });
  assert.equal(truncated.total, null);
  assert.ok(truncated.notes.includes("Exibindo 2 de 9 linhas."));
  assert.equal(truncatedNote({ shown: 5000, total: 12000 }), "Exibindo 5.000 de 12.000 linhas.");
});

test("limitRows caps the list and reports shown of total", () => {
  assert.deepEqual(limitRows([1, 2, 3], 5), { rows: [1, 2, 3], truncated: null });
  assert.deepEqual(limitRows([1, 2, 3, 4], 2), { rows: [1, 2], truncated: { shown: 2, total: 4 } });
  assert.deepEqual(limitRows([1, 2], 2, 10), { rows: [1, 2], truncated: { shown: 2, total: 10 } });
  assert.equal(MAX_TABLE_ROWS, 5000);
});

test("chart is omitted without real data (no misleading empty charts)", () => {
  const base = { id: "c", title: "C", kind: "bar", unit: "int", categories: ["a", "b"] };
  assert.equal(chart({ ...base, series: [{ name: "s", values: [0, 0] }] }), null);
  assert.equal(chart({ ...base, series: [{ name: "s", values: [null, null] }] }), null);
  assert.equal(chart({ ...base, categories: [], series: [{ name: "s", values: [] }] }), null);
  assert.equal(chart({ ...base, series: [{ name: "s", values: [0, 3] }] })?.type, "chart");
});

test("file name and sheet name are safe", () => {
  assert.equal(reportFileName("stock", { start: "2026-11-01", end: "2026-11-30" }, "xlsx"), "Harmonize_Estoque_2026-11-01_a_2026-11-30.xlsx");
  assert.equal(reportFileName("all", { start: "2026-11-01", end: "2026-11-30" }, "pdf"), "Harmonize_Consolidado_2026-11-01_a_2026-11-30.pdf");
  for (const id of [...reportIds, "overview", "all"]) assert.match(reportFileName(id, { start: "2026-01-01", end: "2026-12-31" }, "csv"), /^[A-Za-z0-9_.-]+$/);
  assert.equal(sheetName("Posição: atual/estoque [x]?"), "Posição atual estoque x");
  assert.ok(sheetName("a".repeat(80)).length <= 31);
  assert.equal(sheetName("***"), "Planilha");
  assert.equal(sheetName("'Resumo'"), "Resumo");
});

test("baseDocument carries identification: clinic, period, comparison, filters and generation time", () => {
  const input = { clinicName: "Clínica Ação", range: { start: "2026-11-01", end: "2026-11-30" }, previous: { start: "2026-10-02", end: "2026-10-31" }, professional: "Dra. Ana", granularityLabel: "Diário", generatedAt: "2026-11-13T13:00:00.000Z" };
  const doc = baseDocument("finance", input, { sections: [], hasData: false });
  assert.equal(doc.clinicName, "Clínica Ação");
  assert.deepEqual(doc.period, { from: "2026-11-01", to: "2026-11-30", label: "01/11/2026 – 30/11/2026" });
  assert.equal(doc.comparePeriod?.from, "2026-10-02");
  assert.deepEqual(doc.filters, [{ label: "Profissional", value: "Dra. Ana" }, { label: "Agrupamento", value: "Diário" }]);
  assert.equal(doc.generatedAt, "2026-11-13T13:00:00.000Z");
  assert.equal(doc.title, "Financeiro");
  const all = baseDocument("stock", { ...input, previous: null, professional: null }, { sections: [], hasData: true });
  assert.equal(all.comparePeriod, null);
  assert.equal(all.filters[0].value, "Todos os profissionais");
});
