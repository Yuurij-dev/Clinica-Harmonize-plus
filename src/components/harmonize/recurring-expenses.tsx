"use client";

import { type FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaskedInput } from "@/components/ui/masked-input";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { clinicToday } from "@/lib/clinic-time";
import { expenseCategories, type RecurringFrequency } from "@/lib/finance-rules";
import { formatCurrency, parseCurrency } from "@/lib/input-masks";
import { sendJson } from "@/lib/send-json";
import { ErrorNote, formatCents, formatDate, invalidateRecurringCache, LoadingBlock, paymentMethods, useFinanceResource } from "./finance-shared";
import { EmptyState } from "./shared";

export const recurringKey = "/api/recurring-expenses";
const weekdays = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const frequencyLabels: Record<RecurringFrequency, string> = { weekly: "Semanal", monthly: "Mensal", yearly: "Anual" };

export type RecurringExpense = {
  id: string; description: string; category: string; amountCents: number; paymentMethod: string; frequency: RecurringFrequency;
  weekday: number | null; dayOfMonth: number | null; month: number | null; startsOn: string; endsOn: string | null;
  nextDueOn?: string | null; nextStatus?: string | null; overdueCount?: number; active?: boolean;
};
export type RecurringList = { recurringExpenses: RecurringExpense[]; totals: { activeCount: number; monthlyTotalCents: number; nextDueOn: string | null } };

export function scheduleLabel(item: RecurringExpense) {
  if (item.frequency === "weekly") return `Toda ${weekdays[item.weekday ?? 0]}`;
  if (item.frequency === "monthly") return `Dia ${item.dayOfMonth} de cada mês`;
  return `Todo ano em ${item.dayOfMonth} de ${months[(item.month ?? 1) - 1]}`;
}

// Mudanças em despesas fixas alteram ocorrências (despesas), resumo, movimentações e contas.
function recurringChanged(id?: string) {
  invalidateRecurringCache(id);
}

