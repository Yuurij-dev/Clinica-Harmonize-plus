"use client";

import { type ReactNode, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Eye, PencilLine, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClassName } from "@/components/ui/modal";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PaginationBar } from "./clinical-pagination";
import { useCan } from "./current-user";
import { DetailsModal, ErrorNote, ExpenseFormModal, FinanceHeader, financeKey, formatCents, formatDate, LoadingBlock, patchExpense, PayExpenseModal, sourceLabels, useFinanceResource, type ExpenseRow } from "./finance-shared";
import { PaymentEditModal, ReceivePaymentModal } from "./payment-modals";
import { DateRangeFilter, EmptyState } from "./shared";

export type AccountsTab = "receber" | "pagar";
type AccountStatus = "open" | "overdue" | "settled";
type Receivable = { id: string; patientId: string | null; patientName: string | null; description: string; amountCents: number; dueOn: string; status: AccountStatus; paymentStatus: string; method: string; installments: string };
type Payable = { id: string; description: string; category: string; amountCents: number; dueOn: string; paidOn: string | null; status: AccountStatus; source: string; paymentMethod: string };
type AccountsResponse<T> = { kind: string; totals: { openCents: number; openCount: number; settledCents: number; overdueCents: number; overdueCount: number }; items: T[]; total: number; page: number; pageSize: number };

export function FinanceAccounts({ tab, onTab, onBack }: { tab: AccountsTab | null; onTab: (tab: AccountsTab) => void; onBack: () => void }) {
  const canReceivable = useCan("payments:access");
  const canPayable = useCan("finance:manage");
  const active: AccountsTab | null = tab === "receber" && canReceivable ? "receber" : tab === "pagar" && canPayable ? "pagar" : canReceivable ? "receber" : canPayable ? "pagar" : null;
  const tabs: Array<[AccountsTab, string]> = [...(canReceivable ? [["receber", "Contas a Receber"] as [AccountsTab, string]] : []), ...(canPayable ? [["pagar", "Contas a Pagar"] as [AccountsTab, string]] : [])];

  return (
    <div>
      <FinanceHeader icon={Wallet} title="Contas a pagar e receber" description="Acompanhe seus compromissos financeiros." parent="Financeiro" onParent={onBack} />
      {!active ? <EmptyState title="Acesso restrito" description="Você não tem permissão para ver contas a pagar nem a receber." /> : <>
        <div className="mb-4 flex gap-1 border-b border-border" role="tablist" aria-label="Tipo de conta">
          {tabs.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={active === value} className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors", active === value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")} onClick={() => onTab(value)}>{label}</button>)}
        </div>
        <AccountsList key={active} kind={active} />
      </>}
    </div>
  );
}

const statusFilters: Array<[string, (receivable: boolean) => string]> = [["open", () => "Em aberto"], ["overdue", () => "Vencidas"], ["settled", (receivable) => receivable ? "Recebidas" : "Pagas"], ["all", () => "Todas"]];

function StatusBadge({ status, receivable }: { status: AccountStatus; receivable: boolean }) {
  if (status === "overdue") return <Badge variant="red">Vencida</Badge>;
  if (status === "settled") return <Badge variant="green">{receivable ? "Recebida" : "Paga"}</Badge>;
  return <Badge variant="amber">Pendente</Badge>;
}

function Indicator({ icon: Icon, tone, value, label }: { icon: React.ComponentType<{ className?: string }>; tone: string; value: ReactNode; label: string }) {
  return <Card className="flex items-center gap-3 p-4"><span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", tone)}><Icon className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate text-xl font-black text-foreground">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></Card>;
}

