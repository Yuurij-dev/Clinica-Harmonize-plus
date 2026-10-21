"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, ChevronDown, ClipboardList, Clock3, FileText, HeartPulse, Info, Loader2, Pencil, Pill, Plus, ShieldAlert, Stethoscope, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField, Modal, fieldClassName } from "@/components/ui/modal";
import { getCachedJson, invalidateClientCache } from "@/lib/client-cache";
import { allergyItems, answerLabel, autoStartAction, isFreshRequest, completionCheck, displayVersionStatus, healthItems, normalizeAnamnesisContent, staleDraftMessage, unansweredCount, type AnamnesisAlert, type AnamnesisContent, type AnamnesisRequest, type Answer, type TriState } from "@/lib/anamnesis-rules";
import { cn } from "@/lib/utils";
import { useCan } from "./current-user";
import { anamnesisKey, anamnesisVersionKey, formatDate, formatTime, useCachedResource, type AnamnesisOverview, type AnamnesisVersionFull, type AnamnesisVersionMeta } from "./patient-clinical-data";
import { EmptyState, LoadingSkeleton } from "./shared";
import { useDraftAutosave } from "./use-draft-autosave";

const jsonHeaders = { "Content-Type": "application/json" };

function invalidateAnamnesis(patientId: string, ...extra: string[]) {
  invalidateClientCache(anamnesisKey(patientId), ...extra);
}

async function readMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => null) as { message?: string } | null;
  return data?.message ?? fallback;
}

// --- Alertas (reaproveitado no Resumo clínico) ---

const alertStyles: Record<AnamnesisAlert["level"], { box: string; label: string; badge: "red" | "amber" | "slate" }> = {
  important: { box: "border-destructive/30 bg-destructive/5", label: "Importante", badge: "red" },
  attention: { box: "border-warning/30 bg-warning/5", label: "Atenção", badge: "amber" },
  info: { box: "border-border bg-muted/40", label: "Informativo", badge: "slate" },
};

export function ClinicalAlertList({ alerts, emptyText, onOpen }: { alerts: AnamnesisAlert[]; emptyText: string; onOpen?: () => void }) {
  if (!alerts.length) return <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">{emptyText}</p>;
  return <ul className="space-y-2">{alerts.map((alert) => {
    const style = alertStyles[alert.level];
    const body = <>
      <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", alert.level === "important" ? "text-destructive" : alert.level === "attention" ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-foreground">{alert.label}</span>{alert.detail ? <span className="mt-0.5 block text-xs text-muted-foreground">{alert.detail}</span> : null}</span>
      <Badge variant={style.badge}>{style.label}</Badge>
    </>;
    return <li key={alert.id}>{onOpen ? <button type="button" className={cn("flex w-full items-start gap-2 rounded-md border p-2.5 text-left transition hover:brightness-95", style.box)} onClick={onOpen}>{body}</button> : <div className={cn("flex items-start gap-2 rounded-md border p-2.5", style.box)}>{body}</div>}</li>;
  })}</ul>;
}

export const alertsDisclaimer = "Alertas informativos gerados a partir das respostas registradas. A avaliação clínica e a decisão são sempre do profissional.";

// --- Estrutura visual ---

