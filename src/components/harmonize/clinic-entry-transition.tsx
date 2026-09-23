"use client";

import { Check, Sparkles } from "lucide-react";

export function ClinicEntryTransition({ clinicName }: { clinicName: string }) {
  return (
    <main className="clinic-entry fixed inset-0 z-[100] flex min-h-screen items-center justify-center overflow-hidden bg-[#f7fbff] px-6 text-[#17213d]">
      <div className="clinic-entry-glow clinic-entry-glow-left" />
      <div className="clinic-entry-glow clinic-entry-glow-right" />
      <div className="relative flex flex-col items-center text-center">
        <div className="clinic-entry-logo relative grid h-24 w-24 place-items-center rounded-[22px] bg-[#5147dc] text-3xl font-black text-white shadow-[0_18px_50px_rgba(81,71,220,0.28)]">
          <span className="clinic-entry-logo-shine absolute inset-0 rounded-[22px]" />
          <span className="relative">H+</span>
        </div>
        <div className="clinic-entry-check mt-5 grid h-7 w-7 place-items-center rounded-full bg-[#16b88b] text-white shadow-[0_8px_20px_rgba(22,184,139,0.2)]">
          <Check className="h-4 w-4" strokeWidth={3} />
        </div>
        <p className="mt-8 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#5147dc]">
          <Sparkles className="h-3.5 w-3.5" /> Acesso confirmado
        </p>
        <h1 className="clinic-entry-title mt-3 max-w-[min(90vw,560px)] text-3xl font-black tracking-[0] text-[#202642] sm:text-5xl">
          {clinicName}
        </h1>
        <p className="clinic-entry-subtitle mt-4 text-sm font-semibold text-[#7b8297]">
          Preparando seu ambiente de trabalho...
        </p>
        <div className="clinic-entry-progress mt-10 h-1 w-40 overflow-hidden rounded-full bg-[#e5e7f5]">
          <span className="block h-full rounded-full bg-[#5147dc]" />
        </div>
      </div>
    </main>
  );
}
