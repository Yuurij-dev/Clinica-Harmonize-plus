"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  Clock3,
  CreditCard,
  FileText,
  Mail,
  MapPin,
  Phone,
  Sparkles,
} from "lucide-react";
import type { CustomerJourneyStage, Patient } from "@/types/clinic";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CustomerJourney } from "./customer-journey";
import { PatientExpenses } from "./patient-expenses";
import { PhotoEditor } from "./photo-editor/photo-editor";
import { EmptyState } from "./shared";
import { getCachedJson } from "@/lib/client-cache";

const tabs = ["Dados", "Avaliação", "Histórico", "Procedimentos", "Gastos", "Pagamentos", "Agendamentos", "Observações"];

type PatientProcedureRecord = {
  name: string;
  date: string;
  professional: string;
  status: string;
  beforePhoto: string;
  afterPhoto: string;
};

type PatientAppointmentRecord = {
  date: string;
  time: string;
  procedure: string;
  professional: string;
  status: string;
};

type PatientPaymentRecord = {
  procedure: string;
  value: string;
  method: string;
  status: string;
  disabled?: boolean;
  disabledReason?: string;
};

type PatientHistoryRecord = {
  procedures: PatientProcedureRecord[];
  appointments: PatientAppointmentRecord[];
  observations: string[];
  payments: PatientPaymentRecord[];
};