function Section({ icon: Icon, title, hint, children }: { icon: typeof HeartPulse; title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return <Card className="overflow-hidden p-0">
    <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="text-sm font-bold text-foreground">{title}</span>{hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}</span>
      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
    {open ? <div className="border-t border-border p-4">{children}</div> : null}
  </Card>;
}

const triOptions: Array<{ value: TriState; label: string }> = [{ value: "yes", label: "Sim" }, { value: "no", label: "Não" }, { value: "not_informed", label: "Não informado" }];

function TriStateControl({ label, value, onChange, name }: { label: string; value: TriState | null; onChange: (value: TriState | null) => void; name: string }) {
  return <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap overflow-hidden rounded-md border border-input bg-background" data-name={name}>
    {triOptions.map((option) => {
      // Sem resposta (null) o botão "Não informado" aparece selecionado, mas nada é gravado até o usuário escolher.
      const selected = value === option.value || (value === null && option.value === "not_informed");
      return <button key={option.value} type="button" role="radio" aria-checked={selected} className={cn("border-r border-input px-2.5 py-1.5 text-xs font-medium transition last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected ? option.value === "yes" ? "bg-warning/15 text-warning" : option.value === "no" ? "bg-success/10 text-success" : "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60")} onClick={() => { if (value === null && option.value === "not_informed") return; onChange(selected ? null : option.value); }}>{option.label}</button>;
    })}
  </div>;
}

function AnswerRow({ label, answer, onChange, name }: { label: string; answer: Answer; onChange: (answer: Answer) => void; name: string }) {
  return <div className="space-y-1.5 rounded-md border border-border/70 p-2.5">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium text-foreground">{label}</span><TriStateControl name={name} label={label} value={answer.value} onChange={(value) => onChange({ ...answer, value })} /></div>
    {answer.value === "yes" ? <input className={cn(fieldClassName, "h-9 text-xs")} aria-label={`Detalhe: ${label}`} maxLength={200} placeholder="Detalhe (opcional)" value={answer.detail} onChange={(event) => onChange({ ...answer, detail: event.target.value })} /> : null}
  </div>;
}

function updateAnswers<K extends string>(items: Record<K, Answer>, key: K, answer: Answer) {
  return { ...items, [key]: answer } as Record<K, Answer>;
}

// --- Editor do rascunho (autosave) ---

function AnamnesisEditor({ patientId, draft, onClose }: { patientId: string; draft: AnamnesisVersionFull; onClose: (outcome: "left" | "completed" | "discarded" | "stale") => void }) {
  const [content, setContent] = useState<AnamnesisContent>(draft.content);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<"" | "complete" | "discard">("");
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  // Revisão (updatedAt) da última gravação conhecida; o servidor recusa (409) escrita sobre outra revisão.
  const revisionRef = useRef(draft.updatedAt);
  const savedOnce = useRef(false);

  async function handleFailure(response: Response, fallback: string) {
    const data = await response.json().catch(() => null) as { message?: string; code?: string } | null;
    // 404 no save = o rascunho sumiu (descartado em outra aba); tratado como conflito: trava e oferece recarregar.
    if ((response.status === 409 && data?.code === "stale") || response.status === 404) { setConflict(true); setFinished(true); setError(response.status === 404 ? "Este rascunho não existe mais (foi descartado ou concluído em outro lugar)." : data?.message ?? staleDraftMessage); return; }
    setError(data?.message ?? fallback);
  }

  const save = async () => {
    try {
      const response = await fetch(anamnesisKey(patientId), { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ draftId: draft.id, content, expectedUpdatedAt: revisionRef.current }) });
      if (!response.ok) { await handleFailure(response, "Não foi possível salvar o rascunho."); return false; }
      const saved = await response.json().catch(() => null) as { updatedAt?: string } | null;
      if (saved?.updatedAt) revisionRef.current = saved.updatedAt;
      savedOnce.current = true;
      setError("");
      return true;
    } catch {
      setError("Sem conexão. As alterações ainda não foram salvas.");
      return false;
    }
  };
  const autosave = useDraftAutosave({ scope: `${patientId}:anamnesis:${draft.id}`, revision, enabled: !finished, save });

  // O cache é invalidado ao sair (sem refazer a consulta a cada autosave); o editor sempre abre com dado buscado do servidor.
  useEffect(() => () => { invalidateAnamnesis(patientId); }, [patientId]);

  function change(update: (current: AnamnesisContent) => AnamnesisContent) {
    setContent((current) => update(current));
    setRevision((value) => value + 1);
  }

  async function complete() {
    setError("");
    const check = completionCheck(normalizeAnamnesisContent(content));
    if (!check.ok) { setError(check.errors[0]); return; }
    setBusy("complete");
    try {
      if (!await autosave.flush()) { setError((current) => current || "Não foi possível salvar o rascunho antes de concluir."); return; }
      const response = await fetch(`${anamnesisKey(patientId)}/${encodeURIComponent(draft.id)}`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ action: "complete", content, expectedUpdatedAt: revisionRef.current }) });
      if (!response.ok) { await handleFailure(response, "Não foi possível concluir a anamnese."); return; }
      setFinished(true);
      savedOnce.current = false;
      invalidateAnamnesis(patientId, anamnesisVersionKey(patientId, draft.id));
      toast.success(`Anamnese versão ${draft.version} concluída.`);
      onClose("completed");
    } catch {
      setError("Não foi possível concluir a anamnese. Verifique a conexão.");
    } finally {
      setBusy("");
    }
  }

  async function discard() {
    setBusy("discard");
    try {
      // Grava o que estiver pendente antes, para a revisão enviada ser a atual (o conteúdo será descartado de qualquer jeito).
      await autosave.flush();
      const response = await fetch(`${anamnesisKey(patientId)}?draftId=${encodeURIComponent(draft.id)}&expectedUpdatedAt=${encodeURIComponent(revisionRef.current)}`, { method: "DELETE" });
      if (!response.ok) { await handleFailure(response, "Não foi possível descartar o rascunho."); setDiscardOpen(false); return; }
      setFinished(true);
      savedOnce.current = false;
      invalidateAnamnesis(patientId, anamnesisVersionKey(patientId, draft.id));
      toast.success("Rascunho descartado.");
      onClose("discarded");
    } catch {
      setError("Não foi possível descartar o rascunho.");
      setDiscardOpen(false);
    } finally {
      setBusy("");
    }
  }

  const unanswered = unansweredCount(content);
  const statusText = autosave.state === "saving" ? "Salvando..." : autosave.state === "pending" ? "Alterações não salvas" : autosave.state === "error" ? "Erro ao salvar" : "Rascunho salvo";

  return <div className="space-y-3">
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><h3 className="text-sm font-bold">Editando anamnese · versão {draft.version}</h3><p className="mt-1 text-xs text-muted-foreground">O rascunho é salvo automaticamente. A versão só vale depois de concluída e as versões anteriores nunca são alteradas.</p></div>
      <span role="status" className={cn("inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold", autosave.state === "error" ? "text-destructive" : "text-muted-foreground")}>{autosave.state === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{statusText}</span>
    </Card>
    <fieldset disabled={busy !== "" || conflict} className="min-w-0 space-y-3 border-0 p-0">
      <Section icon={ClipboardList} title="Queixa principal e objetivo do tratamento">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Queixa principal"><textarea aria-label="Queixa principal" className={cn(fieldClassName, "h-24 resize-none py-2")} maxLength={2000} value={content.complaint.chiefComplaint} onChange={(event) => change((current) => ({ ...current, complaint: { ...current.complaint, chiefComplaint: event.target.value } }))} /></FormField>
          <FormField label="Objetivo do tratamento"><textarea aria-label="Objetivo do tratamento" className={cn(fieldClassName, "h-24 resize-none py-2")} maxLength={2000} value={content.complaint.treatmentGoal} onChange={(event) => change((current) => ({ ...current, complaint: { ...current.complaint, treatmentGoal: event.target.value } }))} /></FormField>
        </div>
      </Section>
      <Section icon={HeartPulse} title="Histórico de saúde" hint="Sem resposta fica como “Não informado”, nunca como “Não”.">
        <div className="grid gap-2 md:grid-cols-2">{healthItems.map((item) => <AnswerRow key={item.key} name={`health-${item.key}`} label={item.label} answer={content.health.items[item.key]} onChange={(answer) => change((current) => ({ ...current, health: { ...current.health, items: updateAnswers(current.health.items, item.key, answer) } }))} />)}</div>
        <div className="mt-3"><FormField label="Observações de saúde"><textarea aria-label="Observações de saúde" className={cn(fieldClassName, "h-20 resize-none py-2")} maxLength={2000} value={content.health.notes} onChange={(event) => change((current) => ({ ...current, health: { ...current.health, notes: event.target.value } }))} /></FormField></div>
      </Section>
      <Section icon={ShieldAlert} title="Alergias e sensibilidades">
        <div className="grid gap-2 md:grid-cols-2">{allergyItems.map((item) => <AnswerRow key={item.key} name={`allergy-${item.key}`} label={item.label} answer={content.allergies.items[item.key]} onChange={(answer) => change((current) => ({ ...current, allergies: { ...current.allergies, items: updateAnswers(current.allergies.items, item.key, answer) } }))} />)}</div>
        <div className="mt-3"><FormField label="Outras alergias e observações"><textarea aria-label="Outras alergias e observações" className={cn(fieldClassName, "h-20 resize-none py-2")} maxLength={2000} value={content.allergies.notes} onChange={(event) => change((current) => ({ ...current, allergies: { ...current.allergies, notes: event.target.value } }))} /></FormField></div>
      </Section>
      <Section icon={Pill} title="Medicamentos em uso">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">Usa medicamentos regularmente?</span><TriStateControl name="uses-medication" label="Usa medicamentos regularmente" value={content.medications.usesMedication} onChange={(value) => change((current) => ({ ...current, medications: { ...current.medications, usesMedication: value } }))} /></div>
        <div className="space-y-2">{content.medications.items.map((row, index) => <div key={row.id} className="grid gap-2 rounded-md border border-border/70 p-2.5 md:grid-cols-[1.3fr_1fr_1fr_1fr_auto]">
          {([["name", "Medicamento"], ["purpose", "Finalidade"], ["dose", "Dose / frequência"], ["notes", "Observações"]] as const).map(([field, label]) => <input key={field} className={cn(fieldClassName, "h-9 text-xs")} aria-label={`${label} (linha ${index + 1})`} placeholder={label} maxLength={200} value={row[field]} onChange={(event) => change((current) => ({ ...current, medications: { ...current.medications, items: current.medications.items.map((item) => item.id === row.id ? { ...item, [field]: event.target.value } : item) } }))} />)}
          <Button type="button" variant="ghost" size="icon" aria-label={`Remover medicamento ${index + 1}`} onClick={() => change((current) => ({ ...current, medications: { ...current.medications, items: current.medications.items.filter((item) => item.id !== row.id) } }))}><Trash2 className="h-4 w-4" /></Button>
        </div>)}</div>
        <Button className="mt-2" type="button" size="sm" variant="outline" disabled={content.medications.items.length >= 30} onClick={() => change((current) => ({ ...current, medications: { ...current.medications, items: [...current.medications.items, { id: crypto.randomUUID(), name: "", purpose: "", dose: "", notes: "" }] } }))}><Plus className="h-4 w-4" />Adicionar medicamento</Button>
      </Section>
      <Section icon={Stethoscope} title="Procedimentos anteriores">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">Já realizou procedimentos estéticos?</span><TriStateControl name="had-previous" label="Já realizou procedimentos estéticos" value={content.previousProcedures.hadPrevious} onChange={(value) => change((current) => ({ ...current, previousProcedures: { ...current.previousProcedures, hadPrevious: value } }))} /></div>
        <div className="space-y-2">{content.previousProcedures.items.map((row, index) => <div key={row.id} className="grid gap-2 rounded-md border border-border/70 p-2.5 md:grid-cols-[1.3fr_1fr_0.8fr_1.2fr_auto]">
          {([["name", "Procedimento"], ["region", "Região"], ["date", "Data"], ["notes", "Resultado / observações"]] as const).map(([field, label]) => <input key={field} className={cn(fieldClassName, "h-9 text-xs")} aria-label={`${label} (linha ${index + 1})`} placeholder={label} maxLength={field === "date" ? 40 : 200} value={row[field]} onChange={(event) => change((current) => ({ ...current, previousProcedures: { ...current.previousProcedures, items: current.previousProcedures.items.map((item) => item.id === row.id ? { ...item, [field]: event.target.value } : item) } }))} />)}
          <Button type="button" variant="ghost" size="icon" aria-label={`Remover procedimento anterior ${index + 1}`} onClick={() => change((current) => ({ ...current, previousProcedures: { ...current.previousProcedures, items: current.previousProcedures.items.filter((item) => item.id !== row.id) } }))}><Trash2 className="h-4 w-4" /></Button>
        </div>)}</div>
        <Button className="mt-2" type="button" size="sm" variant="outline" disabled={content.previousProcedures.items.length >= 30} onClick={() => change((current) => ({ ...current, previousProcedures: { ...current.previousProcedures, items: [...current.previousProcedures.items, { id: crypto.randomUUID(), name: "", region: "", date: "", notes: "" }] } }))}><Plus className="h-4 w-4" />Adicionar procedimento</Button>
      </Section>
      <Section icon={Info} title="Contraindicações e observações">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Contraindicações identificadas"><textarea aria-label="Contraindicações identificadas" className={cn(fieldClassName, "h-24 resize-none py-2")} maxLength={2000} value={content.contraindications.notes} onChange={(event) => change((current) => ({ ...current, contraindications: { ...current.contraindications, notes: event.target.value } }))} /></FormField>
          <FormField label="Observações gerais"><textarea aria-label="Observações gerais" className={cn(fieldClassName, "h-24 resize-none py-2")} maxLength={2000} value={content.contraindications.observations} onChange={(event) => change((current) => ({ ...current, contraindications: { ...current.contraindications, observations: event.target.value } }))} /></FormField>
        </div>
      </Section>
    </fieldset>
    {error ? <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p> : null}
    {conflict ? <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/40 bg-warning/5 p-4"><p className="text-xs">O rascunho no servidor foi mantido. Recarregue para continuar a partir dele.</p><Button type="button" onClick={() => onClose("stale")}>Recarregar do servidor</Button></Card> : null}
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="text-xs text-muted-foreground">{unanswered ? `${unanswered} pergunta(s) de saúde e alergia sem resposta ficarão como “Não informado”.` : "Todas as perguntas de saúde e alergia foram respondidas."}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy !== "" || conflict} onClick={() => setDiscardOpen(true)}>Descartar rascunho</Button>
        <Button type="button" variant="outline" disabled={busy !== "" || conflict} onClick={() => void autosave.leave(() => onClose("left"))}>Salvar e sair</Button>
        <Button type="button" disabled={busy !== "" || conflict} onClick={() => void complete()}>{busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}{busy === "complete" ? "Concluindo..." : "Concluir anamnese"}</Button>
      </div>
    </Card>
    <Modal open={discardOpen} title="Descartar rascunho" description="Apenas este rascunho é removido. As versões concluídas continuam preservadas." onClose={() => { if (busy !== "discard") setDiscardOpen(false); }}>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy === "discard"} onClick={() => setDiscardOpen(false)}>Manter rascunho</Button><Button type="button" className="bg-destructive hover:bg-destructive/90" disabled={busy === "discard"} onClick={() => void discard()}>{busy === "discard" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Descartar</Button></div>
    </Modal>
  </div>;
}

