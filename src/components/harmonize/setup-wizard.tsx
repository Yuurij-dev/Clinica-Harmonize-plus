"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Info, LogOut, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { expenseCategories } from "@/lib/finance-rules";
import { SETUP_STEPS, type SetupDestination, type SetupDecision, type SetupStepDefinition, type SetupStepKey, type SetupStepState } from "@/lib/setup-rules";
import { GuideMascot } from "./illustrations/guide-mascot";
import { paymentMethods } from "./finance-shared";
import { useBodyScrollLock } from "./use-body-scroll-lock";
import type { SetupPayload, SetupSummary } from "./use-clinic-setup";

/** Marca da etapa: círculo vazio ou check verde. Ao virar concluída (`pop`), o círculo dá um pop e o check se desenha. */
function StepIcon({ done, pop = false }: { done: boolean; pop?: boolean }) {
  if (!done) return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Pendente" />;
  return (
    <svg className={cn("h-4 w-4 shrink-0 text-success", pop && "hp-sw-pop")} viewBox="0 0 16 16" role="img" aria-label="Concluída">
      <circle cx="8" cy="8" r="7.25" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
      <g className={pop ? "hp-sw-check" : undefined}><path d="M4.8 8.2l2.2 2.2 4.2-4.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></g>
    </svg>
  );
}