export function RecurringFormModal({ item, onClose, onSaved }: { item: RecurringExpense | null; onClose: () => void; onSaved: () => void }) {
  const [frequency, setFrequency] = useState<RecurringFrequency>(item?.frequency ?? "monthly");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = Math.round(parseCurrency(form.get("amount")) * 100);
    if (amountCents <= 0) return setError("Informe o valor.");
    const common = { description: String(form.get("description") ?? ""), category: String(form.get("category") ?? ""), amountCents, paymentMethod: String(form.get("paymentMethod") ?? "") };
    const schedule = { frequency, weekday: Number(form.get("weekday")), dayOfMonth: Number(form.get("dayOfMonth")), month: Number(form.get("month")) };
    const payload = item ? { ...common, ...schedule } : {
      ...common,
      ...schedule,
      startsOn: String(form.get("startsOn") ?? ""),
      endsOn: String(form.get("endsOn") ?? "") || null,
    };
    setSaving(true);
    setError("");
    const { ok, data } = await sendJson(item ? `${recurringKey}/${item.id}` : recurringKey, item ? "PATCH" : "POST", payload);
    setSaving(false);
    if (!ok) return setError(data?.message ?? "Não foi possível salvar.");
    recurringChanged(item?.id);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={item ? "Editar despesa fixa" : "Nova despesa fixa"} description={item ? "Valor e forma de pagamento valem para as próximas ocorrências. Mudar a frequência ou o dia refaz as ocorrências em aberto de hoje em diante; as pagas ficam como estão." : "Ex.: aluguel, salários, sistemas e contas que se repetem."}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div className="sm:col-span-2"><FormField label="Descrição"><input className={fieldClassName} name="description" defaultValue={item?.description ?? ""} required /></FormField></div>
        <FormField label="Categoria"><select className={fieldClassName} name="category" defaultValue={item?.category ?? ""} required><option value="">Selecione</option>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></FormField>
        <FormField label="Valor"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="amount" inputMode="decimal" placeholder="R$ 0,00" defaultValue={item ? formatCents(item.amountCents) : ""} required /></FormField>
        <FormField label="Forma de pagamento"><select className={fieldClassName} name="paymentMethod" defaultValue={item?.paymentMethod ?? "Pix"}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></FormField>
        <FormField label="Frequência"><select className={fieldClassName} value={frequency} onChange={(event) => setFrequency(event.target.value as RecurringFrequency)}>{(Object.keys(frequencyLabels) as RecurringFrequency[]).map((key) => <option key={key} value={key}>{frequencyLabels[key]}</option>)}</select></FormField>
        {frequency === "weekly" ? <FormField label="Dia da semana"><select className={fieldClassName} name="weekday" defaultValue={String(item?.weekday ?? 5)}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></FormField> : null}
        {frequency !== "weekly" ? <FormField label="Dia do vencimento" description="Se o mês não tiver esse dia, vence no último dia."><input className={fieldClassName} name="dayOfMonth" type="number" min="1" max="31" defaultValue={item?.dayOfMonth ?? 10} required /></FormField> : null}
        {frequency === "yearly" ? <FormField label="Mês"><select className={fieldClassName} name="month" defaultValue={String(item?.month ?? 1)}>{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></FormField> : null}
        {!item ? <>
          <FormField label="Início"><input className={fieldClassName} name="startsOn" type="date" defaultValue={clinicToday()} required /></FormField>
          <FormField label="Fim (opcional)"><input className={fieldClassName} name="endsOn" type="date" /></FormField>
        </> : null}
        {error ? <div className="sm:col-span-2"><ErrorNote message={error} /></div> : null}
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

export function EndRecurringModal({ item, onClose, onSaved }: { item: RecurringExpense; onClose: () => void; onSaved: () => void }) {
  const [endsOn, setEndsOn] = useState(clinicToday());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal open onClose={onClose} title="Encerrar despesa fixa" description={`${item.description}: nenhuma ocorrência será criada depois desta data. As passadas continuam no histórico.`}>
      <div className="space-y-4">
        <FormField label="Última data"><input className={fieldClassName} type="date" value={endsOn} min={item.startsOn} onChange={(event) => setEndsOn(event.target.value)} /></FormField>
        {error ? <ErrorNote message={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={saving || !endsOn} onClick={async () => {
            setSaving(true);
            setError("");
            const { ok, data } = await sendJson(`${recurringKey}/${item.id}`, "PATCH", { endsOn });
            setSaving(false);
            if (!ok) return setError(data?.message ?? "Não foi possível encerrar.");
            recurringChanged(item.id);
            onSaved();
          }}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Encerrar</Button>
        </div>
      </div>
    </Modal>
  );
}

// DELETE remove a despesa fixa e as ocorrências não pagas; com alguma paga o servidor responde 409 e oferecemos Encerrar.
export function DeleteRecurringModal({ item, onClose, onSaved, onEnd }: { item: RecurringExpense; onClose: () => void; onSaved: () => void; onEnd: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  return (
    <Modal open onClose={onClose} title="Excluir despesa fixa" description={`${item.description}: a despesa fixa e as ocorrências ainda não pagas serão removidas.`}>
      <div className="space-y-4">
        {error ? <ErrorNote message={error} /> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Voltar</Button>
          {blocked ? <Button type="button" onClick={onEnd}>Encerrar em vez de excluir</Button> : <Button type="button" variant="destructive" disabled={saving} onClick={async () => {
            setSaving(true);
            setError("");
            const { ok, status, data } = await sendJson(`${recurringKey}/${item.id}`, "DELETE");
            setSaving(false);
            if (!ok) {
              setBlocked(status === 409);
              return setError(data?.message ?? "Não foi possível excluir.");
            }
            recurringChanged(item.id);
            onSaved();
          }}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Excluir</Button>}
        </div>
      </div>
    </Modal>
  );
}

type Occurrence = { id: string; description: string; amountCents: number; dueOn: string; paidOn: string | null; status: "open" | "paid" | "cancelled" };
const occurrenceStatus: Record<Occurrence["status"], { label: string; variant: "amber" | "green" | "slate" }> = { open: { label: "A pagar", variant: "amber" }, paid: { label: "Paga", variant: "green" }, cancelled: { label: "Cancelada", variant: "slate" } };

export function RecurringHistoryModal({ item, onClose }: { item: RecurringExpense; onClose: () => void }) {
  const key = `${recurringKey}/${item.id}?limit=24`;
  const { data, loading, error, reload } = useFinanceResource<{ occurrences: Occurrence[] }>(key);
  return (
    <Modal open onClose={onClose} title="Histórico de ocorrências" description={`${item.description} · ${frequencyLabels[item.frequency]} · ${scheduleLabel(item)}`}>
      {loading ? <LoadingBlock /> : error ? <ErrorNote message={error} onRetry={reload} /> : data?.occurrences.length ? (
        <ul className="max-h-[50vh] divide-y divide-border overflow-auto">
          {data.occurrences.map((occurrence) => (
            <li key={occurrence.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <p className="text-sm font-semibold text-foreground">Vencimento {formatDate(occurrence.dueOn)}</p>
                <p className="text-xs text-muted-foreground">{occurrence.paidOn ? `Paga em ${formatDate(occurrence.paidOn)}` : "Ainda não paga"}</p>
              </div>
              <div className="flex items-center gap-2">
                <strong className="text-sm text-foreground">{formatCents(occurrence.amountCents)}</strong>
                <Badge variant={occurrenceStatus[occurrence.status].variant}>{occurrenceStatus[occurrence.status].label}</Badge>
              </div>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="Sem ocorrências" description="Ainda não há ocorrências geradas para esta despesa fixa." />}
      <div className="mt-4 flex justify-end"><Button type="button" variant="secondary" onClick={onClose}>Fechar</Button></div>
    </Modal>
  );
}