// Antes de montar o editor, o rascunho é lido direto do servidor (sem cache): nunca se edita conteúdo defasado.
function DraftEditorLoader({ patientId, onClose }: { patientId: string; onClose: (outcome: "left" | "completed" | "discarded" | "stale") => void }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; draft: AnamnesisVersionFull }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // onClose costuma ser uma função nova a cada render do pai; guardada em ref para não refazer a consulta.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    let active = true;
    fetch(anamnesisKey(patientId), { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("load"); return response.json() as Promise<AnamnesisOverview>; })
      .then((overview) => {
        if (!active) return;
        if (overview.restricted || !overview.draft) { invalidateAnamnesis(patientId); toast.info("Não há rascunho de anamnese aberto."); closeRef.current("left"); return; }
        setState({ status: "ready", draft: overview.draft });
      })
      .catch(() => { if (active) setState({ status: "error" }); });
    return () => { active = false; };
  }, [patientId, attempt]);

  const reload = () => { setState({ status: "loading" }); setAttempt((value) => value + 1); };
  if (state.status === "ready") return <AnamnesisEditor key={`${state.draft.id}:${state.draft.updatedAt}`} patientId={patientId} draft={state.draft} onClose={(outcome) => { if (outcome === "stale") reload(); else onClose(outcome); }} />;
  if (state.status === "error") return <Card className="space-y-3 p-6 text-center"><p role="alert" className="text-sm font-semibold text-destructive">Não foi possível carregar o rascunho da anamnese.</p><div className="flex justify-center gap-2"><Button variant="outline" onClick={() => onClose("left")}>Voltar</Button><Button onClick={reload}>Tentar novamente</Button></div></Card>;
  return <Card className="space-y-3 p-5" aria-busy="true"><LoadingSkeleton className="h-6 w-48" /><LoadingSkeleton className="h-28 w-full" /><LoadingSkeleton className="h-28 w-full" /></Card>;
}

