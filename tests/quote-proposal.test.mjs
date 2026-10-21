import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuoteProposalHtml, proposalRowsFromQuote, quoteFinancialSnapshot } from "../src/lib/quote-proposal.ts";

const baseProposal = {
  statusLabel: "Rascunho",
  dateLabel: "20/10/2026",
  rows: [{ name: "Botox", quantity: 1, unitPriceCents: 30_000, discountCents: 0, subtotalCents: 30_000 }],
  paymentMethod: "Cartão de crédito",
  installments: 1,
  totalCents: 30_000,
};

test("proposal HTML is A4 print-ready, suppresses browser headers with minimal margins and keeps acceptance last", () => {
  const html = buildQuoteProposalHtml(baseProposal);

  assert.match(html, /@page\{size:A4 portrait;margin:2mm 14mm 4mm/);
  assert.match(html, /counter\(page\).*counter\(pages\)/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /break-inside:avoid/);
  assert.match(html, /break-after:avoid-page/);
  assert.ok(html.indexOf("Condições da proposta") < html.indexOf("Aceite da proposta"));
  assert.match(html, /Assinatura do cliente/);
  assert.match(html, /Proposta de tratamento/);
  assert.match(html, /<body class="compact">/);
});

test("legacy financial snapshots expose missing breakdown instead of inventing amounts", () => {
  const html = buildQuoteProposalHtml({
    ...baseProposal,
    financial: { totalCents: 111_000, compositionNote: "O detalhamento financeiro original deste orçamento não está disponível." },
  });

  assert.ok(html.includes("R$ 1.110,00"));
  assert.ok(html.includes("O detalhamento financeiro original deste orçamento não está disponível."));
  assert.ok(!html.includes("Custos de mão de obra"));
});

test("saved clinic costs reconcile the proposal total and payment conditions are shown once", () => {
  const html = buildQuoteProposalHtml({
    ...baseProposal,
    totalCents: 111_000,
    financial: {
      subtotalCents: 30_000,
      discountCents: 0,
      additions: [{ label: "Custos adicionais da clínica", amountCents: 81_000 }],
      totalCents: 111_000,
    },
    conditions: { paymentStatus: "Concluído" },
  });

  assert.ok(html.includes("R$ 300,00"));
  assert.ok(html.includes("R$ 810,00"));
  assert.ok(html.includes("R$ 1.110,00"));
  assert.ok(!html.includes("Ajuste sem detalhamento salvo"));
  assert.equal(html.match(/Forma de pagamento/g)?.length, 1);
  assert.equal(html.match(/Pagamento<\/span>/g)?.length, 1);
});

test("financial snapshot falls back to the saved total cost without inventing its categories", () => {
  const details = JSON.stringify({
    items: [{ procedureId: "botox", name: "Botox", quantity: 1, unitPriceCents: 30_000, discountCents: 0, subtotalCents: 30_000 }],
    subtotalCents: 30_000,
    discountCents: 0,
    costTotalCents: 81_000,
    totalCents: 111_000,
  });
  const financial = quoteFinancialSnapshot(details, 1);

  assert.equal(financial.totalCents, 111_000);
  assert.deepEqual(financial.additions, [{ label: "Custos adicionais da clínica", amountCents: 81_000 }]);
  assert.equal(financial.compositionNote, null);
  assert.match(quoteFinancialSnapshot("[]", 111_000).compositionNote ?? "", /detalhamento financeiro original/);
});

test("optional clinic, patient, professional, procedure details and financial breakdown are rendered", () => {
  const html = buildQuoteProposalHtml({
    ...baseProposal,
    clinic: { name: "Clínica da Vila", address: "Rua Central, 10", phone: "(11) 3333-4444", primaryColor: "#123456" },
    proposalNumber: "PROP-42",
    validUntil: "30/10/2026",
    patient: { name: "Ana Cliente", identifier: "P-17", cpf: "123.456.789-00" },
    professional: { name: "Dra. Maria", registration: "CRM 123", specialty: "Dermatologia" },
    rows: [{ ...baseProposal.rows[0], description: "Suavização de linhas de expressão" }],
    financial: { subtotalCents: 30_000, discountCents: 2_000, additions: [{ label: "Taxa clínica", amountCents: 500 }], totalCents: 28_500 },
    conditions: { appointment: "Sujeito à disponibilidade", special: "Condição comercial vigente" },
  });

  for (const expected of ["Clínica da Vila", "PROP-42", "Ana Cliente", "Dra. Maria", "CRM 123", "Suavização de linhas de expressão", "Subtotal dos procedimentos", "Descontos", "Taxa clínica", "R$ 285,00", "Agendamento", "Condição comercial vigente"]) {
    assert.ok(html.includes(expected), `missing ${expected}`);
  }
  assert.match(html, /--brand:#123456/);
  assert.ok(html.includes("/images/procedimentos/botox.webp"));
  assert.ok(html.includes('alt="Imagem ilustrativa de botox"'));
});

test("installment amounts add up exactly to the proposal total", () => {
  const html = buildQuoteProposalHtml({ ...baseProposal, installments: 3, totalCents: 289_000 });
  assert.ok(html.includes("3x (2x de R$ 963,33 e 1x de R$ 963,34)"));
});

test("intermediate and long proposals distribute content across pages rather than isolating the signature", () => {
  const intermediate = buildQuoteProposalHtml({
    ...baseProposal,
    goal: "Objetivo clínico informado na avaliação",
    rows: Array.from({ length: 3 }, (_, index) => ({ ...baseProposal.rows[0], name: `Procedimento ${index + 1}` })),
  });
  const extended = buildQuoteProposalHtml({
    ...baseProposal,
    rows: Array.from({ length: 10 }, (_, index) => ({ ...baseProposal.rows[0], name: `Procedimento ${index + 1}`, description: "Descrição resumida do procedimento." })),
  });

  assert.match(intermediate, /<body class="">/);
  assert.match(intermediate, /class="section conditions-section"/);
  assert.match(extended, /<body class="dense-presentation">/);
  assert.match(extended, /grid-template-columns:1fr 1fr/);
  assert.match(extended, /presentation-grid-following/);
  assert.doesNotMatch(intermediate + extended, /class="page-break-after"|balance-conditions|balance-procedures/);
});

test("proposal values are escaped and unsafe image URLs are omitted", () => {
  const html = buildQuoteProposalHtml({
    ...baseProposal,
    clinic: { name: `Clínica <script>alert("x")</script>` },
    patient: { name: `Ana </script><img src=x onerror=alert(1)>` },
    rows: [{ ...baseProposal.rows[0], name: `<svg onload="alert(1)">Botox</svg>`, imageUrl: "javascript:alert(1)" }],
    notes: `<iframe src="https://example.com"></iframe>`,
  });

  assert.ok(html.includes("Clínica &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("Ana &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("&lt;svg onload=&quot;alert(1)&quot;&gt;Botox&lt;/svg&gt;"));
  assert.ok(html.includes("&lt;iframe src=&quot;https://example.com&quot;&gt;&lt;/iframe&gt;"));
  assert.ok(!html.includes('src="javascript:alert(1)"'));
  assert.ok(!html.includes(`<script>alert("x")`));
});

test("legacy and detailed quote rows remain readable", () => {
  assert.deepEqual(proposalRowsFromQuote({ items: "Botox (2x), Preenchimento" }), [
    { name: "Botox", quantity: 2, unitPriceCents: null, discountCents: null, subtotalCents: null },
    { name: "Preenchimento", quantity: 1, unitPriceCents: null, discountCents: null, subtotalCents: null },
  ]);
  assert.deepEqual(proposalRowsFromQuote({
    items: "ignorado",
    details: JSON.stringify({ items: [{ procedureId: "botox", name: "Botox", quantity: 3, unitPriceCents: 100, discountCents: 0, subtotalCents: 300 }] }),
  }), [{ name: "Botox", quantity: 3, unitPriceCents: 100, discountCents: 0, subtotalCents: 300 }]);
});
