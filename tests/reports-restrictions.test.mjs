import assert from "node:assert/strict";
import { test } from "node:test";
import { renderReportCsv } from "../src/lib/reports-csv.ts";
import { renderReportFile } from "../src/lib/reports-export.ts";
import { renderXlsx, MAX_AGGREGATE_ROWS } from "../src/lib/reports-xlsx-layout.ts";
import { limitDetail } from "../src/lib/reports-xlsx-specs/common.ts";
import { safeCriterionKey } from "../src/lib/reports-xlsx-types.ts";
import { catalog, doneRows, financeBundle, proceduresBundle, stockBundle } from "./reports-xlsx-fixtures.mjs";
import { pdfPageTexts } from "./reports-fixtures.mjs";
import { readXlsx } from "./reports-xlsx-reader.mjs";

const restrictedCatalog = catalog.map((entry) => ({ ...entry, materialCostCents: null, materialCostReason: "restricted" }));

test("financeiro: a coluna Valor mistura recebimento/despesa/pago/pendente, então não há linha Total somada; o agregado usa SUMIFS por tipo e situação", async () => {
  const bundle = financeBundle();
  const x = await readXlsx(await renderXlsx(bundle.spec));
  const sheet = x.sheet("Financeiro");
  assert.ok(!Object.values(sheet.cells).some((cell) => cell.formula && cell.formula.startsWith("SUBTOTAL")));
  assert.ok(!Object.values(sheet.cells).some((cell) => typeof cell.value === "string" && cell.value.startsWith("Total")));
  const resumo = x.sheet("Resumo");
  const formulas = Object.values(resumo.cells).map((cell) => cell.formula).filter(Boolean);
  assert.ok(formulas.some((formula) => /^SUMIFS\(Financeiro!F2:F\d+,Financeiro!C2:C\d+,B\d+,Financeiro!B2:B\d+,"Recebimento",Financeiro!D2:D\d+,"Pago"\)$/.test(formula)));
});

test("safeCriterionKey recusa operador, curinga, número/data, notação científica, TRUE/FALSE, '#...' e chaves com mais de 250 caracteres", () => {
  for (const unsafe of ["=x", ">5", "<=1", "#REF!", "#valor", "a*b", "a?b", "a~b", "01/11", "12", "-3", "1e5", "1E10", "2e+3", "TRUE", "false", "True", "", "x".repeat(251)]) assert.equal(safeCriterionKey(unsafe), false, JSON.stringify(unsafe));
  for (const safe of ["Botox", "Dra. Ana", "Peeling químico", "@SUM(A1)", "e5", "1e", "Verdadeiro", "x".repeat(250)]) assert.equal(safeCriterionKey(safe), true, safe);
});

test("política de corte: sempre as linhas mais recentes (cronológicas mantêm as últimas; ordenadas do mais novo mantêm as primeiras)", () => {
  const rows = Array.from({ length: 10 }, (_, index) => index + 1);
  assert.deepEqual(limitDetail(rows, 4), { rows: [7, 8, 9, 10], truncated: { shown: 4, total: 10 } });
  assert.deepEqual(limitDetail(rows, 4, "first"), { rows: [1, 2, 3, 4], truncated: { shown: 4, total: 10 } });
  assert.deepEqual(limitDetail(rows, 20), { rows, truncated: null });
  const bundle = proceduresBundle({ rows: doneRows(5100) });
  const sheet = bundle.spec.sheets[0];
  assert.equal(sheet.rows.length, 5000);
  const days = sheet.rows.map((row) => row[0].value);
  assert.deepEqual(days, [...days].sort()); // continua cronológico
  assert.equal(days.filter((day) => day === "2026-10-15").length, 70); // 170 no dia mais antigo: as 100 mais antigas saíram
});

test("cabeçalho X-Report-Truncated só aparece em CSV/XLSX truncados (mostradas/total)", async () => {
  const big = proceduresBundle({ rows: doneRows(5100) });
  assert.equal((await renderReportFile(big, "csv")).headers["X-Report-Truncated"], "5000/5100");
  assert.equal((await renderReportFile(big, "xlsx")).headers["X-Report-Truncated"], "5000/5100");
  assert.equal((await renderReportFile(big, "pdf")).headers["X-Report-Truncated"], undefined);
  assert.equal((await renderReportFile(proceduresBundle(), "csv")).headers["X-Report-Truncated"], undefined);
  assert.equal((await renderReportFile(proceduresBundle({ rows: [] }), "csv")).headers["X-Report-Truncated"], undefined);
});

