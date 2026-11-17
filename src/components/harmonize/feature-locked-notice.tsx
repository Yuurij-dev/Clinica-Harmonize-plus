"use client";

import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notifyPlanBlocked } from "@/lib/client-cache";
import { featureErrorBody } from "@/lib/plan-errors";
import type { Feature } from "@/lib/plans";
import { cn } from "@/lib/utils";

/** Aviso inline (dentro de uma tela) de recurso que o plano não inclui; o botão abre o modal de planos, nunca abre sozinho. */
export function FeatureUpsellNote({ feature, children, className }: { feature: Feature; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground", className)}>
      <Lock aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 leading-5">{children}</p>
      <Button size="sm" variant="secondary" className="max-lg:min-h-11" onClick={() => notifyPlanBlocked(featureErrorBody(feature, null))}>Conhecer planos</Button>
    </div>
  );
}

/** Aviso na área principal quando a URL aponta para um módulo que o plano da clínica não inclui (em vez de redirecionar em silêncio). */
export function FeatureLockedNotice({ onSeePlans }: { onSeePlans: () => void }) {
  return (
    <section aria-labelledby="feature-locked-title" className="mx-auto mt-10 flex max-w-lg flex-col items-center rounded-2xl border border-border bg-card px-6 py-10 text-center text-card-foreground">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-primary"><Lock aria-hidden="true" className="h-5 w-5" /></span>
      <h1 className="mt-4 text-lg font-black" id="feature-locked-title">Este recurso não está disponível no seu plano</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Os dados da sua clínica ficam preservados. Conheça os planos para liberar este recurso quando quiser.</p>
      <Button className="mt-5" variant="primary" onClick={onSeePlans}>Conhecer planos</Button>
    </section>
  );
}
