"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clampStep, isLastStep, type TourPose } from "@/lib/tour-rules";
import { cn } from "@/lib/utils";
import { GuideMascot } from "./illustrations/guide-mascot";
import { useBodyScrollLock } from "./use-body-scroll-lock";
import { releaseTourOverlay, reserveTourOverlay } from "./tour-presence";

/**
 * Apresentação compartilhada dos tours (geral e da ficha da paciente): camada escura com buraco que desliza até o
 * destaque, anel pulsante, cartão com o Harmo, pontos de progresso, teclado e foco preso. Quem usa decide quais passos
 * existem, quando abrir, o que mostrar por trás e onde guardar o "já viu".
 */

type Rect = { x: number; y: number; w: number; h: number };
type Viewport = { w: number; h: number };
/** Alvo medido e o passo a que pertence: o tween só roda quando o alvo do passo atual já foi resolvido. */
type Target = { rect: Rect | null; forStep: string | undefined };

export type TourOverlayStep = { key: string; title: string; text: string; pose: TourPose };

const DIM = "rgba(18,14,48,0.78)";
const TWEEN_MS = 420;
const SPOT_PAD = 4;
const SPOT_RADIUS = 14;
const GAP = 20;
const MARGIN = 12;
const DESKTOP_MIN = 1024;
const SETTLE_MS = 350;
const RETRY_MS = 60;
const MAX_RETRIES = 10;
const FOCUSABLE = "button:not([disabled]), [href], input, [tabindex]:not([tabindex='-1'])";

function holePath({ x, y, w, h }: Rect): string {
  const r = Math.min(SPOT_RADIUS, w / 2, h / 2);
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Primeiro elemento visível que casa com o seletor (ex.: sidebar no desktop, barra inferior no celular). */
function findTargetElement(selector: string | undefined): HTMLElement | null {
  if (!selector) return null;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    return el;
  }
  return null;
}

function paddedRect(el: HTMLElement): Rect {
  const rect = el.getBoundingClientRect();
  return { x: rect.left - SPOT_PAD, y: rect.top - SPOT_PAD, w: rect.width + SPOT_PAD * 2, h: rect.height + SPOT_PAD * 2 };
}

/** Diferenças menores que 1px (ajuste de layout logo após a troca de seção) não contam: reiniciariam o tween e o buraco saltaria. */
const sameRect = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1);

/**
 * Estado de uma execução do tour: aberto/fechado, passo atual e direção (para a animação do cartão).
 * `open` guarda o foco anterior; `close` o devolve.
 */
export function useTourStepper(total: number) {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"next" | "back">("next");
  const returnFocus = useRef<HTMLElement | null>(null);
  const held = useRef(false);
  const safeIndex = clampStep(index, total);
  const last = isLastStep(safeIndex, total);

  // A vez de abrir é reservada de forma síncrona em `open` e devolvida em `close` ou ao desmontar.
  useEffect(() => () => {
    if (held.current) {
      held.current = false;
      releaseTourOverlay();
    }
  }, []);

  /** Falso quando outro tour já está aberto (ou reservado): nada é aberto. */
  const open = useCallback(() => {
    if (held.current || !reserveTourOverlay()) return false;
    held.current = true;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
    setDir("next");
    setVisible(true);
    return true;
  }, []);
  const close = useCallback(() => {
    if (held.current) {
      held.current = false;
      releaseTourOverlay();
    }
    setVisible(false);
    const el = returnFocus.current;
    window.setTimeout(() => {
      if (el && el.isConnected) el.focus({ preventScroll: true });
    }, 0);
  }, []);
  const advance = useCallback(() => {
    setDir("next");
    setIndex(safeIndex + 1);
  }, [safeIndex]);
  const back = useCallback(() => {
    if (safeIndex > 0) {
      setDir("back");
      setIndex(safeIndex - 1);
    }
  }, [safeIndex]);

  return { visible, index: safeIndex, dir, last, open, close, advance, back };
}

