// Sinalizadores de módulo (como hasDraftGuard em use-draft-autosave.ts): ficam fora do React para que o
// topbar e os dois tours saibam, sem prop drilling, o que está na tela.

let overlayReserved = false;
let patientTours = 0;

/** Há um tour aberto (ou reservado): outro tour não abre sozinho por cima. */
export function isTourOverlayOpen(): boolean {
  return overlayReserved;
}

/**
 * Reserva a vez de abrir um tour, de forma síncrona (antes de qualquer setState): dois timers que disparem no mesmo
 * instante não passam juntos. Quem reservou chama `releaseTourOverlay` ao fechar ou desmontar.
 */
export function reserveTourOverlay(): boolean {
  if (overlayReserved) return false;
  overlayReserved = true;
  return true;
}

export function releaseTourOverlay() {
  overlayReserved = false;
}

/** Há uma ficha de paciente aberta com tour disponível: o "?" da topbar oferece "Tour desta página". */
export function hasPatientTour(): boolean {
  return patientTours > 0;
}

export function markPatientTour(available: boolean) {
  patientTours = Math.max(0, patientTours + (available ? 1 : -1));
}
