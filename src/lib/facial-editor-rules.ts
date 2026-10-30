// Regras puras da tela da avaliação facial: zoom, ajuste à área, texto do salvamento, atalhos de teclado e descrição das marcações.
// Sem DOM nem React: carregável direto pelo node:test.

export const minZoom = 0.5;
export const maxZoom = 4;
export const zoomStepSize = 0.25;

/** Próximo nível de zoom (um passo para mais ou para menos), dentro dos limites e sem resíduo de ponto flutuante. */
export function stepZoom(zoom: number, direction: 1 | -1) {
  const next = Math.round((zoom + direction * zoomStepSize) * 100) / 100;
  return Math.min(maxZoom, Math.max(minZoom, next));
}

/** Escala que faz a foto inteira caber na área (com margem), sem ampliar além de `maxScale`. Sem medida da área ainda, mostra a foto sem reduzir. */
export function fitToArea({ areaWidth, areaHeight, photoWidth, photoHeight, margin = 24, maxScale = 2 }: { areaWidth: number; areaHeight: number; photoWidth: number; photoHeight: number; margin?: number; maxScale?: number }) {
  if (!(photoWidth > 0) || !(photoHeight > 0)) return 1;
  if (!(areaWidth > 0) || !(areaHeight > 0)) return 1;
  const scale = Math.min((areaWidth - margin * 2) / photoWidth, (areaHeight - margin * 2) / photoHeight, maxScale);
  return Math.max(0.05, scale);
}

/** "há 2 minutos" a partir do instante do último salvamento confirmado. */
export function formatSavedAgo(savedAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - savedAt) / 1000));
  if (seconds < 10) return "agora mesmo";
  if (seconds < 60) return "há menos de 1 minuto";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "há 1 minuto" : `há ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "há 1 hora" : `há ${hours} horas`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

export type SaveIndicator = { tone: "ok" | "busy" | "error" | "idle"; header: string; footer: string; canRetry: boolean };

/** Estado do salvamento para o cabeçalho e o rodapé. "Salvo" só aparece com a gravação confirmada (ou sem nada pendente num registro que já existe). */
export function saveIndicator({ readOnly, autosave, saving, lastSavedAt, hasRecord, now }: { readOnly: boolean; autosave: "saved" | "pending" | "saving" | "error"; saving: boolean; lastSavedAt: number | null; hasRecord: boolean; now: number }): SaveIndicator {
  if (readOnly) return { tone: "idle", header: "Somente leitura", footer: "Somente leitura", canRetry: false };
  if (autosave === "error") return { tone: "error", header: "Falha ao salvar", footer: "Não foi possível salvar", canRetry: true };
  if (autosave === "saving" || saving) return { tone: "busy", header: "Salvando…", footer: "Salvando…", canRetry: false };
  if (autosave === "pending") return { tone: "busy", header: "Alterações pendentes", footer: "Alterações pendentes", canRetry: false };
  if (lastSavedAt !== null) return { tone: "ok", header: "Salvamento automático", footer: `Salvo automaticamente • ${formatSavedAgo(lastSavedAt, now)}`, canRetry: false };
  if (hasRecord) return { tone: "ok", header: "Salvamento automático", footer: "Salvo automaticamente", canRetry: false };
  return { tone: "idle", header: "Salvamento automático", footer: "Nada para salvar ainda", canRetry: false };
}

export type EditorShortcut = "undo" | "redo" | "zoomIn" | "zoomOut" | "zoomReset";

/** Atalho do editor para a tecla pressionada (Ctrl ou Cmd): Z, Y/Shift+Z, +/=, -, 0. Qualquer outra combinação devolve `null`. */
export function shortcutFromKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): EditorShortcut | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  if (key === "+" || key === "=") return "zoomIn";
  if (key === "-" || key === "_") return "zoomOut";
  if (key === "0") return "zoomReset";
  return null;
}

/** O alvo do evento é um campo onde se digita texto (os atalhos do editor não devem roubar Ctrl+Z, Delete, etc.)? */
export function isTextEntryTarget(target: { tagName?: string; type?: string; isContentEditable?: boolean } | null) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !["range", "checkbox", "radio", "button", "submit", "file", "color"].includes((target.type ?? "text").toLowerCase());
}

const typeNames: Record<string, string> = {
  freehand: "Traço", curve: "Traço", line: "Linha", arrow: "Seta", ellipse: "Círculo", rectangle: "Retângulo", triangle: "Triângulo", point: "Ponto", text: "Texto",
};

export function annotationTypeName(type: string) {
  return typeNames[type] ?? "Marcação";
}

/** Descrição de uma marcação na lista: a legenda, ou o tipo com o número entre as do mesmo tipo (ex.: "Ponto 2"). */
export function annotationDescription(annotations: readonly { type: string; label?: string }[], index: number) {
  const item = annotations[index];
  if (!item) return "";
  const label = item.label?.trim();
  if (label) return label;
  const name = annotationTypeName(item.type);
  let ordinal = 0;
  for (let i = 0; i <= index; i++) if (annotationTypeName(annotations[i].type) === name) ordinal += 1;
  return `${name} ${ordinal}`;
}

export function markingsCountLabel(count: number) {
  return count === 1 ? "1 marcação" : `${count} marcações`;
}

export const facialShortcutList: { keys: string[]; label: string }[] = [
  { keys: ["Ctrl", "Z"], label: "Desfazer" },
  { keys: ["Ctrl", "Y"], label: "Refazer (também Ctrl + Shift + Z)" },
  { keys: ["Ctrl", "+"], label: "Aumentar o zoom" },
  { keys: ["Ctrl", "-"], label: "Diminuir o zoom" },
  { keys: ["Ctrl", "0"], label: "Ajustar a foto à área" },
  { keys: ["Delete"], label: "Excluir a marcação selecionada" },
  { keys: ["Esc"], label: "Sair da área de trabalho ampliada" },
];