type Props = {
  steps: readonly TourOverlayStep[];
  /** Índice do passo atual (já dentro dos limites). */
  index: number;
  dir: "next" | "back";
  /** Seletor CSS do elemento destacado no passo atual; ausente = sem destaque. */
  selector?: string;
  /**
   * `side`: ao lado do destaque no desktop (menu lateral). `stack`: acima/abaixo do destaque em qualquer largura,
   * centralizado nele (destaques no meio da página).
   */
  placement?: "side" | "stack";
  /** Rola o destaque para a vista ao entrar no passo (abas que podem estar fora da tela). */
  revealTarget?: boolean;
  /** O destaque pode ainda não existir (aba trocada por trás do overlay): espera até ~600ms antes de seguir sem ele. */
  waitForTarget?: boolean;
  onNext: () => void;
  onBack: () => void;
  /** Esc e "Pular tour"/"Concluir". */
  onFinish: () => void;
};

/** Monte este componente só enquanto o tour estiver aberto: ao montar, o estado visual começa limpo. */
export function TourOverlay({ steps, index, dir, selector, placement = "side", revealTarget = false, waitForTarget = false, onNext, onBack, onFinish }: Props) {
  const total = steps.length;
  const safeIndex = clampStep(index, total);
  const step = steps[safeIndex];
  const last = isLastStep(safeIndex, total);
  const stepKey = step?.key;

  const [vp, setVp] = useState<Viewport>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [target, setTarget] = useState<Target>({ rect: null, forStep: undefined });
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 });
  const pathRef = useRef<SVGPathElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const shown = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const tweenedStep = useRef<string | null>(null);
  const revealedStep = useRef<string | null>(null);

  useBodyScrollLock(true);

  // Localiza o alvo do passo e recalcula ao redimensionar ou rolar.
  useEffect(() => {
    // Espera pelo destaque: contador e timer próprios, para que o "settle" e o resize não gastem tentativas.
    let retries = 0;
    let retryTimer = 0;
    const measure = () => {
      setVp((current) => (current.w === window.innerWidth && current.h === window.innerHeight ? current : { w: window.innerWidth, h: window.innerHeight }));
      const el = findTargetElement(selector);
      // A aba/área do passo pode ainda não ter renderizado (troca por trás do overlay): espera um pouco antes de desistir do destaque.
      if (!el && selector && waitForTarget && (retryTimer || retries < MAX_RETRIES)) {
        if (!retryTimer) {
          retries += 1;
          retryTimer = window.setTimeout(() => {
            retryTimer = 0;
            measure();
          }, RETRY_MS);
        }
        return;
      }
      if (el && revealTarget && revealedStep.current !== stepKey) {
        revealedStep.current = stepKey ?? null;
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      const found = el ? paddedRect(el) : null;
      setTarget((current) => (current.forStep === stepKey && sameRect(current.rect, found) ? current : { rect: found, forStep: stepKey }));
    };
    measure();
    const settle = window.setTimeout(measure, SETTLE_MS);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(settle);
      window.clearTimeout(retryTimer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [selector, stepKey, revealTarget, waitForTarget]);

  // O buraco desliza até o alvo ao trocar de passo; em resize/scroll acompanha sem animação. Atualiza o DOM direto (sem re-render por quadro).
  useEffect(() => {
    if (!vp.w || target.forStep !== stepKey) return;
    const goal: Rect = target.rect ?? { x: vp.w / 2, y: vp.h * 0.42, w: 0, h: 0 };
    const apply = (r: Rect) => {
      shown.current = r;
      pathRef.current?.setAttribute("d", `M0 0H${vp.w}V${vp.h}H0Z${r.w < 1 ? "" : holePath(r)}`);
      const ring = ringRef.current;
      if (ring) {
        ring.style.left = `${r.x - 3}px`;
        ring.style.top = `${r.y - 3}px`;
        ring.style.width = `${r.w + 6}px`;
        ring.style.height = `${r.h + 6}px`;
        ring.style.opacity = String(Math.min(1, r.w / 40));
      }
    };
    const stepChanged = tweenedStep.current !== stepKey;
    tweenedStep.current = stepKey ?? null;
    if (!stepChanged || prefersReducedMotion()) {
      apply(goal);
      return;
    }
    const from = shown.current.w < 1 ? { x: goal.x + goal.w / 2, y: goal.y + goal.h / 2, w: 0, h: 0 } : shown.current;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / TWEEN_MS);
      const e = easeOut(t);
      apply({ x: from.x + (goal.x - from.x) * e, y: from.y + (goal.y - from.y) * e, w: from.w + (goal.w - from.w) * e, h: from.h + (goal.h - from.h) * e });
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [vp.w, vp.h, target, stepKey]);

  // Mede o cartão (mascote incluso) para posicioná-lo sem cobrir o destaque.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setCardSize((current) => (current.w === w && current.h === h ? current : { w, h }));
  }, [stepKey, vp.w, vp.h]);

  // Foco inicial e a cada passo no botão principal.
  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>("[data-tour-primary]")?.focus({ preventScroll: true });
  }, [stepKey]);

  // Teclado: Esc pula, setas navegam, Tab fica preso no cartão.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onFinish();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onBack();
      } else if (event.key === "Tab" && cardRef.current) {
        const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!items.length) return;
        const first = items[0];
        const lastItem = items[items.length - 1];
        const current = document.activeElement;
        if (!cardRef.current.contains(current)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && current === first) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && current === lastItem) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onFinish, onNext, onBack]);

  if (!step || !vp.w) return null;

  // Posição do cartão: `side` = ao lado da sidebar no desktop e acima/abaixo no celular e tablet; `stack` = acima/abaixo
  // do destaque, centralizado nele; sem destaque, centralizado na tela.
  const cardW = Math.min(420, vp.w - MARGIN * 2);
  const maxH = vp.h - MARGIN * 2;
  const cardH = Math.min(cardSize.h, maxH);
  let left = (vp.w - cardW) / 2;
  let top = (vp.h - cardH) / 2;
  if (target.rect) {
    const t = target.rect;
    if (placement === "side" && vp.w >= DESKTOP_MIN) {
      left = Math.min(t.x + t.w + GAP, vp.w - cardW - MARGIN);
      top = t.y + t.h / 2 - cardH / 2;
    } else {
      if (placement === "stack") left = Math.max(MARGIN, Math.min(t.x + t.w / 2 - cardW / 2, vp.w - cardW - MARGIN));
      top = t.y > vp.h / 2 ? t.y - GAP - cardH : t.y + t.h + GAP;
    }
  }
  top = Math.max(MARGIN, Math.min(top, vp.h - cardH - MARGIN));

  return (
    <div className="hp-tour-root fixed inset-0 z-[100]">
      <svg className="hp-tour-dim absolute inset-0" width={vp.w} height={vp.h} aria-hidden="true">
        <path ref={pathRef} d={`M0 0H${vp.w}V${vp.h}H0Z`} fill={DIM} fillRule="evenodd" />
      </svg>
      <div ref={ringRef} aria-hidden="true" className="pointer-events-none absolute opacity-0">
        <div className="hp-tour-ring h-full w-full rounded-[17px] border-[3px] border-white" />
      </div>

      <div className="hp-tour-slot absolute" style={{ left, top, width: cardW }}>
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="hp-tour-title"
          aria-describedby="hp-tour-text"
          key={step.key}
          className={cn("hp-tour-card flex flex-col items-center", dir === "back" && "hp-tour-card-back")}
          style={{ maxHeight: maxH }}
        >
          <div className="hp-tour-mascot relative z-10 -mb-10">
            <GuideMascot size={100} pose={step.pose} />
          </div>
          <div className="w-full overflow-y-auto rounded-2xl border border-border bg-card px-5 pb-4 pt-[52px] text-center text-card-foreground shadow-2xl">
            <p className="text-xs font-semibold text-muted-foreground">Passo {safeIndex + 1} de {total}</p>
            <h2 id="hp-tour-title" className="mt-1 text-lg font-black tracking-tight text-foreground">{step.title}</h2>
            <p id="hp-tour-text" className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
            <div aria-hidden="true" className="mt-4 flex items-center justify-center gap-[5px]">
              {steps.map((s, i) => (
                <span key={s.key} className={cn("h-[7px] rounded-full transition-all duration-300", i === safeIndex ? "w-5 bg-primary" : "w-[7px] bg-border")} />
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              {last ? null : (
                <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={onFinish}>
                  Pular tour
                </Button>
              )}
              <div className="ml-auto flex gap-2">
                {safeIndex > 0 ? (
                  <Button type="button" variant="outline" size="sm" aria-label="Passo anterior" onClick={onBack}>
                    <ArrowLeft aria-hidden="true" />
                    Voltar
                  </Button>
                ) : null}
                <Button data-tour-primary type="button" variant="primary" size="sm" aria-label={last ? "Concluir o tour" : "Próximo passo"} onClick={onNext}>
                  {last ? (
                    <>
                      <Check aria-hidden="true" />
                      Concluir
                    </>
                  ) : (
                    <>
                      Próximo
                      <ArrowRight aria-hidden="true" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