function AccountsList({ kind }: { kind: AccountsTab }) {
  const receivable = kind === "receber";
  const canReceive = useCan("payments:manage");
  const canExpense = useCan("finance:manage");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("open");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modal, setModal] = useState<{ kind: "view" | "edit" | "settle"; item: Receivable | Payable } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(queryInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const key = financeKey("/api/finance/accounts", { kind: receivable ? "receivable" : "payable", from, to, status, q: query, page, pageSize });
  const { data, loading, error, reload } = useFinanceResource<AccountsResponse<Receivable | Payable>>(key, true);
  const items = data?.items ?? [];
  // Liquidar o último item da última página deixa a página vazia: volta para a última válida.
  if (data && data.page === page && !data.items.length && data.total > 0 && page > 1) setPage(Math.max(1, Math.ceil(data.total / data.pageSize)));
  const totals = data?.totals;
  const reset = (apply: () => void) => { apply(); setPage(1); };
  const done = (message: string) => { toast.success(message); setModal(null); };
  const canManage = receivable ? canReceive : canExpense;

  const payableEditable = (item: Payable) => canExpense && item.status !== "settled" && item.source !== "purchase";
  const actions = (item: Receivable | Payable) => (
    <div className="flex items-center justify-end gap-1">
      {canManage && item.status !== "settled" ? <Button size="icon" variant="ghost" aria-label={receivable ? "Registrar recebimento" : "Registrar pagamento"} title={receivable ? "Registrar recebimento" : "Registrar pagamento"} onClick={() => setModal({ kind: "settle", item })}><CheckCircle2 className="h-4 w-4 text-success" /></Button> : null}
      {receivable ? (canReceive ? <Button size="icon" variant="ghost" aria-label="Editar" title="Editar" onClick={() => setModal({ kind: "edit", item })}><PencilLine className="h-4 w-4 text-primary" /></Button> : null)
        : payableEditable(item as Payable) ? <Button size="icon" variant="ghost" aria-label="Editar" title="Editar" onClick={() => setModal({ kind: "edit", item })}><PencilLine className="h-4 w-4 text-primary" /></Button> : null}
      <Button size="icon" variant="ghost" aria-label="Detalhes" title="Detalhes" onClick={() => setModal({ kind: "view", item })}><Eye className="h-4 w-4" /></Button>
    </div>
  );
  const rowTint = (item: Receivable | Payable) => item.status === "overdue" ? "bg-destructive/5" : "";

  return (
    <div>
      <div className="hp-list-stagger mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicator icon={Wallet} tone={receivable ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"} value={totals ? formatCents(totals.openCents) : "—"} label={receivable ? "Total a receber (em aberto)" : "Total a pagar (em aberto)"} />
        <Indicator icon={Clock3} tone="bg-accent text-primary" value={totals ? totals.openCount : "—"} label="Pendências" />
        <Indicator icon={CheckCircle2} tone="bg-success/10 text-success" value={totals ? formatCents(totals.settledCents) : "—"} label={receivable ? "Valores recebidos" : "Valores pagos"} />
        <Indicator icon={AlertTriangle} tone="bg-destructive/10 text-destructive" value={totals ? formatCents(totals.overdueCents) : "—"} label={totals ? `Vencidas (${totals.overdueCount})` : "Vencidas"} />
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-bold text-foreground">{receivable ? "Contas a receber" : "Contas a pagar"}</h3>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <DateRangeFilter startDate={from} endDate={to} onStartDateChange={(value) => reset(() => setFrom(value))} onEndDateChange={(value) => reset(() => setTo(value))} />
          <select className={`${fieldClassName} h-10 w-auto`} value={status} onChange={(event) => reset(() => setStatus(event.target.value))} aria-label="Filtrar por situação">
            {statusFilters.map(([value, label]) => <option key={value} value={value}>{label(receivable)}</option>)}
          </select>
          <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input className={`${fieldClassName} h-10 pl-9`} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder={receivable ? "Buscar por paciente ou descrição..." : "Buscar por descrição..."} aria-label="Buscar" />
          </label>
        </div>

        {loading ? <LoadingBlock /> : error ? <ErrorNote message={error} onRetry={reload} /> : items.length ? (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Descrição</TableHead><TableHead>{receivable ? "Cliente" : "Categoria / Fornecedor"}</TableHead><TableHead>Valor</TableHead><TableHead>Vencimento</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} className={rowTint(item)}>
                      <TableCell className="font-semibold text-foreground">{item.description}</TableCell>
                      <TableCell>{receivable ? (item as Receivable).patientName ?? "—" : (item as Payable).category}</TableCell>
                      <TableCell className="whitespace-nowrap font-semibold">{formatCents(item.amountCents)}</TableCell>
                      <TableCell className={cn("whitespace-nowrap", item.status === "overdue" && "font-bold text-destructive")}>{formatDate(item.dueOn)}</TableCell>
                      <TableCell><StatusBadge status={item.status} receivable={receivable} /></TableCell>
                      <TableCell>{actions(item)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {items.map((item) => (
                <li key={item.id} className={cn("space-y-2 py-3", rowTint(item))}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-bold text-foreground">{item.description}</p><p className="text-xs text-muted-foreground">{receivable ? (item as Receivable).patientName ?? "—" : (item as Payable).category}</p></div>
                    <StatusBadge status={item.status} receivable={receivable} />
                  </div>
                  <div className="flex items-center justify-between text-sm"><strong>{formatCents(item.amountCents)}</strong><span className={cn("text-xs", item.status === "overdue" ? "font-bold text-destructive" : "text-muted-foreground")}>Vence {formatDate(item.dueOn)}</span></div>
                  {actions(item)}
                </li>
              ))}
            </ul>
            <PaginationBar page={data?.page ?? page} pageSize={data?.pageSize ?? pageSize} total={data?.total ?? 0} sizes={[10, 20, 50]} noun={["registro", "registros"]} onPage={setPage} onPageSize={(size) => reset(() => setPageSize(size))} />
          </>
        ) : <EmptyState title={receivable ? "Nenhuma conta a receber" : "Nenhuma conta a pagar"} description="Não há registros para os filtros escolhidos." />}
      </Card>

      {modal ? <AccountModal modal={modal} receivable={receivable} onClose={() => setModal(null)} onDone={done} /> : null}
    </div>
  );
}

