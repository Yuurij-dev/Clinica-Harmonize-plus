import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays, agendaDayInvalidationKey, capitalizeFirst, formatDayBR, agendaNeighborRanges, agendaPeriodKey, agendaPeriodRange, dayInRange, isDayKey,
  parseAgendaRange, shiftAgendaDay, startOfWeek,
} from "../src/lib/agenda-period-rules.ts";

test("visible period for day, week (Monday to Sunday) and month", () => {
  assert.deepEqual(agendaPeriodRange("2026-10-22", "Dia"), { from: "2026-10-22", to: "2026-10-22" });
  // 2026-10-22 é quinta-feira.
  assert.deepEqual(agendaPeriodRange("2026-10-22", "Semana"), { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(agendaPeriodRange("2026-10-25", "Semana"), { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(agendaPeriodRange("2026-10-26", "Semana"), { from: "2026-10-26", to: "2026-11-01" });
  assert.deepEqual(agendaPeriodRange("2026-10-22", "Mês"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(agendaPeriodRange("2028-02-10", "Mês"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(agendaPeriodRange("2026-02-10", "Mês"), { from: "2026-02-01", to: "2026-02-28" });
});

test("weeks and months cross month and year boundaries", () => {
  assert.deepEqual(agendaPeriodRange("2026-12-31", "Semana"), { from: "2026-12-28", to: "2027-01-03" });
  assert.deepEqual(agendaPeriodRange("2027-01-01", "Mês"), { from: "2027-01-01", to: "2027-01-31" });
  assert.equal(startOfWeek("2026-03-01"), "2026-02-23");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("previous/next moves by day, week and calendar month (clamping the day)", () => {
  assert.equal(shiftAgendaDay("2026-10-31", "Dia", 1), "2026-11-01");
  assert.equal(shiftAgendaDay("2026-01-01", "Dia", -1), "2025-12-31");
  assert.equal(shiftAgendaDay("2026-10-22", "Semana", 1), "2026-10-29");
  assert.equal(shiftAgendaDay("2026-01-03", "Semana", -1), "2025-12-27");
  assert.equal(shiftAgendaDay("2026-01-31", "Mês", 1), "2026-02-28");
  assert.equal(shiftAgendaDay("2026-03-31", "Mês", -1), "2026-02-28");
  assert.equal(shiftAgendaDay("2026-12-15", "Mês", 1), "2027-01-15");
  assert.equal(shiftAgendaDay("2026-01-15", "Mês", -1), "2025-12-15");
  // Passar mês a mês nunca pula um mês (o antigo "+30 dias" pulava fevereiro a partir de 31/01).
  let day = "2026-01-31";
  const months = [];
  for (let i = 0; i < 12; i += 1) { day = shiftAgendaDay(day, "Mês", 1); months.push(day.slice(0, 7)); }
  assert.equal(new Set(months).size, 12);
});

test("neighbor ranges are the adjacent periods and have stable cache keys", () => {
  const [previous, next] = agendaNeighborRanges("2026-10-22", "Mês");
  assert.deepEqual(previous, { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(next, { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(agendaPeriodKey(next), "/api/agenda?from=2026-11-01&to=2026-11-30");
  assert.equal(agendaPeriodKey(agendaPeriodRange("2026-10-19", "Semana")), agendaPeriodKey(agendaPeriodRange("2026-10-25", "Semana")));
  assert.equal(agendaDayInvalidationKey("2026-10-22T15:00:00.000Z"), "/api/agenda?day=2026-10-22");
  assert.equal(dayInRange("2026-10-31", { from: "2026-10-01", to: "2026-10-31" }), true);
  assert.equal(dayInRange("2026-11-01", { from: "2026-10-01", to: "2026-10-31" }), false);
});

test("server range validation accepts inclusive days and rejects bad input", () => {
  const ok = parseAgendaRange("2026-10-31", "2026-11-01");
  assert.equal(ok.ok, true);
  assert.equal(ok.start.toISOString(), "2026-10-31T00:00:00.000Z");
  assert.equal(ok.endExclusive.toISOString(), "2026-11-02T00:00:00.000Z");
  // Agendamentos guardados ao meio-dia de São Paulo (15:00Z) ficam dentro do dia limite.
  assert.ok(new Date("2026-11-01T12:00:00-03:00") >= ok.start && new Date("2026-11-01T12:00:00-03:00") < ok.endExclusive);
  assert.ok(new Date("2026-11-02T12:00:00-03:00") >= ok.endExclusive);
  assert.equal(parseAgendaRange("2026-10-31", "2026-10-31").ok, true);
  for (const [from, to] of [[null, "2026-10-01"], ["2026-10-01", null], ["2026-13-01", "2026-13-02"], ["2026-02-30", "2026-03-01"], ["20261001", "20261002"], ["2026-10-02", "2026-10-01"], ["2026-01-01", "2026-12-31"]]) {
    assert.equal(parseAgendaRange(from, to).ok, false, `${from} ${to}`);
  }
  assert.equal(parseAgendaRange("2026-01-01", "2026-04-03").ok, true);
  assert.equal(parseAgendaRange("2026-01-01", "2026-04-04").ok, false);
  for (const [from, to] of [["9999-12-30", "9999-12-31"], ["1969-12-31", "1970-01-02"], ["2100-12-30", "2101-01-02"], ["0001-01-01", "0001-01-02"]]) assert.equal(parseAgendaRange(from, to).ok, false, from);
  assert.equal(parseAgendaRange("1970-01-01", "1970-01-31").ok, true);
  assert.equal(parseAgendaRange("2100-12-01", "2100-12-31").ok, true);
  assert.equal(isDayKey("2026-02-29"), false);
  assert.equal(isDayKey("2028-02-29"), true);
});

test("appointment day shows as DD/MM/YYYY from a day key or an ISO noon-in-Sao-Paulo date", () => {
  assert.equal(formatDayBR("2026-10-22"), "22/10/2026");
  assert.equal(formatDayBR("2026-10-22T15:00:00.000Z"), "22/10/2026");
  assert.equal(formatDayBR("2031-01-01T00:00:00.000Z"), "01/01/2031");
  assert.equal(formatDayBR("22/10/2026"), "");
  assert.equal(formatDayBR(""), "");
});

test("period title capitalizes only the first letter", () => {
  assert.equal(capitalizeFirst("outubro de 2026"), "Outubro de 2026");
  assert.equal(capitalizeFirst("22 de outubro de 2026"), "22 de outubro de 2026");
  assert.equal(capitalizeFirst(""), "");
});
