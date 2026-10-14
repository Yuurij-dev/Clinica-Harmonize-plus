"use client";

import { ArrowLeft, ArrowRight, BadgeCheck, Ban, CalendarPlus, Check, ChevronDown, CirclePlus, Clock3, CreditCard, FileDown, Info, LoaderCircle, Save, Send, WalletCards, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { getCachedJson, readClientCache, invalidateClientCache } from "@/lib/client-cache";
import { cn } from "@/lib/utils";
import { useCan } from "./current-user";
import { ListAccordion } from "./list-accordion";
import { LoadingSkeleton } from "./shared";
import { calculateQuote, type QuoteLineInput } from "@/lib/quote-rules";
import { ProcedureSessionWorkspace } from "./procedure-session-workspace";
import { PostProcedureWorkspace } from "./post-procedure-workspace";

type ProcedureOption = {
  id: string;
  name: string;
  category: string;
  materials?: string;
  unit?: string | null;
  price: number;
};

type CostSettings = { laborCost: number; facilityCost: number; medicationCost: number };
type QuoteOptionsResponse = { procedures: ProcedureOption[]; costs: CostSettings };
type PatientQuote = { id: string; items: string; total: number; status: string; paymentMethod?: string | null; details?: string | null; notes?: string; installments?: number; evaluationId?: string | null; createdBy?: string; updatedBy?: string; approvedBy?: string | null; approvedAt?: string | null; sentBy?: string | null; sentAt?: string | null; refusedBy?: string | null; refusedAt?: string | null; cancelledBy?: string | null; cancelledAt?: string | null; createdAt?: string; updatedAt?: string };
type SelectedProcedure = ProcedureOption & { quantity: number; unit: string };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NEW_QUOTE_ID = "__new__";

type PatientExpensesProps = { patientId: string; journeyId?: string; patient?: import("@/types/clinic").Patient; onPaid?: () => void; onPaymentUndone?: () => void; mode?: "list" | "encounter" | "procedure" | "post-procedure"; evaluationId?: string; quoteId?: string; sessionId?: string; onReturnToEvaluation?: () => void; onReturnToQuote?: () => void; onAdvance?: (quoteId: string) => void; onCompleted?: (sessionId: string) => void; onFinish?: () => void };

export function PatientExpenses(props: PatientExpensesProps) {
  if (props.mode === "procedure") return props.patient && props.journeyId && props.quoteId ? <ProcedureSessionWorkspace patient={props.patient} patientId={props.patientId} journeyId={props.journeyId} quoteId={props.quoteId} onBack={props.onReturnToQuote ?? (() => undefined)} onCompleted={props.onCompleted ?? (() => undefined)} /> : <Card className="p-6 text-center text-sm text-[#b42318]">Não foi possível abrir a sessão sem paciente, jornada e orçamento aprovado.</Card>;
  if (props.mode === "post-procedure") return props.patient && props.journeyId && props.sessionId ? <PostProcedureWorkspace patient={props.patient} patientId={props.patientId} journeyId={props.journeyId} sessionId={props.sessionId} onFinish={props.onFinish ?? (() => undefined)} /> : <Card className="p-6 text-center text-sm text-[#b42318]">Não foi possível abrir o acompanhamento sem paciente, jornada e sessão.</Card>;
  if (props.mode === "encounter") return <EncounterQuoteWorkspace {...props} />;
  return <PatientExpenseList {...props} />;
}

function PatientExpenseList({ patientId, journeyId, onPaid, onPaymentUndone }: PatientExpensesProps) {
  const quoteCacheKey = `/api/quotes?patientId=${encodeURIComponent(patientId)}&journeyId=${encodeURIComponent(journeyId ?? "")}`;
  const cachedQuotes = readClientCache<{ quotes?: PatientQuote[] }>(quoteCacheKey);
  const [quotes, setQuotes] = useState<PatientQuote[]>(cachedQuotes?.quotes ?? []);
  const [quotesLoading, setQuotesLoading] = useState(!cachedQuotes && Boolean(patientId));
  const [quotesError, setQuotesError] = useState(false);
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null);
  const [creatingQuote, setCreatingQuote] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    getCachedJson<{ quotes?: PatientQuote[] }>(quoteCacheKey)
      .then((data) => setQuotes(data.quotes ?? []))
      .catch(() => setQuotesError(true))
      .finally(() => setQuotesLoading(false));
  }, [patientId, quoteCacheKey]);

  function startNewQuote() {
    setCreatingQuote(true);
    setOpenQuoteId(NEW_QUOTE_ID);
  }

  function handleSaved(quote: PatientQuote) {
    setQuotes((current) => current.some((item) => item.id === quote.id) ? current.map((item) => item.id === quote.id ? { ...item, ...quote } : item) : [quote, ...current]);
    if (openQuoteId === NEW_QUOTE_ID) {
      setCreatingQuote(false);
      setOpenQuoteId(quote.id);
    }
  }

  function handleStatusChange(quoteId: string, status: string) {
    setQuotes((current) => current.map((item) => item.id === quoteId ? { ...item, status } : item));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-bold text-[#27283b]">Orçamentos</h3><p className="mt-0.5 text-[10px] text-[#858696]">Clique em um orçamento para abrir a calculadora.</p></div>
        <Button type="button" variant="outline" disabled={creatingQuote || !patientId} onClick={startNewQuote}><CalendarPlus className="h-4 w-4" />Adicionar orçamento</Button>
      </div>
      {creatingQuote ? (
        <ListAccordion title="Novo orçamento" subtitle={new Date().toLocaleDateString("pt-BR")} open onToggle={() => { setCreatingQuote(false); setOpenQuoteId(null); }}>
          <QuoteCalculator patientId={patientId} journeyId={journeyId} onSaved={handleSaved} onPaid={onPaid} onPaymentUndone={onPaymentUndone} onStatusChange={handleStatusChange} />
        </ListAccordion>
      ) : null}
      {quotesLoading ? (
        <Card className="space-y-3 p-4"><LoadingSkeleton className="h-6 w-1/2" /><LoadingSkeleton className="h-6 w-1/3" /></Card>
      ) : quotesError ? (
        <Card className="p-6 text-center text-xs text-[#b42318]">Não foi possível carregar os orçamentos.</Card>
      ) : quotes.length === 0 && !creatingQuote ? (
        <Card className="p-6 text-center text-xs text-[#77788a]">Nenhum orçamento cadastrado nesta jornada. Clique em “Adicionar orçamento” para criar o primeiro.</Card>
      ) : (
        quotes.map((quote) => (
          <ListAccordion key={quote.id} title={formatQuoteTitle(quote.items)} subtitle={quote.createdAt ? new Date(quote.createdAt).toLocaleDateString("pt-BR") : undefined} meta={<QuoteStatusMeta status={quote.status} total={quote.total} />} open={openQuoteId === quote.id} onToggle={() => setOpenQuoteId((current) => current === quote.id ? null : quote.id)}>
            <QuoteCalculator patientId={patientId} journeyId={journeyId} quote={quote} onSaved={handleSaved} onPaid={onPaid} onPaymentUndone={onPaymentUndone} onStatusChange={handleStatusChange} />
          </ListAccordion>
        ))
      )}
    </div>
  );
}

