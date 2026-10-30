"use client";

import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { facialShortcutList, markingsCountLabel, saveIndicator } from "@/lib/facial-editor-rules";
import { saveDotClass } from "./facial-header";

function Keys({ keys }: { keys: string[] }) {
  return <span className="inline-flex items-center gap-1">{keys.map((key, index) => <span className="inline-flex items-center gap-1" key={key}>{index > 0 ? <span aria-hidden="true" className="text-muted-foreground">+</span> : null}<kbd className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-sans text-xs font-medium text-foreground">{key}</kbd></span>)}</span>;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const footerChips = [
  { keys: ["Ctrl", "Z"], label: "Desfazer" },
  { keys: ["Ctrl", "Y"], label: "Refazer" },
  { keys: ["Ctrl", "+"], label: "Zoom" },
];

/** Barra inferior: contagem de marcações, estado real do salvamento, atalhos de teclado e a lista completa deles. */
export function FacialFooter({ markings, readOnly, autosaveState, isSaving, lastSavedAt, hasRecord, onRetry }: {
  markings: number;
  readOnly: boolean;
  autosaveState: "saved" | "pending" | "saving" | "error";
  isSaving: boolean;
  lastSavedAt: number | null;
  hasRecord: boolean;
  onRetry: () => void;
}) {
  const now = useNow(30_000);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const indicator = saveIndicator({ readOnly, autosave: autosaveState, saving: isSaving, lastSavedAt, hasRecord, now });
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-2 font-semibold text-foreground"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-primary" />{markingsCountLabel(markings)}</span>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <span aria-live="polite" className="flex items-center gap-2" role="status">
          <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", saveDotClass[indicator.tone], indicator.tone === "busy" && "animate-pulse")} />
          <span className={cn(indicator.tone === "error" && "font-medium text-destructive")}>{indicator.footer}</span>
          {indicator.canRetry ? <button className="hp-accent-text rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11 max-lg:px-2" type="button" onClick={onRetry}><span className="font-semibold">Tentar novamente</span></button> : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <ul aria-label="Atalhos principais" className="hidden items-center gap-5 lg:flex">
          {footerChips.map((chip) => <li className="flex items-center gap-2" key={chip.label}><Keys keys={chip.keys} /><span>{chip.label}</span></li>)}
        </ul>
        <button className="flex items-center gap-2 rounded-sm text-foreground/80 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11" type="button" onClick={() => setShortcutsOpen(true)}><Keyboard aria-hidden="true" className="h-4 w-4" /><span className="font-medium">Atalhos de teclado</span></button>
      </div>
      <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Atalhos de teclado" description="Valem dentro da avaliação facial, fora dos campos de texto. No Mac, use Cmd no lugar de Ctrl.">
        <ul className="divide-y divide-border text-sm">
          {facialShortcutList.map((item) => <li className="flex items-center justify-between gap-4 py-2.5" key={item.label}><span>{item.label}</span><Keys keys={item.keys} /></li>)}
        </ul>
      </Modal>
    </footer>
  );
}
