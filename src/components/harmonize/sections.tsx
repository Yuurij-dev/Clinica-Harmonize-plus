"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Camera,
  CheckCircle2,
  Check,
  CircleDollarSign,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  MoreVertical,
  PencilLine,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaskedInput } from "@/components/ui/masked-input";
import {
  DetailCard,
  DateRangeFilter,
  EmptyState,
  CountUpValue,
  LoadingSkeleton,
  LoadingTable,
  MiniTable,
  ProgressBar,
  SearchFilterBar,
  SectionIntro,
  StatusBadge,
} from "./shared";
import { CostCalculator } from "./cost-calculator";
import { PatientDetail } from "./patient-detail";
import { buildCustomerJourney } from "@/lib/customer-journey";
import {
  formatCurrency,
  formatCpf,
  formatDate,
  formatInteger,
  formatPercent,
  formatPhone,
  parseCurrency,
  parseInteger,
} from "@/lib/input-masks";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { cn } from "@/lib/utils";
import type { Appointment, JourneyStageId, Patient, Payment, Procedure, Product, Quote } from "@/types/clinic";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const procedureCategories = [
  "Preenchimento",
  "Toxina botulínica",
  "Bioestimulação",
  "Fios de sustentação",
  "Peeling",
  "Microagulhamento",
  "Limpeza de pele",
  "Laser e tecnologias",
  "Skinbooster e mesoterapia",
  "Outro",
];

const materialOptions = [
  "Ácido hialurônico",
  "Toxina botulínica",
  "Bioestimulador de colágeno",
  "Fios de PDO",
  "Peeling químico",
  "Anestésico tópico",
  "Microagulhas",
  "Antisséptico",
  "Luvas descartáveis",
  "Gel condutor",
  "Protetor solar",
  "Outro",
];

const appointmentTypeOptions = ["Consulta / retorno", "Avaliação", "Procedimento", "Outros"];

type CreateProps = {
  openCreate?: boolean;
  onCreateOpen?: () => void;
  onCreateClose?: () => void;
  onSaved?: (message: string, undo?: () => void) => void;
};

type ScheduleFocus = { date: string; time: string };

type ApiPatient = {
  id: string;
  name: string;
  cpf: string | null;
  phone: string;
  age: number;
  status: string;
  lastVisit: string | null;
  nextReturn: string | null;
  totalValue: number;
  currentStage?: JourneyStageId;
};

type AppointmentRow = Appointment & { id: string; patientId: string; date: string; durationMinutes: number; category: string };
type ApiProcedureOption = { name: string; category: string; durationMinutes: number };
type ApiAppointment = {
  id: string;
  patientId: string;
  date: string;
  time: string;
  procedure: string;
  professional: string;
  status: string;
  patient: { name: string };
};

function mapApiAppointment(appointment: ApiAppointment, procedures: ApiProcedureOption[] = []): AppointmentRow {
  const procedure = procedures.find((item) => item.name === appointment.procedure);
  return {
    id: appointment.id,
    patientId: appointment.patientId,
    date: appointment.date,
    time: appointment.time,
    patient: appointment.patient.name,
    procedure: appointment.procedure,
    professional: appointment.professional,
    status: appointment.status,
    durationMinutes: procedure?.durationMinutes ?? 60,
    category: procedure?.category ?? appointment.procedure,
  };
}

