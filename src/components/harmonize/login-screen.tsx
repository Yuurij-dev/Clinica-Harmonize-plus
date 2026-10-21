"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/input-masks";

export type RegisterValues = {
  clinicName: string;
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
};

type LoginScreenProps = {
  initialMode?: "login" | "register";
  onLogin: (credentials: { login: string; password: string }) => Promise<{ error?: string; passwordChangeRequired?: boolean }>;
  onChangePassword: (password: string) => Promise<{ error?: string }>;
  onRegister: (values: RegisterValues) => Promise<RegisterResult>;
};

const initialRegisterValues: RegisterValues = {
  clinicName: "",
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

export function LoginScreen({ initialMode = "login", onLogin, onChangePassword, onRegister }: LoginScreenProps) {
  const [mode, setMode] = useState<"login" | "register" | "change-password">(initialMode);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [registerValues, setRegisterValues] = useState(initialRegisterValues);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function openRegister() {
    setError("");
    setMode("register");
  }

  function openLogin() {
    setError("");
    setMode("login");
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedLogin = login.trim().toLowerCase();
    if (normalizedLogin.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedLogin)) {
      setError("Digite um e-mail válido.");
      return;
    }
    setIsSubmitting(true);
    const result = await onLogin({ login: normalizedLogin, password });
    if (result.passwordChangeRequired) {
      setError("");
      setMode("change-password");
      setIsSubmitting(false);
      return;
    }
    if (!result.error) {
      setError("");
      return;
    }
    setError(result.error);
    setIsSubmitting(false);
  }

  async function handleRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    const result = await onRegister(registerValues);
    if (result.error) {
      setError(result.error);
      setIsSubmitting(false);
      return;
    }
    setError("");
    setIsSubmitting(false);
  }

  return (
    <main className="grid min-h-screen w-full overflow-hidden bg-white text-[#17134d] lg:grid-cols-[52%_48%]">
      <section className="relative flex min-h-[270px] items-center justify-center overflow-hidden bg-[#4938f4] px-6 py-8 text-center text-white sm:min-h-[360px] sm:px-10 sm:py-12 lg:min-h-screen lg:px-14 lg:py-16">
        <div aria-hidden="true" className="absolute inset-0 bg-center bg-no-repeat" style={{ backgroundImage: "url('/login-brand-background.png')", backgroundSize: "100% 100%" }} />
        <div className="hp-brand-enter relative z-10 flex w-full max-w-xl flex-col items-center">
          <h1 className="w-full max-w-[260px] sm:max-w-[340px] lg:max-w-[420px]">
            <Image alt="Harmonize+" className="h-auto w-full" height={300} priority src="/brand/logo-horizontal-white.svg" unoptimized width={1200} />
          </h1>
          <p className="mt-2 text-xl font-medium sm:text-2xl">Gestão para clínicas</p>
          <p className="mt-5 hidden max-w-md text-sm leading-6 text-white/85 sm:mt-7 sm:block sm:text-base sm:leading-7">Mais organização, mais tempo para o que realmente importa: seus pacientes.</p>
          <Button className="mt-5 h-11 rounded-full bg-white px-7 font-bold text-[#4938f4] shadow-none hover:bg-[#f2f1ff] sm:mt-9 sm:h-12" onClick={mode === "login" ? openRegister : openLogin} type="button" variant="secondary">
            {mode === "login" ? "Crie sua conta grátis" : "Voltar ao login"}<ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <section className="relative flex min-h-[520px] items-center justify-center overflow-hidden bg-[#f8faff] px-4 py-6 sm:min-h-[640px] sm:px-8 sm:py-10 lg:min-h-screen lg:px-10 lg:py-12 xl:px-14">
        <BrandOutline className="pointer-events-none absolute inset-0 h-full w-full text-[#5147dc] opacity-[0.055]" />
        <div className="hp-panel-enter relative z-10 my-auto w-full max-w-[520px] rounded-[8px] border border-white/80 bg-white/95 px-6 py-8 shadow-[0_18px_55px_rgba(38,48,112,0.14)] sm:px-10 sm:py-10 lg:px-12 lg:py-12">
            {mode === "change-password" ? (
              <div className="mx-auto w-full max-w-[360px]"><FirstAccessPasswordForm onSubmit={onChangePassword} /></div>
            ) : mode === "login" ? (
              <div className="mx-auto w-full max-w-[360px]"><LoginForm error={error} isSubmitting={isSubmitting} login={login} onLoginChange={setLogin} onPasswordChange={setPassword} onSubmit={handleLoginSubmit} password={password} setShowPassword={setShowPassword} showPassword={showPassword} /></div>
            ) : (
              <RegisterForm error={error} isSubmitting={isSubmitting} onBack={openLogin} onChange={(field, value) => setRegisterValues((current) => ({ ...current, [field]: value }))} onSubmit={handleRegisterSubmit} values={registerValues} setShowPassword={setShowPassword} showPassword={showPassword} />
            )}
        </div>
      </section>
    </main>
  );
}

