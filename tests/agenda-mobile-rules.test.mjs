import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMonthDay, monthCellDays, weekScrollLeft } from "../src/lib/agenda-mobile-rules.ts";

test("grade do mês começa na segunda e completa linhas de 7", () => {
  const cells = monthCellDays(2026, 9); // outubro/2026 começa numa quinta
  assert.equal(cells.length % 7, 0);
  assert.deepEqual(cells.slice(0, 4), [0, 0, 0, 1]);
  assert.equal(cells.filter(Boolean).length, 31);
  assert.equal(monthCellDays(2026, 1).filter(Boolean).length, 28);
});

test("dia aberto no mês: hoje, depois o primeiro com agendamento, depois o dia 1", () => {
  assert.equal(defaultMonthDay(2026, 9, "2026-10-28", []), 28);
  assert.equal(defaultMonthDay(2026, 10, "2026-10-28", ["2026-11-20", "2026-11-05"]), 5);
  assert.equal(defaultMonthDay(2026, 10, "2026-10-28", []), 1);
});

test("semana no celular rola para deixar hoje no meio e respeita as pontas", () => {
  const week = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
  assert.equal(weekScrollLeft(week, "2026-10-28", 100), 100);
  assert.equal(weekScrollLeft(week, "2026-10-26", 100), 0);
  assert.equal(weekScrollLeft(week, "2026-11-01", 100), 400);
  assert.equal(weekScrollLeft(week, "2026-12-01", 100), 0);
});
