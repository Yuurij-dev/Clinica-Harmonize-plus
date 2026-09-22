"use client";

import { FormEvent, useState } from "react";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LoginScreenProps = {
  onLogin: () => void;
};

const mockUser = {
  login: "admin",
  password: "admin",
};

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [login, setLogin] = useState(mockUser.login);
  const [password, setPassword] = useState(mockUser.password);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedLogin = login.trim().toLowerCase();

    if (normalizedLogin === mockUser.login && password === mockUser.password) {
      setError("");
      onLogin();
      return;
    }

    setError("Usuario ou senha invalidos. Use admin / admin para acessar.");
  }

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#f7fbff] px-4 py-6 text-[#14213d] sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(93,225,255,0.34),transparent_28%),radial-gradient(circle_at_90%_12%,rgba(109,83,255,0.18),transparent_27%),linear-gradient(135deg,#f8fdff_0%,#ffffff_46%,#f1f5ff_100%)]" />
      <div className="absolute left-[-14rem] top-24 h-[28rem] w-[28rem] rounded-full bg-[#18c7dc]/10 blur-3xl" />
      <div className="absolute bottom-[-16rem] right-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#5947ee]/12 blur-3xl" />

      <section className="relative mx-auto grid w-full max-w-6xl items-stretch gap-5 self-center lg:grid-cols-[1.05fr_0.95fr]">
        <div className="hp-panel-enter relative min-h-[430px] overflow-hidden rounded-[8px] bg-[#171a54] p-6 text-white shadow-[0_24px_70px_rgba(25,30,84,0.18)] sm:p-8 lg:min-h-[620px]">
          <div className="hp-gradient-motion absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(80,218,252,0.95),transparent_22%),radial-gradient(circle_at_30%_55%,rgba(69,39,221,0.95),transparent_31%),radial-gradient(circle_at_80%_32%,rgba(201,190,255,0.88),transparent_28%),linear-gradient(145deg,#0a78f0_0%,#5630d5_45%,#dce9ff_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(255,255,255,0.18),transparent_35%),linear-gradient(0deg,rgba(12,16,72,0.18),rgba(12,16,72,0.02))]" />
          <div className="relative flex h-full min-h-[382px] flex-col justify-between lg:min-h-[564px]">
            <div className="flex items-center justify-between">
              <div className="hp-pulse-ring grid h-11 w-11 place-items-center rounded-[8px] bg-white/16 text-lg font-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)] backdrop-blur">
                H+
              </div>
              <div className="rounded-full bg-white/16 px-4 py-2 text-[11px] font-bold backdrop-blur">
                Ambiente seguro
              </div>
            </div>

            <div className="hp-floating max-w-md">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-2 text-[11px] font-bold backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                Gestao inteligente para clinicas
              </p>
              <h1 className="text-[2rem] font-black leading-tight tracking-[0] sm:text-[2.75rem]">
                Tudo da sua rotina em um acesso claro e rapido.
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-white/82">
                Agenda, pacientes, financeiro e indicadores reunidos em um painel leve para a equipe trabalhar com mais foco.
              </p>
            </div>

            <div className="hp-list-stagger grid gap-3 sm:grid-cols-3">
              {[
                ["98%", "confirmacoes no dia"],
                ["+2h", "ganhas na rotina"],
                ["360", "visao do paciente"],
              ].map(([value, label]) => (
                <div
                  className="rounded-[8px] border border-white/18 bg-white/12 p-4 backdrop-blur"
                  key={label}
                >
                  <p className="text-xl font-black">{value}</p>
                  <p className="mt-1 text-[11px] font-semibold leading-4 text-white/78">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="hp-panel-enter flex items-center rounded-[8px] border border-[#e6edf7] bg-white/88 p-5 shadow-[0_18px_60px_rgba(30,45,90,0.1)] backdrop-blur-xl sm:p-8 lg:p-12">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-8">
              <div className="hp-pulse-ring mb-5 grid h-11 w-11 place-items-center rounded-[8px] bg-[#eff4ff] text-[#5947ee]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <p className="text-xs font-black uppercase text-[#18a9c6]">
                Harmonize+
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-[0] text-[#161d38]">
                Bem-vindo de volta
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#6b7285]">
                Entre para acompanhar sua agenda e continuar a gestao da clinica.
              </p>
            </div>

            <form className="hp-list-stagger space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-xs font-bold text-[#2d3654]">
                  Usuario
                </span>
                <span className="flex h-12 items-center gap-3 rounded-[8px] border border-[#dfe7f2] bg-[#fbfdff] px-4 text-sm text-[#68728a] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]">
                  <Mail className="h-4 w-4 text-[#18a9c6]" />
                  <input
                    className="w-full bg-transparent font-semibold text-[#172033] outline-none placeholder:text-[#9aa5b8]"
                    value={login}
                    onChange={(event) => setLogin(event.target.value)}
                    placeholder="admin"
                    autoComplete="username"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold text-[#2d3654]">
                  Senha
                </span>
                <span className="flex h-12 items-center gap-3 rounded-[8px] border border-[#dfe7f2] bg-[#fbfdff] px-4 text-sm text-[#68728a] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]">
                  <LockKeyhole className="h-4 w-4 text-[#18a9c6]" />
                  <input
                    className="w-full bg-transparent font-semibold text-[#172033] outline-none placeholder:text-[#9aa5b8]"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="admin"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                  />
                  <button
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#7b8499] transition hover:bg-[#eef4fb] hover:text-[#5947ee]"
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </span>
              </label>

              {error ? (
                <p className="rounded-[8px] border border-[#ffd7d7] bg-[#fff7f7] px-4 py-3 text-xs font-bold text-[#b42318]">
                  {error}
                </p>
              ) : null}

              <Button
                className="h-12 w-full bg-[#5947ee] text-sm shadow-[0_12px_26px_rgba(89,71,238,0.24)] hover:bg-[#4635d5]"
                type="submit"
              >
                Acessar painel
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-[#e9edf5]" />
              <span className="text-[11px] font-bold text-[#9aa5b8]">
                acesso mockado
              </span>
              <span className="h-px flex-1 bg-[#e9edf5]" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <InfoPill icon={CheckCircle2} label="Usuario" value="admin" />
              <InfoPill icon={LockKeyhole} label="Senha" value="admin" />
            </div>

            <div className="mt-6 rounded-[8px] border border-[#e4edf7] bg-[#f8fbff] p-4">
              <p className="flex items-center gap-2 text-xs font-black text-[#233153]">
                <CalendarCheck2 className="h-4 w-4 text-[#18a9c6]" />
                Proxima evolucao
              </p>
              <p className="mt-2 text-xs leading-5 text-[#6b7285]">
                Quando o back estiver pronto, esta tela ja pode receber a chamada real de autenticacao.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function InfoPill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-[#e4edf7] bg-white px-4 py-3">
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-[#ecfbff] text-[#18a9c6]",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-[10px] font-black uppercase text-[#9aa5b8]">
          {label}
        </span>
        <span className="text-sm font-black text-[#172033]">{value}</span>
      </span>
    </div>
  );
}