// --- Leitura de uma versão ---

function AnswerPill({ value }: { value: TriState | null }) {
  const label = answerLabel(value);
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", value === "yes" ? "bg-warning/15 text-warning" : value === "no" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{label}</span>;
}

function ReadOnlyAnswers({ rows }: { rows: Array<{ key: string; label: string; answer: Answer }> }) {
  return <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">{rows.map((row) => <div key={row.key} className="flex items-start justify-between gap-2 border-b border-border/50 pb-1.5"><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="flex flex-col items-end gap-0.5 text-right"><AnswerPill value={row.answer.value} />{row.answer.value === "yes" && row.answer.detail ? <span className="text-xs text-muted-foreground">{row.answer.detail}</span> : null}</dd></div>)}</dl>;
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-muted/40 p-3"><p className="text-xs font-bold uppercase text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{value.trim() || "Não informado"}</p></div>;
}

function AnamnesisReadOnly({ content }: { content: AnamnesisContent }) {
  return <div className="space-y-3">
    <Section icon={ClipboardList} title="Queixa principal e objetivo do tratamento"><div className="grid gap-3 sm:grid-cols-2"><TextBlock label="Queixa principal" value={content.complaint.chiefComplaint} /><TextBlock label="Objetivo do tratamento" value={content.complaint.treatmentGoal} /></div></Section>
    <Section icon={HeartPulse} title="Histórico de saúde"><ReadOnlyAnswers rows={healthItems.map((item) => ({ key: item.key, label: item.label, answer: content.health.items[item.key] }))} />{content.health.notes.trim() ? <div className="mt-3"><TextBlock label="Observações de saúde" value={content.health.notes} /></div> : null}</Section>
    <Section icon={ShieldAlert} title="Alergias e sensibilidades"><ReadOnlyAnswers rows={allergyItems.map((item) => ({ key: item.key, label: item.label, answer: content.allergies.items[item.key] }))} />{content.allergies.notes.trim() ? <div className="mt-3"><TextBlock label="Outras alergias e observações" value={content.allergies.notes} /></div> : null}</Section>
    <Section icon={Pill} title="Medicamentos em uso">
      <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">Usa medicamentos regularmente? <AnswerPill value={content.medications.usesMedication} /></p>
      {content.medications.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead><tr className="border-b border-border text-xs uppercase text-muted-foreground"><th className="py-1.5 pr-2 font-semibold">Medicamento</th><th className="py-1.5 pr-2 font-semibold">Finalidade</th><th className="py-1.5 pr-2 font-semibold">Dose / frequência</th><th className="py-1.5 font-semibold">Observações</th></tr></thead><tbody>{content.medications.items.map((row) => <tr key={row.id} className="border-b border-border/50"><td className="py-1.5 pr-2 font-medium">{row.name}</td><td className="py-1.5 pr-2">{row.purpose || "—"}</td><td className="py-1.5 pr-2">{row.dose || "—"}</td><td className="py-1.5">{row.notes || "—"}</td></tr>)}</tbody></table></div> : <p className="text-xs text-muted-foreground">Nenhum medicamento listado.</p>}
    </Section>
    <Section icon={Stethoscope} title="Procedimentos anteriores">
      <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">Já realizou procedimentos estéticos? <AnswerPill value={content.previousProcedures.hadPrevious} /></p>
      {content.previousProcedures.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead><tr className="border-b border-border text-xs uppercase text-muted-foreground"><th className="py-1.5 pr-2 font-semibold">Procedimento</th><th className="py-1.5 pr-2 font-semibold">Região</th><th className="py-1.5 pr-2 font-semibold">Data</th><th className="py-1.5 font-semibold">Resultado / observações</th></tr></thead><tbody>{content.previousProcedures.items.map((row) => <tr key={row.id} className="border-b border-border/50"><td className="py-1.5 pr-2 font-medium">{row.name}</td><td className="py-1.5 pr-2">{row.region || "—"}</td><td className="py-1.5 pr-2">{row.date || "—"}</td><td className="py-1.5">{row.notes || "—"}</td></tr>)}</tbody></table></div> : <p className="text-xs text-muted-foreground">Nenhum procedimento listado.</p>}
    </Section>
    <Section icon={Info} title="Contraindicações e observações"><div className="grid gap-3 sm:grid-cols-2"><TextBlock label="Contraindicações identificadas" value={content.contraindications.notes} /><TextBlock label="Observações gerais" value={content.contraindications.observations} /></div></Section>
  </div>;
}