function AccountModal({ modal, receivable, onClose, onDone }: { modal: { kind: "view" | "edit" | "settle"; item: Receivable | Payable }; receivable: boolean; onClose: () => void; onDone: (message: string) => void }) {
  if (receivable) {
    const item = modal.item as Receivable;
    const payment = { id: item.id, patientId: item.patientId, patientName: item.patientName, amountCents: item.amountCents, method: item.method, date: item.dueOn };
    if (modal.kind === "settle") return <ReceivePaymentModal payment={payment} onClose={onClose} onSaved={() => onDone("Recebimento registrado.")} />;
    if (modal.kind === "edit") return <PaymentEditModal payment={payment} onClose={onClose} onSaved={() => onDone("Pagamento atualizado.")} />;
    return <DetailsModal onClose={onClose} title="Detalhes da conta a receber" rows={[
      ["Descrição", item.description], ["Cliente", item.patientName ?? "—"], ["Valor", formatCents(item.amountCents)], ["Vencimento", formatDate(item.dueOn)],
      ["Situação", item.status === "overdue" ? "Vencida" : item.status === "settled" ? "Recebida" : "Pendente"], ["Status do pagamento", item.paymentStatus], ["Forma de pagamento", item.method], ["Parcelamento", item.installments],
    ]} />;
  }
  const item = modal.item as Payable;
  const expense: ExpenseRow = { id: item.id, description: item.description, category: item.category, amountCents: item.amountCents, dueOn: item.dueOn, paidOn: item.paidOn, paymentMethod: item.paymentMethod, status: item.status === "settled" ? "paid" : "open", source: item.source };
  if (modal.kind === "settle") return <PayExpenseModal expense={item} onClose={onClose} onConfirm={async (paidOn) => {
    const result = await patchExpense(item.id, { action: "pay", paidOn });
    if (!result.ok) return result.message ?? "Não foi possível registrar o pagamento.";
    onDone("Pagamento registrado.");
    return null;
  }} />;
  if (modal.kind === "edit") return <ExpenseFormModal expense={expense} onClose={onClose} onSaved={() => onDone("Despesa atualizada.")} />;
  return <DetailsModal onClose={onClose} title="Detalhes da conta a pagar" rows={[
    ["Descrição", item.description], ["Categoria", item.category], ["Valor", formatCents(item.amountCents)], ["Vencimento", formatDate(item.dueOn)],
    ["Situação", item.status === "overdue" ? "Vencida" : item.status === "settled" ? "Paga" : "A pagar"], ["Pago em", item.paidOn ? formatDate(item.paidOn) : "—"], ["Forma de pagamento", item.paymentMethod], ["Origem", sourceLabels[item.source] ?? item.source],
  ]} />;
}
