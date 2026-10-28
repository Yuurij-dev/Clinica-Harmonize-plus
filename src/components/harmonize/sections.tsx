"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  CalendarPlus,
  CalendarClock,
  Camera,
  CheckCircle2,
  Check,
  Clock3,
  CircleDollarSign,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageCircle,
  MoreVertical,
  PencilLine,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  PlugZap,
  UsersRound,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUp } from "@/components/ui/count-up";
import { MaskedInput } from "@/components/ui/masked-input";
import {
  DetailCard,
  DateRangeFilter,
  EmptyState,
  LoadingSkeleton,
  LoadingTable,
  MiniTable,
  SearchFilterBar,
  SectionIntro,
  StatusBadge,
} from "./shared";
import { useCan } from "./current-user";
import { PatientDetail } from "./patient-detail";
import { useAnamnesisStartGate, type AnamnesisOpenMode } from "./anamnesis-start-gate";
import { buildCustomerJourney } from "@/lib/customer-journey";
import {
  formatCurrency,
  formatCnpj,
  formatCpf,
  formatDate,
  formatInteger,
  formatPhone,
  parseCurrency,
  parseInteger,
} from "@/lib/input-masks";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { cleanSearchQuery, defaultPatientPageSize, patientListKey, patientPageSizes } from "@/lib/patient-list-rules";
import { capitalizeFirst, formatDayBR, agendaDayInvalidationKey, agendaPeriodKey, agendaPeriodRange, dayInRange, shiftAgendaDay, type AgendaRange } from "@/lib/agenda-period-rules";
import { PaginationBar } from "./clinical-pagination";
import { usePatientLookup, type LookupPatient } from "./use-patient-lookup";
import { createDefaultRolePermissionMatrix, permissionGroups, roleLabels, roles, runningAppointmentStatuses, type Role, type RolePermissionMatrix } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { describeTechnicalSheet } from "@/lib/stock-rules";
import type { TechnicalSheetItem } from "./technical-sheet-editor";
import { ProcedureFormModal, procedureCatalogCacheKey, type EditableProcedure } from "./procedure-form-modal";
import { MaterialCheckModal } from "./material-check-modal";
import { ClinicTimePicker } from "./clinic-time-picker";
import { latestAppointmentStart } from "@/lib/clinic-time";
import { appointmentProcedureDuration } from "@/lib/procedure-session-rules";
import { toast } from "sonner";
import { clientsHomeEvent } from "@/lib/section-events";
import { ProcedureImage } from "./procedure-image";
import type { Appointment, JourneyStageId, Patient, Payment, Procedure, Product, Quote } from "@/types/clinic";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const quantityFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

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
  createdAt?: string;
  lastVisit: string | null;
  nextReturn: string | null;
  totalValue: number;
  currentStage?: JourneyStageId;
};

type PatientListResponse = {
  patients: ApiPatient[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  summary: { total: number; byStatus: Record<string, number> };
};
const patientSearchDebounceMs = 300;

// Dados estáticos e leves da agenda; os agendamentos vêm por período (GET /api/agenda?from&to).
type AgendaBootstrap = { procedures: ApiProcedureOption[]; members: Array<{ role: string; user: { name: string } }>; settings?: { appointmentToleranceMinutes: number; openingTime: string; closingTime: string; requireCancellationReason: boolean; autoMarkMissedAppointmentsEnabled: boolean; autoCompleteAppointmentsEnabled: boolean; allowAppointmentsOutsideHours: boolean } };
type ShownPeriod = { key: string; date: Date; view: CalendarView };
type AgendaPeriodResponse = { appointments: ApiAppointment[]; range: AgendaRange; total: number };
const agendaBootstrapKey = "/api/agenda/bootstrap";

type AppointmentRow = Appointment & { id: string; patientId: string; date: string; durationMinutes: number; category: string; notes: string };
type ApiProcedureOption = { name: string; category: string; durationMinutes: number };
type ApiAppointment = {
  id: string;
  patientId: string;
  date: string;
  time: string;
  procedure: string;
  professional: string;
  status: string;
  notes?: string;
  patient: { name: string };
};

function appointmentCancellationReason(notes?: string) {
  const marker = "Motivo do cancelamento:";
  const markerIndex = notes?.lastIndexOf(marker) ?? -1;
  return markerIndex < 0 ? "" : notes!.slice(markerIndex + marker.length).trim();
}

function formatDateInputPtBR(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseDateInputPtBR(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return "";
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return "";
  return `${yearText}-${monthText}-${dayText}`;
}

function calendarDateToPtBR(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function AnimatedOptionSelect({ name, options, placeholder, disabled = false, invalid = false, onChange }: { name: string; options: string[]; placeholder: string; disabled?: boolean; invalid?: boolean; onChange: () => void }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = `${name}-options`;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={value} />
      <button type="button" role="combobox" aria-expanded={open} aria-controls={menuId} aria-haspopup="listbox" disabled={disabled} className={cn(fieldClassName, "flex w-full items-center justify-between gap-2 text-left", invalid && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} onClick={() => setOpen((current) => !current)}>
        <span className={cn("truncate", value ? "text-foreground" : "text-muted-foreground")}>{value || placeholder}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#626477] transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open ? <div id={menuId} role="listbox" aria-label={placeholder} className="hp-option-menu-enter absolute left-0 right-0 top-[calc(100%+5px)] z-50 max-h-52 overflow-auto rounded-[7px] border border-[#dcddea] bg-card p-1 shadow-[0_12px_28px_rgba(24,25,40,0.2)]">
        {options.map((option) => <button key={option} type="button" role="option" aria-selected={value === option} className={cn("flex w-full items-center rounded-[5px] px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-[#f0efff] hover:text-[#5147dc]", value === option && "bg-[#f0efff] text-[#5147dc]")} onClick={() => { setValue(option); setOpen(false); onChange(); }}>{option}</button>)}
      </div> : null}
    </div>
  );
}

function AppointmentDatePicker({ value, onSelect }: { value: string; onSelect: (date: string) => void }) {
  const selectedDate = parseDateInputPtBR(value);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initial = selectedDate || calendarDateKey(clinicNow());
    const [year, month] = initial.split("-").map(Number);
    return new Date(year, month - 1, 1);
  });
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((firstWeekday + daysInMonth) / 7);
  const dates = Array.from({ length: weekCount * 7 }, (_, index) => new Date(year, month, index - firstWeekday + 1));
  const today = calendarDateKey(clinicNow());

  return <div className="hp-option-menu-enter absolute left-0 top-[calc(100%+6px)] z-[80] w-[min(19rem,calc(100vw-3rem))] rounded-lg border border-border bg-card p-3 text-card-foreground shadow-[0_14px_36px_rgba(18,19,35,0.28)]">
    <div className="mb-2 flex items-center justify-between">
      <p className="text-sm font-semibold capitalize">{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(visibleMonth)}</p>
      <div className="flex gap-1">
        <button type="button" aria-label="Mês anterior" className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" aria-label="Próximo mês" className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
    <div className="grid grid-cols-7 text-center text-[10px] font-semibold text-muted-foreground">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => <span className="py-1" key={day}>{day}</span>)}</div>
    <div className="grid grid-cols-7 gap-y-1">
      {dates.map((day) => {
        const key = calendarDateKey(day);
        const inMonth = day.getMonth() === month;
        const selected = key === selectedDate;
        return <button key={key} type="button" aria-label={new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(day)} aria-pressed={selected} className={cn("mx-auto grid h-8 w-8 place-items-center rounded-full text-xs transition-colors hover:bg-primary/10 hover:text-primary", !inMonth && "text-muted-foreground/50", key === today && !selected && "border border-primary/50 font-bold", selected && "bg-primary font-bold text-primary-foreground hover:bg-primary hover:text-primary-foreground")} onClick={() => onSelect(key)}>{day.getDate()}</button>;
      })}
    </div>
    <div className="mt-2 flex justify-end border-t border-border pt-2"><button type="button" className="text-xs font-semibold text-primary transition-opacity hover:opacity-75" onClick={() => onSelect(today)}>Hoje</button></div>
  </div>;
}

