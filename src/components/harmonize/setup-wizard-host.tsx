"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SETUP_STEPS, confirmsOnSave, isSetupStepKey, setupSpotlightPlan, type SetupDecision, type SetupDestination, type SetupStepKey } from "@/lib/setup-rules";
import { CLIENT_CACHE_INVALIDATED_EVENT } from "@/lib/client-cache";
import { setupInviteEvent, setupOpenEvent } from "@/lib/section-events";
import { useCanUseSetup } from "./current-user";
import { SetupSpotlight } from "./setup-spotlight";
import { SetupSuccess, SetupWizard } from "./setup-wizard";
import { useClinicSetup, type SetupAction, type SetupPayload } from "./use-clinic-setup";

type View = "closed" | "invite" | "wizard" | "success";

type Props = {
  /** Leva à tela real da etapa (seção ou subseção de Configurações). */
  onOpenDestination: (destination: SetupDestination) => void | Promise<void>;
  onDashboard: () => void;
};

function startingStep(data: SetupPayload): SetupStepKey {
  if (isSetupStepKey(data.currentStep)) return data.currentStep;
  return data.nextPendingKey ?? "clinica";
}

/**
 * Convite pós-tour, assistente em tela cheia e barra fixa de retorno. O estado vem do servidor (useClinicSetup); aqui só
 * se decide o que está na tela. Revalida ao voltar o foco e quando o cache é invalidado por outra tela, sem polling.
 */
