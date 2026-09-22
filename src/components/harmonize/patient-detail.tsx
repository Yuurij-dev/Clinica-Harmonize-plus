"use client";

import { useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
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

const tabs = ["Dados", "Histórico", "Procedimentos", "Gastos", "Pagamentos", "Agendamentos", "Observações"];

export function PatientDetail({
  patient,
  journey,
  onBack,
}: {
  patient: Patient;
  journey: CustomerJourneyStage[];
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState("Gastos");
  const initials = patient.name.split(" ").map((part) => part[0]).slice(0, 2).join("");

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
                evaluation: "Histórico",
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
        <PatientTabContent patient={patient} activeTab={activeTab} />
      )}
    </div>
  );
}

function PatientTabContent({ patient, activeTab }: { patient: Patient; activeTab: string }) {
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

function InfoBlock({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-[#e9e9ef] bg-[#fbfbfd] p-3">
      <p className="flex items-center gap-2 text-[9px] font-bold uppercase text-[#9697a7]"><Icon className="h-3.5 w-3.5 text-[#5147dc]" />{label}</p>
      <p className="mt-2 text-xs font-semibold text-[#4f5062]">{value}</p>
    </div>
  );
}
