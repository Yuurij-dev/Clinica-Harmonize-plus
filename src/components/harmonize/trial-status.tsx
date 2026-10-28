"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function formatTrialRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

/** Contagem regressiva do teste grátis; não renderiza nada para clínicas sem data de término. */
export function TrialStatus({ trialEndsAt, className }: { trialEndsAt?: string | null; className?: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const endsAt = trialEndsAt ? Date.parse(trialEndsAt) : Number.NaN;
    if (Number.isNaN(endsAt)) {
      const clear = window.setTimeout(() => setRemaining(null), 0);
      return () => window.clearTimeout(clear);
    }
    const update = () => setRemaining(endsAt - Date.now());
    const first = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [trialEndsAt]);

  if (remaining === null) return null;
  const expired = remaining <= 0;
  const urgent = remaining > 0 && remaining <= 24 * 60 * 60 * 1000;
  return (
    <div className={cn("flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold", expired || urgent ? "border-[#f2d59c] bg-[#fff8e7] text-[#a56400]" : "border-[#bfe7ce] bg-[#eaf8ef] text-[#247750]", className)} ><Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="sr-only" role="status">{expired ? "Teste grátis encerrado" : urgent ? "O teste grátis termina em menos de 24 horas" : ""}</span>
      <span>{expired ? "Teste grátis encerrado" : <>Teste grátis: <strong>{formatTrialRemaining(remaining)}</strong></>}</span>
    </div>
  );
}