export function PatientDetail({
  patient,
  journey,
  onBack,
}: {
  patient: Patient;
  journey: CustomerJourneyStage[];
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState("Avaliação");
  const [history, setHistory] = useState<PatientHistoryRecord>();
  const initials = patient.name.split(" ").map((part) => part[0]).slice(0, 2).join("");

  useEffect(() => {
    if (!patient.id) return;
    getCachedJson<{ patient?: { appointments: Array<{ date: string; time: string; procedure: string; professional: string; status: string }>; payments: Array<{ value: number; method: string; status: string; installments: string }>; evaluations: unknown[] } }>(`/api/patients/${patient.id}/history`)
      .then((data) => {
        const appointments = data.patient?.appointments ?? [];
        const payments = data.patient?.payments ?? [];
        setHistory({
          appointments: appointments.map((item) => ({ date: new Date(item.date).toLocaleDateString("pt-BR"), time: item.time, procedure: item.procedure, professional: item.professional, status: item.status })),
          procedures: appointments.filter((item) => ["Atendido", "Finalizado"].includes(item.status)).map((item) => ({ name: item.procedure, date: new Date(item.date).toLocaleDateString("pt-BR"), professional: item.professional, status: item.status, beforePhoto: "", afterPhoto: "" })),
          payments: payments.map((item) => ({ procedure: "Atendimento", value: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.value), method: item.method, status: item.status, disabled: item.status === "Pago", disabledReason: item.status === "Pago" ? "Pagamento já finalizado" : undefined })),
          observations: [],
        });
      })
      .catch(() => setHistory(undefined));
  }, [patient.id]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <button className="flex items-center gap-2 text-[11px] font-bold text-[#696a7c] hover:text-[#5147dc]" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para clientes
      </button>

      <Card className="grid overflow-hidden p-0 lg:grid-cols-[350px_minmax(0,1fr)]">
        <div className="flex items-center gap-4 border-b border-[#ececf2] p-4 lg:border-b-0 lg:border-r">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 border-[#f2f0ff] bg-[#e8e5ff] text-base font-black text-[#5147dc]">{initials}</div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-[#242538]">{patient.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#77788a]">
              <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{patient.phone}</span>
              <span>{patient.age} anos</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="green">Cliente ativo</Badge>
              <span className="rounded-full bg-[#f2f3f7] px-2.5 py-1 text-[8px] font-semibold text-[#747587]">Desde 10/09/2026</span>
            </div>
          </div>
        </div>

        <div className="min-w-0 p-4">
          <CustomerJourney
            compact
            journey={journey}
            onOpenStage={(stageId) => {
              const stageTabs = {
                lead: "Histórico",
                evaluation: "Avaliação",
                quote: "Gastos",
                procedure: "Procedimentos",
                return: "Agendamentos",
                aftercare: "Observações",
              } as const;
              setActiveTab(stageTabs[stageId]);
            }}
          />
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <div className="flex min-w-max px-2">
          {tabs.map((tab) => (
            <button
              className={cn(
                "border-b-2 px-5 py-3 text-[10px] font-semibold transition",
                activeTab === tab
                  ? "border-[#5147dc] bg-[#faf9ff] text-[#5147dc]"
                  : "border-transparent text-[#77788a] hover:text-[#4f5062]",
              )}
              key={tab}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </Card>

      {activeTab === "Gastos" ? (
        <PatientExpenses />
      ) : (
        <PatientTabContent patient={patient} activeTab={activeTab} history={history} />
      )}
    </div>
  );
}

function PatientTabContent({ patient, activeTab, history }: { patient: Patient; activeTab: string; history?: PatientHistoryRecord }) {

  if (activeTab === "Avaliação") {
    return patient.id ? <PhotoEditor patientId={patient.id} patientName={patient.name} /> : <EmptyState title="Cliente ainda não foi salvo" description="Salve o cliente antes de adicionar fotos à avaliação." />;
  }

  if (activeTab === "Histórico") {
    return <HistoryTab patient={patient} history={history} />;
  }

  if (activeTab === "Procedimentos") {
    return <ProceduresTab history={history} />;
  }

  if (activeTab === "Agendamentos") {
    return <AppointmentsTab history={history} />;
  }

  if (activeTab === "Observações") {
    return <ObservationsTab history={history} />;
  }

  if (activeTab === "Pagamentos") {
    return <PaymentsTab history={history} />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#5147dc]" />
          <h3 className="text-sm font-bold text-[#303144]">{activeTab}</h3>
        </div>
        <p className="mt-2 text-xs leading-5 text-[#858696]">Informações de {activeTab.toLowerCase()} vinculadas ao prontuário de {patient.name}.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <InfoBlock icon={Phone} label="Telefone" value={patient.phone} />
          <InfoBlock icon={Mail} label="E-mail" value={`${patient.name.toLowerCase().replaceAll(" ", ".")}@email.com`} />
          <InfoBlock icon={CalendarDays} label="Último atendimento" value={patient.lastVisit} />
          <InfoBlock icon={Clock3} label="Próximo retorno" value={patient.nextReturn} />
        </div>
      </Card>
      <Card className="p-5">
        <p className="text-[9px] font-bold uppercase text-[#a0a1af]">Resumo da cliente</p>
        <div className="mt-4 space-y-4 text-xs text-[#555668]">
          <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-[#5147dc]" />São Paulo, SP</p>
          <p><strong className="text-[#333447]">Status:</strong> acompanhamento ativo</p>
          <p><strong className="text-[#333447]">Último procedimento:</strong> harmonização facial</p>
        </div>
      </Card>
    </div>
  );
}

function EmptyPatientState({ message }: { message: string }) {
  return (
    <Card className="p-6 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#f1f0ff] text-[#5147dc]">
        <FileText className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-bold text-[#303144]">{message}</p>
      <p className="mt-1 text-xs text-[#858696]">Quando houver registros, eles aparecerão automaticamente aqui.</p>
    </Card>
  );
}

function HistoryTab({ patient, history }: { patient: Patient; history?: PatientHistoryRecord }) {
  if (!history || (!history.procedures.length && !history.appointments.length && !history.payments.length && !history.observations.length)) {
    return <EmptyPatientState message={`${patient.name} ainda não possui um histórico.`} />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#5147dc]" />
          <h3 className="text-sm font-bold text-[#303144]">Histórico do cliente</h3>
        </div>
        <div className="mt-5 space-y-3">
          {history.procedures.map((procedure) => (
            <ProcedureHistoryCard key={`${procedure.name}-${procedure.date}`} procedure={procedure} />
          ))}
          {!history.procedures.length ? <EmptyInline text="Cliente ainda não realizou procedimentos." /> : null}
        </div>
      </Card>
      <Card className="p-5">
        <p className="text-[9px] font-bold uppercase text-[#a0a1af]">Resumo</p>
        <div className="mt-4 grid gap-3 text-xs">
          <SummaryLine label="Procedimentos feitos" value={String(history.procedures.length)} />
          <SummaryLine label="Agendamentos" value={String(history.appointments.length)} />
          <SummaryLine label="Pagamentos registrados" value={String(history.payments.filter((payment) => !payment.disabled).length)} />
          <SummaryLine label="Observações" value={String(history.observations.length)} />
        </div>
      </Card>
    </div>
  );
}

function ProceduresTab({ history }: { history?: PatientHistoryRecord }) {
  if (!history?.procedures.length) return <EmptyPatientState message="Este cliente ainda não possui procedimentos realizados." />;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {history.procedures.map((procedure) => (
        <ProcedureHistoryCard key={`${procedure.name}-${procedure.date}`} procedure={procedure} />
      ))}
    </div>
  );
}

function ProcedureHistoryCard({ procedure }: { procedure: PatientProcedureRecord }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start justify-between gap-3 border-b border-[#ededf3] p-4">
        <div>
          <h3 className="text-sm font-bold text-[#303144]">{procedure.name}</h3>
          <p className="mt-1 text-xs text-[#858696]">{procedure.date} · {procedure.professional}</p>
        </div>
        <Badge variant={procedure.status === "Finalizado" ? "green" : "purple"}>{procedure.status}</Badge>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <BeforeAfterPhoto label="Antes" src={procedure.beforePhoto} />
        <BeforeAfterPhoto label="Depois" src={procedure.afterPhoto} />
      </div>
    </Card>
  );
}

function BeforeAfterPhoto({ label, src }: { label: string; src?: string }) {
  return (
    <div className="overflow-hidden rounded-[7px] border border-[#e7e9f2] bg-[#f7f8fc]">
      <div className="flex items-center gap-2 px-3 py-2 text-[9px] font-bold uppercase text-[#858696]">
        <Camera className="h-3.5 w-3.5 text-[#5147dc]" />
        {label}
      </div>
      <div className="relative grid h-40 w-full place-items-center text-xs font-semibold text-[#858696]">
        {src ? <Image className="object-cover" src={src} alt={`Foto de ${label.toLowerCase()} do procedimento`} fill sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 320px" /> : "Nenhuma foto cadastrada"}
      </div>
    </div>
  );
}

function AppointmentsTab({ history }: { history?: PatientHistoryRecord }) {
  if (!history?.appointments.length) return <EmptyPatientState message="Este cliente ainda não possui agendamentos registrados." />;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-[#303144]">Agendamentos do cliente</h3>
      <div className="mt-4 space-y-3">
        {history.appointments.map((appointment) => (
          <div className="flex flex-col gap-3 rounded-[7px] border border-[#ececf3] p-4 sm:flex-row sm:items-center sm:justify-between" key={`${appointment.date}-${appointment.time}`}>
            <div>
              <p className="text-sm font-bold text-[#303144]">{appointment.procedure}</p>
              <p className="mt-1 text-xs text-[#858696]">{appointment.date} às {appointment.time} · {appointment.professional}</p>
            </div>
            <Badge variant={appointment.status === "Atendido" ? "green" : "purple"}>{appointment.status}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ObservationsTab({ history }: { history?: PatientHistoryRecord }) {
  if (!history?.observations.length) return <EmptyPatientState message="Este cliente ainda não possui observações." />;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-[#303144]">Observações do paciente</h3>
      <div className="mt-4 space-y-3">
        {history.observations.map((observation) => (
          <div className="rounded-[7px] border border-[#ececf3] bg-[#fbfbfe] p-4 text-sm leading-6 text-[#555668]" key={observation}>
            {observation}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PaymentsTab({ history }: { history?: PatientHistoryRecord }) {
  if (!history?.payments.length) return <EmptyPatientState message="Este cliente ainda não possui pagamentos para acompanhar." />;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-[#303144]">Pagamentos do cliente</h3>
      <div className="mt-4 space-y-3">
        {history.payments.map((payment) => (
          <div
            className={cn(
              "flex flex-col gap-3 rounded-[7px] border p-4 transition sm:flex-row sm:items-center sm:justify-between",
              payment.disabled ? "border-[#ececf3] bg-[#f7f7fa] opacity-60" : "border-[#e1e4f2] bg-white",
            )}
            key={`${payment.procedure}-${payment.status}`}
          >
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-[#303144]"><CreditCard className="h-4 w-4 text-[#5147dc]" />{payment.procedure}</p>
              <p className="mt-1 text-xs text-[#858696]">{payment.value} · {payment.method}</p>
              {payment.disabledReason ? <p className="mt-1 text-[10px] font-semibold text-[#8a8b9c]">{payment.disabledReason}</p> : null}
            </div>
            <Badge variant={payment.status === "Pago" ? "green" : payment.status === "Bloqueado" ? "amber" : "purple"}>{payment.status}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EmptyInline({ text }: { text: string }) {
  return <div className="rounded-[7px] border border-dashed border-[#d9dce8] p-4 text-xs font-semibold text-[#858696]">{text}</div>;
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-[7px] bg-[#f7f8fc] px-3 py-2">
      <span className="text-[#77788a]">{label}</span>
      <strong className="text-[#303144]">{value}</strong>
    </div>
  );
}

function InfoBlock({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-[#e9e9ef] bg-[#fbfbfd] p-3">
      <p className="flex items-center gap-2 text-[9px] font-bold uppercase text-[#9697a7]"><Icon className="h-3.5 w-3.5 text-[#5147dc]" />{label}</p>
      <p className="mt-2 text-xs font-semibold text-[#4f5062]">{value}</p>
    </div>
  );
}