function mapApiPatient(patient: ApiPatient): Patient {
  return {
    id: patient.id,
    name: patient.name,
    cpf: patient.cpf ?? "",
    phone: patient.phone,
    age: patient.age,
    status: patient.status,
    lastVisit: patient.lastVisit ? displayDate(patient.lastVisit) : "Primeiro contato",
    lastVisitRaw: patient.lastVisit ?? undefined,
    nextReturn: patient.nextReturn ? displayDate(patient.nextReturn) : "A definir",
    value: currency.format(patient.totalValue),
    currentStage: patient.currentStage,
  };
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function MaterialsMultiSelect({ options, defaultValue = [] }: { options: string[]; defaultValue?: string[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(defaultValue);

  function toggleMaterial(material: string) {
    setSelected((current) => current.includes(material) ? current.filter((item) => item !== material) : [...current, material]);
  }

  return (
    <div className="relative">
      <button type="button" className={`${fieldClassName} flex min-h-11 w-full items-center justify-between gap-3 text-left`} onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {selected.length ? selected.map((material) => <span className="rounded-full bg-[#f0efff] px-2 py-1 text-[10px] font-bold text-[#5147dc]" key={material}>{material}</span>) : <span className="text-[#858696]">Selecione os materiais</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[#858696] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {selected.map((material) => <input key={material} type="hidden" name="materials" value={material} />)}
      {open ? <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-60 overflow-auto rounded-[8px] border border-[#e2e5f0] bg-white p-1.5 shadow-[0_18px_40px_rgba(31,32,50,0.16)]">
        {options.map((material) => {
          const checked = selected.includes(material);
          return <button type="button" key={material} className="flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 text-left text-xs font-semibold text-[#3f4054] transition hover:bg-[#f7f6ff]" onClick={() => toggleMaterial(material)}>
            <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border ${checked ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#cfd4e2] bg-white"}`}>{checked ? <CheckCircle2 className="h-3 w-3" /> : null}</span>
            {material}
          </button>;
        })}
      </div> : null}
    </div>
  );
}

function journeyForPatient(patient: Patient) {
  const leadAt = patient.lastVisitRaw ?? new Date().toISOString();
  const journey = buildCustomerJourney({ events: { leadAt }, details: {} });
  if (!patient.currentStage) return journey;
  const currentIndex = journey.findIndex((stage) => stage.id === patient.currentStage);
  return journey.map((stage, index) => ({
    ...stage,
    status: index < currentIndex ? "completed" as const : index === currentIndex ? "current" as const : "pending" as const,
  }));
}

type FinancialData = {
  payments: Array<{ value: number; status: string }>;
  quotes: Array<{ total: number; status: string }>;
  appointments: Array<{ procedure: string; status: string }>;
};

function useFinancialData() {
  const cachedDashboard = readClientCache<FinancialData>("/api/dashboard/bootstrap");
  const [data, setData] = useState<FinancialData | null>(cachedDashboard ?? null);
  useEffect(() => {
    getCachedJson<FinancialData>("/api/dashboard/bootstrap")
      .then((dashboardData) => setData({ payments: dashboardData.payments ?? [], quotes: dashboardData.quotes ?? [], appointments: dashboardData.appointments ?? [] }))
      .catch(() => setData({ payments: [], quotes: [], appointments: [] }));
  }, []);
  return data;
}

export function ClientsSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const router = useRouter();
  const cachedPatients = readClientCache<{ patients: ApiPatient[] }>("/api/patients");
  const [selectedPatientName, setSelectedPatientName] = useState<string | null>(null);
  const [patientRows, setPatientRows] = useState<Patient[]>(() => cachedPatients?.patients.map(mapApiPatient) ?? []);
  const [isLoading, setIsLoading] = useState(!cachedPatients);
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const syncSelectedPatient = () => setSelectedPatientName(new URLSearchParams(window.location.search).get("patient"));
    syncSelectedPatient();
    window.addEventListener("popstate", syncSelectedPatient);
    return () => window.removeEventListener("popstate", syncSelectedPatient);
  }, []);

  useEffect(() => {
    let active = true;
    getCachedJson<{ patients: ApiPatient[] }>("/api/patients")
      .then((data) => {
        if (active) setPatientRows(data.patients.map(mapApiPatient));
      })
      .catch(() => {
        if (active) setSaveError("Não foi possível carregar os pacientes do servidor.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => { active = false; };
  }, []);
  const selectedPatient = patientRows.find((patient) => patient.id === selectedPatientName || patient.name === selectedPatientName);
  const filteredPatients = patientRows.filter((patient) =>
    `${patient.name} ${patient.phone} ${patient.status}`.toLowerCase().includes(query.toLowerCase()),
  );

  function openPatient(patient: Patient) {
    const key = patient.id ?? patient.name;
    setSelectedPatientName(key);
    router.push(`/clientes?patient=${encodeURIComponent(key)}`);
  }

  async function savePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaveError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") || ""),
          cpf: String(form.get("cpf") || ""),
          phone: String(form.get("phone") || ""),
          age: parseInteger(form.get("age")),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null) as { message?: string } | null;
        setSaveError(data?.message ?? "Não foi possível salvar o cliente.");
        return;
      }

      const data = await response.json() as { patient: ApiPatient };
      const savedPatient = mapApiPatient(data.patient);
      setPatientRows((current) => [savedPatient, ...current]);
      invalidateClientCache("/api/patients", "/api/quotes/options", "/api/agenda/bootstrap", "/api/dashboard/bootstrap");
      onCreateClose();
      onSaved?.(`${savedPatient.name} foi adicionado aos clientes.`);
    } catch {
      setSaveError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSaving(false);
    }
  }

  if (selectedPatient) {
    return (
      <PatientDetail
        key={selectedPatient.name}
        patient={selectedPatient}
        journey={journeyForPatient(selectedPatient)}
        onBack={() => {
          setSelectedPatientName(null);
          router.replace("/clientes");
        }}
      />
    );
  }

  return (
    <div>
      <SectionIntro
        title="Clientes"
        description="Consulta rápida dos pacientes, próximos retornos e status de relacionamento clínico."
        action="Novo cliente"
        onAction={onCreateOpen}
      />
      <SearchFilterBar placeholder="Buscar por nome, telefone ou status" value={query} onChange={setQuery} />
      {isLoading ? <LoadingTable columns={6} /> : null}
      {!isLoading && !filteredPatients.length ? <EmptyState title="Nenhum cliente encontrado" description="Cadastre um cliente para começar o prontuário da clínica." /> : null}
      {!isLoading && filteredPatients.length ? <MiniTable
        columns={["Nome", "Telefone", "Status", "Etapa atual", "Próximo retorno", "Ação"]}
        rows={filteredPatients.map((patient) => {
          const journey = journeyForPatient(patient);
          const currentStage = journey.find((stage) => stage.status === "current");

          return [
          <button className="text-left font-bold text-[#303144] hover:text-[#5147dc]" key={patient.name} onClick={() => openPatient(patient)}>{patient.name}</button>,
          patient.phone,
          <StatusBadge key={patient.status} status={patient.status} />,
          <span className="font-bold text-[#5147dc]" key={currentStage?.id}>{currentStage?.label ?? "Concluída"}</span>,
          patient.nextReturn,
          <Button key="open" size="sm" variant="secondary" onClick={() => openPatient(patient)}>Ver perfil <ArrowRight className="h-3 w-3" /></Button>,
          ];
        })}
      /> : null}
      <div className="hp-panel-enter mt-5 flex items-center justify-between rounded-[7px] border border-[#e2e0f1] bg-[#f7f6ff] px-4 py-3">
        <div>
          <p className="text-xs font-bold text-[#454659]">Jornada conectada ao prontuário</p>
          <p className="mt-1 text-[10px] text-[#8d8e9e]">A etapa avança conforme avaliações, orçamentos e atendimentos são registrados.</p>
        </div>
        <Badge variant="purple">Automática</Badge>
      </div>
      <Modal open={openCreate} onClose={onCreateClose} title="Novo cliente" description="Cadastre os dados essenciais. O perfil poderá ser completado depois.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={savePatient}>
          <div className="sm:col-span-2"><FormField label="Nome completo"><input className={fieldClassName} name="name" required /></FormField></div>
          <FormField label="CPF"><MaskedInput className={fieldClassName} formatter={formatCpf} name="cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" required /></FormField>
          <FormField label="Telefone"><MaskedInput className={fieldClassName} formatter={formatPhone} name="phone" inputMode="tel" maxLength={15} placeholder="(00) 00000-0000" required /></FormField>
          <FormField label="Idade"><MaskedInput className={fieldClassName} formatter={(value) => formatInteger(value, 3)} name="age" inputMode="numeric" maxLength={3} placeholder="00" required /></FormField>
          {saveError ? <p className="sm:col-span-2 rounded-[7px] border border-[#ffd7d7] bg-[#fff7f7] px-3 py-2 text-xs font-semibold text-[#b42318]">{saveError}</p> : null}
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button disabled={isSaving} type="submit">{isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{isSaving ? "Salvando..." : "Salvar cliente"}</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function ScheduleSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved, focus }: CreateProps & { focus?: ScheduleFocus | null }) {
  const cachedAgenda = readClientCache<{ appointments: ApiAppointment[]; patients: ApiPatient[]; procedures: ApiProcedureOption[]; members: Array<{ role: string; user: { name: string } }>; settings?: { appointmentToleranceMinutes: number; openingTime: string; closingTime: string } }>("/api/agenda/bootstrap");
  const rowColors = ["#5147dc", "#6d5ce7", "#2f9c88", "#d86655", "#ddb63f"];
  const [appointmentRows, setAppointmentRows] = useState<AppointmentRow[]>(() => cachedAgenda?.appointments.map((item) => mapApiAppointment(item, cachedAgenda.procedures)) ?? []);
  const [isLoading, setIsLoading] = useState(!cachedAgenda);
  const [loadError, setLoadError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [patientOptions, setPatientOptions] = useState<ApiPatient[]>(cachedAgenda?.patients ?? []);
  const [procedureCatalog, setProcedureCatalog] = useState<ApiProcedureOption[]>(cachedAgenda?.procedures ?? []);
  const [professionalChoices, setProfessionalChoices] = useState<string[]>(cachedAgenda?.members.map((member) => member.user.name) ?? []);
  const [professionalLoading, setProfessionalLoading] = useState(!cachedAgenda);
  const [patientQuery, setPatientQuery] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [invalidAppointmentFields, setInvalidAppointmentFields] = useState<Set<string>>(new Set());
  const [appointmentFormError, setAppointmentFormError] = useState("");
  const [activeView, setActiveView] = useState<"Dia" | "Semana" | "Mês">(() => focus ? "Dia" : "Semana");
  const [calendarDate, setCalendarDate] = useState(() => focus ? focusDate(focus.date) : clinicNow());
  const focusTime = focus?.time;
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [professional, setProfessional] = useState("Todos");
  const [appointmentToleranceMinutes, setAppointmentToleranceMinutes] = useState(cachedAgenda?.settings?.appointmentToleranceMinutes ?? 15);
  const [openingTime, setOpeningTime] = useState(cachedAgenda?.settings?.openingTime ?? "08:00");
  const [closingTime, setClosingTime] = useState(cachedAgenda?.settings?.closingTime ?? "19:00");
  const [deleteTarget, setDeleteTarget] = useState<AppointmentRow | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentRow | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const autoMissedIds = useRef(new Set<string>());
  const autoCompletedIds = useRef(new Set<string>());
  const professionalOptions = useMemo(() => ["Todos", ...new Set(appointmentRows.map((item) => item.professional))], [appointmentRows]);
  const activeProfessional = professionalOptions.includes(professional) ? professional : "Todos";
  const filteredAppointments = appointmentRows.filter((appointment) => activeProfessional === "Todos" || appointment.professional === activeProfessional);

  useEffect(() => {
    let active = true;
    getCachedJson<{ appointments: ApiAppointment[]; patients: ApiPatient[]; procedures: ApiProcedureOption[]; members: Array<{ role: string; user: { name: string } }>; settings?: { appointmentToleranceMinutes: number; openingTime: string; closingTime: string } }>("/api/agenda/bootstrap")
      .then((data) => {
        if (!active) return;
        setAppointmentRows(data.appointments.map((item) => mapApiAppointment(item, data.procedures)));
        setPatientOptions(data.patients);
        setProcedureCatalog(data.procedures);
        setAppointmentToleranceMinutes(data.settings?.appointmentToleranceMinutes ?? 15);
        setOpeningTime(data.settings?.openingTime ?? "08:00");
        setClosingTime(data.settings?.closingTime ?? "19:00");
        setProfessionalChoices(data.members.map((member) => member.user.name));
      })
      .catch(() => {
        if (active) setLoadError("Não foi possível carregar os dados da agenda.");
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
        setProfessionalLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isLoading) return;

    async function markExpiredAppointments() {
      const now = clinicNow();
      const missed = appointmentRows.filter((appointment) => (
        appointment.status === "Agendado"
        && appointmentHasPassed(appointment, now, appointmentToleranceMinutes)
        && !autoMissedIds.current.has(appointment.id)
      ));
      const completed = appointmentRows.filter((appointment) => (
        appointment.status === "Em atendimento"
        && appointmentHasPassed(appointment, now, appointment.durationMinutes)
        && !autoCompletedIds.current.has(appointment.id)
      ));
      const transitions = [...missed.map((appointment) => ({ appointment, status: "Faltou" })), ...completed.map((appointment) => ({ appointment, status: "Atendido" }))];
      if (!transitions.length) return;

      missed.forEach((appointment) => autoMissedIds.current.add(appointment.id));
      completed.forEach((appointment) => autoCompletedIds.current.add(appointment.id));
      const results = await Promise.all(transitions.map(async ({ appointment, status }) => {
        const response = await fetch(`/api/appointments/${appointment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        return response.ok ? { id: appointment.id, status } : null;
      }));
      const updated = new Map(results.filter((result): result is { id: string; status: string } => Boolean(result)).map((result) => [result.id, result.status]));
      if (!updated.size) return;
      setAppointmentRows((current) => current.map((appointment) => updated.has(appointment.id) ? { ...appointment, status: updated.get(appointment.id) ?? appointment.status } : appointment));
      invalidateClientCache("/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    }

    void markExpiredAppointments();
    const timer = window.setInterval(() => { void markExpiredAppointments(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [appointmentRows, appointmentToleranceMinutes, isLoading]);

  const matchingPatients = patientOptions.filter((patient) =>
    `${patient.name} ${patient.cpf ?? ""}`.toLowerCase().includes(patientQuery.toLowerCase()),
  );
  const selectedPatient = patientOptions.find((patient) => patient.id === selectedPatientId);

  function clearAppointmentField(field: string) {
    setInvalidAppointmentFields((current) => {
      if (!current.has(field)) return current;
      const next = new Set(current);
      next.delete(field);
      return next;
    });
    setAppointmentFormError("");
  }

  async function saveAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const patient = selectedPatient?.name ?? "";
    const selectedTime = appointmentTime;
    const selectedDate = String(form.get("date"));
    const now = clinicNow();
    const today = calendarDateKey(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const invalidFields = new Set<string>();
    if (!selectedPatientId) invalidFields.add("patient");
    if (!selectedDate || selectedDate < today) invalidFields.add("date");
    if (!selectedTime) invalidFields.add("time");
    if (selectedTime && (selectedTime < openingTime || selectedTime >= closingTime)) invalidFields.add("time");
    if (selectedDate === today && selectedTime && appointmentMinutes(selectedTime) <= currentMinutes) invalidFields.add("time");
    if (!String(form.get("professional"))) invalidFields.add("professional");
    if (!String(form.get("procedure"))) invalidFields.add("procedure");
    if (invalidFields.size) {
      setInvalidAppointmentFields(invalidFields);
      setAppointmentFormError((selectedDate && selectedDate < today) || (selectedDate === today && selectedTime && appointmentMinutes(selectedTime) <= currentMinutes) ? "Não é possível agendar em um horário ou data que já passou." : !selectedTime ? "Selecione um horário para o atendimento." : invalidFields.has("time") ? `O horário deve estar dentro do período permitido: ${openingTime} às ${closingTime}.` : "Revise os campos destacados antes de continuar.");
      window.setTimeout(() => setInvalidAppointmentFields(new Set()), 450);
      setIsSaving(false);
      return;
    }
    setAppointmentFormError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
          patientId: selectedPatientId,
          patient: selectedPatient?.name,
          time: selectedTime,
          procedure: String(form.get("procedure")),
          professional: String(form.get("professional")),
          date: `${String(form.get("date"))}T00:00:00`,
        }),
      });
      if (!response.ok) return;
      const data = await response.json() as { appointment: ApiAppointment };
      setAppointmentRows((current) => [...current, mapApiAppointment(data.appointment, procedureCatalog)].sort((a, b) => `${a.date}-${a.time}`.localeCompare(`${b.date}-${b.time}`)));
      invalidateClientCache("/api/agenda/bootstrap", "/api/dashboard/bootstrap");
      onCreateClose();
      setPatientQuery("");
      setSelectedPatientId("");
      setAppointmentTime("");
      setTimePickerOpen(false);
      onSaved?.(`Agendamento de ${patient} foi criado.`);
    } finally {
      setIsSaving(false);
    }
  }

  async function advanceAppointment(target: AppointmentRow) {
    const nextStatus = target.status === "Em atendimento" ? "Atendido" : "Em atendimento";
    setUpdatingId(target.id);
    const response = await fetch(`/api/appointments/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
    if (!response.ok) { setUpdatingId(null); return; }
    const nextRows = appointmentRows.map((item) => item.id === target.id ? { ...item, status: nextStatus } : item);
    setAppointmentRows(nextRows);
    invalidateClientCache("/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    setUpdatingId(null);
    onSaved?.(`${target.patient}: ${nextStatus}.`);
  }

  async function markAppointmentAsMissed(target: AppointmentRow) {
    const previousStatus = target.status;

    const nextRows = appointmentRows.map((item) => item.id === target.id ? { ...item, status: "Faltou" } : item);
    setUpdatingId(target.id);
    const response = await fetch(`/api/appointments/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Faltou" }) });
    if (!response.ok) { setUpdatingId(null); return; }
    setAppointmentRows(nextRows);
    invalidateClientCache("/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    setUpdatingId(null);
    onSaved?.(`${target.patient} foi marcado como faltou.`, () => {
      const restoredRows = nextRows.map((item) => item.id === target.id ? { ...item, status: previousStatus } : item);
      setAppointmentRows(restoredRows);
      invalidateClientCache("/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    });
  }

  async function cancelAppointment(target: AppointmentRow) {
    setUpdatingId(target.id);
    const response = await fetch(`/api/appointments/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Cancelado" }) });
    if (!response.ok) { setUpdatingId(null); return; }
    setAppointmentRows((current) => current.map((item) => item.id === target.id ? { ...item, status: "Cancelado" } : item));
    invalidateClientCache("/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    setUpdatingId(null);
    onSaved?.(`${target.patient}: agendamento cancelado.`);
  }

  async function deleteAppointment() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteSaving(true);
    const response = await fetch(`/api/appointments/${target.id}`, { method: "DELETE" });
    if (!response.ok) { setDeleteSaving(false); return; }
    setAppointmentRows((current) => current.filter((item) => item.id !== target.id));
    setDeleteTarget(null);
    setDeleteSaving(false);
    invalidateClientCache("/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    onSaved?.(`${target.patient}: agendamento excluído.`, () => {
      void fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: target.patientId, time: target.time, procedure: target.procedure, professional: target.professional, date: target.date }),
      }).then(async (restoreResponse) => {
        if (!restoreResponse.ok) return;
        const data = await restoreResponse.json() as { appointment: ApiAppointment };
        setAppointmentRows((current) => [...current, mapApiAppointment(data.appointment, procedureCatalog)].sort((a, b) => `${a.date}-${a.time}`.localeCompare(`${b.date}-${b.time}`)));
        invalidateClientCache("/api/agenda/bootstrap", "/api/dashboard/bootstrap");
      });
    });
  }

  return (
    <div className="w-full">
      <div className="hp-page-enter mb-5 flex flex-col gap-4 border-b border-[#ececf2] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#3026a8]">Agenda Clínica</h2>
          <p className="mt-1 text-xs text-[#858696]">Visualize e gerencie seus atendimentos de forma prática.</p>
        </div>
        <Button size="sm" onClick={onCreateOpen}><Plus className="h-4 w-4" /> Agendar</Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] font-semibold text-[#77798c]" aria-label="Legenda dos tipos de atendimento">
        <span className="font-bold text-[#555668]">Legenda</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#6257e8]" />Consulta / retorno</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#3d9be9]" />Avaliação</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#35ae78]" />Procedimento</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#e0647d]" />Outros</span>
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Período anterior" onClick={() => setCalendarDate((current) => shiftCalendarDate(current, activeView, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" onClick={() => setCalendarDate(clinicNow())}>Hoje</Button>
          <Button variant="secondary" size="icon" aria-label="Próximo período" onClick={() => setCalendarDate((current) => shiftCalendarDate(current, activeView, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <h3 className="ml-2 truncate text-base font-bold capitalize text-[#303144]">{calendarPeriodLabel(calendarDate, activeView)}</h3>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
          <div className="flex w-full min-w-0 basis-full flex-1 items-center rounded-[7px] border border-[#e1e2ec] bg-white p-0.5 sm:w-auto sm:basis-auto sm:flex-none">
            {["Semana", "Dia", "Mês"].map((view) => (
              <button
                className={cn("hp-pressable min-w-0 flex-1 rounded-[5px] px-3 py-2 text-xs font-semibold transition-colors sm:flex-none sm:px-4", activeView === view ? "bg-[#5147dc] text-white shadow-sm" : "text-[#77798c] hover:text-[#5147dc]")}
                key={view}
                onClick={() => setActiveView(view as "Dia" | "Semana" | "Mês")}
              >
                {view}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="icon" aria-label="Selecionar data" title="Selecionar data"><CalendarDays className="h-4 w-4" /></Button>
          <select className={cn(fieldClassName, "min-w-0 flex-1 text-xs sm:min-w-[170px] sm:flex-none")} value={activeProfessional} onChange={(event) => setProfessional(event.target.value)} aria-label="Filtrar por profissional">
            {professionalOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
      </div>

      <ScheduleCalendar
        appointments={filteredAppointments}
        date={calendarDate}
        view={activeView}
        focusTime={focusTime}
        openingTime={openingTime}
        closingTime={closingTime}
        loading={isLoading}
        openMenuId={openMenuId}
        onMenuToggle={(id) => setOpenMenuId((current) => current === id ? null : id)}
        onAdvance={advanceAppointment}
        onMissed={markAppointmentAsMissed}
        onCancel={cancelAppointment}
        onDelete={(appointment) => setDeleteTarget(appointment)}
        onSelect={(appointment) => setSelectedAppointment(appointment)}
        appointmentToleranceMinutes={appointmentToleranceMinutes}
        updatingId={updatingId}
      />

      <Modal open={Boolean(selectedAppointment)} onClose={() => setSelectedAppointment(null)} title="Detalhes do agendamento" description="Informações completas do atendimento selecionado.">
        {selectedAppointment ? <div className="space-y-4">
          <div className={cn("rounded-[8px] border-l-4 p-4", appointmentTone(selectedAppointment).card)}><p className="text-xs font-bold text-[#77788a]">{selectedAppointment.time} - {formatEndTime(selectedAppointment.time, selectedAppointment.durationMinutes)}</p><h3 className="mt-1 text-lg font-black text-[#303144]">{selectedAppointment.procedure}</h3><p className="mt-1 text-sm text-[#656678]">{selectedAppointment.patient}</p></div>
          <div className="grid gap-3 sm:grid-cols-2">{[["Data", formatDate(selectedAppointment.date)], ["Profissional", selectedAppointment.professional], ["Tipo", selectedAppointment.category || "Atendimento"], ["Status", selectedAppointment.status]].map(([label, value]) => <div className="rounded-[7px] border border-[#e8e8ef] bg-[#fafafd] p-3" key={label}><p className="text-[9px] font-bold uppercase text-[#9697a7]">{label}</p><p className="mt-1 text-xs font-semibold text-[#4f5062]">{value}</p></div>)}</div>
          <div className="flex justify-end"><Button type="button" onClick={() => setSelectedAppointment(null)}>Fechar</Button></div>
        </div> : null}
      </Modal>

      <div className="hidden hp-panel-enter overflow-x-auto rounded-[7px] bg-white px-3 shadow-[0_8px_28px_rgba(38,39,58,0.035)] sm:px-5">
        <div className="grid min-w-[1040px] grid-cols-[84px_1.1fr_1fr_1.05fr_1.15fr_210px] border-b border-[#eeeef3] px-3 py-3 text-[9px] font-bold uppercase text-[#adaeba]">
          <span>Horário</span><span>Atendimento</span><span>Status</span><span>Profissional</span><span>Paciente</span><span></span>
        </div>
        <div className="hp-list-stagger">
        {isLoading ? Array.from({ length: 4 }).map((_, index) => (
          <div className="grid min-w-[1040px] animate-pulse grid-cols-[84px_1.1fr_1fr_1.05fr_1.15fr_210px] items-center gap-3 border-b border-[#f0f0f4] px-3 py-5" key={`loading-${index}`}>
            {Array.from({ length: 6 }).map((__, cell) => <span className="hp-skeleton h-3 rounded-full" key={cell} />)}
          </div>
        )) : null}
        {!isLoading && loadError ? <div className="p-8 text-center text-xs font-semibold text-[#b42318]">{loadError}</div> : null}
        {!isLoading && !loadError && !filteredAppointments.length ? <div className="p-8 text-center text-xs font-semibold text-[#858696]">Nenhum atendimento encontrado.</div> : null}
        {!isLoading && !loadError && filteredAppointments.map((appointment, index) => {
          const isCompleted = appointment.status === "Atendido";
          const isMissed = appointment.status === "Faltou";
          const primaryLabel = appointment.status === "Em atendimento" ? "Finalizar" : isCompleted ? "Concluído" : isMissed ? "Faltou" : "Atender";

          return (
            <div className="relative grid min-w-[1040px] grid-cols-[84px_1.1fr_1fr_1.05fr_1.15fr_210px] items-center border-b border-[#f0f0f4] px-3 py-4 text-[11px] transition-colors duration-200 last:border-0 hover:bg-[#fbfbfe]" key={appointment.id}>
              <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full" style={{ backgroundColor: rowColors[index % rowColors.length] }} />
              <strong className="text-[#5147dc]">{appointment.time}</strong>
              <div><strong className="block text-[#3d3e51]">{appointment.procedure}</strong><span className="mt-1 block text-[9px] text-[#aaaab7]">Consulta clínica</span></div>
              <StatusBadge status={appointment.status} />
              <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#f0efff] text-[8px] font-black text-[#5147dc]">{appointment.professional.replace("Dra. ", "").replace("Dr. ", "").slice(0, 2).toUpperCase()}</span><strong className="text-[#5a5b6e]">{appointment.professional}</strong></div>
              <div><strong className="block uppercase text-[#444557]">{appointment.patient}</strong><span className="mt-1 block text-[9px] text-[#aaaab7]">Paciente</span></div>
              <div className="flex justify-end gap-2">
                <Button className="border-[#5147dc] text-[#5147dc]" key="action" size="sm" variant="secondary" disabled={isCompleted || isMissed || updatingId !== null} onClick={() => advanceAppointment(appointment)}>{updatingId === appointment.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{updatingId === appointment.id ? "Atualizando..." : primaryLabel} {updatingId === appointment.id ? null : <ArrowRight className="h-3 w-3" />}</Button>
                {!isCompleted && !isMissed ? (
                  <Button className="border-[#f2c8c3] text-[#b42318] hover:border-[#b42318] hover:text-[#b42318]" key="missed" size="sm" variant="secondary" disabled={updatingId !== null} onClick={() => markAppointmentAsMissed(appointment)}>{updatingId === appointment.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{updatingId === appointment.id ? "Salvando..." : "Faltou"}</Button>
                ) : null}
              </div>
            </div>
          );
        })}
        </div>
      </div>
      <Modal open={openCreate} onClose={onCreateClose} title="Novo agendamento" description="Inclua o atendimento na agenda de hoje.">
        <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={saveAppointment}>
          <div className="relative sm:col-span-2">
            <FormField label="Paciente">
              <input
                className={cn(fieldClassName, invalidAppointmentFields.has("patient") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")}
                name="patientSearch"
                placeholder="Pesquise por nome ou CPF"
                required
                value={patientQuery}
                onChange={(event) => {
                  setPatientQuery(event.target.value);
                  setSelectedPatientId("");
                  clearAppointmentField("patient");
                }}
              />
            </FormField>
            {patientQuery && !selectedPatientId ? (
              <div className="absolute left-0 right-0 top-[68px] z-20 max-h-44 overflow-auto rounded-[7px] border border-[#e5e5ee] bg-white p-1 shadow-xl">
                {matchingPatients.length ? matchingPatients.map((patient) => (
                  <button
                    className="flex w-full items-center justify-between rounded-[5px] px-3 py-2 text-left text-xs transition hover:bg-[#f5f4ff]"
                    key={patient.id}
                    type="button"
                    onClick={() => {
                      setSelectedPatientId(patient.id);
                      setPatientQuery(`${patient.name}${patient.cpf ? ` · ${patient.cpf}` : ""}`);
                    }}
                  >
                    <span className="font-bold text-[#303144]">{patient.name}</span>
                    <span className="text-[10px] text-[#858696]">{patient.cpf || "CPF não informado"}</span>
                  </button>
                )) : <p className="px-3 py-2 text-xs text-[#858696]">Nenhum paciente encontrado.</p>}
              </div>
            ) : null}
            {selectedPatientId ? <p className="mt-1 text-[10px] font-semibold text-[#5147dc]">Paciente selecionado: {selectedPatient?.name}</p> : null}
          </div>
          <FormField label="Data"><input className={cn(fieldClassName, invalidAppointmentFields.has("date") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} name="date" type="date" defaultValue={calendarDateKey(calendarDate)} onChange={() => clearAppointmentField("date")} required /></FormField>
          <div className="relative"><FormField label="Horário"><ScheduleTimePicker openingTime={openingTime} closingTime={closingTime} value={appointmentTime} open={timePickerOpen} invalid={invalidAppointmentFields.has("time")} onToggle={() => setTimePickerOpen((current) => !current)} onChange={(value) => { setAppointmentTime(value); setTimePickerOpen(false); clearAppointmentField("time"); }} /></FormField><input name="time" type="hidden" value={appointmentTime} required /></div>
          <FormField label="Profissional"><div className="relative"><select className={cn(fieldClassName, invalidAppointmentFields.has("professional") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} name="professional" required disabled={professionalLoading || !professionalChoices.length} onChange={() => clearAppointmentField("professional")}><option value="">{professionalLoading ? "..." : professionalChoices.length ? "Selecione o profissional" : "Nenhum profissional cadastrado"}</option>{professionalChoices.map((professional) => <option key={professional} value={professional}>{professional}</option>)}</select>{professionalLoading ? <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#5147dc]" /> : null}</div></FormField>
          <div className="sm:col-span-2"><FormField label="Tipo de consulta"><div className="relative"><select className={cn(fieldClassName, invalidAppointmentFields.has("procedure") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} name="procedure" required onChange={() => clearAppointmentField("procedure")}><option value="">Selecione o tipo de consulta</option>{appointmentTypeOptions.map((item) => <option key={item}>{item}</option>)}</select></div></FormField></div>
          {appointmentFormError ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{appointmentFormError}</p> : null}
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button disabled={isSaving || professionalLoading || !professionalChoices.length || !selectedPatientId} type="submit">{isSaving || professionalLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{isSaving ? "Salvando..." : professionalLoading ? "Carregando dados..." : "Criar agendamento"}</Button></div>
        </form>
      </Modal>
      <Modal open={Boolean(deleteTarget)} onClose={() => { if (!deleteSaving) setDeleteTarget(null); }} title="Excluir agendamento" description="Essa ação removerá o agendamento da agenda.">
        <div className="space-y-4"><p className="rounded-[7px] bg-[#fff7f7] px-3 py-3 text-xs font-semibold leading-5 text-[#7e3b43]">Tem certeza que deseja excluir o agendamento de <strong>{deleteTarget?.patient}</strong> às <strong>{deleteTarget?.time}</strong>? Você poderá desfazer pelo aviso exibido após a exclusão.</p><div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={deleteSaving} onClick={() => setDeleteTarget(null)}>Cancelar</Button><Button type="button" className="bg-[#b42318] hover:bg-[#991b1b]" disabled={deleteSaving} onClick={() => void deleteAppointment()}>{deleteSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{deleteSaving ? "Excluindo..." : "Excluir agendamento"}</Button></div></div>
      </Modal>
    </div>
  );
}

type CalendarView = "Dia" | "Semana" | "Mês";

function ScheduleTimePicker({ openingTime, closingTime, value, open, invalid, onToggle, onChange }: { openingTime: string; closingTime: string; value: string; open: boolean; invalid: boolean; onToggle: () => void; onChange: (value: string) => void }) {
  const allowedHours = getAllowedHours(openingTime, closingTime);
  const selectedMinutes = value ? appointmentMinutes(value) : null;
  const selectedHour = selectedMinutes === null ? null : Math.floor(selectedMinutes / 60);
  const selectedMinute = selectedMinutes === null ? null : selectedMinutes % 60;
  const [draftHour, setDraftHour] = useState<number | null>(selectedHour ?? allowedHours[0] ?? null);
  const minutes = getAllowedMinutes(openingTime, closingTime, draftHour ?? undefined);

  return <div className="relative">
    <button type="button" className={cn(fieldClassName, "flex items-center justify-between text-left", invalid && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} onClick={() => { if (!open) setDraftHour(selectedHour ?? allowedHours[0] ?? null); onToggle(); }} aria-expanded={open}>
      <span className={value ? "text-[#303144]" : "text-[#858696]"}>{value || "Selecione o horário"}</span>
      <Clock3 className="h-4 w-4 text-[#303144]" />
    </button>
    {open ? <div className="absolute left-0 top-[68px] z-30 grid w-[150px] grid-cols-2 overflow-hidden rounded-[3px] border border-[#777] bg-white text-sm shadow-lg">
      <div className="max-h-60 overflow-y-auto border-r border-[#d8d8d8] p-1">{allowedHours.map((hour) => <button type="button" className={cn("block w-full px-3 py-1.5 text-left", (draftHour ?? selectedHour) === hour ? "bg-[#087cf5] text-white" : "text-[#303144] hover:bg-[#eaf3ff]")} key={hour} onClick={() => setDraftHour(hour)}>{String(hour).padStart(2, "0")}</button>)}</div>
      <div className="max-h-60 overflow-y-auto p-1">{minutes.map((minute) => <button type="button" className={cn("block w-full px-3 py-1.5 text-left", selectedHour === draftHour && selectedMinute === minute ? "bg-[#087cf5] text-white" : "text-[#303144] hover:bg-[#eaf3ff]")} key={minute} onClick={() => onChange(`${String(draftHour ?? allowedHours[0]).padStart(2, "0")}:${String(minute).padStart(2, "0")}`)}>{String(minute).padStart(2, "0")}</button>)}</div>
    </div> : null}
  </div>;
}

function getAllowedHours(openingTime: string, closingTime: string) {
  const opening = Math.floor(appointmentMinutes(openingTime) / 60);
  const closing = Math.floor((appointmentMinutes(closingTime) - 1) / 60);
  return closing >= opening ? Array.from({ length: closing - opening + 1 }, (_, index) => opening + index) : [];
}

function getAllowedMinutes(openingTime: string, closingTime: string, hour: number | undefined) {
  if (hour === undefined) return [];
  const opening = appointmentMinutes(openingTime);
  const closing = appointmentMinutes(closingTime);
  return Array.from({ length: 60 }, (_, minute) => minute).filter((minute) => hour * 60 + minute >= opening && hour * 60 + minute < closing);
}

function ScheduleCalendar({ appointments, date, view, focusTime, openingTime, closingTime, loading, openMenuId, onMenuToggle, onAdvance, onMissed, onCancel, onDelete, onSelect, appointmentToleranceMinutes, updatingId }: { appointments: AppointmentRow[]; date: Date; view: CalendarView; focusTime?: string; openingTime: string; closingTime: string; loading: boolean; openMenuId: string | null; onMenuToggle: (id: string) => void; onAdvance: (appointment: AppointmentRow) => void; onMissed: (appointment: AppointmentRow) => void; onCancel: (appointment: AppointmentRow) => void; onDelete: (appointment: AppointmentRow) => void; onSelect: (appointment: AppointmentRow) => void; appointmentToleranceMinutes: number; updatingId: string | null }) {
  const [now, setNow] = useState(() => clinicNow());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(clinicNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const days = view === "Dia" ? [date] : getWeekDays(date);
  const firstHour = Math.floor(appointmentMinutes(openingTime) / 60);
  const lastHour = Math.max(firstHour + 1, Math.ceil(appointmentMinutes(closingTime) / 60));
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => index + firstHour);
  const hourHeight = 72;
  const calendarHeight = hours.length * hourHeight;
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const targetMinutes = focusTime ? appointmentMinutes(focusTime) : nowMinutes;
    const currentTimeTop = ((targetMinutes - firstHour * 60) / 60) * hourHeight;
    const element = calendarRef.current;
    if (!element) return;
    if (currentTimeTop >= 0 && currentTimeTop <= calendarHeight) element.scrollTo({ top: Math.max(0, currentTimeTop - 180), behavior: "smooth" });
  }, [calendarHeight, firstHour, focusTime, loading, now, view]);

  if (loading) return <CalendarSkeleton />;
  if (view === "Mês") return <MonthCalendar date={date} appointments={appointments} onSelect={onSelect} />;

  return (
    <div ref={calendarRef} className="max-h-[720px] overflow-auto rounded-[8px] border border-[#e7e9f2] bg-white shadow-[0_8px_28px_rgba(38,39,58,0.035)]">
      <div className="min-w-[760px]">
        <div className={cn("grid border-b border-[#ececf3] bg-[#fbfbfe]", view === "Dia" ? "grid-cols-[64px_minmax(300px,1fr)]" : "grid-cols-[64px_repeat(6,minmax(130px,1fr))]")}>
          <div className="border-r border-[#ececf3]" />
          {days.map((day) => <CalendarDayHeader key={calendarDateKey(day)} date={day} />)}
          {view === "Dia" ? <div className="hidden" /> : null}
        </div>
        <div className={cn("grid", view === "Dia" ? "grid-cols-[64px_minmax(300px,1fr)]" : "grid-cols-[64px_repeat(6,minmax(130px,1fr))]")}>
          <div className="relative border-r border-[#ececf3] bg-[#fcfcfe]" style={{ height: calendarHeight }}>
            {hours.map((hour) => <span className="absolute right-2 -translate-y-1/2 text-[10px] font-semibold text-[#9a9baa]" style={{ top: (hour - firstHour) * hourHeight }} key={hour}>{String(hour).padStart(2, "0")}:00</span>)}
          </div>
          {days.map((day) => {
            const dayKey = calendarDateKey(day);
            const dayAppointments = appointments.filter((appointment) => calendarDateKey(appointment.date) === dayKey);
            return <CalendarDayColumn key={dayKey} date={day} now={now} appointments={dayAppointments} firstHour={firstHour} height={calendarHeight} hourHeight={hourHeight} hourCount={hours.length} openMenuId={openMenuId} onMenuToggle={onMenuToggle} onAdvance={onAdvance} onMissed={onMissed} onCancel={onCancel} onDelete={onDelete} onSelect={onSelect} appointmentToleranceMinutes={appointmentToleranceMinutes} updatingId={updatingId} />;
          })}
          {view === "Dia" ? Array.from({ length: 5 }).map((_, index) => <div className="hidden" key={index} />) : null}
        </div>
      </div>
    </div>
  );
}

function CalendarDayHeader({ date }: { date: Date }) {
  const isToday = calendarDateKey(date) === calendarDateKey(clinicNow());
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date).replace(".", "");
  return <div className="border-r border-[#ececf3] px-2 py-3 text-center last:border-r-0"><span className="block text-[10px] font-bold uppercase text-[#858696]">{weekday}</span><span className={cn("mx-auto mt-1 grid h-8 w-8 place-items-center rounded-full text-sm font-black", isToday ? "bg-[#5147dc] text-white shadow-[0_4px_10px_rgba(81,71,220,0.25)]" : "text-[#303144]")}>{date.getDate()}</span></div>;
}

function CalendarDayColumn({ date, now, appointments, firstHour, height, hourHeight, hourCount, openMenuId, onMenuToggle, onAdvance, onMissed, onCancel, onDelete, onSelect, appointmentToleranceMinutes, updatingId }: { date: Date; now: Date; appointments: AppointmentRow[]; firstHour: number; height: number; hourHeight: number; hourCount: number; openMenuId: string | null; onMenuToggle: (id: string) => void; onAdvance: (appointment: AppointmentRow) => void; onMissed: (appointment: AppointmentRow) => void; onCancel: (appointment: AppointmentRow) => void; onDelete: (appointment: AppointmentRow) => void; onSelect: (appointment: AppointmentRow) => void; appointmentToleranceMinutes: number; updatingId: string | null }) {
  const isToday = calendarDateKey(date) === calendarDateKey(now);
  const isPastDay = calendarDateKey(date) < calendarDateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const currentTimeTop = ((nowMinutes - firstHour * 60) / 60) * hourHeight;
  const showCurrentTime = (isPastDay || isToday) && currentTimeTop >= 0 && currentTimeTop <= height;

  return <div className="relative border-r border-[#ececf3] last:border-r-0" style={{ height }}>
    {Array.from({ length: hourCount }, (_, index) => <span className="pointer-events-none absolute inset-x-0 border-t border-[#f0f0f5]" style={{ top: index * hourHeight }} key={index} />)}
    <span className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-[#f0f0f5]" />
    {showCurrentTime ? <div className="pointer-events-none absolute inset-x-0 z-20 h-0" style={{ top: currentTimeTop }} aria-label={`Horário atual: ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}>
      <span className={cn("absolute inset-x-0 top-0 border-t-2 border-[#5147dc]", isToday ? "border-solid" : "border-dotted")} />
      {isToday ? <span className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full border-2 border-white bg-[#5147dc] shadow-[0_1px_4px_rgba(81,71,220,0.3)]" /> : null}
    </div> : null}
    {getCalendarAppointmentLayouts(appointments).map(({ appointment, column, columns }) => {
      const start = appointmentMinutes(appointment.time);
      const top = Math.max(2, ((start - firstHour * 60) / 60) * hourHeight);
      const cardHeight = Math.max(92, (appointment.durationMinutes / 60) * hourHeight - 8);
      return <CalendarAppointmentCard key={appointment.id} appointment={appointment} top={top} height={cardHeight} column={column} columns={columns} open={openMenuId === appointment.id} onMenuToggle={onMenuToggle} onAdvance={onAdvance} onMissed={onMissed} onCancel={onCancel} onDelete={onDelete} onSelect={onSelect} appointmentToleranceMinutes={appointmentToleranceMinutes} updating={updatingId === appointment.id} />;
    })}
  </div>;
}

function getCalendarAppointmentLayouts(appointments: AppointmentRow[]) {
  const sorted = [...appointments].sort((a, b) => appointmentMinutes(a.time) - appointmentMinutes(b.time) || a.id.localeCompare(b.id));
  const layouts = new Map<string, { column: number; columns: number }>();

  for (let startIndex = 0; startIndex < sorted.length;) {
    const group = [sorted[startIndex]];
    let groupEnd = appointmentMinutes(sorted[startIndex].time) + sorted[startIndex].durationMinutes;
    let nextIndex = startIndex + 1;
    while (nextIndex < sorted.length && appointmentMinutes(sorted[nextIndex].time) < groupEnd) {
      group.push(sorted[nextIndex]);
      groupEnd = Math.max(groupEnd, appointmentMinutes(sorted[nextIndex].time) + sorted[nextIndex].durationMinutes);
      nextIndex += 1;
    }

    const columnEnds: number[] = [];
    const assignments = group.map((appointment) => {
      const start = appointmentMinutes(appointment.time);
      const end = start + appointment.durationMinutes;
      let column = columnEnds.findIndex((columnEnd) => columnEnd <= start);
      if (column < 0) column = columnEnds.length;
      columnEnds[column] = end;
      return { appointment, column };
    });
    const columns = Math.max(1, columnEnds.length);
    assignments.forEach(({ appointment, column }) => layouts.set(appointment.id, { column, columns }));
    startIndex = nextIndex;
  }

  return sorted.map((appointment) => {
    const layout = layouts.get(appointment.id) ?? { column: 0, columns: 1 };
    return { appointment, ...layout };
  });
}

function CalendarAppointmentCard({ appointment, top, height, column, columns, open, onMenuToggle, onAdvance, onMissed, onCancel, onDelete, onSelect, appointmentToleranceMinutes, updating }: { appointment: AppointmentRow; top: number; height: number; column: number; columns: number; open: boolean; onMenuToggle: (id: string) => void; onAdvance: (appointment: AppointmentRow) => void; onMissed: (appointment: AppointmentRow) => void; onCancel: (appointment: AppointmentRow) => void; onDelete: (appointment: AppointmentRow) => void; onSelect: (appointment: AppointmentRow) => void; appointmentToleranceMinutes: number; updating: boolean }) {
  const tone = appointmentTone(appointment);
  const past = appointmentHasPassed(appointment);
  const isCompleted = appointment.status === "Atendido";
  const isMissed = appointment.status === "Faltou";
  const isCancelled = appointment.status === "Cancelado";
  const canStart = appointment.status !== "Agendado" || appointmentCanStart(appointment, appointmentToleranceMinutes);
  const primaryLabel = appointment.status === "Em atendimento" ? "Finalizar" : isCompleted ? "Concluído" : isMissed ? "Faltou" : "Atender";
  return <div className={cn("group absolute z-10 cursor-pointer overflow-hidden rounded-[7px] border-l-[3px] p-2 text-[10px] shadow-[0_4px_12px_rgba(38,39,58,0.06)]", tone.card, past && "brightness-[0.84] saturate-[0.78]")} style={{ top, height, left: `calc(${column} * 100% / ${columns} + 4px)`, width: `calc(100% / ${columns} - 8px)` }} aria-label={`${appointment.procedure} - status: ${appointment.status}`} onClick={() => onSelect(appointment)}>
    <span className="pointer-events-none absolute -top-7 left-2 z-40 hidden whitespace-nowrap rounded-[5px] bg-[#303144] px-2 py-1 text-[10px] font-bold text-white shadow-lg group-hover:block">Status: {appointment.status}</span>
    <div className="flex items-start justify-between gap-1"><div className="min-w-0"><p className="truncate font-bold">{appointment.time} - {formatEndTime(appointment.time, appointment.durationMinutes)}</p><p className="mt-1 truncate text-[11px] font-black">{appointment.procedure}</p><p className="mt-0.5 truncate opacity-80">{appointment.patient}</p></div><div className="relative shrink-0"><button type="button" className="grid h-6 w-6 place-items-center rounded-full transition hover:bg-black/5" aria-label={`Ações de ${appointment.procedure}`} onClick={(event) => { event.stopPropagation(); onMenuToggle(appointment.id); }}><MoreVertical className="h-3.5 w-3.5" /></button>{open ? <div className="absolute right-0 top-7 z-30 w-36 rounded-[7px] border border-[#e5e5ee] bg-white p-1 text-left shadow-xl" onClick={(event) => event.stopPropagation()}><button className="block w-full rounded-[5px] px-2 py-1.5 text-[10px] font-bold text-[#454659] hover:bg-[#f5f4ff] disabled:opacity-50" disabled={isCompleted || isMissed || isCancelled || updating || !canStart} onClick={() => { onAdvance(appointment); onMenuToggle(appointment.id); }}>{updating ? "Atualizando..." : primaryLabel}</button>{!isCompleted && !isMissed && !isCancelled ? <><button className="block w-full rounded-[5px] px-2 py-1.5 text-[10px] font-bold text-[#b42318] hover:bg-[#fff1f0] disabled:opacity-50" disabled={updating} onClick={() => { onMissed(appointment); onMenuToggle(appointment.id); }}>Marcar como faltou</button><button className="block w-full rounded-[5px] px-2 py-1.5 text-[10px] font-bold text-[#b42318] hover:bg-[#fff1f0] disabled:opacity-50" disabled={updating} onClick={() => { onCancel(appointment); onMenuToggle(appointment.id); }}>Cancelar agendamento</button><button className="block w-full rounded-[5px] px-2 py-1.5 text-[10px] font-bold text-[#8d1c26] hover:bg-[#fff1f0] disabled:opacity-50" disabled={updating} onClick={() => { onDelete(appointment); onMenuToggle(appointment.id); }}>Excluir agendamento</button></> : null}</div> : null}</div></div>
    <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold", tone.pill)}>{appointment.category || "Atendimento"}</span>
  </div>;
}

function MonthCalendar({ date, appointments, onSelect }: { date: Date; appointments: AppointmentRow[]; onSelect: (appointment: AppointmentRow) => void }) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((startOffset + daysInMonth) / 7) * 7 }, (_, index) => index - startOffset + 1);
  return <div className="overflow-x-auto rounded-[8px] border border-[#e7e9f2] bg-white shadow-[0_8px_28px_rgba(38,39,58,0.035)]"><div className="min-w-[700px]"><div className="grid grid-cols-7 border-b border-[#ececf3] bg-[#fbfbfe]">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((label) => <span className="px-2 py-3 text-center text-[10px] font-bold uppercase text-[#858696]" key={label}>{label}</span>)}</div><div className="grid grid-cols-7">{cells.map((day) => { const valid = day > 0 && day <= daysInMonth; const cellDate = valid ? new Date(date.getFullYear(), date.getMonth(), day) : null; const dayAppointments = cellDate ? appointments.filter((item) => calendarDateKey(item.date) === calendarDateKey(cellDate)) : []; return <div className={cn("min-h-28 border-b border-r border-[#f0f0f5] p-2", !valid && "bg-[#fbfbfd]")} key={`${date.getFullYear()}-${date.getMonth()}-${day}`}><span className={cn("grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold", cellDate && calendarDateKey(cellDate) === calendarDateKey(clinicNow()) && "bg-[#5147dc] text-white")}>{valid ? day : ""}</span><div className="mt-1 space-y-1">{dayAppointments.slice(0, 3).map((item) => <button type="button" className={cn("block w-full truncate rounded-[4px] border-l-2 px-1.5 py-1 text-left text-[9px] font-bold", appointmentTone(item).card)} key={item.id} onClick={() => onSelect(item)}>{item.time} · {item.patient}</button>)}{dayAppointments.length > 3 ? <span className="text-[9px] font-semibold text-[#858696]">+{dayAppointments.length - 3} atendimentos</span> : null}</div></div>; })}</div></div></div>;
}

function CalendarSkeleton() {
  return <div className="grid animate-pulse grid-cols-7 gap-px overflow-hidden rounded-[8px] border border-[#e7e9f2] bg-[#ececf3]"><div className="col-span-7 h-14 bg-white" />{Array.from({ length: 42 }, (_, index) => <div className="h-24 bg-white" key={index} />)}</div>;
}

function clinicNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
}

function focusDate(date: string) {
  const parsed = new Date(date);
  return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

function getWeekDays(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  return Array.from({ length: 6 }, (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index));
}

function calendarDateKey(date: Date | string) {
  if (typeof date === "string") return date.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftCalendarDate(date: Date, view: CalendarView, amount: number) {
  const days = view === "Dia" ? 1 : view === "Semana" ? 7 : 30;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount * days);
}

function calendarPeriodLabel(date: Date, view: CalendarView) {
  if (view === "Dia") return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(date);
  if (view === "Semana") { const days = getWeekDays(date); return `${new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(days[0])} de ${days[0].getFullYear()}`; }
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
}

function appointmentMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function appointmentHasPassed(appointment: AppointmentRow, now = clinicNow(), toleranceMinutes = 0) {
  const appointmentDate = calendarDateKey(appointment.date);
  const today = calendarDateKey(now);
  if (appointmentDate < today) return true;
  if (appointmentDate > today) return false;
  return appointmentMinutes(appointment.time) + toleranceMinutes <= now.getHours() * 60 + now.getMinutes();
}

function appointmentCanStart(appointment: AppointmentRow, toleranceMinutes: number, now = clinicNow()) {
  const appointmentDate = calendarDateKey(appointment.date);
  const today = calendarDateKey(now);
  if (appointmentDate !== today) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = appointmentMinutes(appointment.time);
  return currentMinutes >= startMinutes && currentMinutes < startMinutes + toleranceMinutes;
}

function formatEndTime(time: string, durationMinutes: number) {
  const end = appointmentMinutes(time) + durationMinutes;
  return `${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

function appointmentTone(appointment: AppointmentRow) {
  const value = `${appointment.procedure} ${appointment.category}`.toLocaleLowerCase("pt-BR");
  if (value.includes("avalia")) return { card: "border-[#3d9be9] bg-[#eaf5ff] text-[#175b91]", pill: "bg-[#d7edff] text-[#2672ad]" };
  if (value.includes("consulta") || value.includes("retorno")) return { card: "border-[#6257e8] bg-[#f0eeff] text-[#3f36a9]", pill: "bg-[#e3dfff] text-[#5147dc]" };
  if (["preenchimento", "toxina", "bioestimul", "fio", "peeling", "microagul", "laser", "skin", "limpeza"].some((term) => value.includes(term))) return { card: "border-[#35ae78] bg-[#eaf8ef] text-[#247750]", pill: "bg-[#d7f1df] text-[#287a50]" };
  return { card: "border-[#e0647d] bg-[#fff0f2] text-[#9b3a4f]", pill: "bg-[#ffe0e5] text-[#a8465b]" };
}

export function ProceduresSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const cachedProcedures = readClientCache<{ procedures?: Array<{ id: string; name: string; category: string; price: number; durationMinutes: number; materials: string; margin: number }> }>("/api/procedures");
  const cachedProducts = readClientCache<{ products?: Product[] }>("/api/products");
  const [procedureRows, setProcedureRows] = useState<Procedure[]>(() => (cachedProcedures?.procedures ?? []).map((item) => ({ id: item.id, name: item.name, category: item.category, price: item.price, duration: `${item.durationMinutes} min`, materials: item.materials, margin: `${item.margin}%` })));
  const [productRows, setProductRows] = useState<Product[]>(cachedProducts?.products ?? []);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [editingProcedureIndex, setEditingProcedureIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(!cachedProcedures);
  const [isSaving, setIsSaving] = useState(false);
  const editingProcedure = editingProcedureIndex === null ? null : procedureRows[editingProcedureIndex];
  const procedureModalOpen = openCreate || editingProcedureIndex !== null;

  function applyProcedureRows(data: { procedures?: Array<{ id: string; name: string; category: string; price: number; durationMinutes: number; materials: string; margin: number }> }) {
    setProcedureRows((data.procedures ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      price: item.price,
      duration: `${item.durationMinutes} min`,
      materials: item.materials,
      margin: `${item.margin}%`,
    })));
  }

  async function loadProcedures() {
    setIsLoading(true);
    invalidateClientCache("/api/procedures", "/api/quotes/options", "/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    const data = await getCachedJson<{ procedures?: Array<{ id: string; name: string; category: string; price: number; durationMinutes: number; materials: string; margin: number }> }>("/api/procedures");
    applyProcedureRows(data);
    setIsLoading(false);
  }

  useEffect(() => {
    let active = true;
    getCachedJson<{ procedures?: Array<{ id: string; name: string; category: string; price: number; durationMinutes: number; materials: string; margin: number }> }>("/api/procedures")
      .then((data) => {
        if (!active) return;
        applyProcedureRows(data);
        setIsLoading(false);
      })
      .catch(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    getCachedJson<{ products?: Product[] }>("/api/products")
      .then((data) => setProductRows(data.products ?? []))
      .catch(() => setProductRows([]));
  }, []);

  function closeProcedureModal() {
    setEditingProcedureIndex(null);
    onCreateClose();
  }

  async function saveProcedure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name"));
    const selectedMaterials = form.getAll("materials").map(String).filter(Boolean).join(", ");
    const nextProcedure = {
      name,
      category: String(form.get("category")),
      price: parseCurrency(form.get("price")),
      durationMinutes: parseInteger(form.get("duration")),
      materials: selectedMaterials,
      margin: parseInteger(form.get("margin")),
    };
    const response = await fetch(editingProcedure?.id ? `/api/procedures/${editingProcedure.id}` : "/api/procedures", {
      method: editingProcedure?.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextProcedure),
    });
    setIsSaving(false);
    if (!response.ok) return;
    invalidateClientCache("/api/procedures", "/api/quotes/options", "/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    await loadProcedures();
    onSaved?.(`${name} ${editingProcedure ? "foi atualizado" : "foi adicionado aos procedimentos"}.`);
    closeProcedureModal();
  }

  async function saveMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name"));
    const response = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, category: String(form.get("category")), unit: String(form.get("unit")), cost: parseCurrency(form.get("cost")), supplier: String(form.get("supplier")) }) });
    if (!response.ok) return;
    invalidateClientCache("/api/products", "/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    const data = await response.json() as { product: Product };
    setProductRows((current) => [...current, data.product]);
    setMaterialOpen(false); onSaved?.(`${name} foi adicionado aos materiais.`);
  }

  return (
    <div className="space-y-8">
      <div>
        <SectionIntro
          title="Procedimentos"
          description="Cadastro de serviços com valor sugerido, tempo estimado e materiais usados para cálculo de custo."
          action="Novo procedimento"
          onAction={onCreateOpen}
        />
        {isLoading ? <LoadingTable columns={7} /> : <MiniTable
          columns={["Nome", "Categoria", "Valor sugerido", "Tempo", "Materiais", "Margem", "Ação"]}
          rows={procedureRows.map((procedure, index) => [
            <strong className="text-[#121733]" key={procedure.name}>{procedure.name}</strong>,
            procedure.category,
            currency.format(procedure.price),
            procedure.duration,
            procedure.materials,
            <Badge key={procedure.margin} variant="green">{procedure.margin}</Badge>,
            <Button key="edit" size="sm" variant="secondary" onClick={() => setEditingProcedureIndex(index)}>
              <PencilLine className="h-3.5 w-3.5" />
              Editar
            </Button>,
          ])}
        />}
      </div>

      <div className="hp-list-stagger grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Materiais e custos</CardTitle>
              <p className="mt-1 text-sm text-[#65708b]">
                Cadastro usado somente para cálculo. Sem quantidade disponível,
                entrada, baixa ou estoque neste MVP.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setMaterialOpen(true)}>
              <Plus className="h-4 w-4" />
              Material
            </Button>
          </CardHeader>
          <CardContent className="hp-list-stagger space-y-3">
            {productRows.map((product) => (
              <div
                className="rounded-[8px] border border-[#e5e9f4] p-4 transition-colors duration-200 hover:border-[#dce5ff]"
                key={product.name}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-[#121733]">{product.name}</p>
                    <p className="text-sm text-[#65708b]">
                      {product.category} · {product.supplier}
                    </p>
                  </div>
                  <Badge variant="purple">{product.unit}</Badge>
                </div>
                <p className="mt-3 text-lg font-black text-[#1438ff]">
                  {currency.format(product.cost)} / {product.unit}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <CostCalculator materials={productRows} charged={procedureRows[0]?.price ?? 0} procedureName={procedureRows[0]?.name} />
      </div>
      <Modal
        key={editingProcedure ? `edit-${editingProcedure.name}` : `new-procedure-${openCreate ? "open" : "closed"}`}
        open={procedureModalOpen}
        onClose={closeProcedureModal}
        title={editingProcedure ? "Editar procedimento" : "Novo procedimento"}
        description="Defina preço, duração e margem do serviço."
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveProcedure}>
          <div className="sm:col-span-2"><FormField label="Nome"><input className={fieldClassName} name="name" defaultValue={editingProcedure?.name ?? ""} required /></FormField></div>
          <FormField label="Categoria"><select className={fieldClassName} name="category" defaultValue={editingProcedure?.category ?? ""} required><option value="">Selecione uma categoria</option>{procedureCategories.map((category) => <option key={category}>{category}</option>)}</select></FormField>
          <FormField label="Valor sugerido"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="price" inputMode="decimal" defaultValue={editingProcedure ? currency.format(editingProcedure.price) : ""} placeholder="R$ 0,00" required /></FormField>
          <FormField label="Duração em minutos"><MaskedInput className={fieldClassName} formatter={(value) => formatInteger(value, 3)} name="duration" inputMode="numeric" defaultValue={editingProcedure?.duration ?? ""} placeholder="60" required /></FormField>
          <FormField label="Margem estimada (%)"><MaskedInput className={fieldClassName} formatter={formatPercent} name="margin" inputMode="numeric" defaultValue={editingProcedure?.margin ?? ""} placeholder="40%" required /></FormField>
          <div className="sm:col-span-2"><FormField label="Materiais utilizados"><MaterialsMultiSelect options={materialOptions} defaultValue={editingProcedure?.materials ? editingProcedure.materials.split(", ") : []} /><p className="mt-1 text-[10px] text-[#858696]">Selecione um ou mais materiais utilizados neste procedimento.</p></FormField></div>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={closeProcedureModal}>Cancelar</Button><Button disabled={isSaving} type="submit">{isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{isSaving ? "Salvando..." : editingProcedure ? "Salvar alterações" : "Salvar procedimento"}</Button></div>
        </form>
      </Modal>
      <Modal open={materialOpen} onClose={() => setMaterialOpen(false)} title="Novo material">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveMaterial}>
          <div className="sm:col-span-2"><FormField label="Nome"><input className={fieldClassName} name="name" required /></FormField></div>
          <FormField label="Categoria"><select className={fieldClassName} name="category" required><option value="">Selecione uma categoria</option>{procedureCategories.map((category) => <option key={category}>{category}</option>)}</select></FormField>
          <FormField label="Fornecedor"><input className={fieldClassName} name="supplier" required /></FormField>
          <FormField label="Unidade"><select className={fieldClassName} name="unit"><option>ml</option><option>unidade</option><option>frasco</option></select></FormField>
          <FormField label="Custo unitário"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="cost" inputMode="decimal" placeholder="R$ 0,00" required /></FormField>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setMaterialOpen(false)}>Cancelar</Button><Button type="submit">Salvar material</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function QuotesSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  type ApiQuote = { id: string; items: string; total: number; status: string; expires: string | null; createdAt?: string; patient?: { name: string } | null };
  type QuoteRow = Quote & { createdAt?: string };
  type QuoteOptions = { patients?: Array<{ id: string; name: string; cpf: string | null }>; procedures?: Array<{ id: string; name: string; price: number }> };
  const cachedQuotes = readClientCache<{ quotes?: ApiQuote[] }>("/api/quotes");
  const cachedQuoteOptions = readClientCache<QuoteOptions>("/api/quotes/options");
  const [quoteRows, setQuoteRows] = useState<QuoteRow[]>(() => (cachedQuotes?.quotes ?? []).map((item) => ({ id: item.id, patient: item.patient?.name ?? "Paciente", items: item.items, total: currency.format(item.total), status: item.status, expires: item.expires ? new Date(item.expires).toLocaleDateString("pt-BR") : "Sem validade", createdAt: item.createdAt })));
  const [isLoading, setIsLoading] = useState(!cachedQuotes);
  const [isSaving, setIsSaving] = useState(false);
  const [quotePatients, setQuotePatients] = useState(cachedQuoteOptions?.patients ?? []);
  const [quoteProcedures, setQuoteProcedures] = useState(cachedQuoteOptions?.procedures ?? []);
  const [optionsLoading, setOptionsLoading] = useState(!cachedQuoteOptions);
  const [patientQuery, setPatientQuery] = useState("");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedProcedureNames, setSelectedProcedureNames] = useState<string[]>([]);

  useEffect(() => {
    getCachedJson<{ quotes?: ApiQuote[] }>("/api/quotes").then((data) => {
      setQuoteRows((data.quotes ?? []).map((item) => ({ id: item.id, patient: item.patient?.name ?? "Paciente", items: item.items, total: currency.format(item.total), status: item.status, expires: item.expires ? new Date(item.expires).toLocaleDateString("pt-BR") : "Sem validade", createdAt: item.createdAt })));
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    getCachedJson<QuoteOptions>("/api/quotes/options").then((data) => {
      setQuotePatients(data.patients ?? []);
      setQuoteProcedures(data.procedures ?? []);
      setOptionsLoading(false);
    }).catch(() => setOptionsLoading(false));
  }, []);

  const matchingQuotePatients = quotePatients.filter((patient) => `${patient.name} ${patient.cpf ?? ""}`.toLowerCase().includes(patientQuery.toLowerCase()));
  const suggestedTotal = selectedProcedureNames.reduce((total, name) => total + (quoteProcedures.find((procedure) => procedure.name === name)?.price ?? 0), 0);
  const visibleQuotes = quoteRows.filter((quote) => {
    const normalizedName = quoteSearch.trim().toLocaleLowerCase("pt-BR");
    const normalizedItems = itemSearch.trim().toLocaleLowerCase("pt-BR");
    const creationDate = quote.createdAt?.slice(0, 10) ?? "";
    return (!normalizedName || quote.patient.toLocaleLowerCase("pt-BR").includes(normalizedName))
      && (!normalizedItems || quote.items.toLocaleLowerCase("pt-BR").includes(normalizedItems))
      && (statusFilter === "Todos" || quote.status === statusFilter)
      && (!dateFrom || (creationDate && creationDate >= dateFrom))
      && (!dateTo || (creationDate && creationDate <= dateTo));
  });

  async function saveQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIsSaving(true); const form = new FormData(event.currentTarget); const patient = quotePatients.find((item) => item.id === selectedPatientId)?.name ?? "Paciente";
    const response = await fetch("/api/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: selectedPatientId, items: String(form.get("items")), total: parseCurrency(form.get("total")), expires: String(form.get("expires")) }) });
    setIsSaving(false);
    if (!response.ok) return;
    const data = await response.json() as { quote: { id: string; items: string; total: number; status: string; expires: string | null; patient?: { name: string } | null } };
    const item = data.quote;
    invalidateClientCache("/api/quotes", "/api/dashboard/bootstrap");
    setQuoteRows((current) => [{ id: item.id, patient: item.patient?.name ?? patient, items: item.items, total: currency.format(item.total), status: item.status, expires: item.expires ? new Date(item.expires).toLocaleDateString("pt-BR") : "Sem validade", createdAt: new Date().toISOString() }, ...current]);
    setPatientQuery(""); setSelectedPatientId(""); setSelectedProcedureNames([]);
    onCreateClose(); onSaved?.(`Orçamento de ${patient} foi criado.`);
  }

  async function sendQuote(quote: QuoteRow) {
    if (!quote.id) return;
    await fetch(`/api/quotes/${quote.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Enviado" }) });
    setQuoteRows((current) => current.map((item) => item.id === quote.id ? { ...item, status: "Enviado" } : item));
    invalidateClientCache("/api/quotes", "/api/dashboard/bootstrap");
    onSaved?.("Orçamento marcado como enviado.");
  }

  return (
    <div>
      <SectionIntro
        title="Orçamentos"
        description="Propostas associadas ao paciente com status comercial e total calculado por procedimento."
        action="Novo orçamento"
        onAction={onCreateOpen}
      />
      <SearchFilterBar
          placeholder="Pesquisar por nome do paciente"
          value={quoteSearch}
          onChange={setQuoteSearch}
          showFilter={false}
          trailing={<DateRangeFilter startDate={dateFrom} endDate={dateTo} onStartDateChange={setDateFrom} onEndDateChange={setDateTo} />}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtros de orçamentos">
        <label className="grid gap-1 text-xs font-semibold text-[#68697b]">Procedimento<select className={fieldClassName} value={itemSearch} onChange={(event) => setItemSearch(event.target.value)}><option value="">Todos os procedimentos</option>{quoteProcedures.map((procedure) => <option key={procedure.id} value={procedure.name}>{procedure.name}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold text-[#68697b]">Status<select className={fieldClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Todos</option>{[...new Set(quoteRows.map((quote) => quote.status))].sort().map((status) => <option key={status}>{status}</option>)}</select></label>
      </div>
      {isLoading ? <LoadingTable columns={6} /> : visibleQuotes.length ? <MiniTable
        columns={["Paciente", "Itens", "Total", "Status", "Validade", "Ação"]}
        rows={visibleQuotes.map((quote) => [
          <strong className="text-[#121733]" key={quote.patient}>{quote.patient}</strong>,
          quote.items,
          <span className="font-black text-[#1438ff]" key={quote.total}>{quote.total}</span>,
          <StatusBadge key={quote.status} status={quote.status} />,
          quote.expires,
          <Button key="send" size="sm" variant="secondary" disabled={quote.status === "Enviado"} onClick={() => sendQuote(quote)}>{quote.status === "Enviado" ? "Enviado" : "Enviar"}</Button>,
        ])}
      /> : <EmptyState title="Nenhum orçamento encontrado" description="Ajuste os filtros ou a pesquisa para encontrar orçamentos." />}
      <Modal open={openCreate} onClose={onCreateClose} title="Novo orçamento" description="Crie uma proposta comercial para o cliente.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveQuote}>
          <div className="relative sm:col-span-2">
            <FormField label="Paciente">
              <input className={fieldClassName} name="patientSearch" placeholder={optionsLoading ? "Carregando pacientes..." : "Pesquise por nome ou CPF"} required value={patientQuery} disabled={optionsLoading} onChange={(event) => { setPatientQuery(event.target.value); setSelectedPatientId(""); }} />
            </FormField>
            {patientQuery && !selectedPatientId ? <div className="absolute left-0 right-0 top-[68px] z-20 max-h-44 overflow-auto rounded-[7px] border border-[#e5e5ee] bg-white p-1 shadow-xl">
              {matchingQuotePatients.length ? matchingQuotePatients.map((patient) => <button className="flex w-full items-center justify-between rounded-[5px] px-3 py-2 text-left text-xs transition hover:bg-[#f5f4ff]" key={patient.id} type="button" onClick={() => { setSelectedPatientId(patient.id); setPatientQuery(`${patient.name}${patient.cpf ? ` · ${patient.cpf}` : ""}`); }}><span className="font-bold text-[#303144]">{patient.name}</span><span className="text-[10px] text-[#858696]">{patient.cpf || "CPF não informado"}</span></button>) : <p className="px-3 py-2 text-xs text-[#858696]">Nenhum paciente encontrado.</p>}
            </div> : null}
            {selectedPatientId ? <p className="mt-1 text-[10px] font-semibold text-[#5147dc]">Paciente selecionado: {quotePatients.find((patient) => patient.id === selectedPatientId)?.name}</p> : null}
          </div>
          <FormField label="Validade"><MaskedInput className={fieldClassName} formatter={formatDate} name="expires" inputMode="numeric" maxLength={10} placeholder="30/09/2026" required /></FormField>
          <div className="sm:col-span-2"><FormField label="Procedimentos"><div className="flex min-h-10 flex-wrap gap-1.5 rounded-[7px] border border-[#dddfea] bg-white p-2">{selectedProcedureNames.map((name) => <span className="flex items-center gap-1 rounded-full bg-[#f0efff] px-2 py-1 text-[10px] font-bold text-[#5147dc]" key={name}>{name}<button className="text-[#5147dc] hover:text-[#b42318]" type="button" onClick={() => setSelectedProcedureNames((current) => current.filter((item) => item !== name))}>×</button></span>)}<select className="min-w-[150px] flex-1 bg-transparent text-xs font-semibold text-[#858696] outline-none" value="" disabled={optionsLoading || !quoteProcedures.length} onChange={(event) => { if (event.target.value) setSelectedProcedureNames((current) => current.includes(event.target.value) ? current : [...current, event.target.value]); }}><option value="">{optionsLoading ? "Carregando procedimentos..." : quoteProcedures.length ? "Adicionar procedimento" : "Nenhum procedimento cadastrado"}</option>{quoteProcedures.map((procedure) => <option key={procedure.id} value={procedure.name}>{procedure.name} · {currency.format(procedure.price)}</option>)}</select></div><input className="sr-only" name="items" value={selectedProcedureNames.join(", ")} readOnly required /></FormField></div>
          <div className="sm:col-span-2"><FormField label="Valor total"><MaskedInput key={selectedProcedureNames.join("|")} className={fieldClassName} formatter={formatCurrency} name="total" inputMode="decimal" defaultValue={suggestedTotal ? currency.format(suggestedTotal) : ""} placeholder="R$ 0,00" required /></FormField></div>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button disabled={isSaving || optionsLoading || !selectedPatientId || !selectedProcedureNames.length} type="submit">{isSaving ? "Salvando..." : "Salvar orçamento"}</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function PaymentsSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  type ApiPayment = { id: string; value: number; method: string; date: string; status: string; installments: string; patient?: { name: string } | null };
  const cachedPayments = readClientCache<{ payments?: ApiPayment[] }>("/api/payments");
  const [paymentRows, setPaymentRows] = useState<Payment[]>(() => (cachedPayments?.payments ?? []).map((item) => ({ id: item.id, patient: item.patient?.name ?? "Paciente", value: currency.format(item.value), method: item.method, date: new Date(item.date).toLocaleDateString("pt-BR"), dateRaw: item.date, status: item.status, installments: item.installments })));
  const [isLoading, setIsLoading] = useState(!cachedPayments);
  const [isSaving, setIsSaving] = useState(false);
  const [methodFilter, setMethodFilter] = useState("Todos");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const visiblePayments = paymentRows.filter((item) => {
    const matchesMethod = methodFilter === "Todos" || item.method === methodFilter;
    const paymentDate = item.dateRaw?.slice(0, 10) ?? "";
    const matchesFrom = !dateFrom || paymentDate >= dateFrom;
    const matchesTo = !dateTo || paymentDate <= dateTo;
    return matchesMethod && matchesFrom && matchesTo;
  });

  useEffect(() => {
    getCachedJson<{ payments?: ApiPayment[] }>("/api/payments").then((data) => {
      setPaymentRows((data.payments ?? []).map((item) => ({ id: item.id, patient: item.patient?.name ?? "Paciente", value: currency.format(item.value), method: item.method, date: new Date(item.date).toLocaleDateString("pt-BR"), dateRaw: item.date, status: item.status, installments: item.installments })));
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIsSaving(true); const form = new FormData(event.currentTarget); const patient = String(form.get("patient"));
    const response = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient, value: parseCurrency(form.get("value")), method: String(form.get("method")), status: String(form.get("status")), installments: String(form.get("installments")) }) });
    setIsSaving(false);
    if (!response.ok) return;
    const data = await response.json() as { payment: { id: string; value: number; method: string; date: string; status: string; installments: string; patient?: { name: string } | null } };
    const item = data.payment;
    invalidateClientCache("/api/payments", "/api/dashboard/bootstrap");
    setPaymentRows((current) => [{ id: item.id, patient: item.patient?.name ?? patient, value: currency.format(item.value), method: item.method, date: new Date(item.date).toLocaleDateString("pt-BR"), dateRaw: item.date, status: item.status, installments: item.installments }, ...current]);
    onCreateClose(); onSaved?.(`Pagamento de ${patient} foi registrado.`);
  }

  return (
    <div>
      <SectionIntro
        title="Pagamentos"
        description="Registro de valores, forma de pagamento, parcelamento, observações e status financeiro."
        action="Registrar pagamento"
        onAction={onCreateOpen}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtros de pagamentos">
        {['Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro'].map((method) => {
          const selected = methodFilter === method;
          return <button
            aria-pressed={selected}
            className={`hp-pressable flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-bold transition-colors ${selected ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#dddfea] bg-white text-[#65708b] hover:border-[#5147dc] hover:text-[#5147dc]"}`}
            key={method}
            onClick={() => setMethodFilter(selected ? "Todos" : method)}
            type="button"
          >
            <CircleDollarSign className="h-4 w-4" />
            {method}
            {selected ? <Check className="h-4 w-4" /> : null}
          </button>;
        })}
        <div className="ml-0 sm:ml-auto"><DateRangeFilter startDate={dateFrom} endDate={dateTo} onStartDateChange={setDateFrom} onEndDateChange={setDateTo} /></div>
      </div>
      {isLoading ? <LoadingTable columns={6} /> : <MiniTable
        columns={["Paciente", "Valor", "Forma", "Data", "Status", "Parcelamento"]}
        rows={visiblePayments.map((payment) => [
          <strong className="text-[#121733]" key={payment.patient}>{payment.patient}</strong>,
          <span className="font-black text-[#1438ff]" key={payment.value}>{payment.value}</span>,
          payment.method,
          payment.date,
          <StatusBadge key={payment.status} status={payment.status} />,
          payment.installments,
        ])}
      />}
      <Modal open={openCreate} onClose={onCreateClose} title="Registrar pagamento" description="O lançamento aparecerá imediatamente no histórico financeiro.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={savePayment}>
          <div className="sm:col-span-2"><FormField label="Paciente"><input className={fieldClassName} name="patient" required /></FormField></div>
          <FormField label="Valor"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="value" inputMode="decimal" placeholder="R$ 0,00" required /></FormField>
          <FormField label="Forma"><select className={fieldClassName} name="method"><option>Pix</option><option>Cartão de crédito</option><option>Cartão de débito</option><option>Dinheiro</option></select></FormField>
          <FormField label="Status"><select className={fieldClassName} name="status"><option>Pago</option><option>Parcial</option><option>Pendente</option></select></FormField>
          <FormField label="Parcelamento"><input className={fieldClassName} name="installments" defaultValue="À vista" required /></FormField>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button disabled={isSaving} type="submit">{isSaving ? "Salvando..." : "Registrar pagamento"}</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function FinanceSection() {
  const [activePeriod, setActivePeriod] = useState("Mês");
  const data = useFinancialData();
  const received = data?.payments.filter((item) => item.status === "Pago").reduce((sum, item) => sum + item.value, 0) ?? 0;
  const pending = data?.payments.filter((item) => item.status !== "Pago").reduce((sum, item) => sum + item.value, 0) ?? 0;
  const values = [received, 0, received, pending, received];
  const procedureTotals = Object.entries((data?.appointments ?? []).reduce<Record<string, number>>((result, item) => { result[item.procedure] = (result[item.procedure] ?? 0) + 1; return result; }, {}));

  return (
    <div>
      <SectionIntro
        title="Financeiro"
        description="Dashboard de receita, despesas, resultado, pendências e performance por procedimento."
      />
      <div className="mb-6 flex flex-wrap gap-2">
        {["Hoje", "Semana", "Mês", "Período personalizado"].map((period) => (
          <Button key={period} variant={activePeriod === period ? "dark" : "secondary"} onClick={() => setActivePeriod(period)}>
            {period}
          </Button>
        ))}
      </div>
      <div className="hp-list-stagger grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {["Receita", "Despesas", "Resultado", "Valores pendentes", "Recebidos"].map((label, index) => (
          <Card className="p-5" key={label}>
            <p className="text-sm font-semibold text-[#65708b]">{label}</p>
            <p className="mt-3 text-2xl font-black text-[#121733]">
              <CountUpValue value={values[index]} format={(currentValue) => currency.format(Math.round(currentValue))} />
            </p>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Resultado por procedimento</CardTitle>
          <Badge variant="green">Margem real</Badge>
        </CardHeader>
        <CardContent className="hp-list-stagger space-y-5">
          {procedureTotals.length ? procedureTotals.map(([name, count], index) => (
            <div key={name}>
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-black text-[#121733]">{name}</p>
                <p className="text-sm text-[#65708b]">
                  Atendimentos realizados: <strong>{count}</strong>
                </p>
              </div>
              <ProgressBar value={Math.min(100, count * 20)} tone={index === 2 ? "purple" : "green"} />
            </div>
          )) : <p className="text-sm text-[#65708b]">Ainda não há atendimentos para calcular resultados.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export function ReportsSection() {
  const data = useFinancialData();
  const received = data?.payments.filter((item) => item.status === "Pago").reduce((sum, item) => sum + item.value, 0) ?? 0;
  const pending = data?.payments.filter((item) => item.status !== "Pago").reduce((sum, item) => sum + item.value, 0) ?? 0;
  const mostPerformed = Object.entries((data?.appointments ?? []).reduce<Record<string, number>>((result, item) => { result[item.procedure] = (result[item.procedure] ?? 0) + 1; return result; }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Sem dados";
  const reportItems = [
    { label: "Receita por período", value: currency.format(received) },
    { label: "Resultado por período", value: currency.format(received) },
    { label: "Procedimento mais realizado", value: mostPerformed },
    { label: "Pagamentos pendentes", value: currency.format(pending) },
  ];
  return (
    <div>
      <SectionIntro
        title="Relatórios"
        description="Primeiros indicadores para receita, resultado, custos, margem por procedimento e pendências."
        action="Exportar relatório"
        onAction={() => window.print()}
      />
      <div className="hp-list-stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reportItems.map((item) => (
          <Card className="p-5" key={item.label}>
            <p className="text-sm font-semibold text-[#65708b]">{item.label}</p>
            <p className="mt-3 text-xl font-black text-[#121733]">{item.value}</p>
          </Card>
        ))}
      </div>
      <div className="hp-list-stagger mt-6 grid gap-6 lg:grid-cols-2">
        <DetailCard title="Relatórios iniciais">
          <div className="space-y-3">
            {[
              "Procedimentos realizados",
              "Procedimentos mais realizados",
              "Receita por procedimento",
              "Custo por procedimento",
              "Margem por procedimento",
              "Pagamentos pendentes",
            ].map((item) => (
              <div className="flex items-center gap-3" key={item}>
                <CheckCircle2 className="h-4 w-4 text-[#16a34a]" />
                <span className="text-sm font-semibold text-[#3f485f]">{item}</span>
              </div>
            ))}
          </div>
        </DetailCard>
        <DetailCard title="Pós-atendimento">
          <div className="space-y-4">
            <div className="rounded-[8px] bg-[#f2edff] p-4">
              <p className="font-black text-[#6d36d4]">
                8 pacientes possuem retorno nos próximos 7 dias.
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm text-[#3f485f]">
              <CalendarPlus className="h-4 w-4 text-[#1438ff]" />
              Data do retorno e evolução clínica
            </div>
            <div className="flex items-center gap-3 text-sm text-[#3f485f]">
              <Camera className="h-4 w-4 text-[#1438ff]" />
              Fotos e evidências conforme o fluxo da clínica
            </div>
          </div>
        </DetailCard>
      </div>
    </div>
  );
}

type TeamMember = { id: string; role: string; isOwner: boolean; user: { id: string; name: string; email: string; createdAt: string } };

export function SettingsSection({ isAdmin = false, isOwner = false, clinicName, onClinicNameChange }: { isAdmin?: boolean; isOwner?: boolean; clinicName?: string; onClinicNameChange?: (name: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const cachedTeam = readClientCache<{ members?: TeamMember[] }>("/api/team");
  const [members, setMembers] = useState<TeamMember[]>(cachedTeam?.members ?? []);
  const [teamLoading, setTeamLoading] = useState(!cachedTeam);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [memberRemoving, setMemberRemoving] = useState(false);
  const [memberRemoveError, setMemberRemoveError] = useState("");
  const cachedCostSettings = readClientCache<{ settings?: { name?: string; laborCost: number; facilityCost: number; medicationCost: number; appointmentToleranceMinutes: number; openingTime: string; closingTime: string } }>("/api/clinic/cost-settings");
  const [costSettings, setCostSettings] = useState(() => ({
    laborCost: cachedCostSettings?.settings?.laborCost ?? 0,
    facilityCost: cachedCostSettings?.settings?.facilityCost ?? 0,
    medicationCost: cachedCostSettings?.settings?.medicationCost ?? 0,
    appointmentToleranceMinutes: cachedCostSettings?.settings?.appointmentToleranceMinutes ?? 15,
    openingTime: cachedCostSettings?.settings?.openingTime ?? "08:00",
    closingTime: cachedCostSettings?.settings?.closingTime ?? "19:00",
  }));
  const [costSettingsLoading, setCostSettingsLoading] = useState(!cachedCostSettings);
  const [costSettingsSaving, setCostSettingsSaving] = useState(false);
  const [costSettingsError, setCostSettingsError] = useState("");
  const [appointmentToleranceInput, setAppointmentToleranceInput] = useState(String(costSettings.appointmentToleranceMinutes ?? 15));
  const [openingTimeInput, setOpeningTimeInput] = useState(costSettings.openingTime ?? "08:00");
  const [closingTimeInput, setClosingTimeInput] = useState(costSettings.closingTime ?? "19:00");
  const [clinicNameInput, setClinicNameInput] = useState(cachedCostSettings?.settings?.name ?? clinicName ?? "Harmonize+");

  useEffect(() => {
    getCachedJson<{ members?: TeamMember[] }>("/api/team")
      .then((data) => setMembers(data.members ?? []))
      .catch(() => setTeamError("Não foi possível carregar os colaboradores."))
      .finally(() => setTeamLoading(false));
  }, []);

  useEffect(() => {
    getCachedJson<{ settings?: { name?: string; laborCost: number; facilityCost: number; medicationCost: number; appointmentToleranceMinutes: number; openingTime: string; closingTime: string } }>("/api/clinic/cost-settings")
      .then((data) => {
        const settings = data.settings ?? { laborCost: 0, facilityCost: 0, medicationCost: 0, appointmentToleranceMinutes: 15, openingTime: "08:00", closingTime: "19:00" };
        setCostSettings(settings);
        if (settings.name) setClinicNameInput(settings.name);
        setAppointmentToleranceInput(String(settings.appointmentToleranceMinutes));
        setOpeningTimeInput(settings.openingTime ?? "08:00");
        setClosingTimeInput(settings.closingTime ?? "19:00");
      })
      .catch(() => setCostSettingsError("Não foi possível carregar os custos da clínica."))
      .finally(() => setCostSettingsLoading(false));
  }, []);

  async function saveCostSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCostSettingsSaving(true);
    setCostSettingsError("");
    const form = new FormData(event.currentTarget);
    const nextSettings = {
      laborCost: form.has("laborCost") ? parseCurrency(form.get("laborCost")) : costSettings.laborCost,
      facilityCost: form.has("facilityCost") ? parseCurrency(form.get("facilityCost")) : costSettings.facilityCost,
      medicationCost: form.has("medicationCost") ? parseCurrency(form.get("medicationCost")) : costSettings.medicationCost,
      appointmentToleranceMinutes: parseInteger(appointmentToleranceInput),
      ...(editing === "Clínica" ? { name: clinicNameInput.trim(), openingTime: openingTimeInput, closingTime: closingTimeInput } : {}),
    };
    const response = await fetch("/api/clinic/cost-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextSettings) });
    const responseText = await response.text();
    let data: { settings?: typeof nextSettings; message?: string } = {};
    if (responseText) {
      try {
        data = JSON.parse(responseText) as typeof data;
      } catch {
        data = { message: "O servidor retornou uma resposta inválida." };
      }
    }
    setCostSettingsSaving(false);
    if (!response.ok || !data.settings) {
      setCostSettingsError(data.message ?? "Não foi possível salvar os custos da clínica.");
      return;
    }
    setCostSettings((current) => ({
      ...current,
      laborCost: data.settings?.laborCost ?? current.laborCost,
      facilityCost: data.settings?.facilityCost ?? current.facilityCost,
      medicationCost: data.settings?.medicationCost ?? current.medicationCost,
      appointmentToleranceMinutes: data.settings?.appointmentToleranceMinutes ?? current.appointmentToleranceMinutes,
      openingTime: data.settings?.openingTime ?? current.openingTime,
      closingTime: data.settings?.closingTime ?? current.closingTime,
    }));
    if (data.settings.name) {
      setClinicNameInput(data.settings.name);
      onClinicNameChange?.(data.settings.name);
    }
    invalidateClientCache("/api/clinic/cost-settings", "/api/quotes/options");
  }

  async function saveCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTeamSaving(true);
    setTeamError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.get("name"), email: form.get("email"), password: form.get("password"), role: form.get("role") }),
      });
      const responseText = await response.text();
      let data: { member?: TeamMember; message?: string } | null = null;
      if (responseText) {
        try {
          data = JSON.parse(responseText) as { member?: TeamMember; message?: string };
        } catch {
          data = null;
        }
      }
      setTeamSaving(false);
      if (!response.ok || !data?.member) {
        setTeamError(data?.message ?? "Não foi possível cadastrar o colaborador. Tente novamente.");
        return;
      }
      setMembers((current) => [...current, data.member as TeamMember].sort((a, b) => a.user.name.localeCompare(b.user.name)));
      invalidateClientCache("/api/team");
      setEditing(null);
      setTeamError("");
    } catch {
      setTeamSaving(false);
      setTeamError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    }
  }

  async function removeCollaborator() {
    if (!memberToRemove) return;
    setMemberRemoving(true);
    setMemberRemoveError("");
    const response = await fetch("/api/team", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipId: memberToRemove.id }),
    });
    const data = await response.json().catch(() => ({})) as { message?: string };
    setMemberRemoving(false);
    if (!response.ok) {
      setMemberRemoveError(data.message ?? "Não foi possível remover o colaborador.");
      return;
    }
    setMembers((current) => current.filter((member) => member.id !== memberToRemove.id));
    invalidateClientCache("/api/team", "/api/agenda/bootstrap");
    setMemberToRemove(null);
  }

  return (
    <div>
      <SectionIntro
        title="Configurações"
        description="Fundação para dados da clínica, profissionais, preferências de agenda, formas de pagamento e permissões."
      />
      <div className="hp-list-stagger grid gap-6 lg:grid-cols-3">
        {[
          ["Clínica", "Nome, CNPJ, endereço e dados comerciais."],
          ["Profissionais", "Perfis, agenda, permissões e assinatura visual."],
          ["Cálculo de custos", "Unidades, arredondamentos e regras de margem."],
        ].map(([title, description]) => (
          <button className={cn("settings-option hp-pressable text-left", title === "Profissionais" && !isAdmin && "cursor-not-allowed opacity-60")} key={title} onClick={() => { if (title === "Profissionais" && !isAdmin) return; setEditing(title); }}><Card className="settings-option-card h-full p-5 transition-colors">
            <Sparkles className="mb-4 h-5 w-5 text-[#1438ff]" />
            <p className="font-black text-[#121733]">{title}</p>
            <p className="mt-2 text-sm leading-6 text-[#65708b]">{description}</p>
          </Card></button>
        ))}
      </div>
      <Card className="mt-6 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 className="font-black text-[#121733]">Colaboradores da clínica</h3><p className="mt-1 text-sm text-[#65708b]">Contas vinculadas a esta clínica e seus níveis de acesso.</p></div>
          {isAdmin ? <Button size="sm" onClick={() => { setEditing("Novo colaborador"); setTeamError(""); }}><UserPlus className="h-4 w-4" />Novo colaborador</Button> : <span className="text-xs font-bold text-[#858696]">Apenas administradores</span>}
        </div>
        {teamError && !editing ? <p className="mt-4 rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{teamError}</p> : null}
        <div className="mt-4 divide-y divide-[#ececf2]">
          {teamLoading ? <div className="space-y-3 py-3">{[0, 1, 2].map((item) => <div className="flex items-center justify-between gap-4" key={item}><div className="flex-1 space-y-2"><LoadingSkeleton className="h-3 w-40" /><LoadingSkeleton className="h-2.5 w-56" /></div><LoadingSkeleton className="h-6 w-20 rounded-full" /></div>)}</div> : members.length ? members.map((member) => <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" key={member.id}><div><p className="text-sm font-bold text-[#303144]">{member.user.name}</p><p className="text-xs text-[#858696]">{member.user.email}</p></div><div className="flex items-center gap-2"><Badge variant={member.isOwner ? "purple" : member.role === "ADMIN" ? "purple" : "green"}>{member.isOwner ? "Administrador principal" : member.role === "PROFESSIONAL" ? "Profissional" : member.role === "STAFF" ? "Equipe" : "Administrador"}</Badge>{isOwner && !member.isOwner ? <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-[#b42318] hover:bg-[#fff1f0] hover:text-[#b42318]" aria-label={`Remover ${member.user.name}`} title="Remover colaborador" onClick={() => { setMemberRemoveError(""); setMemberToRemove(member); }}><Trash2 className="h-3.5 w-3.5" /></Button> : null}</div></div>) : <p className="py-5 text-sm text-[#65708b]">Nenhum colaborador cadastrado.</p>}
        </div>
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Configurar ${editing ?? ""}`} description="Essas preferências ficam salvas durante esta sessão.">
        {editing === "Clínica" ? <form className="grid gap-4" onSubmit={saveCostSettings}><p className="text-xs leading-5 text-[#65708b]">Configure o nome e o horário em que a clínica está aberta para novos atendimentos.</p><FormField label="Nome de exibição"><input className={fieldClassName} name="name" value={clinicNameInput} onChange={(event) => setClinicNameInput(event.target.value)} required /></FormField><div className="grid gap-4 sm:grid-cols-2"><FormField label="Início do funcionamento"><input className={fieldClassName} name="openingTime" type="time" value={openingTimeInput} onChange={(event) => setOpeningTimeInput(event.target.value)} required /></FormField><FormField label="Fim do funcionamento"><input className={fieldClassName} name="closingTime" type="time" value={closingTimeInput} onChange={(event) => setClosingTimeInput(event.target.value)} required /></FormField></div>{costSettingsError ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{costSettingsError}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button disabled={costSettingsSaving || costSettingsLoading} type="submit">{costSettingsSaving ? "Salvando..." : "Salvar alterações"}</Button></div></form> : null}
        {editing === "Novo colaborador" ? <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveCollaborator}><div className="sm:col-span-2"><FormField label="Nome completo"><input className={fieldClassName} name="name" required /></FormField></div><FormField label="E-mail de acesso"><input className={fieldClassName} name="email" type="email" required /></FormField><FormField label="Senha inicial"><input className={fieldClassName} name="password" type="password" minLength={6} required /></FormField><FormField label="Perfil"><select className={fieldClassName} name="role"><option value="PROFESSIONAL">Profissional</option><option value="STAFF">Equipe</option><option value="ADMIN">Administrador</option></select></FormField>{teamError ? <p className="sm:col-span-2 rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{teamError}</p> : null}<div className="flex justify-end gap-2 sm:col-span-2"><Button disabled={teamSaving} type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button disabled={teamSaving} type="submit">{teamSaving ? "Criando conta..." : "Criar conta"}</Button></div></form> : editing === "Cálculo de custos" ? <form className="grid gap-4" onSubmit={saveCostSettings}><div className="sm:col-span-2"><FormField label="Tolerância para marcar falta (minutos)"><input className={fieldClassName} name="appointmentToleranceMinutes" type="number" min="0" max="180" value={appointmentToleranceInput} onChange={(event) => setAppointmentToleranceInput(event.target.value)} required /></FormField><p className="mt-1 text-[10px] text-[#858696]">O atendimento só será marcado como faltou depois desse período.</p></div><p className="text-xs leading-5 text-[#65708b]">Defina os valores padrão que serão adicionados automaticamente aos orçamentos desta clínica.</p>{costSettingsLoading ? <div className="space-y-3"><LoadingSkeleton className="h-10 w-full" /><LoadingSkeleton className="h-10 w-full" /><LoadingSkeleton className="h-10 w-full" /></div> : <><FormField label="Mão de obra / Honorários"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="laborCost" defaultValue={currency.format(costSettings.laborCost)} inputMode="decimal" /></FormField><FormField label="Sala / Estrutura"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="facilityCost" defaultValue={currency.format(costSettings.facilityCost)} inputMode="decimal" /></FormField><FormField label="Anestésico / Medicamentos"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="medicationCost" defaultValue={currency.format(costSettings.medicationCost)} inputMode="decimal" /></FormField></>}{costSettingsError ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{costSettingsError}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button disabled={costSettingsSaving || costSettingsLoading} type="submit">{costSettingsSaving ? "Salvando..." : "Salvar custos"}</Button></div></form> : null}
      </Modal>
      <Modal open={Boolean(memberToRemove)} onClose={() => { if (!memberRemoving) setMemberToRemove(null); }} title="Remover colaborador" description="Essa ação remove o acesso do colaborador à clínica.">
        <div className="space-y-4">
          <p className="text-sm text-[#555668]">Tem certeza que deseja remover <strong>{memberToRemove?.user.name}</strong>?</p>
          {memberRemoveError ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{memberRemoveError}</p> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={memberRemoving} onClick={() => setMemberToRemove(null)}>Cancelar</Button><Button type="button" className="bg-[#b42318] hover:bg-[#991b1b]" disabled={memberRemoving} onClick={() => void removeCollaborator()}>{memberRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}{memberRemoving ? "Removendo..." : "Remover colaborador"}</Button></div>
        </div>
      </Modal>
    </div>
  );
}
