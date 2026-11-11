"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  Building2,
  Check,
  Circle,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  MailCheck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PASSWORD_RULE_LABELS, PASSWORD_RULE_MESSAGE, isStrongPassword, passwordChecks, passwordStrength } from "@/lib/password-rules";

export type RegisterValues = {
  clinicName: string;
  name: string;
  email: string;
  password: string;
};

export type GoogleSignupValues = Omit<RegisterValues, "email" | "password">;

// createdButLoginFailed: a conta foi criada mas o login automático falhou; o usuário entra manualmente.
export type VerifyResult = { error?: string; createdButLoginFailed?: boolean };

export type RegisterResult = {
  verificationRequired?: boolean;
  error?: string;
};

type LoginScreenProps = {
  initialMode?: "login" | "register";
  googleStatus?: string;
  onLogin: (credentials: { login: string; password: string }) => Promise<{ error?: string; passwordChangeRequired?: boolean }>;
  onChangePassword: (password: string) => Promise<{ error?: string }>;
  onRegister: (values: RegisterValues) => Promise<RegisterResult>;
  onVerifyEmail: (values: { email: string; password: string; code: string }) => Promise<VerifyResult>;
  onResendCode: (email: string) => Promise<{ error?: string }>;
  onGoogleSignup: (values: GoogleSignupValues) => Promise<RegisterResult>;
};

const initialRegisterValues: RegisterValues = {
  clinicName: "",
  name: "",
  email: "",
  password: "",
};

const googleMessages: Record<string, string> = {
  unavailable: "Login com Google ainda não está configurado.",
  denied: "Login com Google cancelado. Você pode tentar de novo ou entrar com e-mail e senha.",
  no_access: "Esta conta Google ainda não tem acesso a uma clínica. Peça um convite ao administrador da clínica.",
  account_exists: "Já existe uma conta com este e-mail. Entre com sua senha.",
  locked: "Esta conta está temporariamente bloqueada. Tente novamente em alguns minutos.",
  must_change_password: "Você precisa trocar sua senha provisória: entre com e-mail e senha.",
  signup_expired: "Sua verificação com o Google expirou. Toque em “Criar conta com Google” novamente.",
  invite_invalid: "Este convite não é mais válido. Peça um novo convite à clínica.",
  invite_email_mismatch: "O e-mail da conta Google precisa ser o mesmo e-mail que recebeu o convite.",
  error: "Não foi possível entrar com o Google. Tente novamente.",
};

