"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatCep, formatCpf, formatDate, formatPhone } from "@/lib/input-masks";
import { isMaskedCpf } from "@/lib/patient-cpf-mask";
import { emptyPatientFormValues, type PatientFormValues } from "@/lib/patient-update-rules";
import { birthDateFromPtBr, fieldMaxLength, isMinorBirthDate, referralSources, relationshipOptions, sexOptions, PRIVACY_CONSENT_TEXT, validateRegistration } from "@/lib/patient-registration-rules";

type Values = PatientFormValues;

type SectionId = "personal" | "address" | "emergency" | "insurance";
// Qual seção recolhível contém cada campo validado (para abrir sozinha quando há erro).
const sectionOfField: Record<string, SectionId> = {
  postalCode: "address", emergencyContactPhone: "emergency", insuranceProvider: "insurance", insuranceCardNumber: "insurance",
};

export type NewPatientResult = { ok: true } | { ok: false; message: string; fields?: Record<string, string>; existingPatientId?: string };

type TextOptions = { label: string; required?: boolean; format?: (value: string) => string; placeholder?: string; inputMode?: "numeric" | "tel" | "email" | "text"; maxLength?: number; autoComplete?: string; onValue?: (value: string) => void; type?: string };
type TextKey = { [K in keyof Values]: Values[K] extends string ? K : never }[keyof Values];

const sectionHasData = (section: SectionId, values: Values) => ({
  personal: [values.socialName, values.sex, values.profession, values.referralSource],
  address: [values.postalCode, values.address, values.addressNumber, values.addressComplement, values.neighborhood, values.city, values.state],
  emergency: [values.emergencyContactName, values.emergencyContactPhone, values.emergencyContactRelationship],
  insurance: [values.careType === "Convênio" ? "x" : ""],
})[section].some(Boolean);

