"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

type ClinicTimePickerProps = {
  openingTime: string;
  closingTime: string;
  latestTime?: string | null;
  value: string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
};

export function ClinicTimePicker({ openingTime, closingTime, latestTime, value, invalid = false, disabled = false, onChange, className }: ClinicTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [draftHour, setDraftHour] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const opening = parseClockMinutes(openingTime);
  const closing = parseClockMinutes(closingTime);
  const latest = latestTime === undefined ? closing === null ? null : closing - 1 : latestTime === null ? -1 : parseClockMinutes(latestTime);
  const firstMinute = opening ?? 0;
  const lastMinute = latest ?? -1;
  const hours = lastMinute >= firstMinute
    ? Array.from({ length: Math.floor(lastMinute / 60) - Math.floor(firstMinute / 60) + 1 }, (_, index) => Math.floor(firstMinute / 60) + index)
    : [];
  const selectedMinutes = parseClockMinutes(value);
  const selectedHour = selectedMinutes === null ? null : Math.floor(selectedMinutes / 60);
  const selectedMinute = selectedMinutes === null ? null : selectedMinutes % 60;
  const activeHour = hours.includes(draftHour ?? -1) ? draftHour : hours.includes(selectedHour ?? -1) ? selectedHour : hours[0] ?? null;
  const minutes = activeHour === null ? [] : Array.from({ length: 60 }, (_, minute) => minute)
    .filter((minute) => activeHour * 60 + minute >= firstMinute && activeHour * 60 + minute <= lastMinute);

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

  return <div ref={rootRef} className="relative">
    <button type="button" disabled={disabled || !hours.length} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setDraftHour(selectedHour); setOpen((current) => !current); }} className={cn("flex h-10 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-left text-xs transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60", invalid && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]", className)}>
      <span className={value ? "text-foreground" : "text-muted-foreground"}>{value || "Selecione o horário"}</span>
      <Clock3 className="h-4 w-4 text-muted-foreground" />
    </button>
    {open ? <div className="absolute left-0 top-full z-40 mt-1 grid w-[156px] grid-cols-2 overflow-hidden rounded-md border border-border bg-popover text-sm text-popover-foreground shadow-lg" role="group" aria-label="Horários disponíveis">
      <div className="max-h-60 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-r border-border p-1" role="listbox" aria-label="Hora">
        {hours.map((hour) => <button type="button" role="option" aria-selected={hour === activeHour} className={cn("block w-full rounded-sm px-3 py-1.5 text-left", hour === activeHour ? "bg-primary text-primary-foreground" : "hover:bg-accent")} key={hour} onClick={() => setDraftHour(hour)}>{String(hour).padStart(2, "0")}</button>)}
      </div>
      <div className="max-h-60 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden p-1" role="listbox" aria-label="Minuto">
        {minutes.map((minute) => <button type="button" role="option" aria-selected={selectedHour === activeHour && selectedMinute === minute} className={cn("block w-full rounded-sm px-3 py-1.5 text-left", selectedHour === activeHour && selectedMinute === minute ? "bg-primary text-primary-foreground" : "hover:bg-accent")} key={minute} onClick={() => { onChange(`${String(activeHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`); setOpen(false); }}>{String(minute).padStart(2, "0")}</button>)}
      </div>
    </div> : null}
  </div>;
}

function parseClockMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}