// --- Tela principal da aba ---

const statusBadge = (status: AnamnesisVersionMeta["status"], currentId: string | undefined, id: string) => displayVersionStatus({ id, status }, currentId) === "SUBSTITUIDA" ? <Badge variant="slate">Substituída</Badge> : status === "PENDENTE_REVISAO" ? <Badge variant="amber">Pendente de revisão</Badge> : status === "RASCUNHO" ? <Badge variant="slate">Rascunho</Badge> : <Badge variant="green">Concluída</Badge>;

export function PatientAnamnesis({ patientId, patientName, request = null, onRequestHandled }: { patientId: string; patientName: string; request?: AnamnesisRequest | null; onRequestHandled?: () => void }) {
  const canWrite = useCan("anamnesis:write");
  const { data: overview, loading, error, retry } = useCachedResource<AnamnesisOverview>(anamnesisKey(patientId));
  const [editSession, setEditSession] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [reviewError, setReviewError] = useState("");
  const handledNonce = useRef<number | null>(null);

  const startDraft = useCallback(async (from: "empty" | "current" | "evaluation", evaluationId?: string) => {
    setStarting(true);
    setStartError("");
    try {
      const response = await fetch(anamnesisKey(patientId), { method: "POST", headers: jsonHeaders, body: JSON.stringify({ from, evaluationId }) });
      if (!response.ok) { setStartError(await readMessage(response, "Não foi possível iniciar a anamnese.")); return; }
      invalidateAnamnesis(patientId);
      await getCachedJson<AnamnesisOverview>(anamnesisKey(patientId)).catch(() => undefined);
      setViewVersionId(null);
      setEditSession(true);
    } catch {
      setStartError("Não foi possível iniciar a anamnese. Verifique a conexão.");
    } finally {
      setStarting(false);
    }
  }, [patientId]);

  // Pedido de abrir a anamnese (cadastro, gate, agenda): consumido uma única vez, assim que aplicado, para não
  // reabrir o editor sozinho ao voltar à aba nem criar rascunho sem novo pedido.
  useEffect(() => {
    if (!isFreshRequest(request, handledNonce.current) || !request || !overview) return;
    handledNonce.current = request.nonce;
    onRequestHandled?.();
    if (overview.restricted || !canWrite) return;
    const action = autoStartAction(request.mode, { hasDraft: Boolean(overview.draft), hasCurrent: Boolean(overview.current) });
    // Em microtarefa: abrir/criar atualiza estado e não deve rodar de forma síncrona dentro do efeito.
    if (action === "edit-draft") queueMicrotask(() => setEditSession(true));
    else if (action === "create-empty") queueMicrotask(() => void startDraft("empty"));
    else if (action === "create-from-current") queueMicrotask(() => void startDraft("current"));
  }, [request, overview, canWrite, startDraft, onRequestHandled]);

  const closeEditor = useCallback(() => setEditSession(false), []);

  const versionResource = useCachedResource<{ version: AnamnesisVersionFull }>(viewVersionId ? anamnesisVersionKey(patientId, viewVersionId) : "");

  async function reviewAction(action: "confirm-review" | "request-review") {
    if (!overview || overview.restricted || !overview.current || reviewBusy) return;
    if (action === "request-review" && !reviewReason.trim()) { setReviewError("Informe o motivo da revisão."); return; }
    setReviewBusy(true);
    setReviewError("");
    try {
      const response = await fetch(`${anamnesisKey(patientId)}/${encodeURIComponent(overview.current.id)}`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ action, note: action === "request-review" ? reviewReason.trim() : undefined }) });
      if (!response.ok) { setReviewError(await readMessage(response, "Não foi possível registrar a revisão.")); return; }
      invalidateAnamnesis(patientId, anamnesisVersionKey(patientId, overview.current.id));
      setReviewOpen(false);
      setReviewReason("");
      toast.success(action === "confirm-review" ? "Revisão confirmada: a anamnese continua válida." : "Anamnese marcada para revisão.");
    } catch {
      setReviewError("Não foi possível registrar a revisão. Verifique a conexão.");
    } finally {
      setReviewBusy(false);
    }
  }

  if (loading && !overview) return <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.9fr)]"><Card className="space-y-3 p-5"><LoadingSkeleton className="h-6 w-48" /><LoadingSkeleton className="h-28 w-full" /><LoadingSkeleton className="h-28 w-full" /></Card><Card className="space-y-3 p-5"><LoadingSkeleton className="h-5 w-32" /><LoadingSkeleton className="h-20 w-full" /></Card></div>;
  if (error && !overview) return <Card className="space-y-3 p-6 text-center"><p role="alert" className="text-sm font-semibold text-destructive">Não foi possível carregar a anamnese.</p><div><Button variant="outline" onClick={retry}>Tentar novamente</Button></div></Card>;
  if (!overview) return null;

  if (overview.restricted) {
    return <Card className="p-6"><EmptyState title="Anamnese restrita à equipe clínica" description={overview.exists ? "Esta cliente possui anamnese registrada. O conteúdo é visível apenas para administradores e profissionais." : "Esta cliente ainda não possui anamnese registrada."} /></Card>;
  }

  if (editSession && overview.draft && canWrite) {
    return <DraftEditorLoader patientId={patientId} onClose={closeEditor} />;
  }

  const { current, draft } = overview;
  const viewing = viewVersionId ? versionResource.data?.version ?? null : null;
  const shown = viewing ?? current;
  const lastValidatedAt = current ? [current.completedAt, current.reviewConfirmedAt].filter(Boolean).sort().at(-1) ?? null : null;
  const lastValidatedBy = current ? current.reviewConfirmedAt && current.reviewConfirmedAt === lastValidatedAt ? current.reviewConfirmedBy : current.completedBy : null;

  if (!current && !draft) {
    const fallback = overview.evaluationFallback;
    return <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.9fr)]">
      <Card className="p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><ClipboardList className="h-6 w-6" /></span>
        <h3 className="mt-3 text-base font-bold">Nenhuma anamnese registrada</h3>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">A anamnese reúne queixa, histórico de saúde, alergias, medicamentos e procedimentos anteriores de {patientName}. Ela não é obrigatória para atender, mas ajuda a equipe a conduzir o tratamento com mais segurança.</p>
        {startError ? <p role="alert" className="mx-auto mt-3 max-w-md rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{startError}</p> : null}
        {canWrite ? <div className="mt-4 flex flex-wrap justify-center gap-2"><Button disabled={starting} onClick={() => void startDraft("empty")}>{starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Iniciar anamnese</Button>{fallback ? <Button variant="outline" disabled={starting} onClick={() => void startDraft("evaluation", fallback.evaluationId)}><FileText className="h-4 w-4" />Usar dados da avaliação de {formatDate(fallback.createdAt)}</Button> : null}</div> : <p className="mt-4 text-xs text-muted-foreground">Seu perfil não permite preencher a anamnese.</p>}
      </Card>
      <Card className="space-y-3 p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold"><ShieldAlert className="h-4 w-4 text-primary" />Alertas clínicos</h3>
        {fallback ? <p className="text-xs text-muted-foreground">Registros da avaliação de {formatDate(fallback.createdAt)} (a anamnese ainda não foi preenchida).</p> : null}
        <ClinicalAlertList alerts={fallback?.alerts ?? []} emptyText="Sem alertas: nenhuma anamnese foi preenchida ainda." />
      </Card>
    </div>;
  }

  return <div className="space-y-4">
    {startError ? <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{startError}</p> : null}
    {draft && canWrite ? <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary/5 p-4"><div><p className="text-sm font-bold">Rascunho em andamento · versão {draft.version}</p><p className="mt-0.5 text-xs text-muted-foreground">Iniciado por {draft.createdBy}, atualizado em {formatDate(draft.updatedAt)} às {formatTime(draft.updatedAt)}.</p></div><Button onClick={() => setEditSession(true)}><Pencil className="h-4 w-4" />Continuar rascunho</Button></Card> : null}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.9fr)]">
      <div className="min-w-0 space-y-3">
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div><h3 className="flex items-center gap-2 text-sm font-bold"><ClipboardList className="h-4 w-4 text-primary" />Anamnese{shown ? <span className="text-muted-foreground">· versão {shown.version}</span> : null}</h3><p className="mt-1 text-xs text-muted-foreground">Registro da anamnese clínica e estética. Editar gera uma nova versão e preserva as anteriores.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            {shown ? <Badge variant="slate">{shown.completedAt ? `Concluída em ${formatDate(shown.completedAt)}` : "Sem conclusão"}</Badge> : null}
            {canWrite && !draft && current && !viewing ? <Button disabled={starting} onClick={() => void startDraft("current")}>{starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}Editar anamnese (nova versão)</Button> : null}
          </div>
        </Card>
        {viewVersionId ? <Card className="flex flex-wrap items-center justify-between gap-2 border-warning/40 bg-warning/5 p-3"><p className="text-xs font-medium">{versionResource.error && !viewing ? "Não foi possível carregar esta versão." : viewing ? `Visualizando a versão ${viewing.version} (somente leitura).` : "Carregando versão..."}</p><Button size="sm" variant="outline" onClick={() => setViewVersionId(null)}>Voltar à versão atual</Button></Card> : null}
        {viewVersionId && !viewing ? <Card className="space-y-3 p-4"><LoadingSkeleton className="h-6 w-1/2" /><LoadingSkeleton className="h-24 w-full" /></Card> : shown ? <AnamnesisReadOnly content={shown.content} /> : <Card className="p-6"><EmptyState title="Ainda não há versão concluída" description="O rascunho em andamento passa a valer quando for concluído." /></Card>}
      </div>
      <aside className="order-first space-y-4 lg:order-none">
        <Card className="space-y-3 p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold"><ShieldAlert className="h-4 w-4 text-primary" />Alertas clínicos</h3>
          <ClinicalAlertList alerts={(viewing ?? current)?.alerts ?? []} emptyText="Nenhum alerta gerado pelas respostas registradas." />
          <p className="flex gap-1.5 text-xs leading-4 text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{alertsDisclaimer}</p>
        </Card>
        {current ? <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-bold"><BadgeCheck className="h-4 w-4 text-primary" />Revisão</h3>{overview.state === "REVISAO_PENDENTE" ? <Badge variant="amber">Revisão pendente</Badge> : <Badge variant="green">Revisada</Badge>}</div>
          <p className="text-xs text-muted-foreground">Última validação: {formatDate(lastValidatedAt)}{lastValidatedBy ? ` por ${lastValidatedBy}` : ""}.</p>
          {current.status === "PENDENTE_REVISAO" ? <p className="rounded-md bg-warning/10 p-2 text-xs text-foreground">Marcada para revisão por {current.reviewRequestedBy} em {formatDate(current.reviewRequestedAt)}{current.reviewReason ? `: ${current.reviewReason}` : "."}</p> : null}
          {canWrite ? <div className="flex flex-wrap gap-2"><Button size="sm" disabled={reviewBusy} onClick={() => void reviewAction("confirm-review")}>{reviewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}Confirmar que continua válida</Button>{current.status !== "PENDENTE_REVISAO" ? <Button size="sm" variant="outline" disabled={reviewBusy} onClick={() => { setReviewError(""); setReviewOpen(true); }}>Marcar para revisão</Button> : null}</div> : null}
          {reviewError && !reviewOpen ? <p role="alert" className="text-xs font-medium text-destructive">{reviewError}</p> : null}
        </Card> : null}
        <Card className="space-y-3 p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold"><Clock3 className="h-4 w-4 text-primary" />Versões da anamnese</h3>
          <ol className="space-y-2">{overview.versions.map((version) => {
            const isViewed = (viewVersionId ?? current?.id) === version.id;
            const final = version.status !== "RASCUNHO";
            return <li key={version.id}>
              <button type="button" disabled={!final} className={cn("flex w-full items-start justify-between gap-2 rounded-md border p-2.5 text-left transition", isViewed && final ? "border-primary/40 bg-primary/5" : "border-border", final ? "hover:bg-muted/50" : "cursor-default opacity-80")} onClick={() => { if (final) setViewVersionId(version.id === current?.id ? null : version.id); }}>
                <span className="min-w-0"><span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">Versão {version.version}{version.id === current?.id ? <Badge variant="purple">Atual</Badge> : null}</span><span className="mt-0.5 block text-xs text-muted-foreground">{final ? `${formatDate(version.completedAt)} às ${formatTime(version.completedAt)} · ${version.completedBy ?? "Profissional não informado"}` : `Rascunho de ${version.createdBy}, atualizado em ${formatDate(version.updatedAt)}`}</span></span>
                {statusBadge(version.status, current?.id, version.id)}
              </button>
            </li>;
          })}</ol>
        </Card>
      </aside>
    </div>
    <Modal open={reviewOpen} title="Marcar anamnese para revisão" description="A marcação é explícita e fica registrada com seu nome e a data. Nenhuma versão é alterada ou apagada." onClose={() => { if (!reviewBusy) setReviewOpen(false); }}>
      <div className="space-y-3">
        <FormField label="Motivo da revisão"><textarea aria-label="Motivo da revisão" className={cn(fieldClassName, "h-24 resize-none py-2")} maxLength={500} autoFocus value={reviewReason} placeholder="Ex.: a cliente relatou novo medicamento." onChange={(event) => { setReviewReason(event.target.value); setReviewError(""); }} /></FormField>
        {reviewError ? <p role="alert" className="text-xs font-medium text-destructive">{reviewError}</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={reviewBusy} onClick={() => setReviewOpen(false)}>Cancelar</Button><Button type="button" disabled={reviewBusy} onClick={() => void reviewAction("request-review")}>{reviewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Marcar para revisão</Button></div>
      </div>
    </Modal>
  </div>;
}