function QuoteStatusMeta({ status, total }: { status: string; total: number }) {
  const paid = status === "Pago";
  const approved = status === "Aprovado";
  return (
    <>
      <span className={cn("rounded-full px-2 py-1 text-[10px] font-bold", paid ? "bg-[#eaf8ef] text-[#16805d]" : approved ? "bg-[#eef8f2] text-[#287a50]" : "bg-[#fff6e5] text-[#a15c07]")}>{status}</span>
      <strong className="hidden text-xs text-[#424355] sm:inline">{currency.format(total)}</strong>
    </>
  );
}

function formatQuoteTitle(items: string) {
  return items.replace(/\((\d+)x\)/g, "($1X)");
}

function QuoteCalculator({ patientId, journeyId, quote, onSaved, onPaid, onPaymentUndone, onStatusChange }: { patientId: string; journeyId?: string; quote?: PatientQuote; onSaved: (quote: PatientQuote) => void; onPaid?: () => void; onPaymentUndone?: () => void; onStatusChange: (quoteId: string, status: string) => void }) {
  const canReopen = useCan("quote:edit-closed");
  const cached = readClientCache<QuoteOptionsResponse>("/api/quotes/options");
  const cachedCostSettings = readClientCache<{ settings?: CostSettings }>("/api/clinic/cost-settings");
  const [procedures, setProcedures] = useState<ProcedureOption[]>(cached?.procedures ?? []);
  const [costs, setCosts] = useState<CostSettings>(cachedCostSettings?.settings ?? cached?.costs ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 });
  const [editedSelection, setSelected] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(!cached);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [saveShake, setSaveShake] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(quote?.paymentMethod ?? "Cartão de crédito");
  const [confirmPayment, setConfirmPayment] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState(false);
  const [paymentNoticeLeaving, setPaymentNoticeLeaving] = useState(false);
  const [createdPaymentId, setCreatedPaymentId] = useState<string | null>(null);
  const [paymentPriorQuoteStatus, setPaymentPriorQuoteStatus] = useState(quote?.status ?? "Pendente");
  const [latestQuoteId, setLatestQuoteId] = useState<string | null>(quote?.id ?? null);
  const [savedQuoteSignature, setSavedQuoteSignature] = useState<string | null>(quote ? `${quote.items}|${quote.total}|${quote.paymentMethod ?? "Cartão de crédito"}` : null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(quote?.status === "Pago");
  const quoteClosed = ["Aprovado", "Pago"].includes(quote?.status ?? "");
  const quoteItems = quote?.items;

  useEffect(() => {
    if (cached) return;
    getCachedJson<QuoteOptionsResponse>("/api/quotes/options")
      .then((data) => {
        setProcedures(data.procedures ?? []);
        setCosts(data.costs ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 });
      })
      .catch(() => setNotice("Não foi possível carregar os procedimentos cadastrados."))
      .finally(() => setLoading(false));
  }, [cached]);

  useEffect(() => {
    if (cachedCostSettings?.settings) return;
    getCachedJson<{ settings?: CostSettings }>("/api/clinic/cost-settings")
      .then((data) => setCosts(data.settings ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 }))
      .catch(() => undefined);
  }, [cachedCostSettings]);

  const restoredSelection = useMemo(() => {
    if (!quoteItems) return {};
    return procedures.reduce<Record<string, number>>((selection, procedure) => {
      const item = quoteItems.split(", ").find((entry) => entry.startsWith(`${procedure.name} (`));
      const quantity = item?.match(/\((\d+)x\)/)?.[1];
      if (quantity) selection[procedure.id] = Number(quantity);
      return selection;
    }, {});
  }, [procedures, quoteItems]);
  const selected = editedSelection ?? restoredSelection;

  const selectedItems = useMemo<SelectedProcedure[]>(
    () => procedures.filter((procedure) => selected[procedure.id]).map((procedure) => ({ ...procedure, quantity: selected[procedure.id], unit: procedureUnit(procedure) })),
    [procedures, selected],
  );
  const materialsTotal = selectedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const extraCosts = costs.laborCost + costs.facilityCost + costs.medicationCost;
  const total = materialsTotal + extraCosts;
  const currentQuoteSignature = `${selectedItems.map((item) => `${item.name} (${item.quantity}x)`).join(", ")}|${total}|${paymentMethod}`;
  const quoteSaved = Boolean(latestQuoteId && savedQuoteSignature === currentQuoteSignature);

  function toggleProcedure(id: string) {
    setSelected((edited) => {
      const current = edited ?? restoredSelection;
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
    setSaveError(false);
    setNotice(null);
  }

  function updateQuantity(id: string, quantity: number) {
    setSelected((edited) => ({ ...(edited ?? restoredSelection), [id]: quantity }));
    setSaveError(false);
    setNotice(null);
  }

  async function saveQuote() {
    if (!patientId || selectedItems.length === 0) {
      setSaveError(true);
      setSaveShake(true);
      setNotice("Selecione pelo menos um procedimento para salvar o orçamento.");
      window.setTimeout(() => setSaveShake(false), 450);
      return;
    }
    setSaving(true);
    setSaveError(false);
    setNotice(null);
    try {
      const response = await fetch(latestQuoteId ? `/api/quotes/${latestQuoteId}` : "/api/quotes", {
        method: latestQuoteId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, journeyId, items: selectedItems.map((item) => `${item.name} (${item.quantity}x)`).join(", "), total, paymentMethod }),
      });
      const responseText = await response.text();
      let data: { quote?: PatientQuote; message?: string } = {};
      if (responseText.trim()) {
        try {
          data = JSON.parse(responseText) as { quote?: PatientQuote; message?: string };
        } catch {
          throw new Error("O servidor retornou uma resposta inválida ao salvar o orçamento.");
        }
      }
      if (!response.ok) throw new Error(data.message ?? `Não foi possível salvar o orçamento (${response.status}).`);
      if (!data.quote?.id) throw new Error("O orçamento foi processado, mas não retornou um identificador válido.");
      invalidateClientCache("/api/quotes", "/api/patients", "/api/dashboard/bootstrap", `/api/patients/${patientId}/history`);
      setLatestQuoteId(data.quote.id);
      setSavedQuoteSignature(currentQuoteSignature);
      onSaved(data.quote);
      setNotice("Orçamento salvo com sucesso.");
    } catch (error) {
      setSaveError(true);
      setNotice(error instanceof Error ? error.message : "Não foi possível salvar o orçamento.");
    } finally {
      setSaving(false);
    }
  }

  async function registerPayment() {
    if (!patientId || selectedItems.length === 0) {
      setSaveError(true);
      setSaveShake(true);
      setNotice("Selecione pelo menos um procedimento antes de registrar o pagamento.");
      window.setTimeout(() => setSaveShake(false), 450);
      return;
    }
    if (!latestQuoteId) {
      setSaveError(true);
      setNotice("Salve o orçamento antes de registrar o pagamento.");
      return;
    }
    setPaymentSaving(true);
    setPaymentPriorQuoteStatus(quote?.status ?? "Pendente");
    try {
      const response = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, journeyId, value: total, method: paymentMethod, status: "Pago", installments: "A vista" }) });
      const data = await response.json() as { payment?: { id: string }; message?: string };
      if (!response.ok || !data.payment) throw new Error(data.message ?? "Não foi possível registrar o pagamento.");
      const quoteResponse = await fetch(`/api/quotes/${latestQuoteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Pago" }) });
      if (!quoteResponse.ok) throw new Error("Pagamento registrado, mas não foi possível concluir o orçamento.");
      invalidateClientCache("/api/payments", "/api/dashboard/bootstrap", `/api/patients/${patientId}/history`);
      invalidateClientCache("/api/quotes", "/api/patients");
      setPaymentConfirmed(true);
      onStatusChange(latestQuoteId, "Pago");
      onPaid?.();
      setCreatedPaymentId(data.payment.id);
      setConfirmPayment(false);
      setPaymentNoticeLeaving(false);
      setPaymentNotice(true);
      window.setTimeout(() => setPaymentNoticeLeaving(true), 6260);
      window.setTimeout(() => { setPaymentNotice(false); setPaymentNoticeLeaving(false); setCreatedPaymentId(null); }, 6500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível registrar o pagamento.");
      setSaveError(true);
    } finally {
      setPaymentSaving(false);
    }
  }

  function openPaymentConfirmation() {
    if (!patientId || selectedItems.length === 0) {
      setSaveError(true);
      setSaveShake(true);
      setNotice("Selecione pelo menos um procedimento antes de registrar o pagamento.");
      window.setTimeout(() => setSaveShake(false), 450);
      return;
    }
    if (!latestQuoteId) {
      setSaveError(true);
      setNotice("Salve o orçamento antes de registrar o pagamento.");
      return;
    }
    setSaveError(false);
    setNotice(null);
    setConfirmPayment(true);
  }

  async function undoPayment() {
    if (!createdPaymentId) return;
    const response = await fetch(`/api/payments/${createdPaymentId}`, { method: "DELETE" });
    if (!response.ok) return;
    const quoteResponse = latestQuoteId ? await fetch(`/api/quotes/${latestQuoteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: paymentPriorQuoteStatus }) }) : null;
    invalidateClientCache("/api/payments", "/api/quotes", "/api/patients", "/api/dashboard/bootstrap", `/api/patients/${patientId}/history`);
    setPaymentNotice(false);
    setPaymentNoticeLeaving(false);
    setCreatedPaymentId(null);
    if (quoteResponse && !quoteResponse.ok) {
      setSaveError(true);
      setNotice("Pagamento removido, mas não foi possível reabrir o orçamento.");
      onPaymentUndone?.();
      return;
    }
    setPaymentConfirmed(false);
    if (latestQuoteId) onStatusChange(latestQuoteId, paymentPriorQuoteStatus);
    onPaymentUndone?.();
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="overflow-hidden">
        <div className="border-b border-[#ececf2] px-4 py-4">
          <h3 className="text-sm font-bold text-[#27283b]">Calculadora de orçamento do procedimento</h3>
          <p className="mt-1 text-[10px] leading-4 text-[#858696]">Selecione os procedimentos cadastrados e informe a quantidade para calcular o valor.</p>
        </div>
        {loading ? (
          <div className="min-h-48 space-y-4 p-5"><LoadingSkeleton className="h-8 w-1/3" /><LoadingSkeleton className="h-12 w-full" /><LoadingSkeleton className="h-12 w-full" /><LoadingSkeleton className="h-12 w-full" /></div>
        ) : procedures.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#77788a]">Nenhum procedimento cadastrado para esta clínica.</div>
        ) : (
          <div className="overflow-x-auto p-3">
            <div className="min-w-[680px] overflow-hidden rounded-[6px] border border-[#e9e9ef]">
              <div className="grid grid-cols-[1.55fr_0.7fr_0.8fr_0.75fr] bg-[#fafafd] px-3 py-2.5 text-[9px] font-bold text-[#77798d]"><span>Procedimento / Material</span><span>Qtd. / medida</span><span>Valor unitário</span><span>Subtotal</span></div>
              {procedures.map((procedure) => {
                const quantity = selected[procedure.id] ?? 0;
                const checked = quantity > 0;
                return (
                  <div className="grid min-h-14 grid-cols-[1.55fr_0.7fr_0.8fr_0.75fr] items-center border-t border-[#eeeeF3] px-3 text-[10px]" key={procedure.id}>
                    <button className="flex min-w-0 items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-70" disabled={quoteClosed} onClick={() => toggleProcedure(procedure.id)}>
                      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border", checked ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#cfd0da] bg-white text-transparent")}><Check className="h-3 w-3" /></span>
                        <span className="min-w-0"><strong className="block truncate text-[#3f4053]">{procedure.name}</strong><span className="mt-0.5 block truncate text-[8px] text-[#999aaa]">{procedure.materials || procedure.category}</span></span>
                    </button>
                    <label className="relative block w-[82px]">
                      <select aria-label={`Quantidade de ${procedure.name}`} disabled={quoteClosed} className="h-8 w-full appearance-none rounded-[5px] border border-[#dddde6] bg-white px-2 pr-6 text-[10px] font-semibold text-[#555668] outline-none focus:border-[#5147dc] disabled:cursor-not-allowed disabled:bg-[#f4f4f8] focus:border-[#5147dc]" value={quantity || 1} onChange={(event) => updateQuantity(procedure.id, Number(event.target.value))}>
                        {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{formatQuantity(value, procedureUnit(procedure))}</option>)}
                      </select><ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3 w-3 text-[#77788a]" />
                    </label>
                    <span className="font-semibold text-[#555668]">{currency.format(procedure.price)}</span>
                    <span className={cn("font-bold", checked ? "text-[#353648]" : "text-[#a2a3b0]")}>{currency.format(procedure.price * (checked ? quantity : 1))}</span>
                  </div>
                );
              })}
            </div>
            <Button className="mt-3" variant="secondary" size="sm" type="button" disabled={quoteClosed}><CirclePlus className="h-3.5 w-3.5" />Adicionar procedimento / material</Button>
          </div>
        )}
        {!loading && selectedItems.length > 0 ? <div className="border-t border-[#ececf2] bg-[#fbfbfd] px-4 py-4"><p className="mb-3 text-[9px] font-bold uppercase text-[#8c8d9d]">Resumo dos materiais</p><div className="grid gap-2 sm:grid-cols-2">{selectedItems.map((item) => <div className="flex items-center gap-2 rounded-[6px] border border-[#e8e8ef] bg-white p-2.5" key={item.id}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#5147dc] text-white"><WalletCards className="h-3.5 w-3.5" /></span><span className="min-w-0"><strong className="block truncate text-[9px] text-[#4b4c5f]">{item.materials || item.name}</strong><span className="block text-[8px] text-[#999aaa]">{formatQuantity(item.quantity, item.unit)}</span><span className="mt-0.5 block text-[9px] font-bold text-[#353648]">{currency.format(item.price * item.quantity)}</span></span></div>)}</div></div> : null}
      </Card>

      <aside className="xl:sticky xl:top-24">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-[#292a3d]">Resumo do orçamento</h3><WalletCards className="h-4 w-4 text-[#5147dc]" /></div>
          <div className="mt-4 space-y-2.5">
            {selectedItems.map((item) => <div className="flex justify-between gap-3 text-[10px]" key={item.id}><span className="text-[#5f6072]">{item.name} ({item.quantity}x)</span><strong className="whitespace-nowrap text-[#424355]">{currency.format(item.price * item.quantity)}</strong></div>)}
            {selectedItems.length === 0 ? <p className="text-[10px] text-[#858696]">Nenhum procedimento selecionado.</p> : null}
          </div>
          <div className="mt-4 border-t border-[#ececf2] pt-3"><div className="flex items-center justify-between text-xs"><span className="font-bold text-[#393a4d]">Subtotal dos materiais</span><strong className="text-[#424355]">{currency.format(materialsTotal)}</strong></div><p className="mt-4 text-[10px] font-bold text-[#4a4b5d]">Outros custos</p><div className="mt-2 space-y-2 text-[10px] text-[#68697b]"><SummaryLine label="Mão de obra / Honorários" value={currency.format(costs.laborCost)} /><SummaryLine label="Sala / Estrutura" value={currency.format(costs.facilityCost)} /><SummaryLine label="Anestésico / Medicamentos" value={currency.format(costs.medicationCost)} /></div><div className="mt-4 flex items-center justify-between border-t border-[#ececf2] pt-3 text-xs"><span className="font-bold text-[#393a4d]">Total do orçamento</span><strong className="text-base text-[#5147dc]">{currency.format(total)}</strong></div></div>
          <div className="mt-4"><p className="text-[9px] font-bold uppercase text-[#8f90a0]">Forma de pagamento</p><div className="relative mt-2"><select disabled={quoteClosed} className="h-10 w-full appearance-none rounded-[6px] border border-[#dfdfe7] bg-white px-3 pr-9 text-xs font-semibold text-[#505164] outline-none transition focus:border-[#5147dc] focus:ring-2 focus:ring-[#5147dc]/10 disabled:cursor-not-allowed disabled:bg-[#f4f4f8]" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>Cartão de crédito</option><option>Cartão de débito</option><option>Pix</option></select><ChevronDown className="pointer-events-none absolute right-3 top-3 h-3.5 w-3.5 text-[#77788a]" /></div></div>
          <Button className={cn("mt-4 w-full transition-colors", (paymentConfirmed || quoteSaved) && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:bg-[#eaf8ef] hover:text-[#16805d]", !paymentConfirmed && !quoteSaved && saveError && "bg-[#d92d20] hover:bg-[#b42318]", !paymentConfirmed && !quoteSaved && saveShake && "animate-[hp-shake_0.42s_ease-in-out]")} disabled={saving || loading || quoteClosed || paymentConfirmed || quoteSaved} onClick={saveQuote}><Save className="h-4 w-4" />{paymentConfirmed ? "Pagamento registrado" : quoteClosed ? "Proposta aprovada" : saving ? "Salvando..." : quoteSaved ? "Orçamento salvo" : "Salvar orçamento"}</Button>
          <Button className={cn("mt-2 w-full transition-colors", paymentConfirmed && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:bg-[#eaf8ef] hover:text-[#16805d]", !paymentConfirmed && saveError && "border-[#d92d20] text-[#b42318]", !paymentConfirmed && saveShake && "animate-[hp-shake_0.42s_ease-in-out]")} variant="secondary" type="button" disabled={paymentSaving || loading || paymentConfirmed} onClick={openPaymentConfirmation}><WalletCards className="h-4 w-4" />{paymentConfirmed ? "Pagamento confirmado" : "Registrar pagamento"}</Button>
          <Button className="mt-2 w-full" variant="secondary" type="button"><FileDown className="h-4 w-4" />Gerar PDF</Button>
          {notice ? <p className={cn("mt-3 rounded-[6px] px-3 py-2 text-[10px] font-semibold", saveError ? "bg-[#fff1f0] text-[#b42318]" : "bg-[#eef8f2] text-[#287a50]")}>{notice}</p> : null}
          <div className="mt-4 rounded-[6px] border border-[#e8e8ef] bg-[#fafafd] p-3"><p className="flex items-center gap-2 text-[10px] font-bold text-[#454659]"><Info className="h-3.5 w-3.5 text-[#5147dc]" />Observações</p><p className="mt-2 text-[10px] leading-4 text-[#77788a]">Os valores são carregados dos procedimentos cadastrados pela clínica.</p></div>
        </Card>
      </aside>
      <Modal open={confirmPayment} onClose={() => setConfirmPayment(false)} title="Confirmar pagamento" description="Confira os dados antes de registrar este pagamento.">
        <div className="space-y-4">
          <div className="rounded-[7px] border border-[#e5e5ee] bg-[#fafafd] p-4"><p className="text-xs text-[#77788a]">Valor a registrar</p><p className="mt-1 text-xl font-black text-[#5147dc]">{currency.format(total)}</p><p className="mt-2 text-xs text-[#555668]">Forma: <strong>{paymentMethod}</strong></p></div>
          <p className="text-xs leading-5 text-[#65708b]">Tem certeza que deseja registrar este pagamento como pago?</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setConfirmPayment(false)}>Cancelar</Button><Button disabled={paymentSaving} type="button" onClick={registerPayment}>{paymentSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{paymentSaving ? "Registrando..." : "Confirmar pagamento"}</Button></div>
        </div>
      </Modal>
      {paymentNotice ? <div className={`${paymentNoticeLeaving ? "hp-snackbar-exit" : "hp-snackbar-enter"} fixed bottom-6 left-1/2 z-[90] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-[8px] bg-[#25263a] px-4 py-3 text-xs font-bold text-white shadow-[0_18px_45px_rgba(31,32,50,0.24)]`}><div className="flex items-center gap-3"><span className="min-w-0 flex-1">Pagamento registrado com sucesso.</span><button className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-black transition hover:bg-white/20" onClick={undoPayment} disabled={!canReopen} title={canReopen ? undefined : "Só administrador ou profissional pode desfazer um pagamento"}>Desfazer</button></div><div className="hp-snackbar-progress mt-3 h-1 rounded-full bg-[#7cffb2]" style={{ "--snackbar-duration": "6500ms" } as CSSProperties} /></div> : null}
    </div>
  );
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
type StoredQuoteDetails = { items: Array<{ procedureId: string; name: string; quantity: number; unitPriceCents: number; discountCents: number; subtotalCents: number }>; subtotalCents: number; discountCents: number; totalCents: number; costs?: { laborCents: number; facilityCents: number; medicationCents: number } };
const quoteStatusLabels: Record<string, string> = { Rascunho: "Rascunho", Pendente: "Rascunho", Enviado: "Enviado", Aprovado: "Aprovado", Pago: "Pago", Recusado: "Recusado", Cancelado: "Cancelado" };
const quotePaymentMethods = ["Cartão de crédito", "Pix", "Dinheiro", "Cartão de débito", "Boleto", "Transferência"];

function EncounterQuoteWorkspace({ patientId, journeyId, patient, evaluationId, onReturnToEvaluation, onAdvance }: PatientExpensesProps) {
  const quoteKey = `/api/quotes?patientId=${encodeURIComponent(patientId)}&journeyId=${encodeURIComponent(journeyId ?? "")}`;
  const evaluationKey = `/api/patients/${encodeURIComponent(patientId)}/evaluation?summary=1&evaluationId=${encodeURIComponent(evaluationId ?? "")}`;
  const cachedQuotes = readClientCache<{ quotes?: PatientQuote[] }>(quoteKey);
  const cachedOptions = readClientCache<QuoteOptionsResponse>("/api/quotes/options");
  const cachedEvaluation = evaluationId ? readClientCache<{ evaluation?: EvaluationSummaryData | null }>(evaluationKey) : undefined;
  const [quotes, setQuotes] = useState(cachedQuotes?.quotes ?? []);
  const [procedures, setProcedures] = useState(cachedOptions?.procedures ?? []);
  const [costs, setCosts] = useState(cachedOptions?.costs ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 });
  const [evaluation, setEvaluation] = useState<EvaluationSummaryData | null>(cachedEvaluation?.evaluation ?? null);
  const [loading, setLoading] = useState(!cachedQuotes || !cachedOptions || !cachedEvaluation);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [newRevision, setNewRevision] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [lines, setLines] = useState<QuoteLineInput[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("Cartão de crédito");
  const [installments, setInstallments] = useState(1);
  const [notes, setNotes] = useState("");
  const [initializedQuoteId, setInitializedQuoteId] = useState<string | null>(null);
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
      const nextQuote = nextQuotes.find((quote) => quote.evaluationId === evaluationId);
      setQuotes(nextQuotes);
      setProcedures(nextProcedures);
      setCosts(optionData.costs ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 });
      setEvaluation(evaluationData.evaluation ?? null);
      setSelectedQuoteId(nextQuote?.id ?? null);
      setLines(restoreQuoteLines(nextQuote, nextProcedures));
      setPaymentMethod(nextQuote?.paymentMethod ?? "Cartão de crédito");
      setInstallments(nextQuote?.installments ?? 1);
      setNotes(nextQuote?.notes ?? "");
      setInitializedQuoteId(nextQuote?.id ?? "__new__");
      setLoadError(false);
    }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [patientId, journeyId, evaluationId, quoteKey, evaluationKey, retry]);

  const relatedQuotes = useMemo(() => quotes.filter((quote) => quote.evaluationId === evaluationId), [quotes, evaluationId]);
  const activeQuote = newRevision ? undefined : relatedQuotes.find((quote) => quote.id === selectedQuoteId) ?? relatedQuotes[0];
  const editable = !activeQuote || ["Rascunho", "Pendente"].includes(activeQuote.status);
  const catalogPrices = procedures.map((procedure) => ({ id: procedure.id, name: procedure.name, priceCents: Math.round(procedure.price * 100) }));
  const calculated = calculateQuote(lines, catalogPrices, { laborCents: Math.round(costs.laborCost * 100), facilityCents: Math.round(costs.facilityCost * 100), medicationCents: Math.round(costs.medicationCost * 100) });
  const total = calculated?.totalCents ?? 0;
  const quoteSignature = `${JSON.stringify(lines)}|${paymentMethod}|${installments}|${notes}`;
  const savedLines = parseQuoteDetails(activeQuote?.details)?.items.map((item) => ({ procedureId: item.procedureId, quantity: item.quantity, discountCents: item.discountCents })) ?? [];
  const initialSignature = activeQuote ? `${JSON.stringify(savedLines)}|${activeQuote.paymentMethod ?? "Cartão de crédito"}|${activeQuote.installments ?? 1}|${activeQuote.notes ?? ""}` : "";
  const saved = Boolean(activeQuote?.id && initializedQuoteId === activeQuote.id && quoteSignature === initialSignature);

  function updateLine(procedureId: string, changes: Partial<QuoteLineInput>) {
    setLines((current) => current.map((line) => line.procedureId === procedureId ? { ...line, ...changes } : line));
    setNotice(null);
  }

  function addProcedure(procedureId: string) {
    if (!procedureId || lines.some((line) => line.procedureId === procedureId)) return;
    setLines((current) => [...current, { procedureId, quantity: 1, discountCents: 0 }]);
    setNotice(null);
  }

  async function saveDraft() {
    if (!calculated || !evaluationId || !journeyId) { setNotice({ error: true, text: "Adicione ao menos um procedimento e confira os descontos." }); return null; }
    setSaving(true); setNotice(null);
    try {
      const response = await fetch(activeQuote ? `/api/quotes/${activeQuote.id}` : "/api/quotes", {
        method: activeQuote ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, journeyId, evaluationId, details: lines, paymentMethod, installments, notes, status: activeQuote ? undefined : "Rascunho" }),
      });
      const data = await response.json().catch(() => ({})) as { quote?: PatientQuote; message?: string };
      if (!response.ok || !data.quote) throw new Error(data.message ?? "Não foi possível salvar o orçamento.");
      invalidateClientCache(quoteKey, "/api/quotes", `/api/patients/${patientId}/history`, `/api/patients/${patientId}/profile`, "/api/dashboard/bootstrap");
      setQuotes((current) => current.some((quote) => quote.id === data.quote!.id) ? current.map((quote) => quote.id === data.quote!.id ? data.quote! : quote) : [data.quote!, ...current]);
      setSelectedQuoteId(data.quote.id); setNewRevision(false); setInitializedQuoteId(data.quote.id);
      setNotice({ error: false, text: "Rascunho salvo. Nenhum pagamento foi registrado." });
      return data.quote;
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "Não foi possível salvar o orçamento." });
      return null;
    } finally { setSaving(false); }
  }

  async function changeStatus(status: "Enviado" | "Aprovado" | "Recusado" | "Cancelado") {
    const quote = activeQuote && saved ? activeQuote : await saveDraft();
    if (!quote) return;
    if (status === "Enviado" && !window.confirm("Confirma que a proposta já foi enviada ao paciente?")) return;
    setStatusBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/quotes/${quote.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const data = await response.json().catch(() => ({})) as { quote?: PatientQuote; message?: string };
      if (!response.ok || !data.quote) throw new Error(data.message ?? "Não foi possível atualizar o status do orçamento.");
      invalidateClientCache(quoteKey, "/api/quotes", `/api/patients/${patientId}/history`, `/api/patients/${patientId}/profile`);
      setQuotes((current) => current.map((item) => item.id === quote.id ? data.quote! : item));
      setNotice({ error: false, text: status === "Enviado" ? "Envio registrado." : `Orçamento ${status.toLocaleLowerCase("pt-BR")} sem registrar recebimento.` });
      if (["Recusado", "Cancelado"].includes(status)) { setNewRevision(true); setLines([]); setPaymentMethod("Cartão de crédito"); setInstallments(1); setNotes(""); setInitializedQuoteId("__new__"); }
    } catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : "Não foi possível atualizar o orçamento." }); }
    finally { setStatusBusy(false); }
  }

  function generatePdf() {
    if (!calculated) { setNotice({ error: true, text: "Adicione ao menos um procedimento antes de gerar a proposta." }); return; }
    setPdfNotice(false);
    const popup = window.open("", "_blank", "width=900,height=720");
    if (!popup) { setPdfNotice(true); return; }
    const escape = (value: string) => value.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
    const rows = calculated.items.map((item) => `<tr><td>${escape(item.name)}</td><td>${item.quantity}</td><td>${currency.format(item.unitPriceCents / 100)}</td><td>${currency.format(item.discountCents / 100)}</td><td>${currency.format(item.subtotalCents / 100)}</td></tr>`).join("");
    popup.document.write(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Proposta Harmonize+</title><style>body{font:14px Arial,sans-serif;color:#242538;margin:48px}h1{font-size:24px}p{color:#666}table{width:100%;border-collapse:collapse;margin:28px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd}th{background:#f3f2ff}.total{text-align:right;font-size:20px;font-weight:bold;color:#5147dc} @media print{body{margin:20mm}}</style><h1>Proposta de tratamento</h1><p>${escape(evaluation?.patientGoal || "Objetivo não informado")}</p><p>Status: ${escape(quoteStatusLabels[activeQuote?.status ?? "Rascunho"] ?? "Rascunho")} · ${new Date().toLocaleDateString("pt-BR")}</p><table><thead><tr><th>Procedimento</th><th>Qtd.</th><th>Valor unitário</th><th>Desconto</th><th>Subtotal</th></tr></thead><tbody>${rows}</tbody></table><p>Forma de pagamento: ${escape(paymentMethod)}${paymentMethod === "Cartão de crédito" ? ` · ${installments}x` : ""}</p>${notes ? `<p>Observações: ${escape(notes)}</p>` : ""}<p class="total">Total: ${currency.format(total / 100)}</p><script>window.onload=()=>window.print()</script></html>`);
    popup.document.close();
    setPdfGenerated(true);
  }

  if (!evaluationId || !journeyId) return <Card className="p-6 text-center text-sm text-[#b42318]">Esta avaliação não está vinculada a um tratamento. Volte à avaliação e tente novamente.</Card>;
  if (loading) return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px]"><Card className="space-y-4 p-5"><LoadingSkeleton className="h-8 w-1/3" /><LoadingSkeleton className="h-12 w-full" /><LoadingSkeleton className="h-44 w-full" /></Card><Card className="space-y-3 p-5"><LoadingSkeleton className="h-8 w-1/2" /><LoadingSkeleton className="h-16 w-full" /></Card></div>;
  if (loadError || !evaluation) return <Card className="space-y-3 p-6 text-center"><p className="text-sm font-semibold text-[#b42318]">{loadError ? "Não foi possível carregar os dados para o orçamento." : "A avaliação vinculada não foi encontrada."}</p>{loadError ? <Button variant="outline" onClick={() => { setLoadError(false); setLoading(true); setRetry((current) => current + 1); }}>Tentar novamente</Button> : null}</Card>;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#ece9ff] text-sm font-black text-[#5147dc]">{(patient?.name ?? "Paciente").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div className="min-w-0"><h2 className="truncate text-base font-bold text-[#242538]">{patient?.name ?? "Paciente"}</h2><p className="text-[10px] text-[#77788a]">{patient?.age ? `${patient.age} anos · ` : ""}{patient?.phone ?? "Telefone não informado"} · {patient?.status ?? "Status não informado"}</p><p className="text-[9px] text-[#858696]">Paciente desde {patient?.createdAt ? new Date(patient.createdAt).toLocaleDateString("pt-BR") : "data não informada"} · Novo atendimento · Etapa 2 de 4</p></div></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={onReturnToEvaluation}><ArrowLeft className="h-4 w-4" />Voltar para avaliação</Button><Button disabled={!activeQuote || !["Aprovado", "Pago"].includes(activeQuote.status) || saving} onClick={() => { if (activeQuote) onAdvance?.(activeQuote.id); }}><ArrowRight className="h-4 w-4" />Avançar para procedimento</Button></div>
      </Card>
      <div className="flex items-center gap-2 overflow-x-auto px-2 py-1 text-[10px] font-semibold text-[#747587]" aria-label="Progresso do atendimento">{["Avaliação", "Orçamento", "Procedimento", "Pós-procedimento"].map((stage, index) => <div key={stage} className="flex min-w-0 flex-1 items-center gap-2"><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", index < 1 ? "bg-[#5147dc] text-white" : index === 1 ? "bg-[#5147dc] text-white" : "bg-[#e6e7ef] text-[#747587]")}>{index < 1 ? <Check className="h-4 w-4" /> : index + 1}</span><span className={index === 1 ? "text-[#3f35d6]" : "whitespace-nowrap"}>{stage}</span>{index < 3 ? <span className={cn("h-px min-w-3 flex-1", index < 1 ? "bg-[#5147dc]" : "bg-[#dfe0e8]")} /> : null}</div>)}</div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="border-b border-[#ececf2] px-4 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-[#27283b]">Orçamento do tratamento</h3><p className="mt-1 text-[10px] text-[#858696]">Vinculado à avaliação de {new Date(evaluation.createdAt).toLocaleDateString("pt-BR")} · {evaluation.professional || "Profissional não informado"}</p></div>{activeQuote ? <span className="rounded-full bg-[#f0efff] px-3 py-1 text-[10px] font-bold text-[#5147dc]">{quoteStatusLabels[activeQuote.status] ?? activeQuote.status}</span> : null}{activeQuote && ["Recusado", "Cancelado"].includes(activeQuote.status) ? <Button size="sm" variant="outline" type="button" onClick={() => { setSelectedQuoteId(null); setNewRevision(true); setLines([]); setPaymentMethod("Cartão de crédito"); setInstallments(1); setNotes(""); setInitializedQuoteId("__new__"); }}>Nova proposta</Button> : null}</div>
              <div className="mt-4 rounded-[6px] bg-[#f3f1ff] px-3 py-2.5 text-xs text-[#4d4b68]"><strong className="text-[#3a31c8]">Objetivo:</strong> {evaluation.patientGoal.trim() || "Não informado na avaliação."}</div>
              <p className="mt-3 text-[10px] text-[#707184]"><strong>Queixa principal:</strong> {evaluation.chiefComplaint.trim() || "Não informado"}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4"><div><h4 className="text-xs font-bold text-[#353648]">Procedimentos sugeridos</h4><p className="mt-0.5 text-[9px] text-[#858696]">Selecione do catálogo da clínica conforme o objetivo da avaliação.</p></div><label className="relative min-w-56"><select aria-label="Adicionar procedimento do catálogo" disabled={!editable || procedures.length === 0} className="h-9 w-full appearance-none rounded-[6px] border border-[#dddde6] bg-white px-3 pr-8 text-[11px] font-semibold text-[#555668] outline-none focus:border-[#5147dc] disabled:opacity-60" value="" onChange={(event) => addProcedure(event.target.value)}><option value="">{procedures.length ? "Adicionar procedimento" : "Nenhum procedimento cadastrado"}</option>{procedures.filter((procedure) => !lines.some((line) => line.procedureId === procedure.id)).map((procedure) => <option key={procedure.id} value={procedure.id}>{procedure.name} · {currency.format(procedure.price)}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-[#77788a]" /></label></div>
            <div className="overflow-x-auto px-4 pb-4"><table className="w-full min-w-[720px] border-collapse text-left text-[10px]"><thead><tr className="bg-[#f7f7fb] text-[#77798d]"><th className="rounded-l-[5px] px-3 py-2.5 font-bold">Procedimento</th><th className="px-3 py-2.5 font-bold">Quantidade</th><th className="px-3 py-2.5 font-bold">Valor unitário</th><th className="px-3 py-2.5 font-bold">Desconto</th><th className="rounded-r-[5px] px-3 py-2.5 font-bold">Subtotal</th><th className="w-9" /></tr></thead><tbody>{lines.map((line) => {
              const procedure = procedures.find((item) => item.id === line.procedureId);
              const unitCents = Math.round((procedure?.price ?? 0) * 100);
              const subtotal = Math.max(0, unitCents * line.quantity - line.discountCents);
              return <tr className="border-b border-[#eeeeF3]" key={line.procedureId}><td className="px-3 py-3"><strong className="block text-[#3f4053]">{procedure?.name ?? "Procedimento indisponível"}</strong><span className="text-[9px] text-[#999aaa]">{procedure?.materials || procedure?.category || "Catálogo da clínica"}</span></td><td className="px-3 py-3"><select aria-label={`Quantidade de ${procedure?.name ?? "procedimento"}`} disabled={!editable} className="h-8 rounded-[5px] border border-[#dddde6] bg-white px-2 text-[10px]" value={line.quantity} onChange={(event) => updateLine(line.procedureId, { quantity: Number(event.target.value) })}>{Array.from({ length: 20 }, (_, index) => index + 1).map((quantity) => <option key={quantity} value={quantity}>{quantity}</option>)}</select></td><td className="px-3 py-3 font-semibold">{currency.format(unitCents / 100)}</td><td className="px-3 py-3"><input aria-label={`Desconto de ${procedure?.name ?? "procedimento"}`} disabled={!editable} className="h-8 w-28 rounded-[5px] border border-[#dddde6] px-2 text-[10px] disabled:bg-[#f4f4f8]" type="number" min="0" max={unitCents * line.quantity / 100} step="0.01" value={(line.discountCents / 100).toFixed(2)} onChange={(event) => updateLine(line.procedureId, { discountCents: Math.max(0, Math.min(unitCents * line.quantity, Math.round(Number(event.target.value) * 100))) })} /></td><td className="px-3 py-3 font-bold text-[#343548]">{currency.format(subtotal / 100)}</td><td className="px-2 py-3"><button type="button" aria-label={`Remover ${procedure?.name ?? "procedimento"}`} title="Remover item" disabled={!editable} className="rounded p-1 text-[#b42318] disabled:opacity-40" onClick={() => setLines((current) => current.filter((item) => item.procedureId !== line.procedureId))}><XCircle className="h-4 w-4" /></button></td></tr>;
            })}{lines.length === 0 ? <tr><td className="px-3 py-8 text-center text-[#858696]" colSpan={6}>Selecione procedimentos do catálogo para montar a proposta.</td></tr> : null}</tbody></table></div>
          </Card>

          <Card className="p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><CreditCard className="h-4 w-4 text-[#5147dc]" />Condições de pagamento</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{quotePaymentMethods.map((method) => <button key={method} type="button" disabled={!editable} aria-pressed={paymentMethod === method} onClick={() => { setPaymentMethod(method); if (method !== "Cartão de crédito") setInstallments(1); }} className={cn("flex min-h-14 items-center gap-2 rounded-[6px] border px-3 text-left text-[10px] font-bold transition", paymentMethod === method ? "border-[#5147dc] bg-[#f3f1ff] text-[#3f35d6]" : "border-[#e5e5ee] bg-white text-[#555668] hover:bg-[#fafafd]", !editable && "cursor-not-allowed opacity-60")}><span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", paymentMethod === method ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#c8c9d5]")}>{paymentMethod === method ? <Check className="h-3 w-3" /> : null}</span><span>{method}<small className="mt-0.5 block font-normal text-[#858696]">{method === "Cartão de crédito" ? "Parcelamento disponível" : "Pagamento à vista"}</small></span></button>)}</div>{paymentMethod === "Cartão de crédito" ? <label className="mt-3 block max-w-xs text-[10px] font-semibold text-[#68697b]">Número de parcelas<select disabled={!editable} className="mt-1 h-9 w-full rounded-[5px] border border-[#dddde6] bg-white px-2 text-xs" value={installments} onChange={(event) => setInstallments(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option value={count} key={count}>{count}x de {currency.format(count ? Math.ceil(total / count) / 100 : 0)}</option>)}</select></label> : null}<p className="mt-2 rounded-[5px] bg-[#f7f7fb] p-2.5 text-[10px] text-[#68697b]">Forma de pagamento é apenas uma condição da proposta. Nenhum recebimento será lançado por essa seleção.</p></Card>

          <Card className="p-4"><label className="block text-sm font-bold text-[#292a3d]" htmlFor="quote-notes">Observações do orçamento</label><textarea id="quote-notes" disabled={!editable} maxLength={2000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Condições comerciais, validade ou orientações para o paciente" className="mt-3 w-full resize-y rounded-[6px] border border-[#dddde6] bg-white p-3 text-xs text-[#454659] outline-none focus:border-[#5147dc] disabled:bg-[#f4f4f8]" /><div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={saving || !calculated} onClick={generatePdf}><FileDown className="h-4 w-4" />Gerar PDF</Button>{activeQuote?.status === "Rascunho" || activeQuote?.status === "Pendente" ? <Button type="button" variant="outline" disabled={statusBusy || saving} onClick={() => void changeStatus("Enviado")}><Send className="h-4 w-4" />Registrar envio</Button> : null}<Button type="button" disabled={saving || !editable || saved} onClick={() => void saveDraft()}><Save className="h-4 w-4" />{saving ? "Salvando..." : saved ? "Rascunho salvo" : "Salvar rascunho"}</Button></div>{notice ? <p role="status" className={cn("mt-3 rounded-[5px] px-3 py-2 text-[10px] font-semibold", notice.error ? "bg-[#fff1f0] text-[#b42318]" : "bg-[#eef8f2] text-[#287a50]")}>{notice.text}</p> : null}{pdfNotice ? <p className="mt-2 text-xs text-[#b42318]">O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.</p> : null}</Card>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-24 xl:self-start">
          <Card className="space-y-2 p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><Info className="h-4 w-4 text-[#5147dc]" />Resumo do atendimento</h3>{[["Etapa atual", "Orçamento"], ["Profissional", evaluation.professional || "Não informado"], ["Data da avaliação", new Date(evaluation.createdAt).toLocaleDateString("pt-BR")], ["Status", quoteStatusLabels[activeQuote?.status ?? "Rascunho"] ?? "Rascunho"]].map(([label, value]) => <div key={label} className="flex justify-between gap-2 rounded-[5px] bg-[#f7f7fb] px-2.5 py-2 text-[10px]"><span className="text-[#68697b]">{label}</span><strong>{value}</strong></div>)}{activeQuote?.approvedAt ? <p className="pt-1 text-[9px] text-[#77788a]">Aprovado em {new Date(activeQuote.approvedAt).toLocaleString("pt-BR")} por {activeQuote.approvedBy || "responsável não informado"}</p> : null}</Card>
          <Card className="space-y-3 p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><WalletCards className="h-4 w-4 text-[#5147dc]" />Resumo financeiro</h3><SummaryLine label="Itens" value={String(calculated?.items.length ?? 0)} /><SummaryLine label="Subtotal" value={currency.format((calculated?.subtotalCents ?? 0) / 100)} /><SummaryLine label="Desconto" value={currency.format((calculated?.discountCents ?? 0) / 100)} /><SummaryLine label="Custos da clínica" value={currency.format((calculated?.costTotalCents ?? 0) / 100)} /><div className="flex justify-between rounded-[5px] bg-[#f3f1ff] px-3 py-2 text-xs font-bold"><span>Valor final</span><strong className="text-[#5147dc]">{currency.format(total / 100)}</strong></div><div className="rounded-[5px] bg-[#eef8f2] px-3 py-2 text-[10px] font-semibold text-[#287a50]">{activeQuote?.status === "Aprovado" ? "Proposta aprovada · sem recebimento registrado" : activeQuote?.status === "Enviado" ? "Aguardando aprovação do paciente" : activeQuote?.status === "Recusado" ? "Proposta recusada" : activeQuote?.status === "Cancelado" ? "Proposta cancelada" : "Rascunho do orçamento"}</div></Card>
          <Card className="space-y-2 p-4"><h3 className="text-sm font-bold">Checklist do orçamento</h3>{[["Itens adicionados", Boolean(lines.length)], ["Forma definida", Boolean(paymentMethod)], ["PDF gerado", pdfGenerated], ["Envio registrado", Boolean(activeQuote?.sentAt)]].map(([label, done]) => <div key={String(label)} className="flex items-center gap-2 rounded-[5px] bg-[#f7f7fb] px-2.5 py-2 text-[10px]"><span className={cn("grid h-4 w-4 place-items-center rounded-[3px] border", done ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#c9cad6]")}>{done ? <Check className="h-3 w-3" /> : null}</span>{label}</div>)}</Card>
          <Card className="space-y-2 p-4"><h3 className="text-sm font-bold">Próximas ações</h3>{activeQuote?.status === "Enviado" ? <><Button className="w-full justify-between" type="button" variant="outline" disabled={statusBusy} onClick={() => void changeStatus("Aprovado")}><span className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-[#16805d]" />Aprovar proposta</span><ArrowRight className="h-4 w-4" /></Button><Button className="w-full justify-between" type="button" variant="outline" disabled={statusBusy} onClick={() => void changeStatus("Recusado")}><span className="flex items-center gap-2"><XCircle className="h-4 w-4 text-[#b42318]" />Registrar recusa</span><ArrowRight className="h-4 w-4" /></Button></> : null}{activeQuote && !["Aprovado", "Pago", "Recusado", "Cancelado"].includes(activeQuote.status) ? <Button className="w-full justify-between" type="button" variant="outline" disabled={statusBusy} onClick={() => void changeStatus("Cancelado")}><span className="flex items-center gap-2"><Ban className="h-4 w-4 text-[#b42318]" />Cancelar orçamento</span><ArrowRight className="h-4 w-4" /></Button> : null}{activeQuote ? <p className="flex items-center gap-2 pt-1 text-[9px] text-[#77788a]"><Clock3 className="h-3.5 w-3.5" />Última alteração: {activeQuote.updatedAt ? new Date(activeQuote.updatedAt).toLocaleString("pt-BR") : "Não informado"} · {activeQuote.updatedBy || activeQuote.createdBy || "Responsável não informado"}</p> : null}</Card>
        </aside>
      </div>
    </div>
  );
}

function parseQuoteDetails(value?: string | null): StoredQuoteDetails | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as StoredQuoteDetails;
    return Array.isArray(parsed.items) ? parsed : null;
  } catch { return null; }
}

function restoreQuoteLines(quote: PatientQuote | undefined, procedures: ProcedureOption[]): QuoteLineInput[] {
  if (!quote) return [];
  const stored = parseQuoteDetails(quote.details);
  if (stored?.items.length) return stored.items.map((item) => ({ procedureId: item.procedureId, quantity: item.quantity, discountCents: item.discountCents }));
  return procedures.flatMap((procedure) => {
    const match = quote.items.split(", ").find((item) => item.startsWith(`${procedure.name} (`));
    const quantity = Number(match?.match(/\((\d+)x\)/)?.[1] ?? 0);
    return quantity ? [{ procedureId: procedure.id, quantity, discountCents: 0 }] : [];
  });
}
