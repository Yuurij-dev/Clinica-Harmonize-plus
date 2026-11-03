// Sinalizadores de módulo (como hasDraftGuard em use-draft-autosave.ts): ficam fora do React para que o
// topbar e os dois tours saibam, sem prop drilling, o que está na tela.

let overlayReserved = false;

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

