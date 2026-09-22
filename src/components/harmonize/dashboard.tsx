import { CalendarCheck, ChevronRight, Plus, RotateCcw, TrendingUp } from "lucide-react";
import {
  appointments,
  patients,
  quotes,
  revenueBars,
  stats,
} from "@/data/mock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailCard, ProgressBar, StatusBadge } from "./shared";
import type { SectionId } from "@/types/clinic";

export function Dashboard({ onAction, onNavigate }: { onAction: (action: "client" | "appointment" | "quote" | "payment") => void; onNavigate: (section: SectionId) => void }) {
  const actions = [
    ["Novo cliente", "client"], ["Novo atendimento", "appointment"], ["Novo orçamento", "quote"], ["Registrar pagamento", "payment"],
  ] as const;
  return (
    <div className="space-y-5">
      <div className="hp-page-enter border-b border-[#ececf2] pb-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold text-[#8c8d9f]">Domingo, 20 de setembro</p>
            <h2 className="mt-1 text-xl font-bold text-[#25263a]">Olá, Dra. Ana</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[#8c8d9f]">
              Acompanhe os números e os próximos atendimentos da sua clínica.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-[560px] lg:justify-end">
            {actions.map(
              ([label, action]) => (
                <Button
                  className="min-w-fit whitespace-nowrap"
                  key={action}
                  variant={action === "appointment" ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => onAction(action)}
                >
                  <Plus className="h-4 w-4" />
                  {label}
                </Button>
              ),
            )}
          </div>
        </div>
      </div>

      <div className="hp-list-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase text-[#8c8d9f]">{stat.label}</p>
              <TrendingUp className="h-3.5 w-3.5 text-[#5147dc]" />
            </div>
            <p className="mt-3 text-xl font-bold text-[#25263a]">
              {stat.value}
            </p>
            <p className="mt-1 text-[10px] font-medium text-[#9798a8]">{stat.detail}</p>
          </Card>
        ))}
      </div>

      <div className="hp-list-stagger grid gap-5 xl:grid-cols-[1.45fr_0.9fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Receita e resultado</CardTitle>
              <p className="mt-1 text-sm text-[#65708b]">
                Evolução mensal com tendência positiva no mix de procedimentos.
              </p>
            </div>
            <Badge variant="green">+18,4%</Badge>
          </CardHeader>
          <CardContent>
            <div className="flex h-56 items-end gap-3 border-b border-[#e8e8ef] bg-[#fcfcfe] p-4">
              {revenueBars.map((bar, index) => (
                <div className="flex h-full flex-1 flex-col items-center justify-end gap-2" key={index}>
                  <div
                    className="min-h-2 w-full rounded-t-[3px] bg-[#5a50df] opacity-90 transition-[height,opacity,transform] duration-700 ease-out hover:opacity-100 hover:scale-y-105"
                    style={{ height: `${bar}%` }}
                  />
                  <span className="text-[10px] font-bold text-[#7c86a2]">
                    {index + 1}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Próximos atendimentos</CardTitle>
            <CalendarCheck className="h-5 w-5 text-[#1438ff]" />
          </CardHeader>
          <CardContent className="hp-list-stagger space-y-4">
            {appointments.slice(0, 4).map((appointment) => (
              <div
                className="flex cursor-pointer items-center gap-3 border-b border-[#f0f0f4] pb-3 transition-[transform,background-color] duration-200 hover:translate-x-1 last:border-0 last:pb-0"
                key={`${appointment.time}-${appointment.patient}`}
                onClick={() => onNavigate("agenda")}
              >
                <div className="grid h-9 w-12 place-items-center border-l-2 border-[#5147dc] bg-[#f7f6ff] text-xs font-bold text-[#5147dc]">
                  {appointment.time}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-[#121733]">
                    {appointment.patient}
                  </p>
                  <p className="truncate text-xs text-[#65708b]">
                    {appointment.procedure}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-[#bbbcc8]" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="hp-list-stagger grid gap-6 lg:grid-cols-3">
        <DetailCard title="Clientes recentes">
          <div className="space-y-4">
            {patients.slice(0, 3).map((patient) => (
              <div className="flex items-center justify-between gap-3" key={patient.name}>
                <div>
                  <p className="font-bold text-[#121733]">{patient.name}</p>
                  <p className="text-sm text-[#65708b]">{patient.lastVisit}</p>
                </div>
                <StatusBadge status={patient.status} />
              </div>
            ))}
          </div>
        </DetailCard>

        <DetailCard title="Orçamentos recentes">
          <div className="space-y-4">
            {quotes.map((quote) => (
              <div key={quote.patient}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold text-[#121733]">{quote.patient}</p>
                  <span className="text-sm font-black text-[#1438ff]">
                    {quote.total}
                  </span>
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-[#65708b]">
                  {quote.items}
                </p>
              </div>
            ))}
          </div>
        </DetailCard>

        <DetailCard title="Retornos próximos">
          <div className="mb-5 rounded-[8px] bg-[#eaf8ef] p-4">
            <div className="flex items-center gap-3">
              <RotateCcw className="h-5 w-5 text-[#157a3b]" />
              <p className="font-black text-[#157a3b]">
                8 pacientes possuem retorno nos próximos 7 dias.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-bold text-[#121733]">Pagamentos recebidos</span>
                <span className="text-[#65708b]">82%</span>
              </div>
              <ProgressBar value={82} tone="green" />
            </div>
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-bold text-[#121733]">Pendências do mês</span>
                <span className="text-[#65708b]">31%</span>
              </div>
              <ProgressBar value={31} tone="amber" />
            </div>
          </div>
        </DetailCard>
      </div>
    </div>
  );
}
