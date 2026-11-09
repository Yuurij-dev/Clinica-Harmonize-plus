"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaskedInput } from "@/components/ui/masked-input";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, readClientCache } from "@/lib/client-cache";
import { invalidateFinanceCache } from "@/lib/finance-cache";
import { clinicToday } from "@/lib/clinic-time";
import { expenseCategories } from "@/lib/finance-rules";
import { formatCurrency, parseCurrency } from "@/lib/input-masks";
import { sendJson } from "@/lib/send-json";

export const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const paymentMethods = ["Pix", "Boleto", "Cartão de crédito", "Cartão de débito", "Dinheiro", "Transferência"];
export const sourceLabels: Record<string, string> = { manual: "Manual", purchase: "Compra de estoque", recurring: "Despesa fixa" };

export type ExpenseRow = { id: string; description: string; category: string; amountCents: number; dueOn: string; paymentMethod: string; status: "open" | "paid" | "cancelled"; paidOn: string | null; source: string };

export function formatCents(cents: number) {
  return currency.format(cents / 100);
}

export function formatDate(value: string) {
  return value.split("-").reverse().join("/");
}

// Chaves e URLs do Financeiro: a key é a própria URL, com todos os parâmetros preenchidos (ordem estável).
export function financeKey(path: string, params: Record<string, string | number | null | undefined>) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") query.set(name, String(value));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export { invalidateFinanceCache, invalidatePaymentCache, invalidateRecurringCache } from "@/lib/finance-cache";

export async function patchExpense(id: string, body: Record<string, unknown>) {
  const { ok, data } = await sendJson<{ message?: string }>(`/api/expenses/${id}`, "PATCH", body);
  if (ok) invalidateFinanceCache();
  return { ok, message: data?.message };
}

// Leitura em cache: devolve dados imediatos quando já existem, revalida e refaz a busca quando a chave é invalidada.
// `key` nulo não busca (ex.: sem permissão). Com keepPrevious, mantém os dados da chave anterior enquanto a nova carrega.
export function useFinanceResource<T>(key: string | null, keepPrevious = false) {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: string }>(() => ({ key, data: key ? readClientCache<T>(key) : undefined }));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!key) return;
    let active = true;
    getCachedJson<T>(key)
      .then((data) => { if (active) setState({ key, data }); })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setState((current) => ({ key, data: current.key === key ? current.data : undefined, error: "Não foi possível carregar os dados." }));
      });
    return () => { active = false; };
  }, [key, version]);

  useEffect(() => {
    if (!key) return;
    const prefix = key.split("?")[0];
    const handle = (event: Event) => {
      const keys = (event as CustomEvent<string[]>).detail ?? [];
      if (keys.some((item) => item === key || item === prefix)) setVersion((current) => current + 1);
    };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
  }, [key]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  if (!key) return { data: undefined, loading: false, error: undefined, reload };
  const current = state.key === key;
  const data = current ? state.data : readClientCache<T>(key) ?? (keepPrevious ? state.data : undefined);
  const error = current ? state.error : undefined;
  return { data, loading: data === undefined && !error, error: data === undefined ? error : undefined, reload };
}

export type FinanceView = "dashboard" | "movimentacoes" | "recorrentes" | "contas";
const financeViews: FinanceView[] = ["dashboard", "movimentacoes", "recorrentes", "contas"];