// Mensagem de erro devolvida pelo servidor (ex.: conflito de horário) ou o texto padrão.
async function responseMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => null) as { message?: string } | null;
  return data?.message ?? fallback;
}

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
    notes: appointment.notes ?? "",
    // Mesma resolução do servidor: "Procedimento - X" / "Retorno - X" usam a duração de X.
    durationMinutes: appointmentProcedureDuration(procedures, appointment.procedure) ?? 60,
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
    createdAt: patient.createdAt,
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
  const [selectedPatientName, setSelectedPatientName] = useState<string | null>(null);
  // Lista paginada no servidor: a página/busca/tamanho compõem a chave do cache. A página anterior fica visível enquanto a nova carrega.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPatientPageSize);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const appliedQuery = useRef("");
  const listKey = patientListKey({ page, pageSize, q: query });
  // Última página carregada (fica na tela enquanto a próxima chega) e a chave a que ela pertence.
  const [list, setList] = useState<{ key: string; data: PatientListResponse | null; errorKey: string | null }>(() => {
    const cached = readClientCache<PatientListResponse>(patientListKey());
    return { key: cached ? patientListKey() : "", data: cached ?? null, errorKey: null };
  });
  const listData = list.data;
  const listError = list.errorKey === listKey ? (list.data ? "Não foi possível carregar esta consulta. A tabela abaixo ainda mostra a consulta anterior." : "Não foi possível carregar os pacientes do servidor.") : "";
  const isLoading = !listData && !listError;
  const isFetching = list.key !== listKey && !listError;
  const [reloadToken, setReloadToken] = useState(0);
  const [retainedPatient, setRetainedPatient] = useState<Patient | null>(null);
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const patientRows = useMemo(() => listData?.patients.map(mapApiPatient) ?? [], [listData]);
  // Depois do cadastro, quem pode preencher anamnese decide se começa agora ou depois (não é obrigatória).
  const canFillAnamnesis = useCan("anamnesis:write");
  const [justCreated, setJustCreated] = useState<Patient | null>(null);
  // Pedido de abrir a anamnese pertence a UM paciente: só vale para ele e some ao trocar de paciente ou voltar à lista.
  const [anamnesisRequest, setAnamnesisRequest] = useState<{ patientKey: string; mode: AnamnesisOpenMode } | null>(null);

  useEffect(() => {
    const syncSelectedPatient = () => {
      const params = new URLSearchParams(window.location.search);
      const patientKey = params.get("patient");
      const section = params.get("section");
      setSelectedPatientName(patientKey);
      // A Agenda (gate de anamnese) pede a anamnese por URL; o parâmetro é consumido e removido para não repetir.
      if (patientKey && (section === "view" || section === "fill" || section === "new-version")) {
        setAnamnesisRequest({ patientKey, mode: section });
        params.delete("section");
        window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
      } else {
        setAnamnesisRequest((current) => current && current.patientKey === patientKey ? current : null);
      }
    };
    syncSelectedPatient();
    // Menu lateral clicado estando já em Clientes: volta para a lista (sem pedir anamnese pendente do paciente anterior).
    const goToList = () => { setAnamnesisRequest(null); setSelectedPatientName(null); };
    window.addEventListener("popstate", syncSelectedPatient);
    window.addEventListener(clientsHomeEvent, goToList);
    return () => { window.removeEventListener("popstate", syncSelectedPatient); window.removeEventListener(clientsHomeEvent, goToList); };
  }, []);

  // Busca no servidor com debounce: só consulta depois que o usuário para de digitar e volta para a página 1.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = cleanSearchQuery(queryInput);
      if (next !== appliedQuery.current) { appliedQuery.current = next; setPage(1); setQuery(next); }
    }, patientSearchDebounceMs);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    let active = true;
    getCachedJson<PatientListResponse>(listKey)
      .then((data) => {
        if (!active) return;
        setList({ key: listKey, data, errorKey: null });
        // Página além do fim (ex.: a lista encolheu): volta para a última página existente.
        if (data.patients.length === 0 && data.pagination.total > 0 && page > data.pagination.pageCount) setPage(data.pagination.pageCount);
      })
      .catch(() => { if (active) setList((current) => ({ ...current, errorKey: listKey })); });
    return () => { active = false; };
    // `page` só é lido para corrigir a página além do fim; a consulta depende da chave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, reloadToken]);

  const selectedInList = patientRows.find((patient) => patient.id === selectedPatientName || patient.name === selectedPatientName);
  const retainedMatches = retainedPatient && selectedPatientName !== null && (retainedPatient.id === selectedPatientName || retainedPatient.name === selectedPatientName) ? retainedPatient : undefined;
  // O perfil aberto não some se a lista recarregar sem ele (outra página/busca): fica o último registro conhecido.
  const selectedPatient = selectedInList ?? retainedMatches;
  const hasSelectedPatient = Boolean(selectedPatient);

  // Perfil aberto fora da página carregada (link da Agenda, outra página, busca mudou): busca só esse paciente.
  useEffect(() => {
    if (!selectedPatientName || hasSelectedPatient) return;
    let active = true;
    getCachedJson<{ patient: ApiPatient }>(`/api/patients/${encodeURIComponent(selectedPatientName)}`)
      .then((data) => { if (active) setRetainedPatient(mapApiPatient(data.patient)); })
      .catch(() => {
        if (!active) return;
        toast.error("Paciente não encontrado.");
        setSelectedPatientName(null);
        router.replace("/clientes");
      });
    return () => { active = false; };
  }, [selectedPatientName, hasSelectedPatient, router]);
  const detailLoading = Boolean(selectedPatientName) && !selectedPatient;

  function openPatient(patient: Patient) {
    const key = patient.id ?? patient.name;
    setRetainedPatient(patient);
    setAnamnesisRequest((current) => current && current.patientKey === key ? current : null);
    setSelectedPatientName(key);
    router.push(`/clientes?patient=${encodeURIComponent(key)}`);
  }

  function continueAfterCreate(fillAnamnesis: boolean) {
    const created = justCreated;
    setJustCreated(null);
    if (!created) return;
    const key = created.id ?? created.name;
    setAnamnesisRequest(fillAnamnesis ? { patientKey: key, mode: "fill" } : null);
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
      setRetainedPatient(savedPatient);
      // Só depois do sucesso: derruba as páginas/buscas de clientes (e as buscas dos seletores) e recarrega a página atual.
      invalidateClientCache("/api/patients", "/api/dashboard/bootstrap");
      // Vai para a página 1 sem busca para o cadastro não ficar escondido por filtro ou página.
      const wasFiltered = page !== 1 || appliedQuery.current !== "";
      appliedQuery.current = "";
      setQueryInput("");
      setQuery("");
      setPage(1);
      setReloadToken((token) => token + 1);
      if (wasFiltered) toast.success("Paciente cadastrado. A lista voltou à primeira página, sem busca.");
      onCreateClose();
      onSaved?.(`${savedPatient.name} foi adicionado aos clientes.`);
      if (canFillAnamnesis) setJustCreated(savedPatient);
    } catch {
      setSaveError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSaving(false);
    }
  }

  if (detailLoading) return <div><LoadingTable columns={6} /></div>;

  if (selectedPatient) {
    return (
      <PatientDetail
        key={selectedPatient.id ?? selectedPatient.name}
        patient={selectedPatient}
        initialSection={anamnesisRequest && anamnesisRequest.patientKey === (selectedPatient.id ?? selectedPatient.name) ? anamnesisRequest.mode : null}
        onBack={() => {
          setAnamnesisRequest(null);
          setSelectedPatientName(null);
          // A lista volta a ficar visível: refaz a consulta da página atual (o perfil pode ter editado o paciente).
          setReloadToken((token) => token + 1);
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
      <SearchFilterBar placeholder="Buscar por nome, telefone ou status" value={queryInput} onChange={setQueryInput} />
      {listError ? <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[7px] border border-[#ffd7d7] bg-[#fff7f7] px-3 py-2 text-xs font-semibold text-[#b42318]"><span>{listError}</span><Button size="sm" variant="secondary" onClick={() => { setList((current) => ({ ...current, errorKey: null })); setReloadToken((token) => token + 1); }}>Tentar novamente</Button></div> : null}
      {isLoading ? <LoadingTable columns={6} /> : null}
      {!isLoading && !listError && !patientRows.length ? <EmptyState title="Nenhum cliente encontrado" description={query ? "Nenhum cliente corresponde à busca. Tente outro nome, telefone ou status." : "Cadastre um cliente para começar o prontuário da clínica."} /> : null}
      {!isLoading && patientRows.length ? <div aria-busy={isFetching} className={cn("transition-opacity", isFetching && "opacity-60")}><MiniTable
        columns={["Nome", "Telefone", "Status", "Etapa atual", "Próximo retorno", "Ação"]}
        rows={patientRows.map((patient) => {
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
      /></div> : null}
      {listData && !listError && listData.pagination.total > 0 ? <PaginationBar page={listData.pagination.page} pageSize={listData.pagination.pageSize} total={listData.pagination.total} sizes={patientPageSizes} noun={["cliente", "clientes"]} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} /> : null}
      <div className="hp-panel-enter mt-5 flex items-center justify-between rounded-[7px] border border-[#e2e0f1] bg-[#f7f6ff] px-4 py-3">
        <div>
          <p className="text-xs font-bold text-[#454659]">Jornada conectada ao prontuário</p>
          <p className="mt-1 text-xs text-[#8d8e9e]">A etapa avança conforme avaliações, orçamentos e atendimentos são registrados.</p>
        </div>
        <Badge variant="purple">Automática</Badge>
      </div>
      <Modal open={Boolean(justCreated)} onClose={() => continueAfterCreate(false)} title="Cliente cadastrado" description={justCreated ? `${justCreated.name} foi adicionado aos clientes.` : undefined}>
        <div className="space-y-4">
          <p className="text-sm font-semibold text-[#303144]">Deseja preencher a anamnese agora?</p>
          <p className="text-xs leading-5 text-[#77788a]">A anamnese reúne queixa, histórico de saúde, alergias e medicamentos. Ela não é obrigatória e pode ser preenchida depois, no prontuário da cliente.</p>
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={() => continueAfterCreate(false)}>Fazer depois</Button><Button type="button" onClick={() => continueAfterCreate(true)}>Preencher anamnese</Button></div>
        </div>
      </Modal>
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
  // Período inicial (foco vindo de outra tela abre o dia) e o que já está em cache para ele, para a primeira pintura sem espera.
  const [initial] = useState(() => {
    const view: CalendarView = focus ? "Dia" : "Semana";
    const date = focus ? focusDate(focus.date) : clinicNow();
    const bootstrap = readClientCache<AgendaBootstrap>(agendaBootstrapKey);
    const period = readClientCache<AgendaPeriodResponse>(agendaPeriodKey(agendaPeriodRange(calendarDateKey(date), view)));
    return { view, date, bootstrap, period: bootstrap ? period : undefined };
  });
  const cachedAgenda = initial.bootstrap;
  const rowColors = ["#5147dc", "#6d5ce7", "#2f9c88", "#d86655", "#ddb63f"];
  const [appointmentRows, setAppointmentRows] = useState<AppointmentRow[]>(() => initial.period && initial.bootstrap ? initial.period.appointments.map((item) => mapApiAppointment(item, initial.bootstrap?.procedures)) : []);
  // O calendário desenha o último período já carregado; ao navegar ele continua na tela até o novo chegar.
  const [shownPeriod, setShownPeriod] = useState<ShownPeriod>({ key: initial.period ? agendaPeriodKey(agendaPeriodRange(calendarDateKey(initial.date), initial.view)) : "", date: initial.date, view: initial.view });
  const [isLoading, setIsLoading] = useState(!initial.period);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const hasShownPeriod = useRef(Boolean(initial.period));
  const procedureCatalogRef = useRef<ApiProcedureOption[]>(cachedAgenda?.procedures ?? []);
  const shownPeriodRef = useRef<ShownPeriod>({ key: "", date: initial.date, view: initial.view });
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedPatientRecord, setSelectedPatientRecord] = useState<LookupPatient | null>(null);
  const [procedureCatalog, setProcedureCatalog] = useState<ApiProcedureOption[]>(cachedAgenda?.procedures ?? []);
  const [professionalChoices, setProfessionalChoices] = useState<string[]>(cachedAgenda?.members.map((member) => member.user.name) ?? []);
  const [professionalLoading, setProfessionalLoading] = useState(!cachedAgenda);
  const [patientQuery, setPatientQuery] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [invalidAppointmentFields, setInvalidAppointmentFields] = useState<Set<string>>(new Set());
  const [appointmentFormError, setAppointmentFormError] = useState("");
  const [activeView, setActiveView] = useState<CalendarView>(initial.view);
  const [calendarDate, setCalendarDate] = useState(initial.date);
  const [calendarDatePickerOpen, setCalendarDatePickerOpen] = useState(false);
  const [calendarDateDraft, setCalendarDateDraft] = useState(() => calendarDateKey(initial.date));
  const appointmentDateInputRef = useRef<HTMLInputElement>(null);
  const [appointmentDatePickerOpen, setAppointmentDatePickerOpen] = useState(false);
  const calendarDayKey = calendarDateKey(calendarDate);
  // Navegou para um período cujos dados ainda não chegaram: o anterior continua na tela com o aviso "Carregando período...".
  const periodLoading = shownPeriod.key !== agendaPeriodKey(agendaPeriodRange(calendarDayKey, activeView)) && !loadError;
  const focusTime = focus?.time;
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [professional, setProfessional] = useState("Todos");
  const [appointmentToleranceMinutes, setAppointmentToleranceMinutes] = useState(cachedAgenda?.settings?.appointmentToleranceMinutes ?? 15);
  const [openingTime, setOpeningTime] = useState(cachedAgenda?.settings?.openingTime ?? "08:00");
  const [closingTime, setClosingTime] = useState(cachedAgenda?.settings?.closingTime ?? "19:00");
  const [requireCancellationReason, setRequireCancellationReason] = useState(cachedAgenda?.settings?.requireCancellationReason ?? false);
  const [allowAppointmentsOutsideHours, setAllowAppointmentsOutsideHours] = useState(cachedAgenda?.settings?.allowAppointmentsOutsideHours ?? false);
  const [deleteTarget, setDeleteTarget] = useState<AppointmentRow | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentRow | null>(null);
  const [cancellationTarget, setCancellationTarget] = useState<AppointmentRow | null>(null);
  const [cancellationReasonInput, setCancellationReasonInput] = useState("");
  const [cancellationReasonError, setCancellationReasonError] = useState("");
  const [deleteSaving, setDeleteSaving] = useState(false);
  const canRun = useCan("appointment:run");
  // Profissionais da equipe (estáveis ao navegar) mais os que aparecem nos agendamentos carregados.
  const professionalOptions = useMemo(() => ["Todos", ...new Set([...professionalChoices, ...appointmentRows.map((item) => item.professional)])], [professionalChoices, appointmentRows]);
  const activeProfessional = professionalOptions.includes(professional) ? professional : "Todos";
  const filteredAppointments = appointmentRows.filter((appointment) => activeProfessional === "Todos" || appointment.professional === activeProfessional);

  // Dados estáticos da agenda (horário, procedimentos, profissionais): não dependem do período.
  useEffect(() => {
    let active = true;
    const refreshSettings = () => getCachedJson<AgendaBootstrap>(agendaBootstrapKey)
      .then((data) => {
        if (!active) return;
        setProcedureCatalog(data.procedures);
        procedureCatalogRef.current = data.procedures;
        setAppointmentToleranceMinutes(data.settings?.appointmentToleranceMinutes ?? 15);
        setOpeningTime(data.settings?.openingTime ?? "08:00");
        setClosingTime(data.settings?.closingTime ?? "19:00");
        setRequireCancellationReason(data.settings?.requireCancellationReason ?? false);
        setAllowAppointmentsOutsideHours(data.settings?.allowAppointmentsOutsideHours ?? false);
        setProfessionalChoices(data.members.map((member) => member.user.name));
      })
      .catch(() => undefined)
      .finally(() => { if (active) setProfessionalLoading(false); });
    void refreshSettings();
    window.addEventListener("harmonize-notification-settings-updated", refreshSettings);
    return () => { active = false; window.removeEventListener("harmonize-notification-settings-updated", refreshSettings); };
  }, []);

  // Agendamentos do período visível (dia/semana/mês). Ao navegar, o período anterior continua na tela até o novo chegar.
  useEffect(() => {
    let active = true;
    const range = agendaPeriodRange(calendarDayKey, activeView);
    const periodKey = agendaPeriodKey(range);
    const requestedDate = calendarDate;
    const show = (period: AgendaPeriodResponse, bootstrap: AgendaBootstrap) => {
      hasShownPeriod.current = true;
      setAppointmentRows(period.appointments.map((item) => mapApiAppointment(item, bootstrap.procedures)));
      shownPeriodRef.current = { key: periodKey, date: requestedDate, view: activeView };
      setShownPeriod(shownPeriodRef.current);
      setLoadError("");
      setIsLoading(false);
    };
    Promise.all([getCachedJson<AgendaBootstrap>(agendaBootstrapKey), getCachedJson<AgendaPeriodResponse>(periodKey)])
      .then(([bootstrap, period]) => {
        if (!active) return;
        show(period, bootstrap);
      })
      .catch(() => {
        if (!active) return;
        setIsLoading(false);
        if (hasShownPeriod.current) {
          // Não deixa o cabeçalho apontar para um período cujos dados não chegaram: volta ao último período exibido.
          toast.error("Não foi possível carregar este período da agenda.");
          setCalendarDate(shownPeriodRef.current.date);
          setActiveView(shownPeriodRef.current.view);
        } else setLoadError("Não foi possível carregar os dados da agenda.");
      });
    return () => { active = false; };
    // calendarDate/activeView entram pela chave do dia e pela visão; shownPeriodRef é só leitura do último período exibido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarDayKey, activeView, reloadToken]);

  useEffect(() => {
    const refresh = () => { setReloadToken((token) => token + 1); };
    window.addEventListener("harmonize-auto-appointments-updated", refresh);
    return () => window.removeEventListener("harmonize-auto-appointments-updated", refresh);
  }, []);

  // Seletor de paciente: busca sob demanda no servidor (nome ou CPF), com debounce, só enquanto o usuário digita.
  const patientLookup = usePatientLookup(patientQuery, !selectedPatientId);
  const matchingPatients = patientLookup.patients;
  const selectedPatient = selectedPatientRecord?.id === selectedPatientId ? selectedPatientRecord : undefined;

  function clearAppointmentField(field: string) {
    setInvalidAppointmentFields((current) => {
      if (!current.has(field)) return current;
      const next = new Set(current);
      next.delete(field);
      return next;
    });
    setAppointmentFormError("");
  }

  // Só entra na tela se o dia estiver no período exibido; os demais períodos são buscados quando o usuário chegar neles.
  function addRowIfVisible(appointment: ApiAppointment) {
    const shownRange = agendaPeriodRange(calendarDateKey(shownPeriodRef.current.date), shownPeriodRef.current.view);
    if (!dayInRange(calendarDateKey(appointment.date), shownRange)) return;
    setAppointmentRows((current) => [...current.filter((item) => item.id !== appointment.id), mapApiAppointment(appointment, procedureCatalog)].sort((a, b) => `${a.date}-${a.time}`.localeCompare(`${b.date}-${b.time}`)));
  }

  async function saveAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const patient = selectedPatient?.name ?? "";
    const selectedTime = appointmentTime;
    const selectedDate = parseDateInputPtBR(String(form.get("date") ?? ""));
    const now = clinicNow();
    const today = calendarDateKey(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const invalidFields = new Set<string>();
    if (!selectedPatientId) invalidFields.add("patient");
    if (!selectedDate || selectedDate < today) invalidFields.add("date");
    if (!selectedTime) invalidFields.add("time");
    const latestTime = latestAppointmentStart(closingTime);
    if (selectedTime && !allowAppointmentsOutsideHours && (selectedTime < openingTime || !latestTime || selectedTime > latestTime)) invalidFields.add("time");
    if (selectedDate === today && selectedTime && appointmentMinutes(selectedTime) <= currentMinutes) invalidFields.add("time");
    if (!String(form.get("professional"))) invalidFields.add("professional");
    if (!String(form.get("procedure"))) invalidFields.add("procedure");
    if (invalidFields.size) {
      setInvalidAppointmentFields(invalidFields);
      setAppointmentFormError(!selectedDate ? "Informe uma data válida no formato DD/MM/AAAA." : selectedDate < today || (selectedDate === today && selectedTime && appointmentMinutes(selectedTime) <= currentMinutes) ? "Não é possível agendar em um horário ou data que já passou." : !selectedTime ? "Selecione um horário para o atendimento." : invalidFields.has("time") ? `O horário deve estar dentro do período permitido: ${openingTime} às ${latestTime ?? "indisponível"}.` : "Revise os campos destacados antes de continuar.");
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
          time: selectedTime,
          procedure: String(form.get("procedure")),
          professional: String(form.get("professional")),
          date: `${selectedDate}T00:00:00`,
        }),
      });
      const data = await response.json().catch(() => null) as { appointment?: ApiAppointment; message?: string } | null;
      if (!response.ok || !data?.appointment) {
        // Mostra o motivo devolvido pelo servidor (conflito de horário, expediente, duplicidade).
        const reason = data?.message ?? "Não foi possível criar o agendamento.";
        setAppointmentFormError(reason);
        // Conflito/expediente: marca o campo Horário como inválido para leitores de tela e destaque visual.
        if (/horário|atendimento neste horário/i.test(reason)) setInvalidAppointmentFields(new Set(["time"]));
        return;
      }
      addRowIfVisible(data.appointment!);
      invalidateClientCache(agendaDayInvalidationKey(data.appointment!.date), "/api/dashboard/bootstrap", `/api/patients/${selectedPatientId}/history`);
      onCreateClose();
      setPatientQuery("");
      setSelectedPatientId("");
      setAppointmentTime("");
      onSaved?.(`Agendamento de ${patient} foi criado.`);
    } finally {
      setIsSaving(false);
    }
  }

  const [materialCheck, setMaterialCheck] = useState<{ id: string; patientId: string } | null>(null);
  const agendaRouter = useRouter();
  // Mesmo gate de anamnese da ficha do cliente, aqui com o paciente do agendamento clicado.
  const anamnesisGate = useAnamnesisStartGate({ onOpenAnamnesis: (mode, patientId) => agendaRouter.push(`/clientes?patient=${encodeURIComponent(patientId)}&section=${mode}`) });

  function advanceAppointment(target: AppointmentRow) {
    if (target.status === "Em atendimento") { void performAdvance(target); return; }
    anamnesisGate.requestStart(() => { void performAdvance(target); }, { patientId: target.patientId });
  }

  async function performAdvance(target: AppointmentRow) {
    const nextStatus = target.status === "Em atendimento" ? "Atendido" : "Em atendimento";
    setUpdatingId(target.id);
    const response = await fetch(`/api/appointments/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
    if (!response.ok) { setUpdatingId(null); toast.error(await responseMessage(response, "Não foi possível atualizar o atendimento.")); return; }
    setAppointmentRows((current) => current.map((item) => item.id === target.id ? { ...item, status: nextStatus } : item));
    invalidateClientCache(agendaDayInvalidationKey(target.date), "/api/dashboard/bootstrap", `/api/patients/${target.patientId}/history`, ...(nextStatus === "Atendido" ? ["/api/patients"] : []));
    setUpdatingId(null);
    onSaved?.(`${target.patient}: ${nextStatus}.`);
    if (nextStatus === "Atendido") setMaterialCheck({ id: target.id, patientId: target.patientId });
  }

  async function markAppointmentAsMissed(target: AppointmentRow) {
    const previousStatus = target.status;

    setUpdatingId(target.id);
    const response = await fetch(`/api/appointments/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Faltou" }) });
    if (!response.ok) { setUpdatingId(null); toast.error(await responseMessage(response, "Não foi possível marcar a falta.")); return; }
    setAppointmentRows((current) => current.map((item) => item.id === target.id ? { ...item, status: "Faltou" } : item));
    invalidateClientCache(agendaDayInvalidationKey(target.date), "/api/dashboard/bootstrap", `/api/patients/${target.patientId}/history`);
    setUpdatingId(null);
    onSaved?.(`${target.patient} foi marcado como faltou.`, () => {
      setAppointmentRows((current) => current.map((item) => item.id === target.id ? { ...item, status: previousStatus } : item));
      invalidateClientCache(agendaDayInvalidationKey(target.date), "/api/dashboard/bootstrap", `/api/patients/${target.patientId}/history`);
    });
  }

  function requestCancelAppointment(target: AppointmentRow) {
    if (!requireCancellationReason) {
      void cancelAppointment(target);
      return;
    }
    setCancellationTarget(target);
    setCancellationReasonInput("");
    setCancellationReasonError("");
  }

  async function cancelAppointment(target: AppointmentRow, reason?: string) {
    const cancellationReason = reason?.trim();
    if (requireCancellationReason && !cancellationReason) {
      setCancellationReasonError("Informe o motivo do cancelamento para continuar.");
      return;
    }
    setUpdatingId(target.id);
    const response = await fetch(`/api/appointments/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Cancelado", ...(cancellationReason ? { cancellationReason } : {}) }) });
    const result = await response.json().catch(() => null) as { message?: string; appointment?: { notes?: string } } | null;
    if (!response.ok) { setUpdatingId(null); toast.error(result?.message ?? "Não foi possível cancelar o agendamento."); return; }
    const updatedNotes = result?.appointment?.notes ?? (cancellationReason ? [target.notes?.trim() ?? "", `Motivo do cancelamento: ${cancellationReason}`].filter(Boolean).join("\n\n") : target.notes ?? "");
    setAppointmentRows((current) => current.map((item) => item.id === target.id ? { ...item, status: "Cancelado", notes: updatedNotes } : item));
    setSelectedAppointment((current) => current?.id === target.id ? { ...current, status: "Cancelado", notes: updatedNotes } : current);
    if (cancellationTarget?.id === target.id) {
      setCancellationTarget(null);
      setSelectedAppointment(null);
    }
    invalidateClientCache(agendaDayInvalidationKey(target.date), "/api/dashboard/bootstrap", `/api/patients/${target.patientId}/history`);
    setUpdatingId(null);
    onSaved?.(`${target.patient}: agendamento cancelado.`);
  }

  async function deleteAppointment() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteSaving(true);
    const response = await fetch(`/api/appointments/${target.id}`, { method: "DELETE" });
    if (!response.ok) { setDeleteSaving(false); toast.error(await responseMessage(response, "Não foi possível excluir o agendamento.")); return; }
    setAppointmentRows((current) => current.filter((item) => item.id !== target.id));
    setDeleteTarget(null);
    setDeleteSaving(false);
    invalidateClientCache(agendaDayInvalidationKey(target.date), "/api/dashboard/bootstrap", `/api/patients/${target.patientId}/history`);
    onSaved?.(`${target.patient}: agendamento excluído.`, () => {
      void fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: target.patientId, time: target.time, procedure: target.procedure, professional: target.professional, date: target.date }),
      }).then(async (restoreResponse) => {
        if (!restoreResponse.ok) { toast.error(`Não foi possível desfazer a exclusão: ${await responseMessage(restoreResponse, "tente agendar novamente.")}`); return; }
        const data = await restoreResponse.json() as { appointment: ApiAppointment };
        addRowIfVisible(data.appointment);
        invalidateClientCache(agendaDayInvalidationKey(target.date), "/api/dashboard/bootstrap", `/api/patients/${target.patientId}/history`);
      });
    });
  }

  return (
    <div className="w-full">
      <div data-hp-title className="hp-page-enter mb-5 flex flex-col gap-4 border-b border-[#ececf2] pb-5 sm:flex-row sm:items-end sm:justify-between">
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
          <h3 className="ml-2 truncate text-base font-bold text-[#303144]">{calendarPeriodLabel(calendarDate, activeView)}</h3>
          {periodLoading ? <span role="status" className="flex items-center gap-1 text-[10px] font-semibold text-[#858696]"><Loader2 className="h-3 w-3 animate-spin text-[#5147dc]" />Carregando período...</span> : null}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
          <div className="flex w-full min-w-0 basis-full flex-1 flex-wrap items-center gap-2 sm:w-auto sm:basis-auto sm:flex-none">
            {["Semana", "Dia", "Mês"].map((view) => (
              <Button
                className="min-w-0 flex-1 transition-all duration-200 ease-out active:scale-[0.98] sm:flex-none"
                key={view}
                onClick={() => setActiveView(view as "Dia" | "Semana" | "Mês")}
                size="sm"
                variant={activeView === view ? "primary" : "secondary"}
              >
                {view}
              </Button>
            ))}
          </div>
          <div className="relative">
            <Button
              variant="secondary"
              size="icon"
              aria-label="Selecionar data"
              aria-expanded={calendarDatePickerOpen}
              aria-haspopup="dialog"
              title="Ir para uma data"
              onClick={() => {
                setCalendarDateDraft(calendarDateKey(calendarDate));
                setCalendarDatePickerOpen((current) => !current);
              }}
            ><CalendarDays className="h-4 w-4" /></Button>
            {calendarDatePickerOpen ? (
              <form
                className="absolute right-0 top-11 z-40 w-64 rounded-[8px] border border-[#e7e9f2] bg-white p-3 shadow-[0_12px_32px_rgba(38,39,58,0.16)]"
                role="dialog"
                aria-label="Ir para uma data da agenda"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDateDraft)) return;
                  const [year, month, day] = calendarDateDraft.split("-").map(Number);
                  setCalendarDate(new Date(year, month - 1, day));
                  setCalendarDatePickerOpen(false);
                }}
              >
                <label htmlFor="schedule-date-picker" className="mb-2 block text-xs font-semibold text-[#454659]">Escolha a data</label>
                <input
                  id="schedule-date-picker"
                  type="date"
                  className={cn(fieldClassName, "w-full text-xs")}
                  value={calendarDateDraft}
                  onChange={(event) => setCalendarDateDraft(event.target.value)}
                  required
                  autoFocus
                />
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setCalendarDatePickerOpen(false)}>Cancelar</Button>
                  <Button type="submit" size="sm">Ir para data</Button>
                </div>
              </form>
            ) : null}
          </div>
          <select className={cn(fieldClassName, "min-w-0 flex-1 text-xs sm:min-w-[170px] sm:flex-none")} value={activeProfessional} onChange={(event) => setProfessional(event.target.value)} aria-label="Filtrar por profissional">
            {professionalOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
      </div>

      {loadError ? <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[7px] border border-[#ffd7d7] bg-[#fff7f7] px-3 py-2 text-xs font-semibold text-[#b42318]"><span>{loadError}</span><Button size="sm" variant="secondary" onClick={() => { setLoadError(""); setIsLoading(true); setReloadToken((token) => token + 1); }}>Tentar novamente</Button></div> : null}
      <ScheduleCalendar
        key={activeView}
        appointments={filteredAppointments}
        date={shownPeriod.date}
        view={shownPeriod.view}
        focusTime={focusTime}
        openingTime={openingTime}
        closingTime={closingTime}
        allowOutsideHours={allowAppointmentsOutsideHours}
        loading={isLoading}
        openMenuId={openMenuId}
        onMenuToggle={(id) => setOpenMenuId((current) => current === id ? null : id)}
        onAdvance={advanceAppointment}
        onMissed={markAppointmentAsMissed}
        onCancel={requestCancelAppointment}
        onDelete={(appointment) => setDeleteTarget(appointment)}
        onSelect={(appointment) => setSelectedAppointment(appointment)}
        appointmentToleranceMinutes={appointmentToleranceMinutes}
        updatingId={updatingId}
      />

      <Modal open={Boolean(selectedAppointment) && !cancellationTarget} onClose={() => setSelectedAppointment(null)} title="Detalhes do agendamento" description="Informações completas do atendimento selecionado.">
        {selectedAppointment ? <div className="space-y-4">
          <div className={cn("rounded-[8px] border-l-4 p-4", appointmentTone(selectedAppointment).card)}><p className="text-xs font-bold text-[#77788a]">{selectedAppointment.time} - {formatEndTime(selectedAppointment.time, selectedAppointment.durationMinutes)}</p><h3 className="mt-1 text-lg font-black text-[#303144]">{selectedAppointment.procedure}</h3><p className="mt-1 text-sm text-[#656678]">{selectedAppointment.patient}</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[{ label: "Data", value: formatDayBR(selectedAppointment.date) }, { label: "Profissional", value: selectedAppointment.professional }, { label: "Tipo", value: selectedAppointment.category || "Atendimento" }].map(({ label, value }) => <div className="rounded-[7px] border border-[#e8e8ef] bg-[#fafafd] p-3" key={label}><p className="text-[9px] font-bold uppercase text-[#9697a7]">{label}</p><p className="mt-1 text-xs font-semibold text-[#4f5062]">{value}</p></div>)}
            <div className="rounded-[7px] border border-[#e8e8ef] bg-[#fafafd] p-3"><p className="text-[9px] font-bold uppercase text-[#9697a7]">Status</p><p className="mt-1 text-xs font-semibold text-[#4f5062]">{selectedAppointment.status}</p>
              {requireCancellationReason && selectedAppointment.status === "Cancelado" ? <div className="mt-2 border-t border-[#e8e8ef] pt-2"><p className="text-[9px] font-bold uppercase text-[#9697a7]">Motivo do cancelamento</p><p className="mt-1 whitespace-pre-wrap break-words text-xs font-medium text-[#4f5062]">{appointmentCancellationReason(selectedAppointment.notes) || "Motivo não registrado."}</p></div> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {selectedAppointment.status === "Agendado" ? <Button type="button" variant="destructive" disabled={updatingId === selectedAppointment.id} onClick={() => requestCancelAppointment(selectedAppointment)}>{updatingId === selectedAppointment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{updatingId === selectedAppointment.id ? "Cancelando..." : "Cancelar consulta"}</Button> : <span />}
            <div className="flex justify-end gap-2">{selectedAppointment.status === "Agendado" ? <Button type="button" variant="secondary" disabled title="Confirmação por WhatsApp em breve"><MessageCircle className="h-3.5 w-3.5" />Confirmar por WhatsApp</Button> : null}<Button type="button" onClick={() => setSelectedAppointment(null)}>Fechar</Button></div>
          </div>
        </div> : null}
      </Modal>

      <Modal open={Boolean(cancellationTarget)} onClose={() => { if (updatingId !== cancellationTarget?.id) setCancellationTarget(null); }} title="Cancelar consulta" description="Informe o motivo para registrar o cancelamento no histórico do paciente." panelClassName="max-w-md">
        {cancellationTarget ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void cancelAppointment(cancellationTarget, cancellationReasonInput); }}>
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-foreground">
            <p className="font-semibold">{cancellationTarget.patient}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{cancellationTarget.procedure} · {formatDayBR(cancellationTarget.date)} às {cancellationTarget.time}</p>
          </div>
          <FormField label="Motivo do cancelamento">
            <textarea autoFocus className={cn(fieldClassName, "min-h-24 resize-y py-2")} maxLength={500} value={cancellationReasonInput} onChange={(event) => { setCancellationReasonInput(event.target.value); setCancellationReasonError(""); }} placeholder="Descreva o motivo..." required />
          </FormField>
          {cancellationReasonError ? <p className="text-xs font-medium text-destructive" role="alert">{cancellationReasonError}</p> : null}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="secondary" disabled={updatingId === cancellationTarget.id} onClick={() => setCancellationTarget(null)}>Voltar</Button>
            <Button type="submit" variant="destructive" disabled={updatingId === cancellationTarget.id}>{updatingId === cancellationTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{updatingId === cancellationTarget.id ? "Cancelando..." : "Confirmar cancelamento"}</Button>
          </div>
        </form> : null}
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
              <div className="flex min-w-0 items-center gap-2"><ProcedureImage name={appointment.procedure} decorative className="h-8 w-8 rounded-sm" /><div className="min-w-0"><strong className="block truncate text-[#3d3e51]">{appointment.procedure}</strong><span className="mt-1 block text-[9px] text-[#aaaab7]">Consulta clínica</span></div></div>
              <StatusBadge status={appointment.status} />
              <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#f0efff] text-[8px] font-black text-[#5147dc]">{appointment.professional.replace("Dra. ", "").replace("Dr. ", "").slice(0, 2).toUpperCase()}</span><strong className="text-[#5a5b6e]">{appointment.professional}</strong></div>
              <div><strong className="block uppercase text-[#444557]">{appointment.patient}</strong><span className="mt-1 block text-[9px] text-[#aaaab7]">Paciente</span></div>
              <div className="flex justify-end gap-2">
                {canRun ? <Button className="border-[#5147dc] text-[#5147dc]" key="action" size="sm" variant="secondary" disabled={isCompleted || isMissed || updatingId !== null} onClick={() => advanceAppointment(appointment)}>{updatingId === appointment.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{updatingId === appointment.id ? "Atualizando..." : primaryLabel} {updatingId === appointment.id ? null : <ArrowRight className="h-3 w-3" />}</Button> : null}
                {!isCompleted && !isMissed ? (
                  <Button className="border-[#f2c8c3] text-[#b42318] hover:border-[#b42318] hover:text-[#b42318]" key="missed" size="sm" variant="secondary" disabled={updatingId !== null} onClick={() => markAppointmentAsMissed(appointment)}>{updatingId === appointment.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{updatingId === appointment.id ? "Salvando..." : "Faltou"}</Button>
                ) : null}
                {appointment.status === "Agendado" ? <Button key="whatsapp" size="sm" variant="secondary" disabled title="Confirmação por WhatsApp em breve" aria-label="Confirmar por WhatsApp"><MessageCircle className="h-3 w-3" /></Button> : null}
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
                      setSelectedPatientRecord(patient);
                      setSelectedPatientId(patient.id);
                      setPatientQuery(`${patient.name}${patient.cpf ? ` · ${patient.cpf}` : ""}`);
                    }}
                  >
                    <span className="font-bold text-[#303144]">{patient.name}</span>
                    <span className="text-[10px] text-[#858696]">{patient.cpf || "CPF não informado"}</span>
                  </button>
                )) : <p className="px-3 py-2 text-xs text-[#858696]">{patientLookup.tooShort ? "Digite pelo menos 2 letras." : patientLookup.loading ? "Buscando pacientes..." : patientLookup.error ? "Não foi possível buscar pacientes." : "Nenhum paciente encontrado."}</p>}
              </div>
            ) : null}
            {selectedPatientId ? <p className="mt-1 text-[10px] font-semibold text-[#5147dc]">Paciente selecionado: {selectedPatient?.name}</p> : null}
          </div>
          <FormField label="Data">
            <div className="relative">
              <input ref={appointmentDateInputRef} className={cn(fieldClassName, "pr-10", invalidAppointmentFields.has("date") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} name="date" type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/aaaa" maxLength={10} defaultValue={calendarDateToPtBR(calendarDateKey(calendarDate))} onChange={(event) => { event.currentTarget.value = formatDateInputPtBR(event.currentTarget.value); clearAppointmentField("date"); }} required />
              <button type="button" aria-label="Abrir calendário" title="Abrir calendário" aria-expanded={appointmentDatePickerOpen} className="absolute inset-y-0 right-2 grid place-items-center text-[#858696] transition-colors hover:text-[#5147dc]" onClick={() => setAppointmentDatePickerOpen((current) => !current)}><CalendarDays className="h-4 w-4" /></button>
              {appointmentDatePickerOpen ? <AppointmentDatePicker value={appointmentDateInputRef.current?.value ?? calendarDateToPtBR(calendarDateKey(calendarDate))} onSelect={(date) => {
                if (appointmentDateInputRef.current) appointmentDateInputRef.current.value = calendarDateToPtBR(date);
                clearAppointmentField("date");
                setAppointmentDatePickerOpen(false);
              }} /> : null}
            </div>
          </FormField>
          <div className="relative"><FormField label="Horário"><ClinicTimePicker openingTime={openingTime} closingTime={closingTime} latestTime={allowAppointmentsOutsideHours ? undefined : latestAppointmentStart(closingTime)} allowOutsideHours={allowAppointmentsOutsideHours} value={appointmentTime} invalid={invalidAppointmentFields.has("time")} onChange={(value) => { setAppointmentTime(value); clearAppointmentField("time"); }} /></FormField><input name="time" type="hidden" value={appointmentTime} required /></div>
          <FormField label="Profissional"><AnimatedOptionSelect name="professional" options={professionalChoices} placeholder={professionalLoading ? "Carregando profissionais..." : professionalChoices.length ? "Selecione o profissional" : "Nenhum profissional cadastrado"} disabled={professionalLoading || !professionalChoices.length} invalid={invalidAppointmentFields.has("professional")} onChange={() => clearAppointmentField("professional")} /></FormField>
          <div className="sm:col-span-2"><FormField label="Tipo de consulta"><AnimatedOptionSelect name="procedure" options={appointmentTypeOptions} placeholder="Selecione o tipo de consulta" invalid={invalidAppointmentFields.has("procedure")} onChange={() => clearAppointmentField("procedure")} /></FormField></div>
          {appointmentFormError ? <p role="alert" className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{appointmentFormError}</p> : null}
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button disabled={isSaving || professionalLoading || !professionalChoices.length || !selectedPatientId} type="submit">{isSaving || professionalLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{isSaving ? "Salvando..." : professionalLoading ? "Carregando dados..." : "Criar agendamento"}</Button></div>
        </form>
      </Modal>
      <Modal open={Boolean(deleteTarget)} onClose={() => { if (!deleteSaving) setDeleteTarget(null); }} title="Excluir agendamento" description="Essa ação removerá o agendamento da agenda.">
        <div className="space-y-4"><p className="rounded-[7px] bg-[#fff7f7] px-3 py-3 text-xs font-semibold leading-5 text-[#7e3b43]">Tem certeza que deseja excluir o agendamento de <strong>{deleteTarget?.patient}</strong> às <strong>{deleteTarget?.time}</strong>? Você poderá desfazer pelo aviso exibido após a exclusão.</p><div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={deleteSaving} onClick={() => setDeleteTarget(null)}>Cancelar</Button><Button type="button" className="bg-[#b42318] hover:bg-[#991b1b]" disabled={deleteSaving} onClick={() => void deleteAppointment()}>{deleteSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{deleteSaving ? "Excluindo..." : "Excluir agendamento"}</Button></div></div>
      </Modal>
      {anamnesisGate.gate}
      {materialCheck ? <MaterialCheckModal appointmentId={materialCheck.id} onClose={() => setMaterialCheck(null)} onDone={(message) => { invalidateClientCache(`/api/patients/${materialCheck.patientId}/history`); setMaterialCheck(null); onSaved?.(message); }} /> : null}
    </div>
  );
}

type CalendarView = "Dia" | "Semana" | "Mês";

function ScheduleCalendar({ appointments, date, view, focusTime, openingTime, closingTime, allowOutsideHours, loading, openMenuId, onMenuToggle, onAdvance, onMissed, onCancel, onDelete, onSelect, appointmentToleranceMinutes, updatingId }: { appointments: AppointmentRow[]; date: Date; view: CalendarView; focusTime?: string; openingTime: string; closingTime: string; allowOutsideHours: boolean; loading: boolean; openMenuId: string | null; onMenuToggle: (id: string) => void; onAdvance: (appointment: AppointmentRow) => void; onMissed: (appointment: AppointmentRow) => void; onCancel: (appointment: AppointmentRow) => void; onDelete: (appointment: AppointmentRow) => void; onSelect: (appointment: AppointmentRow) => void; appointmentToleranceMinutes: number; updatingId: string | null }) {
  const [now, setNow] = useState(() => clinicNow());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(clinicNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const firstHour = allowOutsideHours ? 0 : Math.floor(appointmentMinutes(openingTime) / 60);
  const lastHour = allowOutsideHours ? 23 : Math.max(firstHour + 1, Math.ceil(appointmentMinutes(closingTime) / 60));
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

  const days = view === "Dia" ? [date] : getWeekDays(date);
  return (
    <div ref={calendarRef} className="hp-calendar-tab-enter max-h-[720px] overflow-auto rounded-[8px] border border-[#e7e9f2] bg-white shadow-[0_8px_28px_rgba(38,39,58,0.035)]">
      <div className="min-w-[760px]">
        <div className={cn("grid border-b border-[#ececf3] bg-[#fbfbfe]", view === "Dia" ? "grid-cols-[64px_minmax(300px,1fr)]" : "grid-cols-[64px_repeat(7,minmax(130px,1fr))]")}>
          <div className="border-r border-[#ececf3]" />
          {days.map((day) => <CalendarDayHeader key={calendarDateKey(day)} date={day} />)}
          {view === "Dia" ? <div className="hidden" /> : null}
        </div>
        <div className={cn("grid", view === "Dia" ? "grid-cols-[64px_minmax(300px,1fr)]" : "grid-cols-[64px_repeat(7,minmax(130px,1fr))]")}>
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
  const canRun = useCan("appointment:run");
  const canDelete = useCan("appointments:delete");
  const tone = appointmentTone(appointment);
  const past = appointmentHasPassed(appointment);
  const isCompleted = appointment.status === "Atendido";
  const isMissed = appointment.status === "Faltou";
  const isCancelled = appointment.status === "Cancelado";
  const canStart = appointment.status !== "Agendado" || appointmentCanStart(appointment, appointmentToleranceMinutes);
  const showStatusGroup = !isCompleted && !isMissed && !isCancelled && (canRun || !(runningAppointmentStatuses as readonly string[]).includes(appointment.status));
  const showWhatsapp = appointment.status === "Agendado";
  const hasMenu = canRun || showStatusGroup || showWhatsapp;
  const primaryLabel = appointment.status === "Em atendimento" ? "Finalizar" : isCompleted ? "Concluído" : isMissed ? "Faltou" : "Atender";
  return <div className={cn("group absolute z-10 cursor-pointer overflow-hidden rounded-[7px] border-l-[3px] p-2 text-[10px] shadow-[0_4px_12px_rgba(38,39,58,0.06)]", tone.card, past && "brightness-[0.84] saturate-[0.78]")} style={{ top, height, left: `calc(${column} * 100% / ${columns} + 4px)`, width: `calc(100% / ${columns} - 8px)` }} aria-label={`${appointment.procedure} - status: ${appointment.status}`} onClick={() => onSelect(appointment)}>
    <span className="pointer-events-none absolute -top-7 left-2 z-40 hidden whitespace-nowrap rounded-[5px] bg-[#303144] px-2 py-1 text-[10px] font-bold text-white shadow-lg group-hover:block">Status: {appointment.status}</span>
    <div className="flex items-start justify-between gap-1"><div className="min-w-0"><p className="truncate font-bold">{appointment.time} - {formatEndTime(appointment.time, appointment.durationMinutes)}</p><div className="mt-1 flex min-w-0 items-center gap-1"><ProcedureImage name={appointment.procedure} decorative className="h-5 w-5 rounded-sm" /><p className="truncate text-[11px] font-black">{appointment.procedure}</p></div><p className="mt-0.5 truncate opacity-80">{appointment.patient}</p></div><div className="relative shrink-0">{hasMenu ? <button type="button" className="grid h-6 w-6 place-items-center rounded-full transition hover:bg-black/5" aria-label={`Ações de ${appointment.procedure}`} onClick={(event) => { event.stopPropagation(); onMenuToggle(appointment.id); }}><MoreVertical className="h-3.5 w-3.5" /></button> : null}{hasMenu && open ? <div className="absolute right-0 top-7 z-30 w-36 rounded-[7px] border border-[#e5e5ee] bg-white p-1 text-left shadow-xl" onClick={(event) => event.stopPropagation()}>{canRun ? <button className="block w-full rounded-[5px] px-2 py-1.5 text-[10px] font-bold text-[#454659] hover:bg-[#f5f4ff] disabled:opacity-50" disabled={isCompleted || isMissed || isCancelled || updating || !canStart} onClick={() => { onAdvance(appointment); onMenuToggle(appointment.id); }}>{updating ? "Atualizando..." : primaryLabel}</button> : null}{showStatusGroup ? <><button className="block w-full rounded-[5px] px-2 py-1.5 text-[10px] font-bold text-[#b42318] hover:bg-[#fff1f0] disabled:opacity-50" disabled={updating} onClick={() => { onMissed(appointment); onMenuToggle(appointment.id); }}>Marcar como faltou</button><button className="block w-full rounded-[5px] px-2 py-1.5 text-[10px] font-bold text-[#b42318] hover:bg-[#fff1f0] disabled:opacity-50" disabled={updating} onClick={() => { onCancel(appointment); onMenuToggle(appointment.id); }}>Cancelar agendamento</button>{canDelete ? <button className="block w-full rounded-[5px] px-2 py-1.5 text-[10px] font-bold text-[#8d1c26] hover:bg-[#fff1f0] disabled:opacity-50" disabled={updating} onClick={() => { onDelete(appointment); onMenuToggle(appointment.id); }}>Excluir agendamento</button> : null}</> : null}{showWhatsapp ? <button type="button" className="block w-full rounded-[5px] px-2 py-1.5 text-[10px] font-bold text-[#454659] disabled:opacity-50" disabled title="Confirmação por WhatsApp em breve">Confirmar por WhatsApp</button> : null}</div> : null}</div></div>
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
  return Array.from({ length: 7 }, (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index));
}

function calendarDateKey(date: Date | string) {
  if (typeof date === "string") return date.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftCalendarDate(date: Date, view: CalendarView, amount: number) {
  const [year, month, day] = shiftAgendaDay(calendarDateKey(date), view, amount).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function calendarPeriodLabel(date: Date, view: CalendarView) {
  if (view === "Dia") return capitalizeFirst(new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(date));
  if (view === "Semana") { const days = getWeekDays(date); return capitalizeFirst(`${new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(days[0])} de ${days[0].getFullYear()}`); }
  return capitalizeFirst(new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date));
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
  // "Procedimento - …" (criado pela sessão) é sempre procedimento, mesmo que o nome contenha termos do catálogo.
  if (appointment.procedure.trim().startsWith("Procedimento - ")) return { card: "border-[#e0647d] bg-[#fff0f2] text-[#9b3a4f]", pill: "bg-[#ffe0e5] text-[#a8465b]" };
  if (value.includes("avalia")) return { card: "border-[#3d9be9] bg-[#eaf5ff] text-[#175b91]", pill: "bg-[#d7edff] text-[#2672ad]" };
  if (value.includes("consulta") || value.includes("retorno")) return { card: "border-[#6257e8] bg-[#f0eeff] text-[#3f36a9]", pill: "bg-[#e3dfff] text-[#5147dc]" };
  if (["preenchimento", "toxina", "bioestimul", "fio", "peeling", "microagul", "laser", "skin", "limpeza"].some((term) => value.includes(term))) return { card: "border-[#35ae78] bg-[#eaf8ef] text-[#247750]", pill: "bg-[#d7f1df] text-[#287a50]" };
  return { card: "border-[#e0647d] bg-[#fff0f2] text-[#9b3a4f]", pill: "bg-[#ffe0e5] text-[#a8465b]" };
}

type ApiProcedure = { id: string; name: string; category?: string; price: number; durationMinutes: number; materialsNeedReview: boolean; catalogItemId?: string | null; image?: { kind: string; url: string | null } | null; technicalSheet: TechnicalSheetItem[] };
type ProcedureRow = Procedure & EditableProcedure;

function mapApiProcedures(procedures: ApiProcedure[] = []): ProcedureRow[] {
  return procedures.map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    duration: `${item.durationMinutes} min`,
    durationMinutes: item.durationMinutes,
    materials: describeTechnicalSheet(item.technicalSheet),
    technicalSheet: item.technicalSheet,
    materialsNeedReview: item.materialsNeedReview,
    catalogItemId: item.catalogItemId ?? null,
    imageUrl: item.image?.url ?? null,
  }));
}

export function ProceduresSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const cachedProcedures = readClientCache<{ procedures?: ApiProcedure[] }>("/api/procedures");
  const cachedProducts = readClientCache<{ products?: Product[] }>("/api/products");
  const [procedureRows, setProcedureRows] = useState<ProcedureRow[]>(() => mapApiProcedures(cachedProcedures?.procedures));
  const [productRows, setProductRows] = useState<Product[]>(cachedProducts?.products ?? []);
  // Quem abriu o modal (Novo procedimento ou Editar); o foco volta para lá ao fechar.
  const openerRef = useRef<HTMLElement | null>(null);
  const [editingProcedureId, setEditingProcedureId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!cachedProcedures);
  const editingProcedure = editingProcedureId === null ? null : procedureRows.find((procedure) => procedure.id === editingProcedureId) ?? null;
  const procedureModalOpen = openCreate || Boolean(editingProcedure);
  const [procedureModalMounted, setProcedureModalMounted] = useState(procedureModalOpen);
  const [procedureModalKey, setProcedureModalKey] = useState("new-procedure");
  const materialOptions = productRows.filter((product): product is Product & { id: string } => Boolean(product.id));

  useEffect(() => {
    if (procedureModalOpen || !procedureModalMounted) return;
    const timeout = window.setTimeout(() => setProcedureModalMounted(false), 320);
    return () => window.clearTimeout(timeout);
  }, [procedureModalOpen, procedureModalMounted]);

  async function loadProcedures() {
    setIsLoading(true);
    // Só chamado depois de salvar com sucesso. O catálogo muda a marca "Já cadastrado".
    invalidateClientCache("/api/procedures", procedureCatalogCacheKey, "/api/quotes/options", "/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    const data = await getCachedJson<{ procedures?: ApiProcedure[] }>("/api/procedures");
    setProcedureRows(mapApiProcedures(data.procedures));
    setIsLoading(false);
  }

  useEffect(() => {
    let active = true;
    getCachedJson<{ procedures?: ApiProcedure[] }>("/api/procedures")
      .then((data) => {
        if (!active) return;
        setProcedureRows(mapApiProcedures(data.procedures));
        setIsLoading(false);
      })
      .catch(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // Inclui arquivados para mostrar na ficha técnica os materiais que já estavam nela.
    getCachedJson<{ products?: Product[] }>("/api/products?archived=1")
      .then((data) => setProductRows(data.products ?? []))
      .catch(() => setProductRows([]));
  }, []);

  function closeProcedureModal() {
    setProcedureModalMounted(true);
    setEditingProcedureId(null);
    onCreateClose();
    const opener = openerRef.current;
    // Depois do desmonte do diálogo; se o elemento sumiu (tabela recarregada), foca o botão Novo procedimento.
    setTimeout(() => {
      const target = opener?.isConnected ? opener : Array.from(document.querySelectorAll<HTMLElement>("main button, [data-hp-title] button")).find((button) => button.textContent?.trim() === "Novo procedimento");
      target?.focus();
    }, 50);
  }

  async function handleProcedureSaved(name: string, created: boolean) {
    await loadProcedures();
    onSaved?.(`${name} ${created ? "foi adicionado aos procedimentos" : "foi atualizado"}.`);
    closeProcedureModal();
  }

  function editProcedure(procedureId: string) {
    setProcedureModalKey(`edit-${procedureId}`);
    setProcedureModalMounted(true);
    onCreateClose();
    setEditingProcedureId(procedureId);
  }

  return (
    <div className="space-y-8">
      <div>
        <SectionIntro
          title="Procedimentos"
          description="Cadastro de serviços com valor sugerido, tempo estimado e a ficha técnica de materiais e produtos usada no estoque e no orçamento."
          action="Novo procedimento"
          onAction={() => { setProcedureModalKey("new-procedure"); setProcedureModalMounted(true); openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; onCreateOpen?.(); }}
        />
        {isLoading ? <LoadingTable columns={5} /> : <MiniTable
          columns={["Nome", "Valor sugerido", "Tempo", "Ficha técnica", "Ação"]}
          rows={procedureRows.map((procedure) => [
            <span className="flex min-w-0 items-center gap-2" key={`name-${procedure.id}`}><ProcedureImage name={procedure.name} imageUrl={procedure.imageUrl} decorative className="h-8 w-8 rounded" /><strong className="min-w-0 truncate py-0.5 text-sm font-semibold text-foreground" title={procedure.name}>{procedure.name}</strong></span>,
            <span className="inline-flex rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-foreground" key={`price-${procedure.id}`}>{currency.format(procedure.price)}</span>,
            <span className="inline-flex whitespace-nowrap rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium tabular-nums text-foreground" key={`duration-${procedure.id}`}>{procedure.duration}</span>,
            <div className="w-full min-w-[190px] max-w-[300px] space-y-1.5" key={`sheet-${procedure.id}`}>
              {procedure.technicalSheet.length ? procedure.technicalSheet.map((material, materialIndex) => (
                <div className="flex min-w-0 items-center gap-1.5" key={`${material.productId}-${materialIndex}`}>
                  <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground" title={material.name}>{material.name}</span>
                  <span className="shrink-0 whitespace-nowrap rounded-md bg-accent px-2 py-1.5 text-xs font-semibold tabular-nums text-accent-foreground">
                    {quantityFormat.format(material.quantity)} {material.unit === "unidade" ? "Un" : material.unit}
                  </span>
                </div>
              )) : <span className="text-xs text-muted-foreground">Sem materiais</span>}
              {procedure.materialsNeedReview ? <Badge variant="amber" title="Convertida automaticamente do texto antigo. Confira as quantidades e salve.">Revisar ficha</Badge> : null}
            </div>,
            <Button key={`edit-${procedure.id}`} size="sm" variant="secondary" onClick={(event) => { setProcedureModalKey(`edit-${procedure.id}`); setProcedureModalMounted(true); openerRef.current = event.currentTarget; setEditingProcedureId(procedure.id); }}>
              <PencilLine className="h-3.5 w-3.5" />
              Editar
            </Button>,
          ])}
        />}
      </div>

      {procedureModalMounted ? (
        <ProcedureFormModal
          key={procedureModalKey}
          open={procedureModalOpen}
          editing={editingProcedure}
          procedures={procedureRows}
          materials={materialOptions}
          onClose={closeProcedureModal}
          onEdit={editProcedure}
          onSaved={handleProcedureSaved}
        />
      ) : null}
    </div>
  );
}

export function QuotesSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  type ApiQuote = { id: string; items: string; total: number; status: string; expires: string | null; createdAt?: string; patient?: { name: string } | null };
  type QuoteRow = Quote & { createdAt?: string };
  type QuoteOptions = { procedures?: Array<{ id: string; name: string; price: number; image?: { url: string | null } | null }>; costs?: { laborCost: number; facilityCost: number; medicationCost: number } };
  const cachedQuotes = readClientCache<{ quotes?: ApiQuote[] }>("/api/quotes");
  const cachedQuoteOptions = readClientCache<QuoteOptions>("/api/quotes/options");
  const [quoteRows, setQuoteRows] = useState<QuoteRow[]>(() => (cachedQuotes?.quotes ?? []).map((item) => ({ id: item.id, patient: item.patient?.name ?? "Paciente", items: item.items, total: currency.format(item.total), status: item.status, expires: item.expires ? new Date(item.expires).toLocaleDateString("pt-BR") : "Sem validade", createdAt: item.createdAt })));
  const [isLoading, setIsLoading] = useState(!cachedQuotes);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedQuotePatient, setSelectedQuotePatient] = useState<LookupPatient | null>(null);
  const [quoteProcedures, setQuoteProcedures] = useState(cachedQuoteOptions?.procedures ?? []);
  const [quoteCosts, setQuoteCosts] = useState(cachedQuoteOptions?.costs ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 });
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
      setQuoteProcedures(data.procedures ?? []);
      setQuoteCosts(data.costs ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 });
      setOptionsLoading(false);
    }).catch(() => setOptionsLoading(false));
  }, []);

  // Pesquisa de paciente sob demanda no servidor (nome ou CPF), em vez de carregar todos os pacientes nas opções.
  const quotePatientLookup = usePatientLookup(patientQuery, !selectedPatientId);
  const matchingQuotePatients = quotePatientLookup.patients;
  // Somado em centavos inteiros: preços têm centavos e 0,1 + 0,2 não pode acumular erro de ponto flutuante.
  const procedureSubtotal = selectedProcedureNames.reduce((total, name) => total + Math.round((quoteProcedures.find((procedure) => procedure.name === name)?.price ?? 0) * 100), 0) / 100;
  const clinicCostsTotal = quoteCosts.laborCost + quoteCosts.facilityCost + quoteCosts.medicationCost;
  const suggestedTotal = Math.round(procedureSubtotal * 100 + clinicCostsTotal * 100) / 100;
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
    event.preventDefault(); setIsSaving(true); const form = new FormData(event.currentTarget); const patient = selectedQuotePatient?.id === selectedPatientId ? selectedQuotePatient.name : "Paciente";
    const response = await fetch("/api/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: selectedPatientId, items: String(form.get("items")), total: parseCurrency(form.get("total")), expires: String(form.get("expires")) }) });
    setIsSaving(false);
    if (!response.ok) return;
    const data = await response.json() as { quote: { id: string; items: string; total: number; status: string; expires: string | null; patient?: { name: string } | null } };
    const item = data.quote;
    invalidateClientCache("/api/quotes", "/api/patients", `/api/patients/${selectedPatientId}/history`, "/api/dashboard/bootstrap");
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
        description="Propostas associadas ao paciente, com os preços dos procedimentos e os custos padrão definidos na Calculadora."
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
              <input className={fieldClassName} name="patientSearch" placeholder="Pesquise por nome ou CPF" required value={patientQuery} onChange={(event) => { setPatientQuery(event.target.value); setSelectedPatientId(""); }} />
            </FormField>
            {patientQuery && !selectedPatientId ? <div className="absolute left-0 right-0 top-[68px] z-20 max-h-44 overflow-auto rounded-[7px] border border-[#e5e5ee] bg-white p-1 shadow-xl">
              {matchingQuotePatients.length ? matchingQuotePatients.map((patient) => <button className="flex w-full items-center justify-between rounded-[5px] px-3 py-2 text-left text-xs transition hover:bg-[#f5f4ff]" key={patient.id} type="button" onClick={() => { setSelectedQuotePatient(patient); setSelectedPatientId(patient.id); setPatientQuery(`${patient.name}${patient.cpf ? ` · ${patient.cpf}` : ""}`); }}><span className="font-bold text-[#303144]">{patient.name}</span><span className="text-[10px] text-[#858696]">{patient.cpf || "CPF não informado"}</span></button>) : <p className="px-3 py-2 text-xs text-[#858696]">{quotePatientLookup.tooShort ? "Digite pelo menos 2 letras." : quotePatientLookup.loading ? "Buscando pacientes..." : quotePatientLookup.error ? "Não foi possível buscar pacientes." : "Nenhum paciente encontrado."}</p>}
            </div> : null}
            {selectedPatientId ? <p className="mt-1 text-[10px] font-semibold text-[#5147dc]">Paciente selecionado: {selectedQuotePatient?.name}</p> : null}
          </div>
          <FormField label="Validade"><MaskedInput className={fieldClassName} formatter={formatDate} name="expires" inputMode="numeric" maxLength={10} placeholder="30/09/2026" required /></FormField>
          <div className="sm:col-span-2"><FormField label="Procedimentos"><div className="flex min-h-10 flex-wrap gap-1.5 rounded-[7px] border border-[#dddfea] bg-white p-2">{selectedProcedureNames.map((name) => <span className="flex items-center gap-1 rounded-full bg-[#f0efff] py-1 pl-1 pr-2 text-[10px] font-bold text-[#5147dc]" key={name}><ProcedureImage name={name} imageUrl={quoteProcedures.find((procedure) => procedure.name === name)?.image?.url ?? null} decorative className="h-6 w-6 rounded-full" />{name}<button className="ml-0.5 text-[#5147dc] hover:text-[#b42318]" type="button" onClick={() => setSelectedProcedureNames((current) => current.filter((item) => item !== name))}>×</button></span>)}<select className="min-w-[150px] flex-1 bg-transparent text-sm font-semibold text-[#858696] outline-none" value="" disabled={optionsLoading || !quoteProcedures.length} onChange={(event) => { if (event.target.value) setSelectedProcedureNames((current) => current.includes(event.target.value) ? current : [...current, event.target.value]); }}><option value="">{optionsLoading ? "Carregando procedimentos..." : quoteProcedures.length ? "Adicionar procedimento" : "Nenhum procedimento cadastrado"}</option>{quoteProcedures.map((procedure) => <option key={procedure.id} value={procedure.name}>{procedure.name} · {currency.format(procedure.price)}</option>)}</select></div><input className="sr-only" name="items" value={selectedProcedureNames.join(", ")} readOnly required /></FormField></div>
          <div className="sm:col-span-2"><FormField label="Valor total"><MaskedInput key={selectedProcedureNames.join("|")} className={fieldClassName} formatter={formatCurrency} name="total" inputMode="decimal" defaultValue={suggestedTotal ? currency.format(suggestedTotal) : ""} placeholder="R$ 0,00" required /></FormField><p className="mt-1 text-[10px] text-[#858696]">Inclui {currency.format(procedureSubtotal)} em procedimentos e {currency.format(clinicCostsTotal)} em custos padrão da Calculadora.</p></div>
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
  const [paymentPatientQuery, setPaymentPatientQuery] = useState("");
  const [paymentPatient, setPaymentPatient] = useState<LookupPatient | null>(null);
  const paymentLookup = usePatientLookup(paymentPatientQuery, !paymentPatient);
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
    event.preventDefault(); setIsSaving(true); const form = new FormData(event.currentTarget); const patientId = paymentPatient?.id ?? ""; const patient = paymentPatient?.name ?? "Paciente";
    const response = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, value: parseCurrency(form.get("value")), method: String(form.get("method")), status: String(form.get("status")), installments: String(form.get("installments")) }) });
    setIsSaving(false);
    if (!response.ok) return;
    const data = await response.json() as { payment: { id: string; value: number; method: string; date: string; status: string; installments: string; patient?: { name: string } | null } };
    const item = data.payment;
    invalidateClientCache("/api/payments", "/api/dashboard/bootstrap");
    setPaymentRows((current) => [{ id: item.id, patient: item.patient?.name ?? patient, value: currency.format(item.value), method: item.method, date: new Date(item.date).toLocaleDateString("pt-BR"), dateRaw: item.date, status: item.status, installments: item.installments }, ...current]);
    setPaymentPatient(null); setPaymentPatientQuery("");
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
          return <Button
            aria-pressed={selected}
            className="h-10"
            key={method}
            onClick={() => setMethodFilter(selected ? "Todos" : method)}
            size="default"
            type="button"
            variant={selected ? "primary" : "secondary"}
          >
            <CircleDollarSign className="h-4 w-4" />
            {method}
            {selected ? <Check className="h-4 w-4" /> : null}
          </Button>;
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
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button disabled={isSaving || !paymentPatient} type="submit">{isSaving ? "Salvando..." : "Registrar pagamento"}</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function ReportsSection() {
  const data = useFinancialData();
  const received = data?.payments.filter((item) => item.status === "Pago").reduce((sum, item) => sum + item.value, 0) ?? 0;
  const pending = data?.payments.filter((item) => item.status !== "Pago").reduce((sum, item) => sum + item.value, 0) ?? 0;
  const mostPerformed = Object.entries((data?.appointments ?? []).reduce<Record<string, number>>((result, item) => { result[item.procedure] = (result[item.procedure] ?? 0) + 1; return result; }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Sem dados";
  const reportItems = [
    { label: "Receita por período", amount: received },
    { label: "Resultado por período", amount: received },
    { label: "Procedimento mais realizado", text: mostPerformed },
    { label: "Pagamentos pendentes", amount: pending },
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
            <p className="mt-3 text-xl font-black text-[#121733]">{item.amount === undefined ? item.text : <CountUp value={item.amount} format={currency.format} />}</p>
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

type TeamMember = { id: string; role: string; isOwner: boolean; laborCostCents: number | null; user: { id: string; name: string; email: string; createdAt: string } };

function SettingsToggle({ label, description, checked, onChange, disabled = false, saving = false, hidden = false }: { label: string; description: string; checked: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; saving?: boolean; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <div className={cn("my-1 flex items-center justify-between gap-4 rounded-md border-b border-border/70 bg-muted/30 px-3 py-3 last:border-b-0", disabled && "opacity-70")}>
      <div className="group relative min-w-0">
        <p tabIndex={0} className="w-fit cursor-help text-sm font-semibold text-foreground outline-none focus-visible:underline">{label}<span aria-hidden="true" className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-64 rounded-lg border border-border bg-popover px-3 py-2 text-xs font-normal leading-5 text-popover-foreground opacity-0 shadow-xl transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 -translate-y-1">{description}</span></p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={cn("min-w-14 text-right text-[11px] font-semibold", checked ? "text-primary" : "text-muted-foreground")}>{saving ? "Salvando" : checked ? "Ativado" : "Desativado"}</span>
        <button className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2", checked ? "bg-primary" : "bg-muted-foreground/35", (disabled || saving) && "cursor-not-allowed opacity-60")} type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled || saving} onClick={() => onChange?.(!checked)}>
        <span className={cn("absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out", checked ? "translate-x-5" : "translate-x-0")} />
      </button>
      </div>
    </div>
  );
}

function Time24Input({ name, label, value, onChange }: { name: string; label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value.split(":") : ["08", "00"];
  const [draftHour, setDraftHour] = useState(current[0]);
  const [draftMinute, setDraftMinute] = useState(current[1]);
  const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
  const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function updateValue(rawValue: string) {
    const digits = rawValue.replace(/\D/g, "").slice(0, 4);
    onChange(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits);
  }

  return (
    <div className="relative" ref={rootRef}>
      <input
        aria-label={`${label} (formato 24 horas)`}
        autoComplete="off"
        className={cn(fieldClassName, "pr-10")}
        inputMode="numeric"
        maxLength={5}
        name={name}
        onChange={(event) => updateValue(event.target.value)}
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
        placeholder="HH:MM"
        required
        type="text"
        value={value}
      />
      <button
        aria-label={`Escolher horário de ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => {
          const selected = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value.split(":") : ["08", "00"];
          setDraftHour(selected[0]);
          setDraftMinute(selected[1]);
          setOpen((currentOpen) => !currentOpen);
        }}
        type="button"
      >
        <Clock3 aria-hidden="true" className="h-4 w-4" />
      </button>
      {open ? (
        <div className="hp-clock-popover-enter absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2.5rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_16px_40px_rgba(20,20,40,0.2)]" role="dialog" aria-label={`Selecionar horário de ${label}`}>
          <div className="flex items-center justify-between border-b border-border/70 bg-muted/30 px-4 py-3">
            <div><p className="text-sm font-bold text-foreground">Escolher horário</p><p className="mt-0.5 text-[11px] text-muted-foreground">Formato de 24 horas</p></div>
            <span className="rounded-lg bg-primary/10 px-3 py-1.5 font-mono text-base font-bold tabular-nums text-primary">{draftHour}:{draftMinute}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 p-3">
            {[{ title: "Hora", values: hours, selected: draftHour, onSelect: setDraftHour }, { title: "Minuto", values: minutes, selected: draftMinute, onSelect: setDraftMinute }].map((column) => (
              <div className="min-w-0" key={column.title}>
                <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{column.title}</p>
                <div className="max-h-44 overflow-y-auto rounded-lg bg-muted/30 p-1 [scrollbar-width:thin]" role="listbox" aria-label={column.title}>
                  {column.values.map((option) => <button aria-selected={column.selected === option} className={cn("mb-0.5 block w-full rounded-md px-3 py-1.5 text-left font-mono text-sm tabular-nums transition last:mb-0", column.selected === option ? "bg-primary font-bold text-primary-foreground shadow-sm" : "text-foreground hover:bg-accent")} key={option} onClick={() => column.onSelect(option)} role="option" type="button">{option}</button>)}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end border-t border-border/70 bg-muted/20 px-3 py-2">
            <button className="rounded-md bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition hover:bg-primary/90" onClick={() => { onChange(`${draftHour}:${draftMinute}`); setOpen(false); }} type="button">Usar horário</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SettingsSection({ isOwner = false, clinicName, onClinicNameChange, onRolePermissionsChange }: { isOwner?: boolean; clinicName?: string; onClinicNameChange?: (name: string) => void; onRolePermissionsChange?: (matrix: RolePermissionMatrix) => void }) {
  const canManageRolePermissions = useCan("settings:permissions");
  const canManageTeam = useCan("settings:team");
  const canManageSettings = useCan("settings:manage");
  const [editing, setEditing] = useState<string | null>(null);
  const [settingsSearch, setSettingsSearch] = useState("");
  const [activeSettingsSection, setActiveSettingsSection] = useState(canManageSettings ? "Dados da clínica" : canManageTeam ? "Custos e orçamento" : "Segurança e permissões");
  const cachedTeam = canManageTeam ? readClientCache<{ members?: TeamMember[] }>("/api/team") : undefined;
  const [members, setMembers] = useState<TeamMember[]>(cachedTeam?.members ?? []);
  const [teamLoading, setTeamLoading] = useState(!cachedTeam);
  const [teamSaving, setTeamSaving] = useState(false);
  const [newMemberCpf, setNewMemberCpf] = useState("");
  const [newMemberPostalCode, setNewMemberPostalCode] = useState("");
  const [newMemberAddress, setNewMemberAddress] = useState("");
  const [newMemberCountry, setNewMemberCountry] = useState("");
  const [newMemberState, setNewMemberState] = useState("");
  const [newMemberCity, setNewMemberCity] = useState("");
  const [postalCodeLoading, setPostalCodeLoading] = useState(false);
  const [postalCodeError, setPostalCodeError] = useState("");
  const [laborCostSavingId, setLaborCostSavingId] = useState<string | null>(null);
  const [editingLaborCostId, setEditingLaborCostId] = useState<string | null>(null);
  const [laborCostFeedback, setLaborCostFeedback] = useState<{ message: string; success: boolean } | null>(null);
  const [teamError, setTeamError] = useState("");
  const [memberToChangeRole, setMemberToChangeRole] = useState<TeamMember | null>(null);
  const [roleToChange, setRoleToChange] = useState("PROFESSIONAL");
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleChangeError, setRoleChangeError] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [memberRemoving, setMemberRemoving] = useState(false);
  const [memberRemoveError, setMemberRemoveError] = useState("");
  const cachedRolePermissions = readClientCache<{ matrix: RolePermissionMatrix }>("/api/clinic/role-permissions");
  const [rolePermissionMatrix, setRolePermissionMatrix] = useState<RolePermissionMatrix>(cachedRolePermissions?.matrix ?? createDefaultRolePermissionMatrix());
  const [selectedPermissionRole, setSelectedPermissionRole] = useState<Role | null>(null);
  const [rolePermissionsLoading, setRolePermissionsLoading] = useState(!cachedRolePermissions);
  const [rolePermissionsSaving, setRolePermissionsSaving] = useState(false);
  const [rolePermissionsDirty, setRolePermissionsDirty] = useState(false);
  const [rolePermissionsError, setRolePermissionsError] = useState("");
  const cachedCostSettings = canManageSettings ? readClientCache<{ settings?: { name?: string; cnpj?: string | null; phone?: string | null; email?: string | null; address?: string | null; appointmentNotificationsEnabled: boolean; appointmentNotificationSoundEnabled: boolean; stockNotificationsEnabled: boolean; requireCancellationReason: boolean; autoMarkMissedAppointmentsEnabled: boolean; autoCompleteAppointmentsEnabled: boolean; autoAdvancePatientJourneyEnabled: boolean; allowAppointmentsOutsideHours: boolean; laborCost: number; facilityCost: number; medicationCost: number; appointmentToleranceMinutes: number; openingTime: string; closingTime: string; professionalOpeningTime: string; professionalClosingTime: string; professionalHourlyCost: number } }>("/api/clinic/cost-settings") : undefined;
  const [costSettings, setCostSettings] = useState(() => ({
    laborCost: cachedCostSettings?.settings?.laborCost ?? 0,
    facilityCost: cachedCostSettings?.settings?.facilityCost ?? 0,
    medicationCost: cachedCostSettings?.settings?.medicationCost ?? 0,
    appointmentToleranceMinutes: cachedCostSettings?.settings?.appointmentToleranceMinutes ?? 15,
    openingTime: cachedCostSettings?.settings?.openingTime ?? "08:00",
    closingTime: cachedCostSettings?.settings?.closingTime ?? "19:00",
    professionalOpeningTime: cachedCostSettings?.settings?.professionalOpeningTime ?? "09:00",
    professionalClosingTime: cachedCostSettings?.settings?.professionalClosingTime ?? "18:00",
    professionalHourlyCost: cachedCostSettings?.settings?.professionalHourlyCost ?? 0,
  }));
  const [costSettingsLoading, setCostSettingsLoading] = useState(!cachedCostSettings);
  const [costSettingsSaving, setCostSettingsSaving] = useState(false);
  const [costSettingsError, setCostSettingsError] = useState("");
  const [costSettingsSuccess, setCostSettingsSuccess] = useState("");
  const [appointmentToleranceInput, setAppointmentToleranceInput] = useState(String(costSettings.appointmentToleranceMinutes ?? 15));
  const [openingTimeInput, setOpeningTimeInput] = useState(costSettings.openingTime ?? "08:00");
  const [closingTimeInput, setClosingTimeInput] = useState(costSettings.closingTime ?? "19:00");
  const [clinicNameInput, setClinicNameInput] = useState(cachedCostSettings?.settings?.name ?? clinicName ?? "Harmonize+");
  const [clinicCnpjInput, setClinicCnpjInput] = useState(formatCnpj(cachedCostSettings?.settings?.cnpj ?? ""));
  const [clinicPhoneInput, setClinicPhoneInput] = useState(formatPhone(cachedCostSettings?.settings?.phone ?? ""));
  const [clinicEmailInput, setClinicEmailInput] = useState(cachedCostSettings?.settings?.email ?? "");
  const [clinicAddressInput, setClinicAddressInput] = useState(cachedCostSettings?.settings?.address ?? "");
  const [appointmentNotificationsEnabled, setAppointmentNotificationsEnabled] = useState(cachedCostSettings?.settings?.appointmentNotificationsEnabled ?? true);
  const [appointmentNotificationSoundEnabled, setAppointmentNotificationSoundEnabled] = useState(cachedCostSettings?.settings?.appointmentNotificationSoundEnabled ?? true);
  const [stockNotificationsEnabled, setStockNotificationsEnabled] = useState(cachedCostSettings?.settings?.stockNotificationsEnabled ?? true);
  const [requireCancellationReason, setRequireCancellationReason] = useState(cachedCostSettings?.settings?.requireCancellationReason ?? false);
  const [autoMarkMissedAppointmentsEnabled, setAutoMarkMissedAppointmentsEnabled] = useState(cachedCostSettings?.settings?.autoMarkMissedAppointmentsEnabled ?? true);
  const [autoCompleteAppointmentsEnabled, setAutoCompleteAppointmentsEnabled] = useState(cachedCostSettings?.settings?.autoCompleteAppointmentsEnabled ?? true);
  const [autoAdvancePatientJourneyEnabled, setAutoAdvancePatientJourneyEnabled] = useState(cachedCostSettings?.settings?.autoAdvancePatientJourneyEnabled ?? true);
  const [allowAppointmentsOutsideHours, setAllowAppointmentsOutsideHours] = useState(cachedCostSettings?.settings?.allowAppointmentsOutsideHours ?? false);
  const [savingPreference, setSavingPreference] = useState("");
  const [clinicProfileStatus, setClinicProfileStatus] = useState("");
  const [clinicProfileError, setClinicProfileError] = useState("");
  const [clinicProfileSaving, setClinicProfileSaving] = useState(false);
  const [clinicProfileReady, setClinicProfileReady] = useState(Boolean(cachedCostSettings?.settings));
  const [savedClinicProfile, setSavedClinicProfile] = useState(cachedCostSettings?.settings ? JSON.stringify({ name: cachedCostSettings.settings.name?.trim() ?? "", cnpj: formatCnpj(cachedCostSettings.settings.cnpj ?? ""), phone: formatPhone(cachedCostSettings.settings.phone ?? ""), email: cachedCostSettings.settings.email?.trim() ?? "", address: cachedCostSettings.settings.address?.trim() ?? "", openingTime: cachedCostSettings.settings.openingTime, closingTime: cachedCostSettings.settings.closingTime }) : "");
  const clinicProfile = JSON.stringify({ name: clinicNameInput.trim(), cnpj: clinicCnpjInput.trim(), phone: clinicPhoneInput.trim(), email: clinicEmailInput.trim(), address: clinicAddressInput.trim(), openingTime: openingTimeInput, closingTime: closingTimeInput });

  const persistClinicProfile = useCallback(async (payload: string) => {
    setClinicProfileSaving(true);
    setClinicProfileStatus("Salvando...");
    setClinicProfileError("");
    try {
      const response = await fetch("/api/clinic/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: payload });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Não foi possível salvar os dados da clínica.");
      setSavedClinicProfile(payload);
      onClinicNameChange?.((JSON.parse(payload) as { name: string }).name);
      invalidateClientCache("/api/clinic/cost-settings", "/api/agenda/bootstrap", "/api/appointments/options");
      window.dispatchEvent(new Event("harmonize-notification-settings-updated"));
      setClinicProfileStatus("Dados da clínica salvos.");
    } catch (error) {
      setClinicProfileStatus("");
      setClinicProfileError(error instanceof Error ? error.message : "Não foi possível salvar os dados da clínica.");
    } finally {
      setClinicProfileSaving(false);
    }
  }, [onClinicNameChange]);

  function updateClinicProfileField(setter: (value: string) => void, value: string) {
    setter(value);
    setClinicProfileStatus("");
    setClinicProfileError("");
  }

  async function persistClinicPreference(key: string, enabled: boolean) {
    setSavingPreference(key);
    setCostSettingsError("");
    try {
      const response = await fetch("/api/clinic/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, enabled }) });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Não foi possível salvar esta preferência.");
      invalidateClientCache("/api/clinic/cost-settings", "/api/agenda/bootstrap", "/api/agenda/overdue", "/api/appointments/options", "/api/patients");
      window.dispatchEvent(new Event("harmonize-notification-settings-updated"));
      setCostSettingsSuccess("Preferência atualizada para toda a clínica.");
      return true;
    } catch (error) {
      setCostSettingsError(error instanceof Error ? error.message : "Não foi possível salvar esta preferência.");
      return false;
    } finally {
      setSavingPreference("");
    }
  }

  useEffect(() => {
    if (!canManageTeam) return;
    let active = true;
    getCachedJson<{ members?: TeamMember[] }>("/api/team")
      .then((data) => { if (active) setMembers(data.members ?? []); })
      .catch(() => { if (active) setTeamError("Não foi possível carregar os colaboradores."); })
      .finally(() => { if (active) setTeamLoading(false); });
    return () => { active = false; };
  }, [canManageTeam]);

  useEffect(() => {
    if (!canManageRolePermissions) return;
    let active = true;
    getCachedJson<{ matrix: RolePermissionMatrix }>("/api/clinic/role-permissions")
      .then((data) => { if (active) setRolePermissionMatrix(data.matrix); })
      .catch(() => { if (active) setRolePermissionsError("Não foi possível carregar as permissões dos cargos."); })
      .finally(() => { if (active) setRolePermissionsLoading(false); });
    return () => { active = false; };
  }, [canManageRolePermissions]);

  async function saveRolePermissions() {
    setRolePermissionsSaving(true);
    setRolePermissionsError("");
    try {
      const response = await fetch("/api/clinic/role-permissions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matrix: rolePermissionMatrix }) });
      const data = await response.json().catch(() => null) as { matrix?: RolePermissionMatrix; message?: string } | null;
      if (!response.ok || !data?.matrix) throw new Error(data?.message ?? "Não foi possível salvar as permissões.");
      setRolePermissionMatrix(data.matrix);
      setRolePermissionsDirty(false);
      invalidateClientCache("/api/clinic/role-permissions");
      onRolePermissionsChange?.(data.matrix);
    } catch (error) {
      setRolePermissionsError(error instanceof Error ? error.message : "Não foi possível salvar as permissões.");
    } finally {
      setRolePermissionsSaving(false);
    }
  }

  useEffect(() => {
    if (!canManageSettings) return;
    let active = true;
    getCachedJson<{ settings?: { name?: string; cnpj?: string | null; phone?: string | null; email?: string | null; address?: string | null; appointmentNotificationsEnabled: boolean; appointmentNotificationSoundEnabled: boolean; stockNotificationsEnabled: boolean; requireCancellationReason: boolean; autoMarkMissedAppointmentsEnabled: boolean; autoCompleteAppointmentsEnabled: boolean; autoAdvancePatientJourneyEnabled: boolean; allowAppointmentsOutsideHours: boolean; laborCost: number; facilityCost: number; medicationCost: number; appointmentToleranceMinutes: number; openingTime: string; closingTime: string; professionalOpeningTime: string; professionalClosingTime: string; professionalHourlyCost: number } }>("/api/clinic/cost-settings")
      .then((data) => {
        if (!active) return;
        const settings = data.settings ?? {
          name: undefined,
          appointmentNotificationsEnabled: true,
          appointmentNotificationSoundEnabled: true,
          stockNotificationsEnabled: true,
          requireCancellationReason: false,
          autoMarkMissedAppointmentsEnabled: true,
          autoCompleteAppointmentsEnabled: true,
          autoAdvancePatientJourneyEnabled: true,
          allowAppointmentsOutsideHours: false,
          laborCost: 0,
          facilityCost: 0,
          medicationCost: 0,
          appointmentToleranceMinutes: 15,
          openingTime: "08:00",
          closingTime: "19:00",
          professionalOpeningTime: "09:00",
          professionalClosingTime: "18:00",
          professionalHourlyCost: 0,
        };
        setCostSettings(settings);
        if (settings.name) setClinicNameInput(settings.name);
        setAppointmentToleranceInput(String(settings.appointmentToleranceMinutes));
        setOpeningTimeInput(settings.openingTime ?? "08:00");
        setClosingTimeInput(settings.closingTime ?? "19:00");
        setClinicCnpjInput(formatCnpj(settings.cnpj ?? ""));
        setClinicPhoneInput(formatPhone(settings.phone ?? ""));
        setClinicEmailInput(settings.email ?? "");
        setClinicAddressInput(settings.address ?? "");
        setSavedClinicProfile(JSON.stringify({ name: settings.name?.trim() ?? "", cnpj: formatCnpj(settings.cnpj ?? ""), phone: formatPhone(settings.phone ?? ""), email: settings.email?.trim() ?? "", address: settings.address?.trim() ?? "", openingTime: settings.openingTime ?? "08:00", closingTime: settings.closingTime ?? "19:00" }));
        setClinicProfileReady(true);
        setAppointmentNotificationsEnabled(settings.appointmentNotificationsEnabled ?? true);
        setAppointmentNotificationSoundEnabled(settings.appointmentNotificationSoundEnabled ?? true);
        setStockNotificationsEnabled(settings.stockNotificationsEnabled ?? true);
        setRequireCancellationReason(settings.requireCancellationReason ?? false);
        setAutoMarkMissedAppointmentsEnabled(settings.autoMarkMissedAppointmentsEnabled ?? true);
        setAutoCompleteAppointmentsEnabled(settings.autoCompleteAppointmentsEnabled ?? true);
        setAutoAdvancePatientJourneyEnabled(settings.autoAdvancePatientJourneyEnabled ?? true);
        setAllowAppointmentsOutsideHours(settings.allowAppointmentsOutsideHours ?? false);
      })
      .catch(() => { if (active) setCostSettingsError("Não foi possível carregar as configurações da clínica."); })
      .finally(() => { if (active) setCostSettingsLoading(false); });
    return () => { active = false; };
  }, [canManageSettings]);

  async function saveCostSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCostSettingsSaving(true);
    setCostSettingsError("");
    setCostSettingsSuccess("");
    const form = new FormData(event.currentTarget);
    const nextSettings = {
      laborCost: form.has("laborCost") ? parseCurrency(form.get("laborCost")) : costSettings.laborCost,
      facilityCost: form.has("facilityCost") ? parseCurrency(form.get("facilityCost")) : costSettings.facilityCost,
      medicationCost: form.has("medicationCost") ? parseCurrency(form.get("medicationCost")) : costSettings.medicationCost,
      appointmentToleranceMinutes: parseInteger(appointmentToleranceInput),
      appointmentNotificationsEnabled,
      appointmentNotificationSoundEnabled,
      stockNotificationsEnabled,
      requireCancellationReason,
      professionalHourlyCost: costSettings.professionalHourlyCost,
      professionalOpeningTime: costSettings.professionalOpeningTime,
      professionalClosingTime: costSettings.professionalClosingTime,
      ...(form.has("name") ? { name: String(form.get("name")).trim() } : {}),
      ...(form.has("cnpj") ? { cnpj: String(form.get("cnpj")).trim() } : {}),
      ...(form.has("phone") ? { phone: String(form.get("phone")).trim() } : {}),
      ...(form.has("email") ? { email: String(form.get("email")).trim() } : {}),
      ...(form.has("address") ? { address: String(form.get("address")).trim() } : {}),
      ...(form.has("openingTime") ? { openingTime: String(form.get("openingTime")) } : {}),
      ...(form.has("closingTime") ? { closingTime: String(form.get("closingTime")) } : {}),
    };
    let response: Response;
    try {
      response = await fetch("/api/clinic/cost-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextSettings) });
    } catch {
      setCostSettingsSaving(false);
      setCostSettingsError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
      return;
    }
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
      setCostSettingsError(data.message ?? "Não foi possível salvar as configurações da clínica.");
      return;
    }
    setCostSettingsSuccess("Alterações salvas.");
    setCostSettings((current) => ({
      ...current,
      laborCost: data.settings?.laborCost ?? current.laborCost,
      facilityCost: data.settings?.facilityCost ?? current.facilityCost,
      medicationCost: data.settings?.medicationCost ?? current.medicationCost,
      appointmentToleranceMinutes: data.settings?.appointmentToleranceMinutes ?? current.appointmentToleranceMinutes,
      professionalHourlyCost: data.settings?.professionalHourlyCost ?? current.professionalHourlyCost,
      professionalOpeningTime: data.settings?.professionalOpeningTime ?? current.professionalOpeningTime,
      professionalClosingTime: data.settings?.professionalClosingTime ?? current.professionalClosingTime,
      openingTime: data.settings?.openingTime ?? current.openingTime,
      closingTime: data.settings?.closingTime ?? current.closingTime,
    }));
    if (data.settings?.cnpj !== undefined) setClinicCnpjInput(data.settings.cnpj ?? "");
    if (data.settings?.phone !== undefined) setClinicPhoneInput(data.settings.phone ?? "");
    if (data.settings?.email !== undefined) setClinicEmailInput(data.settings.email ?? "");
    if (data.settings?.address !== undefined) setClinicAddressInput(data.settings.address ?? "");
    setAppointmentNotificationsEnabled(data.settings.appointmentNotificationsEnabled ?? appointmentNotificationsEnabled);
    setAppointmentNotificationSoundEnabled(data.settings.appointmentNotificationSoundEnabled ?? appointmentNotificationSoundEnabled);
    setStockNotificationsEnabled(data.settings.stockNotificationsEnabled ?? stockNotificationsEnabled);
    setRequireCancellationReason(data.settings.requireCancellationReason ?? requireCancellationReason);
    if (data.settings.name) {
      setClinicNameInput(data.settings.name);
      onClinicNameChange?.(data.settings.name);
    }
    invalidateClientCache("/api/clinic/cost-settings", "/api/quotes/options", "/api/agenda/bootstrap", "/api/patients");
    window.dispatchEvent(new Event("harmonize-notification-settings-updated"));
  }

  const professionalLaborCostMembers = members.filter((member) => member.role === "PROFESSIONAL");
  function resetNewCollaboratorContact() {
    setNewMemberCpf("");
    setNewMemberPostalCode("");
    setNewMemberAddress("");
    setNewMemberCountry("");
    setNewMemberState("");
    setNewMemberCity("");
    setPostalCodeError("");
  }
  async function lookupCollaboratorPostalCode() {
    const digits = newMemberPostalCode.replace(/\D/g, "");
    if (digits.length !== 8) {
      setPostalCodeError("Informe um CEP com 8 dígitos.");
      return;
    }
    setPostalCodeLoading(true);
    setPostalCodeError("");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await response.json() as { erro?: boolean; logradouro?: string; complemento?: string; bairro?: string; localidade?: string; uf?: string; estado?: string };
      if (!response.ok || data.erro) {
        setPostalCodeError("CEP não encontrado. Confira o número e tente novamente.");
        return;
      }
      setNewMemberAddress([data.logradouro, data.complemento, data.bairro].filter(Boolean).join(", "));
      setNewMemberCountry("Brasil");
      setNewMemberState(data.estado || data.uf || "");
      setNewMemberCity(data.localidade || "");
    } catch {
      setPostalCodeError("Não foi possível consultar o CEP. Tente novamente.");
    } finally {
      setPostalCodeLoading(false);
    }
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
        body: JSON.stringify({ name: form.get("name"), email: form.get("email"), password: form.get("password"), role: form.get("role"), cpf: newMemberCpf, postalCode: newMemberPostalCode, address: newMemberAddress, country: newMemberCountry, state: newMemberState, city: newMemberCity }),
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
      invalidateClientCache("/api/team", "/api/team/professionals");
      setEditing(null);
      setTeamError("");
      resetNewCollaboratorContact();
    } catch {
      setTeamSaving(false);
      setTeamError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    }
  }

  async function saveProfessionalLaborCost(event: FormEvent<HTMLFormElement>, member: TeamMember) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const laborCostCents = Math.round(parseCurrency(form.get("laborCost")) * 100);
    setLaborCostSavingId(member.id);
    setLaborCostFeedback(null);
    try {
      const response = await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ membershipId: member.id, laborCostCents }) });
      const data = await response.json().catch(() => null) as { member?: TeamMember; message?: string } | null;
      if (!response.ok || !data?.member) throw new Error(data?.message ?? "Não foi possível salvar o valor de mão de obra.");
      setMembers((current) => current.map((item) => item.id === member.id ? data.member! : item));
      setEditingLaborCostId(null);
      invalidateClientCache("/api/team");
      setLaborCostFeedback({ message: `Valor de mão de obra de ${member.user.name} salvo.`, success: true });
    } catch (error) {
      setLaborCostFeedback({ message: error instanceof Error ? error.message : "Não foi possível salvar o valor de mão de obra.", success: false });
    } finally {
      setLaborCostSavingId(null);
    }
  }

  async function saveMemberRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberToChangeRole) return;
    setRoleSaving(true);
    setRoleChangeError("");
    try {
      const response = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId: memberToChangeRole.id, role: roleToChange }),
      });
      const data = await response.json().catch(() => null) as { member?: TeamMember; message?: string } | null;
      if (!response.ok || !data?.member) throw new Error(data?.message ?? "Não foi possível alterar o cargo.");
      setMembers((current) => current.map((member) => member.id === data.member!.id ? data.member! : member));
      invalidateClientCache("/api/team", "/api/team/professionals", "/api/agenda/bootstrap", "/api/appointments/options");
      setMemberToChangeRole(null);
      toast.success("Cargo atualizado com sucesso.");
    } catch (error) {
      setRoleChangeError(error instanceof Error ? error.message : "Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setRoleSaving(false);
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
    invalidateClientCache("/api/team", "/api/team/professionals", "/api/agenda/bootstrap");
    setMemberToRemove(null);
  }

  const settingsNavigation = [
    { label: "Dados da clínica", icon: Building2 },
    { label: "Profissionais e equipe", icon: UsersRound },
    { label: "Agenda e horários", icon: CalendarClock },
    { label: "Custos e orçamento", icon: CircleDollarSign },
    { label: "Notificações", icon: Bell },
    { label: "Segurança e permissões", icon: ShieldCheck },
    { label: "Integrações", icon: PlugZap },
  ];
  const normalizeSettingsSearch = (value: string) => value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalizedSettingsSearch = normalizeSettingsSearch(settingsSearch.trim());
  const hasSettingsSectionPermission = (label: string) => label === "Segurança e permissões" ? canManageRolePermissions : label === "Profissionais e equipe" ? canManageTeam : label === "Custos e orçamento" ? canManageTeam : canManageSettings;
  const permittedSettingsNavigation = settingsNavigation.filter((item) => hasSettingsSectionPermission(item.label));
  const displayedSettingsSection = permittedSettingsNavigation.some((item) => item.label === activeSettingsSection) ? activeSettingsSection : permittedSettingsNavigation[0]?.label ?? "";
  const isSearchingClinicPreferences = displayedSettingsSection === "Dados da clínica" && Boolean(normalizedSettingsSearch);
  const matchesClinicPreference = (text: string) => !isSearchingClinicPreferences || normalizeSettingsSearch(text).includes(normalizedSettingsSearch);
  const clinicPreferenceLabels = ["Alertas de agendamentos", "Alertas de estoque", "Exigir motivo ao cancelar", "Marcar faltas automaticamente", "Finalizar atendimentos automaticamente", "Avançar etapas do paciente automaticamente", "Permitir agendamentos fora do funcionamento"];
  const matchingClinicPreferenceCount = clinicPreferenceLabels.filter(matchesClinicPreference).length;
  const isSearchingTeam = displayedSettingsSection === "Profissionais e equipe" && Boolean(normalizedSettingsSearch);
  const filteredTeamMembers = members.filter((member) => {
    const role = member.isOwner ? "Administrador principal" : member.role === "PROFESSIONAL" ? "Profissional" : member.role === "STAFF" ? "Equipe Atendente" : "Administrador";
    return normalizeSettingsSearch(`${member.user.name} ${member.user.email} ${member.role} ${role}`).includes(normalizedSettingsSearch);
  });
  const visibleSettingsNavigation = settingsNavigation.filter((item) => {
    return hasSettingsSectionPermission(item.label) && (normalizeSettingsSearch(item.label).includes(normalizedSettingsSearch) || (isSearchingClinicPreferences && matchingClinicPreferenceCount > 0 && item.label === "Dados da clínica") || (isSearchingTeam && item.label === "Profissionais e equipe"));
  });
  const settingsSearchPlaceholder: Record<string, string> = {
    "Dados da clínica": "Buscar dados da clínica",
    "Profissionais e equipe": "Buscar profissional ou equipe",
    "Agenda e horários": "Buscar agenda e horários",
    "Custos e orçamento": "Buscar custos e orçamento",
    Notificações: "Buscar notificações",
    "Segurança e permissões": "Buscar segurança e permissões",
    Integrações: "Buscar integrações",
  };
  const searchLabel = settingsSearchPlaceholder[displayedSettingsSection] ?? "Buscar nas configurações";

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">Configurações</h1>
          <p className="mt-1 text-sm text-muted-foreground">Personalize a experiência e o funcionamento da sua clínica.</p>
        </div>
        <label className="relative block w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(fieldClassName, "pl-9")} type="search" aria-label={searchLabel} placeholder={searchLabel} value={settingsSearch} onChange={(event) => setSettingsSearch(event.target.value)} />
        </label>
      </header>

      <div className="grid gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
        <Card className="h-fit border-border/70 p-2.5">
          <nav aria-label="Seções de configurações" className="grid gap-1">
            {visibleSettingsNavigation.map(({ label, icon: Icon }) => (
              <button aria-current={displayedSettingsSection === label ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition-colors", displayedSettingsSection === label ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")} key={label} type="button" onClick={() => setActiveSettingsSection(label)}>
                <Icon className="h-4 w-4 shrink-0" />{label}
              </button>
            ))}
            {visibleSettingsNavigation.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">Nenhuma configuração encontrada.</p> : null}
          </nav>
        </Card>

        <div className="min-w-0 space-y-4">
          {displayedSettingsSection === "Dados da clínica" ? (
            <Card className="border-border/70">
              <CardHeader className="border-b border-border/70"><CardTitle>Dados da clínica</CardTitle><p className="text-sm text-muted-foreground">{isSearchingClinicPreferences ? "Preferências gerais filtradas pela busca." : "Informações básicas e dados de contato da sua clínica."}</p></CardHeader>
              <CardContent className="pt-5">
                {!isSearchingClinicPreferences ? <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); if (!clinicProfileReady || clinicProfileSaving || clinicProfile === savedClinicProfile) return; void persistClinicProfile(clinicProfile); }}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Nome da clínica"><input className={fieldClassName} autoComplete="organization" maxLength={120} name="name" required value={clinicNameInput} onChange={(event) => updateClinicProfileField(setClinicNameInput, event.target.value)} /></FormField>
                    <FormField label="CNPJ"><input className={fieldClassName} autoComplete="off" inputMode="numeric" maxLength={18} name="cnpj" value={clinicCnpjInput} onChange={(event) => updateClinicProfileField(setClinicCnpjInput, formatCnpj(event.target.value))} placeholder="00.000.000/0000-00" /></FormField>
                    <FormField label="Telefone"><input className={fieldClassName} autoComplete="tel" inputMode="tel" maxLength={15} name="phone" type="tel" value={clinicPhoneInput} onChange={(event) => updateClinicProfileField(setClinicPhoneInput, formatPhone(event.target.value))} placeholder="(11) 98765-4321" /></FormField>
                    <FormField label="E-mail"><input className={fieldClassName} autoComplete="email" maxLength={254} name="email" type="email" value={clinicEmailInput} onChange={(event) => updateClinicProfileField(setClinicEmailInput, event.target.value)} /></FormField>
                  </div>
                  <FormField label="Endereço"><input className={fieldClassName} autoComplete="street-address" maxLength={240} name="address" value={clinicAddressInput} onChange={(event) => updateClinicProfileField(setClinicAddressInput, event.target.value)} placeholder="Rua, número, bairro e CEP" /></FormField>
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-bold text-foreground">Horário diário de funcionamento</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">Defina a abertura e o fechamento. A agenda usa esse período como limite para novos atendimentos.</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField label="Abre às"><Time24Input name="openingTime" label="Abre às" value={openingTimeInput} onChange={(value) => updateClinicProfileField(setOpeningTimeInput, value)} /></FormField>
                      <FormField label="Fecha às"><Time24Input name="closingTime" label="Fecha às" value={closingTimeInput} onChange={(value) => updateClinicProfileField(setClosingTimeInput, value)} /></FormField>
                    </div>
                  </div>
                  {clinicProfileError ? <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{clinicProfileError}</p> : null}
                  {clinicProfileStatus ? <p className="text-xs font-medium text-muted-foreground" role="status">{clinicProfileStatus}</p> : null}
                  <div className="flex justify-end border-t border-border/70 pt-4">
                    <Button disabled={!clinicProfileReady || clinicProfileSaving || clinicProfile === savedClinicProfile} type="submit"><Save className="h-4 w-4" />{clinicProfileSaving ? "Salvando..." : "Salvar dados"}</Button>
                  </div>
                </form> : null}
                  <div className={cn("rounded-lg border border-border/70 px-4 py-2", !isSearchingClinicPreferences && "mt-7")}>
                    <h3 className="pt-2 text-sm font-bold text-foreground">Preferências gerais</h3>
                    <p className="mb-2 mt-1 text-xs text-muted-foreground">Configuração para toda a clínica</p>
                    <SettingsToggle hidden={!matchesClinicPreference("Alertas de agendamentos")} label="Alertas de agendamentos" description="Exibe no menu superior os atendimentos que precisam de atenção. A equipe acompanha a agenda sem procurar cada horário manualmente." checked={appointmentNotificationsEnabled} saving={savingPreference === "appointmentNotificationsEnabled"} onChange={(next) => { setAppointmentNotificationsEnabled(next); void persistClinicPreference("appointmentNotificationsEnabled", next).then((ok) => { if (!ok) setAppointmentNotificationsEnabled(!next); }); }} />
                    <SettingsToggle hidden={!matchesClinicPreference("Alertas de estoque")} label="Alertas de estoque" description="Mostra avisos de estoque baixo, vencimentos e pendências para a equipe agir antes que falte material." checked={stockNotificationsEnabled} saving={savingPreference === "stockNotificationsEnabled"} onChange={(next) => { setStockNotificationsEnabled(next); void persistClinicPreference("stockNotificationsEnabled", next).then((ok) => { if (!ok) setStockNotificationsEnabled(!next); }); }} />
                    <SettingsToggle hidden={!matchesClinicPreference("Exigir motivo ao cancelar")} label="Exigir motivo ao cancelar" description="Antes de cancelar um agendamento, a equipe precisa registrar o motivo, ajudando a clínica a entender cancelamentos e manter o histórico completo." checked={requireCancellationReason} saving={savingPreference === "requireCancellationReason"} onChange={(next) => { setRequireCancellationReason(next); void persistClinicPreference("requireCancellationReason", next).then((ok) => { if (!ok) setRequireCancellationReason(!next); }); }} />
                    <SettingsToggle hidden={!matchesClinicPreference("Marcar faltas automaticamente")} label="Marcar faltas automaticamente" description="Após o horário e a tolerância definidos, agendamentos que continuam marcados são atualizados para Faltou." checked={autoMarkMissedAppointmentsEnabled} saving={savingPreference === "autoMarkMissedAppointmentsEnabled"} onChange={(next) => { setAutoMarkMissedAppointmentsEnabled(next); void persistClinicPreference("autoMarkMissedAppointmentsEnabled", next).then((ok) => { if (!ok) setAutoMarkMissedAppointmentsEnabled(!next); }); }} />
                    <SettingsToggle hidden={!matchesClinicPreference("Finalizar atendimentos automaticamente")} label="Finalizar atendimentos automaticamente" description="Quando o horário previsto do atendimento termina, a agenda altera Em atendimento para Atendido." checked={autoCompleteAppointmentsEnabled} saving={savingPreference === "autoCompleteAppointmentsEnabled"} onChange={(next) => { setAutoCompleteAppointmentsEnabled(next); void persistClinicPreference("autoCompleteAppointmentsEnabled", next).then((ok) => { if (!ok) setAutoCompleteAppointmentsEnabled(!next); }); }} />
                    <SettingsToggle hidden={!matchesClinicPreference("Avançar etapas do paciente automaticamente")} label="Avançar etapas do paciente automaticamente" description="A etapa exibida na lista de pacientes acompanha avaliações, orçamentos, procedimentos e retornos registrados no sistema." checked={autoAdvancePatientJourneyEnabled} saving={savingPreference === "autoAdvancePatientJourneyEnabled"} onChange={(next) => { setAutoAdvancePatientJourneyEnabled(next); void persistClinicPreference("autoAdvancePatientJourneyEnabled", next).then((ok) => { if (!ok) setAutoAdvancePatientJourneyEnabled(!next); }); }} />
                    <SettingsToggle hidden={!matchesClinicPreference("Permitir agendamentos fora do funcionamento")} label="Permitir agendamentos fora do funcionamento" description="Libera horários fora da abertura e fechamento configurados, mantendo as validações de data, conflitos e duração do atendimento." checked={allowAppointmentsOutsideHours} saving={savingPreference === "allowAppointmentsOutsideHours"} onChange={(next) => { setAllowAppointmentsOutsideHours(next); void persistClinicPreference("allowAppointmentsOutsideHours", next).then((ok) => { if (!ok) setAllowAppointmentsOutsideHours(!next); }); }} />
                    {isSearchingClinicPreferences && matchingClinicPreferenceCount === 0 ? <p className="py-4 text-sm text-muted-foreground">Nenhuma preferência geral encontrada.</p> : null}
                  </div>
              </CardContent>
            </Card>
          ) : null}

          {displayedSettingsSection === "Profissionais e equipe" ? (
            <Card className="border-border/70">
              <CardHeader className="flex flex-col gap-3 border-b border-border/70 sm:flex-row sm:items-center sm:justify-between">
                <div><CardTitle>Profissionais e equipe</CardTitle><p className="mt-1 text-sm text-muted-foreground">Contas vinculadas à clínica e seus níveis de acesso.</p></div>
                {canManageTeam ? <Button size="sm" onClick={() => { resetNewCollaboratorContact(); setTeamError(""); setEditing("Novo colaborador"); }}><UserPlus className="h-4 w-4" />Novo colaborador</Button> : <span className="text-xs font-semibold text-muted-foreground">Apenas administradores</span>}
              </CardHeader>
              <CardContent className="divide-y divide-border/70 pt-1">
                {teamError && !editing ? <p className="my-4 rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{teamError}</p> : null}
                {teamLoading ? <div className="space-y-3 py-4">{[0, 1, 2].map((item) => <div className="flex items-center justify-between gap-4" key={item}><div className="flex-1 space-y-2"><LoadingSkeleton className="h-3 w-40" /><LoadingSkeleton className="h-2.5 w-56" /></div><LoadingSkeleton className="h-6 w-20 rounded-full" /></div>)}</div> : filteredTeamMembers.length ? filteredTeamMembers.map((member) => (
                  <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between" key={member.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-foreground">{member.user.name}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">{member.user.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={member.isOwner || member.role === "ADMIN" ? "purple" : "green"}>{member.isOwner ? "Administrador principal" : member.role === "PROFESSIONAL" ? "Profissional" : member.role === "STAFF" ? "Equipe" : "Administrador"}</Badge>
                      {canManageTeam && !member.isOwner ? <Button type="button" variant="secondary" size="sm" className="h-7 px-2.5 text-xs" onClick={() => { setRoleToChange(member.role); setRoleChangeError(""); setMemberToChangeRole(member); }}>Alterar cargo</Button> : null}
                      {isOwner && !member.isOwner ? <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={"Remover " + member.user.name} title="Remover colaborador" onClick={() => { setMemberRemoveError(""); setMemberToRemove(member); }}><Trash2 className="h-3.5 w-3.5" /></Button> : null}
                    </div>
                  </div>
                )) : <p className="py-6 text-sm text-muted-foreground">{isSearchingTeam ? "Nenhum profissional ou membro da equipe corresponde à busca." : "Nenhum colaborador cadastrado."}</p>}
              </CardContent>
            </Card>
          ) : null}

          {displayedSettingsSection === "Agenda e horários" ? (
            <Card className="border-border/70">
              <CardHeader className="border-b border-border/70"><CardTitle>Agenda e horários</CardTitle><p className="text-sm text-muted-foreground">Ajuste a tolerância usada para identificar atrasos e faltas.</p></CardHeader>
              <CardContent className="pt-5">
                <form className="space-y-5" onSubmit={saveCostSettings}>
                  <div className="max-w-sm">
                    <FormField label="Tolerância para marcar falta (minutos)"><input className={fieldClassName} name="appointmentToleranceMinutes" type="number" min="0" max="180" value={appointmentToleranceInput} onChange={(event) => setAppointmentToleranceInput(event.target.value)} required /></FormField>
                    <p className="mt-1 text-xs text-muted-foreground">A agenda e o histórico do paciente usam este limite para identificar atrasos e faltas.</p>
                  </div>
                  {costSettingsError ? <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{costSettingsError}</p> : null}
                  {costSettingsSuccess ? <p className="text-sm font-medium text-success" role="status">{costSettingsSuccess}</p> : null}
                  <div className="flex justify-end border-t border-border pt-4"><Button className="min-w-36" disabled={costSettingsSaving || costSettingsLoading} type="submit">{costSettingsSaving ? "Salvando..." : "Salvar agenda"}</Button></div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {displayedSettingsSection === "Custos e orçamento" ? (
            <Card className="border-border/70">
              <CardHeader className="border-b border-border/70"><CardTitle>Custos e orçamento</CardTitle><p className="text-sm text-muted-foreground">Defina o valor de mão de obra para cada profissional da clínica.</p></CardHeader>
              <CardContent className="pt-5">
                {canManageTeam ? <section className="mb-6 rounded-lg border border-border/70 px-4 py-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-bold text-foreground">Mão de obra por profissional</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Defina o valor em reais para cada profissional da clínica.</p>
                  </div>
                  {teamLoading ? <div className="space-y-3 py-2">{[0, 1].map((item) => <LoadingSkeleton className="h-12 w-full" key={item} />)}</div> : professionalLaborCostMembers.length ? <div className="divide-y divide-border/70">
                    {professionalLaborCostMembers.map((member) => {
                      const isEditing = member.laborCostCents === null || editingLaborCostId === member.id;
                      return <div key={member.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,240px)_auto] sm:items-end">
                        <div className="min-w-0 pb-2 sm:pb-2"><p className="truncate text-sm font-semibold text-foreground">{member.user.name}</p><p className="text-xs text-muted-foreground">Profissional</p></div>
                        {isEditing ? <form className="contents" onSubmit={(event) => void saveProfessionalLaborCost(event, member)}>
                          <FormField label="Mão de obra (R$)"><MaskedInput key={`${member.id}-${member.laborCostCents}`} className={fieldClassName} formatter={formatCurrency} name="laborCost" defaultValue={currency.format((member.laborCostCents ?? 0) / 100)} inputMode="decimal" /></FormField>
                          <Button className="sm:mb-0.5" type="submit" variant="secondary" disabled={laborCostSavingId === member.id}>{laborCostSavingId === member.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{laborCostSavingId === member.id ? "Salvando..." : "Salvar valor"}</Button>
                        </form> : <>
                          <div className="pb-2"><p className="text-[10px] font-semibold text-muted-foreground">Mão de obra (R$)</p><p className="mt-1 text-sm font-bold text-emerald-500">{currency.format((member.laborCostCents ?? 0) / 100)}</p></div>
                          <Button className="sm:mb-0.5 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive" type="button" variant="secondary" onClick={() => { setEditingLaborCostId(member.id); setLaborCostFeedback(null); }}>Alterar valor</Button>
                        </>}
                      </div>;
                    })}
                  </div> : <p className="py-3 text-sm text-muted-foreground">Cadastre alguém com o cargo Profissional na equipe para definir a mão de obra.</p>}
                  {laborCostFeedback ? <p className={cn("mt-3 text-xs font-medium", laborCostFeedback.success ? "text-success" : "text-destructive")} role={laborCostFeedback.success ? "status" : "alert"}>{laborCostFeedback.message}</p> : null}
                </section> : null}
              </CardContent>
            </Card>
          ) : null}

          {displayedSettingsSection === "Notificações" ? (
              <Card className="border-border/70">
                <CardHeader className="border-b border-border/70"><CardTitle>Notificações</CardTitle><p className="text-sm text-muted-foreground">Escolha quais avisos aparecem no menu superior da aplicação.</p></CardHeader>
                <CardContent className="pt-4">
                  <form onSubmit={saveCostSettings}>
                    <SettingsToggle label="Som das notificações" description="Toca um plim leve quando chega uma nova notificação da clínica." checked={appointmentNotificationSoundEnabled} onChange={() => setAppointmentNotificationSoundEnabled((value) => !value)} />
                    {costSettingsError ? <p className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{costSettingsError}</p> : null}
                    {costSettingsSuccess ? <p className="mt-4 text-sm font-medium text-success" role="status">{costSettingsSuccess}</p> : null}
                    <div className="mt-4 flex justify-end border-t border-border pt-4"><Button className="min-w-36" disabled={costSettingsSaving || costSettingsLoading} type="submit">{costSettingsSaving ? "Salvando..." : "Salvar preferências"}</Button></div>
                  </form>
                </CardContent>
              </Card>
          ) : null}

          {displayedSettingsSection === "Segurança e permissões" ? (
            <Card className="border-border/70">
              <CardHeader className="border-b border-border/70"><CardTitle>Segurança e permissões</CardTitle><p className="text-sm text-muted-foreground">Selecione um cargo para ativar ou desativar cada permissão. As alterações valem para todos os colaboradores daquele cargo.</p></CardHeader>
              <CardContent className="space-y-3 pt-4">
                {rolePermissionsLoading ? <LoadingSkeleton className="h-16 w-full" /> : roles.map((role) => {
                  const rolePermissionCount = permissionGroups.flatMap((group) => group.permissions).filter(({ key }) => rolePermissionMatrix[role][key]).length;
                  const expanded = selectedPermissionRole === role;
                  return <section className="overflow-hidden rounded-lg border border-border/70" key={role}>
                    <button aria-expanded={expanded} className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/50" onClick={() => setSelectedPermissionRole(expanded ? null : role)} type="button">
                      <span className="min-w-0"><span className="block text-sm font-bold text-foreground">{roleLabels[role]}</span><span className="mt-1 block text-xs text-muted-foreground">{rolePermissionCount} de {permissionGroups.flatMap((group) => group.permissions).length} permissões ativas</span></span>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                    </button>
                    {expanded ? <div className="space-y-5 border-t border-border/70 p-4">
                      {permissionGroups.map((group) => <section className="space-y-2" key={group.label}>
                        <h4 className="text-xs font-bold text-foreground">{group.label}</h4>
                        <div className="divide-y divide-border/60 rounded-md border border-border/60">
                          {group.permissions.map(({ key, label, description }) => <SettingsToggle key={key} label={label} description={description} checked={rolePermissionMatrix[role][key]} disabled={rolePermissionsSaving || rolePermissionsLoading} onChange={(enabled) => { setRolePermissionMatrix((current) => ({ ...current, [role]: { ...current[role], [key]: enabled } })); setRolePermissionsDirty(true); }} />)}
                        </div>
                      </section>)}
                      {role === "ADMIN" ? <p className="text-xs leading-5 text-muted-foreground">O administrador principal sempre pode reabrir esta tela para recuperar permissões administrativas.</p> : null}
                    </div> : null}
                  </section>;
                })}
                {rolePermissionsError ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{rolePermissionsError}</p> : null}
                <div className="flex flex-wrap justify-between gap-2 border-t border-border/70 pt-4">
                  {canManageTeam ? <Button type="button" variant="secondary" onClick={() => setActiveSettingsSection("Profissionais e equipe")}>Gerenciar equipe</Button> : <span />}
                  <Button type="button" disabled={rolePermissionsSaving || rolePermissionsLoading || !rolePermissionsDirty} onClick={() => void saveRolePermissions()}>{rolePermissionsSaving ? "Salvando permissões..." : "Salvar permissões"}</Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {displayedSettingsSection === "Integrações" ? (
            <Card className="border-border/70">
              <CardHeader className="border-b border-border/70"><CardTitle>Integrações</CardTitle><p className="text-sm text-muted-foreground">Conecte serviços externos para ampliar os recursos da clínica.</p></CardHeader>
              <CardContent className="space-y-3 pt-4">
                {[
                  ["WhatsApp", "Confirmações e lembretes de agendamentos"],
                  ["E-mail", "Envio de comunicações para pacientes"],
                  ["Calendário", "Sincronização externa da agenda"],
                ].map(([name, description]) => <div className="flex flex-col gap-3 rounded-md border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between" key={name}><div><p className="text-sm font-bold text-foreground">{name}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Badge variant="amber">Indisponível</Badge></div>)}
                <p className="text-xs leading-5 text-muted-foreground">Nenhum provedor de integração está configurado nesta versão. As opções de confirmação e reagendamento online ficam desativadas até a conexão estar disponível.</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Modal open={editing === "Novo colaborador"} onClose={() => { if (!teamSaving) { setEditing(null); resetNewCollaboratorContact(); } }} title="Novo colaborador" description="Adicione um acesso à clínica e escolha o nível de permissão." panelClassName="max-w-7xl">
        <form className="space-y-4" onSubmit={saveCollaborator}>
          <section className="space-y-3">
            <h3 className="border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dados pessoais</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Nome completo" required><input className={fieldClassName} name="name" autoComplete="name" required /></FormField>
              <FormField label="CPF" required><input className={fieldClassName} name="cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" maxLength={14} value={newMemberCpf} onChange={(event) => setNewMemberCpf(event.target.value.replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"))} required /></FormField>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acesso à conta</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="E-mail de acesso" required><input className={fieldClassName} name="email" type="email" autoComplete="email" required /></FormField>
              <FormField label="Senha inicial" required><input className={fieldClassName} name="password" type="password" minLength={8} autoComplete="new-password" required /></FormField>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Localidade</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <FormField label="CEP"><input className={fieldClassName} name="postalCode" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" maxLength={9} value={newMemberPostalCode} onChange={(event) => { setNewMemberPostalCode(event.target.value.replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2")); setPostalCodeError(""); }} /></FormField>
                <Button className="w-full sm:w-auto" type="button" variant="secondary" size="sm" disabled={postalCodeLoading} onClick={() => void lookupCollaboratorPostalCode()}>{postalCodeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{postalCodeLoading ? "Buscando CEP..." : "Buscar CEP"}</Button>
              </div>
              {postalCodeError ? <p className="sm:col-span-2 -mt-2 text-xs text-destructive" role="alert">{postalCodeError}</p> : null}
              <div className="sm:col-span-2"><FormField label="Endereço" required><input className={fieldClassName} name="address" autoComplete="address-line1" placeholder="Rua, número, bairro e complemento" value={newMemberAddress} onChange={(event) => setNewMemberAddress(event.target.value)} required /></FormField></div>
              <FormField label="País" required><input className={fieldClassName} name="country" autoComplete="country-name" placeholder="Brasil" value={newMemberCountry} onChange={(event) => setNewMemberCountry(event.target.value)} required /></FormField>
              <FormField label="Estado" required><input className={fieldClassName} name="state" autoComplete="address-level1" placeholder="Estado" value={newMemberState} onChange={(event) => setNewMemberState(event.target.value)} required /></FormField>
              <FormField label="Cidade" required><input className={fieldClassName} name="city" autoComplete="address-level2" placeholder="Cidade" value={newMemberCity} onChange={(event) => setNewMemberCity(event.target.value)} required /></FormField>
            </div>
          </section>

          <FormField label="Perfil" required><select className={fieldClassName} name="role" required><option value="PROFESSIONAL">Profissional</option><option value="STAFF">Atendente</option><option value="ADMIN">Administrador</option></select></FormField>
          {teamError ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{teamError}</p> : null}
          <div className="flex justify-end gap-2"><Button disabled={teamSaving} type="button" variant="secondary" onClick={() => { setEditing(null); resetNewCollaboratorContact(); }}>Cancelar</Button><Button disabled={teamSaving} type="submit">{teamSaving ? "Criando conta..." : "Criar conta"}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(memberToChangeRole)} onClose={() => { if (!roleSaving) setMemberToChangeRole(null); }} title="Alterar cargo" description="Escolha o nível de acesso deste colaborador na clínica.">
        <form className="space-y-4" onSubmit={saveMemberRole}>
          <p className="text-sm text-muted-foreground">Colaborador: <strong className="text-foreground">{memberToChangeRole?.user.name}</strong></p>
          <FormField label="Cargo">
            <select className={fieldClassName} value={roleToChange} onChange={(event) => setRoleToChange(event.target.value)}>
              <option value="PROFESSIONAL">Profissional</option>
              <option value="STAFF">Atendente</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </FormField>
          {roleChangeError ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{roleChangeError}</p> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={roleSaving} onClick={() => setMemberToChangeRole(null)}>Cancelar</Button><Button type="submit" disabled={roleSaving}>{roleSaving ? "Salvando..." : "Salvar cargo"}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(memberToRemove)} onClose={() => { if (!memberRemoving) setMemberToRemove(null); }} title="Remover colaborador" description="Essa ação remove o acesso do colaborador à clínica.">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Tem certeza que deseja remover <strong>{memberToRemove?.user.name}</strong>?</p>
          {memberRemoveError ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{memberRemoveError}</p> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={memberRemoving} onClick={() => setMemberToRemove(null)}>Cancelar</Button><Button type="button" className="bg-destructive hover:bg-destructive/90" disabled={memberRemoving} onClick={() => void removeCollaborator()}>{memberRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}{memberRemoving ? "Removendo..." : "Remover colaborador"}</Button></div>
        </div>
      </Modal>
    </div>
  );
}
