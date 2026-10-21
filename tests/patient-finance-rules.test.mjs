import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterPayments, filterQuotes, financeIndicators, matchPaymentQuotes, paginateList, paymentGroupCounts, paymentStatusGroup, quoteGroupCounts, quotePaymentBlockReason, quoteStatusGroup, quoteStatusLabel, receivedCents,
} from "../src/lib/patient-finance-rules.ts";
import { buildQuoteProposalHtml, proposalRowsFromQuote } from "../src/lib/quote-proposal.ts";

const quotes = [
  { id: "q1", journeyId: "j1", items: "Botox (2x)", status: "Rascunho", total: 1000, createdAt: "2026-10-01T12:00:00Z" },
  { id: "q2", journeyId: "j1", items: "Preenchimento labial (1x)", status: "Pendente", total: 1500.5, createdAt: "2026-10-02T12:00:00Z" },
  { id: "q3", journeyId: "j2", items: "Bioestimulador (1x)", status: "Enviado", total: 2000, createdAt: "2026-10-03T12:00:00Z" },
  { id: "q4", journeyId: "j2", items: "Botox (1x)", status: "Aprovado", total: 800, createdAt: "2026-10-04T12:00:00Z" },
  { id: "q5", journeyId: "j1", items: "Peeling (1x)", status: "Pago", total: 500, createdAt: "2026-10-05T12:00:00Z" },
  { id: "q6", journeyId: "j1", items: "Fios (1x)", status: "Recusado", total: 3000, createdAt: "2026-10-06T12:00:00Z" },
  { id: "q7", journeyId: null, items: "Laser (1x)", status: "Cancelado", total: 700, createdAt: "2026-10-07T12:00:00Z" },
  { id: "q8", journeyId: "j1", items: "Outro (1x)", status: "Arquivado", total: 10, createdAt: "2026-10-08T12:00:00Z" },
];

test("quote status groups follow the existing statuses and ignore unknown ones", () => {
  assert.equal(quoteStatusGroup("Rascunho"), "open");
  assert.equal(quoteStatusGroup("Pendente"), "open");
  assert.equal(quoteStatusGroup("Enviado"), "open");
  assert.equal(quoteStatusGroup("Aprovado"), "approved");
  assert.equal(quoteStatusGroup("Pago"), "paid");
  assert.equal(quoteStatusGroup("Recusado"), "closed");
  assert.equal(quoteStatusGroup("Cancelado"), "closed");
  assert.equal(quoteStatusGroup("Arquivado"), null);
  assert.equal(quoteStatusLabel("Pendente"), "Pendente");
});

test("indicators: budgeted = approved + paid, to receive = approved, open = draft/pending/sent", () => {
  assert.deepEqual(financeIndicators(quotes), { budgetedCents: 130_000, receivedCents: 50_000, toReceiveCents: 80_000, openCount: 3 });
  assert.deepEqual(financeIndicators([]), { budgetedCents: 0, receivedCents: 0, toReceiveCents: 0, openCount: 0 });
});

test("quote filters combine group, search (accent-insensitive), treatment and date order", () => {
  assert.deepEqual(filterQuotes(quotes, { group: "open" }).map((quote) => quote.id), ["q3", "q2", "q1"]);
  assert.deepEqual(filterQuotes(quotes, { group: "open", sort: "oldest" }).map((quote) => quote.id), ["q1", "q2", "q3"]);
  assert.deepEqual(filterQuotes(quotes, { query: "BOTOX" }).map((quote) => quote.id), ["q4", "q1"]);
  assert.deepEqual(filterQuotes(quotes, { query: "preenchímento" }).map((quote) => quote.id), ["q2"]);
  assert.deepEqual(filterQuotes(quotes, { journeyId: "j2" }).map((quote) => quote.id), ["q4", "q3"]);
  assert.deepEqual(filterQuotes(quotes, { group: "closed" }).map((quote) => quote.id), ["q7", "q6"]);
  assert.equal(filterQuotes(quotes, {}).length, quotes.length);
});

test("chip counts respect search and treatment but not the chip itself", () => {
  assert.deepEqual(quoteGroupCounts(quotes), { all: 8, open: 3, approved: 1, paid: 1, closed: 2 });
  assert.deepEqual(quoteGroupCounts(quotes, { journeyId: "j2" }), { all: 2, open: 1, approved: 1, paid: 0, closed: 0 });
  assert.deepEqual(quoteGroupCounts(quotes, { query: "botox" }), { all: 2, open: 1, approved: 1, paid: 0, closed: 0 });
});

test("register-payment rule matches the journey: only paid, refused or cancelled block it", () => {
  assert.equal(quotePaymentBlockReason("Aprovado"), null);
  assert.equal(quotePaymentBlockReason("Enviado"), null);
  assert.equal(quotePaymentBlockReason("Rascunho"), null);
  assert.equal(quotePaymentBlockReason("Pago"), "Pagamento já registrado.");
  assert.equal(quotePaymentBlockReason("Recusado"), "Orçamento recusado.");
  assert.equal(quotePaymentBlockReason("Cancelado"), "Orçamento cancelado.");
});

