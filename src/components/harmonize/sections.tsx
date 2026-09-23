"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarPlus,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  ListFilter,
  Loader2,
  PencilLine,
  Plus,
  Printer,
  Search,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaskedInput } from "@/components/ui/masked-input";
import {
  DetailCard,
  EmptyState,
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
import type { Appointment, Patient, Payment, Procedure, Product, Quote } from "@/types/clinic";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

type CreateProps = {
  openCreate?: boolean;
  onCreateOpen?: () => void;
  onCreateClose?: () => void;
  onSaved?: (message: string, undo?: () => void) => void;
};

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
};

type AppointmentRow = Appointment & { id: string };
type ApiAppointment = {
  id: string;
  date: string;
  time: string;
  procedure: string;
  professional: string;
  status: string;
  patient: { name: string };
};

function mapApiAppointment(appointment: ApiAppointment): AppointmentRow {
  return {
    id: appointment.id,
    time: appointment.time,
    patient: appointment.patient.name,
    procedure: appointment.procedure,
    professional: appointment.professional,
    status: appointment.status,
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
    nextReturn: patient.nextReturn ? displayDate(patient.nextReturn) : "A definir",
    value: currency.format(patient.totalValue),
  };
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function journeyForPatient(patient: Patient) {
  const leadAt = patient.lastVisit === "Primeiro contato" ? new Date().toISOString() : patient.lastVisit;
  return buildCustomerJourney({ events: { leadAt }, details: {} });
}

type FinancialData = {
  payments: Array<{ value: number; status: string }>;
  quotes: Array<{ total: number; status: string }>;
  appointments: Array<{ procedure: string; status: string }>;
};

function useFinancialData() {
  const [data, setData] = useState<FinancialData | null>(null);
  useEffect(() => {
    Promise.all([fetch("/api/payments"), fetch("/api/quotes"), fetch("/api/appointments")])
      .then(async ([paymentsResponse, quotesResponse, appointmentsResponse]) => {
        const [paymentsData, quotesData, appointmentsData] = await Promise.all([paymentsResponse.json(), quotesResponse.json(), appointmentsResponse.json()]);
        setData({ payments: paymentsData.payments ?? [], quotes: quotesData.quotes ?? [], appointments: appointmentsData.appointments ?? [] });
      })
      .catch(() => setData({ payments: [], quotes: [], appointments: [] }));
  }, []);
  return data;
}

export function ClientsSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const [selectedPatientName, setSelectedPatientName] = useState<string | null>(null);
  const [patientRows, setPatientRows] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/patients")
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar os pacientes.");
        return response.json() as Promise<{ patients: ApiPatient[] }>;
      })
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
  const selectedPatient = patientRows.find((patient) => patient.name === selectedPatientName);
  const filteredPatients = patientRows.filter((patient) =>
    `${patient.name} ${patient.phone} ${patient.status}`.toLowerCase().includes(query.toLowerCase()),
  );

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
        onBack={() => setSelectedPatientName(null)}
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
      {isLoading ? <EmptyState title="Carregando clientes..." description="Buscando os registros salvos no banco de dados." /> : null}
      {!isLoading && !filteredPatients.length ? <EmptyState title="Nenhum cliente encontrado" description="Cadastre um cliente para começar o prontuário da clínica." /> : null}
      {!isLoading && filteredPatients.length ? <MiniTable
        columns={["Nome", "Telefone", "Status", "Etapa atual", "Próximo retorno", "Ação"]}
        rows={filteredPatients.map((patient) => {
          const journey = journeyForPatient(patient);
          const currentStage = journey.find((stage) => stage.status === "current");

          return [
          <button className="text-left font-bold text-[#303144] hover:text-[#5147dc]" key={patient.name} onClick={() => setSelectedPatientName(patient.name)}>{patient.name}</button>,
          patient.phone,
          <StatusBadge key={patient.status} status={patient.status} />,
          <span className="font-bold text-[#5147dc]" key={currentStage?.id}>{currentStage?.label ?? "Concluída"}</span>,
          patient.nextReturn,
          <Button key="open" size="sm" variant="secondary" onClick={() => setSelectedPatientName(patient.name)}>Ver perfil <ArrowRight className="h-3 w-3" /></Button>,
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

export function ScheduleSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const rowColors = ["#5147dc", "#6d5ce7", "#2f9c88", "#d86655", "#ddb63f"];
  const [appointmentRows, setAppointmentRows] = useState<AppointmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [patientOptions, setPatientOptions] = useState<ApiPatient[]>([]);
  const [procedureOptions, setProcedureOptions] = useState<string[]>([]);
  const [professionalChoices, setProfessionalChoices] = useState<string[]>([]);
  const [patientQuery, setPatientQuery] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [activeView, setActiveView] = useState("Lista");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [professional, setProfessional] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const professionalOptions = useMemo(() => ["Todos", ...new Set(appointmentRows.map((item) => item.professional))], [appointmentRows]);
  const statusOptions = useMemo(() => ["Todos", ...new Set(appointmentRows.map((item) => item.status))], [appointmentRows]);
  const activeProfessional = professionalOptions.includes(professional) ? professional : "Todos";
  const activeStatus = statusOptions.includes(status) ? status : "Todos";
  const filteredAppointments = appointmentRows.filter((appointment) => {
    const matchesQuery = `${appointment.patient} ${appointment.procedure}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (activeProfessional === "Todos" || appointment.professional === activeProfessional) && (activeStatus === "Todos" || appointment.status === activeStatus);
  });

  useEffect(() => {
    let active = true;
    fetch("/api/appointments")
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar a agenda.");
        return response.json() as Promise<{ appointments: ApiAppointment[] }>;
      })
      .then((data) => {
        if (active) setAppointmentRows(data.appointments.map(mapApiAppointment));
      })
      .catch(() => {
        if (active) setLoadError("Não foi possível carregar a agenda do servidor.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    fetch("/api/procedures")
      .then((response) => response.json() as Promise<{ procedures?: Array<{ name: string }> }>)
      .then((data) => setProcedureOptions((data.procedures ?? []).map((item) => item.name)))
      .catch(() => setProcedureOptions([]));
  }, []);

  useEffect(() => {
    fetch("/api/team")
      .then((response) => response.json() as Promise<{ members?: Array<{ role: string; user: { name: string } }> }> )
      .then((data) => setProfessionalChoices((data.members ?? []).filter((member) => ["ADMIN", "PROFESSIONAL"].includes(member.role)).map((member) => member.user.name)))
      .catch(() => setProfessionalChoices([]));
  }, []);

  useEffect(() => {
    fetch("/api/patients")
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar os pacientes.");
        return response.json() as Promise<{ patients: ApiPatient[] }>;
      })
      .then((data) => setPatientOptions(data.patients))
      .catch(() => setLoadError("Não foi possível carregar os pacientes para o agendamento."));
  }, []);

  const matchingPatients = patientOptions.filter((patient) =>
    `${patient.name} ${patient.cpf ?? ""}`.toLowerCase().includes(patientQuery.toLowerCase()),
  );
  const selectedPatient = patientOptions.find((patient) => patient.id === selectedPatientId);

  function matchesAppointment(item: Appointment, target: Appointment) {
    return item.time === target.time &&
      item.patient === target.patient &&
      item.procedure === target.procedure &&
      item.professional === target.professional;
  }

  function syncAvailableFilters(nextRows: Appointment[]) {
    if (professional !== "Todos" && !nextRows.some((item) => item.professional === professional)) {
      setProfessional("Todos");
    }

    if (status !== "Todos" && !nextRows.some((item) => item.status === status)) {
      setStatus("Todos");
    }
  }

  async function saveAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const patient = selectedPatient?.name ?? "";
    setIsSaving(true);
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
          patientId: selectedPatientId,
          patient: selectedPatient?.name,
          time: String(form.get("time")),
          procedure: String(form.get("procedure")),
          professional: String(form.get("professional")),
          date: new Date().toISOString(),
        }),
      });
      if (!response.ok) return;
      const data = await response.json() as { appointment: ApiAppointment };
      setAppointmentRows((current) => [...current, mapApiAppointment(data.appointment)].sort((a, b) => a.time.localeCompare(b.time)));
      onCreateClose();
      setPatientQuery("");
      setSelectedPatientId("");
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
    const nextRows = appointmentRows.map((item) => matchesAppointment(item, target) ? { ...item, status: nextStatus } : item);
    setAppointmentRows(nextRows);
    syncAvailableFilters(nextRows);
    setUpdatingId(null);
    onSaved?.(`${target.patient}: ${nextStatus}.`);
  }

  async function markAppointmentAsMissed(target: AppointmentRow) {
    const previousStatus = target.status;

    const nextRows = appointmentRows.map((item) => matchesAppointment(item, target) ? { ...item, status: "Faltou" } : item);
    setUpdatingId(target.id);
    const response = await fetch(`/api/appointments/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Faltou" }) });
    if (!response.ok) { setUpdatingId(null); return; }
    setAppointmentRows(nextRows);
    syncAvailableFilters(nextRows);
    setUpdatingId(null);
    onSaved?.(`${target.patient} foi marcado como faltou.`, () => {
      const restoredRows = nextRows.map((item) => matchesAppointment(item, target) ? { ...item, status: previousStatus } : item);
      setAppointmentRows(restoredRows);
      syncAvailableFilters(restoredRows);
    });
  }

  return (
    <div className="mx-auto max-w-[1260px]">
      <div className="hp-page-enter mb-5 flex flex-col gap-4 border-b border-[#ececf2] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
          <p className="text-[10px] font-bold uppercase text-[#9a9bab]">Agenda clínica</p>
          <h2 className="mt-1 text-lg font-bold text-[#25263a]">Atendimentos de hoje</h2>
          </div>
          <Button size="sm" onClick={onCreateOpen}><Plus className="h-4 w-4" /> Agendar</Button>
        </div>
        <div className="flex items-center gap-1">
          {["Lista", "Dia", "Semana"].map((view) => (
            <button
              className={activeView === view
                ? "hp-pressable border-b-2 border-[#5147dc] px-5 py-2 text-xs font-bold text-[#5147dc]"
                : "hp-pressable border-b-2 border-transparent px-5 py-2 text-xs font-semibold text-[#8a8b9c] hover:text-[#5147dc]"}
              key={view}
              onClick={() => setActiveView(view)}
            >
              {view}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Buscar" onClick={() => setSearchOpen((open) => !open)}><Search className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Imprimir" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
        </div>
      </div>

      {searchOpen ? <SearchFilterBar placeholder="Buscar paciente ou procedimento" value={query} onChange={setQuery} /> : null}

      <div className="hp-page-enter mb-6 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs">
        <span className="flex items-center gap-2 font-bold text-[#5f6072]"><ListFilter className="h-3.5 w-3.5" /> Filtrar por</span>
        <select className="min-w-[150px] border-b border-[#dedee7] bg-transparent px-1 py-2 font-semibold text-[#757688] outline-none" value={activeProfessional} onChange={(event) => setProfessional(event.target.value)}>
          {professionalOptions.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="min-w-[150px] border-b border-[#dedee7] bg-transparent px-1 py-2 font-semibold text-[#757688] outline-none" value={activeStatus} onChange={(event) => setStatus(event.target.value)}>
          {statusOptions.map((item) => <option key={item}>{item}</option>)}
        </select>
        <span className="text-[#8a8b9c]">{isLoading ? "Carregando agenda..." : `${filteredAppointments.length} atendimento(s) · visão ${activeView.toLowerCase()}`}</span>
      </div>

      <div className="hp-panel-enter overflow-x-auto rounded-[7px] bg-white px-3 shadow-[0_8px_28px_rgba(38,39,58,0.035)] sm:px-5">
        <div className="grid min-w-[1040px] grid-cols-[84px_1.1fr_1fr_1.05fr_1.15fr_210px] border-b border-[#eeeef3] px-3 py-3 text-[9px] font-bold uppercase text-[#adaeba]">
          <span>Horário</span><span>Atendimento</span><span>Status</span><span>Profissional</span><span>Paciente</span><span></span>
        </div>
        <div className="hp-list-stagger">
        {isLoading ? Array.from({ length: 4 }).map((_, index) => (
          <div className="grid min-w-[1040px] animate-pulse grid-cols-[84px_1.1fr_1fr_1.05fr_1.15fr_210px] items-center gap-3 border-b border-[#f0f0f4] px-3 py-5" key={`loading-${index}`}>
            {Array.from({ length: 6 }).map((__, cell) => <span className="h-3 rounded-full bg-[#ececf4]" key={cell} />)}
          </div>
        )) : null}
        {!isLoading && loadError ? <div className="p-8 text-center text-xs font-semibold text-[#b42318]">{loadError}</div> : null}
        {!isLoading && !loadError && !filteredAppointments.length ? <div className="p-8 text-center text-xs font-semibold text-[#858696]">Nenhum atendimento encontrado.</div> : null}
        {!isLoading && !loadError && filteredAppointments.map((appointment, index) => {
          const isCompleted = appointment.status === "Atendido";
          const isMissed = appointment.status === "Faltou";
          const primaryLabel = appointment.status === "Em atendimento" ? "Finalizar" : isCompleted ? "Concluído" : isMissed ? "Faltou" : "Atender";

          return (
            <div className="relative grid min-w-[1040px] grid-cols-[84px_1.1fr_1fr_1.05fr_1.15fr_210px] items-center border-b border-[#f0f0f4] px-3 py-4 text-[11px] transition-[background-color,transform] duration-200 last:border-0 hover:-translate-y-0.5 hover:bg-[#fbfbfe]" key={`${appointment.time}-${appointment.patient}`}>
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
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveAppointment}>
          <div className="relative sm:col-span-2">
            <FormField label="Paciente">
              <input
                className={fieldClassName}
                name="patientSearch"
                placeholder="Pesquise por nome ou CPF"
                required
                value={patientQuery}
                onChange={(event) => {
                  setPatientQuery(event.target.value);
                  setSelectedPatientId("");
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
          <FormField label="Horário"><input className={fieldClassName} name="time" type="time" required /></FormField>
          <FormField label="Profissional"><select className={fieldClassName} name="professional" required disabled={!professionalChoices.length}><option value="">{professionalChoices.length ? "Selecione o profissional" : "Nenhum profissional cadastrado"}</option>{professionalChoices.map((professional) => <option key={professional} value={professional}>{professional}</option>)}</select></FormField>
          <div className="sm:col-span-2"><FormField label="Procedimento"><select className={fieldClassName} name="procedure" required>{procedureOptions.length ? procedureOptions.map((item) => <option key={item}>{item}</option>) : <option value="">Nenhum procedimento cadastrado</option>}</select></FormField></div>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button disabled={isSaving || !selectedPatientId} type="submit">{isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{isSaving ? "Salvando..." : "Criar agendamento"}</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function ProceduresSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const [procedureRows, setProcedureRows] = useState<Procedure[]>([]);
  const [productRows, setProductRows] = useState<Product[]>([]);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [editingProcedureIndex, setEditingProcedureIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
    const response = await fetch("/api/procedures");
    const data = await response.json() as { procedures?: Array<{ id: string; name: string; category: string; price: number; durationMinutes: number; materials: string; margin: number }> };
    applyProcedureRows(data);
    setIsLoading(false);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/procedures")
      .then((response) => response.json() as Promise<{ procedures?: Array<{ id: string; name: string; category: string; price: number; durationMinutes: number; materials: string; margin: number }> }>)
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
    fetch("/api/products")
      .then((response) => response.json() as Promise<{ products?: Product[] }>)
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
    const nextProcedure = {
      name,
      category: String(form.get("category")),
      price: parseCurrency(form.get("price")),
      durationMinutes: parseInteger(form.get("duration")),
      materials: String(form.get("materials")),
      margin: parseInteger(form.get("margin")),
    };
    const response = await fetch(editingProcedure?.id ? `/api/procedures/${editingProcedure.id}` : "/api/procedures", {
      method: editingProcedure?.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextProcedure),
    });
    setIsSaving(false);
    if (!response.ok) return;
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
        {isLoading ? <Card><CardContent className="flex items-center gap-2 py-10 text-sm text-[#65708b]"><Loader2 className="h-4 w-4 animate-spin" />Carregando procedimentos...</CardContent></Card> : <MiniTable
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
                className="rounded-[8px] border border-[#e5e9f4] p-4 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-[#dce5ff] hover:shadow-[0_12px_24px_rgba(38,39,58,0.06)]"
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
        key={editingProcedure ? `edit-${editingProcedure.name}` : "new-procedure"}
        open={procedureModalOpen}
        onClose={closeProcedureModal}
        title={editingProcedure ? "Editar procedimento" : "Novo procedimento"}
        description="Defina preço, duração e margem do serviço."
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveProcedure}>
          <div className="sm:col-span-2"><FormField label="Nome"><input className={fieldClassName} name="name" defaultValue={editingProcedure?.name ?? ""} required /></FormField></div>
          <FormField label="Categoria"><input className={fieldClassName} name="category" defaultValue={editingProcedure?.category ?? ""} required /></FormField>
          <FormField label="Valor sugerido"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="price" inputMode="decimal" defaultValue={editingProcedure ? currency.format(editingProcedure.price) : ""} placeholder="R$ 0,00" required /></FormField>
          <FormField label="Duração em minutos"><MaskedInput className={fieldClassName} formatter={(value) => formatInteger(value, 3)} name="duration" inputMode="numeric" defaultValue={editingProcedure?.duration ?? ""} placeholder="60" required /></FormField>
          <FormField label="Margem estimada (%)"><MaskedInput className={fieldClassName} formatter={formatPercent} name="margin" inputMode="numeric" defaultValue={editingProcedure?.margin ?? ""} placeholder="40%" required /></FormField>
          <div className="sm:col-span-2"><FormField label="Materiais"><input className={fieldClassName} name="materials" defaultValue={editingProcedure?.materials ?? ""} required /></FormField></div>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={closeProcedureModal}>Cancelar</Button><Button disabled={isSaving} type="submit">{isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{isSaving ? "Salvando..." : editingProcedure ? "Salvar alterações" : "Salvar procedimento"}</Button></div>
        </form>
      </Modal>
      <Modal open={materialOpen} onClose={() => setMaterialOpen(false)} title="Novo material">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveMaterial}>
          <div className="sm:col-span-2"><FormField label="Nome"><input className={fieldClassName} name="name" required /></FormField></div>
          <FormField label="Categoria"><input className={fieldClassName} name="category" required /></FormField>
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
  const [quoteRows, setQuoteRows] = useState<Quote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/quotes").then((response) => response.json()).then((data: { quotes?: Array<{ id: string; items: string; total: number; status: string; expires: string | null; patient?: { name: string } | null }> }) => {
      setQuoteRows((data.quotes ?? []).map((item) => ({ id: item.id, patient: item.patient?.name ?? "Paciente", items: item.items, total: currency.format(item.total), status: item.status, expires: item.expires ? new Date(item.expires).toLocaleDateString("pt-BR") : "Sem validade" })));
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  async function saveQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIsSaving(true); const form = new FormData(event.currentTarget); const patient = String(form.get("patient"));
    const response = await fetch("/api/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient, items: String(form.get("items")), total: parseCurrency(form.get("total")), expires: String(form.get("expires")) }) });
    setIsSaving(false);
    if (!response.ok) return;
    const data = await response.json() as { quote: { id: string; items: string; total: number; status: string; expires: string | null; patient?: { name: string } | null } };
    const item = data.quote;
    setQuoteRows((current) => [{ id: item.id, patient: item.patient?.name ?? patient, items: item.items, total: currency.format(item.total), status: item.status, expires: item.expires ? new Date(item.expires).toLocaleDateString("pt-BR") : "Sem validade" }, ...current]);
    onCreateClose(); onSaved?.(`Orçamento de ${patient} foi criado.`);
  }

  async function sendQuote(index: number) {
    const quote = quoteRows[index];
    if (!quote.id) return;
    await fetch(`/api/quotes/${quote.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Enviado" }) });
    setQuoteRows((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, status: "Enviado" } : item));
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
      {isLoading ? <Card><CardContent className="py-10 text-sm text-[#65708b]">Carregando orçamentos...</CardContent></Card> : <MiniTable
        columns={["Paciente", "Itens", "Total", "Status", "Validade", "Ação"]}
        rows={quoteRows.map((quote, index) => [
          <strong className="text-[#121733]" key={quote.patient}>{quote.patient}</strong>,
          quote.items,
          <span className="font-black text-[#1438ff]" key={quote.total}>{quote.total}</span>,
          <StatusBadge key={quote.status} status={quote.status} />,
          quote.expires,
          <Button key="send" size="sm" variant="secondary" disabled={quote.status === "Enviado"} onClick={() => sendQuote(index)}>{quote.status === "Enviado" ? "Enviado" : "Enviar"}</Button>,
        ])}
      />}
      <Modal open={openCreate} onClose={onCreateClose} title="Novo orçamento" description="Crie uma proposta comercial para o cliente.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveQuote}>
          <FormField label="Paciente"><input className={fieldClassName} name="patient" required /></FormField>
          <FormField label="Validade"><MaskedInput className={fieldClassName} formatter={formatDate} name="expires" inputMode="numeric" maxLength={10} placeholder="30/09/2026" required /></FormField>
          <div className="sm:col-span-2"><FormField label="Procedimentos"><input className={fieldClassName} name="items" placeholder="Botox, preenchimento..." required /></FormField></div>
          <div className="sm:col-span-2"><FormField label="Valor total"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="total" inputMode="decimal" placeholder="R$ 0,00" required /></FormField></div>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button disabled={isSaving} type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button disabled={isSaving} type="submit">{isSaving ? "Salvando..." : "Salvar orçamento"}</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function PaymentsSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const [paymentRows, setPaymentRows] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [methodFilter, setMethodFilter] = useState("Todos");
  const visiblePayments = methodFilter === "Todos" ? paymentRows : paymentRows.filter((item) => item.method === methodFilter);

  useEffect(() => {
    fetch("/api/payments").then((response) => response.json()).then((data: { payments?: Array<{ id: string; value: number; method: string; date: string; status: string; installments: string; patient?: { name: string } | null }> }) => {
      setPaymentRows((data.payments ?? []).map((item) => ({ id: item.id, patient: item.patient?.name ?? "Paciente", value: currency.format(item.value), method: item.method, date: new Date(item.date).toLocaleDateString("pt-BR"), status: item.status, installments: item.installments })));
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
    setPaymentRows((current) => [{ id: item.id, patient: item.patient?.name ?? patient, value: currency.format(item.value), method: item.method, date: new Date(item.date).toLocaleDateString("pt-BR"), status: item.status, installments: item.installments }, ...current]);
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
      {isLoading ? <Card><CardContent className="py-10 text-sm text-[#65708b]">Carregando pagamentos...</CardContent></Card> : <MiniTable
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
      <div className="hp-list-stagger mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {["Pix", "Cartão de crédito", "Cartão de débito", "Dinheiro"].map((method) => (
          <button className="text-left" key={method} onClick={() => setMethodFilter(methodFilter === method ? "Todos" : method)}><Card className={`p-5 transition ${methodFilter === method ? "border-[#5147dc] bg-[#f7f6ff]" : ""}`}>
            <CircleDollarSign className="mb-4 h-5 w-5 text-[#1438ff]" />
            <p className="font-black text-[#121733]">{method}</p>
            <p className="mt-1 text-sm text-[#65708b]">Disponível no lançamento</p>
          </Card></button>
        ))}
      </div>
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
  const values = [received, 0, received, pending, received].map((value) => currency.format(value));
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
            <p className="mt-3 text-2xl font-black text-[#121733]">{values[index]}</p>
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

type TeamMember = { id: string; role: string; user: { id: string; name: string; email: string; createdAt: string } };

export function SettingsSection({ isAdmin = false }: { isAdmin?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamError, setTeamError] = useState("");

  useEffect(() => {
    fetch("/api/team")
      .then((response) => response.json() as Promise<{ members?: TeamMember[] }>)
      .then((data) => setMembers(data.members ?? []))
      .catch(() => setTeamError("Não foi possível carregar os colaboradores."))
      .finally(() => setTeamLoading(false));
  }, []);

  async function saveCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTeamSaving(true);
    setTeamError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), email: form.get("email"), password: form.get("password"), role: form.get("role") }),
    });
    const data = await response.json() as { member?: TeamMember; message?: string };
    setTeamSaving(false);
    if (!response.ok || !data.member) {
      setTeamError(data.message ?? "Não foi possível cadastrar o colaborador.");
      return;
    }
    setMembers((current) => [...current, data.member as TeamMember].sort((a, b) => a.user.name.localeCompare(b.user.name)));
    setEditing(null);
    setTeamError("");
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
          <button className="text-left" key={title} onClick={() => { if (title === "Profissionais" && !isAdmin) return; setEditing(title); setSaved(false); }}><Card className={`h-full p-5 transition ${title === "Profissionais" && !isAdmin ? "cursor-not-allowed opacity-60" : "hover:border-[#5147dc]"}`}>
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
          {teamLoading ? <p className="py-5 text-sm text-[#65708b]">Carregando colaboradores...</p> : members.length ? members.map((member) => <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" key={member.id}><div><p className="text-sm font-bold text-[#303144]">{member.user.name}</p><p className="text-xs text-[#858696]">{member.user.email}</p></div><Badge variant={member.role === "ADMIN" ? "purple" : "green"}>{member.role === "PROFESSIONAL" ? "Profissional" : member.role === "STAFF" ? "Equipe" : "Administrador"}</Badge></div>) : <p className="py-5 text-sm text-[#65708b]">Nenhum colaborador cadastrado.</p>}
        </div>
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Configurar ${editing ?? ""}`} description="Essas preferências ficam salvas durante esta sessão.">
        {editing === "Novo colaborador" ? <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveCollaborator}><div className="sm:col-span-2"><FormField label="Nome completo"><input className={fieldClassName} name="name" required /></FormField></div><FormField label="E-mail de acesso"><input className={fieldClassName} name="email" type="email" required /></FormField><FormField label="Senha inicial"><input className={fieldClassName} name="password" type="password" minLength={6} required /></FormField><FormField label="Perfil"><select className={fieldClassName} name="role"><option value="PROFESSIONAL">Profissional</option><option value="STAFF">Equipe</option><option value="ADMIN">Administrador</option></select></FormField>{teamError ? <p className="sm:col-span-2 rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{teamError}</p> : null}<div className="flex justify-end gap-2 sm:col-span-2"><Button disabled={teamSaving} type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button disabled={teamSaving} type="submit">{teamSaving ? "Criando conta..." : "Criar conta"}</Button></div></form> : saved ? <div className="rounded-[7px] bg-[#eaf8ef] p-5 text-sm font-bold text-[#157a3b]">Configurações salvas com sucesso.</div> : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setSaved(true); }}>
          <FormField label="Nome de exibição"><input className={fieldClassName} defaultValue={editing ?? "Harmonize+"} /></FormField>
          <FormField label="Preferência principal"><select className={fieldClassName}><option>Padrão da clínica</option><option>Personalizado</option><option>Somente administradores</option></select></FormField>
          <label className="flex items-center gap-3 rounded-[7px] border border-[#e5e5ee] p-4 text-xs font-semibold text-[#555668]"><input type="checkbox" defaultChecked /> Ativar esta configuração</label>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button type="submit">Salvar alterações</Button></div>
        </form>}
      </Modal>
    </div>
  );
}
