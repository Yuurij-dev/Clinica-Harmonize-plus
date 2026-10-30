import assert from "node:assert/strict";
import { test } from "node:test";
import { autosaveWaitMs } from "../src/lib/autosave-schedule-rules.ts";

test("sem maxWait é o debounce de sempre, igual ao hook antigo (as outras telas não mudam)", () => {
  assert.equal(autosaveWaitMs({ now: 5000, firstDirtyAt: null, delay: 900 }), 900);
  assert.equal(autosaveWaitMs({ now: 5000, firstDirtyAt: 0, delay: 900 }), 900);
  assert.equal(autosaveWaitMs({ now: 10 ** 9, firstDirtyAt: 0, delay: 900 }), 900);
});

test("com maxWait a espera encurta até o teto contado da primeira alteração não salva", () => {
  const delay = 120_000, maxWait = 120_000;
  assert.equal(autosaveWaitMs({ now: 1000, firstDirtyAt: 1000, delay, maxWait }), 120_000);
  assert.equal(autosaveWaitMs({ now: 61_000, firstDirtyAt: 1000, delay, maxWait }), 60_000);
  assert.equal(autosaveWaitMs({ now: 120_999, firstDirtyAt: 1000, delay, maxWait }), 1);
  assert.equal(autosaveWaitMs({ now: 500_000, firstDirtyAt: 1000, delay, maxWait }), 0);
});

test("pausa menor que o teto vence: o debounce dispara primeiro", () => {
  assert.equal(autosaveWaitMs({ now: 10_000, firstDirtyAt: 0, delay: 3000, maxWait: 120_000 }), 3000);
  assert.equal(autosaveWaitMs({ now: 118_000, firstDirtyAt: 0, delay: 3000, maxWait: 120_000 }), 2000);
});

test("edição contínua: simulando teclas a cada 500 ms, dispara dentro de 2 min da primeira (debounce puro nunca dispararia)", () => {
  const delay = 120_000, maxWait = 120_000;
  const firstDirtyAt = 0;
  let firedAt = null;
  let timerAt = Infinity; // instante agendado do disparo
  for (let now = 0; now <= 130_000 && firedAt === null; now += 500) {
    timerAt = now + autosaveWaitMs({ now, firstDirtyAt, delay, maxWait }); // cada edição reagenda
    if (timerAt <= now + 500) firedAt = timerAt;
  }
  assert.ok(firedAt !== null && firedAt <= 120_000, "disparou em " + firedAt);
  // Sem teto (debounce puro de 120 s) com edição a cada 500 ms o disparo nunca chega antes da próxima tecla.
  let pure = null;
  for (let now = 0; now <= 130_000; now += 500) if (autosaveWaitMs({ now, firstDirtyAt, delay }) <= 500) pure = now;
  assert.equal(pure, null);
});

test("gravação em voo + nova edição: o teto zerado no início do save dá uma espera cheia; um teto velho dispararia na hora", () => {
  const delay = 120_000, maxWait = 120_000;
  // save começou em t=120 s (teto zerado); edição em t=124 s abre teto novo
  assert.equal(autosaveWaitMs({ now: 124_000, firstDirtyAt: 124_000, delay, maxWait }), 120_000);
  assert.equal(autosaveWaitMs({ now: 200_000, firstDirtyAt: 124_000, delay, maxWait }), 44_000);
  // o defeito corrigido: timestamp anterior ao save ainda guardado -> espera 0 (save adiantado)
  assert.equal(autosaveWaitMs({ now: 124_000, firstDirtyAt: 1_000, delay, maxWait }), 0);
});
