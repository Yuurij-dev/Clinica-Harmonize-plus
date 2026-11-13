import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInsights } from "../src/lib/reports-insights.ts";

const base = {
  revenue: { current: 15_000, previous: 10_000 },
  procedures: [{ name: "Peeling", executions: 3 }, { name: "Botox", executions: 7 }],
  professionals: [{ name: "Ana", done: 4 }, { name: "Bia", done: 6 }],
  weekdayCounts: [0, 1, 5, 2, 0, 0, 0],
  returnRate: { current: 60, previous: 45 },
  quoteConversion: { current: 30, previous: 40 },
};
const byId = (list) => Object.fromEntries(list.map((i) => [i.id, i]));

test("insights describe revenue, top procedure/professional, weekday, return rate and conversion", () => {
  const i = byId(buildInsights(base));
  assert.match(i.revenue.message, /subiu 50,0%/);
  assert.equal(i.revenue.tone, "positive");
  assert.match(i.topProcedure.message, /Botox.*7 execuções/);
  assert.match(i.topProfessional.message, /Bia/);
  assert.match(i.busiestWeekday.message, /Terça-feira/);
  assert.match(i.returnRate.message, /subiu 15,0 p\.p\./);
  assert.match(i.quoteConversion.message, /piorou 10,0 p\.p\./);
  assert.equal(i.quoteConversion.tone, "negative");
  assert.ok(Object.values(i).every((x) => x.available));
});

test("revenue falling, and omitted sections", () => {
  const i = byId(buildInsights({ ...base, revenue: { current: 5_000, previous: 10_000 }, professionals: null, quoteConversion: null }));
  assert.match(i.revenue.message, /caiu 50,0%/);
  assert.equal(i.topProfessional, undefined);
  assert.equal(i.quoteConversion, undefined);
  assert.equal(byId(buildInsights({ ...base, revenue: null })).revenue, undefined);
});

test("insufficient data returns available:false with an explanation", () => {
  const i = byId(buildInsights({ revenue: { current: 100, previous: 0 }, procedures: [], professionals: [], weekdayCounts: [0, 0, 0, 0, 0, 0, 0], returnRate: { current: null, previous: 10 }, quoteConversion: { current: 10, previous: null } }));
  for (const id of ["revenue", "topProcedure", "topProfessional", "busiestWeekday", "returnRate", "quoteConversion"]) {
    assert.equal(i[id].available, false, id);
    assert.ok(i[id].message.length > 10);
  }
});

test("weekday tie is not presented as a winner", () => {
  const i = byId(buildInsights({ ...base, weekdayCounts: [0, 3, 3, 0, 0, 0, 0] }));
  assert.equal(i.busiestWeekday.available, false);
});
