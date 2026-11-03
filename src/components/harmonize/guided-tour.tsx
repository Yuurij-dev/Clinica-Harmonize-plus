"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import type { SectionId } from "@/types/clinic";
import { Button } from "@/components/ui/button";
import { TOUR_SEEN, clampStep, isLastStep, shouldShowTour, tourKey, visibleTourSteps } from "@/lib/tour-rules";
import { tourReplayEvent } from "@/lib/section-events";
import { cn } from "@/lib/utils";
import { GuideMascot } from "./illustrations/guide-mascot";
import { useBodyScrollLock } from "./use-body-scroll-lock";
import { useCan } from "./current-user";
import { hasDraftGuard } from "./use-draft-autosave";

type Rect = { x: number; y: number; w: number; h: number };
type Viewport = { w: number; h: number };
/** Alvo medido e o passo a que pertence: o tween só roda quando o alvo do passo atual já foi resolvido. */
type Target = { rect: Rect | null; forStep: string | undefined };

const DIM = "rgba(18,14,48,0.78)";
const OPEN_DELAY_MS = 800;
const TWEEN_MS = 420;
const SPOT_PAD = 4;
const SPOT_RADIUS = 14;
const GAP = 20;
const MARGIN = 12;
const DESKTOP_MIN = 1024;
const FOCUSABLE = "button:not([disabled]), [href], input, [tabindex]:not([tabindex='-1'])";

function holePath({ x, y, w, h }: Rect): string {
  const r = Math.min(SPOT_RADIUS, w / 2, h / 2);
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Primeiro elemento visível com `data-tour` da seção (sidebar no desktop, barra inferior no celular/tablet). */
function findTarget(section: SectionId | undefined): Rect | null {
  if (!section) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${section}"]`)) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    return { x: rect.left - SPOT_PAD, y: rect.top - SPOT_PAD, w: rect.width + SPOT_PAD * 2, h: rect.height + SPOT_PAD * 2 };
  }
  return null;
}

/** Diferenças menores que 1px (ajuste de layout logo após a troca de seção) não contam: reiniciariam o tween e o buraco saltaria. */
const sameRect = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1);

type Props = {
  allowedSections: SectionId[];
  userId: string;
  /** `replace` evita empilhar uma entrada de histórico por passo do tour. */
  onSelectSection: (section: SectionId, replace?: boolean) => void | Promise<void>;
  /** Há diálogo ou rascunho aberto: o tour não abre sozinho por cima. */
  suppressAutoOpen?: boolean;
  /** Seção em que o usuário estava; o tour devolve a ela ao terminar. */
  activeSection?: SectionId;
};

/**
 * Tour guiado do primeiro acesso: o Harmo (mascote) passa pelas áreas do sistema destacando cada item da navegação.
 * Aparece uma vez por usuário (localStorage, só preferência de interface), pode ser pulado e revisto em Configurações.
 */
