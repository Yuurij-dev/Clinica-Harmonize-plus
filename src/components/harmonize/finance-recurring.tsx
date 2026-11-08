"use client";

import { useState } from "react";
import { CalendarCheck, CalendarClock, CalendarX, History, PencilLine, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { invalidateClientCache } from "@/lib/client-cache";
import { clinicToday } from "@/lib/clinic-time";
import { useCan } from "./current-user";
import { ErrorNote, FinanceHeader, formatCents, formatDate, LoadingBlock, useFinanceResource } from "./finance-shared";
import { DeleteRecurringModal, EndRecurringModal, frequencyLabels, RecurringFormModal, RecurringHistoryModal, recurringKey, scheduleLabel, type RecurringExpense, type RecurringList } from "./recurring-expenses";
import { EmptyState } from "./shared";

export function RecurringStatusBadge({ item }: { item: RecurringExpense }) {
  if (item.active === false) return <Badge variant="slate">Encerrada</Badge>;
  if (item.nextStatus === "paid") return <Badge variant="green">Paga</Badge>;
  return <Badge variant="amber">Pendente</Badge>;
}

export function FinanceRecurring({ onBack }: { onBack: () => void }) {
  const canManage = useCan("finance:manage");
  const { data, loading, error, reload } = useFinanceResource<RecurringList>(canManage ? recurringKey : null);
  const [editing, setEditing] = useState<RecurringExpense | "new" | null>(null);
  const [ending, setEnding] = useState<RecurringExpense | null>(null);
  const [deleting, setDeleting] = useState<RecurringExpense | null>(null);
  const [history, setHistory] = useState<RecurringExpense | null>(null);
  const today = clinicToday();

  const header = (
    <FinanceHeader icon={CalendarClock} title="Despesas recorrentes" description="Gerencie suas despesas fixas e recorrentes." parent="Financeiro" onParent={onBack}
      actions={canManage ? <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Nova despesa fixa</Button> : undefined} />
  );
  if (!canManage) return <div>{header}<EmptyState title="Acesso restrito" description="Você não tem permissão para ver as despesas recorrentes." /></div>;

  const items = data?.recurringExpenses ?? [];
  const totals = data?.totals;
  const actions = (item: RecurringExpense) => item.active === false ? (
    <div className="flex items-center justify-end gap-1">
      <Button size="icon" variant="ghost" aria-label="Histórico de ocorrências" title="Histórico" onClick={() => openHistory(item)}><History className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" aria-label="Excluir despesa fixa" title="Excluir" onClick={() => setDeleting(item)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
    </div>
  ) : (
    <div className="flex items-center justify-end gap-1">
      <Button size="icon" variant="ghost" aria-label="Editar despesa fixa" title="Editar" onClick={() => setEditing(item)}><PencilLine className="h-4 w-4 text-primary" /></Button>
      <Button size="icon" variant="ghost" aria-label="Histórico de ocorrências" title="Histórico" onClick={() => openHistory(item)}><History className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" aria-label="Encerrar despesa fixa" title="Encerrar" onClick={() => setEnding(item)}><CalendarX className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" aria-label="Excluir despesa fixa" title="Excluir" onClick={() => setDeleting(item)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
    </div>
  );

  function openHistory(item: RecurringExpense) {
    // O histórico muda com pagamentos feitos em outras telas: sempre busca de novo ao abrir.
    invalidateClientCache(`${recurringKey}/${item.id}`);
    setHistory(item);
  }

  return (
    <div>
      {header}
      <div className="hp-list-stagger mb-5 grid gap-4 md:grid-cols-3">
        <Card className="flex items-center gap-3 p-4"><span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-primary"><CalendarCheck className="h-5 w-5" /></span><div><p className="text-xl font-black text-foreground">{totals ? totals.activeCount : "—"}</p><p className="text-xs text-muted-foreground">Despesas ativas</p></div></Card>
        <Card className="flex items-center gap-3 p-4"><span className="grid h-11 w-11 place-items-center rounded-xl bg-success/10 text-success"><Wallet className="h-5 w-5" /></span><div><p className="text-xl font-black text-foreground">{totals ? formatCents(totals.monthlyTotalCents) : "—"}</p><p className="text-xs text-muted-foreground">Total mensal (equivalente)</p></div></Card>
        <Card className="flex items-center gap-3 p-4"><span className="grid h-11 w-11 place-items-center rounded-xl bg-warning/10 text-warning"><CalendarClock className="h-5 w-5" /></span><div><p className="text-xs text-muted-foreground">Próximo vencimento</p><p className="text-xl font-black text-foreground">{totals ? (totals.nextDueOn ? formatDate(totals.nextDueOn) : "—") : "—"}</p></div></Card>
      </div>

      <Card className="p-4">
        {loading ? <LoadingBlock /> : error ? <ErrorNote message={error} onRetry={reload} /> : items.length ? (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader><TableRow><TableHead>Descrição</TableHead><TableHead>Valor</TableHead><TableHead>Frequência</TableHead><TableHead>Próximo vencimento</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} className={item.active === false ? "opacity-70" : ""}>
                      <TableCell><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-primary"><CalendarClock className="h-4 w-4" /></span><div><p className="font-bold text-foreground">{item.description}</p><p className="text-xs text-muted-foreground">{scheduleLabel(item)} · {item.category}</p></div></div></TableCell>
                      <TableCell className="font-semibold">{formatCents(item.amountCents)}</TableCell>
                      <TableCell>{frequencyLabels[item.frequency]}</TableCell>
                      <TableCell>{item.active === false ? (item.endsOn && item.endsOn < today ? `Encerrada em ${formatDate(item.endsOn)}` : "—") : item.nextDueOn ? formatDate(item.nextDueOn) : "—"}</TableCell>
                      <TableCell><div className="flex flex-col items-start gap-1"><RecurringStatusBadge item={item} />{item.active !== false && item.overdueCount ? <span className="text-[11px] font-semibold text-destructive">{item.overdueCount} vencida{item.overdueCount > 1 ? "s" : ""} em aberto</span> : null}</div></TableCell>
                      <TableCell>{actions(item)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {items.map((item) => (
                <li key={item.id} className={`space-y-2 py-3 ${item.active === false ? "opacity-70" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-bold text-foreground">{item.description}</p><p className="text-xs text-muted-foreground">{frequencyLabels[item.frequency]} · {scheduleLabel(item)}</p></div>
                    <RecurringStatusBadge item={item} />
                  </div>
                  <div className="flex items-center justify-between text-sm"><strong>{formatCents(item.amountCents)}</strong><span className="text-xs text-muted-foreground">Próx.: {item.active !== false && item.nextDueOn ? formatDate(item.nextDueOn) : "—"}</span></div>
                  {item.active !== false && item.overdueCount ? <p className="text-[11px] font-semibold text-destructive">{item.overdueCount} vencida{item.overdueCount > 1 ? "s" : ""} em aberto</p> : null}
                  {actions(item)}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Mostrando {items.length} {items.length === 1 ? "registro" : "registros"}</p>
          </>
        ) : <EmptyState title="Nenhuma despesa fixa" description="Cadastre aluguel, salários e outras contas que se repetem." action={<Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Nova despesa fixa</Button>} />}
      </Card>

      {editing ? <RecurringFormModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { toast.success(editing === "new" ? "Despesa fixa criada." : "Despesa fixa atualizada."); setEditing(null); }} /> : null}
      {ending ? <EndRecurringModal item={ending} onClose={() => setEnding(null)} onSaved={() => { toast.success("Despesa fixa encerrada."); setEnding(null); }} /> : null}
      {deleting ? <DeleteRecurringModal item={deleting} onClose={() => setDeleting(null)} onSaved={() => { toast.success("Despesa fixa excluída."); setDeleting(null); }} onEnd={() => { setEnding(deleting); setDeleting(null); }} /> : null}
      {history ? <RecurringHistoryModal item={history} onClose={() => setHistory(null)} /> : null}
    </div>
  );
}