// Formulário único do cadastro ("create") e da edição de um cliente existente ("edit"): mesmos campos, seções e regras.
// Na edição vêm preenchidos (initialValues), o CPF pode estar mascarado (maskedCpf: em branco = manter), o CPF não é
// obrigatório e o aceite de privacidade é só exibido (consentAt), nunca pedido de novo.
export function PatientForm({ saving, onSubmit, onCancel, onOpenExisting, mode = "create", initialValues, maskedCpf, consentAt }: {
  saving: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<NewPatientResult>;
  onCancel: () => void;
  onOpenExisting?: (patientId: string) => void;
  mode?: "create" | "edit";
  initialValues?: Values;
  maskedCpf?: string;
  consentAt?: string | null;
}) {
  const editing = mode === "edit";
  const validate = (next: Values) => {
    const found = validateRegistration(editing ? { ...next, privacyConsent: true } : next, undefined, { editing });
    // CPF do responsável mascarado (vindo do servidor) = manter o atual.
    if (isMaskedCpf(next.legalGuardianCpf)) delete found.legalGuardianCpf;
    return found;
  };
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>(initialValues ?? emptyPatientFormValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set(editing && initialValues ? (["personal", "address", "emergency", "insurance"] as SectionId[]).filter((section) => sectionHasData(section, initialValues)) : []));
  const [attempt, setAttempt] = useState<{ tick: number; fields: string[] }>({ tick: 0, fields: [] });
  const [serverError, setServerError] = useState<{ message: string; existingPatientId?: string } | null>(null);
  const [cepStatus, setCepStatus] = useState("");
  const birth = birthDateFromPtBr(values.birthDate);
  const minor = isMinorBirthDate(values.birthDate);
  const errorCount = Object.keys(errors).length;

  function shake(names: string[]) {
    for (const name of names) {
      const element = formRef.current?.querySelector<HTMLElement>(`[data-field="${name}"]`);
      if (!element) continue;
      element.classList.remove("hp-field-shake");
      void element.offsetWidth; // reinicia a animação a cada tentativa
      element.classList.add("hp-field-shake");
    }
  }

  // Depois de renderizar (seções abertas): treme todos os inválidos e leva foco/rolagem ao primeiro, na ordem da tela.
  useEffect(() => {
    if (!attempt.tick) return;
    shake(attempt.fields);
    const ordered = [...(formRef.current?.querySelectorAll<HTMLElement>("[data-field]") ?? [])].filter((element) => attempt.fields.includes(element.dataset.field ?? ""));
    const target = ordered[0]?.querySelector<HTMLElement>("input, select, textarea");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [attempt]);

  function revalidate(next: Values) {
    const fresh = validate(next);
    // Só atualiza o que já estava com erro: some ao corrigir, e deixa de aparecer o que ficou oculto (ex.: CPF após virar menor).
    setErrors((current) => Object.fromEntries(Object.keys(current).filter((key) => fresh[key]).map((key) => [key, fresh[key]])));
  }

  function setValue<K extends keyof Values>(name: K, value: Values[K]) {
    const next = { ...values, [name]: value };
    setValues(next);
    setServerError(null);
    if (errorCount) revalidate(next);
  }

  function blur(name: string) {
    const message = validate(values)[name];
    if (!message) return;
    setErrors((current) => ({ ...current, [name]: message }));
    if (!errors[name]) shake([name]);
  }

  async function lookupCep(cep: string) {
    setCepStatus("Buscando endereço...");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (!response.ok || data.erro) { setCepStatus("CEP não encontrado. Preencha o endereço manualmente."); return; }
      setValues((current) => ({ ...current, address: data.logradouro || current.address, neighborhood: data.bairro || current.neighborhood, city: data.localidade || current.city, state: data.uf || current.state }));
      setCepStatus("");
    } catch {
      setCepStatus("Não foi possível buscar o CEP. Preencha o endereço manualmente.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    setServerError(null);
    const fields = Object.keys(found);
    if (fields.length) {
      setOpen((current) => { const next = new Set(current); for (const field of fields) { const section = sectionOfField[field]; if (section) next.add(section); } return next; });
      setAttempt((current) => ({ tick: current.tick + 1, fields }));
      return;
    }
    const { privacyConsent, ...rest } = values;
    void privacyConsent;
    const payload: Record<string, unknown> = editing ? rest : { ...values };
    if (editing && maskedCpf && !values.cpf) delete payload.cpf;
    const result = await onSubmit(payload);
    if (result.ok) return;
    const serverFields = result.fields ?? {};
    if (Object.keys(serverFields).length) {
      setErrors(serverFields);
      setOpen((current) => { const next = new Set(current); for (const field of Object.keys(serverFields)) { const section = sectionOfField[field]; if (section) next.add(section); } return next; });
      setAttempt((current) => ({ tick: current.tick + 1, fields: Object.keys(serverFields) }));
    } else setServerError({ message: result.message, existingPatientId: result.existingPatientId });
  }

  const toggle = (section: SectionId) => setOpen((current) => { const next = new Set(current); if (!next.delete(section)) next.add(section); return next; });
  const text = (name: TextKey, props: TextOptions) => (
    <Field name={name} label={props.label} required={props.required} error={errors[name]} uid={uid}>
      {(a11y) => (
        <Input {...a11y} type={props.type ?? "text"} name={name} value={values[name]} placeholder={props.placeholder} inputMode={props.inputMode} maxLength={props.maxLength ?? fieldMaxLength(name)} autoComplete={props.autoComplete}
          onChange={(event) => { const value = props.format ? props.format(event.target.value) : event.target.value; setValue(name, value as never); props.onValue?.(value); }} onBlur={() => blur(name)} />
      )}
    </Field>
  );

  const select = (name: TextKey, props: { label: string; required?: boolean; options: readonly string[]; empty: string }) => (
    <Field name={name} label={props.label} required={props.required} error={errors[name]} uid={uid}>{(a11y) => (
      <select {...a11y} name={name} className="flex h-10 w-full rounded-[8px] border border-input bg-white px-3 text-sm font-medium shadow-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 aria-invalid:border-destructive max-lg:h-11" value={values[name]} onChange={(event) => setValue(name, event.target.value as never)} onBlur={() => blur(name)}>
        <option value="">{props.empty}</option>
        {props.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    )}</Field>
  );

  const contactRequired = !minor;
  return (
    <form ref={formRef} noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        <div className="grid gap-4 min-[521px]:grid-cols-2">
          <div className="min-[521px]:col-span-2">{text("name", { label: "Nome completo", required: true, autoComplete: "name" })}</div>
          {text("birthDate", { label: "Data de nascimento", required: true, format: formatDate, placeholder: "dd/mm/aaaa", inputMode: "numeric", maxLength: 10 })}
          <div className="space-y-2">
            <Label htmlFor={`${uid}-age`} className="text-xs font-medium text-foreground">Idade</Label>
            <Input id={`${uid}-age`} readOnly tabIndex={-1} value={birth.ok ? birth.label : ""} placeholder={editing ? "Informe a data de nascimento" : "Calculada pela data"} className="bg-muted/40" />
          </div>
          {text("cpf", { label: "CPF", required: contactRequired && !editing, format: formatCpf, placeholder: maskedCpf ? `${maskedCpf} (em branco mantém)` : "000.000.000-00", inputMode: "numeric", maxLength: 14 })}
          {text("phone", { label: "Telefone / WhatsApp", required: contactRequired, format: formatPhone, placeholder: "(00) 00000-0000", inputMode: "tel", maxLength: 15, autoComplete: "tel" })}
          <div className="min-[521px]:col-span-2">{text("email", { label: "E-mail", type: "email", inputMode: "email", placeholder: "nome@email.com", autoComplete: "email" })}</div>

          {minor ? (
            <fieldset className="grid gap-4 rounded-[8px] border border-border bg-[#faf9ff] p-4 min-[521px]:col-span-2 min-[521px]:grid-cols-2">
              <legend className="px-1 text-xs font-semibold text-foreground">Responsável legal (cliente menor de 18 anos)</legend>
              <div className="min-[521px]:col-span-2">{text("legalGuardianName", { label: "Nome do responsável", required: true })}</div>
              {text("legalGuardianCpf", { label: "CPF do responsável", required: true, format: formatCpf, placeholder: "000.000.000-00", inputMode: "numeric", maxLength: 14 })}
              {text("legalGuardianPhone", { label: "Telefone do responsável", required: true, format: formatPhone, placeholder: "(00) 00000-0000", inputMode: "tel", maxLength: 15 })}
              <div className="min-[521px]:col-span-2">{select("legalGuardianRelationship", { label: "Parentesco", required: true, options: relationshipOptions, empty: "Selecione" })}</div>
            </fieldset>
          ) : null}

          <Section id="personal" title="Dados pessoais" open={open} onToggle={toggle} uid={uid}>
            {text("socialName", { label: "Nome social" })}
            {select("sex", { label: "Sexo", options: sexOptions, empty: "Não informado" })}
            {text("profession", { label: "Profissão" })}
            {select("referralSource", { label: "Como nos conheceu", options: referralSources, empty: "Selecione" })}
          </Section>

          <Section id="address" title="Endereço" open={open} onToggle={toggle} uid={uid}>
            {text("postalCode", { label: "CEP", format: formatCep, placeholder: "00000-000", inputMode: "numeric", maxLength: 9, autoComplete: "postal-code", onValue: (value) => { const digits = value.replace(/\D/g, ""); if (digits.length === 8) void lookupCep(digits); else setCepStatus(""); } })}
            <p role="status" className="self-end pb-2 text-xs text-muted-foreground">{cepStatus}</p>
            <div className="min-[521px]:col-span-2">{text("address", { label: "Rua" })}</div>
            {text("addressNumber", { label: "Número" })}
            {text("addressComplement", { label: "Complemento" })}
            {text("neighborhood", { label: "Bairro" })}
            {text("city", { label: "Cidade" })}
            {text("state", { label: "UF", maxLength: 2, format: (value) => value.replace(/[^a-zA-Z]/g, "").toUpperCase() })}
          </Section>

          <Section id="emergency" title="Contato de emergência" open={open} onToggle={toggle} uid={uid}>
            {text("emergencyContactName", { label: "Nome" })}
            {text("emergencyContactPhone", { label: "Telefone", format: formatPhone, placeholder: "(00) 00000-0000", inputMode: "tel", maxLength: 15 })}
            {select("emergencyContactRelationship", { label: "Parentesco", options: relationshipOptions, empty: "Selecione" })}
          </Section>

          <Section id="insurance" title="Convênio" open={open} onToggle={toggle} uid={uid}>
            <div className="min-[521px]:col-span-2">
              <Field name="careType" label="Forma de atendimento" uid={uid}>{() => (
                <div role="radiogroup" aria-label="Forma de atendimento" className="flex gap-2">
                  {["Particular", "Convênio"].map((option) => (
                    <label key={option} className={cn("flex h-10 flex-1 cursor-pointer items-center justify-center rounded-[8px] border text-sm font-semibold focus-within:ring-2 focus-within:ring-ring/30 max-lg:h-11", values.careType === option ? "border-primary bg-primary/10 text-primary" : "border-input bg-white text-foreground")}>
                      <input type="radio" name="careType" className="sr-only" checked={values.careType === option} onChange={() => setValue("careType", option)} />{option}
                    </label>
                  ))}
                </div>
              )}</Field>
            </div>
            {values.careType === "Convênio" ? <>
              {text("insuranceProvider", { label: "Operadora", required: true })}
              {text("insuranceCardNumber", { label: "Carteirinha", required: true })}
            </> : null}
          </Section>

          <div className="space-y-3 min-[521px]:col-span-2">
            {editing ? (
              <p className="text-xs leading-5 text-muted-foreground">{consentAt ? `Política de privacidade apresentada em ${new Date(consentAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "Aceite da política de privacidade não registrado."}</p>
            ) : <Field name="privacyConsent" label="" error={errors.privacyConsent} uid={uid}>{(a11y) => (
              <label className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-foreground">
                <input {...a11y} type="checkbox" name="privacyConsent" checked={values.privacyConsent} onChange={(event) => setValue("privacyConsent", event.target.checked)} onBlur={() => blur("privacyConsent")} className="mt-0.5 h-4 w-4 accent-[#5147dc]" />
                <span>{PRIVACY_CONSENT_TEXT}<span aria-hidden="true" className="ml-1 text-destructive">*</span></span>
              </label>
            )}</Field>}
            <label className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-foreground">
              <input type="checkbox" name="whatsappReminders" checked={values.whatsappReminders} onChange={(event) => setValue("whatsappReminders", event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#5147dc]" />
              <span>Aceita receber lembretes de consulta por WhatsApp.</span>
            </label>
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-card px-4 py-3 sm:px-6">
        {serverError ? (
          <p role="alert" className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[7px] border border-[#ffd7d7] bg-[#fff7f7] px-3 py-2 text-xs font-semibold text-[#b42318]">
            {serverError.message}
            {serverError.existingPatientId && onOpenExisting ? <button type="button" className="underline underline-offset-2" onClick={() => onOpenExisting(serverError.existingPatientId!)}>Abrir cadastro existente</button> : null}
          </p>
        ) : null}
        <p aria-live="polite" className={cn("text-xs font-semibold text-[#b42318]", errorCount && "mb-2")}>{errorCount ? `${errorCount} ${errorCount === 1 ? "campo precisa" : "campos precisam"} de correção` : ""}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">* Campos obrigatórios</p>
          <div className="flex gap-2">
            <Button disabled={saving} type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
            <Button disabled={saving} type="submit">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{saving ? "Salvando..." : editing ? "Salvar dados" : "Salvar cliente"}</Button>
          </div>
        </div>
      </footer>
    </form>
  );
}

type A11y = { id: string; "aria-invalid": boolean | undefined; "aria-required": boolean | undefined; "aria-describedby": string | undefined };

// Rótulo + controle + mensagem, ligados por id/aria. O wrapper [data-field] é o que treme.
function Field({ name, label, required = false, error, uid, children }: { name: string; label: string; required?: boolean; error?: string; uid: string; children: (a11y: A11y) => ReactNode }) {
  const id = `${uid}-${name}`;
  const a11y: A11y = { id, "aria-invalid": error ? true : undefined, "aria-required": required || undefined, "aria-describedby": error ? `${id}-error` : undefined };
  return (
    <div data-field={name} className="space-y-2">
      {label ? <Label htmlFor={id} className="text-xs font-medium text-foreground">{label}{required ? <span aria-hidden="true" className="ml-1 text-destructive">*</span> : null}</Label> : null}
      {children(a11y)}
      {error ? <p id={`${id}-error`} className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

function Section({ id, title, open, onToggle, uid, children }: { id: SectionId; title: string; open: Set<SectionId>; onToggle: (id: SectionId) => void; uid: string; children: ReactNode }) {
  const isOpen = open.has(id);
  return (
    <div className="rounded-[8px] border border-border min-[521px]:col-span-2">
      <button type="button" aria-expanded={isOpen} aria-controls={`${uid}-section-${id}`} onClick={() => onToggle(id)} className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-semibold text-foreground">
        {title}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")} />
      </button>
      {/* Montada mesmo fechada (hidden) para não perder o que foi digitado; campos ocultos não são validados. */}
      <div id={`${uid}-section-${id}`} hidden={!isOpen} className={cn("gap-4 border-t border-border p-4 min-[521px]:grid-cols-2", isOpen ? "grid" : "hidden")}>{children}</div>
    </div>
  );
}
