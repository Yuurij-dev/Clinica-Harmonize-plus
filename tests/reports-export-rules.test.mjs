import assert from "node:assert/strict";
import { test } from "node:test";
import { reportDefinitions, reportFileName } from "../src/lib/reports-document.ts";
import { renderReportFile } from "../src/lib/reports-export.ts";
import { CSV_ALL_MESSAGE, exportContentTypes, exportFileName, exportFormatsFor, exportHeaders, exportScopeNeed, exportTabLabels, parseExportFormat, parseExportScope } from "../src/lib/reports-export-rules.ts";
import { baseDocument, note } from "../src/lib/reports-document.ts";
import { buildAllSpec } from "../src/lib/reports-xlsx-specs/index.ts";
import { allBundles, input, proceduresBundle, stockBundle } from "./reports-xlsx-fixtures.mjs";

test("parse de formato (xlsx, pdf, csv) e de tab (só ids conhecidos; compatível com os valores antigos da tela)", () => {
  for (const format of ["xlsx", "pdf", "csv"]) assert.equal(parseExportFormat(format), format);
  for (const invalid of ["xls", "", null, undefined, "PDF", "pdf;"]) assert.equal(parseExportFormat(invalid), null);
  for (const tab of ["overview", "procedures", "professionals", "clients", "quotes", "finance", "stock", "all", "appointments"]) assert.equal(parseExportScope(tab), tab);
  for (const invalid of ["../etc", "", null, "constructor", "__proto__", "toString", "Finance"]) assert.equal(parseExportScope(invalid), null);
});

test("permissão exigida por tab: só finance/quotes/stock pedem capacidade extra; all e overview não", () => {
  assert.equal(exportScopeNeed("finance"), "finance");
  assert.equal(exportScopeNeed("quotes"), "quotes");
  assert.equal(exportScopeNeed("stock"), "stock");
  for (const tab of ["all", "overview", "procedures", "professionals", "clients", "appointments"]) assert.equal(exportScopeNeed(tab), null);
});

test("rótulos de tab vêm do catálogo", () => {
  assert.equal(exportTabLabels.overview, "Visão geral");
  assert.equal(exportTabLabels.stock, reportDefinitions.stock.label);
  assert.equal(exportTabLabels.appointments, "Agendamentos");
});

test("nome de arquivo seguro: Harmonize_<Relatorio>_<inicio>_a_<fim>.<ext> só com [A-Za-z0-9_.-]", () => {
  const range = { start: "2026-11-01", end: "2026-11-30" };
  assert.equal(exportFileName("finance", range, "xlsx"), "Harmonize_Financeiro_2026-11-01_a_2026-11-30.xlsx");
  assert.equal(reportFileName("all", range, "pdf"), "Harmonize_Consolidado_2026-11-01_a_2026-11-30.pdf");
  assert.equal(reportFileName("quotes", { start: '2026-11-01"; x', end: "../2026" }, "csv"), "Harmonize_Orcamentos_2026-11-01_a_2026.csv");
  for (const id of Object.keys(reportDefinitions)) assert.match(reportFileName(id, range, "xlsx"), /^[A-Za-z0-9_.-]+$/);
});

test("cabeçalhos da resposta: tipo correto, attachment, sem cache e sem sniffing", () => {
  const headers = exportHeaders("Harmonize_Financeiro_a.xlsx", "xlsx");
  assert.equal(headers["Content-Type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(headers["Content-Disposition"], 'attachment; filename="Harmonize_Financeiro_a.xlsx"');
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(exportContentTypes.pdf, "application/pdf");
  assert.equal(exportContentTypes.csv, "text/csv; charset=utf-8");
});

test("renderReportFile gera os 3 formatos a partir do pacote (documento + planilha), com nome e cabeçalhos corretos", async () => {
  const bundle = proceduresBundle();
  const xlsx = await renderReportFile(bundle, "xlsx");
  const pdf = await renderReportFile(bundle, "pdf");
  const csv = await renderReportFile(bundle, "csv");
  assert.equal(Buffer.from(xlsx.body.subarray(0, 2)).toString(), "PK");
  assert.equal(Buffer.from(pdf.body.subarray(0, 4)).toString(), "%PDF");
  assert.deepEqual([...csv.body.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(xlsx.fileName, "Harmonize_Procedimentos_2026-10-15_a_2026-11-13.xlsx");
  assert.equal(pdf.headers["Content-Type"], "application/pdf");
  assert.match(csv.headers["Content-Disposition"], /^attachment; filename="Harmonize_Procedimentos_2026-10-15_a_2026-11-13.csv"$/);
  assert.ok(new TextDecoder().decode(csv.body).startsWith("Data;Procedimento;"));
});

test("documento sem movimentação continua exportável nos 3 formatos", async () => {
  const bundle = stockBundle({ empty: true });
  for (const format of ["xlsx", "pdf", "csv"]) {
    const file = await renderReportFile(bundle, format);
    assert.ok(file.body.length > 50, format);
    assert.match(file.fileName, /^Harmonize_Estoque_/);
  }
});

test("consolidado: sem CSV (formatos oferecidos e erro de renderização); Excel e PDF seguem", async () => {
  assert.deepEqual(exportFormatsFor("all"), ["xlsx", "pdf"]);
  assert.deepEqual(exportFormatsFor("finance"), ["xlsx", "pdf", "csv"]);
  assert.match(CSV_ALL_MESSAGE, /consolidado/);
  const doc = baseDocument("all", input({ previous: null }), { hasData: true, sections: [note("c", "x")] });
  const bundle = { doc, spec: buildAllSpec(doc, Object.values(allBundles())) };
  await assert.rejects(() => renderReportFile(bundle, "csv"));
  assert.equal(Buffer.from((await renderReportFile(bundle, "xlsx")).body.subarray(0, 2)).toString(), "PK");
  assert.equal(Buffer.from((await renderReportFile(bundle, "pdf")).body.subarray(0, 4)).toString(), "%PDF");
});
