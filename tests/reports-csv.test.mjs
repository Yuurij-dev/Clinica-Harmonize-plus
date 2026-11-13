import assert from "node:assert/strict";
import { test } from "node:test";
import { CSV_BOM, CsvUnsupportedError, csvEscape, csvValue, guardFormula, renderReportCsv } from "../src/lib/reports-csv.ts";
import { date, datetime, decimal, int, money, percent, text, unknown } from "../src/lib/reports-document.ts";
import { buildAllSpec } from "../src/lib/reports-xlsx-specs/index.ts";
import { allBundles, appointmentRows, appointmentsBundle, catalog, financeBundle, input, proceduresBundle, stockBundle } from "./reports-xlsx-fixtures.mjs";
import { baseDocument, note } from "../src/lib/reports-document.ts";

test("escape: ';', aspas e quebra de linha ganham aspas; aspas internas dobradas", () => {
  assert.equal(csvEscape("simples"), "simples");
  assert.equal(csvEscape("a;b"), '"a;b"');
  assert.equal(csvEscape('diz "oi"'), '"diz ""oi"""');
  assert.equal(csvEscape("a\nb"), '"a\nb"');
  assert.equal(csvEscape("a\r\nb"), '"a\r\nb"');
});

test("injeção de fórmula: = + - @ TAB CR ganham apóstrofo; texto normal não", () => {
  for (const value of ["=1+1", "+1", "-1", "@SUM(A1)", "\t1", "\r1", "  =1"]) assert.ok(guardFormula(value).startsWith("'"), JSON.stringify(value));
  assert.equal(guardFormula("Botox"), "Botox");
  assert.equal(guardFormula("Ação"), "Ação");
});

test("valores: moeda como número puro (1250,00), decimal com vírgula, % como número, datas dd/mm/aaaa, desconhecido vazio", () => {
  assert.equal(csvValue(money(125000)), "1250,00");
  assert.equal(csvValue(money(123456789)), "1234567,89");
  assert.equal(csvValue(money(-2500)), "-25,00");
  assert.equal(csvValue(money(0)), "0,00");
  assert.equal(csvValue(percent(12.5)), "12,5");
  assert.equal(csvValue(percent(40)), "40");
  assert.equal(csvValue(int(1234567)), "1234567");
  assert.equal(csvValue(decimal(1.5)), "1,5");
  assert.equal(csvValue(decimal(3)), "3");
  assert.equal(csvValue(date("2026-11-05")), "05/11/2026");
  assert.equal(csvValue(datetime("2026-11-05T15:30:00.000Z")), "05/11/2026 12:30");
  assert.equal(csvValue(unknown("sem custo cadastrado")), "");
  assert.equal(csvValue(text("a;b")), '"a;b"');
  assert.equal(csvValue(text('=HYPERLINK("http://x")')), `"'=HYPERLINK(""http://x"")"`);
});

test("SÓ DADOS: linha 1 = cabeçalho da tabela principal (as colunas do Excel), sem metadados nem 'Nota', BOM, CRLF, ';'", () => {
  const csv = renderReportCsv(proceduresBundle().spec);
  assert.ok(csv.startsWith(CSV_BOM));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], "Data;Procedimento;Profissional;Valor de tabela;Custo de material;Margem");
  assert.equal(lines.length, 1 + 32);
  assert.ok(!csv.includes("Relatório;") && !csv.includes("Clínica;") && !csv.includes("Período;") && !csv.includes("Gerado em") && !/^Nota;/m.test(csv));
  assert.ok(!csv.includes("R$"));
  assert.match(lines[1], /^\d{2}\/\d{2}\/\d{4};[^;]+;[^;]+;\d+,\d{2};\d+,\d{2};\d+,\d{2}$/);
});

test("desconhecido = célula vazia (nunca 0): procedimento sem ficha técnica tem custo e margem vazios", () => {
  const lines = renderReportCsv(proceduresBundle().spec).split("\r\n");
  const limpeza = lines.filter((line) => line.includes(";Limpeza de pele;"));
  assert.ok(limpeza.length > 0);
  for (const line of limpeza) assert.match(line, /;280,00;;$/);
});

test("sem dados: só a linha de cabeçalho", () => {
  const csv = renderReportCsv(proceduresBundle({ rows: [] }).spec);
  assert.equal(csv, `${CSV_BOM}Data;Procedimento;Profissional;Valor de tabela;Custo de material;Margem`);
  const stock = renderReportCsv(stockBundle({ empty: true }).spec);
  assert.equal(stock.split("\r\n").length, 1);
});

test("cada relatório exporta a tabela principal; Estoque = posição por item; PROFESSIONAL sem colunas de custo", () => {
  assert.equal(renderReportCsv(stockBundle().spec).split("\r\n")[0].slice(1), "Item;Tipo;Unidade;Saldo;Mínimo;Situação;Custo unitário;Valor em estoque;Próxima validade");
  assert.equal(renderReportCsv(stockBundle({ costHidden: true }).spec).split("\r\n")[0].slice(1), "Item;Tipo;Unidade;Saldo;Mínimo;Situação;Próxima validade");
  assert.equal(renderReportCsv(financeBundle().spec).split("\r\n")[0].slice(1), "Data;Tipo;Forma / Categoria;Situação;Parcelas;Valor");
  const headers = Object.fromEntries(Object.entries(allBundles()).map(([kind, bundle]) => [kind, renderReportCsv(bundle.spec).split("\r\n")[0].slice(1)]));
  assert.equal(headers.appointments, "Data;Hora;Profissional;Procedimento;Situação");
  assert.equal(headers.professionals, "Data;Profissional;Procedimento;Situação;Valor de tabela");
  assert.equal(headers.quotes, "Criado em;Situação;Valor;Enviado em;Aprovado/Recusado em;Validade");
  assert.equal(headers.clients, "Período;Novos cadastros;Pacientes atendidos;Atendimentos realizados;Base acumulada");
});

test("texto hostil é protegido e o CSV não identifica paciente nem texto livre", () => {
  const rows = [{ day: "2026-11-01", patientId: "p1", procedure: "=cmd", professional: "+evil;\"x\"", status: "Atendido" }];
  const bundle = proceduresBundle({ rows, cat: [...catalog, { name: "=cmd", priceCents: 1000, materialCostCents: 100, materialCostReason: null }] });
  const csv = renderReportCsv(bundle.spec);
  assert.ok(csv.includes("'=cmd"));
  assert.ok(csv.includes(`"'+evil;""x"""`));
  assert.ok(!/p1|Paciente/.test(csv.replace("Profissional", "")));
  const fin = renderReportCsv(financeBundle().spec);
  assert.ok(!fin.includes("SEGREDO"));
});

test("consolidado (all) não tem CSV", () => {
  const doc = baseDocument("all", input({ previous: null }), { hasData: true, sections: [note("c", "x")] });
  const spec = buildAllSpec(doc, Object.values(allBundles()));
  assert.throws(() => renderReportCsv(spec), CsvUnsupportedError);
});

test("agendamentos: hora como texto, uma linha por agendamento do período", () => {
  const lines = renderReportCsv(appointmentsBundle({ rows: appointmentRows(40) }).spec).split("\r\n");
  assert.equal(lines.length, 41);
  assert.match(lines[1], /^\d{2}\/\d{2}\/2026;\d{2}:00;/);
});

