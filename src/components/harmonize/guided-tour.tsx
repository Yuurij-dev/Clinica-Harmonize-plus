"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SectionId } from "@/types/clinic";
import { TOUR_SEEN, shouldShowTour, tourKey, visibleTourSteps } from "@/lib/tour-rules";
import { tourReplayEvent } from "@/lib/section-events";
import { useCan } from "./current-user";
import { hasDraftGuard } from "./use-draft-autosave";
import { TourOverlay, useTourStepper } from "./tour-overlay";

const OPEN_DELAY_MS = 800;

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
 * Aparece uma vez por usuário (localStorage, só preferência de interface), pode ser pulado e revisto pelo "?" da topbar.
 * A apresentação (overlay, spotlight, cartão) é do TourOverlay, compartilhado com o tour da ficha da paciente.
 */
export function GuidedTour({ allowedSections, userId, onSelectSection, activeSection, suppressAutoOpen = false }: Props) {
  const canReadClinical = useCan("clinical:read");
  const sectionsKey = allowedSections.join(",");
  const steps = useMemo(() => visibleTourSteps(sectionsKey ? (sectionsKey.split(",") as SectionId[]) : [], canReadClinical), [sectionsKey, canReadClinical]);
  const stepper = useTourStepper(steps.length);
  const { visible, index, dir, last, open: openStepper, close, advance, back } = stepper;
  const startSection = useRef<SectionId | undefined>(undefined);
  const step = steps[index];

  const open = useCallback(() => {
    if (!openStepper()) return;
    startSection.current = activeSection;
  }, [activeSection, openStepper]);

  // Primeiro acesso: lê a marca do usuário e abre o tour pouco depois de o app ficar pronto.
  const hasSteps = steps.length > 0;
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
      if (!hasDraftGuard()) openRef.current(); // rascunho aberto durante a espera: não abre por cima (outro tour aberto: o `open` recusa)
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [userId, hasSteps, suppressAutoOpen]);

  // "Rever o tour guiado" pelo "?" da topbar.
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
    try {
      window.localStorage.setItem(tourKey(userId), TOUR_SEEN);
    } catch {
      /* sem a marca o tour pode reaparecer; não é dado clínico */
    }
    close();
    const origin = startSection.current;
    if (origin && origin !== activeSection) void onSelectSection(origin, true);
  }, [userId, activeSection, onSelectSection, close]);

  const next = useCallback(() => {
    if (last) finish();
    else advance();
  }, [last, finish, advance]);

  // Mostra a seção do passo por trás do overlay.
  const stepSection = visible ? step?.section : undefined;
  const selectRef = useRef(onSelectSection);
  useEffect(() => {
    selectRef.current = onSelectSection;
  });
  useEffect(() => {
    if (stepSection) void selectRef.current(stepSection, true);
  }, [stepSection]);

  if (!visible || !step) return null;
  // Primeiro elemento visível com `data-tour` da seção: sidebar no desktop, barra inferior no celular/tablet.
  return <TourOverlay steps={steps} index={index} dir={dir} selector={stepSection ? `[data-tour="${stepSection}"]` : undefined} onNext={next} onBack={back} onFinish={finish} />;
}
