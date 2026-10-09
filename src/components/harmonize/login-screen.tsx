"use client";

import { FormEvent, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  MailCheck,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRoundPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/input-masks";

export type RegisterValues = {
  name: string;
  phone: string;
  profession: string;
  practiceArea: string;
  hasSecretary: string;
  email: string;
  password: string;
};

export type RegisterResult = {
  error?: string;
  verificationEmail?: string;
  verificationUrl?: string;
};

type LoginScreenProps = {
  onLogin: (credentials: { login: string; password: string }) => Promise<boolean>;
  onRegister: (values: RegisterValues) => Promise<RegisterResult>;
};

const initialRegisterValues: RegisterValues = {
  name: "",
  phone: "",
  profession: "",
  practiceArea: "",
  hasSecretary: "",
  email: "",
  password: "",
};

const professionOptions = ["Médico(a)", "Dentista", "Biomédico(a)", "Esteticista", "Outro"];
const practiceAreaOptions = ["Harmonização facial", "Dermatologia", "Odontologia estética", "Estética corporal", "Outra área"];

export function LoginScreen({ onLogin, onRegister }: LoginScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [registerValues, setRegisterValues] = useState(initialRegisterValues);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function openRegister() {
    setError("");
    setVerificationEmail(null);
    setVerificationUrl(null);
    setMode("register");
  }

  function openLogin() {
    setError("");
    setVerificationEmail(null);
    setVerificationUrl(null);
    setMode("login");
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    const success = await onLogin({ login: login.trim().toLowerCase(), password });
    if (success) {
      setError("");
      return;
    }
    setError("Usuário ou senha inválidos.");
    setIsSubmitting(false);
  }

  async function handleRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    const result = await onRegister(registerValues);
    if (result.verificationEmail) {
      setError("");
      setVerificationEmail(result.verificationEmail);
      setVerificationUrl(result.verificationUrl ?? null);
      setIsSubmitting(false);
      return;
    }
    setError(result.error ?? "Não foi possível criar a conta agora. Tente novamente.");
    setIsSubmitting(false);
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
              <div className="hp-pulse-ring grid h-11 w-11 place-items-center rounded-[8px] bg-white/16 text-lg font-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)] backdrop-blur">H+</div>
              <div className="rounded-full bg-white/16 px-4 py-2 text-[11px] font-bold backdrop-blur">Ambiente seguro</div>
            </div>

            <div className="hp-floating max-w-md">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-2 text-[11px] font-bold backdrop-blur"><Sparkles className="h-3.5 w-3.5" />Gestão inteligente para clínicas</p>
              <h1 className="text-[2rem] font-black leading-tight tracking-[0] sm:text-[2.75rem]">Tudo da sua rotina em um acesso claro e rápido.</h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-white/82">Agenda, pacientes, financeiro e indicadores reunidos em um painel leve para a equipe trabalhar com mais foco.</p>
            </div>

            <div className="hp-list-stagger grid gap-3 sm:grid-cols-3">
              {[['98%', 'confirmações no dia'], ['+2h', 'ganhas na rotina'], ['360', 'visão do paciente']].map(([value, label]) => (
                <div className="rounded-[8px] border border-white/18 bg-white/12 p-4 backdrop-blur" key={label}><p className="text-xl font-black">{value}</p><p className="mt-1 text-[11px] font-semibold leading-4 text-white/78">{label}</p></div>
              ))}
            </div>
          </div>
        </div>

        <div className="hp-panel-enter flex items-center rounded-[8px] border border-[#e6edf7] bg-white/88 p-5 shadow-[0_18px_60px_rgba(30,45,90,0.1)] backdrop-blur-xl sm:p-8 lg:p-10">
          <div className="mx-auto w-full max-w-xl">
            {verificationEmail ? (
              <VerificationPending email={verificationEmail} onBack={openLogin} verificationUrl={verificationUrl} />
            ) : mode === "login" ? (
              <LoginForm error={error} isSubmitting={isSubmitting} login={login} onLoginChange={setLogin} onOpenRegister={openRegister} onPasswordChange={setPassword} onSubmit={handleLoginSubmit} password={password} setShowPassword={setShowPassword} showPassword={showPassword} />
            ) : (
              <RegisterForm error={error} isSubmitting={isSubmitting} onBack={openLogin} onChange={(field, value) => setRegisterValues((current) => ({ ...current, [field]: value }))} onSubmit={handleRegisterSubmit} values={registerValues} setShowPassword={setShowPassword} showPassword={showPassword} />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function LoginForm({ error, isSubmitting, login, onLoginChange, onOpenRegister, onPasswordChange, onSubmit, password, setShowPassword, showPassword }: { error: string; isSubmitting: boolean; login: string; onLoginChange: (value: string) => void; onOpenRegister: () => void; onPasswordChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; password: string; setShowPassword: (value: boolean) => void; showPassword: boolean }) {
  return (
    <>
      <div className="mb-8"><div className="hp-pulse-ring mb-5 grid h-11 w-11 place-items-center rounded-[8px] bg-[#eff4ff] text-[#5947ee]"><ShieldCheck className="h-5 w-5" /></div><p className="text-xs font-black uppercase text-[#18a9c6]">Harmonize+</p><h2 className="mt-2 text-3xl font-black tracking-[0] text-[#161d38]">Bem-vindo de volta</h2><p className="mt-3 text-sm leading-6 text-[#6b7285]">Entre para acompanhar sua agenda e continuar a gestão da clínica.</p></div>
      <form className="hp-list-stagger space-y-4" onSubmit={onSubmit}>
        <TextField icon={Mail} label="E-mail ou usuário" onChange={onLoginChange} placeholder="nome@dominio.com ou usuário" value={login} autoComplete="username" />
        <PasswordField onChange={onPasswordChange} password={password} setShowPassword={setShowPassword} showPassword={showPassword} />
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <Button className="h-12 w-full bg-[#5947ee] text-sm shadow-[0_12px_26px_rgba(89,71,238,0.24)] hover:bg-[#4635d5]" disabled={isSubmitting} type="submit">{isSubmitting ? "Validando acesso..." : "Acessar painel"}<ArrowRight className="h-4 w-4" /></Button>
      </form>
      <div className="my-6 flex items-center gap-3"><span className="h-px flex-1 bg-[#e9edf5]" /><span className="text-[11px] font-bold text-[#9aa5b8]">ou</span><span className="h-px flex-1 bg-[#e9edf5]" /></div>
      <Button className="h-12 w-full border-[#cfd8ed] bg-white text-sm text-[#5947ee] hover:border-[#5947ee] hover:bg-[#f8f7ff]" disabled={isSubmitting} onClick={onOpenRegister} type="button" variant="secondary"><UserRoundPlus className="h-4 w-4" />Teste grátis por 3 dias</Button>
    </>
  );
}

function RegisterForm({ error, isSubmitting, onBack, onChange, onSubmit, values, setShowPassword, showPassword }: { error: string; isSubmitting: boolean; onBack: () => void; onChange: (field: keyof RegisterValues, value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; values: RegisterValues; setShowPassword: (value: boolean) => void; showPassword: boolean }) {
  return (
    <>
      <button className="mb-5 inline-flex items-center gap-2 text-xs font-bold text-[#68728a] transition hover:text-[#5947ee]" onClick={onBack} type="button"><ArrowLeft className="h-4 w-4" />Voltar para o acesso</button>
      <div className="mb-7"><p className="text-xs font-black uppercase text-[#18a9c6]">Harmonize+</p><h2 className="mt-2 text-3xl font-black tracking-[0] text-[#161d38]">Teste grátis por 3 dias</h2><p className="mt-3 text-sm leading-6 text-[#6b7285]">Crie sua conta e comece a organizar a rotina da sua clínica.</p></div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <TextField label="Nome" onChange={(value) => onChange("name", value)} placeholder="Nome e sobrenome" value={values.name} autoComplete="name" />
        <TextField icon={Phone} label="Celular" onChange={(value) => onChange("phone", formatPhone(value))} placeholder="(00) 00000-0000" type="tel" value={values.phone} autoComplete="tel" />
        <SelectField label="Você é..." onChange={(value) => onChange("profession", value)} options={professionOptions} value={values.profession} />
        <SelectField label="Área de atuação" onChange={(value) => onChange("practiceArea", value)} options={practiceAreaOptions} value={values.practiceArea} />
        <SelectField label="Você possui secretária?" onChange={(value) => onChange("hasSecretary", value)} options={["Sim", "Não"]} value={values.hasSecretary} />
        <TextField label="E-mail" onChange={(value) => onChange("email", value)} placeholder="nome@dominio.com" type="email" value={values.email} autoComplete="email" />
        <div className="sm:col-span-2"><PasswordField label="Senha" onChange={(value) => onChange("password", value)} password={values.password} placeholder="Defina uma senha" setShowPassword={setShowPassword} showPassword={showPassword} /></div>
        {error ? <div className="sm:col-span-2"><ErrorMessage>{error}</ErrorMessage></div> : null}
        <div className="sm:col-span-2"><Button className="h-12 w-full bg-[#5947ee] text-sm shadow-[0_12px_26px_rgba(89,71,238,0.24)] hover:bg-[#4635d5]" disabled={isSubmitting} type="submit">{isSubmitting ? "Criando sua conta..." : "Criar conta grátis"}<ArrowRight className="h-4 w-4" /></Button><p className="mt-4 text-center text-[11px] leading-5 text-[#858da0]">Ao prosseguir, você concorda com os nossos <a className="font-bold text-[#5947ee] underline underline-offset-2" href="#termos">Termos de Uso</a> e <a className="font-bold text-[#5947ee] underline underline-offset-2" href="#privacidade">Política de Privacidade</a>.</p><p className="mt-5 text-center text-sm font-bold text-[#26305a]">Já tem uma conta? <button className="text-[#5947ee] hover:underline" onClick={onBack} type="button">Acessar</button></p></div>
      </form>
    </>
  );
}

function TextField({ icon: Icon, label, onChange, placeholder, type = "text", value, autoComplete }: { icon?: typeof Mail; label: string; onChange: (value: string) => void; placeholder: string; type?: string; value: string; autoComplete?: string }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold text-[#2d3654]">{label}</span><span className="flex h-12 items-center gap-3 rounded-[8px] border border-[#dfe7f2] bg-[#fbfdff] px-4 text-sm text-[#68728a] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]">{Icon ? <Icon className="h-4 w-4 shrink-0 text-[#18a9c6]" /> : null}<input className="w-full bg-transparent font-semibold text-[#172033] outline-none placeholder:text-[#9aa5b8]" autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required type={type} value={value} /></span></label>;
}

function SelectField({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold text-[#2d3654]">{label}</span><span className="relative flex h-12 items-center rounded-[8px] border border-[#dfe7f2] bg-[#fbfdff] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]"><select className="h-full w-full appearance-none bg-transparent px-4 pr-10 text-sm font-semibold text-[#172033] outline-none" onChange={(event) => onChange(event.target.value)} required value={value}><option disabled value="">Selecione uma opção</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select><ChevronDown className="pointer-events-none absolute right-4 h-4 w-4 text-[#172033]" /></span></label>;
}

function PasswordField({ label = "Senha", onChange, password, placeholder = "Digite sua senha", setShowPassword, showPassword }: { label?: string; onChange: (value: string) => void; password: string; placeholder?: string; setShowPassword: (value: boolean) => void; showPassword: boolean }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold text-[#2d3654]">{label}</span><span className="flex h-12 items-center gap-3 rounded-[8px] border border-[#dfe7f2] bg-[#fbfdff] px-4 text-sm text-[#68728a] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]"><LockKeyhole className="h-4 w-4 shrink-0 text-[#18a9c6]" /><input className="w-full bg-transparent font-semibold text-[#172033] outline-none placeholder:text-[#9aa5b8]" autoComplete={label === "Senha" ? "new-password" : "current-password"} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required type={showPassword ? "text" : "password"} value={password} /><button className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#7b8499] transition hover:bg-[#eef4fb] hover:text-[#5947ee]" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShowPassword(!showPassword)} type="button">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>;
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[8px] border border-[#ffd7d7] bg-[#fff7f7] px-4 py-3 text-xs font-bold text-[#b42318]">{children}</p>;
}

function VerificationPending({ email, onBack, verificationUrl }: { email: string; onBack: () => void; verificationUrl: string | null }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-[#eaf8ef] text-[#247750]"><MailCheck className="h-7 w-7" /></div>
      <p className="text-xs font-black uppercase text-[#18a9c6]">Quase lá</p>
      <h2 className="mt-2 text-3xl font-black tracking-[0] text-[#161d38]">Confirme seu e-mail</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#6b7285]">Enviamos um link de confirmação para <strong className="text-[#303144]">{email}</strong>. Clique nele para ativar sua conta e acessar o Harmonize+.</p>
      {verificationUrl ? <a className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#5947ee] px-5 text-sm font-bold text-white shadow-[0_12px_26px_rgba(89,71,238,0.24)] hover:bg-[#4635d5]" href={verificationUrl}>Abrir link de teste <ArrowRight className="h-4 w-4" /></a> : null}
      <p className="mt-6 text-xs text-[#858da0]">O link é válido por 30 minutos e só pode ser usado uma vez.</p>
      <button className="mt-6 inline-flex items-center gap-2 text-xs font-bold text-[#68728a] transition hover:text-[#5947ee]" onClick={onBack} type="button"><ArrowLeft className="h-4 w-4" />Voltar para o acesso</button>
    </div>
  );
}