export function LoginScreen({ initialMode = "login", googleStatus, onLogin, onChangePassword, onRegister, onVerifyEmail, onResendCode, onGoogleSignup }: LoginScreenProps) {
  const [mode, setMode] = useState<"login" | "register" | "verify-email" | "change-password" | "google-signup">(googleStatus === "signup" ? "google-signup" : initialMode);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [registerValues, setRegisterValues] = useState(initialRegisterValues);
  const [error, setError] = useState(() => (googleStatus && googleStatus !== "signup" ? googleMessages[Object.hasOwn(googleMessages, googleStatus) ? googleStatus : "error"] : ""));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

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
    if (!isStrongPassword(registerValues.password)) {
      setError(PASSWORD_RULE_MESSAGE);
      return;
    }
    setIsSubmitting(true);
    const result = await onRegister(registerValues);
    if (result.error) {
      setError(result.error);
      setIsSubmitting(false);
      return;
    }
    setError("");
    setIsSubmitting(false);
    if (result.verificationRequired) setMode("verify-email");
  }

  // Conta criada mas login automático falhou: volta ao login com o e-mail preenchido (não é erro de código).
  async function handleVerifyCode(code: string): Promise<VerifyResult> {
    const email = registerValues.email.trim().toLowerCase();
    // Sem a senha em memória (ex.: estado perdido) a verificação não tem como concluir: recomeça pelo formulário.
    if (!registerValues.password) {
      setError("Sua sessão de cadastro foi perdida. Preencha o formulário novamente para receber um novo código.");
      setMode("register");
      return {};
    }
    const result = await onVerifyEmail({ email, password: registerValues.password, code });
    if (!result.createdButLoginFailed) return result;
    setLogin(email);
    setPassword("");
    setError("");
    setNotice("Conta criada! Faça login com seu e-mail e senha.");
    setMode("login");
    return {};
  }

  async function handleGoogleSignupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    // Só os campos da clínica: e-mail e Google vêm do cookie assinado no servidor.
    const { clinicName, name } = registerValues;
    const result = await onGoogleSignup({ clinicName, name });
    setError(result.error ?? "");
    setIsSubmitting(false);
  }

  return (
    <AuthShell action={
      <Button className="mt-5 h-11 rounded-full bg-white px-7 font-bold text-[#4938f4] shadow-none hover:bg-[#f2f1ff] sm:mt-9 sm:h-12" onClick={mode === "login" ? openRegister : openLogin} type="button" variant="secondary">
        {mode === "login" ? "Crie sua conta grátis" : "Voltar ao login"}<ArrowRight className="h-4 w-4" />
      </Button>
    }>
      {mode === "change-password" ? (
        <div className="mx-auto w-full max-w-[360px]"><FirstAccessPasswordForm onSubmit={onChangePassword} /></div>
      ) : mode === "google-signup" ? (
        <GoogleSignupForm error={error} isSubmitting={isSubmitting} onBack={openLogin} onChange={(field, value) => setRegisterValues((current) => ({ ...current, [field]: value }))} onSubmit={handleGoogleSignupSubmit} values={registerValues} />
      ) : mode === "verify-email" ? (
        <div className="mx-auto w-full max-w-[360px]"><VerifyEmailForm email={registerValues.email.trim().toLowerCase()} onChangeEmail={openRegister} onResend={onResendCode} onVerify={handleVerifyCode} /></div>
      ) : mode === "login" ? (
        <div className="mx-auto w-full max-w-[360px]"><LoginForm error={error} notice={notice} isSubmitting={isSubmitting} login={login} onLoginChange={setLogin} onPasswordChange={setPassword} onSubmit={handleLoginSubmit} password={password} setShowPassword={setShowPassword} showPassword={showPassword} /></div>
      ) : (
        <RegisterForm error={error} isSubmitting={isSubmitting} onBack={openLogin} onChange={(field, value) => setRegisterValues((current) => ({ ...current, [field]: value }))} onSubmit={handleRegisterSubmit} values={registerValues} setShowPassword={setShowPassword} showPassword={showPassword} />
      )}
    </AuthShell>
  );
}

