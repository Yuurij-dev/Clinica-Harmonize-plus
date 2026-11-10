// PDF A4 do orçamento, gerado no servidor com pdf-lib (JS puro, sem Chromium). Puro: recebe dados já resolvidos.
// Fontes padrão (WinAnsi cobre os acentos do português). Nunca lança por dado faltando.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ProposalRow } from "./quote-proposal.ts";

export type QuotePdfInput = {
  clinic: { name?: string | null; phone?: string | null; cnpj?: string | null; address?: string | null };
  patientName?: string | null;
  dateLabel?: string | null;
  validUntil?: string | null;
  rows: ProposalRow[] | null | undefined;
  financial?: { subtotalCents?: number | null; discountCents?: number | null; totalCents?: number | null } | null;
  paymentMethod?: string | null;
  installments?: number | null;
  proposalNumber?: string | null;
};

const PAGE = { w: 595.28, h: 841.89 };
const M = 48;
const BRAND = rgb(0.318, 0.278, 0.863); // #5147dc
const INK = rgb(0.125, 0.114, 0.231);
const MUTED = rgb(0.4, 0.44, 0.54);
const LINE = rgb(0.89, 0.9, 0.94);
const SOFT = rgb(0.94, 0.937, 1);

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
// Intl usa NBSP entre "R$" e o valor; troca por espaço comum (garante o glifo em WinAnsi).
const money = (cents: number | null | undefined) =>
  typeof cents === "number" && Number.isFinite(cents) ? currency.format(cents / 100).replace(/[  ]/g, " ") : "—";
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function buildQuotePdf(input: QuotePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = (font: PDFFont, value: string) => {
    let out = "";
    for (const ch of value.replace(/[\r\n\t]+/g, " ")) {
      try { font.encodeText(ch); out += ch; } catch { out += "?"; }
    }
    return out;
  };
  const width = (font: PDFFont, size: number, value: string) => font.widthOfTextAtSize(clean(font, value), size);
  const wrap = (font: PDFFont, size: number, value: string, max: number) => {
    const lines: string[] = [];
    let current = "";
    for (const word of clean(font, value).split(" ")) {
      let part = word;
      while (part && font.widthOfTextAtSize(part, size) > max) { // palavra maior que a coluna: quebra por caractere
        let cut = part.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(part.slice(0, cut), size) > max) cut--;
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

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - M;
  const text = (value: string, x: number, size: number, font: PDFFont = regular, color = INK, align: "left" | "right" = "left") => {
    const safe = clean(font, value);
    page.drawText(safe, { x: align === "right" ? x - font.widthOfTextAtSize(safe, size) : x, y, size, font, color });
  };
  const rule = (color = LINE) => page.drawLine({ start: { x: M, y }, end: { x: PAGE.w - M, y }, thickness: 0.8, color });
  const ensure = (needed: number) => {
    if (y - needed >= M + 40) return;
    page = doc.addPage([PAGE.w, PAGE.h]);
    y = PAGE.h - M;
  };

  // Cabeçalho: marca + clínica
  const brandSize = 22;
  text("Harmonize", M, brandSize, bold);
  page.drawText("+", { x: M + width(bold, brandSize, "Harmonize"), y, size: brandSize, font: bold, color: BRAND });
  const clinicName = str(input.clinic?.name);
  if (clinicName) text(clinicName, PAGE.w - M, 12, bold, INK, "right");
  y -= 14;
  text("Proposta de tratamento", M, 10, regular, MUTED);
  y -= 14;
  rule();
  y -= 26;

  // Dados da proposta
  const meta: Array<[string, string]> = [
    ["Paciente", str(input.patientName) || "—"],
    ["Data", str(input.dateLabel) || "—"],
    ["Proposta", str(input.proposalNumber) || "—"],
    ["Validade", str(input.validUntil) || "—"],
  ];
  for (const [label, value] of meta) {
    text(label, M, 9, regular, MUTED);
    text(value, M + 70, 10, bold);
    y -= 16;
  }
  y -= 12;

  // Tabela de itens
  const cols = { name: M + 8, qty: 300, unit: 392, disc: 465, sub: PAGE.w - M - 8 }; // qty/unit/disc/sub: borda direita (folga p/ não sobrepor)
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: PAGE.w - 2 * M, height: 20, color: SOFT });
    text("PROCEDIMENTO", cols.name, 8, bold, BRAND);
    text("QTD.", cols.qty, 8, bold, BRAND, "right");
    text("VALOR UNIT.", cols.unit, 8, bold, BRAND, "right");
    text("DESCONTO", cols.disc, 8, bold, BRAND, "right");
    text("SUBTOTAL", cols.sub, 8, bold, BRAND, "right");
    y -= 24;
  };
  header();
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) {
    text("Nenhum procedimento informado.", cols.name, 10, regular, MUTED);
    y -= 18;
  }
  for (const row of rows) {
    const nameLines = wrap(regular, 10, str(row?.name) || "—", cols.qty - 40 - cols.name);
    const rowHeight = nameLines.length * 13 + 8;
    if (y - rowHeight < M + 40) { ensure(1e6); header(); }
    const top = y;
    nameLines.forEach((line, index) => { y = top - index * 13; text(line, cols.name, 10); });
    y = top;
    text(String(Number.isFinite(Number(row?.quantity)) ? Number(row.quantity) : 1), cols.qty, 10, regular, INK, "right");
    text(money(row?.unitPriceCents), cols.unit, 10, regular, INK, "right");
    text(money(row?.discountCents), cols.disc, 10, regular, INK, "right");
    text(money(row?.subtotalCents), cols.sub, 10, bold, INK, "right");
    y = top - nameLines.length * 13 - 2;
    rule();
    y -= 10;
  }
  y -= 6;

  // Totais
  ensure(110);
  const known = (values: Array<number | null | undefined>) => values.every((v) => typeof v === "number" && Number.isFinite(v)) ? values.reduce<number>((a, v) => a + Number(v), 0) : null;
  const fin = input.financial ?? {};
  const subtotal = fin.subtotalCents ?? known(rows.map((r) => r?.subtotalCents));
  const discount = fin.discountCents ?? known(rows.map((r) => r?.discountCents));
  const total = fin.totalCents ?? subtotal;
  const boxX = PAGE.w - M - 230;
  text("Subtotal", boxX, 10, regular, MUTED);
  text(money(subtotal), PAGE.w - M, 10, regular, INK, "right");
  y -= 16;
  text("Desconto", boxX, 10, regular, MUTED);
  text(money(discount), PAGE.w - M, 10, regular, INK, "right");
  y -= 10;
  page.drawRectangle({ x: boxX - 10, y: y - 30, width: 240, height: 30, color: SOFT });
  y -= 20;
  text("Valor final", boxX, 11, bold);
  text(money(total), PAGE.w - M - 8, 15, bold, BRAND, "right");
  y -= 34;

  // Condição de pagamento
  ensure(60);
  const method = str(input.paymentMethod) || "—";
  const installments = Math.max(1, Math.floor(Number(input.installments) || 1));
  let payment = method;
  if (method === "Cartão de crédito" && installments > 1 && typeof total === "number" && Number.isFinite(total)) {
    const base = Math.floor(total / installments);
    const rest = total - base * installments;
    payment += rest === 0 ? ` · ${installments}x de ${money(base)}` : ` · ${installments}x (${installments - rest}x de ${money(base)} e ${rest}x de ${money(base + 1)})`;
  }
  text("Condição de pagamento", M, 9, bold, BRAND);
  y -= 15;
  for (const line of wrap(regular, 10, payment, PAGE.w - 2 * M)) { text(line, M, 10); y -= 14; }

  // Rodapé (em todas as páginas)
  const clinicLine = [clinicName, str(input.clinic?.phone), str(input.clinic?.cnpj) && `CNPJ ${str(input.clinic?.cnpj)}`, str(input.clinic?.address)].filter(Boolean).join(" · ");
  const pages = doc.getPages();
  pages.forEach((p, index) => {
    page = p;
    y = M + 22;
    rule();
    y -= 13;
    text("Harmonize+ · harmonizeplus.com.br", M, 8, bold, MUTED);
    if (pages.length > 1) text(`${index + 1} / ${pages.length}`, PAGE.w - M, 8, regular, MUTED, "right");
    y -= 11;
    const [first] = wrap(regular, 8, clinicLine, PAGE.w - 2 * M);
    if (first) text(first, M, 8, regular, MUTED);
  });

  return doc.save();
}
