"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { setupOpenEvent } from "@/lib/section-events";
import { showsSetupProgress } from "@/lib/setup-rules";
import { useCanUseSetup } from "./current-user";
import { useClinicSetup } from "./use-clinic-setup";

/** Card discreto do Dashboard enquanto a configuração inicial da clínica não foi concluída (só administrador). */
export function SetupProgressCard() {
  const enabled = useCanUseSetup();
  const { data } = useClinicSetup(enabled, true);
  if (!enabled || !data || !showsSetupProgress(data.status)) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3" role="region" aria-label="Configuração da clínica">
      <Sparkles className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-bold">Configuração da clínica: {data.percent}% concluída</p>
        <div className="mt-1.5 max-w-sm"><Progress value={data.percent} className="h-1.5" indicatorClassName="bg-primary" aria-label="Progresso da configuração da clínica" /></div>
      </div>
      <Button size="sm" onClick={() => window.dispatchEvent(new Event(setupOpenEvent))}>Continuar configuração<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
    </div>
  );
}
