import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cellView, documentKey, downloadFileName, exportSuccessMessage, exportUrl, groupSections, previewItems, previewKey, reportCenterGroups,
  tableUnknownReasons, visibleRowCount,
} from "../src/lib/reports-center-rules.ts";
import { baseDocument, int, kpis, money, note, row, table, text, unknown, unknownReasons } from "../src/lib/reports-document.ts";

const filters = { period: "last30", from: "", to: "", compare: false, professional: "", granularity: null };
const all = { finance: true, quotes: true, stock: true };

test("central: agrupa por categoria na ordem do catalogo", () => {
  const groups = reportCenterGroups(all);
  assert.deepEqual(groups.map((group) => group.category), ["Financeiro", "Operação", "Clientes", "Estoque"]);
  assert.deepEqual(groups[0].reports.map((report) => report.id), ["finance", "quotes"]);
  assert.deepEqual(groups[1].reports.map((report) => report.id), ["procedures", "professionals", "appointments"]);
  assert.ok(!groups.flatMap((group) => group.reports).some((report) => report.id === "overview" || report.id === "all"));
});

test("central: cartao sem permissao nao aparece e categoria vazia some", () => {
  const none = reportCenterGroups({ finance: false, quotes: false, stock: false });
  assert.deepEqual(none.map((group) => group.category), ["Operação", "Clientes"]);
  assert.ok(!none.flatMap((group) => group.reports).some((report) => ["finance", "quotes", "stock"].includes(report.id)));
  const onlyQuotes = reportCenterGroups({ finance: false, quotes: true, stock: false });
  assert.deepEqual(onlyQuotes[0].reports.map((report) => report.id), ["quotes"]);
});

test("chave de cache da previa: relatorio + todos os parametros, sem granularidade", () => {
  assert.equal(previewKey("stock", filters), "/api/reports/document?tab=stock&period=last30");
  const custom = { ...filters, period: "custom", from: "2026-01-01", to: "2026-01-31", compare: true, professional: "Ana", granularity: "week" };
  assert.equal(previewKey("finance", custom), "/api/reports/document?tab=finance&period=custom&from=2026-01-01&to=2026-01-31&compare=1&professional=Ana");
  assert.notEqual(previewKey("finance", filters), previewKey("quotes", filters));
  assert.notEqual(previewKey("finance", filters), previewKey("finance", { ...filters, compare: true }));
  assert.notEqual(previewKey("finance", filters), previewKey("finance", { ...filters, professional: "Ana" }));
  assert.equal(previewKey("finance", custom), previewKey("finance", { ...custom, granularity: "month" }));
  // a aba mantem a granularidade (muda a evolucao)
  assert.match(documentKey("stock", { ...filters, granularity: "month" }), /granularity=month/);
});

test("url de exportacao usa os mesmos filtros da tela", () => {
  assert.equal(exportUrl("finance", "xlsx", { ...filters, compare: true, professional: "Ana Souza" }), "/api/reports/export?period=last30&compare=1&professional=Ana+Souza&format=xlsx&tab=finance");
  assert.match(exportUrl("all", "pdf", filters), /format=pdf&tab=all$/);
});

test("nome do arquivo baixado: do cabecalho, saneado, ou padrao com a extensao", () => {
  assert.equal(downloadFileName('attachment; filename="Harmonize_Estoque_2026-11-01_a_2026-11-30.xlsx"', "stock", "xlsx"), "Harmonize_Estoque_2026-11-01_a_2026-11-30.xlsx");
  assert.equal(downloadFileName('attachment; filename="../../x y.xlsx"', "stock", "xlsx"), "....xy.xlsx");
  assert.equal(downloadFileName(null, "stock", "csv"), "Harmonize_Estoque.csv");
  assert.equal(downloadFileName('attachment; filename="a.pdf"', "finance", "xlsx"), "Harmonize_Financeiro.xlsx");
  assert.equal(downloadFileName(undefined, "desconhecido", "pdf"), "Harmonize_Relatorio.pdf");
});

test("toast de sucesso: CSV nao diz que abre no Excel", () => {
  assert.equal(exportSuccessMessage("xlsx"), "Excel gerado.");
  assert.equal(exportSuccessMessage("pdf"), "PDF gerado.");
  assert.ok(!/excel/i.test(exportSuccessMessage("csv")));
  assert.match(exportSuccessMessage("csv"), /^CSV gerado/);
});

test("celula desconhecida: traco com o motivo, nunca R$ 0,00; zero real continua zero", () => {
  const unknownCell = cellView(unknown(unknownReasons.noCost));
  assert.deepEqual(unknownCell, { text: "—", reason: "sem custo cadastrado", unknown: true });
  assert.equal(cellView(money(0)).text, "R$ 0,00");
  assert.equal(cellView(money(123456)).text, "R$ 1.234,56");
  assert.equal(cellView(int(0)).reason, null);
  assert.equal(cellView(text("Botox")).text, "Botox");
});

const input = { clinicName: "Clinica", range: { start: "2026-11-01", end: "2026-11-30" }, previous: null, professional: null, generatedAt: "2026-11-13T12:00:00.000Z" };

test("previa: 1-2 primeiros KPIs, desconhecido com motivo; vazio nao tem KPIs", () => {
  const doc = baseDocument("stock", input, {
    hasData: true,
    sections: [note("n", "x"), kpis("k", [
      { key: "a", label: "Itens", value: int(0) },
      { key: "b", label: "Valor", value: unknown(unknownReasons.noCost) },
      { key: "c", label: "Outro", value: int(3) },
    ])],
  });
  assert.deepEqual(previewItems(doc), [
    { key: "a", label: "Itens", text: "0", reason: null },
    { key: "b", label: "Valor", text: "—", reason: "sem custo cadastrado" },
  ]);
  assert.equal(previewItems(doc, 1).length, 1);
  assert.deepEqual(previewItems(baseDocument("stock", input, { hasData: false, sections: [note("e", "Nenhuma movimentação no período.")] })), []);
});

test("legenda de motivos distintos da tabela e paginacao de linhas", () => {
  const columns = [{ key: "n", label: "N", type: "text" }, { key: "c", label: "C", type: "money" }];
  const section = table({ id: "t", title: "T", columns, rows: [row([text("a"), unknown(unknownReasons.noCost)]), row([text("b"), unknown(unknownReasons.noCost)]), row([text("c"), unknown(unknownReasons.noSheet)])] });
  assert.deepEqual(tableUnknownReasons(section).sort(), ["sem custo cadastrado", "sem ficha técnica"]);
  assert.equal(visibleRowCount(50, 1), 50);
  assert.equal(visibleRowCount(250, 1), 100);
  assert.equal(visibleRowCount(250, 2), 200);
  assert.equal(visibleRowCount(250, 9), 250);
});

test("graficos vizinhos agrupam; demais secoes ficam isoladas", () => {
  const c = (id) => ({ type: "chart", id });
  const groups = groupSections([note("a", "x"), c("1"), c("2"), table({ id: "t", title: "T", columns: [], rows: [] }), c("3")]);
  assert.deepEqual(groups.map((group) => group.kind), ["single", "charts", "single", "charts"]);
  assert.equal(groups[1].sections.length, 2);
});
