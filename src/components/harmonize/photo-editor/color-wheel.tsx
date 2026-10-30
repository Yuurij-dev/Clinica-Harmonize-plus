"use client";

import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { hexToHsv, hsvToHex, hueFromPoint, normalizeHex, type Hsv } from "@/lib/color-rules";
import { cn } from "@/lib/utils";
import { editorColors } from "./editor-toolbar-data";

const size = 136; // lado da roda em px
const ringWidth = 16;
const square = 70; // lado do quadrado de saturação/brilho dentro do anel
const hueGradient = "conic-gradient(from 0deg, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))";
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Roda de cores (HSV) sem dependência: anel de matiz, quadrado de saturação/brilho, atalhos das cores do SaaS e campo hex.
 * Controlada pelo hex: a escolha chama `onChange(hex)`; o pai decide se edita a marcação selecionada ou a cor das próximas.
 */
export function ColorWheel({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [local, setLocal] = useState<Hsv | null>(null);
  // Guarda o HSV da última escolha: com cinza ou preto o matiz se perderia ao converter só do hex.
  const hsv = local && hsvToHex(local) === color.toLowerCase() ? local : hexToHsv(color);

  function apply(next: Hsv) {
    setLocal(next);
    onChange(hsvToHex(next));
  }

  function ringPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    apply({ ...hsv, h: hueFromPoint(event.clientX, event.clientY, rect.left + rect.width / 2, rect.top + rect.height / 2) });
  }
  function squarePoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    apply({ ...hsv, s: clamp01((event.clientX - rect.left) / rect.width), v: clamp01(1 - (event.clientY - rect.top) / rect.height) });
  }
  const drag = (handler: (event: ReactPointerEvent<HTMLDivElement>) => void) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); handler(event); },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) handler(event); },
  });

  function ringKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 15 : 3;
    const delta = event.key === "ArrowRight" || event.key === "ArrowUp" ? step : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    apply({ ...hsv, h: (hsv.h + delta + 360) % 360 });
  }
  function squareKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.02;
    const move = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (!move) return;
    event.preventDefault();
    apply({ ...hsv, s: clamp01(hsv.s + move[0]), v: clamp01(hsv.v + move[1]) });
  }

  const radius = (size - ringWidth) / 2;
  const angle = (hsv.h * Math.PI) / 180;
  const ringThumb = { left: size / 2 + radius * Math.sin(angle), top: size / 2 - radius * Math.cos(angle) };
  const pure = `hsl(${Math.round(hsv.h)} 100% 50%)`;

  return (
    <div className="mt-2 flex gap-3 max-sm:flex-wrap">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <div
          aria-label="Matiz"
          aria-valuemax={359}
          aria-valuemin={0}
          aria-valuenow={Math.round(hsv.h)}
          aria-valuetext={`${Math.round(hsv.h)} graus`}
          className="absolute inset-0 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          role="slider"
          style={{ background: hueGradient, WebkitMask: `radial-gradient(circle, transparent ${radius - ringWidth / 2 - 1}px, #000 ${radius - ringWidth / 2}px)`, mask: `radial-gradient(circle, transparent ${radius - ringWidth / 2 - 1}px, #000 ${radius - ringWidth / 2}px)` }}
          tabIndex={0}
          onKeyDown={ringKey}
          {...drag(ringPoint)}
        />
        <span aria-hidden="true" className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" style={{ ...ringThumb, backgroundColor: pure }} />
        <div
          aria-label="Saturação e brilho"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(hsv.v * 100)}
          aria-valuetext={`saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%`}
          className="absolute touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          role="slider"
          style={{ left: (size - square) / 2, top: (size - square) / 2, width: square, height: square, backgroundImage: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})` }}
          tabIndex={0}
          onKeyDown={squareKey}
          {...drag(squarePoint)}
        >
          <span aria-hidden="true" className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: color }} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Cores do Harmonize">
          {editorColors.map((item) => (
            <button aria-label={`${item.label} ${item.value}`} aria-pressed={item.value === color.toLowerCase()} className="grid h-7 w-7 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:h-11 max-lg:w-11" key={item.value} title={`${item.label} ${item.value}`} type="button" onClick={() => { setLocal(null); onChange(item.value); }}>
              <span className={cn("h-5 w-5 rounded-full border border-border", item.value === color.toLowerCase() && "ring-2 ring-primary ring-offset-1 ring-offset-background")} style={{ backgroundColor: item.value }} />
            </button>
          ))}
        </div>
        <HexField color={color} key={color} onChange={onChange} />
      </div>
    </div>
  );
}

function HexField({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [draft, setDraft] = useState(color.toUpperCase());
  const valid = normalizeHex(draft) !== null;
  const commit = () => { const hex = normalizeHex(draft); if (hex && hex !== color.toLowerCase()) onChange(hex); else setDraft(color.toUpperCase()); };
  return (
    <label className="mt-2 block text-xs text-muted-foreground">
      Hex
      <input
        aria-invalid={!valid}
        aria-label="Cor em hexadecimal"
        className={cn("mt-1 h-8 w-full rounded-lg border bg-card px-2 text-sm font-medium uppercase text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 max-lg:h-11", valid ? "border-input" : "border-destructive")}
        maxLength={7}
        spellCheck={false}
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }}
      />
    </label>
  );
}
