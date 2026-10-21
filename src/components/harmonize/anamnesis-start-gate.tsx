"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, ClipboardList, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { importantAlerts, startGateDecision } from "@/lib/anamnesis-rules";
import { invalidateClientCache } from "@/lib/client-cache";
import { useCan } from "./current-user";
import { ClinicalAlertList, alertsDisclaimer } from "./patient-anamnesis";
import { anamnesisKey, anamnesisVersionKey, formatDate, formatTime, type AnamnesisOverview } from "./patient-clinical-data";

export type AnamnesisOpenMode = "view" | "fill" | "new-version";

export const initialEvaluationLabel = "Continuar para avaliação inicial";

type GateSession = { proceed: () => void; patientId: string; skipLabel: string; phase: "checking" | "missing" | "draft" | "review" | "error"; overview: Extract<AnamnesisOverview, { restricted: false }> | null };

// Aparece só se a verificação demorar, para não piscar um aviso em consultas rápidas.
function SlowCheckNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 400);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <div role="status" className="fixed bottom-4 left-1/2 z-[1100] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium shadow-lg"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />Verificando anamnese...</div>;
}

// Gate único de "Iniciar atendimento". Pontos que o usam: cabeçalho e menu da ficha, abas Resumo e Atendimentos, "Novo tratamento",
// "Iniciar atendimento" de agendamento na ficha (aba Agendamentos), no painel Procedimentos e "Atender" na Agenda.
// O paciente vem de `patientId` do hook (ficha) ou da chamada (Agenda). A consulta é sempre direta (sem cache): é uma checagem
// clínica e o estado pode ter mudado em outra aba. Nenhum caminho bloqueia o atendimento de quem nunca teve anamnese.
export function useAnamnesisStartGate({ patientId: defaultPatientId, onOpenAnamnesis }: { patientId?: string; onOpenAnamnesis: (mode: AnamnesisOpenMode, patientId: string) => void }) {
  const canRead = useCan("anamnesis:read");
  const [session, setSession] = useState<GateSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const requestId = useRef(0);

  const close = useCallback(() => { requestId.current += 1; setSession(null); setBusy(false); setReviewError(""); }, []);

  const check = useCallback((proceed: () => void, patientId: string, skipLabel: string) => {
    const id = ++requestId.current;
    setSession({ proceed, patientId, skipLabel, phase: "checking", overview: null });
    fetch(anamnesisKey(patientId), { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("gate"); return response.json() as Promise<AnamnesisOverview>; })
      .then((overview) => {
        if (id !== requestId.current) return;
        if (overview.restricted) { setSession(null); proceed(); return; }
        const decision = startGateDecision(overview.state);
        if (decision === "proceed") {
          setSession(null);
          const important = importantAlerts(overview.alerts);
          if (important.length) toast.info(`Alertas importantes na anamnese: ${important.slice(0, 3).map((alert) => alert.label).join(", ")}${important.length > 3 ? "…" : ""}`, { action: { label: "Ver alertas", onClick: () => onOpenAnamnesis("view", patientId) } });
          proceed();
          return;
        }
        setSession({ proceed, patientId, skipLabel, phase: decision, overview });
      })
      .catch(() => { if (id === requestId.current) setSession({ proceed, patientId, skipLabel, phase: "error", overview: null }); });
  }, [onOpenAnamnesis]);

  const requestStart = useCallback((proceed: () => void, options?: { patientId?: string; skipLabel?: string }) => {
    const patientId = options?.patientId ?? defaultPatientId;
    if (!canRead || !patientId) { proceed(); return; }
    check(proceed, patientId, options?.skipLabel ?? "Continuar atendimento");
  }, [canRead, check, defaultPatientId]);

  async function confirmReview() {
    const current = session?.overview?.current;
    if (!session || !current || busy) return;
    const patientId = session.patientId;
    setBusy(true);
    setReviewError("");
    try {
      const response = await fetch(`${anamnesisKey(patientId)}/${encodeURIComponent(current.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm-review" }) });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { message?: string } | null;
        setReviewError(data?.message ?? "Não foi possível registrar a revisão.");
        return;
      }
      invalidateClientCache(anamnesisKey(patientId), anamnesisVersionKey(patientId, current.id));
      toast.success("Revisão registrada: a anamnese continua válida.");
      const { proceed } = session;
      close();
      proceed();
    } catch {
      setReviewError("Não foi possível registrar a revisão. Verifique a conexão.");
    } finally {
      setBusy(false);
    }
  }

  const overview = session?.overview;
  const current = overview?.current;
  const phase = session?.phase;
  const goTo = (mode: AnamnesisOpenMode) => {
    const patientId = session?.patientId;
    close();
    if (!patientId) return;
    // O gate acabou de ler o estado atual: o cache do paciente é descartado para a tela de anamnese não abrir defasada.
    invalidateClientCache(anamnesisKey(patientId));
    onOpenAnamnesis(mode, patientId);
  };
  const skipToEvaluation = () => { const proceed = session?.proceed; close(); proceed?.(); };

  const gate: ReactNode = <>
    {phase === "checking" ? <SlowCheckNotice /> : null}
    <Modal open={phase === "missing"} title="Esta cliente ainda não tem anamnese" description="A anamnese não é obrigatória: você pode preencher agora ou seguir com o atendimento." onClose={close}>
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground"><ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Ela reúne queixa, histórico de saúde, alergias e medicamentos, e gera alertas informativos para a equipe.</p>
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={skipToEvaluation}>{session?.skipLabel}</Button><Button type="button" onClick={() => goTo("fill")}>Preencher anamnese</Button></div>
      </div>
    </Modal>
    <Modal open={phase === "draft"} title="Anamnese em rascunho" description={overview?.draft ? `A versão ${overview.draft.version} foi iniciada, mas ainda não foi concluída.` : undefined} onClose={close}>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={skipToEvaluation}>{session?.skipLabel}</Button><Button type="button" onClick={() => goTo("fill")}>Continuar anamnese</Button></div>
    </Modal>
    <Modal open={phase === "review"} title="Revisar a anamnese antes de atender" description="Confirme se a última anamnese continua válida ou registre as alterações. Nada é apagado: cada mudança gera uma nova versão." onClose={() => { if (!busy) close(); }}>
      {current ? <div className="space-y-4">
        <div className="rounded-md border border-border p-3 text-xs">
          <p className="font-semibold">Versão {current.version} · concluída em {formatDate(current.completedAt)} às {formatTime(current.completedAt)}</p>
          <p className="mt-0.5 text-muted-foreground">Por {current.completedBy ?? "profissional não informado"}.</p>
          {current.status === "PENDENTE_REVISAO" ? <p className="mt-2 rounded bg-warning/10 p-2 text-foreground">Marcada para revisão por {current.reviewRequestedBy} em {formatDate(current.reviewRequestedAt)}{current.reviewReason ? `: ${current.reviewReason}` : "."}</p> : <p className="mt-2 rounded bg-warning/10 p-2 text-foreground">A revisão desta anamnese está pendente.</p>}
        </div>
        <div className="space-y-2"><p className="text-xs font-semibold">Alertas registrados</p><ClinicalAlertList alerts={current.alerts} emptyText="Nenhum alerta gerado pelas respostas registradas." /><p className="text-xs text-muted-foreground">{alertsDisclaimer}</p></div>
        {reviewError ? <p role="alert" className="text-xs font-medium text-destructive">{reviewError}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>Cancelar</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => goTo("view")}>Ver anamnese completa</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => goTo("new-version")}>Registrar alterações (nova versão)</Button>
          <Button type="button" disabled={busy} onClick={() => void confirmReview()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}Confirmar que continua válida</Button>
        </div>
      </div> : null}
    </Modal>
    <Modal open={phase === "error"} title="Não foi possível verificar a anamnese" description="Você pode tentar novamente ou seguir sem a verificação." onClose={close}>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={close}>Cancelar</Button><Button type="button" variant="outline" onClick={skipToEvaluation}>Continuar sem verificar</Button><Button type="button" onClick={() => { if (session) check(session.proceed, session.patientId, session.skipLabel); }}>Tentar novamente</Button></div>
    </Modal>
  </>;

  return { requestStart, gate };
}
