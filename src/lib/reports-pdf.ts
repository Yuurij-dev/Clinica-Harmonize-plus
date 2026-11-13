// Renderizador PDF dos Relatórios (pdf-lib, JS puro, só no servidor): relatório executivo A4 paisagem a partir do MESMO
// ReportDocument de tela/XLSX/CSV. Cabeçalho discreto com a clínica, KPIs em tiles, tabelas com cabeçalho repetido a cada
// página, gráficos simples desenhados só quando há dados, notas e rodapé "Gerado pelo Harmonize+ · Página X de Y".
// Fontes padrão (WinAnsi): caracteres fora do charset são trocados sem lançar erro. Nada força quebra de página antes de
// uma seção curta; blocos pequenos (tile, gráfico, cabeçalho + 2 linhas) nunca se partem.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  cellDisplay, columnAlign, formatDateTimeBr, isUnknown, UNKNOWN_DISPLAY,
  type Cell, type ChartSection, type KpiItem, type KpiSection, type NoteSection, type ReportDocument, type TableSection,
} from "./reports-document.ts";
import { compactMoney, formatMoneyBr, formatNumberPtBr, formatPctBr } from "./reports-ui-rules.ts";

const PAGE = { w: 841.89, h: 595.28 };
const M = 36;
const CONTENT = PAGE.w - 2 * M;
const FOOTER_RESERVE = 30;
const BOTTOM = M + FOOTER_RESERVE;
const TOP_FIRST = PAGE.h - M;
const TOP_NEXT = PAGE.h - M - 8;

const PURPLE = rgb(0.318, 0.278, 0.863); // #5147DC
const INK = rgb(0.122, 0.114, 0.231);
const MUTED = rgb(0.42, 0.45, 0.5);
const GRAY = rgb(0.61, 0.64, 0.69);
const LINE = rgb(0.9, 0.91, 0.94);
const SOFT = rgb(0.955, 0.953, 0.995);
const STRIPE = rgb(0.972, 0.97, 0.997);
const TOTAL = rgb(0.925, 0.92, 0.99);
const WHITE = rgb(1, 1, 1);
const NEGATIVE = rgb(0.75, 0.22, 0.17);
const POSITIVE = rgb(0.08, 0.5, 0.24);
const WARNING = rgb(0.72, 0.42, 0.02);
const TONE_FILL = { negative: rgb(0.995, 0.94, 0.935), warning: rgb(1, 0.965, 0.9), positive: rgb(0.935, 0.98, 0.95), muted: null } as const;
const PREVIOUS = rgb(0.66, 0.64, 0.93);
const PALETTE = [PURPLE, rgb(0.09, 0.66, 0.44), rgb(0.96, 0.65, 0.14), rgb(0.23, 0.51, 0.96), rgb(0.93, 0.28, 0.6), rgb(0.55, 0.6, 0.68), rgb(0.4, 0.8, 0.8)];

// O PDF é para leitura/impressão: tabelas muito longas são cortadas (o XLSX/CSV trazem tudo).
export const PDF_MAX_ROWS = 1500;

const REPLACEMENTS: Record<string, string> = { "−": "-", "≥": ">=", "≤": "<=", "→": "->", "←": "<-", " ": " ", " ": " ", " ": " ", "​": "", "️": "" };

