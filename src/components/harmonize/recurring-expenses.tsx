"use client";

import { type FormEvent, useEffect, useState } from "react";
import { CalendarX, Loader2, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaskedInput } from "@/components/ui/masked-input";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { clinicToday } from "@/lib/clinic-time";
import { expenseCategories, type RecurringFrequency } from "@/lib/finance-rules";
import { formatCurrency, parseCurrency } from "@/lib/input-masks";
import { sendJson } from "@/lib/send-json";
import { EmptyState } from "./shared";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const recurringKey = "/api/recurring-expenses";
const weekdays = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const frequencyLabels: Record<RecurringFrequency, string> = { weekly: "Semanal", monthly: "Mensal", yearly: "Anual" };

type RecurringExpense = { id: string; description: string; category: string; amountCents: number; paymentMethod: string; frequency: RecurringFrequency; weekday: number | null; dayOfMonth: number | null; month: number | null; startsOn: string; endsOn: string | null };

function scheduleLabel(item: RecurringExpense) {
  if (item.frequency === "weekly") return `Toda ${weekdays[item.weekday ?? 0]}`;
  if (item.frequency === "monthly") return `Todo dia ${item.dayOfMonth}`;
  return `Todo ano em ${item.dayOfMonth} de ${months[(item.month ?? 1) - 1]}`;
}

function formatDate(value: string) {
  return value.split("-").reverse().join("/");
}

