"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SETUP_STEPS, isSetupStepKey, type SetupDecision, type SetupDestination, type SetupStepKey } from "@/lib/setup-rules";
import { setupInviteEvent, setupOpenEvent } from "@/lib/section-events";
import { useCanUseSetup } from "./current-user";
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

  const current = data?.steps.find((step) => step.key === stepKey);
  const stepNumber = SETUP_STEPS.findIndex((step) => step.key === stepKey) + 1;

  return (
    <>
      <Modal open={view === "invite"} title="Agora vamos configurar sua clínica?" description="Em poucos passos guiados você deixa a clínica pronta para receber pacientes." mascot="cheer" panelClassName="max-w-md" closeOnOverlayClick={false} onClose={() => { void dismissInvite(); }}>
        <p className="text-sm leading-6 text-muted-foreground">Vamos cadastrar os dados da clínica, a equipe e os procedimentos. Você pode sair e continuar depois quando quiser.</p>
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

      {bar && view === "closed" && data ? (
        <div className="fixed bottom-[calc(12rem+env(safe-area-inset-bottom))] left-1/2 z-[80] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 lg:bottom-6 lg:left-[calc(220px+2rem)] lg:translate-x-0" role="region" aria-label="Configuração da clínica">
          <div className="flex items-center gap-3 rounded-[10px] border border-primary/30 bg-card px-3 py-2.5 text-card-foreground shadow-[0_18px_45px_rgba(31,32,50,0.22)]">
            {current?.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-label="Requisito desta etapa cumprido" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-label="Requisito desta etapa pendente" />}
            <p className="min-w-0 flex-1 text-xs font-bold leading-tight">Configuração da clínica · Etapa {stepNumber} de {data.total}<span className="block truncate font-medium text-muted-foreground">{current?.done ? "Etapa concluída. Pode voltar ao assistente." : SETUP_STEPS[stepNumber - 1]?.title}</span></p>
            <Button size="sm" onClick={() => { void backToWizard(); }}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Voltar ao assistente</Button>
            <Button size="icon" variant="ghost" aria-label="Fechar a barra de configuração" onClick={() => setBar(false)}><X className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
