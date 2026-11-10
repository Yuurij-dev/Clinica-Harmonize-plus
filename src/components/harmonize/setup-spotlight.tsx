"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currentSetupTargetIndex, isSetupFieldFilled, placeBalloon, type SetupRect, type SetupSpotlightItem } from "@/lib/setup-rules";
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

function visibleElement(selector: string) {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = el.getBoundingClientRect();
    if (rect.width >= 1 && rect.height >= 1) return el;
  }
  return null;
}

function fieldValue(el: HTMLElement) {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : "";
}

const toRect = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
};

const sameRects = (a: Rect[], b: Rect[]) => a.length === b.length && a.every((r, i) => Math.abs(r.x - b[i].x) < 1 && Math.abs(r.y - b[i].y) < 1 && Math.abs(r.w - b[i].w) < 1 && Math.abs(r.h - b[i].h) < 1);

type Props = {
  /** Alvos em ordem ([data-setup-target="..."] + dica). Só o primeiro ainda pendente pulsa. */
  items: readonly SetupSpotlightItem[];
};

/**
 * Destaque do assistente de configuração sobre a tela real. Diferente do tour, NÃO bloqueia nada: a camada é
 * pointer-events:none (só o balão recebe clique), então o usuário usa o campo destacado normalmente.
 * Um alvo por vez: o atual é o primeiro da ordem que ainda não está preenchido (campos) ou o botão da etapa. Só ele
 * recebe o anel pulsante, e o destaque avança (ou volta, se o campo for apagado) conforme o usuário digita.
 * O escurecimento com o balão do Harmo some ao interagir com um alvo, Esc ou "Entendi"; o anel segue até a etapa
 * concluir (quando o host desmonta este componente). Monte com `key` novo para recomeçar.
 */
export function SetupSpotlight({ items: rawItems }: Props) {
  const items = rawItems ?? [];
  const [view, setView] = useState<{ index: number; rects: Rect[] } | null>(null);
  const [dim, setDim] = useState(true);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [obstacles, setObstacles] = useState<Rect[]>([]);
  const [balloon, setBalloon] = useState({ w: 0, h: 0 });
  const balloonRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  const itemsKey = items.map((item) => item.selector).join("|");

  const measure = useCallback(() => {
    const list = itemsRef.current;
    const els = list.map((item) => visibleElement(item.selector));
    const filled = list.map((item, index) => {
      const el = els[index];
      if (!el) return null;
      return item.fieldKey ? isSetupFieldFilled(item.fieldKey, fieldValue(el)) : false;
    });
    const index = currentSetupTargetIndex(list, filled);
    setVp((current) => (current.w === window.innerWidth && current.h === window.innerHeight ? current : { w: window.innerWidth, h: window.innerHeight }));
    const blocked = obstacleRects();
    setObstacles((current) => (sameRects(current, blocked) ? current : blocked));
    if (index < 0) {
      setView((current) => (current === null ? current : null));
      return false;
    }
    const currentEl = els[index]!;
    // Rola até o alvo novo se ele não estiver inteiro na tela (e sempre no primeiro).
    const key = list[index].selector;
    if (scrolledFor.current !== key) {
      const first = scrolledFor.current === null;
      scrolledFor.current = key;
      const r = currentEl.getBoundingClientRect();
      if (first || r.top < 0 || r.bottom > window.innerHeight) currentEl.scrollIntoView({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
    // O alvo atual vem primeiro; os demais entram só para o balão não cobri-los.
    const rects = [toRect(currentEl), ...els.flatMap((el, i) => (el && i !== index ? [toRect(el)] : []))];
    setView((current) => (current && current.index === index && sameRects(current.rects, rects) ? current : { index, rects }));
    return true;
  }, []);

  // O alvo pode aparecer depois (dados assíncronos): tenta por um tempo curto; depois reposiciona em resize/scroll
  // e recalcula quando o usuário digita (input/change) em qualquer campo.
  useEffect(() => {
    scrolledFor.current = null;
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
    document.addEventListener("input", measure, true);
    document.addEventListener("change", measure, true);
    // Alvos de navegação/seleção (abas do Estoque, "Ver todas" -> tela de recorrentes) trocam de lugar quando a tela muda:
    // o alvo passa a ser marcado em outro elemento (data-setup-target). Reavalia ao vivo em cliques e em mudanças do DOM.
    let frame = 0;
    const later = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    document.addEventListener("click", later, true);
    const observer = new MutationObserver(later);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-setup-target"] });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("click", later, true);
      observer.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("input", measure, true);
      document.removeEventListener("change", measure, true);
    };
  }, [measure, itemsKey]);

  // Interagir com um alvo (clique ou foco), Esc ou "Entendi" tira o escurecimento; o anel continua.
  useEffect(() => {
    if (!dim) return;
    const onTarget = (event: Event) => {
      const node = event.target instanceof Node ? event.target : null;
      if (node && itemsRef.current.some((item) => visibleElement(item.selector)?.contains(node))) setDim(false);
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
  }, [dim]);

  const hint = view ? items[view.index]?.hint ?? "" : "";
  useLayoutEffect(() => {
    const el = balloonRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setBalloon((current) => (current.w === w && current.h === h ? current : { w, h }));
  }, [dim, hint, vp.w, vp.h, view]);

  if (!view) return null;

  const [current] = view.rects;
  const width = Math.min(320, vp.w - 24);
  const { left, top } = placeBalloon({ targets: view.rects, obstacles, viewport: vp, size: { w: width, h: balloon.h || 110 }, desktop: vp.w >= 1024 });

  return (
    <div className="pointer-events-none fixed inset-0 z-[85]" data-setup-spotlight>
      {dim ? (
        <svg className="hp-tour-dim absolute inset-0" width={vp.w} height={vp.h} aria-hidden="true">
          <path d={`M0 0H${vp.w}V${vp.h}H0Z${holePath(current)}`} fill={DIM} fillRule="evenodd" />
        </svg>
      ) : null}
      <div aria-hidden="true" className="pointer-events-none absolute" style={{ left: current.x - 3, top: current.y - 3, width: current.w + 6, height: current.h + 6 }}>
        <div className={cn("hp-setup-ring h-full w-full rounded-[17px] border-[3px]", dim ? "border-white" : "border-primary")} />
      </div>
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
