import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateQuote } from "../src/lib/quote-rules.ts";
import { quoteLaborCostCents } from "../src/lib/quote-cost-rules.ts";

test("orçamento profissional usa a mão de obra cadastrada para o profissional", () => {
  assert.equal(quoteLaborCostCents({ role: "PROFESSIONAL", clinicLaborCostCents: 12_000, professionalLaborCostCents: 35_000 }), 35_000);
});

test("orçamento profissional respeita o valor zero e usa o padrão da clínica quando não há valor cadastrado", () => {
  assert.equal(quoteLaborCostCents({ role: "PROFESSIONAL", clinicLaborCostCents: 12_000, professionalLaborCostCents: 0 }), 0);
  assert.equal(quoteLaborCostCents({ role: "PROFESSIONAL", clinicLaborCostCents: 12_000, professionalLaborCostCents: null }), 12_000);
});

test("administrador não usa valor de mão de obra atribuído a um profissional", () => {
  assert.equal(quoteLaborCostCents({ role: "ADMIN", clinicLaborCostCents: 12_000, professionalLaborCostCents: 35_000 }), 12_000);
});

test("mão de obra profissional entra no total calculado do orçamento", () => {
  const laborCents = quoteLaborCostCents({ role: "PROFESSIONAL", clinicLaborCostCents: 12_000, professionalLaborCostCents: 35_000 });
  const quote = calculateQuote(
    [{ procedureId: "procedure-1", quantity: 2, discountCents: 500 }],
    [{ id: "procedure-1", name: "Procedimento", priceCents: 10_000 }],
    { laborCents, facilityCents: 1_000, medicationCents: 2_000 },
  );

  assert.equal(quote?.totalCents, 57_500);
  assert.equal(quote?.costTotalCents, 38_000);
});
