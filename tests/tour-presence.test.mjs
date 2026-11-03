import assert from "node:assert/strict";
import { test } from "node:test";
import { hasPatientTour, isTourOverlayOpen, markPatientTour, releaseTourOverlay, reserveTourOverlay } from "../src/components/harmonize/tour-presence.ts";

test("reserva síncrona: duas aberturas concorrentes, só uma vence", () => {
  releaseTourOverlay();
  const results = [reserveTourOverlay(), reserveTourOverlay()];
  assert.deepEqual(results, [true, false]);
  assert.equal(isTourOverlayOpen(), true);
});

test("liberar devolve a vez ao próximo tour", () => {
  releaseTourOverlay();
  assert.equal(isTourOverlayOpen(), false);
  assert.equal(reserveTourOverlay(), true);
  releaseTourOverlay();
  assert.equal(reserveTourOverlay(), true);
  releaseTourOverlay();
});

test("flag da ficha com tour: conta e nunca fica negativa", () => {
  assert.equal(hasPatientTour(), false);
  markPatientTour(true);
  assert.equal(hasPatientTour(), true);
  markPatientTour(false);
  markPatientTour(false);
  assert.equal(hasPatientTour(), false);
});