export function SetupWizardHost({ onOpenDestination, onDashboard }: Props) {
  const enabled = useCanUseSetup();
  const [view, setView] = useState<View>("closed");
  const [bar, setBar] = useState(false);
  const [stepKey, setStepKey] = useState<SetupStepKey>("clinica");
  // Cada ida a uma tela pelo assistente reinicia o destaque (escurecimento + balão) no alvo da etapa.
  const [spotlightRun, setSpotlightRun] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data, refresh, send } = useClinicSetup(enabled, view !== "closed" || bar);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });

  const run = useCallback(async (body: SetupAction) => {
    setBusy(true);
    setError("");
    try {
      return await send(body);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível salvar a configuração.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [send]);

  const openWizard = useCallback(async () => {
    const current = await refresh();
    if (!current) return;
    // Administrador que ainda não começou (ou adiou) entra no andamento; concluído só consulta, sem reabrir.
    const next = current.status === "completed" ? current : await run({ action: "start" }) ?? current;
    setStepKey(startingStep(next));
    setBar(false);
    setView("wizard");
  }, [refresh, run]);

  // Fim do tour: convida se o administrador ainda não decidiu.
  useEffect(() => {
    if (!enabled) return;
    const invite = async () => {
      const current = await refresh();
      if (current?.status === "pending") setView("invite");
    };
    const open = () => { void openWizard(); };
    window.addEventListener(setupInviteEvent, invite);
    window.addEventListener(setupOpenEvent, open);
    return () => {
      window.removeEventListener(setupInviteEvent, invite);
      window.removeEventListener(setupOpenEvent, open);
    };
  }, [enabled, refresh, openWizard]);

  // Enquanto a barra de retorno está visível, reserva espaço no fim da página para ela não cobrir campos.
  useEffect(() => {
    if (!bar || view !== "closed") return;
    const main = document.querySelector<HTMLElement>("main");
    const previous = main?.style.paddingBottom ?? "";
    if (main) main.style.paddingBottom = "calc(6rem + env(safe-area-inset-bottom))";
    return () => { if (main) main.style.paddingBottom = previous; };
  }, [bar, view]);

  const current = data?.steps.find((step) => step.key === stepKey);
  const stepDone = current?.done ?? false;

  // Etapa que a pessoa estava preenchendo numa tela e que o servidor passou a dar como concluída: volta ao assistente
  // (o mesmo caminho de "Voltar ao assistente"). Só com a barra de retorno ativa, então quem saiu do fluxo não é puxado
  // de volta, e abrir já com a etapa concluída não conta como transição. Ajuste de estado durante o render (sem efeito).
  const [watched, setWatched] = useState({ step: stepKey, done: stepDone });
  if (watched.step !== stepKey) {
    setWatched({ step: stepKey, done: stepDone });
  } else if (watched.done !== stepDone) {
    setWatched({ step: stepKey, done: stepDone });
    if (stepDone && bar && view === "closed") {
      setBar(false);
      setView("wizard");
    }
  }

  // Etapas de "conferir e confirmar" (agenda, custos, notificações): salvar com sucesso na tela de destino registra a
  // confirmação no servidor, que reavalia as regras reais (ex.: horários válidos). Concluída, o assistente volta pela
  // transição acima; se continuar pendente, volta mesmo assim para mostrar o motivo. Só com a barra de retorno ativa:
  // quem saiu do fluxo não é puxado de volta e salvamentos fora do fluxo não confirmam nada.
  const [actedRun, setActedRun] = useState(0);
  const confirmedRun = useRef(0);
  useEffect(() => {
    if (!enabled || !confirmsOnSave(stepKey)) return;
    const onSaved = (event: Event) => {
      const keys = (event as CustomEvent<string[] | undefined>).detail;
      if (!Array.isArray(keys) || !keys.some((key) => key.startsWith("/api/clinic/"))) return;
      if (!bar || view !== "closed" || confirmedRun.current === spotlightRun) return;
      confirmedRun.current = spotlightRun;
      setActedRun(spotlightRun);
      void run({ action: "decide", step: stepKey, decision: "confirmed" }).then((result) => {
        if (result && !result.steps.find((step) => step.key === stepKey)?.done) {
          setBar(false);
          setView("wizard");
        }
      });
    };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, onSaved);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, onSaved);
  }, [enabled, stepKey, spotlightRun, bar, view, run]);

  if (!enabled) return null;

  async function selectStep(key: SetupStepKey) {
    setStepKey(key);
    setError("");
    await run({ action: "goto", step: key });
  }

  async function goToScreen(destination: SetupDestination) {
    await run({ action: "goto", step: stepKey });
    setView("closed");
    setBar(dataRef.current?.status !== "completed");
    setSpotlightRun((run) => run + 1);
    await onOpenDestination(destination);
  }

  async function decide(key: SetupStepKey, decision: SetupDecision) {
    await run({ action: "decide", step: key, decision });
  }

  async function finish() {
    const result = await run({ action: "finish" });
    if (result?.status === "completed") setView("success");
  }

  async function dismissInvite() {
    setView("closed");
    await run({ action: "dismiss" });
  }

  async function startFromInvite() {
    setView("closed");
    await openWizard();
  }

  async function backToWizard() {
    setBar(false);
    setView("wizard");
    await refresh();
  }

  const plan = data ? setupSpotlightPlan(stepKey) : null;
  const stepNumber = SETUP_STEPS.findIndex((step) => step.key === stepKey) + 1;

  return (
    <>
      <Modal open={view === "invite"} title="Agora vamos configurar sua clínica?" description="Em poucos passos guiados você deixa a clínica pronta para receber pacientes." mascot="cheer" panelClassName="max-w-md" closeOnOverlayClick={false} onClose={() => { void dismissInvite(); }}>
        <p className="text-sm leading-6 text-muted-foreground">Seu Harmonize+ está quase pronto! Vamos configurar sua clínica juntos. Vou te orientar em cada etapa para deixar tudo organizado e preparado para começar a atender seus pacientes.</p>
        {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => { void dismissInvite(); }}>Fazer isso depois</Button>
          <Button disabled={busy} onClick={() => { void startFromInvite(); }}>Vamos começar</Button>
        </div>
      </Modal>

      {view === "wizard" && data ? (
        <SetupWizard
          data={data}
          stepKey={stepKey}
          busy={busy}
          error={error}
          onSelectStep={(key) => { void selectStep(key); }}
          onAction={(destination) => { void goToScreen(destination); }}
          onDecide={(key, decision) => { void decide(key, decision); }}
          onUndo={(key) => { void run({ action: "undo", step: key }); }}
          onFinish={() => { void finish(); }}
          onExit={() => setView("closed")}
        />
      ) : null}

      {view === "success" ? <SetupSuccess onDashboard={() => { setView("closed"); onDashboard(); }} /> : null}

      {bar && view === "closed" && spotlightRun > 0 && plan?.items?.length && current && !current.done && actedRun !== spotlightRun ? <SetupSpotlight key={`${stepKey}-${spotlightRun}`} items={plan.items} /> : null}

      {bar && view === "closed" && data ? (
        <div className="fixed bottom-[calc(12rem+env(safe-area-inset-bottom))] left-1/2 z-[88] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 lg:bottom-6 lg:left-[calc(220px+2rem)] lg:translate-x-0" data-setup-bar role="region" aria-label="Configuração da clínica">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-primary/30 bg-card px-3 py-2.5 text-card-foreground shadow-[0_18px_45px_rgba(31,32,50,0.22)]">
            {current?.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-label="Requisito desta etapa cumprido" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-label="Requisito desta etapa pendente" />}
            <p className="min-w-0 flex-1 truncate text-xs font-bold lg:hidden">Etapa {stepNumber} de {data.total} · {SETUP_STEPS[stepNumber - 1]?.title}</p>
            <p className="min-w-0 flex-1 text-xs font-bold leading-tight max-lg:hidden">Configuração da clínica · Etapa {stepNumber} de {data.total}<span className="block truncate font-medium text-muted-foreground">{current?.done ? "Etapa concluída. Pode voltar ao assistente." : SETUP_STEPS[stepNumber - 1]?.title}</span></p>
            <Button size="sm" className="max-lg:order-last max-lg:w-full" onClick={() => { void backToWizard(); }}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Voltar ao assistente</Button>
            <Button size="icon" variant="ghost" className="max-lg:order-2" aria-label="Fechar a barra de configuração" onClick={() => setBar(false)}><X className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
