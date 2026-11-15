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
        "relative flex flex-col rounded-2xl border bg-white p-5 text-[#1b2150]",
        plan.recommended ? "border-2 border-[#5147dc] shadow-[0_12px_32px_rgba(81,71,220,0.18)] lg:-my-2 lg:py-7" : "border-[#dcdcf0] shadow-[0_4px_14px_rgba(27,33,80,0.05)]",
        premium && "bg-gradient-to-b from-[#f6f5ff] to-white",
      )}
    >
      {plan.recommended ? <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#5147dc] px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white">Mais popular</span> : null}
      <h3 className="text-base font-black">{plan.name}</h3>
      <p className="mt-1 min-h-10 text-xs leading-5 text-[#6b6f93]">{plan.description}</p>
      <p className="mt-4 flex items-baseline gap-1"><span className="text-2xl font-black">{plan.price}</span><span className="text-xs font-semibold text-[#6b6f93]">{plan.priceSuffix}</span></p>
      <ul className="mt-4 flex-1 space-y-2.5 text-xs font-medium">
        {plan.benefits.map((benefit) => (
          <li className="flex items-start gap-2" key={benefit}><Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5147dc]" /><span>{benefit}</span></li>
        ))}
      </ul>
      <button
        className={cn(
          "mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5147dc]",
          plan.recommended ? "bg-[#5147dc] text-white hover:bg-[#4338ca]" : premium ? "border border-[#5147dc] bg-white text-[#5147dc] hover:bg-[#f1efff]" : "border border-[#dcdcf0] bg-white text-[#1b2150] hover:bg-[#f6f5ff]",
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
    <Modal open={open} title="Seu teste grátis chegou ao fim" description="Escolha o plano ideal para continuar cuidando da sua clínica." onClose={onClose} hideHeader mascot={false} panelClassName="max-w-5xl bg-white" bodyClassName="p-0 sm:p-0">
      <div className="relative px-4 pb-6 pt-6 text-[#1b2150] sm:px-8 sm:pb-7">
        <DialogPrimitive.Close asChild>
          <button aria-label="Fechar" className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full text-[#6b6f93] transition hover:bg-[#f1efff] focus-visible:outline-2 focus-visible:outline-[#5147dc]" type="button"><X className="h-4 w-4" /></button>
        </DialogPrimitive.Close>
        <div className="flex justify-center"><Image alt="Harmonize+" className="h-auto w-[150px]" height={300} src="/brand/logo-horizontal.svg" unoptimized width={1200} /></div>
        <h2 aria-hidden="true" className="mt-5 text-center text-xl font-black sm:text-2xl">Seu teste grátis chegou ao fim</h2>
        <p aria-hidden="true" className="mt-1 text-center text-sm text-[#6b6f93]">Escolha o plano ideal para continuar cuidando da sua clínica.</p>
        {feature ? (
          <p className="mx-auto mt-4 flex w-fit max-w-full items-center gap-2 rounded-full border border-[#dcdcf0] bg-[#f6f5ff] px-4 py-2 text-xs font-semibold"><Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#5147dc]" /><span>Você tentou acessar: <strong>{feature}</strong></span></p>
        ) : null}
        <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
          {plans.map((plan) => <PlanCard key={plan.id} plan={plan} />)}
        </div>
        <p className="mt-5 text-center text-xs text-[#6b6f93]">Precisa de ajuda para escolher? <button className="font-semibold text-[#4938f4] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#5147dc]" onClick={() => toast("Fale com o administrador da clínica ou com o suporte do Harmonize+.", { duration: 3600 })} type="button">Falar com suporte</button></p>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-[#6b6f93]"><Lock aria-hidden="true" className="h-3 w-3" />Seus dados permanecem seguros.</p>
      </div>
    </Modal>
  );
}