// Casca visual compartilhada com a página pública do convite: painel de marca + cartão branco.
export function AuthShell({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen w-full lg:h-screen overflow-hidden bg-white text-[#17134d] lg:grid-cols-[52%_48%]">
      <section className="relative flex min-h-[270px] items-center justify-center overflow-hidden bg-[#4938f4] px-6 py-8 text-center text-white sm:min-h-[360px] sm:px-10 sm:py-12 lg:h-screen lg:px-14 lg:py-16">
        <div aria-hidden="true" className="absolute inset-0 bg-center bg-no-repeat" style={{ backgroundImage: "url('/login-brand-background.png')", backgroundSize: "100% 100%" }} />
        <div className="hp-brand-enter relative z-10 flex w-full max-w-xl flex-col items-center">
          <h1 className="w-full max-w-[260px] sm:max-w-[340px] lg:max-w-[420px]">
            <Image alt="Harmonize+" className="h-auto w-full" height={300} priority src="/brand/logo-horizontal-white.svg" unoptimized width={1200} />
          </h1>
          <p className="mt-2 text-xl font-medium sm:text-2xl">Gestão para clínicas</p>
          <p className="mt-5 hidden max-w-md text-sm leading-6 text-white/85 sm:mt-7 sm:block sm:text-base sm:leading-7">Mais organização, mais tempo para o que realmente importa: seus pacientes.</p>
          {action}
        </div>
      </section>

      <section className="relative flex min-h-[520px] items-center justify-center overflow-hidden bg-[#f8faff] lg:items-start lg:overflow-y-auto px-4 py-6 sm:min-h-[640px] sm:px-8 sm:py-10 lg:h-screen lg:px-10 lg:py-12 xl:px-14">
        <BrandOutline className="pointer-events-none absolute inset-0 h-full w-full text-[#5147dc] opacity-[0.055]" />
        <div className="hp-panel-enter relative z-10 my-auto w-full max-w-[520px] rounded-[8px] border border-white/80 bg-white/95 px-6 py-8 shadow-[0_18px_55px_rgba(38,48,112,0.14)] sm:px-10 sm:py-10 lg:px-12 lg:py-12">
            {children}
        </div>
      </section>
    </main>
  );
}

export function BrandOutline({ className }: { className: string }) {
  return <svg aria-hidden="true" className={className} fill="none" preserveAspectRatio="xMidYMid slice" viewBox="0 0 800 900">
    <path d="M106 56v318c0 17 13 30 30 30h75c17 0 30-13 30-30V56M106 450v318c0 17 13 30 30 30h75c17 0 30-13 30-30V450M241 238h317M241 662h317M558 56v318c0 17-13 30-30 30h-75c-17 0-30-13-30-30V56M558 450v318c0 17-13 30-30 30h-75c-17 0-30-13-30-30V450" stroke="currentColor" strokeWidth="1.2" />
  </svg>;
}

function LoginForm({ error, notice, isSubmitting, login, onLoginChange, onPasswordChange, onSubmit, password, setShowPassword, showPassword }: { error: string; notice?: string; isSubmitting: boolean; login: string; onLoginChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; password: string; setShowPassword: (value: boolean) => void; showPassword: boolean }) {
  const [helpMessage, setHelpMessage] = useState("");

  // Rota de API (redirect externo ao Google): precisa de navegação completa, não de router.push.
  function startGoogleLogin() {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/api/auth/google?intent=login");
  }

  return (
    <>
      <header className="mb-7 text-center"><h2 className="text-2xl font-black tracking-[0] text-[#211960]">Bem-vindo!</h2><p className="mt-2 text-[13px] leading-5 text-[#7783a8]">Acesse sua conta para continuar na Harmonize+.</p></header>
      <div className="mb-6 border-b border-[#e6e8f1]"><div className="w-fit border-b-[3px] border-[#4938f4] px-2 pb-2 text-[13px] font-bold text-[#4938f4]">Login</div></div>
      <form className="hp-list-stagger" data-autofill="allow" onSubmit={onSubmit}>
        <TextField compact icon={Mail} label="seu e-mail" onChange={onLoginChange} placeholder="nome@dominio.com" value={login} autoComplete="username" />
        <div className="mt-4">
          <PasswordField compact label="sua senha" onChange={onPasswordChange} password={password} setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="current-password" />
          <button className="mt-2 text-left text-xs font-medium text-[#4938f4] hover:underline" onClick={() => setHelpMessage("Para redefinir sua senha, entre em contato com o administrador da clínica.")} type="button">Esqueceu sua senha?</button>
        </div>
        {error ? <div className="mt-4"><ErrorMessage>{error}</ErrorMessage></div> : notice ? <p aria-live="polite" className="mt-4 rounded-[8px] bg-[#e7f4ef] px-3 py-2 text-xs font-semibold text-[#16805d]" role="status">{notice}</p> : null}
        <Button className="mt-5 h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" size="lg" disabled={isSubmitting} type="submit"><ArrowRight className="h-4 w-4" />{isSubmitting ? "Validando acesso..." : "Acessar"}</Button>
      </form>
      <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-[#e9edf5]" /><span className="text-xs font-medium text-[#8b94af]">ou</span><span className="h-px flex-1 bg-[#e9edf5]" /></div>
      <Button aria-label="Entrar com Google" onClick={startGoogleLogin} className="h-[42px] w-full rounded-[10px] border-[#d9dff0] bg-white px-4 text-[13px] font-semibold text-[#25263a] shadow-none hover:bg-[#f8f9fc]" size="lg" type="button" variant="outline"><GoogleMark />Entrar com Google</Button>
      <button className="mt-5 w-full text-center text-xs font-medium text-[#4938f4] hover:underline" onClick={() => setHelpMessage("Para receber ajuda com o acesso, entre em contato com o administrador da clínica.")} type="button">Precisa de ajuda? Clique aqui.</button>
      {helpMessage ? <p aria-live="polite" className="mt-3 text-center text-xs leading-5 text-[#7783a8]">{helpMessage}</p> : null}
    </>
  );
}

export function GoogleMark() {
  return <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.75 3.28-8.09Z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.15v2.84C3.96 20.53 7.7 23 12 23Z" fill="#34A853" />
    <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.15C1.43 8.55 1 10.22 1 12s.43 3.45 1.15 4.94l3.69-2.84Z" fill="#FBBC05" />
    <path d="M12 5.27c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.99 14.97 1 12 1 7.7 1 3.96 3.47 2.15 7.06l3.69 2.84C6.71 7.2 9.14 5.27 12 5.27Z" fill="#EA4335" />
  </svg>;
}

// Rota de API (redirect externo ao Google): precisa de navegação completa, não de router.push.
function startGoogleSignup() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/api/auth/google?intent=signup");
}

// Cabeçalho do cadastro: ícone redondo lilás, título, subtítulo e linha-acento.
function SignupHeader({ icon: Icon, subtitle, title }: { icon: typeof Mail; subtitle: React.ReactNode; title: string }) {
  return <header className="mb-7 text-center"><div aria-hidden="true" className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-[#eeecff] text-[#5147dc]"><Icon className="h-6 w-6" /></div><h2 className="text-2xl font-black tracking-[0] text-[#211960]">{title}</h2><p className="mt-2 text-[13px] leading-5 text-[#7783a8]">{subtitle}</p><div aria-hidden="true" className="mx-auto mt-4 h-[3px] w-10 rounded-full bg-[#5147dc]" /></header>;
}

const clinicField = { help: "Como sua clínica será identificada na plataforma.", icon: Building2, label: "Nome da clínica", placeholder: "Ex.: Clínica Harmonia" };
const personField = { help: "Será usado para comunicação e acesso à plataforma.", icon: UserRound, label: "Seu nome completo", placeholder: "Como podemos te chamar?" };

function GoogleSignupForm({ error, isSubmitting, onBack, onChange, onSubmit, values }: { error: string; isSubmitting: boolean; onBack: () => void; onChange: (field: keyof RegisterValues, value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; values: RegisterValues }) {
  return (
    <div className="mx-auto w-full max-w-[400px]">
      <SignupHeader icon={UserRound} subtitle="Sua conta Google foi confirmada. Conte sobre sua clínica para começar o teste grátis de 3 dias." title="Quase lá!" />
      <form className="space-y-5" data-autofill="allow" onSubmit={onSubmit}>
        <TextField {...clinicField} onChange={(value) => onChange("clinicName", value)} value={values.clinicName} autoComplete="organization" maxLength={100} />
        <TextField {...personField} onChange={(value) => onChange("name", value)} value={values.name} autoComplete="name" />
        {error ? <div role="alert"><ErrorMessage>{error}</ErrorMessage></div> : null}
        <Button className="h-12 w-full rounded-[10px] bg-[#4938f4] px-4 text-sm font-bold hover:bg-[#3d2de0]" size="lg" disabled={isSubmitting} type="submit">{isSubmitting ? "Criando sua conta..." : "Criar minha conta grátis"}{isSubmitting ? null : <ArrowRight className="h-4 w-4" />}</Button>
        <p className="text-center text-[13px] font-semibold text-[#26305a]">Já tem uma conta? <button className="inline-flex min-h-11 items-center px-1 font-bold text-[#5147dc] hover:underline focus-visible:outline-2 focus-visible:outline-[#5147dc]" onClick={onBack} type="button">Acessar</button></p>
      </form>
    </div>
  );
}

const RESEND_SECONDS = 60;

// Etapa "Verifique seu e-mail" do cadastro com senha. O erro de código é sempre o mesmo; reenviar e alterar e-mail ficam sempre à mão.
function VerifyEmailForm({ email, onChangeEmail, onResend, onVerify }: { email: string; onChangeEmail: () => void; onResend: (email: string) => Promise<{ error?: string }>; onVerify: (code: string) => Promise<VerifyResult> }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== 6) { setError("Digite o código de 6 dígitos."); return; }
    setIsSubmitting(true);
    setInfo("");
    const result = await onVerify(code);
    if (!result.error) return; // Sucesso: o login redireciona a página.
    setError(result.error);
    setCode("");
    inputRef.current?.focus();
    setIsSubmitting(false);
  }

  async function handleResend() {
    setIsResending(true);
    setError("");
    setInfo("");
    const result = await onResend(email);
    setIsResending(false);
    if (result.error) { setError(result.error); return; }
    setCooldown(RESEND_SECONDS);
    setCode("");
    setInfo("Se o e-mail estiver correto, enviamos um novo código.");
    inputRef.current?.focus();
  }

  return (
    <>
      <SignupHeader icon={MailCheck} subtitle={<>Enviamos um código de 6 dígitos para <strong className="break-all font-bold text-[#26305a]">{email}</strong>. Ele expira em 10 minutos.</>} title="Verifique seu e-mail" />
      <form data-autofill="allow" onSubmit={handleSubmit}>
        <label className="block"><span className="mb-1 block text-[11px] font-bold text-[#2d3654]">Código de verificação</span><span className="flex h-12 items-center rounded-[8px] border border-[#dfe7f2] bg-[#f5f8ff] px-3 transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]"><input aria-describedby="verify-feedback" autoComplete="one-time-code" className="w-full bg-transparent text-center text-xl font-black tracking-[0.5em] text-[#172033] outline-none placeholder:text-[#c3cad9]" inputMode="numeric" maxLength={6} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} pattern="[0-9]*" placeholder="000000" ref={inputRef} required value={code} /></span></label>
        <div aria-live="polite" id="verify-feedback" role="status">{error ? <div className="mt-4"><ErrorMessage>{error}</ErrorMessage></div> : info ? <p className="mt-4 text-center text-xs leading-5 text-[#7783a8]">{info}</p> : null}</div>
        <Button className="mt-5 h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" disabled={isSubmitting || code.length !== 6} size="lg" type="submit"><ArrowRight className="h-4 w-4" />{isSubmitting ? "Verificando..." : "Verificar e criar conta"}</Button>
      </form>
      <Button className="mt-3 h-[40px] w-full rounded-[10px] border-[#d9dff0] bg-white px-4 text-[13px] font-semibold text-[#25263a] shadow-none hover:bg-[#f8f9fc]" disabled={cooldown > 0 || isResending} onClick={handleResend} size="lg" type="button" variant="outline">{isResending ? "Reenviando..." : cooldown > 0 ? `Reenviar código em ${cooldown}s` : "Reenviar código"}</Button>
      <button className="mt-4 w-full text-center text-xs font-bold text-[#5147dc] hover:underline" onClick={onChangeEmail} type="button">Alterar e-mail</button>
    </>
  );
}