function BrandOutline({ className }: { className: string }) {
  return <svg aria-hidden="true" className={className} fill="none" preserveAspectRatio="xMidYMid slice" viewBox="0 0 800 900">
    <path d="M106 56v318c0 17 13 30 30 30h75c17 0 30-13 30-30V56M106 450v318c0 17 13 30 30 30h75c17 0 30-13 30-30V450M241 238h317M241 662h317M558 56v318c0 17-13 30-30 30h-75c-17 0-30-13-30-30V56M558 450v318c0 17-13 30-30 30h-75c-17 0-30-13-30-30V450" stroke="currentColor" strokeWidth="1.2" />
  </svg>;
}

function LoginForm({ error, isSubmitting, login, onLoginChange, onPasswordChange, onSubmit, password, setShowPassword, showPassword }: { error: string; isSubmitting: boolean; login: string; onLoginChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; password: string; setShowPassword: (value: boolean) => void; showPassword: boolean }) {
  const [helpMessage, setHelpMessage] = useState("");

  return (
    <>
      <header className="mb-7 text-center"><h2 className="text-2xl font-black tracking-[0] text-[#211960]">Bem-vindo!</h2><p className="mt-2 text-[13px] leading-5 text-[#7783a8]">Acesse sua conta para continuar na Harmonize+.</p></header>
      <div className="mb-6 border-b border-[#e6e8f1]"><div className="w-fit border-b-[3px] border-[#4938f4] px-2 pb-2 text-[13px] font-bold text-[#4938f4]">Login</div></div>
      <form className="hp-list-stagger" onSubmit={onSubmit}>
        <TextField compact icon={Mail} label="seu e-mail" onChange={onLoginChange} placeholder="nome@dominio.com" value={login} autoComplete="username" />
        <div className="mt-4">
          <PasswordField compact label="sua senha" onChange={onPasswordChange} password={password} setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="current-password" />
          <button className="mt-2 text-left text-xs font-medium text-[#4938f4] hover:underline" onClick={() => setHelpMessage("Para redefinir sua senha, entre em contato com o administrador da clínica.")} type="button">Esqueceu sua senha?</button>
        </div>
        {error ? <div className="mt-4"><ErrorMessage>{error}</ErrorMessage></div> : null}
        <Button className="mt-5 h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" size="lg" disabled={isSubmitting} type="submit"><ArrowRight className="h-4 w-4" />{isSubmitting ? "Validando acesso..." : "Acessar"}</Button>
      </form>
      <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-[#e9edf5]" /><span className="text-xs font-medium text-[#8b94af]">ou</span><span className="h-px flex-1 bg-[#e9edf5]" /></div>
      <Button aria-label="Entrar com Google (indisponível no momento)" className="h-[42px] w-full rounded-[10px] border-[#d9dff0] bg-white px-4 text-[13px] font-semibold text-[#25263a] shadow-none hover:bg-[#f8f9fc]" size="lg" type="button" variant="outline"><GoogleMark />Entrar com Google</Button>
      <button className="mt-5 w-full text-center text-xs font-medium text-[#4938f4] hover:underline" onClick={() => setHelpMessage("Para receber ajuda com o acesso, entre em contato com o administrador da clínica.")} type="button">Precisa de ajuda? Clique aqui.</button>
      {helpMessage ? <p aria-live="polite" className="mt-3 text-center text-xs leading-5 text-[#7783a8]">{helpMessage}</p> : null}
    </>
  );
}

function GoogleMark() {
  return <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.75 3.28-8.09Z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.15v2.84C3.96 20.53 7.7 23 12 23Z" fill="#34A853" />
    <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.15C1.43 8.55 1 10.22 1 12s.43 3.45 1.15 4.94l3.69-2.84Z" fill="#FBBC05" />
    <path d="M12 5.27c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.99 14.97 1 12 1 7.7 1 3.96 3.47 2.15 7.06l3.69 2.84C6.71 7.2 9.14 5.27 12 5.27Z" fill="#EA4335" />
  </svg>;
}

function RegisterForm({ error, isSubmitting, onBack, onChange, onSubmit, values, setShowPassword, showPassword }: { error: string; isSubmitting: boolean; onBack: () => void; onChange: (field: keyof RegisterValues, value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; values: RegisterValues; setShowPassword: (value: boolean) => void; showPassword: boolean }) {
  return (
    <>
      <header className="mb-6 text-center"><h2 className="text-2xl font-black tracking-[0] text-[#211960]">Teste grátis por 3 dias</h2><p className="mt-2 text-[13px] leading-5 text-[#7783a8]">Crie sua conta e organize a rotina da sua clínica.</p></header>
      <div className="mb-4 border-b border-[#e6e8f1]"><div className="w-fit border-b-[3px] border-[#4938f4] px-2 pb-2 text-[11px] font-bold text-[#4938f4]">Criar conta</div></div>
      <form className="grid gap-x-3 gap-y-3 sm:grid-cols-2" onSubmit={onSubmit}>
        <div className="sm:col-span-2"><TextField compact label="Nome da clínica" onChange={(value) => onChange("clinicName", value)} placeholder="Ex.: Clínica Harmonia" value={values.clinicName} autoComplete="organization" maxLength={100} /></div>
        <TextField compact label="Nome" onChange={(value) => onChange("name", value)} placeholder="Nome e sobrenome" value={values.name} autoComplete="name" />
        <TextField compact icon={Phone} label="Celular" onChange={(value) => onChange("phone", formatPhone(value))} placeholder="(00) 00000-0000" type="tel" value={values.phone} autoComplete="tel" />
        <SelectField label="Você é..." onChange={(value) => onChange("profession", value)} options={professionOptions} value={values.profession} />
        <SelectField label="Área de atuação" onChange={(value) => onChange("practiceArea", value)} options={practiceAreaOptions} value={values.practiceArea} />
        <SelectField label="Você possui secretária?" onChange={(value) => onChange("hasSecretary", value)} options={["Sim", "Não"]} value={values.hasSecretary} />
        <TextField compact icon={Mail} label="E-mail" onChange={(value) => onChange("email", value)} placeholder="nome@dominio.com" type="email" value={values.email} autoComplete="email" />
        <div className="sm:col-span-2"><PasswordField compact label="Senha" onChange={(value) => onChange("password", value)} password={values.password} placeholder="Defina uma senha" setShowPassword={setShowPassword} showPassword={showPassword} /></div>
        {error ? <div className="sm:col-span-2"><ErrorMessage>{error}</ErrorMessage></div> : null}
        <div className="sm:col-span-2"><Button className="h-[38px] w-full rounded-[8px] text-xs font-bold" size="lg" disabled={isSubmitting} type="submit"><ArrowRight className="h-4 w-4" />{isSubmitting ? "Criando sua conta..." : "Criar conta grátis"}</Button><p className="mt-3 text-center text-[9px] leading-4 text-[#858da0]">Ao prosseguir, você concorda com os nossos <a className="font-bold text-[#5147dc] underline underline-offset-2" href="#termos">Termos de Uso</a> e <a className="font-bold text-[#5147dc] underline underline-offset-2" href="#privacidade">Política de Privacidade</a>.</p><p className="mt-3 text-center text-xs font-bold text-[#26305a]">Já tem uma conta? <button className="text-[#5147dc] hover:underline" onClick={onBack} type="button">Acessar</button></p></div>
      </form>
    </>
  );
}

function TextField({ compact = false, icon: Icon, label, onChange, placeholder, type = "text", value, autoComplete, maxLength }: { compact?: boolean; icon?: typeof Mail; label: string; onChange: (value: string) => void; placeholder: string; type?: string; value: string; autoComplete?: string; maxLength?: number }) {
  return <label className="block"><span className={`block font-bold text-[#2d3654] ${compact ? "mb-1 text-[11px]" : "mb-2 text-xs"}`}>{label}</span><span className={`flex ${compact ? "h-9 gap-2 px-3 text-xs" : "h-12 gap-3 px-4 text-sm"} items-center rounded-[8px] border border-[#dfe7f2] bg-[#f5f8ff] text-[#68728a] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]`}>{Icon ? <Icon className="h-4 w-4 shrink-0 text-[#7885ab]" /> : null}<input className="w-full bg-transparent font-semibold text-[#172033] outline-none placeholder:text-[#9aa5b8]" autoComplete={autoComplete} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required type={type} value={value} /></span></label>;
}

function SelectField({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-bold text-[#2d3654]">{label}</span><span className="relative flex h-9 items-center rounded-[8px] border border-[#dfe7f2] bg-[#fbfdff] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]"><select className="h-full w-full appearance-none bg-transparent px-3 pr-8 text-xs font-semibold text-[#172033] outline-none" onChange={(event) => onChange(event.target.value)} required value={value}><option disabled value="">Selecione uma opção</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-[#172033]" /></span></label>;
}

function PasswordField({ compact = false, label = "Senha", onChange, password, placeholder = "Digite sua senha", setShowPassword, showPassword, autoComplete = label === "Senha" ? "new-password" : "current-password", minLength }: { compact?: boolean; label?: string; onChange: (value: string) => void; password: string; placeholder?: string; setShowPassword: (value: boolean) => void; showPassword: boolean; autoComplete?: string; minLength?: number }) {
  return <label className="block"><span className={`block font-bold text-[#2d3654] ${compact ? "mb-1 text-[11px]" : "mb-2 text-xs"}`}>{label}</span><span className={`flex ${compact ? "h-9 gap-2 px-3 text-xs" : "h-12 gap-3 px-4 text-sm"} items-center rounded-[8px] border border-[#dfe7f2] bg-[#f5f8ff] text-[#68728a] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]`}><LockKeyhole className="h-4 w-4 shrink-0 text-[#7885ab]" /><input className="w-full bg-transparent font-semibold text-[#172033] outline-none placeholder:text-[#9aa5b8]" autoComplete={autoComplete} minLength={minLength} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required type={showPassword ? "text" : "password"} value={password} /><button className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#7b8499] transition hover:bg-[#eef4fb] hover:text-[#5947ee]" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShowPassword(!showPassword)} type="button">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>;
}

function FirstAccessPasswordForm({ onSubmit }: { onSubmit: (password: string) => Promise<{ error?: string }> }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Both values are entered locally by the same user; no stored secret is compared.
    if (password !== confirmation) { // nosemgrep: rules.ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack
      setError("As senhas não coincidem.");
      return;
    }
    setIsSubmitting(true);
    const result = await onSubmit(password);
    if (result.error) {
      setError(result.error);
      setIsSubmitting(false);
    }
  }

  return <>
    <div className="mb-7"><div className="mb-5 grid h-11 w-11 place-items-center rounded-[8px] bg-[#eff4ff] text-[#5947ee]"><KeyRound className="h-5 w-5" /></div><p className="text-xs font-black uppercase text-[#18a9c6]">Primeiro acesso</p><h2 className="mt-2 text-3xl font-black tracking-[0] text-[#161d38]">Defina sua senha</h2><p className="mt-3 text-sm leading-6 text-[#6b7285]">Para continuar, troque a senha inicial por uma senha pessoal.</p></div>
    <form className="space-y-4" onSubmit={handleSubmit}>
      <PasswordField label="Nova senha" onChange={(value) => { setPassword(value); setError(""); }} password={password} placeholder="Crie uma senha com pelo menos 8 caracteres" setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="new-password" minLength={8} />
      <PasswordField label="Confirmar nova senha" onChange={(value) => { setConfirmation(value); setError(""); }} password={confirmation} placeholder="Digite a senha novamente" setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="new-password" minLength={8} />
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <Button className="w-full" size="lg" disabled={isSubmitting} type="submit">{isSubmitting ? "Salvando nova senha..." : "Salvar senha e acessar"}<ArrowRight className="h-4 w-4" /></Button>
    </form>
  </>;
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[8px] border border-[#ffd7d7] bg-[#fff7f7] px-4 py-3 text-xs font-bold text-[#b42318]">{children}</p>;
}
