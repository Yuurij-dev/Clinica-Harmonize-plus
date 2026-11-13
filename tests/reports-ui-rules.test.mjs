import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compactMoney, customRangeError, formatDateBr, formatMoneyBr, formatNumberPtBr, formatPctBr, formatRangeLabel, limitationText, overviewMatchesFilters,
  periodPresetLabel, periodPresets, reportKey, reportQueryString, variationInfo,
} from "../src/lib/reports-ui-rules.ts";

const filters = { period: "last30", from: "", to: "", compare: false, professional: "", granularity: null };

test("presets de periodo tem os rotulos pedidos, na ordem, e o personalizado por ultimo", () => {
  assert.deepEqual(periodPresets.map((preset) => preset.label), ["Hoje", "Últimos 7 dias", "Últimos 30 dias", "Este mês", "Mês anterior", "Este ano", "Personalizado"]);
  assert.deepEqual(periodPresets.map((preset) => preset.value), ["today", "last7", "last30", "month", "prevMonth", "year", "custom"]);
  assert.equal(periodPresetLabel("prevMonth"), "Mês anterior");
  assert.equal(periodPresetLabel("xyz"), "Período");
});

test("rotulo do intervalo em dd/mm/aaaa; um dia so mostra uma data", () => {
  assert.equal(formatDateBr("2026-11-01"), "01/11/2026");
  assert.equal(formatRangeLabel({ start: "2026-11-01", end: "2026-11-30" }), "01/11/2026 – 30/11/2026");
  assert.equal(formatRangeLabel({ start: "2026-11-13", end: "2026-11-13" }), "13/11/2026");
});

test("periodo personalizado: valida datas como o servidor", () => {
  assert.equal(customRangeError("2026-11-01", "2026-11-30"), null);
  assert.match(customRangeError("", "2026-11-30"), /Informe/);
  assert.match(customRangeError("2026-02-30", "2026-03-01"), /inválidas/);
  assert.match(customRangeError("2026-12-01", "2026-11-01"), /anterior ou igual/);
  assert.match(customRangeError("2025-01-01", "2026-01-02"), /no máximo 366/);
  assert.equal(customRangeError("2026-01-01", "2026-12-31"), null);
});

test("chave de cache e estavel e leva todos os parametros que mudam a resposta", () => {
  assert.equal(reportQueryString(filters), "period=last30");
  assert.equal(reportKey("/api/reports/overview", filters), "/api/reports/overview?period=last30");
  assert.equal(
    reportKey("/api/reports/clients", { period: "custom", from: "2026-01-01", to: "2026-02-01", compare: true, professional: " Ana Souza ", granularity: "week" }),
    "/api/reports/clients?period=custom&from=2026-01-01&to=2026-02-01&compare=1&professional=Ana+Souza&granularity=week",
  );
  // from/to so entram no personalizado; compare so quando ligado.
  assert.equal(reportQueryString({ ...filters, from: "2026-01-01", to: "2026-01-31" }), "period=last30");
  assert.notEqual(reportKey("/api/reports/overview", filters), reportKey("/api/reports/overview", { ...filters, compare: true }));
  assert.notEqual(reportKey("/api/reports/overview", filters), reportKey("/api/reports/overview", { ...filters, granularity: "month" }));
});

test("formata numeros, moeda e eixo em pt-BR", () => {
  assert.equal(formatNumberPtBr(1234567.891, 2), "1.234.567,89");
  assert.equal(formatNumberPtBr(1234.5, 2, { group: false }), "1234,50");
  assert.equal(formatNumberPtBr(1.5, 3, { trim: true }), "1,5");
  assert.equal(formatNumberPtBr(2, 3, { trim: true }), "2");
  assert.equal(formatNumberPtBr(-0.001, 1), "0,0");
  assert.equal(formatNumberPtBr(-12.5, 1), "-12,5");
  assert.equal(formatMoneyBr(123456), "R$ 1.234,56");
  assert.equal(formatMoneyBr(-5000), "-R$ 50,00");
  assert.equal(formatMoneyBr(0), "R$ 0,00");
  assert.equal(compactMoney(950), "R$ 950");
  assert.equal(compactMoney(1000), "R$ 1k");
  assert.equal(compactMoney(1500), "R$ 1,5k");
  assert.equal(formatPctBr(45), "45%");
  assert.equal(formatPctBr(45.26), "45,3%");
});

test("variacao: null vira traco; direcao e texto em % e p.p.", () => {
  assert.deepEqual(variationInfo(null), { direction: "none", text: "—" });
  assert.deepEqual(variationInfo(undefined, "pp"), { direction: "none", text: "—" });
  assert.deepEqual(variationInfo(Number.NaN), { direction: "none", text: "—" });
  assert.deepEqual(variationInfo(18), { direction: "up", text: "18%" });
  assert.deepEqual(variationInfo(-12.34), { direction: "down", text: "12,3%" });
  assert.deepEqual(variationInfo(0), { direction: "flat", text: "0%" });
  assert.deepEqual(variationInfo(0.04), { direction: "flat", text: "0%" });
  assert.deepEqual(variationInfo(2.5, "pp"), { direction: "up", text: "2,5 p.p." });
  assert.deepEqual(variationInfo(-1, "pp"), { direction: "down", text: "1 p.p." });
  assert.deepEqual(variationInfo(1250), { direction: "up", text: "1.250%" });
});

test("a visao geral so e considerada atual quando bate com os filtros", () => {
  const data = { range: { period: "last30", start: "2026-10-15", end: "2026-11-13" }, previousRange: null, appliedProfessional: null, series: { granularity: "week" }, professionals: ["Ana", "Bia"] };
  assert.equal(overviewMatchesFilters(data, filters), true);
  assert.equal(overviewMatchesFilters(data, { ...filters, period: "year" }), false);
  assert.equal(overviewMatchesFilters(data, { ...filters, compare: true }), false);
  assert.equal(overviewMatchesFilters(data, { ...filters, granularity: "day" }), false);
  assert.equal(overviewMatchesFilters(data, { ...filters, professional: "Ana" }), false);
  assert.equal(overviewMatchesFilters({ ...data, appliedProfessional: "Ana" }, { ...filters, professional: "Ana" }), true);
  assert.equal(overviewMatchesFilters({ ...data, range: { period: "custom", start: "2026-01-01", end: "2026-01-31" } }, { ...filters, period: "custom", from: "2026-01-01", to: "2026-01-31" }), true);
  assert.equal(overviewMatchesFilters({ ...data, range: { period: "custom", start: "2026-01-01", end: "2026-01-31" } }, { ...filters, period: "custom", from: "2026-01-01", to: "2026-02-01" }), false);
  // PROFESSIONAL (lista vazia): o servidor forca o filtro, entao o campo local nao conta.
  assert.equal(overviewMatchesFilters({ ...data, professionals: [], appliedProfessional: "Eu" }, filters), true);
});

test("limitacoes declaradas viram texto legivel", () => {
  assert.match(limitationText("payment_without_professional"), /profissional/);
  assert.match(limitationText("category_not_registered"), /categoria/);
  assert.equal(limitationText(null), null);
  assert.equal(limitationText("outro"), "outro");
});
