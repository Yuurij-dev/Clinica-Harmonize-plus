"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { placeBalloon, type SetupRect } from "@/lib/setup-rules";
import { GuideMascot } from "./illustrations/guide-mascot";
import { DIM, holePath, prefersReducedMotion } from "./tour-overlay";

type Rect = SetupRect;

const PAD = 4;
const RETRY_MS = 120;
const MAX_RETRIES = 25;
// Elementos fixos que o balão não pode cobrir: barra de retorno do assistente e navegação inferior do celular.
const OBSTACLES = "[data-setup-bar], .hp-mobile-nav";

function obstacleRects() {
  const rects: Rect[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(OBSTACLES)) {
    const r = el.getBoundingClientRect();
    if (r.width >= 1 && r.height >= 1) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return rects;
}

function visibleTargets(selectors: string[]) {
  const found: HTMLElement[] = [];
  for (const selector of selectors) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = el.getBoundingClientRect();
      if (rect.width >= 1 && rect.height >= 1 && !found.includes(el)) found.push(el);
    }
  }
  return found;
}

const sameRects = (a: Rect[], b: Rect[]) => a.length === b.length && a.every((r, i) => Math.abs(r.x - b[i].x) < 1 && Math.abs(r.y - b[i].y) < 1 && Math.abs(r.w - b[i].w) < 1 && Math.abs(r.h - b[i].h) < 1);

type Props = {
  /** Seletores CSS ([data-setup-target="..."]) dos elementos a destacar na tela. */
  selectors: string[];
  /** Dica curta do Harmo no balão. */
  hint: string;
};

/**
 * Destaque do assistente de configuração sobre a tela real. Diferente do tour, NÃO bloqueia nada: a camada é
 * pointer-events:none (só o balão recebe clique), então o usuário usa o campo destacado normalmente.
 * Começa escurecendo a tela com um buraco no alvo e o balão do Harmo; ao interagir com o alvo, Esc ou "Entendi" o
 * escurecimento some e fica só um anel discreto nos alvos que ainda existem. Monte com `key` novo para recomeçar.
 */
export function SetupSpotlight({ selectors, hint }: Props) {
  const [rects, setRects] = useState<Rect[]>([]);
  const [dim, setDim] = useState(true);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [obstacles, setObstacles] = useState<Rect[]>([]);
  const [balloon, setBalloon] = useState({ w: 0, h: 0 });
  const balloonRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const selectorsKey = selectors.join("|");

  const measure = useCallback(() => {
    const els = visibleTargets(selectorsKey ? selectorsKey.split("|") : []);
    setVp((current) => (current.w === window.innerWidth && current.h === window.innerHeight ? current : { w: window.innerWidth, h: window.innerHeight }));
    if (els.length && !scrolled.current) {
      scrolled.current = true;
      els[0].scrollIntoView({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
    const next = els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
    });
    setRects((current) => (sameRects(current, next) ? current : next));
    const blocked = obstacleRects();
    setObstacles((current) => (sameRects(current, blocked) ? current : blocked));
    return els.length > 0;
  }, [selectorsKey]);

  // O alvo pode aparecer depois (dados assíncronos): tenta por um tempo curto; depois só reposiciona em resize/scroll.
  useEffect(() => {
    scrolled.current = false;
    let retries = 0;
    let timer = 0;
    const attempt = () => {
      if (measure() || retries >= MAX_RETRIES) return;
      retries += 1;
      timer = window.setTimeout(attempt, RETRY_MS);
    };
    attempt();
    const settle = window.setTimeout(measure, 450); // depois do scroll suave
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  // Interagir com o alvo (clique ou foco), Esc ou "Entendi" tira o escurecimento.
  useEffect(() => {
    if (!dim) return;
    const onTarget = (event: Event) => {
      const node = event.target instanceof Node ? event.target : null;
      if (node && visibleTargets(selectorsKey.split("|")).some((el) => el.contains(node))) setDim(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDim(false); };
    document.addEventListener("pointerdown", onTarget, true);
    document.addEventListener("focusin", onTarget, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onTarget, true);
      document.removeEventListener("focusin", onTarget, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [dim, selectorsKey]);

  useLayoutEffect(() => {
    const el = balloonRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setBalloon((current) => (current.w === w && current.h === h ? current : { w, h }));
  }, [dim, hint, vp.w, vp.h, rects.length]);

  if (!rects.length) return null;

  const width = Math.min(320, vp.w - 24);
  const { left, top } = placeBalloon({ targets: rects, obstacles, viewport: vp, size: { w: width, h: balloon.h || 110 }, desktop: vp.w >= 1024 });

  return (
    <div className="pointer-events-none fixed inset-0 z-[85]" data-setup-spotlight>
      {dim ? (
        <svg className="hp-tour-dim absolute inset-0" width={vp.w} height={vp.h} aria-hidden="true">
          <path d={`M0 0H${vp.w}V${vp.h}H0Z${rects.map((r) => holePath(r)).join("")}`} fill={DIM} fillRule="evenodd" />
        </svg>
      ) : null}
      {rects.map((r, index) => (
        <div key={index} aria-hidden="true" className="pointer-events-none absolute" style={{ left: r.x - 3, top: r.y - 3, width: r.w + 6, height: r.h + 6 }}>
          <div className={cn("h-full w-full rounded-[17px] border-[3px]", dim ? "hp-tour-ring border-white" : "border-primary/60")} />
        </div>
      ))}
      {dim ? (
        <div ref={balloonRef} role="status" className="hp-tour-card pointer-events-auto absolute flex items-start gap-2 rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-2xl" style={{ left, top, width }}>
          <div className="shrink-0" aria-hidden="true"><GuideMascot size={52} pose="point" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-5">{hint}</p>
            <div className="mt-2 flex justify-end"><Button size="sm" onClick={() => setDim(false)}>Entendi</Button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