const strengthColors = ["bg-[#e5484d]", "bg-[#e5484d]", "bg-[#f5a524]", "bg-[#8bc34a]", "bg-[#16a34a]"];
const strengthTextColors = ["text-[#7783a8]", "text-[#e5484d]", "text-[#d9890a]", "text-[#5b9e1f]", "text-[#16a34a]"];

// Medidor de força e checklist da senha: regras compartilhadas com o servidor (password-rules).
function PasswordStrength({ id, password }: { id: string; password: string }) {
  const { score, label } = passwordStrength(password);
  const checks = passwordChecks(password);
  return (
    <div aria-live="polite" id={id}>
      <div aria-hidden="true" className="mt-3 flex items-center gap-1.5">{[1, 2, 3, 4].map((segment) => <span className={`h-1 flex-1 rounded-full transition-colors ${segment <= score ? strengthColors[score] : "bg-[#e6e8f1]"}`} key={segment} />)}</div>
      <p className="mt-1.5 text-[11px] font-bold text-[#2d3654]">Força da senha: <span className={strengthTextColors[score]}>{password ? label : "—"}</span></p>
      <div className="mt-3 rounded-[10px] border border-[#e6e8f1] bg-[#f8faff] px-4 py-3">
        <p className="text-[11px] font-bold text-[#2d3654]">Sua senha deve conter:</p>
        <ul className="mt-2 space-y-1.5">{PASSWORD_RULE_LABELS.map(({ key, label: ruleLabel }) => <li className={`flex items-center gap-2 text-[11px] ${checks[key] ? "font-semibold text-[#16805d]" : "text-[#7783a8]"}`} key={key}>{checks[key] ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#16a34a]" /> : <Circle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#b5bdd2]" />}{ruleLabel}<span className="sr-only">{checks[key] ? " (cumprida)" : " (pendente)"}</span></li>)}</ul>
      </div>
    </div>
  );
}

function RegisterForm({ error, isSubmitting, onBack, onChange, onSubmit, values, setShowPassword, showPassword }: { error: string; isSubmitting: boolean; onBack: () => void; onChange: (field: keyof RegisterValues, value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; values: RegisterValues; setShowPassword: (value: boolean) => void; showPassword: boolean }) {
  const strengthId = useId();
  return (
    <div className="mx-auto w-full max-w-[400px]">
      <SignupHeader icon={UserRound} subtitle="Leva menos de 1 minuto para começar." title="Crie sua conta" />
      <form className="space-y-5" data-autofill="allow" onSubmit={onSubmit}>
        <TextField {...clinicField} onChange={(value) => onChange("clinicName", value)} value={values.clinicName} autoComplete="organization" maxLength={100} />
        <TextField {...personField} onChange={(value) => onChange("name", value)} value={values.name} autoComplete="name" />
        <TextField help="Enviaremos novidades e informações importantes." icon={Mail} label="E-mail" onChange={(value) => onChange("email", value)} placeholder="nome@dominio.com" type="email" value={values.email} autoComplete="email" />
        <div>
          <PasswordField describedBy={strengthId} label="Senha" onChange={(value) => onChange("password", value)} password={values.password} placeholder="Crie uma senha segura" setShowPassword={setShowPassword} showPassword={showPassword} touch />
          <PasswordStrength id={strengthId} password={values.password} />
        </div>
        {error ? <div role="alert"><ErrorMessage>{error}</ErrorMessage></div> : null}
        <div>
          <Button className="h-12 w-full rounded-[10px] bg-[#4938f4] px-4 text-sm font-bold hover:bg-[#3d2de0]" size="lg" disabled={isSubmitting} type="submit">{isSubmitting ? "Criando sua conta..." : "Criar minha conta grátis"}{isSubmitting ? null : <ArrowRight className="h-4 w-4" />}</Button>
          <div className="my-4 flex items-center gap-3"><span className="h-px flex-1 bg-[#e9edf5]" /><span className="text-xs font-medium text-[#8b94af]">ou</span><span className="h-px flex-1 bg-[#e9edf5]" /></div>
          <Button aria-label="Continuar com Google" onClick={startGoogleSignup} className="h-12 w-full rounded-[10px] border-[#d9dff0] bg-white px-4 text-sm font-semibold text-[#25263a] shadow-none hover:bg-[#f8f9fc]" size="lg" type="button" variant="outline"><GoogleMark />Continuar com Google</Button>
          <p className="mt-4 text-center text-[11px] leading-4 text-[#7783a8]">Ao continuar, você concorda com os <a className="font-bold text-[#5147dc] underline underline-offset-2" href="#termos">Termos de Uso</a> e a <a className="font-bold text-[#5147dc] underline underline-offset-2" href="#privacidade">Política de Privacidade</a>.</p>
          <p className="mt-3 text-center text-[13px] font-semibold text-[#26305a]">Já tem uma conta? <button className="inline-flex min-h-11 items-center px-1 font-bold text-[#5147dc] hover:underline focus-visible:outline-2 focus-visible:outline-[#5147dc]" onClick={onBack} type="button">Acessar</button></p>
        </div>
      </form>
    </div>
  );
}

// `help` (opcional): texto de ajuda abaixo do campo, ligado ao input por aria-describedby.
export function TextField({ compact = false, help, icon: Icon, label, onChange, placeholder, type = "text", value, autoComplete, maxLength, readOnly = false }: { compact?: boolean; help?: string; icon?: typeof Mail; label: string; onChange: (value: string) => void; placeholder: string; type?: string; value: string; autoComplete?: string; maxLength?: number; readOnly?: boolean }) {
  const helpId = useId();
  return <div><label className="block"><span className={`block font-bold text-[#2d3654] ${compact ? "mb-1 text-[11px]" : "mb-2 text-xs"}`}>{label}</span><span className={`flex ${compact ? "h-9 gap-2 px-3 text-xs" : "h-12 gap-3 px-4 text-sm"} items-center rounded-[8px] border border-[#dfe7f2] ${readOnly ? "bg-[#eef1f7]" : "bg-[#f5f8ff]"} text-[#68728a] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]`}>{Icon ? <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[#7885ab]" /> : null}<input aria-describedby={help ? helpId : undefined} className="w-full bg-transparent font-semibold text-[#172033] outline-none placeholder:text-[#9aa5b8]" autoComplete={autoComplete} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} readOnly={readOnly} required type={type} value={value} /></span></label>{help ? <p className="mt-1.5 text-[11px] leading-4 text-[#7783a8]" id={helpId}>{help}</p> : null}</div>;
}

// `describedBy` (opcional): id de um bloco de ajuda/checklist renderizado pelo chamador. `touch`: botao de olho com alvo de 44px.
export function PasswordField({ compact = false, describedBy, label = "Senha", onChange, password, placeholder = "Digite sua senha", setShowPassword, showPassword, autoComplete = label === "Senha" ? "new-password" : "current-password", minLength, touch = false }: { compact?: boolean; describedBy?: string; label?: string; onChange: (value: string) => void; password: string; placeholder?: string; setShowPassword: (value: boolean) => void; showPassword: boolean; autoComplete?: string; minLength?: number; touch?: boolean }) {
  return <label className="block"><span className={`block font-bold text-[#2d3654] ${compact ? "mb-1 text-[11px]" : "mb-2 text-xs"}`}>{label}</span><span className={`flex ${compact ? "h-9 gap-2 px-3 text-xs" : "h-12 gap-3 px-4 text-sm"} items-center rounded-[8px] border border-[#dfe7f2] bg-[#f5f8ff] text-[#68728a] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]`}><LockKeyhole aria-hidden="true" className="h-4 w-4 shrink-0 text-[#7885ab]" /><input aria-describedby={describedBy} className="w-full bg-transparent font-semibold text-[#172033] outline-none placeholder:text-[#9aa5b8]" autoComplete={autoComplete} minLength={minLength} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required type={showPassword ? "text" : "password"} value={password} /><button className={`grid shrink-0 place-items-center rounded-full text-[#7b8499] transition hover:bg-[#eef4fb] hover:text-[#5947ee] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5947ee] ${touch ? "-mr-2 h-11 w-11" : "h-8 w-8"}`} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} type="button">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>;
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
    <form className="space-y-4" data-autofill="allow" onSubmit={handleSubmit}>
      <PasswordField label="Nova senha" onChange={(value) => { setPassword(value); setError(""); }} password={password} placeholder="Crie uma senha com pelo menos 8 caracteres" setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="new-password" minLength={8} />
      <PasswordField label="Confirmar nova senha" onChange={(value) => { setConfirmation(value); setError(""); }} password={confirmation} placeholder="Digite a senha novamente" setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="new-password" minLength={8} />
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <Button className="w-full" size="lg" disabled={isSubmitting} type="submit">{isSubmitting ? "Salvando nova senha..." : "Salvar senha e acessar"}<ArrowRight className="h-4 w-4" /></Button>
    </form>
  </>;
}

export function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[8px] border border-[#ffd7d7] bg-[#fff7f7] px-4 py-3 text-xs font-bold text-[#b42318]">{children}</p>;
}
