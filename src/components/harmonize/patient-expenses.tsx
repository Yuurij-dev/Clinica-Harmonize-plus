"use client";

import { CalendarPlus, Check, ChevronDown, CirclePlus, FileDown, Info, LoaderCircle, Save, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { getCachedJson, readClientCache, invalidateClientCache } from "@/lib/client-cache";
import { cn } from "@/lib/utils";
import { ListAccordion } from "./list-accordion";
import { LoadingSkeleton } from "./shared";

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
type PatientQuote = { id: string; items: string; total: number; status: string; paymentMethod?: string | null; createdAt?: string };
type SelectedProcedure = ProcedureOption & { quantity: number; unit: string };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NEW_QUOTE_ID = "__new__";

export function PatientExpenses({ patientId, journeyId, onPaid, onPaymentUndone }: { patientId: string; journeyId?: string; onPaid?: () => void; onPaymentUndone?: () => void }) {
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
  const paid = ["Aprovado", "Pago"].includes(status);
  return (
    <>
      <span className={cn("rounded-full px-2 py-1 text-[10px] font-bold", paid ? "bg-[#eaf8ef] text-[#16805d]" : "bg-[#fff6e5] text-[#a15c07]")}>{paid ? "Pago" : status}</span>
      <strong className="hidden text-xs text-[#424355] sm:inline">{currency.format(total)}</strong>
    </>
  );
}

function formatQuoteTitle(items: string) {
  return items.replace(/\((\d+)x\)/g, "($1X)");
}

function QuoteCalculator({ patientId, journeyId, quote, onSaved, onPaid, onPaymentUndone, onStatusChange }: { patientId: string; journeyId?: string; quote?: PatientQuote; onSaved: (quote: PatientQuote) => void; onPaid?: () => void; onPaymentUndone?: () => void; onStatusChange: (quoteId: string, status: string) => void }) {
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
  const [latestQuoteId, setLatestQuoteId] = useState<string | null>(quote?.id ?? null);
  const [savedQuoteSignature, setSavedQuoteSignature] = useState<string | null>(quote ? `${quote.items}|${quote.total}|${quote.paymentMethod ?? "Cartão de crédito"}` : null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(quote ? ["Aprovado", "Pago"].includes(quote.status) : false);
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
      invalidateClientCache("/api/quotes", "/api/patients", "/api/dashboard/bootstrap");
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
    try {
      const response = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, journeyId, value: total, method: paymentMethod, status: "Pago", installments: "A vista" }) });
      const data = await response.json() as { payment?: { id: string }; message?: string };
      if (!response.ok || !data.payment) throw new Error(data.message ?? "Não foi possível registrar o pagamento.");
      const quoteResponse = await fetch(`/api/quotes/${latestQuoteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Aprovado" }) });
      if (!quoteResponse.ok) throw new Error("Pagamento registrado, mas não foi possível concluir o orçamento.");
      invalidateClientCache("/api/payments", "/api/dashboard/bootstrap", `/api/patients/${patientId}/history`);
      invalidateClientCache("/api/quotes", "/api/patients");
      setPaymentConfirmed(true);
      onStatusChange(latestQuoteId, "Aprovado");
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
    const quoteResponse = latestQuoteId ? await fetch(`/api/quotes/${latestQuoteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Pendente" }) }) : null;
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
    if (latestQuoteId) onStatusChange(latestQuoteId, "Pendente");
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
                    <button className="flex min-w-0 items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-70" disabled={paymentConfirmed} onClick={() => toggleProcedure(procedure.id)}>
                      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border", checked ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#cfd0da] bg-white text-transparent")}><Check className="h-3 w-3" /></span>
                        <span className="min-w-0"><strong className="block truncate text-[#3f4053]">{procedure.name}</strong><span className="mt-0.5 block truncate text-[8px] text-[#999aaa]">{procedure.materials || procedure.category}</span></span>
                    </button>
                    <label className="relative block w-[82px]">
                      <select aria-label={`Quantidade de ${procedure.name}`} disabled={paymentConfirmed} className="h-8 w-full appearance-none rounded-[5px] border border-[#dddde6] bg-white px-2 pr-6 text-[10px] font-semibold text-[#555668] outline-none focus:border-[#5147dc] disabled:cursor-not-allowed disabled:bg-[#f4f4f8] focus:border-[#5147dc]" value={quantity || 1} onChange={(event) => updateQuantity(procedure.id, Number(event.target.value))}>
                        {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{formatQuantity(value, procedureUnit(procedure))}</option>)}
                      </select><ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3 w-3 text-[#77788a]" />
                    </label>
                    <span className="font-semibold text-[#555668]">{currency.format(procedure.price)}</span>
                    <span className={cn("font-bold", checked ? "text-[#353648]" : "text-[#a2a3b0]")}>{currency.format(procedure.price * (checked ? quantity : 1))}</span>
                  </div>
                );
              })}
            </div>
            <Button className="mt-3" variant="secondary" size="sm" type="button" disabled={paymentConfirmed}><CirclePlus className="h-3.5 w-3.5" />Adicionar procedimento / material</Button>
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
          <div className="mt-4"><p className="text-[9px] font-bold uppercase text-[#8f90a0]">Forma de pagamento</p><div className="relative mt-2"><select disabled={paymentConfirmed} className="h-10 w-full appearance-none rounded-[6px] border border-[#dfdfe7] bg-white px-3 pr-9 text-xs font-semibold text-[#505164] outline-none transition focus:border-[#5147dc] focus:ring-2 focus:ring-[#5147dc]/10 disabled:cursor-not-allowed disabled:bg-[#f4f4f8]" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>Cartão de crédito</option><option>Cartão de débito</option><option>Pix</option></select><ChevronDown className="pointer-events-none absolute right-3 top-3 h-3.5 w-3.5 text-[#77788a]" /></div></div>
          <Button className={cn("mt-4 w-full transition-colors", (paymentConfirmed || quoteSaved) && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:bg-[#eaf8ef] hover:text-[#16805d]", !paymentConfirmed && !quoteSaved && saveError && "bg-[#d92d20] hover:bg-[#b42318]", !paymentConfirmed && !quoteSaved && saveShake && "animate-[hp-shake_0.42s_ease-in-out]")} disabled={saving || loading || paymentConfirmed || quoteSaved} onClick={saveQuote}><Save className="h-4 w-4" />{paymentConfirmed ? "Pagamento confirmado" : saving ? "Salvando..." : quoteSaved ? "Orçamento salvo" : "Salvar orçamento"}</Button>
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
      {paymentNotice ? <div className={`${paymentNoticeLeaving ? "hp-snackbar-exit" : "hp-snackbar-enter"} fixed bottom-6 left-1/2 z-[90] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-[8px] bg-[#25263a] px-4 py-3 text-xs font-bold text-white shadow-[0_18px_45px_rgba(31,32,50,0.24)]`}><div className="flex items-center gap-3"><span className="min-w-0 flex-1">Pagamento registrado com sucesso.</span><button className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-black transition hover:bg-white/20" onClick={undoPayment}>Desfazer</button></div><div className="hp-snackbar-progress mt-3 h-1 rounded-full bg-[#7cffb2]" style={{ "--snackbar-duration": "6500ms" } as CSSProperties} /></div> : null}
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
