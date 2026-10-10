"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Ban, CheckCircle2, Loader2, PencilLine, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaskedInput } from "@/components/ui/masked-input";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { sendJson } from "@/lib/send-json";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { clinicToday } from "@/lib/clinic-time";
import { expenseCategories, type FinancePeriod } from "@/lib/finance-rules";
import { formatCurrency, parseCurrency } from "@/lib/input-masks";
import { CountUpValue, EmptyState, ProgressBar, SectionIntro } from "./shared";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const paymentMethods = ["Pix", "Boleto", "Cartão de crédito", "Cartão de débito", "Dinheiro", "Transferência"];

type Totals = { revenueCents: number; receivedCents: number; pendingReceivableCents: number; expensesCents: number; resultCents: number; payableCents: number };
type Summary = { period: FinancePeriod; range: { start: string; end: string }; totals: Totals };
export type ExpenseRow = { id: string; description: string; category: string; amountCents: number; dueOn: string; paymentMethod: string; status: "open" | "paid" | "cancelled"; paidOn: string | null; source: string };
type DashboardData = { appointments?: Array<{ procedure: string }> };

const periodLabels: Record<FinancePeriod, string> = { today: "Hoje", week: "Semana", month: "Mês" };
const statusLabels: Record<ExpenseRow["status"], { label: string; variant: "amber" | "green" | "slate" }> = {
  open: { label: "A pagar", variant: "amber" },
  paid: { label: "Paga", variant: "green" },
  cancelled: { label: "Cancelada", variant: "slate" },
};
const sourceLabels: Record<string, string> = { manual: "Manual", purchase: "Compra de estoque", recurring: "Despesa fixa" };

export function invalidateFinanceCache() {
  invalidateClientCache("/api/finance/summary", "/api/expenses");
}

function formatDate(value: string) {
  return value.split("-").reverse().join("/");
}

function useCachedResource<T>(key: string) {
  const [data, setData] = useState<T | undefined>(() => readClientCache<T>(key));
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    getCachedJson<T>(key).then((value) => { if (active) setData(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [key, version]);
  useEffect(() => {
    const prefix = key.split("?")[0];
    const handle = (event: Event) => {
      const keys = (event as CustomEvent<string[]>).detail ?? [];
      if (keys.some((item) => item === key || item === prefix)) setVersion((current) => current + 1);
    };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
  }, [key]);
  return data;
}

export function FinanceSection() {
  const [period, setPeriod] = useState<FinancePeriod>("month");
  const summary = useCachedResource<Summary>(`/api/finance/summary?period=${period}`);
  const totals = summary?.totals;
  const cards: Array<[string, number | undefined]> = [
    ["Receita", totals?.revenueCents],
    ["Despesas", totals?.expensesCents],
    ["Resultado", totals?.resultCents],
    ["Valores pendentes", totals?.pendingReceivableCents],
    ["Recebidos", totals?.receivedCents],
    ["A pagar", totals?.payableCents],
  ];

  return (
    <div>
      <SectionIntro title="Financeiro" description="Receita, despesas e resultado do período pelo regime de caixa: o que entrou e o que saiu de fato." />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(Object.keys(periodLabels) as FinancePeriod[]).map((value) => (
          <Button key={value} variant={period === value ? "primary" : "secondary"} onClick={() => setPeriod(value)}>{periodLabels[value]}</Button>
        ))}
        {summary ? <span className="text-xs text-muted-foreground">{summary.range.start === summary.range.end ? formatDate(summary.range.start) : `${formatDate(summary.range.start)} a ${formatDate(summary.range.end)}`}</span> : null}
      </div>
      <div className="hp-list-stagger grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, value]) => (
          <Card className="p-5" key={label}>
            <p className="text-sm font-semibold text-[#65708b]">{label}</p>
            <p className={`mt-3 text-xl font-black ${label === "Resultado" && (value ?? 0) < 0 ? "text-destructive" : "text-[#121733]"}`}>
              {value === undefined ? <span className="text-muted-foreground">—</span> : <CountUpValue value={value / 100} format={(current) => currency.format(current)} />}
            </p>
          </Card>
        ))}
      </div>
      <ExpensesCard period={period} />
      <ProcedureResultsCard />
    </div>
  );
}

