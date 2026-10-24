"use client";

import Image from "next/image";
import { AlertCircle, Check } from "lucide-react";

type ClinicEntryTransitionProps = {
  sessionConfirmed: boolean;
  clinicName?: string;
  message: string;
  error?: string;
  onRetry?: () => void;
  onBackToLogin?: () => void;
};

export function ClinicEntryTransition({ sessionConfirmed, clinicName, message, error, onRetry, onBackToLogin }: ClinicEntryTransitionProps) {
  return (
    <main className="clinic-entry grid min-h-svh w-full overflow-hidden bg-[#f8faff] text-[#17134d] lg:grid-cols-[51%_49%]">
      <section className="relative flex min-h-[220px] items-center justify-center overflow-hidden bg-[#4938f4] px-6 py-6 text-center text-white sm:min-h-[260px] lg:min-h-svh lg:px-12 lg:py-12">
        <div aria-hidden="true" className="absolute inset-0 bg-center bg-no-repeat" style={{ backgroundImage: "url('/login-brand-background.png')", backgroundSize: "100% 100%" }} />
        <div className="clinic-entry-brand relative z-10 flex w-full max-w-xl flex-col items-center">
          <h1 className="w-full max-w-[220px] sm:max-w-[280px] lg:max-w-[380px]">
            <Image alt="Harmonize+" className="h-auto w-full" height={300} priority src="/brand/logo-horizontal-white.svg" unoptimized width={1200} />
          </h1>
          <p className="mt-1 text-sm font-medium sm:text-base lg:mt-2 lg:text-xl">Gestão para clínicas</p>
          <p className="mt-3 hidden max-w-md text-sm leading-6 text-white/85 sm:block lg:mt-6 lg:text-base lg:leading-7">
            Mais organização, mais tempo para o que realmente importa: seus pacientes.
          </p>
        </div>
      </section>

      <section className="relative flex min-h-[420px] items-center justify-center overflow-hidden bg-[#f8faff] px-4 py-8 sm:px-8 sm:py-10 lg:min-h-svh lg:px-10 lg:py-12">
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full text-[#5147dc] opacity-[0.055]" fill="none" preserveAspectRatio="xMidYMid slice" viewBox="0 0 800 900">
          <path d="M106 56v318c0 17 13 30 30 30h75c17 0 30-13 30-30V56M106 450v318c0 17 13 30 30 30h75c17 0 30-13 30-30V450M241 238h317M241 662h317M558 56v318c0 17-13 30-30 30h-75c-17 0-30-13-30-30V56M558 450v318c0 17-13 30-30 30h-75c-17 0-30-13-30-30V450" stroke="currentColor" strokeWidth="1.2" />
        </svg>

        <div className="clinic-entry-card relative z-10 w-full max-w-[560px] rounded-[16px] border border-[#e4e7f1] bg-white/95 px-6 py-8 text-center shadow-[0_22px_60px_rgba(39,46,105,0.13)] sm:px-10 sm:py-10 lg:px-12 lg:py-12">
          <div className="clinic-entry-logo relative mx-auto grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-[18px] border border-[#ececf6] bg-white shadow-[0_10px_28px_rgba(81,71,220,0.13)] sm:h-[80px] sm:w-[80px]">
            <Image alt="Logo Harmonize+" className="object-contain p-3" fill priority sizes="80px" src="/brand/mark.svg" unoptimized />
          </div>

          <div className={`clinic-entry-check mx-auto mt-4 grid h-8 w-8 place-items-center rounded-full text-white ${error && !sessionConfirmed ? "bg-[#d04444]" : sessionConfirmed ? "bg-[#16b88b]" : "bg-[#5147dc]"}`} aria-hidden="true">
            {error && !sessionConfirmed ? <AlertCircle className="h-4 w-4" strokeWidth={2.8} /> : sessionConfirmed ? <Check className="h-4 w-4" strokeWidth={3} /> : <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          </div>

          <p className="mt-5 text-[10px] font-black uppercase tracking-[0.16em] text-[#5147dc] sm:text-[11px]">
            {error && !sessionConfirmed ? "Não foi possível confirmar" : sessionConfirmed ? "Acesso confirmado" : "Validando seu acesso"}
          </p>
          <h2 className="clinic-entry-title mt-2 break-words text-2xl font-black leading-tight text-[#202642] sm:text-3xl lg:text-4xl">
            {sessionConfirmed && clinicName?.trim() ? clinicName : "Preparando seu ambiente"}
          </h2>
          <p className={`clinic-entry-subtitle mt-3 text-sm font-semibold leading-6 ${error ? "text-[#b42318]" : "text-[#68718c]"}`} aria-live="polite" role={error ? "alert" : "status"}>
            {error ?? message}
          </p>

          {error ? (
            <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
              {!sessionConfirmed && onBackToLogin ? (
                <button className="h-11 rounded-[8px] border border-[#d9dceb] bg-white px-5 text-sm font-bold text-[#303144] transition hover:bg-[#f7f8fc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5147dc]" onClick={onBackToLogin} type="button">
                  Voltar ao login
                </button>
              ) : null}
              <button className="h-11 rounded-[8px] bg-[#5147dc] px-5 text-sm font-bold text-white transition hover:bg-[#4338c8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5147dc]" onClick={onRetry} type="button">
                Tentar novamente
              </button>
            </div>
          ) : (
            <div className="clinic-entry-progress mt-8 h-2 w-full overflow-hidden rounded-full bg-[#e4e5f0]" role="progressbar" aria-label={message}>
              <span className="block h-full rounded-full bg-[#5147dc]" />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
