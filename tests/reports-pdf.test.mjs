import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { baseDocument, chart, col, int, note, row, table, text } from "../src/lib/reports-document.ts";
import { renderReportPdf, PDF_MAX_ROWS } from "../src/lib/reports-pdf.ts";
import { emptyDocument, input, pdfPageTexts as pageTexts, sampleDocument } from "./reports-fixtures.mjs";

const longTable = (rows) => table({
  id: "long",
  title: "Lista longa",
  columns: [col("name", "Descrição", "text", { width: 30 }), col("n", "Quantidade", "int", { total: "sum" })],
  rows: Array.from({ length: rows }, (_, index) => row([text(`Linha número ${index + 1}`), int(index)])),
  withTotal: true,
});

test("PDF começa com %PDF, tem metadados e rodapé 'Gerado pelo Harmonize+' com Página X de Y", async () => {
  const bytes = await renderReportPdf(sampleDocument());
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), "%PDF");
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getAuthor(), "Harmonize+");
  assert.match(pdf.getTitle(), /Financeiro/);
  const pages = await pageTexts(bytes);
  const count = pages.length;
  assert.ok(count >= 1);
  pages.forEach((content, index) => {
    assert.ok(content.includes(`P\xE1gina ${index + 1} de ${count}`), `rodapé da página ${index + 1}`);
    assert.ok(content.includes("Gerado pelo Harmonize+"));
  });
  assert.ok(pages[0].includes("Cl\xEDnica A\xE7\xE3o & Cia")); // nome da clínica na capa
  assert.ok(pages[0].includes("01/11/2026"));
});

test("PDF mostra KPIs, valores formatados e desconhecido como traço (nunca R$ 0,00)", async () => {
  const pages = await pageTexts(await renderReportPdf(sampleDocument()));
  const all = pages.join("\n");
  assert.ok(all.includes("R$ 12.345,67"));
  assert.ok(all.includes("41,3%") || all.includes("41,25%") || all.includes("41,2%"));
  assert.ok(all.includes("\u0097") || all.includes("—") || all.includes("\x97")); // traço do desconhecido (WinAnsi 0x97)
  assert.ok(all.includes("n\xE3o \xE9 zero") || all.includes("n\xE3o dispon\xEDvel"));
});

test("PDF de documento vazio: uma página com identificação e a nota, sem gráfico", async () => {
  const bytes = await renderReportPdf(emptyDocument("stock"));
  const pages = await pageTexts(bytes);
  assert.equal(pages.length, 1);
  assert.ok(pages[0].includes("Nenhuma movimenta\xE7\xE3o no per\xEDodo."));
  assert.ok(pages[0].includes("P\xE1gina 1 de 1"));
});

test("tabela longa (>200 linhas) quebra páginas e repete o cabeçalho em cada uma", async () => {
  const doc = baseDocument("finance", { ...input, previous: null }, { hasData: true, sections: [longTable(450)] });
  const pages = await pageTexts(await renderReportPdf(doc));
  assert.ok(pages.length >= 6, `páginas: ${pages.length}`);
  for (const content of pages) {
    assert.ok(content.includes("Descri\xE7\xE3o") && content.includes("Quantidade"), "cabeçalho repetido");
  }
  const joined = pages.join("\n");
  assert.ok(joined.includes("Linha n\xFAmero 1") && joined.includes("Linha n\xFAmero 450"));
  assert.ok(pages.at(-1).includes("Total")); // total junto da última linha, sem página órfã
  const lastRows = pages.at(-1).split("\n").filter((entry) => entry.startsWith("Linha"));
  assert.ok(lastRows.length >= 1, "última página não fica só com o total");
});

test("tabela acima do limite do PDF é cortada com aviso claro", async () => {
  const rows = PDF_MAX_ROWS + 50;
  const doc = baseDocument("finance", { ...input, previous: null }, { hasData: true, sections: [longTable(rows)] });
  const joined = (await pageTexts(await renderReportPdf(doc))).join("\n");
  assert.ok(joined.includes("lista completa est\xE1 no Excel/CSV"));
  assert.ok(!joined.includes(`Linha n\xFAmero ${rows}`));
});

test("acentos, emoji, CJK, palavras gigantes e controles não lançam erro", async () => {
  const doc = baseDocument("finance", { ...input, clinicName: "Clínica 😀 日本語 \u0000 Ação" }, {
    hasData: true,
    sections: [
      note("n", `Nota longa ${"palavra".repeat(80)} com emoji 😀 e ≥ − → ​ fim`),
      table({
        id: "t",
        title: "Tabela com texto estranho ✓",
        columns: [col("a", "Coluna com título muito, muito longo para caber numa linha só", "text"), col("b", "Valor", "int")],
        rows: [row([text(`${"x".repeat(300)} 😀 日本語 ação`), int(1)]), row([text("=SOMA(A1)"), int(-2)])],
        withTotal: false,
      }),
      chart({ id: "c", title: "Gráfico com título enorme ".repeat(6), kind: "bar", unit: "int", categories: ["Categoria com nome muito comprido demais", "B"], series: [{ name: "Série", values: [5, 7] }] }),
    ].filter(Boolean),
  });
  const bytes = await renderReportPdf(doc);
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), "%PDF");
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 1);
});

test("todos os tipos de gráfico (barra, linha, rosca) e comparação geram PDF válido; sem dados não desenha gráfico", async () => {
  const bytes = await renderReportPdf(sampleDocument({ compare: true }));
  const text = (await pageTexts(bytes)).join("\n");
  assert.ok(text.includes("Evolu\xE7\xE3o") && text.includes("Linha") && text.includes("Distribui\xE7\xE3o"));
  assert.equal(chart({ id: "z", title: "Zeros", kind: "bar", unit: "int", categories: ["a"], series: [{ name: "s", values: [0] }] }), null);
});

test("muitas colunas (11) cabem na largura sem exceção e sem texto cortado nos números", async () => {
  const columns = Array.from({ length: 11 }, (_, index) => col(`c${index}`, `Coluna ${index + 1} com rótulo`, index === 0 ? "text" : "int"));
  const doc = baseDocument("stock", { ...input, previous: null }, {
    hasData: true,
    sections: [table({ id: "w", title: "Larga", columns, rows: [row(columns.map((column, index) => (index === 0 ? text("Item") : int(1234567 * (index + 1)))))] })],
  });
  const joined = (await pageTexts(await renderReportPdf(doc))).join("\n");
  assert.ok(joined.includes("12.345.670") || joined.includes("1.234.567"), "número inteiro (sem reticências)");
});

test("coluna estreita não trava: caractere mais largo que a coluna avança de 1 em 1 (sem laço infinito)", async () => {
  const columns = Array.from({ length: 70 }, (_, index) => col(`c${index}`, `C${index}`, "text")); // ~11 pt por coluna: menos que um "W" com o respiro
  const doc = baseDocument("stock", { ...input, previous: null }, {
    hasData: true,
    sections: [table({ id: "n", title: "Estreita", columns, rows: [row(columns.map((_, index) => text(index % 2 ? "W" : "WWWWWWWWWWWW")))] })],
  });
  const bytes = await Promise.race([renderReportPdf(doc), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout: laço infinito?")), 15_000))]);
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), "%PDF");
});