function ExpensesCard({ period }: { period: FinancePeriod }) {
  const data = useCachedResource<{ expenses: ExpenseRow[] }>(`/api/expenses?period=${period}`);
  const [statusFilter, setStatusFilter] = useState<"all" | ExpenseRow["status"]>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);
  const [paying, setPaying] = useState<ExpenseRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const expenses = (data?.expenses ?? []).filter((expense) => (statusFilter === "all" || expense.status === statusFilter) && (categoryFilter === "all" || expense.category === categoryFilter));

  async function runAction(expense: ExpenseRow, body: Record<string, unknown>) {
    setBusyId(expense.id);
    setError("");
    const { ok, data: result } = await sendJson<{ message?: string }>(`/api/expenses/${expense.id}`, "PATCH", body);
    setBusyId(null);
    if (!ok) {
      setError(result?.message ?? "Não foi possível atualizar a despesa.");
      return false;
    }
    invalidateFinanceCache();
    return true;
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Despesas do período</CardTitle>
        <Button size="sm" onClick={() => setEditing("new")}>Nova despesa</Button>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          <select className={`${fieldClassName} w-auto`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} aria-label="Filtrar por situação">
            <option value="all">Todas as situações</option>
            <option value="open">A pagar</option>
            <option value="paid">Pagas</option>
            <option value="cancelled">Canceladas</option>
          </select>
          <select className={`${fieldClassName} w-auto`} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filtrar por categoria">
            <option value="all">Todas as categorias</option>
            {expenseCategories.map((category) => <option key={category}>{category}</option>)}
          </select>
        </div>
        {error ? <p className="mb-3 rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
        {!data ? <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : expenses.length ? (
          <div className="divide-y divide-border">
            {expenses.map((expense) => (
              <div className={`flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between ${expense.status === "cancelled" ? "opacity-60" : ""}`} key={expense.id}>
                <div className="min-w-0">
                  <p className="font-bold text-foreground">{expense.description}</p>
                  <p className="text-xs text-muted-foreground">{expense.category} · vence {formatDate(expense.dueOn)}{expense.paidOn ? ` · paga em ${formatDate(expense.paidOn)}` : ""} · {expense.paymentMethod}{expense.source !== "manual" ? ` · ${sourceLabels[expense.source] ?? expense.source}` : ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-foreground">{currency.format(expense.amountCents / 100)}</strong>
                  <Badge variant={statusLabels[expense.status].variant}>{statusLabels[expense.status].label}</Badge>
                  {expense.status === "open" ? <Button size="sm" variant="secondary" disabled={busyId === expense.id} onClick={() => setPaying(expense)}><CheckCircle2 className="h-3.5 w-3.5" />Pagar</Button> : null}
                  {expense.status === "paid" ? <Button size="sm" variant="secondary" disabled={busyId === expense.id} onClick={() => void runAction(expense, { action: "unpay" })}><RotateCcw className="h-3.5 w-3.5" />Desfazer pagamento</Button> : null}
                  {expense.status === "open" && expense.source !== "purchase" ? <Button size="icon" variant="ghost" aria-label="Editar despesa" title="Editar" onClick={() => setEditing(expense)}><PencilLine className="h-3.5 w-3.5" /></Button> : null}
                  {expense.status !== "cancelled" && expense.source !== "purchase" ? <Button size="icon" variant="ghost" aria-label="Cancelar despesa" title="Cancelar" disabled={busyId === expense.id} onClick={() => void runAction(expense, { action: "cancel" })}><Ban className="h-3.5 w-3.5" /></Button> : null}
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Nenhuma despesa no período" description="Lance as despesas da clínica para acompanhar o resultado real." />}
      </CardContent>
      {editing ? <ExpenseFormModal expense={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidateFinanceCache(); }} /> : null}
      {paying ? <PayExpenseModal expense={paying} onClose={() => setPaying(null)} onConfirm={async (paidOn) => { if (await runAction(paying, { action: "pay", paidOn })) setPaying(null); }} /> : null}
    </Card>
  );
}

function ExpenseFormModal({ expense, onClose, onSaved }: { expense: ExpenseRow | null; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = Math.round(parseCurrency(form.get("amount")) * 100);
    if (amountCents <= 0) {
      setError("Informe o valor da despesa.");
      return;
    }
    const payload = {
      description: String(form.get("description") ?? ""),
      category: String(form.get("category") ?? ""),
      amountCents,
      dueOn: String(form.get("dueOn") ?? ""),
      paymentMethod: String(form.get("paymentMethod") ?? ""),
      ...(expense ? {} : { paid, paidOn: String(form.get("paidOn") ?? "") }),
    };
    setSaving(true);
    setError("");
    const { ok, data } = await sendJson<{ message?: string }>(expense ? `/api/expenses/${expense.id}` : "/api/expenses", expense ? "PATCH" : "POST", payload);
    setSaving(false);
    if (!ok) {
      setError(data?.message ?? "Não foi possível salvar a despesa.");
      return;
    }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={expense ? "Editar despesa" : "Nova despesa"} description="Despesas pagas entram no resultado do período em que foram pagas.">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div className="sm:col-span-2"><FormField label="Descrição"><input className={fieldClassName} name="description" defaultValue={expense?.description ?? ""} placeholder="Ex.: Aluguel de outubro" required /></FormField></div>
        <FormField label="Categoria"><select className={fieldClassName} name="category" defaultValue={expense?.category ?? ""} required><option value="">Selecione</option>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></FormField>
        <FormField label="Valor"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="amount" inputMode="decimal" placeholder="R$ 0,00" defaultValue={expense ? currency.format(expense.amountCents / 100) : ""} required /></FormField>
        <FormField label="Vencimento"><input className={fieldClassName} name="dueOn" type="date" defaultValue={expense?.dueOn ?? clinicToday()} required /></FormField>
        <FormField label="Forma de pagamento"><select className={fieldClassName} name="paymentMethod" defaultValue={expense?.paymentMethod ?? "Pix"}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></FormField>
        {!expense ? (
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-foreground"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />Já está paga</label>
            {paid ? <FormField label="Data do pagamento"><input className={fieldClassName} name="paidOn" type="date" defaultValue={clinicToday()} required /></FormField> : null}
          </div>
        ) : null}
        {error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{saving ? "Salvando..." : "Salvar despesa"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PayExpenseModal({ expense, onClose, onConfirm }: { expense: ExpenseRow; onClose: () => void; onConfirm: (paidOn: string) => Promise<void> }) {
  const [paidOn, setPaidOn] = useState(clinicToday());
  const [saving, setSaving] = useState(false);
  return (
    <Modal open onClose={onClose} title="Marcar como paga" description={`${expense.description} · ${currency.format(expense.amountCents / 100)}`}>
      <div className="space-y-4">
        <FormField label="Data do pagamento"><input className={fieldClassName} type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></FormField>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={saving || !paidOn} onClick={async () => { setSaving(true); await onConfirm(paidOn); setSaving(false); }}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Confirmar pagamento</Button>
        </div>
      </div>
    </Modal>
  );
}

function ProcedureResultsCard() {
  const data = useCachedResource<DashboardData>("/api/dashboard/bootstrap");
  const procedureTotals = Object.entries((data?.appointments ?? []).reduce<Record<string, number>>((result, item) => { result[item.procedure] = (result[item.procedure] ?? 0) + 1; return result; }, {}));
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Atendimentos por procedimento</CardTitle>
      </CardHeader>
      <CardContent className="hp-list-stagger space-y-5">
        {procedureTotals.length ? procedureTotals.map(([name, count], index) => (
          <div key={name}>
            <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-black text-[#121733]">{name}</p>
              <p className="text-sm text-[#65708b]">Atendimentos realizados: <strong>{count}</strong></p>
            </div>
            <ProgressBar value={Math.min(100, count * 20)} tone={index === 2 ? "purple" : "green"} />
          </div>
        )) : <p className="text-sm text-[#65708b]">Ainda não há atendimentos para calcular resultados.</p>}
      </CardContent>
    </Card>
  );
}
