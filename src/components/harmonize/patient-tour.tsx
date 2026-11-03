"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { PATIENT_TOUR_STEPS, patientTourKey, patientTourSelector, visiblePatientTourSteps } from "@/lib/patient-tour-rules";
import { patientTourReplayEvent } from "@/lib/section-events";
import { TOUR_SEEN, shouldShowTour } from "@/lib/tour-rules";
import { useCan, useTourUserId } from "./current-user";
import { TourOverlay, useTourStepper } from "./tour-overlay";
import { hasDraftGuard } from "./use-draft-autosave";

const OPEN_DELAY_MS = 800;

type Props = {
  /** Falso quando a ficha não mostra as abas (tratamento aberto, atendimento em edição): sem tour. */
  enabled: boolean;
  /** Há diálogo aberto na ficha: o tour não abre sozinho por cima. */
  suppressAutoOpen?: boolean;
  /** Aba e área do prontuário em que o usuário estava; o tour devolve a elas ao terminar. */
  activeTab: string;
  recordTab: string;
  /** Troca a aba (e a área do prontuário) por trás do overlay. */
  onShow: (tab: string, recordTab?: string) => void;
};

/**
 * Tour de primeiro acesso da ficha da paciente: o Harmo apresenta cada aba e área do prontuário. Aparece uma vez por
 * usuário na primeira ficha aberta (localStorage, só preferência de interface) e pode ser revisto pelo "?" da topbar.
 * Usa o mesmo overlay do tour geral (TourOverlay).
 */
export function PatientTour({ enabled, suppressAutoOpen = false, activeTab, recordTab, onShow }: Props) {
  const userId = useTourUserId();
  const canReadClinical = useCan("clinical:read");
  const steps = useMemo(() => visiblePatientTourSteps(canReadClinical), [canReadClinical]);
  const stepper = useTourStepper(steps.length);
  const { visible, index, dir, last, open: openStepper, close, advance, back } = stepper;
  const origin = useRef({ tab: activeTab, record: recordTab });
  const step = steps[index];
  const available = Boolean(userId) && enabled && steps.length > 0;

  const open = useCallback(() => {
    if (!openStepper()) return;
    origin.current = { tab: activeTab, record: recordTab };
  }, [activeTab, recordTab, openStepper]);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });


  // Primeira ficha aberta: lê a marca do usuário e abre o tour pouco depois.
  useEffect(() => {
    if (!userId || !available || suppressAutoOpen) return;
    let raw: string | null = null;
    let readFailed = false;
    try {
      raw = window.localStorage.getItem(patientTourKey(userId));
    } catch {
      readFailed = true; // leitura falhou: não repete o tour a cada ficha
    }
    if (!shouldShowTour(raw, readFailed)) return;
    const timer = window.setTimeout(() => {
      if (!hasDraftGuard()) openRef.current(); // rascunho aberto durante a espera: não abre por cima (outro tour aberto: o `open` recusa)
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [userId, available, suppressAutoOpen]);

  // "Tour desta página" na topbar.
  useEffect(() => {
    if (!available) return;
    const replay = () => openRef.current();
    window.addEventListener(patientTourReplayEvent, replay);
    return () => window.removeEventListener(patientTourReplayEvent, replay);
  }, [available]);

  const finish = useCallback(() => {
    if (userId) {
      try {
        window.localStorage.setItem(patientTourKey(userId), TOUR_SEEN);
      } catch {
        /* sem a marca o tour pode reaparecer; não é dado clínico */
      }
    }
    close();
    onShow(origin.current.tab, origin.current.tab === "Prontuário" ? origin.current.record : undefined);
  }, [userId, close, onShow]);

  const next = useCallback(() => {
    if (last) finish();
    else advance();
  }, [last, finish, advance]);

  // Mostra a aba do passo por trás do overlay; passos sem aba (abertura, cabeçalho, fim) voltam à aba de origem.
  const stepKey = visible ? step?.key : undefined;
  const showRef = useRef(onShow);
  useEffect(() => {
    showRef.current = onShow;
  });
  useEffect(() => {
    if (!stepKey) return;
    const current = PATIENT_TOUR_STEPS.find((item) => item.key === stepKey);
    if (!current) return;
    if (current.tab) showRef.current(current.tab, current.recordTab);
    else showRef.current(origin.current.tab, origin.current.tab === "Prontuário" ? origin.current.record : undefined);
  }, [stepKey]);

  if (!visible || !step) return null;
  const selector = patientTourSelector(PATIENT_TOUR_STEPS.find((item) => item.key === step.key));
  return <TourOverlay steps={steps} index={index} dir={dir} selector={selector} placement="stack" revealTarget waitForTarget onNext={next} onBack={back} onFinish={finish} />;
}
