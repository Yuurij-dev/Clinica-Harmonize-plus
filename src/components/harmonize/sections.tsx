"use client";

import { type FormEvent, useState } from "react";
import {
  ArrowRight,
  CalendarPlus,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  ListFilter,
  Plus,
  Printer,
  Search,
  Sparkles,
} from "lucide-react";
import {
  appointments,
  financialByProcedure,
  patientJourneyRecords,
  patients,
  payments,
  procedures,
  products,
  quotes,
  reportItems,
} from "@/data/mock";
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

export function ClientsSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const [selectedPatientName, setSelectedPatientName] = useState<string | null>(null);
  const [patientRows, setPatientRows] = useState<Patient[]>(patients);
  const [query, setQuery] = useState("");
  const selectedPatient = patientRows.find((patient) => patient.name === selectedPatientName);
  const filteredPatients = patientRows.filter((patient) =>
    `${patient.name} ${patient.phone} ${patient.status}`.toLowerCase().includes(query.toLowerCase()),
  );

  function savePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "Novo cliente");
    setPatientRows((current) => [{
      name,
      phone: String(form.get("phone") || "Não informado"),
      age: parseInteger(form.get("age")),
      status: "Ativa",
      lastVisit: "Primeiro contato",
      nextReturn: "A definir",
      value: "R$ 0",
    }, ...current]);
    onCreateClose();
    onSaved?.(`${name} foi adicionado aos clientes.`);
  }

  if (selectedPatient) {
    return (
      <PatientDetail
        key={selectedPatient.name}
        patient={selectedPatient}
        journey={buildCustomerJourney(patientJourneyRecords[selectedPatient.name] ?? { events: { leadAt: "2026-09-21" }, details: {} })}
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
      <MiniTable
        columns={["Nome", "Telefone", "Status", "Etapa atual", "Próximo retorno", "Ação"]}
        rows={filteredPatients.map((patient) => {
          const journey = buildCustomerJourney(patientJourneyRecords[patient.name] ?? { events: { leadAt: "2026-09-21" }, details: {} });
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
      />
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
          <FormField label="Telefone"><MaskedInput className={fieldClassName} formatter={formatPhone} name="phone" inputMode="tel" maxLength={15} placeholder="(00) 00000-0000" required /></FormField>
          <FormField label="Idade"><MaskedInput className={fieldClassName} formatter={(value) => formatInteger(value, 3)} name="age" inputMode="numeric" maxLength={3} placeholder="00" required /></FormField>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button type="submit">Salvar cliente</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function ScheduleSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const rowColors = ["#5147dc", "#6d5ce7", "#2f9c88", "#d86655", "#ddb63f"];
  const [appointmentRows, setAppointmentRows] = useState<Appointment[]>(appointments);
  const [activeView, setActiveView] = useState("Lista");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [professional, setProfessional] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const filteredAppointments = appointmentRows.filter((appointment) => {
    const matchesQuery = `${appointment.patient} ${appointment.procedure}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (professional === "Todos" || appointment.professional === professional) && (status === "Todos" || appointment.status === status);
  });

  function saveAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const patient = String(form.get("patient"));
    setAppointmentRows((current) => [...current, {
      time: String(form.get("time")), patient,
      procedure: String(form.get("procedure")), professional: String(form.get("professional")), status: "Agendado",
    }].sort((a, b) => a.time.localeCompare(b.time)));
    onCreateClose();
    onSaved?.(`Agendamento de ${patient} foi criado.`);
  }

  function advanceAppointment(target: Appointment) {
    const nextStatus = target.status === "Em atendimento" ? "Atendido" : "Em atendimento";
    setAppointmentRows((current) => current.map((item) => item === target ? { ...item, status: nextStatus } : item));
    onSaved?.(`${target.patient}: ${nextStatus}.`);
  }

  function markAppointmentAsMissed(target: Appointment) {
    const previousStatus = target.status;
    const matchesTarget = (item: Appointment) =>
      item.time === target.time &&
      item.patient === target.patient &&
      item.procedure === target.procedure &&
      item.professional === target.professional;

    setAppointmentRows((current) => current.map((item) => item === target ? { ...item, status: "Faltou" } : item));
    onSaved?.(`${target.patient} foi marcado como faltou.`, () => {
      setAppointmentRows((current) => current.map((item) => matchesTarget(item) ? { ...item, status: previousStatus } : item));
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
        <select className="min-w-[150px] border-b border-[#dedee7] bg-transparent px-1 py-2 font-semibold text-[#757688] outline-none" value={professional} onChange={(event) => setProfessional(event.target.value)}>
          <option>Todos</option>{[...new Set(appointmentRows.map((item) => item.professional))].map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="min-w-[150px] border-b border-[#dedee7] bg-transparent px-1 py-2 font-semibold text-[#757688] outline-none" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option>Todos</option>{[...new Set(appointmentRows.map((item) => item.status))].map((item) => <option key={item}>{item}</option>)}
        </select>
        <span className="text-[#8a8b9c]">{filteredAppointments.length} atendimento(s) · visão {activeView.toLowerCase()}</span>
      </div>

      <div className="hp-panel-enter overflow-x-auto rounded-[7px] bg-white px-3 shadow-[0_8px_28px_rgba(38,39,58,0.035)] sm:px-5">
        <div className="grid min-w-[1040px] grid-cols-[84px_1.1fr_1fr_1.05fr_1.15fr_210px] border-b border-[#eeeef3] px-3 py-3 text-[9px] font-bold uppercase text-[#adaeba]">
          <span>Horário</span><span>Atendimento</span><span>Status</span><span>Profissional</span><span>Paciente</span><span></span>
        </div>
        <div className="hp-list-stagger">
        {filteredAppointments.map((appointment, index) => {
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
                <Button className="border-[#5147dc] text-[#5147dc]" key="action" size="sm" variant="secondary" disabled={isCompleted || isMissed} onClick={() => advanceAppointment(appointment)}>{primaryLabel} <ArrowRight className="h-3 w-3" /></Button>
                {!isCompleted && !isMissed ? (
                  <Button className="border-[#f2c8c3] text-[#b42318] hover:border-[#b42318] hover:text-[#b42318]" key="missed" size="sm" variant="secondary" onClick={() => markAppointmentAsMissed(appointment)}>Faltou</Button>
                ) : null}
              </div>
            </div>
          );
        })}
        </div>
      </div>
      <Modal open={openCreate} onClose={onCreateClose} title="Novo agendamento" description="Inclua o atendimento na agenda de hoje.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveAppointment}>
          <div className="sm:col-span-2"><FormField label="Paciente"><input className={fieldClassName} name="patient" required /></FormField></div>
          <FormField label="Horário"><input className={fieldClassName} name="time" type="time" required /></FormField>
          <FormField label="Profissional"><select className={fieldClassName} name="professional"><option>Dra. Ana</option><option>Dra. Michelle</option><option>Dra. Carla</option></select></FormField>
          <div className="sm:col-span-2"><FormField label="Procedimento"><select className={fieldClassName} name="procedure">{procedures.map((item) => <option key={item.name}>{item.name}</option>)}</select></FormField></div>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button type="submit">Criar agendamento</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function ProceduresSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const [procedureRows, setProcedureRows] = useState<Procedure[]>(procedures);
  const [productRows, setProductRows] = useState<Product[]>(products);
  const [materialOpen, setMaterialOpen] = useState(false);

  function saveProcedure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name"));
    setProcedureRows((current) => [...current, { name, category: String(form.get("category")), price: parseCurrency(form.get("price")), duration: `${parseInteger(form.get("duration"))} min`, materials: String(form.get("materials")), margin: `${parseInteger(form.get("margin"))}%` }]);
    onCreateClose(); onSaved?.(`${name} foi adicionado aos procedimentos.`);
  }

  function saveMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name"));
    setProductRows((current) => [...current, { name, category: String(form.get("category")), unit: String(form.get("unit")), cost: parseCurrency(form.get("cost")), supplier: String(form.get("supplier")) }]);
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
        <MiniTable
          columns={["Nome", "Categoria", "Valor sugerido", "Tempo", "Materiais", "Margem"]}
          rows={procedureRows.map((procedure) => [
            <strong className="text-[#121733]" key={procedure.name}>{procedure.name}</strong>,
            procedure.category,
            currency.format(procedure.price),
            procedure.duration,
            procedure.materials,
            <Badge key={procedure.margin} variant="green">{procedure.margin}</Badge>,
          ])}
        />
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
        <CostCalculator />
      </div>
      <Modal open={openCreate} onClose={onCreateClose} title="Novo procedimento" description="Defina preço, duração e margem do serviço.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveProcedure}>
          <div className="sm:col-span-2"><FormField label="Nome"><input className={fieldClassName} name="name" required /></FormField></div>
          <FormField label="Categoria"><input className={fieldClassName} name="category" required /></FormField>
          <FormField label="Valor sugerido"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="price" inputMode="decimal" placeholder="R$ 0,00" required /></FormField>
          <FormField label="Duração em minutos"><MaskedInput className={fieldClassName} formatter={(value) => formatInteger(value, 3)} name="duration" inputMode="numeric" placeholder="60" required /></FormField>
          <FormField label="Margem estimada (%)"><MaskedInput className={fieldClassName} formatter={formatPercent} name="margin" inputMode="numeric" placeholder="40%" required /></FormField>
          <div className="sm:col-span-2"><FormField label="Materiais"><input className={fieldClassName} name="materials" required /></FormField></div>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button type="submit">Salvar procedimento</Button></div>
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
  const [quoteRows, setQuoteRows] = useState<Quote[]>(quotes);

  function saveQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const patient = String(form.get("patient"));
    const total = currency.format(parseCurrency(form.get("total")));
    setQuoteRows((current) => [{ patient, items: String(form.get("items")), total, status: "Pendente", expires: String(form.get("expires")) }, ...current]);
    onCreateClose(); onSaved?.(`Orçamento de ${patient} foi criado.`);
  }

  function sendQuote(index: number) {
    setQuoteRows((current) => current.map((quote, currentIndex) => currentIndex === index ? { ...quote, status: "Enviado" } : quote));
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
      <MiniTable
        columns={["Paciente", "Itens", "Total", "Status", "Validade", "Ação"]}
        rows={quoteRows.map((quote, index) => [
          <strong className="text-[#121733]" key={quote.patient}>{quote.patient}</strong>,
          quote.items,
          <span className="font-black text-[#1438ff]" key={quote.total}>{quote.total}</span>,
          <StatusBadge key={quote.status} status={quote.status} />,
          quote.expires,
          <Button key="send" size="sm" variant="secondary" disabled={quote.status === "Enviado"} onClick={() => sendQuote(index)}>{quote.status === "Enviado" ? "Enviado" : "Enviar"}</Button>,
        ])}
      />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Exemplo de composição</CardTitle>
          <FileText className="h-5 w-5 text-[#1438ff]" />
        </CardHeader>
        <CardContent>
          <div className="hp-list-stagger max-w-xl space-y-3 rounded-[8px] bg-[#f7f9fd] p-5 text-sm">
            {[
              ["Preenchimento labial", "R$ 1.200"],
              ["Botox", "R$ 900"],
              ["Bioestimulador", "R$ 2.500"],
            ].map(([item, value]) => (
              <div className="flex justify-between gap-4" key={item}>
                <span className="text-[#3f485f]">{item}</span>
                <strong className="text-[#121733]">{value}</strong>
              </div>
            ))}
            <div className="border-t border-[#dfe4f2] pt-3">
              <div className="flex justify-between gap-4 text-lg">
                <strong>Total</strong>
                <strong className="text-[#1438ff]">R$ 4.600</strong>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Modal open={openCreate} onClose={onCreateClose} title="Novo orçamento" description="Crie uma proposta comercial para o cliente.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveQuote}>
          <FormField label="Paciente"><input className={fieldClassName} name="patient" required /></FormField>
          <FormField label="Validade"><MaskedInput className={fieldClassName} formatter={formatDate} name="expires" inputMode="numeric" maxLength={10} placeholder="30/09/2026" required /></FormField>
          <div className="sm:col-span-2"><FormField label="Procedimentos"><input className={fieldClassName} name="items" placeholder="Botox, preenchimento..." required /></FormField></div>
          <div className="sm:col-span-2"><FormField label="Valor total"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="total" inputMode="decimal" placeholder="R$ 0,00" required /></FormField></div>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button type="submit">Salvar orçamento</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function PaymentsSection({ openCreate = false, onCreateOpen, onCreateClose = () => {}, onSaved }: CreateProps) {
  const [paymentRows, setPaymentRows] = useState<Payment[]>(payments);
  const [methodFilter, setMethodFilter] = useState("Todos");
  const visiblePayments = methodFilter === "Todos" ? paymentRows : paymentRows.filter((item) => item.method === methodFilter);

  function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const patient = String(form.get("patient"));
    setPaymentRows((current) => [{ patient, value: currency.format(parseCurrency(form.get("value"))), method: String(form.get("method")), date: "21 set. 2026", status: String(form.get("status")), installments: String(form.get("installments")) }, ...current]);
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
      <MiniTable
        columns={["Paciente", "Valor", "Forma", "Data", "Status", "Parcelamento"]}
        rows={visiblePayments.map((payment) => [
          <strong className="text-[#121733]" key={payment.patient}>{payment.patient}</strong>,
          <span className="font-black text-[#1438ff]" key={payment.value}>{payment.value}</span>,
          payment.method,
          payment.date,
          <StatusBadge key={payment.status} status={payment.status} />,
          payment.installments,
        ])}
      />
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
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={onCreateClose}>Cancelar</Button><Button type="submit">Registrar pagamento</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function FinanceSection() {
  const [activePeriod, setActivePeriod] = useState("Mês");
  const financialSummary: Record<string, string[]> = {
    Hoje: ["R$ 3.250", "R$ 620", "R$ 2.630", "R$ 900", "R$ 2.350"],
    Semana: ["R$ 9.870", "R$ 2.140", "R$ 7.730", "R$ 3.420", "R$ 8.970"],
    Mês: ["R$ 18.450", "R$ 5.200", "R$ 13.250", "R$ 8.740", "R$ 49.800"],
    "Período personalizado": ["R$ 62.900", "R$ 18.780", "R$ 44.120", "R$ 8.740", "R$ 54.160"],
  };
  const values = financialSummary[activePeriod];

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
          {financialByProcedure.map((item, index) => (
            <div key={item.name}>
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-black text-[#121733]">{item.name}</p>
                <p className="text-sm text-[#65708b]">
                  Receita: <strong>{item.revenue}</strong> · Custos:{" "}
                  <strong>{item.cost}</strong> · Resultado:{" "}
                  <strong>{item.result}</strong>
                </p>
              </div>
              <ProgressBar value={[82, 76, 68][index]} tone={index === 2 ? "purple" : "green"} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function ReportsSection() {
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

export function SettingsSection() {
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
          <button className="text-left" key={title} onClick={() => { setEditing(title); setSaved(false); }}><Card className="h-full p-5 transition hover:border-[#5147dc]">
            <Sparkles className="mb-4 h-5 w-5 text-[#1438ff]" />
            <p className="font-black text-[#121733]">{title}</p>
            <p className="mt-2 text-sm leading-6 text-[#65708b]">{description}</p>
          </Card></button>
        ))}
      </div>
      <div className="mt-6">
        <EmptyState
          title="Integrações ficam para uma próxima etapa"
          description="Este MVP prioriza a interface, o fluxo clínico e a lógica de custo real antes de conectar banco de dados e automações."
        />
      </div>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Configurar ${editing ?? ""}`} description="Essas preferências ficam salvas durante esta sessão.">
        {saved ? <div className="rounded-[7px] bg-[#eaf8ef] p-5 text-sm font-bold text-[#157a3b]">Configurações salvas com sucesso.</div> : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setSaved(true); }}>
          <FormField label="Nome de exibição"><input className={fieldClassName} defaultValue={editing ?? "Harmonize+"} /></FormField>
          <FormField label="Preferência principal"><select className={fieldClassName}><option>Padrão da clínica</option><option>Personalizado</option><option>Somente administradores</option></select></FormField>
          <label className="flex items-center gap-3 rounded-[7px] border border-[#e5e5ee] p-4 text-xs font-semibold text-[#555668]"><input type="checkbox" defaultChecked /> Ativar esta configuração</label>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button type="submit">Salvar alterações</Button></div>
        </form>}
      </Modal>
    </div>
  );
}
