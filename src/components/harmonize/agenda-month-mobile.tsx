"use client";

import { useState } from "react";
import { defaultMonthDay, monthCellDays } from "@/lib/agenda-mobile-rules";
import { cn } from "@/lib/utils";

type MonthAppointment = { id: string; date: string; time: string; patient: string; procedure: string; status: string };

const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const dayKeyOf = (year: number, monthIndex: number, day: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/**
 * Mês no celular: 7 colunas que cabem na tela, com pontos coloridos por agendamento.
 * Tocar no dia mostra a lista dele logo abaixo (cartões de 44px+), que abre o mesmo detalhe do desktop.
 */
export function AgendaMonthMobile<T extends MonthAppointment>({ date, appointments, todayKey, dateKey, tone, onSelect }: {
  date: Date;
  appointments: T[];
  todayKey: string;
  dateKey: (value: Date | string) => string;
  tone: (appointment: T) => { pill: string };
  onSelect: (appointment: T) => void;
}) {
  const year = date.getFullYear();
  const monthIndex = date.getMonth();
  const byDay = new Map<string, T[]>();
  for (const item of appointments) {
    const key = dateKey(item.date);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const [picked, setPicked] = useState<{ month: string; day: number } | null>(null);
  const monthKey = `${year}-${monthIndex}`;
  const selectedDay = picked?.month === monthKey ? picked.day : defaultMonthDay(year, monthIndex, todayKey, [...byDay.keys()]);
  const selectedKey = dayKeyOf(year, monthIndex, selectedDay);
  const dayList = [...(byDay.get(selectedKey) ?? [])].sort((a, b) => a.time.localeCompare(b.time));
  const title = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(year, monthIndex, selectedDay));

  return (
    <div className="space-y-3 md:hidden">
      <div className="rounded-[8px] border border-border bg-card shadow-sm">
        <div className="grid grid-cols-7 border-b border-border">{weekdays.map((label) => <span className="py-2 text-center text-xs font-semibold text-muted-foreground" key={label}>{label}</span>)}</div>
        <div className="grid grid-cols-7">
          {monthCellDays(year, monthIndex).map((day, index) => {
            if (!day) return <span aria-hidden="true" className="h-14 border-b border-border/60 bg-muted/30" key={`empty-${index}`} />;
            const key = dayKeyOf(year, monthIndex, day);
            const items = byDay.get(key) ?? [];
            const selected = day === selectedDay;
            return (
              <button aria-label={`${day} de ${new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(date)}, ${items.length} ${items.length === 1 ? "agendamento" : "agendamentos"}`} aria-pressed={selected} className={cn("flex h-14 min-w-0 flex-col items-center justify-center gap-1 border-b border-border/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selected && "bg-accent")} key={key} type="button" onClick={() => setPicked({ month: monthKey, day })}>
                <span className={cn("grid h-7 w-7 place-items-center rounded-full text-xs font-semibold", key === todayKey ? "bg-primary text-primary-foreground" : selected ? "text-accent-foreground" : "text-foreground")}>{day}</span>
                <span className="flex h-2 items-center gap-0.5" aria-hidden="true">
                  {items.slice(0, 3).map((item) => <span className={cn("h-1.5 w-1.5 rounded-full", tone(item).pill)} key={item.id} />)}
                  {items.length > 3 ? <span className="text-xs leading-none text-muted-foreground">+</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <section aria-label={`Agendamentos de ${title}`}>
        <h4 className="mb-2 text-sm font-bold capitalize text-foreground">{title}</h4>
        {dayList.length ? (
          <ul className="space-y-2">
            {dayList.map((item) => (
              <li key={item.id}>
                <button className="flex min-h-14 w-full items-center gap-3 rounded-[8px] border border-border bg-card px-3 py-2 text-left shadow-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" onClick={() => onSelect(item)}>
                  <span className="w-12 shrink-0 text-sm font-bold tabular-nums text-foreground">{item.time}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-foreground">{item.patient}</span><span className="block truncate text-xs text-muted-foreground">{item.procedure}</span></span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", tone(item).pill)}>{item.status}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-[8px] border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">Nenhum agendamento neste dia.</p>}
      </section>
    </div>
  );
}
