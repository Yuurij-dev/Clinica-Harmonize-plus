// Conversões de cor da roda de cores (HSV <-> RGB <-> hex). Funções puras, sem DOM: carregáveis direto pelo node:test.

export type Hsv = { h: number; s: number; v: number }; // h em graus [0,360), s e v em [0,1]

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** "#abc", "abc", "#AABBCC" ou "aabbcc" viram "#aabbcc"; qualquer outra coisa vira `null`. */
export function normalizeHex(input: string): string | null {
  const text = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(text)) return `#${text.split("").map((c) => c + c).join("").toLowerCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text.toLowerCase()}`;
  return null;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return [parseInt(normalized.slice(1, 3), 16), parseInt(normalized.slice(3, 5), 16), parseInt(normalized.slice(5, 7), 16)];
}

export function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn); const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1); const val = clamp(v, 0, 1);
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function hsvToHex(hsv: Hsv) {
  const [r, g, b] = hsvToRgb(hsv);
  return rgbToHex(r, g, b);
}

/** Hex válido para HSV; hex inválido cai no cinza-preto (nunca lança). */
export function hexToHsv(hex: string): Hsv {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(...rgb) : { h: 0, s: 0, v: 0 };
}

/** Matiz (graus, 0 = topo, sentido horário) do ponto (x, y) em relação ao centro (cx, cy) de uma roda. */
export function hueFromPoint(x: number, y: number, cx: number, cy: number) {
  const degrees = (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
  return (degrees + 360) % 360;
}