test("agregado com mais de 500 linhas: mostra 500, mas Total e participação usam o total REAL (sem SUM sobre as linhas mostradas)", async () => {
  const bundle = proceduresBundle();
  const { int, money, unknown } = await import("../src/lib/reports-document.ts");
  const rows = Array.from({ length: 600 }, (_, index) => ({ key: `Proc ${String.fromCharCode(65 + (index % 26))}${index}`, cells: [int(1), money(1000), money(0), unknown("x")], exprs: [null, null, null, null] }));
  const spec = { ...bundle.spec, aggregate: { ...bundle.spec.aggregate, rows } };
  const resumo = (await readXlsx(await renderXlsx(spec))).sheet("Resumo");
  const first = 15;
  const totalRow = first + MAX_AGGREGATE_ROWS;
  assert.equal(resumo.cells[`B${totalRow}`].value, "Total (todas as 600 linhas)");
  assert.equal(resumo.cells[`D${totalRow}`].value, 600); // total real, não 500
  assert.equal(resumo.cells[`D${totalRow}`].formula, null);
  assert.equal(resumo.cells[`F${totalRow}`].value, 6000);
  assert.ok(Math.abs(resumo.cells[`J${first}`].value - 1000 / 600_000) < 1e-12); // sobre o total real (R$ 6.000,00 = 600 × 10)
  assert.equal(resumo.cells[`J${first}`].formula, null);
  assert.ok(Math.abs(resumo.cells[`J${totalRow}`].value - 500 / 600) < 1e-9);
  assert.equal(resumo.cells[`B${totalRow + 1}`], undefined);
  assert.ok(!resumo.cells[`B${first + 500}`] || resumo.cells[`B${first + 500}`].value === resumo.cells[`B${totalRow}`].value);
});

test("estoque PROFESSIONAL: sem custo de movimentação/consumo em tela (documento), XLSX, CSV e PDF", async () => {
  const bundle = stockBundle({ costHidden: true });
  const labels = bundle.doc.sections.flatMap((section) => (section.type === "kpis" ? section.items.map((item) => item.label) : []));
  assert.ok(!labels.some((label) => /Custo|Valor total em estoque/.test(label)), labels.join("|"));
  const tables = bundle.doc.sections.filter((section) => section.type === "table");
  assert.ok(tables.every((table) => !table.columns.some((column) => /Custo|Valor em estoque/.test(column.label))));
  assert.ok(!bundle.doc.sections.some((section) => section.type === "chart" && /custo|valor/i.test(section.title)));
  assert.ok(!/Custo estimado|custo atual/.test(JSON.stringify(bundle.doc).replace(/Custos não são exibidos/g, "")));
  const xlsx = await readXlsx(await renderXlsx(bundle.spec));
  const text = xlsx.sheets.flatMap((sheet) => Object.values(sheet.cells).map((cell) => String(cell.value))).join("\n").replace(/Custo unitário e valor em estoque não são exibidos[^\n]*/g, "");
  assert.ok(!/Custo estimado|Custo unitário|Valor em estoque|Valor total/.test(text));
  assert.ok(!/Custo|Valor em estoque/.test(renderReportCsv(bundle.spec)));
  const pdf = (await pdfPageTexts((await renderReportFile(bundle, "pdf")).body)).join("\n").replace(/Custo unit\xE1rio e valor em estoque n\xE3o s\xE3o exibidos[^\n]*/g, "");
  assert.ok(!/Custo estimado|Custo unit\xE1rio|Valor em estoque|Valor total em estoque/.test(pdf));
  // ADMIN continua vendo
  const full = stockBundle();
  assert.ok(JSON.stringify(full.doc).includes("Custo estimado"));
});

test("procedimentos PROFESSIONAL: custo de material e margem desconhecidos \"restrito ao seu perfil\" em documento, XLSX, CSV e PDF; valor de tabela segue", async () => {
  const bundle = proceduresBundle({ cat: restrictedCatalog });
  const items = bundle.doc.sections.find((section) => section.type === "kpis").items;
  for (const key of ["materialCost", "margin"]) {
    const item = items.find((entry) => entry.key === key);
    assert.equal(item.value.type, "unknown");
    assert.equal(item.value.reason, "restrito ao seu perfil");
  }
  assert.equal(items.find((entry) => entry.key === "tableValue").value.type, "money");
  const ranking = bundle.doc.sections.find((section) => section.id === "ranking");
  const costIndex = ranking.columns.findIndex((column) => column.key === "materialCost");
  assert.ok(ranking.rows.every((row) => row.cells[costIndex].type === "unknown" && row.cells[costIndex + 1].type === "unknown"));
  const x = await readXlsx(await renderXlsx(bundle.spec));
  const data = x.sheet("Procedimentos");
  for (let row = 2; row <= 33; row += 1) {
    assert.equal(data.cells[`E${row}`]?.value ?? null, null, `E${row}`);
    assert.equal(data.cells[`F${row}`]?.value ?? null, null, `F${row}`);
  }
  const resumo = x.sheet("Resumo");
  assert.ok(Object.values(resumo.cells).some((cell) => typeof cell.value === "string" && cell.value.includes("não são exibidos para o seu perfil")));
  const csvLines = renderReportCsv(bundle.spec).split("\r\n").slice(1);
  assert.ok(csvLines.every((line) => /;\d+,\d{2};;$/.test(line)), csvLines[0]); // valor de tabela conhecido; custo e margem vazios
  const pdf = (await pdfPageTexts((await renderReportFile(bundle, "pdf")).body)).join("\n");
  assert.ok(!/R\$ 9\.000,00|R\$ 900,00|R\$ 520,00/.test(pdf));
  // ADMIN: custo conhecido
  const admin = proceduresBundle();
  assert.equal(admin.doc.sections.find((section) => section.type === "kpis").items.find((entry) => entry.key === "materialCost").value.type, "money");
});