export function GuidedTour({ allowedSections, userId, onSelectSection, activeSection, suppressAutoOpen = false }: Props) {
  const canReadClinical = useCan("clinical:read");
  const sectionsKey = allowedSections.join(",");
  const steps = useMemo(() => visibleTourSteps(sectionsKey ? (sectionsKey.split(",") as SectionId[]) : [], canReadClinical), [sectionsKey, canReadClinical]);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"next" | "back">("next");
  const [vp, setVp] = useState<Viewport>({ w: 0, h: 0 });
  const [target, setTarget] = useState<Target>({ rect: null, forStep: undefined });
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 });
  const pathRef = useRef<SVGPathElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const shown = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const tweenedStep = useRef<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const startSection = useRef<SectionId | undefined>(undefined);

  const total = steps.length;
  const safeIndex = clampStep(index, total);
  const step = steps[safeIndex];
  const last = isLastStep(safeIndex, total);
  const stepKey = step?.key;

  const open = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    startSection.current = activeSection;
    tweenedStep.current = null;
    shown.current = { x: 0, y: 0, w: 0, h: 0 };
    setTarget({ rect: null, forStep: undefined });
    setIndex(0);
    setDir("next");
    setVp({ w: window.innerWidth, h: window.innerHeight });
    setVisible(true);
  }, [activeSection]);

  // Primeiro acesso: lê a marca do usuário e abre o tour pouco depois de o app ficar pronto.
  const hasSteps = total > 0;
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    if (!userId || !hasSteps || suppressAutoOpen) return;
    let raw: string | null = null;
    let readFailed = false;
    try {
      raw = window.localStorage.getItem(tourKey(userId));
    } catch {
      readFailed = true; // leitura falhou: não repete o tour a cada abertura
    }
    if (!shouldShowTour(raw, readFailed)) return;
    const timer = window.setTimeout(() => {
      if (!hasDraftGuard()) openRef.current(); // rascunho aberto durante a espera: não abre por cima
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [userId, hasSteps, suppressAutoOpen]);

  // "Rever o tour guiado" em Configurações.
  useEffect(() => {
    const replay = () => {
      if (!hasSteps) return;
      try {
        window.localStorage.removeItem(tourKey(userId));
      } catch {
        /* sem limpar a marca o tour apenas reabre agora; não é dado clínico */
      }
      openRef.current();
    };
    window.addEventListener(tourReplayEvent, replay);
    return () => window.removeEventListener(tourReplayEvent, replay);
  }, [userId, hasSteps]);

  const finish = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem(tourKey(userId), TOUR_SEEN);
    } catch {
      /* sem a marca o tour pode reaparecer; não é dado clínico */
    }
    const origin = startSection.current;
    if (origin && origin !== activeSection) void onSelectSection(origin, true);
    const el = returnFocus.current;
    window.setTimeout(() => {
      if (el && el.isConnected) el.focus({ preventScroll: true });
    }, 0);
  }, [userId, activeSection, onSelectSection]);

  const next = useCallback(() => {
    if (isLastStep(safeIndex, total)) finish();
    else {
      setDir("next");
      setIndex(safeIndex + 1);
    }
  }, [safeIndex, total, finish]);
  const back = useCallback(() => {
    if (safeIndex > 0) {
      setDir("back");
      setIndex(safeIndex - 1);
    }
  }, [safeIndex]);

  useBodyScrollLock(visible);

  // Mostra a seção do passo por trás do overlay.
  const stepSection = visible ? step?.section : undefined;
  const selectRef = useRef(onSelectSection);
  useEffect(() => {
    selectRef.current = onSelectSection;
  });
  useEffect(() => {
    if (stepSection) void selectRef.current(stepSection, true);
  }, [stepSection]);

  // Localiza o alvo do passo e recalcula ao redimensionar ou rolar.
  useEffect(() => {
    if (!visible) return;
    const measure = () => {
      setVp((current) => (current.w === window.innerWidth && current.h === window.innerHeight ? current : { w: window.innerWidth, h: window.innerHeight }));
      const found = findTarget(stepSection);
      setTarget((current) => (current.forStep === stepKey && sameRect(current.rect, found) ? current : { rect: found, forStep: stepKey }));
    };
    measure();
    const settle = window.setTimeout(measure, 350);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visible, stepSection, stepKey]);

  // O buraco desliza até o alvo ao trocar de passo; em resize/scroll acompanha sem animação. Atualiza o DOM direto (sem re-render por quadro).
  useEffect(() => {
    if (!visible || !vp.w || target.forStep !== stepKey) return;
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
  }, [visible, vp.w, vp.h, target, stepKey]);

  // Mede o cartão (mascote incluso) para posicioná-lo sem cobrir o destaque.
  useLayoutEffect(() => {
    if (!visible) return;
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setCardSize((current) => (current.w === w && current.h === h ? current : { w, h }));
  }, [visible, stepKey, vp.w, vp.h]);

  // Foco inicial e a cada passo no botão principal.
  useEffect(() => {
    if (visible) cardRef.current?.querySelector<HTMLElement>("[data-tour-primary]")?.focus({ preventScroll: true });
  }, [visible, stepKey]);

  // Teclado: Esc pula, setas navegam, Tab fica preso no cartão.
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
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
  }, [visible, finish, next, back]);

  if (!visible || !step || !vp.w) return null;

  // Posição do cartão: ao lado da sidebar no desktop, acima/abaixo do destaque no celular e tablet, centralizado sem destaque.
  const cardW = Math.min(420, vp.w - MARGIN * 2);
  const maxH = vp.h - MARGIN * 2;
  const cardH = Math.min(cardSize.h, maxH);
  let left = (vp.w - cardW) / 2;
  let top = (vp.h - cardH) / 2;
  if (target.rect) {
    const t = target.rect;
    if (vp.w >= DESKTOP_MIN) {
      left = Math.min(t.x + t.w + GAP, vp.w - cardW - MARGIN);
      top = t.y + t.h / 2 - cardH / 2;
    } else if (t.y > vp.h / 2) {
      top = t.y - GAP - cardH;
    } else {
      top = t.y + t.h + GAP;
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
                <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={finish}>
                  Pular tour
                </Button>
              )}
              <div className="ml-auto flex gap-2">
                {safeIndex > 0 ? (
                  <Button type="button" variant="outline" size="sm" aria-label="Passo anterior" onClick={back}>
                    <ArrowLeft aria-hidden="true" />
                    Voltar
                  </Button>
                ) : null}
                <Button data-tour-primary type="button" variant="primary" size="sm" aria-label={last ? "Concluir o tour" : "Próximo passo"} onClick={next}>
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