const payments = [
  { id: "p1", journeyId: "j1", value: 500, status: "Pago", date: "2026-10-05T15:00:00Z" },
  { id: "p2", journeyId: "j1", value: 500, status: "Pago", date: "2026-10-06T15:00:00Z" },
  { id: "p3", journeyId: "j2", value: 99.9, status: "Pendente", date: "2026-10-07T15:00:00Z" },
  { id: "p4", journeyId: "j2", value: 20, status: "Bloqueado", date: "2026-10-08T15:00:00Z" },
];

test("payment groups, counts, totals and filters", () => {
  assert.equal(paymentStatusGroup("Pago"), "paid");
  assert.equal(paymentStatusGroup("Pendente"), "pending");
  assert.equal(paymentStatusGroup("Bloqueado"), "other");
  assert.deepEqual(paymentGroupCounts(payments), { all: 4, paid: 2, pending: 1, other: 1 });
  assert.deepEqual(paymentGroupCounts(payments, { journeyId: "j2" }), { all: 2, paid: 0, pending: 1, other: 1 });
  assert.equal(receivedCents(payments), 100_000);
  assert.deepEqual(filterPayments(payments, { group: "paid" }).map((payment) => payment.id), ["p2", "p1"]);
  assert.deepEqual(filterPayments(payments, { journeyId: "j2", sort: "oldest" }).map((payment) => payment.id), ["p3", "p4"]);
  assert.deepEqual(filterPayments(payments, { query: "peeling", titles: new Map([["p1", "Peeling (1X)"]]) }).map((payment) => payment.id), ["p1"]);
});

test("a paid payment matches one paid quote of the same journey and value, each quote only once", () => {
  const matches = matchPaymentQuotes(payments, quotes);
  assert.equal(matches.get("p1")?.id, "q5");
  assert.equal(matches.has("p2"), false);
  assert.equal(matches.has("p3"), false);
});

test("pagination clamps the page and keeps page sizes", () => {
  const items = Array.from({ length: 20 }, (_, index) => index);
  assert.deepEqual(paginateList(items, 1, 9), { items: items.slice(0, 9), page: 1, pages: 3 });
  assert.deepEqual(paginateList(items, 3, 9), { items: [18, 19], page: 3, pages: 3 });
  assert.equal(paginateList(items, 9, 9).page, 3);
  assert.deepEqual(paginateList([], 4, 9), { items: [], page: 1, pages: 1 });
});

test("proposal HTML escapes user text and shows installments only on credit card", () => {
  const html = buildQuoteProposalHtml({ goal: "<b>x</b>", statusLabel: "Aprovado", dateLabel: "20/10/2026", rows: [{ name: "Botox <script>", quantity: 2, unitPriceCents: 100_000, discountCents: 0, subtotalCents: 200_000 }], paymentMethod: "Cartão de crédito", installments: 3, notes: "a & b", totalCents: 200_000 });
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(html.includes("Botox &lt;script&gt;"));
  assert.ok(html.includes("Cartão de crédito · 3x (1x de R$ 666,66 e 2x de R$ 666,67)"));
  assert.ok(html.includes("a &amp; b"));
  assert.ok(!html.includes("Botox <script>"));
  const pix = buildQuoteProposalHtml({ statusLabel: "Pago", dateLabel: "x", rows: [], paymentMethod: "Pix", installments: 1, totalCents: 0 });
  assert.ok(pix.includes("Pix") && !pix.includes("Objetivo não informado") && !pix.includes("Observações"));
});

test("proposal rows come from stored details or fall back to the legacy items text", () => {
  const details = JSON.stringify({ items: [{ procedureId: "a", name: "Botox", quantity: 2, unitPriceCents: 100, discountCents: 10, subtotalCents: 190 }], subtotalCents: 200, discountCents: 10, totalCents: 190 });
  assert.deepEqual(proposalRowsFromQuote({ items: "x", details }), [{ name: "Botox", quantity: 2, unitPriceCents: 100, discountCents: 10, subtotalCents: 190 }]);
  assert.deepEqual(proposalRowsFromQuote({ items: "Botox (2x), Peeling (1x)", details: "[]" }), [
    { name: "Botox", quantity: 2, unitPriceCents: null, discountCents: null, subtotalCents: null },
    { name: "Peeling", quantity: 1, unitPriceCents: null, discountCents: null, subtotalCents: null },
  ]);
  assert.ok(buildQuoteProposalHtml({ statusLabel: "Pago", dateLabel: "x", rows: proposalRowsFromQuote({ items: "Botox (2x)" }), paymentMethod: "Pix", installments: 1, totalCents: 0 }).includes('<td class="numeric">—</td>'));
});
