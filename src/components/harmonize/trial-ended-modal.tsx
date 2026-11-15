"use client";

import Image from "next/image";
import { Check, Lock, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { PLAN_CHECKOUT_SOON_MESSAGE, planOffers, type PlanOffer } from "@/data/plans";
import { cn } from "@/lib/utils";

type TrialEndedModalProps = {
  open: boolean;
  /** Nome da funcionalidade que o usuário tentou acessar (ex.: "Relatórios"). */
  feature: string | null;
  onClose: () => void;
  plans?: PlanOffer[];
};

function PlanCard({ plan }: { plan: PlanOffer }) {
  const premium = plan.id === "premium";
  return (
    <article
      aria-label={plan.name}
      className={cn(
        "relative flex flex-col rounded-2xl border bg-card p-5 text-foreground",
        plan.recommended ? "border-2 border-primary shadow-[0_12px_32px_rgba(81,71,220,0.22)] lg:-my-2 lg:py-7" : "border-border shadow-[0_4px_14px_rgba(27,33,80,0.05)]",
        premium && "bg-muted/50",
      )}
    >
      {plan.recommended ? <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-[10px] font-black uppercase tracking-wide text-primary-foreground">Mais popular</span> : null}
      <h3 className="text-base font-black">{plan.name}</h3>
      <p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">{plan.description}</p>
      <p className="mt-4 flex items-baseline gap-1"><span className="text-2xl font-black">{plan.price}</span><span className="text-xs font-semibold text-muted-foreground">{plan.priceSuffix}</span></p>
      <ul className="mt-4 flex-1 space-y-2.5 text-xs font-medium">
        {plan.benefits.map((benefit) => (
          <li className="flex items-start gap-2" key={benefit}><Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /><span>{benefit}</span></li>
        ))}
      </ul>
      <button
        className={cn(
          "mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          plan.recommended ? "bg-primary text-primary-foreground hover:bg-primary/90" : premium ? "border border-primary bg-card text-primary hover:bg-muted" : "border border-border bg-card text-foreground hover:bg-muted",
        )}
        onClick={() => toast(PLAN_CHECKOUT_SOON_MESSAGE, { duration: 3600 })}
        type="button"
      >
        Assinar plano
      </button>
    </article>
  );
}

/** Modal de encerramento do teste grátis: abre só quando o usuário tenta usar algo bloqueado (nunca sozinho). Planos mockados em data/plans.ts. */
export function TrialEndedModal({ open, feature, onClose, plans = planOffers }: TrialEndedModalProps) {
  return (
    <Modal open={open} title="Seu teste grátis chegou ao fim" description="Escolha o plano ideal para continuar cuidando da sua clínica." onClose={onClose} hideHeader mascot={false} panelClassName="max-w-5xl" bodyClassName="p-0 sm:p-0">
      <div className="relative px-4 pb-6 pt-6 text-foreground sm:px-8 sm:pb-7">
        <DialogPrimitive.Close asChild>
          <button aria-label="Fechar" className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" type="button"><X className="h-4 w-4" /></button>
        </DialogPrimitive.Close>
        <div className="flex justify-center"><Image alt="Harmonize+" className="h-auto w-[150px] hp-logo-light" height={300} src="/brand/logo-horizontal.svg" unoptimized width={1200} /><Image alt="Harmonize+" className="hp-logo-dark h-auto w-[150px]" height={300} src="/brand/logo-horizontal-white.svg" unoptimized width={1200} /></div>
        <h2 aria-hidden="true" className="mt-5 text-center text-xl font-black sm:text-2xl">Seu teste grátis chegou ao fim</h2>
        <p aria-hidden="true" className="mt-1 text-center text-sm text-muted-foreground">Escolha o plano ideal para continuar cuidando da sua clínica.</p>
        {feature ? (
          <p className="mx-auto mt-4 flex w-fit max-w-full items-center gap-2 rounded-full border border-border bg-muted px-4 py-2 text-xs font-semibold"><Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" /><span>Você tentou acessar: <strong>{feature}</strong></span></p>
        ) : null}
        <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
          {plans.map((plan) => <PlanCard key={plan.id} plan={plan} />)}
        </div>
        <p className="mt-5 text-center text-xs text-muted-foreground">Precisa de ajuda para escolher? <button className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => toast("Fale com o administrador da clínica ou com o suporte do Harmonize+.", { duration: 3600 })} type="button">Falar com suporte</button></p>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground"><Lock aria-hidden="true" className="h-3 w-3" />Seus dados permanecem seguros.</p>
      </div>
    </Modal>
  );
}