function Circle({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return <svg className={className} viewBox="0 0 16 16" role="img" {...props}><circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

// Confete leve da tela de sucesso: posições fixas (sem aleatório no render), só transform/opacity.
const CONFETTI = Array.from({ length: 18 }, (_, i) => ({
  dx: (i - 8.5) * 22,
  dy: 120 + (i % 5) * 34,
  rot: (i % 2 ? 1 : -1) * (160 + i * 23),
  color: ["#5147dc", "#7b6ff2", "#f5b942", "#3ecf8e", "#ef6f9b"][i % 5],
}));

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Situação atual da etapa, montada só com o que o servidor devolveu. */
function stepStatus(key: SetupStepKey, state: SetupStepState, summary: SetupSummary): { text: string; ok: boolean } {
  const decided = state.confirmed ? "confirmada por você" : state.skipped ? "marcada como não utilizada" : null;
  switch (key) {
    case "clinica": {
      const missing = [!summary.clinicFields.name && "nome", !summary.clinicFields.phone && "telefone", !summary.clinicFields.address && "endereço"].filter(Boolean);
      return missing.length ? { text: `Faltam: ${missing.join(", ")}.`, ok: false } : { text: `${summary.clinicName}: nome, telefone e endereço preenchidos.`, ok: true };
    }
    case "equipe":
      if (summary.professionals > 0) return { text: `${plural(summary.professionals, "profissional cadastrado", "profissionais cadastrados")}.`, ok: true };
      return state.confirmed ? { text: "Você confirmou que realiza os atendimentos por enquanto.", ok: true } : { text: "Nenhum profissional cadastrado.", ok: false };
    case "agenda": {
      const { hours } = summary;
      const text = `Clínica ${hours.opening}–${hours.closing}; profissionais ${hours.professionalOpening}–${hours.professionalClosing}.`;
      if (state.done) return { text: `${text} Confirmado por você.`, ok: true };
      return state.confirmed ? { text: `${text} Os horários estão inválidos: a abertura deve ser antes do fechamento. Corrija em Dados da clínica.`, ok: false } : { text: `${text} Falta a sua confirmação.`, ok: false };
    }
    case "procedimentos":
      return summary.procedures > 0 ? { text: `${plural(summary.procedures, "procedimento cadastrado", "procedimentos cadastrados")}.`, ok: true } : { text: "Nenhum procedimento cadastrado.", ok: false };
    case "materiais":
      return summary.materials > 0 ? { text: `${plural(summary.materials, "material cadastrado", "materiais cadastrados")}.`, ok: true } : { text: decided ? `Etapa ${decided}.` : "Nenhum material cadastrado.", ok: state.done };
    case "produtos":
      return summary.products > 0 ? { text: `${plural(summary.products, "produto cadastrado", "produtos cadastrados")}.`, ok: true } : { text: decided ? `Etapa ${decided}.` : "Nenhum produto cadastrado.", ok: state.done };
    case "financeiro":
      return summary.recurringExpenses > 0 ? { text: `${plural(summary.recurringExpenses, "custo fixo cadastrado", "custos fixos cadastrados")}.`, ok: true } : { text: decided ? `Etapa ${decided}.` : "Nenhum custo fixo cadastrado.", ok: state.done };
    case "custos":
    case "notificacoes":
      return { text: decided ? `Etapa ${decided}.` : "Ainda não revisado.", ok: state.done };
    case "revisao":
      return { text: "", ok: state.done };
  }
}

function StepExtras({ stepKey, summary }: { stepKey: SetupStepKey; summary: SetupSummary }) {
  if (stepKey === "financeiro") {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
        <p className="flex items-center gap-1.5 font-semibold text-foreground"><Info className="h-3.5 w-3.5 text-primary" aria-hidden="true" />Já vem pronto no sistema</p>
        <p className="mt-1"><span className="font-semibold text-foreground">Formas de pagamento:</span> {paymentMethods.join(", ")}.</p>
        <p className="mt-1"><span className="font-semibold text-foreground">Categorias de despesa:</span> {expenseCategories.join(", ")}.</p>
        <p className="mt-1">Não há o que configurar nelas por enquanto.</p>
      </div>
    );
  }
  if (stepKey === "notificacoes") {
    const { alerts } = summary;
    const onOff = (value: boolean) => (value ? "ligado" : "desligado");
    return (
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
        <ul className="space-y-0.5">
          <li><span className="font-semibold text-foreground">Alertas de agendamento:</span> {onOff(alerts.appointments)}</li>
          <li><span className="font-semibold text-foreground">Som de notificação:</span> {onOff(alerts.sound)}</li>
          <li><span className="font-semibold text-foreground">Alertas de estoque:</span> {onOff(alerts.stock)}</li>
          <li><span className="font-semibold text-foreground">Aviso de validade:</span> {plural(alerts.expiryWarningDays, "dia", "dias")} antes do vencimento</li>
        </ul>
        <p className="flex items-center gap-1.5"><Info className="h-3.5 w-3.5 text-primary" aria-hidden="true" />Integrações externas (como WhatsApp) ainda não estão disponíveis.</p>
      </div>
    );
  }
  return null;
}

function Badge({ required }: { required: boolean }) {
  return <span className={cn("hp-sw-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", required ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{required ? "Obrigatória" : "Opcional"}</span>;
}

type WizardProps = {
  data: SetupPayload;
  stepKey: SetupStepKey;
  busy: boolean;
  error: string;
  onSelectStep: (key: SetupStepKey) => void;
  onAction: (destination: SetupDestination) => void;
  onDecide: (key: SetupStepKey, decision: SetupDecision) => void;
  onUndo: (key: SetupStepKey) => void;
  onFinish: () => void;
  onExit: () => void;
};

/** Assistente em tela cheia. Quem decide se uma etapa está concluída é o servidor (`data.steps`); a tela só reflete. */
export function SetupWizard({ data, stepKey, busy, error, onSelectStep, onAction, onDecide, onUndo, onFinish, onExit }: WizardProps) {
  useBodyScrollLock(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // A etapa exibida troca depois de uma saída curta (fade); a direção vem da posição de origem e destino.
  const [shown, setShown] = useState(stepKey);
  const [dir, setDir] = useState<"next" | "back">("next");
  // Marcas que viram concluídas com o assistente aberto fazem o pop; as já concluídas na abertura aparecem prontas.
  const doneKeys = data.steps.filter((step) => step.done).map((step) => step.key).join(",");
  const [doneSeen, setDoneSeen] = useState({ keys: doneKeys, popped: "" });
  if (doneSeen.keys !== doneKeys) {
    const before = new Set(doneSeen.keys.split(","));
    setDoneSeen({ keys: doneKeys, popped: doneKeys.split(",").filter((key) => key && !before.has(key)).join(",") });
  }
  const poppedKeys = doneSeen.popped.split(",");
  const leaving = shown !== stepKey;
  const listRef = useRef<HTMLOListElement>(null);
  const indicatorRef = useRef<HTMLLIElement>(null);
  const indicatorPlaced = useRef(false);
  useEffect(() => {
    if (shown === stepKey) return;
    const timer = window.setTimeout(() => {
      setDir(SETUP_STEPS.findIndex((step) => step.key === stepKey) >= SETUP_STEPS.findIndex((step) => step.key === shown) ? "next" : "back");
      setShown(stepKey);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [stepKey, shown]);
  // O destaque da etapa atual desliza até o botão dela (transform), sem trocar seco.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const place = () => {
      const button = list.querySelector<HTMLElement>('[aria-current="step"]');
      const indicator = indicatorRef.current;
      if (!button || !indicator) return;
      const first = !indicatorPlaced.current;
      if (first) indicator.style.transition = "none";
      // O <li> é o elemento posicionado: a posição na lista é a do <li> (offsetLeft/Top relativos ao <ol>) mais a do botão nele.
      const item = button.closest<HTMLElement>("li") ?? button;
      indicator.style.transform = `translate(${item.offsetLeft + button.offsetLeft}px, ${item.offsetTop + button.offsetTop}px)`;
      indicator.style.width = `${button.offsetWidth}px`;
      indicator.style.height = `${button.offsetHeight}px`;
      indicator.style.opacity = "1";
      if (first) {
        void indicator.offsetWidth;
        indicator.style.transition = "";
        indicatorPlaced.current = true;
      }
    };
    place();
    const frame = requestAnimationFrame(place); // de novo depois do layout final (fontes, scroll da lista)
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [stepKey, shown]);
  const [skipAskedFor, setSkipAskedFor] = useState<SetupStepKey | null>(null);
  const confirmingSkip = skipAskedFor === shown;
  const setConfirmingSkip = (asking: boolean) => setSkipAskedFor(asking ? shown : null);
  const index = Math.max(0, SETUP_STEPS.findIndex((step) => step.key === shown));
  const definition: SetupStepDefinition = SETUP_STEPS[index];
  const state = data.steps[index];
  const completed = data.status === "completed";
  const isReview = definition.key === "revisao";
  const reachable = (position: number) => data.steps.slice(0, position).every((step) => !step.required || step.done);
  const nextKey = SETUP_STEPS[index + 1]?.key;
  const prevKey = SETUP_STEPS[index - 1]?.key;
  const blocked = definition.required && !state.done;
  const status = stepStatus(definition.key, state, data.summary);
  const decided = state.confirmed || state.skipped;
  const showConfirm = Boolean(definition.confirmLabel) && !state.done;
  const showSkip = Boolean(definition.skipLabel) && !state.done;

  // Devolve o foco a quem abriu o assistente quando ele fecha.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [shown]);

  // Esc sai (exceto durante uma gravação); Tab fica dentro do assistente.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!busy) onExit();
        return;
      }
      if (event.key !== "Tab" || !rootRef.current) return;
      const focusable = [...rootRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!rootRef.current.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && (active === first || active === headingRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onExit]);

  return (
    <div ref={rootRef} className="hp-sw-root fixed inset-0 z-[950] flex flex-col overflow-y-auto bg-background text-foreground" role="dialog" aria-modal="true" aria-labelledby="setup-wizard-title">
      <header className="border-b border-primary/20 bg-gradient-to-r from-[#5147dc] to-[#7b6ff2] px-4 py-4 text-white sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
          <div className="hp-sw-float shrink-0" aria-hidden="true"><div key={definition.key} className="hp-sw-fade"><GuideMascot pose={definition.pose} size={72} /></div></div>
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/75">{completed ? "Assistente de configuração · concluído" : "Configuração da clínica"}</p>
            <p id="setup-wizard-title" className="mt-0.5 text-base font-bold leading-snug sm:text-lg">{definition.harmo}</p>
          </div>
          <div className="w-full basis-64 sm:w-auto sm:min-w-64">
            <div className="flex items-baseline justify-between text-xs font-semibold"><span><CountUp value={data.doneCount} from={data.doneCount} duration={400} /> de {data.total} etapas concluídas</span><span><CountUp value={data.percent} from={data.percent} duration={400} format={(value) => `${Math.round(value)}%`} /></span></div>
            <div className="mt-1.5"><Progress value={data.percent} className="h-2 bg-white/25" indicatorClassName="bg-white" aria-label="Progresso da configuração" /></div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={onExit}><LogOut className="h-4 w-4" aria-hidden="true" />{completed ? "Fechar" : "Sair e continuar depois"}</Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-5 sm:px-8 lg:flex-row lg:gap-8 lg:py-8">
        <nav aria-label="Etapas da configuração" className="lg:w-72 lg:shrink-0">
          <ol ref={listRef} className="relative flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            <li ref={indicatorRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 rounded-lg border border-primary bg-primary/10 opacity-0 transition-[transform,width,height] duration-300 ease-out motion-reduce:transition-none" />
            {SETUP_STEPS.map((step, position) => {
              const item = data.steps[position];
              const current = step.key === stepKey;
              const open = reachable(position);
              return (
                <li key={step.key} className="hp-sw-list-in relative shrink-0 lg:shrink" style={{ "--i": position } as React.CSSProperties}>
                  <button
                    type="button"
                    disabled={!open || busy}
                    aria-current={current ? "step" : undefined}
                    onClick={() => onSelectStep(step.key)}
                    className={cn("flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors motion-reduce:transition-none max-lg:min-h-11", current ? "border-transparent font-bold text-foreground" : "border-transparent hover:bg-muted", !open && "cursor-not-allowed opacity-50")}
                  >
                    <StepIcon done={item.done} pop={poppedKeys.includes(step.key)} />
                    <span className="min-w-0 flex-1 break-words leading-tight">{position + 1}. {step.title}</span>
                    {step.key !== "revisao" ? <span className="max-lg:hidden"><Badge required={step.required} /></span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="min-w-0 flex-1">
          <section key={shown} className={cn("rounded-xl border border-border bg-card p-5 shadow-sm transition-opacity duration-100 motion-reduce:transition-none sm:p-7", leaving ? "opacity-0" : dir === "back" ? "hp-sw-in-back" : "hp-sw-in-next")}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold uppercase text-muted-foreground">Etapa {index + 1} de {data.total}</p>
              {!isReview ? <Badge required={definition.required} /> : null}
            </div>
            <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-bold outline-none sm:text-2xl">{definition.title}</h2>

            {isReview ? (
              <ReviewBody data={data} completed={completed} onSelectStep={onSelectStep} />
            ) : (
              <div className="mt-4 space-y-4 text-sm leading-6">
                <p><span className="font-bold">O que é: </span>{definition.what}</p>
                <p><span className="font-bold">Por que importa: </span>{definition.why}</p>
                <p><span className="font-bold">O que fazer: </span>{definition.todo}</p>
                <p className="text-muted-foreground"><span className="font-bold">Exemplo: </span>{definition.example}</p>
                <StepExtras stepKey={definition.key} summary={data.summary} />
                <div key={String(status.ok)} role="status" className={cn("hp-sw-fade flex items-start gap-2 rounded-lg border px-3 py-2.5", status.ok ? "border-success/30 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-foreground")}>
                  {status.ok ? <Check className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" /> : <Info className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />}
                  <div>
                    <p className="font-semibold">{status.text}</p>
                    <p className="text-xs">{state.skipped ? "Tudo bem! Você pode configurar isso depois, quando quiser." : status.ok ? definition.doneMessage : definition.missingHint}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {definition.destination ? <Button onClick={() => onAction(definition.destination!)} disabled={busy}>{definition.actionLabel ?? "Abrir"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button> : null}
                  {showConfirm ? <Button variant="outline" disabled={busy} onClick={() => onDecide(definition.key, "confirmed")}><Check className="h-4 w-4" aria-hidden="true" />{definition.confirmLabel}</Button> : null}
                  {showSkip && !confirmingSkip ? <Button variant="ghost" disabled={busy} onClick={() => setConfirmingSkip(true)}>{definition.skipLabel}</Button> : null}
                  {decided ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUndo(definition.key)}><Undo2 className="h-4 w-4" aria-hidden="true" />Desfazer</Button> : null}
                </div>
                {showSkip && confirmingSkip ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5" role="alert">
                    <p className="flex-1 basis-56 text-xs font-medium">Tem certeza? Você poderá voltar e configurar quando quiser.</p>
                    <Button size="sm" disabled={busy} onClick={() => { setConfirmingSkip(false); onDecide(definition.key, "skipped"); }}>Sim, pular esta etapa</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingSkip(false)}>Cancelar</Button>
                  </div>
                ) : null}
              </div>
            )}

            {error ? <p className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <Button variant="ghost" disabled={!prevKey || busy} onClick={() => prevKey && onSelectStep(prevKey)}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Voltar</Button>
              <div className="flex flex-wrap items-center justify-end gap-3">
                {blocked ? <p className="text-xs text-muted-foreground">Conclua esta etapa para continuar.</p> : null}
                {isReview ? (
                  completed ? <Button onClick={onExit}>Fechar</Button> : <Button disabled={!data.canFinish || busy} onClick={onFinish}>Finalizar configuração<Check className="h-4 w-4" aria-hidden="true" /></Button>
                ) : (
                  <Button className="hp-sw-continue" disabled={blocked || busy || !nextKey} onClick={() => nextKey && onSelectStep(nextKey)}>Continuar<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function ReviewBody({ data, completed, onSelectStep }: { data: SetupPayload; completed: boolean; onSelectStep: (key: SetupStepKey) => void }) {
  const pendingRequired = data.steps.filter((step) => step.required && !step.done);
  const pendingOptional = data.steps.filter((step) => !step.required && step.key !== "revisao" && !step.done);
  return (
    <div className="mt-4 space-y-4 text-sm leading-6">
      <p>{SETUP_STEPS[SETUP_STEPS.length - 1].what}</p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {data.steps.filter((step) => step.key !== "revisao").map((step) => {
          const status = stepStatus(step.key, step, data.summary);
          return (
            <li key={step.key} className="flex items-center gap-3 px-3 py-2">
              <StepIcon done={step.done} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{step.title} <span className="ml-1 align-middle"><Badge required={step.required} /></span></p>
                <p className="break-words text-xs text-muted-foreground">{status.text}</p>
              </div>
              {!step.done ? <Button size="sm" variant="ghost" onClick={() => onSelectStep(step.key)}>Ir para a etapa</Button> : null}
            </li>
          );
        })}
      </ul>
      {pendingRequired.length ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 font-medium" role="status">Faltam etapas obrigatórias: {pendingRequired.map((step) => step.title).join(", ")}. Elas precisam estar concluídas para finalizar.</p>
      ) : completed ? (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 font-medium text-success" role="status">Configuração concluída. Você pode voltar a qualquer etapa quando quiser.</p>
      ) : (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 font-medium text-success" role="status">
          Tudo o que é obrigatório está pronto.{pendingOptional.length ? ` As etapas opcionais pendentes (${pendingOptional.map((step) => step.title).join(", ")}) podem ser feitas depois.` : ""}
        </p>
      )}
    </div>
  );
}

/** Tela de sucesso depois de "Finalizar configuração". */
export function SetupSuccess({ onDashboard }: { onDashboard: () => void }) {
  useBodyScrollLock(true);
  return (
    <div className="fixed inset-0 z-[950] grid place-items-center overflow-y-auto bg-background px-4 py-8 text-foreground" role="dialog" aria-modal="true" aria-labelledby="setup-success-title">
      <div className="hp-sw-root hp-sw-fade relative w-full max-w-lg overflow-hidden rounded-2xl border border-primary/20 bg-card p-8 text-center shadow-lg">
        <div className="pointer-events-none absolute left-1/2 top-24" aria-hidden="true">
          {CONFETTI.map((piece, i) => <span key={i} className="hp-sw-confetti absolute block h-2 w-1.5 rounded-sm" style={{ "--i": i, "--dx": `${piece.dx}px`, "--dy": `${piece.dy}px`, "--rot": `${piece.rot}deg`, backgroundColor: piece.color } as React.CSSProperties} />)}
        </div>
        <div className="hp-sw-rise mx-auto w-fit" style={{ "--i": 0 } as React.CSSProperties} aria-hidden="true"><GuideMascot pose="cheer" size={140} /></div>
        <h2 id="setup-success-title" className="hp-sw-rise mt-4 text-2xl font-bold" style={{ "--i": 1 } as React.CSSProperties}>Sua clínica está pronta para começar!</h2>
        <p className="hp-sw-rise mt-2 text-sm text-muted-foreground" style={{ "--i": 2 } as React.CSSProperties}>A configuração inicial foi concluída. Você pode rever as etapas quando quiser em Configurações.</p>
        <Button className="hp-sw-rise mt-6" style={{ "--i": 3 } as React.CSSProperties} size="lg" autoFocus onClick={onDashboard}>Ir para o Dashboard<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
    </div>
  );
}