export async function renderReportPdf(doc: ReportDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.title} — ${doc.period.label}`);
  pdf.setAuthor("Harmonize+");
  pdf.setCreator("Harmonize+");
  pdf.setProducer("Harmonize+ (pdf-lib)");
  pdf.setSubject(`Relatório ${doc.title} · ${doc.clinicName}`);
  const generated = new Date(doc.generatedAt);
  if (!Number.isNaN(generated.getTime())) { pdf.setCreationDate(generated); pdf.setModificationDate(generated); }
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // ---------- Texto ----------
  const supported = new Map<PDFFont, Map<string, string>>([[regular, new Map()], [bold, new Map()]]);
  const clean = (font: PDFFont, value: string) => {
    const cache = supported.get(font) as Map<string, string>;
    let out = "";
    for (const raw of value.replace(/[\u0000-\u001F\u007F]+/g, " ")) {
      const ch = REPLACEMENTS[raw] ?? raw;
      const cached = cache.get(ch);
      if (cached !== undefined) { out += cached; continue; }
      let result = "";
      for (const piece of ch) {
        try { font.encodeText(piece); result += piece; } catch { result += "?"; }
      }
      cache.set(ch, result);
      out += result;
    }
    return out;
  };
  const widthOf = (font: PDFFont, size: number, value: string) => font.widthOfTextAtSize(clean(font, value), size);

  // Reticências controladas quando uma linha única não cabe.
  const fit = (font: PDFFont, size: number, value: string, max: number) => {
    const safe = clean(font, value);
    if (font.widthOfTextAtSize(safe, size) <= max) return safe;
    let cut = safe.length;
    while (cut > 0 && font.widthOfTextAtSize(`${safe.slice(0, cut)}…`, size) > max) cut -= 1;
    return cut > 0 ? `${safe.slice(0, cut)}…` : "";
  };

  // Quebra por palavras; palavra maior que a coluna quebra por caractere (sem texto cortado nem sobreposto).
  const wrap = (font: PDFFont, size: number, value: string, max: number) => {
    const lines: string[] = [];
    let current = "";
    for (const word of clean(font, value).split(" ")) {
      let part = word;
      while (part && font.widthOfTextAtSize(part, size) > max) {
        let cut = Math.max(part.length - 1, 1); // nunca 0: coluna mais estreita que um caractere avança 1 por vez (sem laço infinito)
        while (cut > 1 && font.widthOfTextAtSize(part.slice(0, cut), size) > max) cut -= 1;
        if (current) { lines.push(current); current = ""; }
        lines.push(part.slice(0, cut));
        part = part.slice(cut);
      }
      const next = current ? `${current} ${part}` : part;
      if (current && font.widthOfTextAtSize(next, size) > max) { lines.push(current); current = part; } else current = next;
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  };

  // ---------- Páginas ----------
  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = TOP_FIRST;
  const put = (value: string, x: number, baseline: number, size: number, font: PDFFont = regular, color = INK, align: "left" | "right" | "center" = "left") => {
    const safe = clean(font, value);
    if (!safe) return;
    const width = font.widthOfTextAtSize(safe, size);
    page.drawText(safe, { x: align === "right" ? x - width : align === "center" ? x - width / 2 : x, y: baseline, size, font, color });
  };
  const rule = (at: number, color = LINE, from = M, to = PAGE.w - M) => page.drawLine({ start: { x: from, y: at }, end: { x: to, y: at }, thickness: 0.6, color });

  const runningHeader = () => {
    page.drawRectangle({ x: 0, y: PAGE.h - 5, width: PAGE.w, height: 5, color: PURPLE });
    put(`${doc.clinicName} · ${doc.title} · ${doc.period.label}`, M, PAGE.h - 22, 8, regular, MUTED);
    put("Harmonize+", PAGE.w - M, PAGE.h - 22, 8, bold, PURPLE, "right");
  };
  const newPage = () => {
    page = pdf.addPage([PAGE.w, PAGE.h]);
    runningHeader();
    y = TOP_NEXT - 14;
  };
  const ensure = (needed: number) => { if (y - needed < BOTTOM) newPage(); };

  // ---------- Capa / cabeçalho ----------
  page.drawRectangle({ x: 0, y: PAGE.h - 40, width: PAGE.w, height: 40, color: PURPLE });
  put("Harmonize+", M, PAGE.h - 25, 14, bold, WHITE);
  put(doc.clinicName || "Clínica", PAGE.w - M, PAGE.h - 25, 11, bold, WHITE, "right");
  y = PAGE.h - 40 - 32;
  put(doc.title, M, y, 22, bold, INK);
  y -= 16;
  for (const lineText of wrap(regular, 10, doc.subtitle, CONTENT)) { put(lineText, M, y, 10, regular, MUTED); y -= 13; }
  y -= 6;
  const info: Array<[string, string]> = [
    ["Período", doc.period.label],
    ["Comparação", doc.comparePeriod ? `Período anterior: ${doc.comparePeriod.label}` : "Desligada"],
    ["Gerado em", formatDateTimeBr(doc.generatedAt)],
  ];
  const infoWidth = CONTENT / info.length;
  info.forEach(([label, value], index) => {
    const x = M + index * infoWidth;
    put(label.toUpperCase(), x, y, 7, bold, GRAY);
    put(fit(bold, 10, value, infoWidth - 12), x, y - 12, 10, bold, INK);
  });
  y -= 26;
  const filterText = doc.filters.map((filter) => `${filter.label}: ${filter.value}`).join("   ·   ");
  if (filterText) for (const lineText of wrap(regular, 9, filterText, CONTENT)) { put(lineText, M, y, 9, regular, MUTED); y -= 12; }
  y -= 2;
  rule(y, LINE);
  y -= 18;

  // ---------- KPIs ----------
  const kpiTileText = (item: KpiItem) => {
    const lines: Array<{ text: string; color: ReturnType<typeof rgb> }> = [];
    if (item.previous) {
      const change = item.change === null || item.change === undefined || !Number.isFinite(item.change) ? null : item.change;
      const unit = item.changeKind === "pp" ? " p.p." : "%";
      const changeText = change === null ? "" : ` (${change > 0 ? "+" : ""}${formatNumberPtBr(change, 1, { trim: true })}${unit})`;
      lines.push({ text: `Anterior: ${cellDisplay(item.previous)}${changeText}`, color: change === null ? MUTED : change < 0 ? NEGATIVE : change > 0 ? POSITIVE : MUTED });
    }
    const hint = item.hint ?? (isUnknown(item.value) ? `Não disponível: ${item.value.reason}.` : "");
    if (hint) lines.push({ text: hint, color: MUTED });
    return lines;
  };

  const drawKpis = (section: KpiSection) => {
    const items = section.items;
    if (items.length === 0) return;
    if (section.title) {
      ensure(22 + 70);
      put(section.title, M, y, 11, bold, INK);
      y -= 14;
    }
    const cols = items.length <= 4 ? items.length : items.length === 5 || items.length === 6 || items.length === 9 ? 3 : 4;
    const gap = 8;
    const tileW = (CONTENT - gap * (cols - 1)) / cols;
    const inner = tileW - 20;
    for (let start = 0; start < items.length; start += cols) {
      const rowItems = items.slice(start, start + cols);
      const prepared = rowItems.map((item) => {
        const label = wrap(bold, 8, item.label, inner).slice(0, 2);
        const extra = kpiTileText(item).flatMap((entry) => wrap(regular, 7.5, entry.text, inner).slice(0, 2).map((text) => ({ text, color: entry.color })));
        return { item, label, extra: extra.slice(0, 3) };
      });
      const maxLabel = Math.max(...prepared.map((entry) => entry.label.length));
      const maxExtra = Math.max(...prepared.map((entry) => entry.extra.length));
      const height = 22 + maxLabel * 10 + 9 + (maxExtra > 0 ? 3 + maxExtra * 9 : 0);
      ensure(height + 8);
      const top = y;
      prepared.forEach((entry, index) => {
        const x = M + index * (tileW + gap);
        page.drawRectangle({ x, y: top - height, width: tileW, height, color: SOFT });
        page.drawRectangle({ x, y: top - height, width: 2.5, height, color: entry.item.tone === "negative" ? NEGATIVE : entry.item.tone === "warning" ? WARNING : PURPLE });
        let cursor = top - 14;
        entry.label.forEach((text) => { put(text, x + 12, cursor, 8, bold, MUTED); cursor -= 10; });
        cursor -= 8;
        const valueText = cellDisplay(entry.item.value);
        let size = 16;
        while (size > 9 && widthOf(bold, size, valueText) > inner) size -= 1;
        const unknownValue = isUnknown(entry.item.value);
        put(fit(bold, size, valueText, inner), x + 12, cursor, size, bold, unknownValue ? GRAY : entry.item.tone === "negative" ? NEGATIVE : entry.item.tone === "warning" ? WARNING : INK);
        cursor -= 12;
        entry.extra.forEach((line) => { put(line.text, x + 12, cursor, 7.5, regular, line.color); cursor -= 9; });
      });
      y = top - height - 8;
    }
    y -= 6;
  };

  // ---------- Notas ----------
  const drawNote = (section: NoteSection) => {
    const lines = wrap(regular, 9, section.text, CONTENT - 22);
    const height = lines.length * 12 + 10;
    ensure(height + 8);
    const warning = section.tone === "warning";
    page.drawRectangle({ x: M, y: y - height, width: CONTENT, height, color: warning ? rgb(1, 0.965, 0.9) : SOFT });
    page.drawRectangle({ x: M, y: y - height, width: 3, height, color: warning ? WARNING : PURPLE });
    lines.forEach((text, index) => put(text, M + 12, y - 14 - index * 12, 9, regular, INK));
    y -= height + 10;
  };

  // ---------- Tabelas ----------
  const drawTable = (table: TableSection) => {
    const columns = table.columns;
    const rows = table.rows.slice(0, PDF_MAX_ROWS);
    const cutNote = table.rows.length > PDF_MAX_ROWS ? `O PDF mostra as primeiras ${formatNumberPtBr(PDF_MAX_ROWS)} de ${formatNumberPtBr(table.rows.length)} linhas; a lista completa está no Excel/CSV.` : null;
    const reasons = new Set<string>();
    const gather = (cells: Cell[]) => { for (const cell of cells) if (cell.type === "unknown") reasons.add(cell.reason); };
    rows.forEach((row) => gather(row.cells));
    if (table.total) gather(table.total.cells);
    const notes = [...table.notes, cutNote, reasons.size > 0 ? `"${UNKNOWN_DISPLAY}" = não disponível (${[...reasons].join("; ")}); não é zero.` : null].filter((note): note is string => Boolean(note));
    const noteLines = notes.flatMap((note) => wrap(regular, 8, note, CONTENT));

    const display = rows.map((row) => columns.map((_, index) => (row.cells[index] ? cellDisplay(row.cells[index]) : "")));
    const totalDisplay = table.total ? columns.map((_, index) => (table.total?.cells[index] ? cellDisplay(table.total.cells[index]) : "")) : null;
    const aligns = columns.map((column) => columnAlign(column));
    const numeric = columns.map((column) => column.type !== "text");

    // Maior fonte (9 → 7) em que os mínimos das colunas cabem na largura da página.
    const pad = 6;
    const plan = (size: number) => {
      const hs = Math.max(6.5, size - 1);
      const natural: number[] = [];
      const minimum: number[] = [];
      columns.forEach((column, index) => {
        const bodyWidths = display.map((row) => widthOf(regular, size, row[index]));
        if (totalDisplay) bodyWidths.push(widthOf(bold, size, totalDisplay[index]));
        const content = Math.max(0, ...bodyWidths);
        const headerFull = widthOf(bold, hs, column.label);
        const headerWord = Math.max(0, ...column.label.split(" ").map((word) => widthOf(bold, hs, word)));
        natural[index] = Math.max(content, Math.min(headerFull, 96)) + pad * 2;
        minimum[index] = numeric[index] ? Math.max(content, headerWord) + pad * 2 : Math.min(natural[index], Math.max(headerWord, 64) + pad * 2);
      });
      return { size, hs, natural, minimum };
    };
    let layout = plan(9);
    for (const size of [8.5, 8, 7.5, 7]) {
      if (layout.minimum.reduce((sum, value) => sum + value, 0) <= CONTENT) break;
      layout = plan(size);
    }
    const sumMin = layout.minimum.reduce((sum, value) => sum + value, 0);
    const sumNatural = layout.natural.reduce((sum, value) => sum + value, 0);
    let widths: number[];
    if (sumMin >= CONTENT) widths = layout.minimum.map((value) => (value / sumMin) * CONTENT); // extremo: proporcional (reticências controladas)
    else if (sumNatural <= CONTENT) widths = layout.natural.map((value) => (value / sumNatural) * CONTENT);
    else {
      // Colunas de texto dividem o espaço que sobra, de forma proporcional ao quanto ainda podem crescer.
      const room = CONTENT - sumMin;
      const grow = layout.natural.map((value, index) => (numeric[index] ? 0 : value - layout.minimum[index]));
      const growTotal = grow.reduce((sum, value) => sum + value, 0);
      widths = layout.minimum.map((value, index) => value + (growTotal > 0 ? (grow[index] / growTotal) * Math.min(room, growTotal) : 0));
      const used = widths.reduce((sum, value) => sum + value, 0);
      if (used < CONTENT) widths = widths.map((value) => (value / used) * CONTENT);
    }
    const xs = widths.map((_, index) => M + widths.slice(0, index).reduce((sum, value) => sum + value, 0));
    const { size, hs } = layout;
    const lineH = size * 1.28;

    const headerLines = columns.map((column, index) => wrap(bold, hs, column.label, widths[index] - pad * 2));
    const headerH = Math.max(...headerLines.map((lines) => lines.length)) * (hs * 1.25) + 9;
    const cellLines = (value: string, index: number, font: PDFFont) => (numeric[index] ? [fit(font, size, value, widths[index] - pad * 2)] : wrap(font, size, value, widths[index] - pad * 2));
    const rowHeight = (cells: string[], font: PDFFont) => Math.max(...cells.map((value, index) => cellLines(value, index, font).length)) * lineH + 7;

    // Título + notas + cabeçalho + as 2 primeiras linhas ficam juntos (sem título órfão).
    const firstRows = display.slice(0, 2).reduce((sum, cells) => sum + rowHeight(cells, regular), 0) + (display.length <= 2 && totalDisplay ? rowHeight(totalDisplay, bold) : 0);
    ensure(18 + noteLines.length * 10 + 4 + (display.length > 0 ? headerH + firstRows : 22));
    put(table.title, M, y, 11, bold, INK);
    y -= 14;
    for (const text of noteLines) { put(text, M, y, 8, regular, MUTED); y -= 10; }
    if (noteLines.length > 0) y -= 4;
    if (display.length === 0) {
      put("Sem linhas no período.", M, y - 4, 9, regular, MUTED);
      y -= 24;
      return;
    }

    const drawHeader = () => {
      page.drawRectangle({ x: M, y: y - headerH, width: CONTENT, height: headerH, color: PURPLE });
      headerLines.forEach((lines, index) => {
        lines.forEach((text, lineIndex) => {
          const baseline = y - 6 - hs - lineIndex * hs * 1.25;
          if (aligns[index] === "right") put(text, xs[index] + widths[index] - pad, baseline, hs, bold, WHITE, "right");
          else if (aligns[index] === "center") put(text, xs[index] + widths[index] / 2, baseline, hs, bold, WHITE, "center");
          else put(text, xs[index] + pad, baseline, hs, bold, WHITE);
        });
      });
      y -= headerH;
    };

    const drawRow = (cells: string[], source: Cell[], fillColor: ReturnType<typeof rgb> | null, font: PDFFont, height: number, lineBelow: boolean) => {
      if (fillColor) page.drawRectangle({ x: M, y: y - height, width: CONTENT, height, color: fillColor });
      cells.forEach((value, index) => {
        const cell = source[index];
        const lines = cellLines(value, index, font);
        const negative = cell && (cell.type === "int" || cell.type === "decimal" || cell.type === "money" || cell.type === "percent") && cell.value < 0;
        const color = cell && isUnknown(cell) ? GRAY : negative ? NEGATIVE : INK;
        lines.forEach((text, lineIndex) => {
          const baseline = y - 3.5 - size - lineIndex * lineH + 1;
          if (aligns[index] === "right") put(text, xs[index] + widths[index] - pad, baseline, size, font, color, "right");
          else if (aligns[index] === "center") put(text, xs[index] + widths[index] / 2, baseline, size, font, color, "center");
          else put(text, xs[index] + pad, baseline, size, font, color);
        });
      });
      if (lineBelow) rule(y - height, LINE);
      y -= height;
    };

    drawHeader();
    rows.forEach((row, index) => {
      const cells = display[index];
      const height = rowHeight(cells, regular);
      // A última linha viaja com o total (sem total órfão numa página nova).
      const needed = height + (index === rows.length - 1 && totalDisplay ? rowHeight(totalDisplay, bold) : 0);
      if (y - needed < BOTTOM) { newPage(); drawHeader(); }
      const tone = row.tone ? TONE_FILL[row.tone] : null;
      drawRow(cells, row.cells, tone ?? (index % 2 === 1 ? STRIPE : null), regular, height, true);
    });
    if (totalDisplay && table.total) {
      const height = rowHeight(totalDisplay, bold);
      if (y - height < BOTTOM) { newPage(); drawHeader(); }
      rule(y, PURPLE);
      drawRow(totalDisplay, table.total.cells, TOTAL, bold, height, false);
    }
    y -= 18;
  };

  // ---------- Gráficos ----------
  const formatValue = (unit: ChartSection["unit"], value: number) => (unit === "money" ? formatMoneyBr(Math.round(value)) : unit === "percent" ? formatPctBr(value) : formatNumberPtBr(value, 0));
  const axisValue = (unit: ChartSection["unit"], value: number) => (unit === "money" ? compactMoney(value / 100) : unit === "percent" ? `${formatNumberPtBr(value, 0)}%` : formatNumberPtBr(value, 0));

  function niceScale(min: number, max: number) {
    const lo0 = Math.min(0, min);
    const hi0 = Math.max(0, max);
    const range = hi0 - lo0 || 1;
    const rough = range / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const norm = rough / magnitude;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude;
    return { lo: Math.floor(lo0 / step) * step, hi: Math.ceil(hi0 / step) * step, step };
  }

  const seriesColor = (series: ChartSection["series"][number], index: number) => (series.style === "previous" ? PREVIOUS : series.style === "current" ? PURPLE : PALETTE[index % PALETTE.length]);

  const legendFor = (section: ChartSection, atY: number) => {
    if (section.series.length < 2) return;
    let x = PAGE.w - M;
    for (let index = section.series.length - 1; index >= 0; index -= 1) {
      const series = section.series[index];
      const label = fit(regular, 8, series.name, 120);
      const width = widthOf(regular, 8, label);
      put(label, x, atY, 8, regular, MUTED, "right");
      page.drawRectangle({ x: x - width - 12, y: atY - 1, width: 8, height: 8, color: seriesColor(series, index) });
      x -= width + 24;
    }
  };

  const drawAxisChart = (section: ChartSection) => {
    const plotH = 120;
    const titleH = 18;
    const labelH = 22;
    ensure(titleH + plotH + labelH + 14);
    put(section.title, M, y, 11, bold, INK);
    legendFor(section, y);
    const values = section.series.flatMap((series) => series.values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
    const scale = niceScale(Math.min(0, ...values), Math.max(0, ...values));
    const plotTop = y - titleH;
    const plotBottom = plotTop - plotH;
    const axisW = Math.max(30, ...[scale.lo, scale.hi].map((value) => widthOf(regular, 7, axisValue(section.unit, value)) + 8));
    const left = M + axisW;
    const plotW = PAGE.w - M - left;
    const toY = (value: number) => plotBottom + ((value - scale.lo) / (scale.hi - scale.lo || 1)) * plotH;
    for (let tick = scale.lo; tick <= scale.hi + scale.step / 2; tick += scale.step) {
      const at = toY(tick);
      rule(at, tick === 0 ? GRAY : LINE, left, PAGE.w - M);
      put(axisValue(section.unit, tick), left - 5, at - 2.5, 7, regular, MUTED, "right");
    }
    const count = section.categories.length;
    const group = plotW / count;
    // Rótulos do eixo X por amostragem: nunca se sobrepõem.
    const labelMax = Math.max(...section.categories.map((label) => widthOf(regular, 7, label)));
    const every = Math.max(1, Math.ceil((Math.min(labelMax, 70) + 6) / group));
    section.categories.forEach((label, index) => {
      if (index % every !== 0) return;
      put(fit(regular, 7, label, Math.min(group * every - 3, 74)), left + group * (index + 0.5), plotBottom - 11, 7, regular, MUTED, "center");
    });

    if (section.kind === "bar") {
      const seriesCount = section.series.length;
      const barW = Math.min(30, (group * 0.72) / seriesCount);
      const showValues = count <= 12 && seriesCount === 1 && group > 38;
      section.series.forEach((series, seriesIndex) => {
        series.values.forEach((value, index) => {
          if (typeof value !== "number" || !Number.isFinite(value)) return;
          const x = left + group * (index + 0.5) - (barW * seriesCount) / 2 + seriesIndex * barW;
          const base = toY(0);
          const top = toY(value);
          const height = Math.abs(top - base);
          page.drawRectangle({ x: x + 0.5, y: Math.min(base, top), width: Math.max(barW - 1, 1), height: Math.max(height, value === 0 ? 0 : 0.8), color: seriesColor(series, seriesIndex) });
          if (showValues) put(axisValue(section.unit, value), x + barW / 2, (value >= 0 ? top + 3 : top - 9), 7, regular, INK, "center");
        });
      });
    } else {
      section.series.forEach((series, seriesIndex) => {
        const color = seriesColor(series, seriesIndex);
        let last: { x: number; y: number } | null = null;
        series.values.forEach((value, index) => {
          if (typeof value !== "number" || !Number.isFinite(value)) { last = null; return; }
          const point = { x: left + group * (index + 0.5), y: toY(value) };
          if (last) page.drawLine({ start: last, end: point, thickness: 1.6, color, ...(series.style === "previous" ? { dashArray: [4, 3] } : {}) });
          if (count <= 45) page.drawCircle({ x: point.x, y: point.y, size: 1.8, color });
          last = point;
        });
      });
    }
    y = plotBottom - labelH - 8;
  };

  // "Rosca" como barras horizontais com participação (legível em PDF e sem gráfico enganoso).
  const drawShareChart = (section: ChartSection) => {
    const series = section.series[0];
    const entries = section.categories.map((label, index) => ({ label, value: series?.values[index] ?? null })).filter((entry): entry is { label: string; value: number } => typeof entry.value === "number" && Number.isFinite(entry.value) && entry.value > 0).slice(0, 10);
    const total = entries.reduce((sum, entry) => sum + entry.value, 0);
    if (entries.length === 0 || total <= 0) return;
    const rowH = 17;
    ensure(18 + entries.length * rowH + 8);
    put(section.title, M, y, 11, bold, INK);
    y -= 18;
    const labelW = Math.min(220, CONTENT * 0.3);
    const valueW = 120;
    const trackX = M + labelW + 8;
    const trackW = CONTENT - labelW - valueW - 16;
    const max = Math.max(...entries.map((entry) => entry.value));
    entries.forEach((entry, index) => {
      const top = y - index * rowH;
      put(fit(regular, 8.5, entry.label, labelW), M, top - 10, 8.5, regular, INK);
      page.drawRectangle({ x: trackX, y: top - 12, width: trackW, height: 9, color: SOFT });
      page.drawRectangle({ x: trackX, y: top - 12, width: Math.max(1.5, (entry.value / max) * trackW), height: 9, color: PALETTE[index % PALETTE.length] });
      put(`${formatValue(section.unit, entry.value)} · ${formatPctBr((entry.value / total) * 100)}`, PAGE.w - M, top - 10, 8, regular, MUTED, "right");
    });
    y -= entries.length * rowH + 8;
  };

  // ---------- Corpo ----------
  for (const section of doc.sections) {
    if (section.type === "kpis") drawKpis(section);
    else if (section.type === "note") drawNote(section);
    else if (section.type === "table") drawTable(section);
    else if (section.kind === "donut") drawShareChart(section);
    else drawAxisChart(section);
  }

  // ---------- Rodapé em todas as páginas ----------
  const pages = pdf.getPages();
  pages.forEach((target, index) => {
    page = target;
    rule(M + 18, LINE);
    put(`Gerado pelo Harmonize+ · ${doc.clinicName || "Relatórios"} · ${formatDateTimeBr(doc.generatedAt)}`, M, M + 6, 8, regular, MUTED);
    put(`Página ${index + 1} de ${pages.length}`, PAGE.w - M, M + 6, 8, regular, MUTED, "right");
  });

  return pdf.save();
}