export function RecurringExpensesCard({ paymentMethods, onChanged }: { paymentMethods: string[]; onChanged: () => void }) {
  const [items, setItems] = useState<RecurringExpense[] | null>(() => readClientCache<{ recurringExpenses: RecurringExpense[] }>(recurringKey)?.recurringExpenses ?? null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<RecurringExpense | "new" | null>(null);
  const [ending, setEnding] = useState<RecurringExpense | null>(null);

  useEffect(() => {
    let active = true;
    getCachedJson<{ recurringExpenses: RecurringExpense[] }>(recurringKey).then((data) => { if (active) setItems(data.recurringExpenses); }).catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, [version]);

  useEffect(() => {
    const handle = (event: Event) => { if ((event as CustomEvent<string[]>).detail?.includes(recurringKey)) setVersion((current) => current + 1); };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
  }, []);

  function saved() {
    setEditing(null);
    setEnding(null);
    invalidateClientCache(recurringKey);
    onChanged();
  }

  const today = clinicToday();
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Despesas fixas</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>Nova despesa fixa</Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">As ocorrências do mês são criadas como &quot;a pagar&quot; ao abrir o Financeiro. Mudar o valor vale para as próximas.</p>
        {!items ? <div className="grid place-items-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : items.length ? (
          <div className="divide-y divide-border">
            {items.map((item) => {
              const ended = Boolean(item.endsOn && item.endsOn < today);
              return (
                <div className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${ended ? "opacity-60" : ""}`} key={item.id}>
                  <div className="min-w-0">
                    <p className="font-bold text-foreground">{item.description}</p>
                    <p className="text-xs text-muted-foreground">{frequencyLabels[item.frequency]} · {scheduleLabel(item)} · {item.category} · desde {formatDate(item.startsOn)}{item.endsOn ? ` até ${formatDate(item.endsOn)}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <strong className="text-foreground">{currency.format(item.amountCents / 100)}</strong>
                    {ended ? <Badge variant="slate">Encerrada</Badge> : <>
                      <Button size="icon" variant="ghost" aria-label="Editar despesa fixa" title="Editar" onClick={() => setEditing(item)}><PencilLine className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="secondary" onClick={() => setEnding(item)}><CalendarX className="h-3.5 w-3.5" />Encerrar</Button>
                    </>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState title="Nenhuma despesa fixa" description="Cadastre aluguel, salários e outras contas que se repetem." />}
      </CardContent>
      {editing ? <RecurringFormModal item={editing === "new" ? null : editing} paymentMethods={paymentMethods} onClose={() => setEditing(null)} onSaved={saved} /> : null}
      {ending ? <EndRecurringModal item={ending} onClose={() => setEnding(null)} onSaved={saved} /> : null}
    </Card>
  );
}

function RecurringFormModal({ item, paymentMethods, onClose, onSaved }: { item: RecurringExpense | null; paymentMethods: string[]; onClose: () => void; onSaved: () => void }) {
  const [frequency, setFrequency] = useState<RecurringFrequency>(item?.frequency ?? "monthly");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = Math.round(parseCurrency(form.get("amount")) * 100);
    if (amountCents <= 0) return setError("Informe o valor.");
    const common = { description: String(form.get("description") ?? ""), category: String(form.get("category") ?? ""), amountCents, paymentMethod: String(form.get("paymentMethod") ?? "") };
    const payload = item ? common : {
      ...common,
      frequency,
      weekday: Number(form.get("weekday")),
      dayOfMonth: Number(form.get("dayOfMonth")),
      month: Number(form.get("month")),
      startsOn: String(form.get("startsOn") ?? ""),
      endsOn: String(form.get("endsOn") ?? "") || null,
    };
    setSaving(true);
    setError("");
    const { ok, data } = await sendJson(item ? `${recurringKey}/${item.id}` : recurringKey, item ? "PATCH" : "POST", payload);
    setSaving(false);
    if (!ok) return setError(data?.message ?? "Não foi possível salvar.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={item ? "Editar despesa fixa" : "Nova despesa fixa"} description={item ? "As mudanças valem para as próximas ocorrências. Para mudar o vencimento, encerre esta e crie outra." : "Ex.: aluguel, salários, sistemas e contas que se repetem."}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div className="sm:col-span-2"><FormField label="Descrição"><input className={fieldClassName} name="description" defaultValue={item?.description ?? ""} required /></FormField></div>
        <FormField label="Categoria"><select className={fieldClassName} name="category" defaultValue={item?.category ?? ""} required><option value="">Selecione</option>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></FormField>
        <FormField label="Valor"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="amount" inputMode="decimal" placeholder="R$ 0,00" defaultValue={item ? currency.format(item.amountCents / 100) : ""} required /></FormField>
        <FormField label="Forma de pagamento"><select className={fieldClassName} name="paymentMethod" defaultValue={item?.paymentMethod ?? "Pix"}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></FormField>
        {!item ? <>
          <FormField label="Frequência"><select className={fieldClassName} value={frequency} onChange={(event) => setFrequency(event.target.value as RecurringFrequency)}>{(Object.keys(frequencyLabels) as RecurringFrequency[]).map((key) => <option key={key} value={key}>{frequencyLabels[key]}</option>)}</select></FormField>
          {frequency === "weekly" ? <FormField label="Dia da semana"><select className={fieldClassName} name="weekday" defaultValue="5">{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></FormField> : null}
          {frequency !== "weekly" ? <FormField label="Dia do vencimento" description="Se o mês não tiver esse dia, vence no último dia."><input className={fieldClassName} name="dayOfMonth" type="number" min="1" max="31" defaultValue="10" required /></FormField> : null}
          {frequency === "yearly" ? <FormField label="Mês"><select className={fieldClassName} name="month" defaultValue="1">{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></FormField> : null}
          <FormField label="Início"><input className={fieldClassName} name="startsOn" type="date" defaultValue={clinicToday()} required /></FormField>
          <FormField label="Fim (opcional)"><input className={fieldClassName} name="endsOn" type="date" /></FormField>
        </> : null}
        {error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

function EndRecurringModal({ item, onClose, onSaved }: { item: RecurringExpense; onClose: () => void; onSaved: () => void }) {
  const [endsOn, setEndsOn] = useState(clinicToday());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal open onClose={onClose} title="Encerrar despesa fixa" description={`${item.description}: nenhuma ocorrência será criada depois desta data. As passadas continuam no histórico.`}>
      <div className="space-y-4">
        <FormField label="Última data"><input className={fieldClassName} type="date" value={endsOn} min={item.startsOn} onChange={(event) => setEndsOn(event.target.value)} /></FormField>
        {error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={saving || !endsOn} onClick={async () => {
            setSaving(true);
            const { ok, data } = await sendJson(`${recurringKey}/${item.id}`, "PATCH", { endsOn });
            setSaving(false);
            if (!ok) return setError(data?.message ?? "Não foi possível encerrar.");
            onSaved();
          }}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Encerrar</Button>
        </div>
      </div>
    </Modal>
  );
}
