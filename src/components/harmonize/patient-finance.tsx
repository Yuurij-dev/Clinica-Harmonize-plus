"use client";

import { useState } from "react";
import { ExternalLink, FileDown, Search, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { documentPageSizes } from "@/lib/clinical-files-rules";
import {
  financeIndicators, filterPayments, filterQuotes, formatQuoteTitle, matchPaymentQuotes, paginateList, paymentGroupCounts, paymentGroupFilters, paymentStatusGroup, quoteGroupCounts, quoteGroupFilters, quotePaymentBlockReason, quoteStatusGroup, quoteStatusLabel, receivedCents,
  type FinancePayment, type FinanceQuote, type PaymentGroupFilter, type QuoteGroupFilter, type SortOrder,
} from "@/lib/patient-finance-rules";
import { buildQuoteProposalHtml, openQuoteProposal, proposalRowsFromQuote, quoteFinancialSnapshot } from "@/lib/quote-proposal";
import { cn } from "@/lib/utils";
import { PaginationBar } from "./clinical-pagination";
import { useCan } from "./current-user";
import { formatDate, useCachedResource } from "./patient-clinical-data";
import { FilterSelect } from "./patient-clinical-documents";
import { EmptyState, LoadingSkeleton } from "./shared";

type QuoteRecord = FinanceQuote & { details?: string | null; notes?: string | null; installments?: number; paymentMethod?: string | null; expires?: string | null; paymentConfirmed?: boolean; patient?: { name?: string | null; cpf?: string | null } | null; evaluation?: { professional?: string | null } | null; clinic?: { name?: string | null } | null };
type PaymentRecord = FinancePayment & { method: string; installments: string };
type View = "quotes" | "payments";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (cents: number) => currency.format(cents / 100);
const quoteBadge = { open: "amber", approved: "blue", paid: "green", closed: "red" } as const;

function paymentLabel(quote: Pick<QuoteRecord, "paymentMethod" | "installments">) {
  const method = quote.paymentMethod || "Cartão de crédito";
  return method === "Cartão de crédito" ? `${method} · ${quote.installments ?? 1}x` : method;
}

// Aba Financeiro: leitura de orçamentos e pagamentos. Orçamento nasce e é pago na jornada do tratamento.
export function PatientFinance({ patientId, onOpenJourney, onRegisterPayment }: { patientId: string; onOpenJourney: (journeyId: string) => void; onRegisterPayment: (journeyId: string, quoteId: string) => void }) {
  const canPayments = useCan("payments:access");
  const encoded = encodeURIComponent(patientId);
  // Chaves iguais às usadas pelo restante da ficha para compartilhar o cache.
  const quotes = useCachedResource<{ quotes?: QuoteRecord[] }>(patientId ? `/api/quotes?patientId=${encoded}&journeyId=` : "");
  const journeys = useCachedResource<{ journeys?: Array<{ id: string; name: string }> }>(patientId ? `/api/patients/${encoded}/journeys` : "");
  const payments = useCachedResource<{ patient?: { payments?: PaymentRecord[] } }>(patientId && canPayments ? `/api/patients/${patientId}/history?tab=Pagamentos` : "");
  const [requestedView, setView] = useState<View>("quotes");
  const view: View = canPayments ? requestedView : "quotes";
  const [quoteGroup, setQuoteGroup] = useState<QuoteGroupFilter>("all");
  const [paymentGroup, setPaymentGroup] = useState<PaymentGroupFilter>("all");
  const [query, setQuery] = useState("");
  const [journeyId, setJourneyId] = useState("");
  const [sort, setSort] = useState<SortOrder>("recent");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);

  const allQuotes = quotes.data?.quotes ?? [];
  const allPayments = payments.data?.patient?.payments ?? [];
  const journeyOptions = journeys.data?.journeys ?? [];
  const journeyName = (id?: string | null) => id ? journeyOptions.find((item) => item.id === id)?.name ?? "Tratamento" : "Sem tratamento";
  const indicators = financeIndicators(allQuotes);
  const paymentTitles = new Map<string, string>();
  for (const [paymentId, quote] of matchPaymentQuotes(allPayments, allQuotes)) paymentTitles.set(paymentId, formatQuoteTitle(quote.items));

  const reset = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };
  const scope = { query, journeyId };
  const quoteCounts = quoteGroupCounts(allQuotes, scope);
  const paymentCounts = paymentGroupCounts(allPayments, { ...scope, titles: paymentTitles });
  const filteredQuotes = filterQuotes(allQuotes, { ...scope, group: quoteGroup, sort });
  const filteredPayments = filterPayments(allPayments, { ...scope, titles: paymentTitles, group: paymentGroup, sort });
  const list = view === "quotes" ? paginateList(filteredQuotes, page, pageSize) : paginateList(filteredPayments, page, pageSize);
  const resource = view === "quotes" ? quotes : payments;
  const total = view === "quotes" ? filteredQuotes.length : filteredPayments.length;
  const overall = view === "quotes" ? allQuotes.length : allPayments.length;
  const ready = view === "quotes" ? quotes.data !== undefined : payments.data !== undefined;

  function generatePdf(quote: QuoteRecord) {
    const totalCents = Math.round(quote.total * 100);
    const html = buildQuoteProposalHtml({
      statusLabel: quote.status === "Pago"
        ? quote.paymentConfirmed ? "Aprovado" : "Pagamento não confirmado"
        : quoteStatusLabel(quote.status),
      dateLabel: quote.createdAt ? new Date(quote.createdAt).toLocaleDateString("pt-BR") : "Data não informada",
      proposalNumber: quote.id,
      validUntil: quote.expires ? new Date(quote.expires).toLocaleDateString("pt-BR") : null,
      clinic: { name: quote.clinic?.name },
      patient: { name: quote.patient?.name, cpf: quote.patient?.cpf },
      professional: { name: quote.evaluation?.professional },
      rows: proposalRowsFromQuote(quote),
      paymentMethod: quote.paymentMethod || "Cartão de crédito",
      installments: quote.installments ?? 1,
      notes: quote.notes,
      conditions: { paymentStatus: quote.status === "Pago" ? (quote.paymentConfirmed ? "Concluído" : "Não confirmado") : null },
      financial: quoteFinancialSnapshot(quote.details, totalCents),
      totalCents,
    });
    if (!openQuoteProposal(html)) toast.error("O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.");
  }

  const tiles: Array<{ label: string; hint: string; value: string }> = [
    { label: "Total orçado", hint: "Aprovados e pagos", value: quotes.data ? money(indicators.budgetedCents) : "–" },
    ...(canPayments ? [
      { label: "Recebido", hint: "Orçamentos pagos", value: quotes.data ? money(indicators.receivedCents) : "–" },
      { label: "A receber", hint: "Aprovados, não pagos", value: quotes.data ? money(indicators.toReceiveCents) : "–" },
    ] : []),
    { label: "Orçamentos em aberto", hint: "Rascunho ou enviados", value: quotes.data ? String(indicators.openCount) : "–" },
  ];

  return <Card className="p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><WalletCards className="h-5 w-5" aria-hidden="true" /></span>
        <div><h3 className="text-base font-bold">Financeiro</h3><p className="mt-0.5 text-xs text-muted-foreground">Orçamentos e pagamentos do paciente. Novos orçamentos e recebimentos são feitos na jornada do tratamento.</p></div>
      </div>
      {canPayments ? <div className="flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Seções financeiras">
        {([["quotes", "Orçamentos"], ["payments", "Pagamentos"]] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => { setView(id); setPage(1); }} className={cn("rounded-md px-3 py-1.5 text-xs font-semibold transition-colors", view === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>)}
      </div> : null}
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Indicadores financeiros">
      {tiles.map((tile) => <div key={tile.label} className="min-w-0 rounded-lg border border-border bg-card p-3">
        <span className="block text-xs font-medium leading-tight text-muted-foreground">{tile.label}</span>
        <strong className="mt-2 block truncate text-lg text-foreground">{tile.value}</strong>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{tile.hint}</span>
      </div>)}
    </div>

    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={view === "quotes" ? "Status dos orçamentos" : "Status dos pagamentos"}>
      {view === "quotes"
        ? quoteGroupFilters.map((chip) => <Chip key={chip.id} label={chip.label} count={ready ? quoteCounts[chip.id] : undefined} active={quoteGroup === chip.id} onClick={() => reset(setQuoteGroup)(chip.id)} />)
        : paymentGroupFilters.map((chip) => <Chip key={chip.id} label={chip.label} count={ready ? paymentCounts[chip.id] : undefined} active={paymentGroup === chip.id} onClick={() => reset(setPaymentGroup)(chip.id)} />)}
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
      <label className="relative sm:col-span-2 lg:col-span-1"><span className="sr-only">{view === "quotes" ? "Buscar por procedimento" : "Buscar pagamentos"}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm" placeholder={view === "quotes" ? "Buscar por procedimento..." : "Buscar por procedimento do orçamento..."} value={query} onChange={(event) => reset(setQuery)(event.target.value)} /></label>
      <FilterSelect label="Tratamento" value={journeyId} onChange={reset(setJourneyId)}><option value="">Todos</option>{journeyOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</FilterSelect>
      <FilterSelect label="Ordenar por data" value={sort} onChange={(value) => reset(setSort)(value as SortOrder)}><option value="recent">Mais recentes</option><option value="oldest">Mais antigos</option></FilterSelect>
    </div>

    {view === "payments" && ready && total > 0 ? <p className="mt-3 text-xs text-muted-foreground">Total recebido nesta seleção: <strong className="text-foreground">{money(receivedCents(filteredPayments))}</strong></p> : null}

    <div className="mt-4">
      {!ready && !resource.error ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <LoadingSkeleton key={item} className="h-44 w-full" />)}</div>
        : resource.error && !ready ? <EmptyState title={view === "quotes" ? "Não foi possível carregar os orçamentos" : "Não foi possível carregar os pagamentos"} description="Verifique sua conexão e tente novamente." action={<Button size="sm" variant="outline" onClick={resource.retry}>Tentar novamente</Button>} />
          : total === 0 ? <EmptyState title={overall ? (view === "quotes" ? "Nenhum orçamento encontrado" : "Nenhum pagamento encontrado") : (view === "quotes" ? "Nenhum orçamento ainda" : "Nenhum pagamento ainda")} description={overall ? "Ajuste a busca ou os filtros." : view === "quotes" ? "Os orçamentos são criados na jornada do tratamento, durante o atendimento." : "Os pagamentos aparecem aqui depois de registrados na etapa de orçamento da jornada."} />
            : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {view === "quotes"
                ? (list.items as QuoteRecord[]).map((quote) => <QuoteCard key={quote.id} quote={quote} journey={journeyName(quote.journeyId)} canRegister={canPayments} onPdf={() => generatePdf(quote)} onOpenJourney={() => quote.journeyId && onOpenJourney(quote.journeyId)} onRegisterPayment={() => quote.journeyId && onRegisterPayment(quote.journeyId, quote.id)} />)
                : (list.items as PaymentRecord[]).map((payment) => <PaymentCard key={payment.id} payment={payment} title={paymentTitles.get(payment.id)} journey={journeyName(payment.journeyId)} onOpenJourney={() => payment.journeyId && onOpenJourney(payment.journeyId)} />)}
            </div>}
    </div>

    {ready && total > 0 ? <PaginationBar page={list.page} pageSize={pageSize} total={total} sizes={documentPageSizes} noun={view === "quotes" ? ["orçamento", "orçamentos"] : ["pagamento", "pagamentos"]} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} /> : null}
  </Card>;
}

