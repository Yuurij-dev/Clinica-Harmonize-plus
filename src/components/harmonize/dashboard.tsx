"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarDays, ChevronRight, RotateCcw, Plus, TrendingUp, UserPlus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUpValue, DetailCard, LoadingSkeleton, PageContainer, ProgressBar, StatCard, StatusBadge } from "./shared";
import type { SectionId } from "@/types/clinic";
import { getCachedJson, readClientCache } from "@/lib/client-cache";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function Dashboard({ onAction, onNavigate, userName = "Usuário" }: { onAction: (action: "client" | "appointment" | "quote" | "payment") => void; onNavigate: (section: SectionId, focus?: { date: string; time: string }) => void; userName?: string }) {
  type DashboardData = { appointments: Array<{ id: string; date: string; time: string; procedure: string; status: string; patient?: { name: string } | null }>; patients: Array<{ name: string; status: string; lastVisit: string | null; createdAt: string }>; quotes: Array<{ id: string; items: string; total: number; status: string; patient?: { name: string } | null }>; payments: Array<{ value: number; status: string; date: string }> };
  const cachedDashboard = readClientCache<DashboardData>("/api/dashboard/bootstrap");
  const [data, setData] = useState<DashboardData | null>(cachedDashboard ?? null);
  const [now, setNow] = useState(() => clinicNow());
  useEffect(() => {
    getCachedJson<DashboardData>("/api/dashboard/bootstrap")
      .then((dashboardData) => setData({ appointments: dashboardData.appointments ?? [], patients: dashboardData.patients ?? [], quotes: dashboardData.quotes ?? [], payments: dashboardData.payments ?? [] }))
      .catch(() => setData({ appointments: [], patients: [], quotes: [], payments: [] }));
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(clinicNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const paid = data?.payments.filter((item) => item.status === "Pago").reduce((sum, item) => sum + item.value, 0) ?? 0;
    const pending = data?.quotes.filter((item) => item.status !== "Aprovado").reduce((sum, item) => sum + item.total, 0) ?? 0;
    return [
      { label: "Receita", value: paid, format: (currentValue: number) => currency.format(Math.round(currentValue)), detail: "Pagamentos registrados" },
      { label: "Despesas", value: 0, format: (currentValue: number) => currency.format(Math.round(currentValue)), detail: "Sem despesas cadastradas" },
      { label: "Resultado", value: paid, format: (currentValue: number) => currency.format(Math.round(currentValue)), detail: "Receita líquida" },
      { label: "Atendimentos", value: data?.appointments.length ?? 0, detail: "Na clínica" },
      { label: "Retornos", value: data?.patients.filter((item) => item.status === "Retorno").length ?? 0, detail: "Clientes em retorno" },
      { label: "Orçamentos", value: data?.quotes.length ?? 0, detail: `${currency.format(pending)} em aberto` },
    ];
  }, [data]);
  const attendance = useMemo(() => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const chartDays = 30;
    const currentDaily = dailyAppointmentTotals(data?.appointments ?? [], monthStart, chartDays);
    const previousDaily = dailyAppointmentTotals(data?.appointments ?? [], previousMonthStart, chartDays);
    const currentTotal = currentDaily.reduce((sum, value) => sum + value, 0);
    const previousTotal = previousDaily.reduce((sum, value) => sum + value, 0);
    const currentNewClients = (data?.patients ?? []).filter((patient) => isInMonth(patient.createdAt, monthStart)).length;
    const previousNewClients = (data?.patients ?? []).filter((patient) => isInMonth(patient.createdAt, previousMonthStart)).length;
    const currentReturnAppointments = (data?.appointments ?? []).filter((appointment) => isInMonth(appointment.date, monthStart) && isReturnAppointment(appointment.procedure)).length;
    const previousReturnAppointments = (data?.appointments ?? []).filter((appointment) => isInMonth(appointment.date, previousMonthStart) && isReturnAppointment(appointment.procedure)).length;
    const currentReturnRate = currentTotal ? Math.round((currentReturnAppointments / currentTotal) * 100) : 0;
    const previousReturnRate = previousTotal ? Math.round((previousReturnAppointments / previousTotal) * 100) : 0;
    return {
      label: new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(monthStart),
      currentDaily,
      previousDaily,
      currentTotal,
      previousTotal,
      currentNewClients,
      previousNewClients,
      currentReturnRate,
      previousReturnRate,
    };
  }, [data, now]);
  const upcomingAppointments = useMemo(
    () => (data?.appointments ?? [])
      .filter((appointment) => appointmentTimestamp(appointment.date, appointment.time) >= now.getTime())
      .sort((first, second) => appointmentTimestamp(first.date, first.time) - appointmentTimestamp(second.date, second.time))
      .slice(0, 4),
    [data, now],
  );
  const paymentProgress = useMemo(() => {
    const payments = data?.payments ?? [];
    const total = payments.reduce((sum, payment) => sum + payment.value, 0);
    const received = payments.filter((payment) => payment.status === "Pago").reduce((sum, payment) => sum + payment.value, 0);
    return { received: total ? Math.round((received / total) * 100) : 0, pending: total ? Math.round(((total - received) / total) * 100) : 0 };
  }, [data]);
  const actions = [
    ["Novo cliente", "client"], ["Novo atendimento", "appointment"], ["Novo orçamento", "quote"], ["Registrar pagamento", "payment"],
  ] as const;
  return (
    <PageContainer>
      <div className="hp-page-enter border-b border-border pb-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date())}</p>
            <h2 className="mt-1 text-xl font-bold text-foreground">Olá, {userName}</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
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
          <StatCard key={stat.label} label={stat.label} value={<CountUpValue value={stat.value} format={stat.format} />} detail={stat.detail} icon={TrendingUp} />
        ))}
      </div>

      <div className="hp-list-stagger grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="gap-4">
            <div>
              <CardTitle>Atendimentos no mês</CardTitle>
              <p className="mt-1 text-sm text-[#65708b]">Evolução diária de atendimentos com comparação ao mês anterior.</p>
            </div>
            <div className="relative shrink-0">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5147dc]" />
              <select className="rounded-[7px] border border-[#dddfea] bg-white py-2 pl-8 pr-8 text-xs font-semibold text-[#555668] outline-none focus:border-[#5147dc]" aria-label="Mês dos atendimentos" defaultValue={attendance.label}>
                <option value={attendance.label}>{attendance.label.charAt(0).toUpperCase() + attendance.label.slice(1)}</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-5 grid auto-rows-fr gap-2 sm:grid-cols-3">
              <AttendanceMetric icon={CalendarCheck} label="Atendimentos realizados" value={attendance.currentTotal} change={percentageChange(attendance.currentTotal, attendance.previousTotal)} comparison={attendance.previousTotal ? attendance.previousTotal : null} />
              <AttendanceMetric icon={UserPlus} label="Novos clientes" value={attendance.currentNewClients} change={percentageChange(attendance.currentNewClients, attendance.previousNewClients)} comparison={attendance.previousNewClients ? attendance.previousNewClients : null} />
              <AttendanceMetric icon={RotateCcw} label="Taxa de retorno" value={`${attendance.currentReturnRate}%`} change={attendance.previousTotal ? attendance.currentReturnRate - attendance.previousReturnRate : null} comparison={attendance.previousTotal ? `${attendance.previousReturnRate}%` : null} suffix="p.p." />
            </div>
            <AttendanceChart current={attendance.currentDaily} previous={attendance.previousDaily} month={now} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Próximos atendimentos</CardTitle>
            <CalendarCheck className="h-5 w-5 text-[#1438ff]" />
          </CardHeader>
          <CardContent className="hp-list-stagger space-y-4">
            {!data ? <div className="space-y-4">{[0, 1, 2, 3].map((item) => <div className="flex items-center gap-3" key={item}><LoadingSkeleton className="h-9 w-12" /><div className="flex-1 space-y-2"><LoadingSkeleton className="h-3 w-2/3" /><LoadingSkeleton className="h-2.5 w-1/2" /></div></div>)}</div> : upcomingAppointments.length ? upcomingAppointments.map((appointment) => (
              <div
                className="flex cursor-pointer items-center gap-3 border-b border-[#f0f0f4] pb-3 transition-[transform,background-color] duration-200 hover:translate-x-1 last:border-0 last:pb-0"
                key={appointment.id}
                onClick={() => onNavigate("agenda", { date: appointment.date, time: appointment.time })}
              >
                <div className="grid h-9 w-12 place-items-center border-l-2 border-[#5147dc] bg-[#f7f6ff] text-xs font-bold text-[#5147dc]">
                  {appointment.time}
                </div>
                <ClientAvatar name={appointment.patient?.name ?? "Paciente"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-[#121733]">
                    {appointment.patient?.name ?? "Paciente"}
                  </p>
                  <p className="truncate text-xs text-[#65708b]">
                    {formatAppointmentDate(appointment.date)} · {appointment.procedure}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-[#bbbcc8]" />
              </div>
            )) : <p className="py-4 text-sm text-[#65708b]">Nenhum atendimento futuro agendado.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="hp-list-stagger grid gap-6 lg:grid-cols-3">
        <DetailCard title="Clientes recentes">
          <div className="space-y-4">
            {(data?.patients ?? []).slice(0, 3).map((patient) => (
              <div className="flex items-center justify-between gap-3" key={patient.name}>
                <div className="flex min-w-0 items-center gap-3">
                  <ClientAvatar name={patient.name} />
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[#121733]">{patient.name}</p>
                    <p className="text-sm text-[#65708b]">{patient.lastVisit ? new Date(patient.lastVisit).toLocaleDateString("pt-BR") : "Sem atendimento"}</p>
                  </div>
                </div>
                <StatusBadge status={patient.status} />
              </div>
            ))}
          </div>
        </DetailCard>

        <DetailCard title="Orçamentos recentes">
          <div className="space-y-4">
            {(data?.quotes ?? []).slice(0, 3).map((quote) => (
              <div key={quote.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <ClientAvatar name={quote.patient?.name ?? "Paciente"} />
                    <p className="truncate font-bold text-[#121733]">{quote.patient?.name ?? "Paciente"}</p>
                  </div>
                  <span className="text-sm font-black text-[#1438ff]">
                    {currency.format(quote.total)}
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
                {data?.patients.filter((item) => item.status === "Retorno").length ?? 0} pacientes possuem retorno registrado.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-bold text-[#121733]">Pagamentos recebidos</span>
                <span className="text-[#65708b]">{paymentProgress.received}%</span>
              </div>
              <ProgressBar value={paymentProgress.received} tone="green" />
            </div>
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-bold text-[#121733]">Pendências do mês</span>
                <span className="text-[#65708b]">{paymentProgress.pending}%</span>
              </div>
              <ProgressBar value={paymentProgress.pending} tone="amber" />
            </div>
          </div>
        </DetailCard>
      </div>
    </PageContainer>
  );
}

function ClientAvatar({ name }: { name: string }) {
  const tones = ["#5147dc", "#6257e8", "#2f9c88", "#6d5ce7"];
  const tone = tones[name.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % tones.length];
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-black text-white" style={{ backgroundColor: tone }}>{getInitials(name)}</span>;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function AttendanceMetric({ icon: Icon, label, value, change, comparison, suffix = "%" }: { icon: LucideIcon; label: string; value: number | string; change: number | null; comparison: number | string | null; suffix?: string }) {
  return (
    <div className="flex min-h-[76px] h-full min-w-0 items-start gap-3 rounded-[7px] border border-[#e4e5ef] bg-[#fbfbfe] px-3 py-2.5">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[#f0efff] text-[#5147dc]"><Icon className="h-4 w-4" /></span>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p className="truncate text-[10px] font-semibold text-[#65708b]">{label}</p>
        <div className="mt-1 flex min-w-0 items-baseline gap-2">
          <span className="text-2xl font-black leading-none tracking-tight text-[#25263a]">{value}</span>
          {change !== null ? <span className={change >= 0 ? "shrink-0 text-[10px] font-bold text-[#299b68]" : "shrink-0 text-[10px] font-bold text-[#c45d64]"}>
            {change >= 0 ? "↑" : "↓"} {Math.abs(change)}{suffix}
          </span> : null}
        </div>
        <p className="mt-1 truncate text-[9px] text-[#8c8d9f]">{comparison === null ? "Sem dados no mês anterior" : `vs. mês anterior (${comparison})`}</p>
      </div>
    </div>
  );
}

function AttendanceChart({ current, previous, month }: { current: number[]; previous: number[]; month: Date }) {
  const hasPreviousData = previous.some((value) => value > 0);
  const max = Math.max(...current, ...(hasPreviousData ? previous : []), 1);
  const chartData = current.map((value, index) => ({ day: index + 1, current: value, previous: previous[index] ?? null }));
  return (
    <div>
      <div className="h-56 border-b border-[#e8e8ef] bg-[#fcfcfe] pt-2">
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e8e8ef" strokeDasharray="3 3" vertical={false} />
            <XAxis axisLine={false} dataKey="day" tick={{ fill: "#7c86a2", fontSize: 9, fontWeight: 600 }} tickLine={false} tickMargin={8} />
            <YAxis allowDecimals={false} axisLine={false} domain={[0, max]} tick={{ fill: "#7c86a2", fontSize: 9, fontWeight: 600 }} tickLine={false} width={28} />
            <Tooltip content={<AttendanceTooltip month={month} />} cursor={{ fill: "rgba(90,80,223,0.06)" }} />
            <Bar dataKey="current" fill="#5a50df" name="Atendimentos deste mês" radius={[3, 3, 0, 0]} />
            {hasPreviousData ? <Line dataKey="previous" dot={false} name="Mês anterior" stroke="#858b9b" strokeDasharray="4 5" strokeWidth={2} type="monotone" /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex items-center justify-center gap-5 text-[10px] font-semibold text-[#7c86a2]">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] bg-[#5a50df]" />Atendimentos deste mês</span>
        {hasPreviousData ? <span className="flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-[#858b9b]" />Mês anterior</span> : null}
      </div>
    </div>
  );
}

function AttendanceTooltip({ active, label, month, payload }: { active?: boolean; label?: string | number; month: Date; payload?: Array<{ dataKey?: string; value?: number | string }> }) {
  if (!active || !payload?.length) return null;
  const current = payload.find((entry) => entry.dataKey === "current")?.value ?? 0;
  return <div className="rounded-[6px] border border-[#343b59] bg-[#191c2b] px-3 py-2 text-[10px] font-semibold text-white shadow-[0_8px_22px_rgba(0,0,0,0.2)]"><p>{formatChartDate(month, Number(label))}</p><p className="mt-1 text-[#aaa3ff]">{current} {Number(current) === 1 ? "atendimento" : "atendimentos"}</p></div>;
}

function dailyAppointmentTotals(appointments: Array<{ date: string }>, month: Date, days: number) {
  return Array.from({ length: days }, (_, index) => appointments.filter((appointment) => {
    const date = new Date(appointment.date);
    return date.getUTCFullYear() === month.getFullYear() && date.getUTCMonth() === month.getMonth() && date.getUTCDate() === index + 1;
  }).length);
}

function isInMonth(dateValue: string, month: Date) {
  const date = new Date(dateValue);
  return date.getUTCFullYear() === month.getFullYear() && date.getUTCMonth() === month.getMonth();
}

function isReturnAppointment(procedure: string) {
  return procedure.toLocaleLowerCase("pt-BR").includes("retorno");
}

function percentageChange(current: number, previous: number) {
  return previous ? Math.round(((current - previous) / previous) * 100) : null;
}

function formatChartDate(month: Date, day: number) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" }).format(new Date(month.getFullYear(), month.getMonth(), day));
}

function clinicNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
}

function appointmentTimestamp(date: string, time: string) {
  const appointmentDate = new Date(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  return new Date(appointmentDate.getUTCFullYear(), appointmentDate.getUTCMonth(), appointmentDate.getUTCDate(), Number(clock?.[1] ?? 0), Number(clock?.[2] ?? 0)).getTime();
}

function formatAppointmentDate(date: string) {
  const appointmentDate = new Date(date);
  return appointmentDate.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
