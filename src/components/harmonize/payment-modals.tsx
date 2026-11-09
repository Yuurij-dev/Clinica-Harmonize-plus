"use client";

import { type FormEvent, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaskedInput } from "@/components/ui/masked-input";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { clinicToday } from "@/lib/clinic-time";
import { formatCurrency, parseCurrency } from "@/lib/input-masks";
import { sendJson } from "@/lib/send-json";
import { ErrorNote, formatCents, invalidatePaymentCache, paymentMethods } from "./finance-shared";
import { usePatientLookup, type LookupPatient } from "./use-patient-lookup";

export type CreatedPayment = { id: string; value: number; method: string; date: string; status: string; installments: string; patient?: { name: string } | null };

// Modal "Registrar pagamento" compartilhado por /pagamentos e pelo Financeiro (mesmos campos e regras do POST /api/payments).
export function PaymentCreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (payment: CreatedPayment, patientName: string, patientId: string) => void }) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [paymentPatientQuery, setPaymentPatientQuery] = useState("");
  const [paymentPatient, setPaymentPatient] = useState<LookupPatient | null>(null);
  const paymentLookup = usePatientLookup(paymentPatientQuery, !paymentPatient);

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIsSaving(true); setError(""); const form = new FormData(event.currentTarget); const patientId = paymentPatient?.id ?? ""; const patient = paymentPatient?.name ?? "Paciente";
    const response = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, value: parseCurrency(form.get("value")), method: String(form.get("method")), status: String(form.get("status")), installments: String(form.get("installments")) }) });
    setIsSaving(false);
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as { message?: string } | null;
      return setError(failure?.message ?? "Não foi possível registrar o pagamento.");
    }
    const data = await response.json() as { payment: CreatedPayment };
    invalidatePaymentCache(patientId);
    setPaymentPatient(null); setPaymentPatientQuery("");
    onClose(); onCreated?.(data.payment, patient, patientId);
  }

  function close() {
    setPaymentPatient(null); setPaymentPatientQuery(""); setError("");
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title="Registrar pagamento" description="O lançamento aparecerá imediatamente no histórico financeiro.">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={savePayment}>
        <div className="relative sm:col-span-2">
          <FormField label="Paciente"><input className={fieldClassName} name="patientSearch" placeholder="Pesquise por nome ou CPF" required value={paymentPatientQuery} onChange={(event) => { setPaymentPatientQuery(event.target.value); setPaymentPatient(null); }} /></FormField>
          {paymentPatientQuery && !paymentPatient ? <div className="absolute left-0 right-0 top-[68px] z-20 max-h-44 overflow-auto rounded-[7px] border border-[#e5e5ee] bg-white p-1 shadow-xl">
            {paymentLookup.patients.length ? paymentLookup.patients.map((item) => <button className="flex w-full items-center justify-between rounded-[5px] px-3 py-2 text-left text-xs transition hover:bg-[#f5f4ff]" key={item.id} type="button" onClick={() => { setPaymentPatient(item); setPaymentPatientQuery(`${item.name}${item.cpf ? ` · ${item.cpf}` : ""}`); }}><span className="font-bold text-[#303144]">{item.name}</span><span className="text-[10px] text-[#858696]">{item.cpf || "CPF não informado"}</span></button>) : <p className="px-3 py-2 text-xs text-[#858696]">{paymentLookup.tooShort ? "Digite pelo menos 2 letras." : paymentLookup.loading ? "Buscando pacientes..." : paymentLookup.error ? "Não foi possível buscar pacientes." : "Nenhum paciente encontrado."}</p>}
          </div> : null}
          {paymentPatient ? <p className="mt-1 text-[10px] font-semibold text-[#5147dc]">Paciente selecionado: {paymentPatient.name}</p> : null}
        </div>
        <FormField label="Valor"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="value" inputMode="decimal" placeholder="R$ 0,00" required /></FormField>
        <FormField label="Forma"><select className={fieldClassName} name="method"><option>Pix</option><option>Cartão de crédito</option><option>Cartão de débito</option><option>Dinheiro</option></select></FormField>
        <FormField label="Status"><select className={fieldClassName} name="status"><option>Pago</option><option>Parcial</option><option>Pendente</option></select></FormField>
        <FormField label="Parcelamento"><input className={fieldClassName} name="installments" defaultValue="À vista" required /></FormField>
        {error ? <div className="sm:col-span-2"><ErrorNote message={error} /></div> : null}
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={close}>Cancelar</Button><Button disabled={isSaving || !paymentPatient} type="submit">{isSaving ? "Salvando..." : "Registrar pagamento"}</Button></div>
      </form>
    </Modal>
  );
}

export type EditablePayment = { id: string; patientId?: string | null; patientName?: string | null; amountCents: number; method: string; date: string };

// PATCH /api/payments/[id] sem action: valor (em reais), forma e data. Não muda paciente nem tratamento.
export function PaymentEditModal({ payment, onClose, onSaved }: { payment: EditablePayment; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const methods = paymentMethods.includes(payment.method) ? paymentMethods : [payment.method, ...paymentMethods];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = parseCurrency(form.get("value"));
    if (!(value >= 0) || form.get("value") === "") return setError("Informe um valor válido.");
    setSaving(true);
    setError("");
    const { ok, data } = await sendJson<{ message?: string }>(`/api/payments/${payment.id}`, "PATCH", { value, method: String(form.get("method") ?? ""), date: String(form.get("date") ?? "") });
    setSaving(false);
    if (!ok) return setError(data?.message ?? "Não foi possível salvar o pagamento.");
    invalidatePaymentCache(payment.patientId);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Editar pagamento" description={payment.patientName ? `Paciente: ${payment.patientName}` : undefined}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <FormField label="Valor"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="value" inputMode="decimal" placeholder="R$ 0,00" defaultValue={formatCents(payment.amountCents)} required /></FormField>
        <FormField label="Forma"><select className={fieldClassName} name="method" defaultValue={payment.method}>{methods.map((method) => <option key={method}>{method}</option>)}</select></FormField>
        <FormField label="Data"><input className={fieldClassName} name="date" type="date" defaultValue={payment.date} required /></FormField>
        {error ? <div className="sm:col-span-2"><ErrorNote message={error} /></div> : null}
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{saving ? "Salvando..." : "Salvar"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// PATCH { action: "receive", receivedOn }: Pendente/Parcial passa a Pago na data informada.
export function ReceivePaymentModal({ payment, onClose, onSaved }: { payment: EditablePayment; onClose: () => void; onSaved: () => void }) {
  const [receivedOn, setReceivedOn] = useState(clinicToday());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal open onClose={onClose} title="Registrar recebimento" description={`${payment.patientName ?? "Paciente"} · ${formatCents(payment.amountCents)}`}>
      <div className="space-y-4">
        <FormField label="Data do recebimento"><input className={fieldClassName} type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} /></FormField>
        {error ? <ErrorNote message={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={saving || !receivedOn} onClick={async () => {
            setSaving(true);
            setError("");
            const { ok, data } = await sendJson<{ message?: string }>(`/api/payments/${payment.id}`, "PATCH", { action: "receive", receivedOn });
            setSaving(false);
            if (!ok) return setError(data?.message ?? "Não foi possível registrar o recebimento.");
            invalidatePaymentCache(payment.patientId);
            onSaved();
          }}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Confirmar recebimento</Button>
        </div>
      </div>
    </Modal>
  );
}
