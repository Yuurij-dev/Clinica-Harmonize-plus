"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronDown, MoreVertical, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fieldClassName } from "@/components/ui/modal";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { periodRange } from "@/lib/finance-rules";
import { sendJson } from "@/lib/send-json";
import { cn } from "@/lib/utils";
import { PaginationBar } from "./clinical-pagination";
import { useCan } from "./current-user";
import { ConfirmModal, DetailsModal, ErrorNote, ExpenseFormModal, FinanceHeader, financeKey, formatCents, formatDate, invalidatePaymentCache, LoadingBlock, patchExpense, PayExpenseModal, sourceLabels, StatusDot, useFinanceResource, type ExpenseRow } from "./finance-shared";
import { PaymentCreateModal, PaymentEditModal, ReceivePaymentModal } from "./payment-modals";
import { DateRangeFilter, EmptyState } from "./shared";

export type MovementItem = { id: string; kind: "revenue" | "expense"; date: string; description: string; category: string; amountCents: number; status: string; method: string; source?: string; patientId?: string | null; patientName?: string | null };
export type MovementsResponse = { items: MovementItem[]; total: number; page: number; pageSize: number; categories: string[] };
type TypeTab = "all" | "revenue" | "expense";
type Modal = { kind: "view" | "editPayment" | "receive" | "deleteRevenue" | "editExpense" | "pay" | "unpay" | "cancelExpense"; item: MovementItem } | { kind: "newRevenue" | "newExpense" };


export function movementStatus(item: MovementItem) {
  if (item.kind === "revenue") return { label: item.status, tone: item.status === "Pago" ? "green" as const : "amber" as const };
  return item.status === "paid" ? { label: "Paga", tone: "green" as const } : { label: "A pagar", tone: "amber" as const };
}

// Despesa que o usuário pode editar/cancelar: só em aberto e que não vem de compra de estoque.
function expenseFromMovement(item: MovementItem): ExpenseRow {
  return { id: item.id, description: item.description, category: item.category, amountCents: item.amountCents, dueOn: item.date, paidOn: item.status === "paid" ? item.date : null, paymentMethod: item.method, status: item.status === "paid" ? "paid" : "open", source: item.source ?? "manual" };
}

