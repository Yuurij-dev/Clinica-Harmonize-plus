import assert from "node:assert/strict";
import test from "node:test";
import { buildQuotePdf } from "../src/lib/quote-pdf.ts";

const header = (bytes) => Buffer.from(bytes.slice(0, 5)).toString("latin1");

test("gera PDF valido com itens, acentos e total", async () => {
  const bytes = await buildQuotePdf({
    clinic: { name: "Clínica Ação", phone: "11999990000", cnpj: "12345678000190", address: "Rua A, 1" },
    patientName: "Maria da Conceição",
    dateLabel: "01/12/2026",
    validUntil: "31/12/2026",
    rows: [{ name: "Toxina botulínica", quantity: 2, unitPriceCents: 50000, discountCents: 1000, subtotalCents: 99000 }],
    financial: { subtotalCents: 100000, discountCents: 1000, totalCents: 99000 },
    paymentMethod: "Cartão de crédito",
    installments: 3,
    proposalNumber: "abc123",
  });
  assert.equal(header(bytes), "%PDF-");
  assert.ok(bytes.length > 1000);
});

test("nao lanca com rows vazio, nulos ou textos fora do WinAnsi", async () => {
  for (const input of [
    { clinic: {}, rows: [] },
    { clinic: { name: null }, rows: null, financial: null, installments: null },
    { clinic: { name: "Clínica 😀" }, patientName: "日本語", rows: [{ name: null, quantity: NaN, unitPriceCents: null, discountCents: null, subtotalCents: null }] },
  ]) {
    assert.equal(header(await buildQuotePdf(input)), "%PDF-");
  }
});

test("muitos itens viram mais de uma pagina sem lancar", async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ name: `Procedimento ${i} `.repeat(6), quantity: 1, unitPriceCents: 1000, discountCents: 0, subtotalCents: 1000 }));
  assert.equal(header(await buildQuotePdf({ clinic: { name: "X" }, rows })), "%PDF-");
});
