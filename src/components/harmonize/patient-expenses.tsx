"use client";

import { ArrowLeft, ArrowRight, BadgeCheck, Ban, Check, Clock3, CreditCard, FileDown, Info, LoaderCircle, Send, WalletCards, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { getCachedJson, readClientCache, invalidateClientCache } from "@/lib/client-cache";
import { cn } from "@/lib/utils";
import { useCan } from "./current-user";
import { LoadingSkeleton } from "./shared";
import { quoteStatusLabels } from "@/lib/patient-finance-rules";
import { buildQuoteProposalHtml, openQuoteProposal, parseQuoteDetails, proposalRowsFromQuote, quoteFinancialSnapshot } from "@/lib/quote-proposal";
import { calculateQuote, formatMoneyInput, parseMoneyInput, type QuoteLineInput } from "@/lib/quote-rules";
import { ProcedureSessionWorkspace } from "./procedure-session-workspace";
import { PostProcedureWorkspace } from "./post-procedure-workspace";
import { EncounterBreadcrumb, type EncounterBreadcrumbActions } from "./encounter-breadcrumb";
import { useDraftAutosave } from "./use-draft-autosave";
import { ReadOnlyStageNotice } from "./readonly-stage-notice";
import { revealValidationTarget } from "./reveal-validation-target";
import { JourneyProgress } from "./journey-progress";
import { ProcedureImage } from "./procedure-image";

type ProcedureOption = {
  id: string;
  name: string;
  category: string;
  materials?: string;
  unit?: string | null;
  price: number;
};

type CostSettings = { laborCost: number; facilityCost: number; medicationCost: number };
type QuoteOptionsResponse = { procedures: ProcedureOption[]; costs: CostSettings; clinicName?: string | null };
type PatientQuote = { id: string; items: string; total: number; status: string; paymentConfirmed?: boolean; paymentMethod?: string | null; details?: string | null; notes?: string; installments?: number; evaluationId?: string | null; createdBy?: string; updatedBy?: string; approvedBy?: string | null; approvedAt?: string | null; sentBy?: string | null; sentAt?: string | null; refusedBy?: string | null; refusedAt?: string | null; cancelledBy?: string | null; cancelledAt?: string | null; expires?: string | null; createdAt?: string; updatedAt?: string };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type PatientExpensesProps = { patientId: string; journeyId?: string; journeyLabel?: string; patient?: import("@/types/clinic").Patient; onPaid?: () => void; onPaymentUndone?: () => void; mode?: "encounter" | "procedure" | "post-procedure"; initialView?: "post" | "return"; evaluationId?: string; quoteId?: string; sessionId?: string; breadcrumb?: EncounterBreadcrumbActions; onReturnToEvaluation?: () => void; onReturnToQuote?: () => void; onReturnToProcedure?: () => void; readOnly?: boolean; onAdvance?: (quoteId: string) => void; onCompleted?: (sessionId: string) => void; onFinish?: () => void };

export function PatientExpenses(props: PatientExpensesProps) {
  if (props.mode === "procedure") return props.patient && props.journeyId && props.quoteId ? <ProcedureSessionWorkspace patient={props.patient} patientId={props.patientId} journeyId={props.journeyId} quoteId={props.quoteId} breadcrumb={props.breadcrumb} readOnly={props.readOnly} onBack={props.onReturnToQuote ?? (() => undefined)} onCompleted={props.onCompleted ?? (() => undefined)} /> : <Card className="p-6 text-center text-sm text-[#b42318]">Não foi possível abrir a sessão sem paciente, jornada e orçamento aprovado.</Card>;
  if (props.mode === "post-procedure") return props.patient && props.journeyId && props.sessionId ? <PostProcedureWorkspace patient={props.patient} patientId={props.patientId} journeyId={props.journeyId} sessionId={props.sessionId} breadcrumb={props.breadcrumb} onFinish={props.onFinish ?? (() => undefined)} onReturnToQuote={props.onReturnToQuote} onReturnToProcedure={props.onReturnToProcedure} initialView={props.initialView} /> : <Card className="p-6 text-center text-sm text-[#b42318]">Não foi possível abrir o acompanhamento sem paciente, jornada e sessão.</Card>;
  if (props.mode === "encounter") return <EncounterQuoteWorkspace {...props} />;
  return null;
}

// A unidade vem do primeiro material da ficha técnica do procedimento.
function procedureUnit(procedure: ProcedureOption) {
  return procedure.unit ?? "unidade";
}

function formatQuantity(quantity: number, unit: string) {
  return `${quantity.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${unit}`;
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span>{label}</span><strong className="whitespace-nowrap text-[#424355]">{value}</strong></div>;
}

type EvaluationSummaryData = { id: string; professional: string; status: string; createdAt: string; chiefComplaint: string; patientGoal: string; medicalHistory: string; allergies: string; contraindications: string; previousProcedures: string; clinicalNotes: string };
const quotePaymentMethods = ["Cartão de crédito", "Pix", "Dinheiro", "Cartão de débito", "Boleto", "Transferência"];

function EncounterQuoteWorkspace({ patientId, journeyId, journeyLabel, patient, evaluationId, quoteId: focusQuoteId, breadcrumb, onPaid, onPaymentUndone, onReturnToEvaluation, onAdvance, readOnly = false }: PatientExpensesProps) {
  const canDeletePayment = useCan("payments:delete");
  const canReopenQuote = useCan("quote:edit-closed");
  const quoteKey = `/api/quotes?patientId=${encodeURIComponent(patientId)}&journeyId=${encodeURIComponent(journeyId ?? "")}`;
  const evaluationKey = `/api/patients/${encodeURIComponent(patientId)}/evaluation?summary=1&evaluationId=${encodeURIComponent(evaluationId ?? "")}`;
  const cachedQuotes = readClientCache<{ quotes?: PatientQuote[] }>(quoteKey);
  const cachedOptions = readClientCache<QuoteOptionsResponse>("/api/quotes/options");
  const cachedEvaluation = evaluationId ? readClientCache<{ evaluation?: EvaluationSummaryData | null }>(evaluationKey) : undefined;
  const [quotes, setQuotes] = useState(cachedQuotes?.quotes ?? []);
  const [procedures, setProcedures] = useState(cachedOptions?.procedures ?? []);
  const [costs, setCosts] = useState(cachedOptions?.costs ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 });
  const [clinicName, setClinicName] = useState(cachedOptions?.clinicName ?? "");
  const [evaluation, setEvaluation] = useState<EvaluationSummaryData | null>(cachedEvaluation?.evaluation ?? null);
  const [loading, setLoading] = useState(!cachedQuotes || !cachedOptions || !cachedEvaluation);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [newRevision, setNewRevision] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [advanceError, setAdvanceError] = useState("");
  const [advanceAttempt, setAdvanceAttempt] = useState(0);
  const [confirmPayment, setConfirmPayment] = useState(false);
  const [createdPaymentId, setCreatedPaymentId] = useState<string | null>(null);
  const [paymentUndoQuoteId, setPaymentUndoQuoteId] = useState<string | null>(null);
  const [paymentPriorQuoteStatus, setPaymentPriorQuoteStatus] = useState("Aprovado");
  const [paymentUndoNotice, setPaymentUndoNotice] = useState(false);
  const [paymentUndoLeaving, setPaymentUndoLeaving] = useState(false);
  const [paymentUndoBusy, setPaymentUndoBusy] = useState(false);
  const paymentUndoTimer = useRef<number | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const autosaveQuoteId = useRef<string | null>(null);
  const [lines, setLines] = useState<QuoteLineInput[]>([]);
  const [discountDrafts, setDiscountDrafts] = useState<Record<string, string>>({});
  const [discountErrors, setDiscountErrors] = useState<Record<string, string>>({});
  const [selectionError, setSelectionError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cartão de crédito");
  const [installments, setInstallments] = useState(1);
  const [notes, setNotes] = useState("");
  const [initializedQuoteId, setInitializedQuoteId] = useState<string | null>(null);
  const [draftGeneration, setDraftGeneration] = useState(0);
  const [pdfNotice, setPdfNotice] = useState(false);
  const [pdfGenerated, setPdfGenerated] = useState(false);

  useEffect(() => {
    if (!patientId || !evaluationId || !journeyId) return;
    let active = true;
    Promise.all([
      getCachedJson<{ quotes?: PatientQuote[] }>(quoteKey),
      getCachedJson<QuoteOptionsResponse>("/api/quotes/options"),
      getCachedJson<{ evaluation?: EvaluationSummaryData | null }>(evaluationKey),
    ]).then(([quoteData, optionData, evaluationData]) => {
      if (!active) return;
      const nextQuotes = quoteData.quotes ?? [];
      const nextProcedures = optionData.procedures ?? [];
      const nextQuote = nextQuotes.find((quote) => quote.id === focusQuoteId)
        ?? nextQuotes.find((quote) => quote.evaluationId === evaluationId)
        ?? nextQuotes.find((quote) => !quote.evaluationId);
      setQuotes(nextQuotes);
      setProcedures(nextProcedures);
      setCosts(optionData.costs ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 });
      setClinicName(optionData.clinicName ?? "");
      setEvaluation(evaluationData.evaluation ?? null);
      setSelectedQuoteId(nextQuote?.id ?? null);
      autosaveQuoteId.current = nextQuote?.id ?? null;
      setLines(restoreQuoteLines(nextQuote, nextProcedures));
      setPaymentMethod(nextQuote?.paymentMethod ?? "Cartão de crédito");
      setInstallments(nextQuote?.installments ?? 1);
      setNotes(nextQuote?.notes ?? "");
      setInitializedQuoteId(nextQuote?.id ?? "__new__");
      setLoadError(false);
    }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [patientId, journeyId, evaluationId, focusQuoteId, quoteKey, evaluationKey, retry]);

  const relatedQuotes = useMemo(() => quotes.filter((quote) => quote.evaluationId === evaluationId || !quote.evaluationId), [quotes, evaluationId]);
  const activeQuote = newRevision ? undefined : relatedQuotes.find((quote) => quote.id === selectedQuoteId) ?? relatedQuotes[0];
  const showAdvanceError = Boolean(advanceError) && !(activeQuote && ["Aprovado", "Pago"].includes(activeQuote.status));
  const canUndoRegisteredPayment = canDeletePayment && canReopenQuote;
  const canStartNewProposal = !readOnly && !relatedQuotes.some((quote) => quote.status === "Pago");
  const editable = !readOnly && (!activeQuote ||["Rascunho", "Pendente"].includes(activeQuote.status));
  const catalogPrices = procedures.map((procedure) => ({ id: procedure.id, name: procedure.name, priceCents: Math.round(procedure.price * 100) }));
  const currentCalculation = calculateQuote(lines, catalogPrices, { laborCents: Math.round(costs.laborCost * 100), facilityCents: Math.round(costs.facilityCost * 100), medicationCents: Math.round(costs.medicationCost * 100) });
  const quoteSignature = `${JSON.stringify(lines)}|${paymentMethod}|${installments}|${notes}`;
  const quoteDetails = parseQuoteDetails(activeQuote?.details);
  const savedLines = quoteDetails?.items.map((item) => ({ procedureId: item.procedureId, quantity: item.quantity, discountCents: item.discountCents })) ?? restoreQuoteLines(activeQuote, procedures);
  const initialSignature = activeQuote ? `${JSON.stringify(savedLines)}|${activeQuote.paymentMethod ?? "Cartão de crédito"}|${activeQuote.installments ?? 1}|${activeQuote.notes ?? ""}` : "";
  const saved = Boolean(activeQuote?.id && initializedQuoteId === activeQuote.id && quoteSignature === initialSignature);
  const calculated = saved && quoteDetails?.items.length ? {
    items: quoteDetails.items,
    subtotalCents: quoteDetails.subtotalCents,
    discountCents: quoteDetails.discountCents,
    costTotalCents: quoteDetails.costTotalCents ?? (quoteDetails.costs ? quoteDetails.costs.laborCents + quoteDetails.costs.facilityCents + quoteDetails.costs.medicationCents : Math.max(0, quoteDetails.totalCents - quoteDetails.subtotalCents + quoteDetails.discountCents)),
    totalCents: quoteDetails.totalCents,
  } : currentCalculation;
  const total = calculated?.totalCents ?? 0;
  const autosave = useDraftAutosave({
    scope: `${patientId}:${journeyId}:${evaluationId}:${draftGeneration}`,
    revision: quoteSignature,
    enabled: !readOnly && !loading && !loadError && initializedQuoteId !== null && editable,
    canSave: lines.length > 0 && Boolean(calculated) && !Object.values(discountErrors).some(Boolean),
    save: async () => Boolean(await saveDraft(true)),
  });

  useEffect(() => () => {
    if (paymentUndoTimer.current !== null) window.clearTimeout(paymentUndoTimer.current);
  }, []);

  function updateLine(procedureId: string, changes: Partial<QuoteLineInput>) {
    setLines((current) => current.map((line) => line.procedureId === procedureId ? { ...line, ...changes } : line));
    setNotice(null);
    if (changes.discountCents !== undefined) setDiscountErrors((current) => ({ ...current, [procedureId]: "" }));
    if (changes.quantity !== undefined) {
      const procedure = procedures.find((item) => item.id === procedureId);
      const line = lines.find((item) => item.procedureId === procedureId);
      const maxCents = Math.round((procedure?.price ?? 0) * 100) * changes.quantity;
      setDiscountDrafts((current) => { const next = { ...current }; delete next[procedureId]; return next; });
      setDiscountErrors((current) => ({ ...current, [procedureId]: line && line.discountCents > maxCents ? "Reduza o desconto: ele ultrapassa o subtotal desta quantidade." : "" }));
    }
  }

  function showPaymentUndoNotice(paymentId: string, quoteId: string, priorStatus: string) {
    if (paymentUndoTimer.current !== null) window.clearTimeout(paymentUndoTimer.current);
    setCreatedPaymentId(paymentId);
    setPaymentUndoQuoteId(quoteId);
    setPaymentPriorQuoteStatus(priorStatus);
    setPaymentUndoLeaving(false);
    setPaymentUndoNotice(true);
    paymentUndoTimer.current = window.setTimeout(() => {
      setPaymentUndoLeaving(true);
      paymentUndoTimer.current = window.setTimeout(() => {
        setPaymentUndoNotice(false);
        setPaymentUndoLeaving(false);
        setCreatedPaymentId(null);
        setPaymentUndoQuoteId(null);
        paymentUndoTimer.current = null;
      }, 240);
    }, 6260);
  }

  function openPaymentConfirmation() {
    if (readOnly || !activeQuote ||["Pago", "Recusado", "Cancelado"].includes(activeQuote.status)) return;
    setNotice(null);
    setPaymentPriorQuoteStatus(activeQuote.status);
    setConfirmPayment(true);
  }

  function changeDiscount(procedureId: string, value: string, maximumCents: number) {
    setDiscountDrafts((current) => ({ ...current, [procedureId]: value }));
    const cents = parseMoneyInput(value);
    if (cents === null) {
      setDiscountErrors((current) => ({ ...current, [procedureId]: "Informe um valor em reais, como 0,00." }));
      return;
    }
    if (cents > maximumCents) {
      setDiscountErrors((current) => ({ ...current, [procedureId]: "O desconto não pode ultrapassar o valor do item." }));
      return;
    }
    setDiscountErrors((current) => ({ ...current, [procedureId]: "" }));
    updateLine(procedureId, { discountCents: cents });
  }

  function blurDiscount(procedureId: string) {
    const line = lines.find((item) => item.procedureId === procedureId);
    if (line && !discountErrors[procedureId]) setDiscountDrafts((current) => ({ ...current, [procedureId]: formatMoneyInput(line.discountCents) }));
  }

  function toggleProcedure(procedureId: string, checked: boolean) {
    setLines((current) => checked
      ? current.some((line) => line.procedureId === procedureId) ? current : [...current, { procedureId, quantity: 1, discountCents: 0 }]
      : current.filter((line) => line.procedureId !== procedureId));
    if (checked) setSelectionError("");
    else {
      setDiscountDrafts((current) => { const next = { ...current }; delete next[procedureId]; return next; });
      setDiscountErrors((current) => { const next = { ...current }; delete next[procedureId]; return next; });
    }
    setNotice(null);
  }

  async function startNewRevision() {
    if (!canStartNewProposal) return;
    if (!await autosave.flush() && !window.confirm("As alterações não foram salvas. Deseja iniciar outra proposta e perdê-las?")) return;
    setDraftGeneration((current) => current + 1);
    setNewRevision(true);
    setSelectedQuoteId(null);
    autosaveQuoteId.current = null;
    setLines([]);
    setDiscountDrafts({}); setDiscountErrors({}); setSelectionError("");
    setPaymentMethod("Cartão de crédito");
    setInstallments(1);
    setNotes("");
    setInitializedQuoteId("__new__");
    setNotice(null);
  }

  async function selectRelatedQuote(quoteId: string) {
    const quote = relatedQuotes.find((item) => item.id === quoteId);
    if (!quote) return;
    if (!await autosave.flush() && !window.confirm("As alterações não foram salvas. Deseja abrir outra proposta e perdê-las?")) return;
    setDraftGeneration((current) => current + 1);
    setNewRevision(false);
    setSelectedQuoteId(quote.id);
    autosaveQuoteId.current = quote.id;
    setLines(restoreQuoteLines(quote, procedures));
    setDiscountDrafts({}); setDiscountErrors({}); setSelectionError("");
    setPaymentMethod(quote.paymentMethod ?? "Cartão de crédito");
    setInstallments(quote.installments ?? 1);
    setNotes(quote.notes ?? "");
    setInitializedQuoteId(quote.id);
    setNotice(null);
  }

  async function saveDraft(automatic = false) {
    if (!lines.length) { setSelectionError("Selecione ao menos um procedimento para salvar o orçamento."); if (!automatic) revealQuoteProceduresIssue(); return null; }
    if (Object.values(discountErrors).some(Boolean)) { if (!automatic) revealQuoteProceduresIssue(); return null; }
    if (!calculated || !evaluationId || !journeyId) { setNotice({ error: true, text: "Confira os procedimentos e descontos antes de salvar." }); if (!automatic) revealValidationTarget("quote-notes-card", "quote-notice-error"); return null; }
    setSaving(true); if (!automatic) setNotice(null);
    try {
      const targetId = autosaveQuoteId.current;
      const response = await fetch(targetId ? `/api/quotes/${targetId}` : "/api/quotes", {
        method: targetId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, journeyId, evaluationId, details: lines, paymentMethod, installments, notes, status: targetId ? undefined : "Rascunho" }),
      });
      const data = await response.json().catch(() => ({})) as { quote?: PatientQuote; message?: string };
      if (!response.ok || !data.quote) throw new Error(data.message ?? "Não foi possível salvar o orçamento.");
      invalidateClientCache(quoteKey, "/api/quotes", `/api/patients/${patientId}/history`, `/api/patients/${patientId}/profile`, "/api/dashboard/bootstrap");
      setQuotes((current) => current.some((quote) => quote.id === data.quote!.id) ? current.map((quote) => quote.id === data.quote!.id ? data.quote! : quote) : [data.quote!, ...current]);
      setSelectedQuoteId(data.quote.id); setNewRevision(false); setInitializedQuoteId(data.quote.id);
      autosaveQuoteId.current = data.quote.id;
      if (!automatic) setNotice({ error: false, text: "Rascunho salvo. Nenhum pagamento foi registrado." });
      return data.quote;
    } catch (error) {
      if (!automatic) { setNotice({ error: true, text: error instanceof Error ? error.message : "Não foi possível salvar o orçamento." }); revealValidationTarget("quote-notes-card", "quote-notice-error"); }
      return null;
    } finally { setSaving(false); }
  }

  function revealQuoteProceduresIssue() {
    const firstDiscount = Object.keys(discountErrors).find((id) => discountErrors[id]);
    revealValidationTarget("quote-procedures-card", firstDiscount ? `discount-${firstDiscount}` : "quote-selection-error");
  }

  async function changeStatus(status: "Enviado" | "Aprovado" | "Recusado" | "Cancelado") {
    if (readOnly) return;
    if (editable && !await autosave.flush()) { if (!lines.length || Object.values(discountErrors).some(Boolean)) revealQuoteProceduresIssue(); else revealValidationTarget("quote-header-card"); return; }
    const quote = activeQuote ?? await saveDraft();
    if (!quote) return;
    if (status === "Enviado" && !window.confirm("Confirma que a proposta já foi enviada ao paciente?")) return;
    setStatusBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/quotes/${quote.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, evaluationId }) });
      const data = await response.json().catch(() => ({})) as { quote?: PatientQuote; message?: string };
      if (!response.ok || !data.quote) throw new Error(data.message ?? "Não foi possível atualizar o status do orçamento.");
      invalidateClientCache(quoteKey, "/api/quotes", `/api/patients/${patientId}/history`, `/api/patients/${patientId}/profile`);
      setQuotes((current) => current.map((item) => item.id === quote.id ? data.quote! : item));
      setNotice({ error: false, text: status === "Enviado" ? "Envio registrado." : `Orçamento ${status.toLocaleLowerCase("pt-BR")} sem registrar recebimento.` });
      if (["Recusado", "Cancelado"].includes(status)) { setNewRevision(true); setLines([]); setPaymentMethod("Cartão de crédito"); setInstallments(1); setNotes(""); setInitializedQuoteId("__new__"); }
    } catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : "Não foi possível atualizar o orçamento." }); revealValidationTarget("quote-notes-card", "quote-notice-error"); }
    finally { setStatusBusy(false); }
  }

  async function advanceToProcedure() {
    if (!activeQuote || !["Aprovado", "Pago"].includes(activeQuote.status)) {
      setAdvanceAttempt((current) => current + 1);
      setAdvanceError("Ainda não foi registrado um pagamento para este orçamento.");
      revealValidationTarget("quote-financial-card", "quote-advance-error");
      return;
    }
    setAdvanceError("");
    if (readOnly || activeQuote.evaluationId === evaluationId) {
      onAdvance?.(activeQuote.id);
      return;
    }
    setSaving(true); setNotice(null);
    try {
      const response = await fetch(`/api/quotes/${activeQuote.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evaluationId }),
      });
      const data = await response.json().catch(() => ({})) as { quote?: PatientQuote; message?: string };
      if (!response.ok || !data.quote) throw new Error(data.message ?? "Não foi possível vincular o orçamento à avaliação.");
      invalidateClientCache(quoteKey, "/api/quotes", `/api/patients/${patientId}/history`, `/api/patients/${patientId}/profile`);
      setQuotes((current) => current.map((quote) => quote.id === data.quote!.id ? data.quote! : quote));
      onAdvance?.(data.quote.id);
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "Não foi possível avançar para o procedimento." });
      revealValidationTarget("quote-notes-card", "quote-notice-error");
    } finally { setSaving(false); }
  }

  async function registerPayment() {
    if (readOnly || !activeQuote ||["Pago", "Recusado", "Cancelado"].includes(activeQuote.status)) return;
    setPaymentBusy(true); setNotice(null);
    const priorStatus = activeQuote.status;
    try {
      const response = await fetch("/api/payments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, journeyId, value: activeQuote.total, method: activeQuote.paymentMethod ?? paymentMethod, status: "Pago", installments: activeQuote.paymentMethod === "Cartão de crédito" ? String(activeQuote.installments ?? installments) + "x" : "A vista" }),
      });
      const data = await response.json().catch(() => ({})) as { payment?: { id: string }; message?: string };
      if (!response.ok || !data.payment) throw new Error(data.message ?? "Não foi possível registrar o pagamento.");
      showPaymentUndoNotice(data.payment.id, activeQuote.id, priorStatus);
      setConfirmPayment(false);
      const quoteResponse = await fetch("/api/quotes/" + activeQuote.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Pago", evaluationId }),
      });
      const quoteData = await quoteResponse.json().catch(() => ({})) as { quote?: PatientQuote; message?: string };
      if (!quoteResponse.ok || !quoteData.quote) {
        throw new Error("O recebimento foi registrado, mas o status do orçamento não foi atualizado. " + (quoteData.message ?? "Atualize a página e confira o financeiro."));
      }
      invalidateClientCache("/api/payments", "/api/quotes", quoteKey, "/api/patients/" + patientId + "/history", "/api/patients/" + patientId + "/profile", "/api/dashboard/bootstrap");
      setQuotes((current) => current.map((quote) => quote.id === quoteData.quote!.id ? quoteData.quote! : quote));
      setNotice({ error: false, text: "Pagamento registrado e orçamento atualizado." });
      onPaid?.();
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "Não foi possível registrar o pagamento." });
      revealValidationTarget("quote-notes-card", "quote-notice-error");
    } finally { setPaymentBusy(false); }
  }

  async function undoPayment() {
    if (readOnly || !createdPaymentId || paymentUndoBusy) return;
    setPaymentUndoBusy(true);
    try {
      const response = await fetch(`/api/payments/${createdPaymentId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Não foi possível desfazer o pagamento.");

      const quoteResponse = paymentUndoQuoteId ? await fetch(`/api/quotes/${paymentUndoQuoteId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: paymentPriorQuoteStatus, evaluationId }),
      }) : null;
      const quoteData = quoteResponse ? await quoteResponse.json().catch(() => ({})) as { quote?: PatientQuote; message?: string } : null;
      invalidateClientCache("/api/payments", "/api/quotes", quoteKey, "/api/patients/" + patientId + "/history", "/api/patients/" + patientId + "/profile", "/api/dashboard/bootstrap");
      if (paymentUndoTimer.current !== null) window.clearTimeout(paymentUndoTimer.current);
      paymentUndoTimer.current = null;
      setPaymentUndoNotice(false);
      setPaymentUndoLeaving(false);
      setCreatedPaymentId(null);
      setPaymentUndoQuoteId(null);

      if (!quoteResponse?.ok || !quoteData?.quote) {
        setNotice({ error: true, text: "Pagamento desfeito, mas não foi possível restaurar o status do orçamento. Atualize a página e confira o financeiro." });
        onPaymentUndone?.();
        return;
      }
      setQuotes((current) => current.map((quote) => quote.id === quoteData.quote!.id ? quoteData.quote! : quote));
      setNotice({ error: false, text: "Pagamento desfeito." });
      onPaymentUndone?.();
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "Não foi possível desfazer o pagamento." });
      revealValidationTarget("quote-notes-card", "quote-notice-error");
    } finally { setPaymentUndoBusy(false); }
  }

  function generatePdf() {
    if (!lines.length) { setSelectionError("Selecione ao menos um procedimento antes de gerar a proposta."); revealQuoteProceduresIssue(); return; }
    if (!calculated || Object.values(discountErrors).some(Boolean)) { setNotice({ error: true, text: "Confira os procedimentos e descontos antes de gerar a proposta." }); if (Object.values(discountErrors).some(Boolean)) revealQuoteProceduresIssue(); else revealValidationTarget("quote-notes-card", "quote-notice-error"); return; }
    if (!activeQuote || !saved || autosave.state !== "saved") return;
    setPdfNotice(false);
    const stored = parseQuoteDetails(activeQuote.details);
    const rows = stored?.items.length ? stored.items : proposalRowsFromQuote(activeQuote);
    const totalCents = stored?.totalCents ?? Math.round(activeQuote.total * 100);
    const proposalDate = activeQuote.createdAt ? new Date(activeQuote.createdAt) : new Date();
    const proposalInstallments = activeQuote.installments ?? installments;
    const proposalPaymentMethod = activeQuote.paymentMethod ?? paymentMethod;
    const html = buildQuoteProposalHtml({
      goal: evaluation?.patientGoal,
      statusLabel: activeQuote.status === "Pago"
        ? activeQuote.paymentConfirmed ? "Aprovado" : "Pagamento não confirmado"
        : quoteStatusLabels[activeQuote.status] ?? activeQuote.status,
      dateLabel: proposalDate.toLocaleDateString("pt-BR"),
      proposalNumber: activeQuote.id,
      validUntil: activeQuote.expires ? new Date(activeQuote.expires).toLocaleDateString("pt-BR") : null,
      clinic: { name: clinicName },
      patient: { name: patient?.name, cpf: patient?.cpf },
      professional: { name: evaluation?.professional },
      rows,
      paymentMethod: proposalPaymentMethod,
      installments: proposalInstallments,
      notes: activeQuote.notes,
      financial: quoteFinancialSnapshot(activeQuote.details, totalCents),
      conditions: { paymentStatus: activeQuote.status === "Pago" ? (activeQuote.paymentConfirmed ? "Concluído" : "Não confirmado") : null },
      totalCents,
    });
    if (!openQuoteProposal(html)) { setPdfNotice(true); revealValidationTarget("quote-notes-card", "quote-pdf-error"); return; }
    setPdfGenerated(true);
  }

  if (!evaluationId || !journeyId) return <Card className="p-6 text-center text-sm text-[#b42318]">Esta avaliação não está vinculada a um tratamento. Volte à avaliação e tente novamente.</Card>;
  if (loading) return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px]"><Card className="space-y-4 p-5"><LoadingSkeleton className="h-8 w-1/3" /><LoadingSkeleton className="h-12 w-full" /><LoadingSkeleton className="h-44 w-full" /></Card><Card className="space-y-3 p-5"><LoadingSkeleton className="h-8 w-1/2" /><LoadingSkeleton className="h-16 w-full" /></Card></div>;
  if (loadError || !evaluation) return <Card className="space-y-3 p-6 text-center"><p className="text-sm font-semibold text-[#b42318]">{loadError ? "Não foi possível carregar os dados para o orçamento." : "A avaliação vinculada não foi encontrada."}</p>{loadError ? <Button variant="outline" onClick={() => { setLoadError(false); setLoading(true); setRetry((current) => current + 1); }}>Tentar novamente</Button> : null}</Card>;

  return (
    <div className="space-y-4">
      {patient && breadcrumb ? <EncounterBreadcrumb patientName={patient.name} journeyName={journeyLabel ?? "Novo atendimento"} stage="Orçamento" onClients={() => void autosave.leave(breadcrumb.onClients)} onPatient={() => void autosave.leave(breadcrumb.onPatient)} onJourney={() => void autosave.leave(breadcrumb.onJourney)} /> : null}
      {patient && breadcrumb ? <button type="button" onClick={() => void autosave.leave(breadcrumb.onJourney)} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"><ArrowLeft className="h-4 w-4" />Voltar aos tratamentos</button> : null}
      <Card id="quote-header-card" tabIndex={-1} className="flex scroll-mt-24 flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#ece9ff] text-sm font-black text-[#5147dc]">{(patient?.name ?? "Paciente").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div className="min-w-0"><h2 className="truncate text-base font-bold text-[#242538]">{patient?.name ?? "Paciente"}</h2><p className="text-xs text-[#77788a]">{patient?.age ? `${patient.age} anos · ` : ""}{patient?.phone ?? "Telefone não informado"} · {patient?.status ?? "Status não informado"}</p><p className="text-xs text-[#858696]">Paciente desde {patient?.createdAt ? new Date(patient.createdAt).toLocaleDateString("pt-BR") : "data não informada"} · {journeyLabel ?? "Novo atendimento"} · Etapa 2 de 5</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><span role="status" className={cn("text-xs", autosave.state === "error" ? "text-destructive" : "text-muted-foreground")}>{readOnly ? "Somente leitura" : autosave.state === "saving" ? "Salvando..." : autosave.state === "pending" ? "Alterações pendentes" : autosave.state === "error" ? "Não foi possível salvar" : "Rascunho salvo"}</span>{autosave.state === "error" && !readOnly ? <Button size="sm" variant="outline" onClick={() => void autosave.flush()}>Tentar novamente</Button> : null}<Button variant="outline" onClick={() => void autosave.leave(() => onReturnToEvaluation?.())}><ArrowLeft className="h-4 w-4" />Voltar para avaliação</Button><Button aria-describedby={showAdvanceError ?"quote-advance-error" : undefined} disabled={saving || autosave.state !== "saved"} onClick={() => void advanceToProcedure()}>{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Avançar para procedimento</Button></div>
      </Card>
      <JourneyProgress current={1} />
      {readOnly ? <ReadOnlyStageNotice /> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0 space-y-4">
          <Card id="quote-procedures-card" tabIndex={-1} className={cn("scroll-mt-24 overflow-hidden", (selectionError || Object.values(discountErrors).some(Boolean)) && "border-destructive")}>
            <div className="border-b border-[#ececf2] px-4 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-[#27283b]">Orçamento do tratamento</h3><p className="mt-1 text-xs text-[#858696]">Vinculado à avaliação de {new Date(evaluation.createdAt).toLocaleDateString("pt-BR")} · {evaluation.professional || "Profissional não informado"}</p></div><div className="flex flex-wrap items-center justify-end gap-2"></div></div><div className="mt-2 flex flex-wrap items-center justify-end gap-2">{relatedQuotes.length ? <label className="sr-only" htmlFor="journey-quote-history">Propostas desta jornada</label> : null}{relatedQuotes.length ? <select id="journey-quote-history" aria-label="Selecionar proposta desta jornada" className="h-8 max-w-[230px] rounded-[5px] border border-[#dddde6] bg-white px-2 text-sm" value={newRevision ? "__new__" : activeQuote?.id ?? ""} onChange={(event) => event.target.value === "__new__" ? startNewRevision() : selectRelatedQuote(event.target.value)}><option value="__new__" disabled={!canStartNewProposal || readOnly}>Nova proposta</option>{relatedQuotes.map((quote) => <option key={quote.id} value={quote.id}>{quoteStatusLabels[quote.status] ?? quote.status} · {quote.createdAt ? new Date(quote.createdAt).toLocaleDateString("pt-BR") : "Data não informada"} · {currency.format(quote.total)}</option>)}</select> : null}{activeQuote ? <span className="rounded-full bg-[#f0efff] px-3 py-1 text-xs font-bold text-[#5147dc]">{quoteStatusLabels[activeQuote.status] ?? activeQuote.status}</span> : null}{relatedQuotes.length && !readOnly ? <Button size="sm" variant="outline" type="button" disabled={!canStartNewProposal} title={canStartNewProposal ? undefined : "Já existe pagamento registrado nesta jornada"} onClick={() => void startNewRevision()}>Nova proposta</Button> : null}</div>
              <div className="mt-4 rounded-[6px] bg-[#f3f1ff] px-3 py-2.5 text-xs text-[#4d4b68]"><strong className="text-[#3a31c8]">Objetivo:</strong> {evaluation.patientGoal.trim() || "Não informado na avaliação."}</div>
              <p className="mt-3 text-xs text-[#707184]"><strong>Queixa principal:</strong> {evaluation.chiefComplaint.trim() || "Não informado"}</p>
            </div>
            <div className="px-4 pb-3 pt-4"><h4 className="text-xs font-bold text-[#353648]">Procedimentos sugeridos</h4><p className="mt-0.5 text-xs text-[#858696]">Selecione os procedimentos do catálogo e informe a quantidade.</p></div>
            <div className="overflow-x-auto px-4 pb-4">
              {procedures.length ? <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                <thead><tr className="bg-[#f7f7fb] text-[#77798d]"><th className="rounded-l-[5px] px-3 py-2.5 font-bold">Procedimento / Material</th><th className="px-3 py-2.5 font-bold">Qtd. / medida</th><th className="px-3 py-2.5 font-bold">Valor unitário</th><th className="px-3 py-2.5 font-bold">Desconto</th><th className="rounded-r-[5px] px-3 py-2.5 font-bold">Subtotal</th></tr></thead>
                <tbody>{procedures.map((procedure) => {
                  const line = lines.find((item) => item.procedureId === procedure.id);
                  const quantity = line?.quantity ?? 1;
                  const unitCents = Math.round(procedure.price * 100);
                  const discountCents = line?.discountCents ?? 0;
                  const subtotal = Math.max(0, unitCents * quantity - discountCents);
                  return <tr className="min-h-14 border-t border-[#eeeeF3]" key={procedure.id}>
                    <td className="px-3 py-3"><label className="flex min-w-0 cursor-pointer items-center gap-2"><input type="checkbox" checked={Boolean(line)} disabled={!editable} onChange={(event) => toggleProcedure(procedure.id, event.target.checked)} aria-label={`Selecionar ${procedure.name}`} className="h-4 w-4 shrink-0 accent-[#5147dc] disabled:cursor-not-allowed" /><ProcedureImage name={procedure.name} decorative className="h-9 w-9 rounded" /><span className="min-w-0"><strong className={cn("block truncate", line ? "text-[#3f4053]" : "text-[#77798d] font-medium")}>{procedure.name}</strong><span className="mt-0.5 block truncate text-xs text-[#999aaa]">{procedure.materials || procedure.category}</span></span></label></td>
                    <td className="px-3 py-3"><select aria-label={`Quantidade de ${procedure.name}`} disabled={!editable || !line} className="h-8 rounded-[5px] border border-[#dddde6] bg-white px-2 text-sm disabled:bg-[#f4f4f8]" value={quantity} onChange={(event) => updateLine(procedure.id, { quantity: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{formatQuantity(value, procedureUnit(procedure))}</option>)}</select></td>
                    <td className="px-3 py-3 font-semibold text-[#555668]">{currency.format(procedure.price)}</td>
                    <td className="px-3 py-3"><input id={`discount-${procedure.id}`} aria-label={`Desconto de ${procedure.name}`} aria-invalid={Boolean(discountErrors[procedure.id])} aria-describedby={discountErrors[procedure.id] ? `discount-error-${procedure.id}` : undefined} disabled={!editable || !line} className={cn("h-8 w-24 rounded-[5px] border border-[#dddde6] px-2 text-sm disabled:bg-[#f4f4f8]", discountErrors[procedure.id] && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} type="text" inputMode="decimal" placeholder="0,00" value={discountDrafts[procedure.id] ?? formatMoneyInput(discountCents)} onChange={(event) => changeDiscount(procedure.id, event.target.value, unitCents * quantity)} onBlur={() => blurDiscount(procedure.id)} /><span className="mt-1 block text-xs text-[#858696]">Em R$ · máximo {currency.format(unitCents * quantity / 100)}</span>{discountErrors[procedure.id] ? <span id={`discount-error-${procedure.id}`} role="alert" className="mt-1 block max-w-32 text-xs font-medium text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{discountErrors[procedure.id]}</span> : null}</td>
                    <td className={cn("px-3 py-3 font-bold", line ? "text-[#353648]" : "text-[#a2a3b0]")}>{currency.format(subtotal / 100)}</td>
                  </tr>;
                })}</tbody>
              </table> : <p className="rounded-[5px] border border-dashed border-[#dddde6] px-4 py-8 text-center text-xs text-[#77788a]">Nenhum procedimento cadastrado para esta clínica.</p>}
              {selectionError ? <p id="quote-selection-error" tabIndex={-1} key={selectionError} role="alert" className="mt-2 scroll-mt-24 rounded-[5px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{selectionError}</p> : null}
            </div>
          </Card>

          <Card className="p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><CreditCard className="h-4 w-4 text-[#5147dc]" />Condições de pagamento</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{quotePaymentMethods.map((method) => <button key={method} type="button" disabled={!editable} aria-pressed={paymentMethod === method} onClick={() => { setPaymentMethod(method); if (method !== "Cartão de crédito") setInstallments(1); }} className={cn("flex min-h-14 items-center gap-2 rounded-[6px] border px-3 text-left text-xs font-bold transition", paymentMethod === method ? "border-[#5147dc] bg-[#f3f1ff] text-[#3f35d6]" : "border-[#e5e5ee] bg-white text-[#555668] hover:bg-[#fafafd]", !editable && "cursor-not-allowed opacity-60")}><span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", paymentMethod === method ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#c8c9d5]")}>{paymentMethod === method ? <Check className="h-3 w-3" /> : null}</span><span>{method}<small className="mt-0.5 block font-normal text-[#858696]">{method === "Cartão de crédito" ? "Parcelamento disponível" : "Pagamento à vista"}</small></span></button>)}</div>{paymentMethod === "Cartão de crédito" ? <label className="mt-3 block max-w-xs text-xs font-semibold text-[#68697b]">Número de parcelas<select disabled={!editable} className="mt-1 h-9 w-full rounded-[5px] border border-[#dddde6] bg-white px-2 text-sm" value={installments} onChange={(event) => setInstallments(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option value={count} key={count}>{count}x de {currency.format(count ? Math.ceil(total / count) / 100 : 0)}</option>)}</select></label> : null}<p className="mt-2 rounded-[5px] bg-[#f7f7fb] p-2.5 text-xs text-[#68697b]">Forma de pagamento é apenas uma condição da proposta. Nenhum recebimento será lançado por essa seleção.</p></Card>

          <Card id="quote-notes-card" tabIndex={-1} className={cn("scroll-mt-24 p-4", (notice?.error || pdfNotice) && "border-destructive")}><label className="block text-sm font-bold text-[#292a3d]" htmlFor="quote-notes">Observações do orçamento</label><textarea id="quote-notes" disabled={!editable} maxLength={2000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Condições comerciais, validade ou orientações para o paciente" className="mt-3 w-full resize-y rounded-[6px] border border-[#dddde6] bg-white p-3 text-sm text-[#454659] outline-none focus:border-[#5147dc] disabled:bg-[#f4f4f8]" /><div className="mt-2 flex flex-wrap gap-2">{!readOnly && (activeQuote?.status === "Rascunho" || activeQuote?.status === "Pendente") ? <Button type="button" variant="outline" disabled={statusBusy || saving} onClick={() => void changeStatus("Enviado")}><Send className="h-4 w-4" />Registrar envio</Button> : null}</div>{notice ? <p id={notice.error ? "quote-notice-error" : undefined} tabIndex={notice.error ? -1 : undefined} key={notice.text} role={notice.error ? "alert" : "status"} className={cn("mt-3 rounded-[5px] px-3 py-2 text-xs font-semibold", notice.error ? "bg-[#fff1f0] text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]" : "bg-[#eef8f2] text-[#287a50]")}>{notice.text}</p> : null}{pdfNotice ? <p id="quote-pdf-error" tabIndex={-1} role="alert" className="mt-2 scroll-mt-24 text-xs text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.</p> : null}</Card>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-24 xl:self-start">
          <Card className="space-y-2 p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><Info className="h-4 w-4 text-[#5147dc]" />Resumo do atendimento</h3>{[["Etapa atual", "Orçamento"], ["Profissional", evaluation.professional || "Não informado"], ["Data da avaliação", new Date(evaluation.createdAt).toLocaleDateString("pt-BR")], ["Status", quoteStatusLabels[activeQuote?.status ?? "Rascunho"] ?? "Rascunho"]].map(([label, value]) => <div key={label} className="flex justify-between gap-2 rounded-[5px] bg-[#f7f7fb] px-2.5 py-2 text-xs"><span className="text-[#68697b]">{label}</span><strong>{value}</strong></div>)}{activeQuote?.approvedAt ? <p className="pt-1 text-xs text-[#77788a]">Aprovado em {new Date(activeQuote.approvedAt).toLocaleString("pt-BR")} por {activeQuote.approvedBy || "responsável não informado"}</p> : null}</Card>
          <Card id="quote-financial-card" tabIndex={-1} className={cn("scroll-mt-24 space-y-3 p-4", showAdvanceError && "border-destructive animate-[hp-shake_0.42s_ease-in-out]")} key={showAdvanceError ? `financial-${advanceAttempt}` : "financial"}><h3 className="flex items-center gap-2 text-sm font-bold"><WalletCards className="h-4 w-4 text-[#5147dc]" />Resumo financeiro</h3>{showAdvanceError ? <p id="quote-advance-error" tabIndex={-1} role="alert" className="rounded-[5px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318]">{advanceError}</p> : null}<SummaryLine label="Itens" value={String(calculated?.items.length ?? 0)} /><SummaryLine label="Subtotal" value={currency.format((calculated?.subtotalCents ?? 0) / 100)} /><SummaryLine label="Desconto" value={currency.format((calculated?.discountCents ?? 0) / 100)} /><SummaryLine label="Custos da clínica" value={currency.format((calculated?.costTotalCents ?? 0) / 100)} /><div className="flex justify-between rounded-[5px] bg-[#f3f1ff] px-3 py-2 text-xs font-bold"><span>Valor final</span><strong className="text-[#5147dc]">{currency.format(total / 100)}</strong></div><div className="rounded-[5px] bg-[#eef8f2] px-3 py-2 text-xs font-semibold text-[#287a50]">{activeQuote?.status === "Aprovado" ? "Proposta aprovada · sem recebimento registrado" : activeQuote?.status === "Enviado" ? "Aguardando aprovação do paciente" : activeQuote?.status === "Recusado" ? "Proposta recusada" : activeQuote?.status === "Cancelado" ? "Proposta cancelada" : "Rascunho do orçamento"}</div><Button size="sm" type="button" variant="outline" className="w-full" disabled={readOnly || paymentBusy || saving || !saved || autosave.state !== "saved" || !activeQuote || ["Pago", "Recusado", "Cancelado"].includes(activeQuote.status)} onClick={openPaymentConfirmation}><WalletCards className="h-4 w-4" />{paymentBusy ? "Registrando..." : "Registrar pagamento"}</Button><Button size="sm" type="button" variant="outline" className="w-full" disabled={!calculated || !activeQuote || !saved || autosave.state !== "saved"} onClick={generatePdf}><FileDown className="h-4 w-4" />Gerar PDF</Button></Card>
          <Card className="space-y-2 p-4"><h3 className="text-sm font-bold">Checklist do orçamento</h3>{[["Itens adicionados", Boolean(lines.length)], ["Forma definida", Boolean(paymentMethod)], ["PDF gerado", pdfGenerated], ["Envio registrado", Boolean(activeQuote?.sentAt)]].map(([label, done]) => <div key={String(label)} className="flex items-center gap-2 rounded-[5px] bg-[#f7f7fb] px-2.5 py-2 text-xs"><span className={cn("grid h-4 w-4 place-items-center rounded-[3px] border", done ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#c9cad6]")}>{done ? <Check className="h-3 w-3" /> : null}</span>{label}</div>)}</Card>
          <Card className="space-y-2 p-4"><h3 className="text-sm font-bold">Próximas ações</h3>{!readOnly && activeQuote?.status === "Enviado" ? <><Button className="w-full justify-between" type="button" variant="outline" disabled={statusBusy} onClick={() => void changeStatus("Aprovado")}><span className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-[#16805d]" />Aprovar proposta</span><ArrowRight className="h-4 w-4" /></Button><Button className="w-full justify-between" type="button" variant="outline" disabled={statusBusy} onClick={() => void changeStatus("Recusado")}><span className="flex items-center gap-2"><XCircle className="h-4 w-4 text-[#b42318]" />Registrar recusa</span><ArrowRight className="h-4 w-4" /></Button></> : null}{!readOnly && activeQuote && !["Aprovado", "Pago", "Recusado", "Cancelado"].includes(activeQuote.status) ? <Button className="w-full justify-between" type="button" variant="outline" disabled={statusBusy} onClick={() => void changeStatus("Cancelado")}><span className="flex items-center gap-2"><Ban className="h-4 w-4 text-[#b42318]" />Cancelar orçamento</span><ArrowRight className="h-4 w-4" /></Button> : null}{activeQuote ? <p className="flex items-center gap-2 pt-1 text-xs text-[#77788a]"><Clock3 className="h-3.5 w-3.5" />Última alteração: {activeQuote.updatedAt ? new Date(activeQuote.updatedAt).toLocaleString("pt-BR") : "Não informado"} · {activeQuote.updatedBy || activeQuote.createdBy || "Responsável não informado"}</p> : null}</Card>
        </aside>
      </div>
      <Modal open={confirmPayment} onClose={() => { if (!paymentBusy) setConfirmPayment(false); }} title="Confirmar pagamento" description="Confira o valor e a forma antes de registrar o recebimento.">
        <div className="min-w-0 space-y-4">
          <div className="rounded-[6px] border border-[#e5e5ee] bg-[#fafafd] p-4"><p className="text-xs text-[#77788a]">Valor a registrar</p><p className="mt-1 text-xl font-black text-[#5147dc]">{currency.format(activeQuote?.total ?? 0)}</p><p className="mt-2 text-xs text-[#555668]">Forma: <strong>{activeQuote?.paymentMethod ?? paymentMethod}</strong>{(activeQuote?.paymentMethod ?? paymentMethod) === "Cartão de crédito" ? <> · {activeQuote?.installments ?? installments}x</> : null}</p></div>
          <p className="text-xs leading-5 text-[#65708b]">Tem certeza que deseja registrar este pagamento como recebido?</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={paymentBusy} onClick={() => setConfirmPayment(false)}>Cancelar</Button><Button type="button" disabled={paymentBusy} onClick={() => void registerPayment()}>{paymentBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <WalletCards className="h-4 w-4" />}{paymentBusy ? "Registrando..." : "Confirmar pagamento"}</Button></div>
        </div>
      </Modal>
      {paymentUndoNotice ? <div className={`${paymentUndoLeaving ? "hp-snackbar-exit" : "hp-snackbar-enter"} fixed bottom-6 left-1/2 z-[90] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-[8px] border border-border bg-card px-4 py-3 text-xs font-bold text-card-foreground shadow-[0_18px_45px_rgba(31,32,50,0.18)]`} role="status"><div className="flex items-center gap-3"><span className="min-w-0 flex-1">Pagamento registrado com sucesso.</span><button className="shrink-0 rounded-full bg-muted px-3 py-1.5 text-xs font-black text-foreground transition hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void undoPayment()} disabled={!canUndoRegisteredPayment || paymentUndoBusy} title={canUndoRegisteredPayment ? undefined : "Somente administradores podem desfazer um pagamento"}>{paymentUndoBusy ? "Desfazendo..." : "Desfazer"}</button></div><div className="hp-snackbar-progress mt-3 h-1 rounded-full bg-success" style={{ "--snackbar-duration": "6500ms" } as CSSProperties} /></div> : null}
    </div>
  );
}

function restoreQuoteLines(quote: PatientQuote | undefined, procedures: ProcedureOption[]): QuoteLineInput[] {
  if (!quote) return [];
  const stored = parseQuoteDetails(quote.details);
  if (stored?.items.length) return stored.items.map((item) => ({ procedureId: item.procedureId, quantity: item.quantity, discountCents: item.discountCents }));
  const legacyItems = quote.items.split(",").map((item) => item.trim());
  return procedures.flatMap((procedure) => {
    const match = legacyItems.find((item) => item === procedure.name || item.startsWith(`${procedure.name} (`));
    const quantity = Number(match?.match(/\((\d+)x\)/)?.[1] ?? (match === procedure.name ? 1 : 0));
    return quantity ? [{ procedureId: procedure.id, quantity, discountCents: 0 }] : [];
  });
}