function Chip({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:border-primary/50", active ? "border-primary bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground")}>{label}<span className={cn("rounded-full px-1.5 text-xs", active ? "bg-primary/10" : "bg-muted")}>{count ?? "–"}</span></button>;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <p className="flex items-baseline justify-between gap-2 text-xs"><span className="shrink-0 text-muted-foreground">{label}</span><span className="min-w-0 truncate text-right font-medium text-foreground">{children}</span></p>;
}

function QuoteCard({ quote, journey, canRegister, onPdf, onOpenJourney, onRegisterPayment }: { quote: QuoteRecord; journey: string; canRegister: boolean; onPdf: () => void; onOpenJourney: () => void; onRegisterPayment: () => void }) {
  const group = quoteStatusGroup(quote.status);
  const title = formatQuoteTitle(quote.items);
  const blocked = !canRegister ? "Seu perfil não registra pagamentos." : quotePaymentBlockReason(quote.status) ?? (quote.journeyId ? null : "Orçamento sem tratamento vinculado.");
  return <article className="flex flex-col rounded-lg border border-border bg-card p-3">
    <div className="flex items-start justify-between gap-2">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><WalletCards className="h-5 w-5" aria-hidden="true" /></span>
      <Badge variant={group ? quoteBadge[group] : "slate"}>{quoteStatusLabel(quote.status)}</Badge>
    </div>
    <h4 className="mt-2 line-clamp-2 text-sm font-bold" title={title}>{title}</h4>
    <strong className="mt-1 text-lg text-primary">{currency.format(quote.total)}</strong>
    <div className="mt-2 space-y-1">
      <Detail label="Tratamento">{journey}</Detail>
      <Detail label="Data">{formatDate(quote.createdAt)}</Detail>
      <Detail label="Pagamento">{paymentLabel(quote)}</Detail>
    </div>
    <div className="mt-3 flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" onClick={onPdf}><FileDown className="h-4 w-4" />Gerar PDF</Button>
      <Button size="sm" variant="outline" disabled={Boolean(blocked)} title={blocked ?? "Abre o tratamento na etapa de orçamento, onde o pagamento é confirmado."} onClick={onRegisterPayment}><WalletCards className="h-4 w-4" />Registrar pagamento</Button>
      <Button size="sm" variant="ghost" disabled={!quote.journeyId} onClick={onOpenJourney}><ExternalLink className="h-4 w-4" />Abrir na jornada</Button>
    </div>
    {blocked ? <p className="mt-2 text-xs text-muted-foreground">Registrar pagamento indisponível: {blocked}</p> : null}
  </article>;
}

function PaymentCard({ payment, title, journey, onOpenJourney }: { payment: PaymentRecord; title?: string; journey: string; onOpenJourney: () => void }) {
  const group = paymentStatusGroup(payment.status);
  return <article className={cn("flex flex-col rounded-lg border border-border bg-card p-3", group === "other" && "opacity-70")}>
    <div className="flex items-start justify-between gap-2">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><WalletCards className="h-5 w-5" aria-hidden="true" /></span>
      <Badge variant={group === "paid" ? "green" : group === "pending" || payment.status === "Bloqueado" ? "amber" : "slate"}>{payment.status}</Badge>
    </div>
    <h4 className="mt-2 line-clamp-2 text-sm font-bold" title={title ?? "Pagamento"}>{title ?? "Pagamento"}</h4>
    <strong className="mt-1 text-lg text-primary">{currency.format(payment.value)}</strong>
    <div className="mt-2 space-y-1">
      <Detail label="Tratamento">{journey}</Detail>
      <Detail label="Data">{formatDate(payment.date)}</Detail>
      <Detail label="Forma">{payment.method} · {payment.installments}</Detail>
    </div>
    <div className="mt-3 flex flex-wrap gap-1.5">
      <Button size="sm" variant="ghost" disabled={!payment.journeyId} onClick={onOpenJourney}><ExternalLink className="h-4 w-4" />Abrir na jornada</Button>
    </div>
  </article>;
}