// A subpágina e os filtros ficam na URL (/financeiro?view=...). Mudanças usam history.pushState/replaceState,
// que o Next sincroniza com useSearchParams sem nova ida ao servidor.
export function useFinanceUrl() {
  const searchParams = useSearchParams();
  const rawView = searchParams.get("view");
  const view: FinanceView = financeViews.includes(rawView as FinanceView) ? rawView as FinanceView : "dashboard";
  const update = useCallback((changes: Record<string, string | null>, mode: "push" | "replace" = "push") => {
    const params = new URLSearchParams(window.location.search);
    for (const [name, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(name);
      else params.set(name, value);
    }
    const text = params.toString();
    const url = text ? `${window.location.pathname}?${text}` : window.location.pathname;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);
  return { view, get: (name: string) => searchParams.get(name), update };
}

export function FinanceHeader({ icon: Icon, title, description, parent, onParent, actions }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; parent?: string; onParent?: () => void; actions?: ReactNode }) {
  return (
    <div data-hp-title className="hp-page-enter mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-primary"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0">
          {parent ? (
            <nav aria-label="Navegação do Financeiro" className="mb-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={onParent}>{parent}</button>
              <ChevronRight className="h-3 w-3" aria-hidden />
              <span aria-current="page">{title}</span>
            </nav>
          ) : null}
          <h2 className="text-lg font-bold text-primary">{title}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">
      <span>{message}</span>
      {onRetry ? <Button size="sm" variant="secondary" onClick={onRetry}>Tentar de novo</Button> : null}
    </div>
  );
}

export function LoadingBlock({ className = "py-8" }: { className?: string }) {
  return <div className={`grid place-items-center ${className}`} role="status" aria-label="Carregando"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
}

export function StatusDot({ tone, children }: { tone: "green" | "amber" | "red" | "slate"; children: ReactNode }) {
  const color = { green: "bg-success", amber: "bg-warning", red: "bg-destructive", slate: "bg-muted-foreground" }[tone];
  return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground"><span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />{children}</span>;
}

export function ConfirmModal({ title, description, confirmLabel, onClose, onConfirm }: { title: string; description: string; confirmLabel: string; onClose: () => void; onConfirm: () => Promise<string | null> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal open onClose={onClose} title={title} description={description}>
      <div className="space-y-4">
        {error ? <ErrorNote message={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Voltar</Button>
          <Button type="button" variant="destructive" disabled={saving} onClick={async () => {
            setSaving(true);
            const message = await onConfirm();
            setSaving(false);
            if (message) setError(message);
          }}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function ExpenseFormModal({ expense, onClose, onSaved }: { expense: ExpenseRow | null; onClose: () => void; onSaved: () => void }) {
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
    invalidateFinanceCache();
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={expense ? "Editar despesa" : "Nova despesa"} description="Despesas pagas entram no resultado do período em que foram pagas.">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div className="sm:col-span-2"><FormField label="Descrição"><input className={fieldClassName} name="description" defaultValue={expense?.description ?? ""} placeholder="Ex.: Aluguel de outubro" required /></FormField></div>
        <FormField label="Categoria"><select className={fieldClassName} name="category" defaultValue={expense?.category ?? ""} required><option value="">Selecione</option>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></FormField>
        <FormField label="Valor"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="amount" inputMode="decimal" placeholder="R$ 0,00" defaultValue={expense ? formatCents(expense.amountCents) : ""} required /></FormField>
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

export function PayExpenseModal({ expense, onClose, onConfirm }: { expense: Pick<ExpenseRow, "description" | "amountCents">; onClose: () => void; onConfirm: (paidOn: string) => Promise<string | null> }) {
  const [paidOn, setPaidOn] = useState(clinicToday());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal open onClose={onClose} title="Marcar como paga" description={`${expense.description} · ${formatCents(expense.amountCents)}`}>
      <div className="space-y-4">
        <FormField label="Data do pagamento"><input className={fieldClassName} type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></FormField>
        {error ? <ErrorNote message={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={saving || !paidOn} onClick={async () => {
            setSaving(true);
            const message = await onConfirm(paidOn);
            setSaving(false);
            if (message) setError(message);
          }}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Confirmar pagamento</Button>
        </div>
      </div>
    </Modal>
  );
}

// Detalhes somente leitura (Visualizar / Detalhes).
export function DetailsModal({ title, rows, onClose }: { title: string; rows: Array<[string, ReactNode]>; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={title}>
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-bold uppercase text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex justify-end"><Button type="button" variant="secondary" onClick={onClose}>Fechar</Button></div>
    </Modal>
  );
}