export function FinanceMovements({ reference, initialRange, onBack }: { reference: string; initialRange?: { from: string; to: string } | null; onBack: () => void }) {
  const canRevenue = useCan("payments:access");
  const canExpense = useCan("finance:manage");
  const canReceive = useCan("payments:manage");
  const canDeleteRevenue = useCan("payments:delete");
  const month = periodRange("month", reference);
  const [tab, setTab] = useState<TypeTab>("all");
  const [from, setFrom] = useState(initialRange?.from ?? month.start);
  const [to, setTo] = useState(initialRange?.to ?? month.end);
  const [category, setCategory] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modal, setModal] = useState<Modal | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(queryInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const allowed = canRevenue || canExpense;
  const key = allowed ? financeKey("/api/finance/movements", { type: tab, from, to, category, q: query, sort, page, pageSize }) : null;
  const { data, loading, error, reload } = useFinanceResource<MovementsResponse>(key, true);
  const items = data?.items ?? [];
  // Excluir ou liquidar o último item da última página deixa a página vazia: volta para a última válida.
  if (data && data.page === page && !data.items.length && data.total > 0 && page > 1) setPage(Math.max(1, Math.ceil(data.total / data.pageSize)));
  const categories = data?.categories ?? (canRevenue ? ["Receita"] : []);

  const tabs: Array<[TypeTab, string]> = [["all", "Todas"], ...(canRevenue ? [["revenue", "Receitas"] as [TypeTab, string]] : []), ...(canExpense ? [["expense", "Despesas"] as [TypeTab, string]] : [])];
  const reset = (apply: () => void) => { apply(); setPage(1); };
  const done = (message: string) => { toast.success(message); setModal(null); };
  const canManageItem = (item: MovementItem) => item.kind === "revenue" ? canReceive : canExpense;
  const expenseEditable = (item: MovementItem) => item.kind === "expense" && item.status === "open" && item.source !== "purchase";

  const menu = (item: MovementItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Ações de ${item.description}`}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setModal({ kind: "view", item })}>Visualizar</DropdownMenuItem>
        {item.kind === "revenue" && canReceive && item.status !== "Pago" ? <DropdownMenuItem onSelect={() => setModal({ kind: "receive", item })}>Registrar recebimento</DropdownMenuItem> : null}
        {item.kind === "expense" && canExpense && item.status === "open" ? <DropdownMenuItem onSelect={() => setModal({ kind: "pay", item })}>Registrar pagamento</DropdownMenuItem> : null}
        {item.kind === "expense" && canExpense && item.status === "paid" ? <DropdownMenuItem onSelect={() => setModal({ kind: "unpay", item })}>Desfazer pagamento</DropdownMenuItem> : null}
        {(item.kind === "revenue" && canReceive) || (canExpense && expenseEditable(item)) ? <DropdownMenuItem onSelect={() => setModal({ kind: item.kind === "revenue" ? "editPayment" : "editExpense", item })}>Editar</DropdownMenuItem> : null}
        {(item.kind === "revenue" && canDeleteRevenue) || (canExpense && item.kind === "expense" && item.source !== "purchase") ? <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onSelect={() => setModal({ kind: item.kind === "revenue" ? "deleteRevenue" : "cancelExpense", item })}>{item.kind === "revenue" ? "Excluir" : "Cancelar despesa"}</DropdownMenuItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const amount = (item: MovementItem) => <span className={cn("font-bold", item.kind === "revenue" ? "text-success" : "text-destructive")}>{item.kind === "revenue" ? "+ " : "− "}{formatCents(item.amountCents)}</span>;
  const categoryBadge = (item: MovementItem) => <Badge variant={item.kind === "revenue" ? "green" : "red"}>{item.category}</Badge>;

  return (
    <div>
      <FinanceHeader icon={ArrowLeftRight} title="Movimentações" description="Histórico completo de receitas e despesas da clínica." parent="Financeiro" onParent={onBack}
        actions={(canReceive && canRevenue) || canExpense ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button><Plus className="h-4 w-4" />Nova movimentação<ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canReceive && canRevenue ? <DropdownMenuItem onSelect={() => setModal({ kind: "newRevenue" })}><ArrowDownLeft className="mr-2 h-4 w-4 text-success" />Receita</DropdownMenuItem> : null}
              {canExpense ? <DropdownMenuItem onSelect={() => setModal({ kind: "newExpense" })}><ArrowUpRight className="mr-2 h-4 w-4 text-destructive" />Despesa</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined} />

      {!allowed ? <EmptyState title="Acesso restrito" description="Você não tem permissão para ver receitas nem despesas." /> : <Card className="p-4">
        <div className="mb-4 flex gap-1 border-b border-border" role="tablist" aria-label="Tipo de movimentação">
          {tabs.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors", tab === value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")} onClick={() => reset(() => { setTab(value); setCategory(""); })}>{label}</button>)}
        </div>
        <div className="mb-4 flex flex-wrap items-end gap-3 lg:flex-nowrap">
          <DateRangeFilter startDate={from} endDate={to} onStartDateChange={(value) => reset(() => setFrom(value))} onEndDateChange={(value) => reset(() => setTo(value))} />
          <select className={`${fieldClassName} h-10`} style={{ width: "auto" }} value={category} onChange={(event) => reset(() => setCategory(event.target.value))} aria-label="Filtrar por categoria">
            <option value="">Todas as categorias</option>
            {categories.filter((name) => tab === "all" || (tab === "revenue" ? name === "Receita" : name !== "Receita")).map((name) => <option key={name}>{name}</option>)}
          </select>
          <label className="relative min-w-[200px] flex-1 lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input className={`${fieldClassName} h-10 pl-9`} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Buscar por descrição..." aria-label="Buscar por descrição" />
          </label>
        </div>

        {loading ? <LoadingBlock /> : error ? <ErrorNote message={error} onRetry={reload} /> : items.length ? (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader><TableRow>
                  <TableHead aria-sort={sort === "desc" ? "descending" : "ascending"}><button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => reset(() => setSort(sort === "desc" ? "asc" : "desc"))}>Data<ChevronDown className={cn("h-3 w-3 transition-transform", sort === "asc" && "rotate-180")} /></button></TableHead>
                  <TableHead>Descrição</TableHead><TableHead>Categoria</TableHead><TableHead>Valor</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const status = movementStatus(item);
                    return (
                      <TableRow key={`${item.kind}-${item.id}`}>
                        <TableCell className="whitespace-nowrap">{formatDate(item.date)}</TableCell>
                        <TableCell className="font-semibold text-foreground">{item.description}</TableCell>
                        <TableCell>{categoryBadge(item)}</TableCell>
                        <TableCell className="whitespace-nowrap">{amount(item)}</TableCell>
                        <TableCell>{item.kind === "revenue" ? "Receita" : "Despesa"}</TableCell>
                        <TableCell><StatusDot tone={status.tone}>{status.label}</StatusDot></TableCell>
                        <TableCell className="text-right">{menu(item)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {items.map((item) => {
                const status = movementStatus(item);
                return (
                  <li key={`${item.kind}-${item.id}`} className="flex items-start justify-between gap-2 py-3">
                    <div className="min-w-0 space-y-1">
                      <p className="font-bold text-foreground">{item.description}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(item.date)}</p>
                      <div className="flex flex-wrap items-center gap-2">{categoryBadge(item)}<StatusDot tone={status.tone}>{status.label}</StatusDot></div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-sm">{amount(item)}{menu(item)}</div>
                  </li>
                );
              })}
            </ul>
            <PaginationBar page={data?.page ?? page} pageSize={data?.pageSize ?? pageSize} total={data?.total ?? 0} sizes={[10, 20, 50]} noun={["registro", "registros"]} onPage={setPage} onPageSize={(size) => reset(() => setPageSize(size))} />
          </>
        ) : <EmptyState title="Nenhuma movimentação" description="Não há receitas ou despesas para os filtros escolhidos." />}
      </Card>}

      <PaymentCreateModal open={modal?.kind === "newRevenue"} onClose={() => setModal(null)} onCreated={(_, patient) => toast.success(`Pagamento de ${patient} foi registrado.`)} />
      {modal?.kind === "newExpense" ? <ExpenseFormModal expense={null} onClose={() => setModal(null)} onSaved={() => done("Despesa registrada.")} /> : null}
      {modal && "item" in modal ? <MovementModals modal={modal} onClose={() => setModal(null)} onDone={done} canManage={canManageItem(modal.item)} /> : null}
    </div>
  );
}

function MovementModals({ modal, onClose, onDone, canManage }: { modal: Extract<Modal, { item: MovementItem }>; onClose: () => void; onDone: (message: string) => void; canManage: boolean }) {
  const { item } = modal;
  const status = movementStatus(item);
  if (modal.kind === "view") {
    return <DetailsModal onClose={onClose} title={item.kind === "revenue" ? "Detalhes da receita" : "Detalhes da despesa"} rows={[
      ["Descrição", item.description], ["Data", formatDate(item.date)], ["Valor", formatCents(item.amountCents)], ["Categoria", item.category],
      ["Situação", status.label], ["Forma de pagamento", item.method],
      ...(item.patientName ? [["Paciente", item.patientName] as [string, string]] : []),
      ...(item.source ? [["Origem", sourceLabels[item.source] ?? item.source] as [string, string]] : []),
    ]} />;
  }
  if (!canManage) return null;
  if (modal.kind === "editPayment") return <PaymentEditModal payment={{ id: item.id, patientId: item.patientId, patientName: item.patientName, amountCents: item.amountCents, method: item.method, date: item.date }} onClose={onClose} onSaved={() => onDone("Pagamento atualizado.")} />;
  if (modal.kind === "receive") return <ReceivePaymentModal payment={{ id: item.id, patientId: item.patientId, patientName: item.patientName, amountCents: item.amountCents, method: item.method, date: item.date }} onClose={onClose} onSaved={() => onDone("Recebimento registrado.")} />;
  if (modal.kind === "deleteRevenue") return <ConfirmModal title="Excluir receita" description={`${item.description} · ${formatCents(item.amountCents)}. Esta ação não pode ser desfeita.`} confirmLabel="Excluir" onClose={onClose} onConfirm={async () => {
    const { ok, data } = await sendJson<{ message?: string }>(`/api/payments/${item.id}`, "DELETE");
    if (!ok) return data?.message ?? "Não foi possível excluir o pagamento.";
    invalidatePaymentCache(item.patientId);
    onDone("Receita excluída.");
    return null;
  }} />;
  if (modal.kind === "editExpense") return <ExpenseFormModal expense={expenseFromMovement(item)} onClose={onClose} onSaved={() => onDone("Despesa atualizada.")} />;
  if (modal.kind === "pay") return <PayExpenseModal expense={item} onClose={onClose} onConfirm={async (paidOn) => {
    const result = await patchExpense(item.id, { action: "pay", paidOn });
    if (!result.ok) return result.message ?? "Não foi possível registrar o pagamento.";
    onDone("Pagamento registrado.");
    return null;
  }} />;
  if (modal.kind === "unpay") return <ConfirmModal title="Desfazer pagamento" description={`${item.description} voltará para "a pagar".`} confirmLabel="Desfazer pagamento" onClose={onClose} onConfirm={async () => {
    const result = await patchExpense(item.id, { action: "unpay" });
    if (!result.ok) return result.message ?? "Não foi possível desfazer o pagamento.";
    onDone("Pagamento desfeito.");
    return null;
  }} />;
  return <ConfirmModal title="Cancelar despesa" description={`${item.description} · ${formatCents(item.amountCents)} deixará de contar no financeiro.`} confirmLabel="Cancelar despesa" onClose={onClose} onConfirm={async () => {
    const result = await patchExpense(item.id, { action: "cancel" });
    if (!result.ok) return result.message ?? "Não foi possível cancelar a despesa.";
    onDone("Despesa cancelada.");
    return null;
  }} />;
}

