// Documentos de exemplo para os testes dos renderizadores (XLSX, PDF, CSV). Sem banco.
import { PDFArray, PDFDocument, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";
import { baseDocument, chart, col, date, datetime, decimal, int, kpis, money, note, percent, row, table, text, unknown } from "../src/lib/reports-document.ts";

export const input = {
  clinicName: "Clínica Ação & Cia",
  range: { start: "2026-11-01", end: "2026-11-30" },
  previous: { start: "2026-10-02", end: "2026-10-31" },
  professional: null,
  granularityLabel: "Semanal",
  generatedAt: "2026-11-13T13:05:00.000Z",
};

export const hostile = '=HYPERLINK("http://x")';

// Linha 0: texto hostil (fórmula); 1: aspas/;/acentos; 2: palavra gigante; 3: emoji; 4: valores desconhecidos; 5: negativo.
export function sampleDocument({ rows = 6, compare = true, kind = "finance" } = {}) {
  const detailRows = Array.from({ length: rows }, (_, index) => row([
    date(`2026-11-${String((index % 28) + 1).padStart(2, "0")}`),
    datetime(`2026-11-${String((index % 28) + 1).padStart(2, "0")}T15:30:00.000Z`),
    text(index === 0 ? hostile : index === 1 ? 'Ação "especial"; ç ü ñ & <b>x</b>' : index === 2 ? `Palavra${"gigante".repeat(20)}` : index === 3 ? "Emoji 😀 日本語" : `Item ${index + 1}`),
    index === 4 ? unknown("sem custo cadastrado") : money(index === 5 ? -2500 : 123456 + index * 100),
    int(index + 1),
    index === 4 ? unknown("sem custo cadastrado") : percent(12.5 + index),
    decimal(index % 2 === 0 ? 3 : 1.5),
  ], index === 5 ? "negative" : undefined));
  const detail = table({
    id: "detail",
    title: "Detalhamento",
    detail: true,
    columns: [
      col("day", "Data", "date"),
      col("at", "Registrado em", "datetime"),
      col("name", "Descrição", "text", { width: 30 }),
      col("value", "Valor", "money", { total: "sum" }),
      col("qty", "Qtde", "int", { total: "sum" }),
      col("pct", "% do total", "percent"),
      col("dec", "Quantidade", "decimal"),
    ],
    rows: detailRows,
    withTotal: true,
    notes: ["Nota da tabela com acentos: ação."],
  });
  const analysis = table({ id: "analysis", title: "Por forma de pagamento", columns: [col("m", "Forma", "text"), col("v", "Valor", "money", { total: "sum" })], rows: [row([text("Pix"), money(1000)]), row([text("Cartão"), money(2500)])], withTotal: true });
  const summary = kpis("summary", [
    { key: "a", label: "Recebido", value: money(1_234_567), previous: money(1_000_000), change: 23.4567, changeKind: "pct", hint: "Pagamentos Pago no período." },
    { key: "b", label: "Margem", value: percent(41.25), previous: percent(40), change: 1.25, changeKind: "pp" },
    { key: "c", label: "Custo", value: unknown("sem custo cadastrado"), previous: null, change: null },
    { key: "d", label: "Resultado", value: money(-5000), previous: money(100), change: -5100, changeKind: "pct", tone: "negative" },
  ]);
  const bars = chart({ id: "bars", title: "Evolução", kind: "bar", unit: "money", categories: ["S1", "S2", "S3", "S4"], series: [{ name: "Atual", values: [100000, 250000, null, 50000], style: "current" }, { name: "Anterior", values: [90000, 200000, 150000, 0], style: "previous" }] });
  const line = chart({ id: "line", title: "Linha", kind: "line", unit: "int", categories: ["1", "2", "3"], series: [{ name: "Atual", values: [1, 3, 2] }] });
  const donut = chart({ id: "donut", title: "Distribuição", kind: "donut", unit: "money", categories: ["A", "B", "C"], series: [{ name: "Valor", values: [500, 300, 200] }] });
  return baseDocument(kind, { ...input, previous: compare ? input.previous : null }, {
    hasData: true,
    sections: [summary, note("n1", "Observação informativa."), note("n2", "Atenção: dado incompleto.", "warning"), bars, line, donut, detail, analysis].filter(Boolean),
  });
}

export function emptyDocument(kind = "stock") {
  return baseDocument(kind, { ...input, previous: null }, { hasData: false, sections: [note("empty", "Nenhuma movimentação no período.")] });
}

// Texto desenhado em cada página (strings hex dos operadores Tj, WinAnsi ~ latin1). Só o suficiente para os testes.
export async function pdfPageTexts(bytes) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    let source = "";
    for (const ref of refs) {
      const stream = ref instanceof PDFRef ? pdf.context.lookup(ref) : ref;
      if (stream instanceof PDFRawStream) source += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    }
    return [...source.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((match) => Buffer.from(match[1], "hex").toString("latin1")).join("\n");
  });
}

