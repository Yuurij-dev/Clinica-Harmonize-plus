"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Mail, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaskedInput } from "@/components/ui/masked-input";
import { formatCpf } from "@/lib/input-masks";
import { validCpf } from "@/lib/patient-registration-rules";
import { cn } from "@/lib/utils";
import { inviteGoogleNotice, loginMessageFor, stepAfterPasswordChange, type InviteStep } from "@/lib/invite-flow-rules";
import { AuthShell, ErrorMessage, GoogleMark, PasswordField, TextField } from "./login-screen";

type InvitationPreview = { clinicName: string; role: string; email: string; status: string };
type Session = { email: string } | null;
type Step = InviteStep;

const roleLabels: Record<string, string> = { PROFESSIONAL: "Profissional", STAFF: "Atendente" };
const invalidMessage = "Este convite não é mais válido. Peça um novo convite à clínica.";

// Navegação completa: o app abre já autenticado e `?google=ok` avisa as outras abas da troca de sessão.
function openApp() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/?google=ok");
}

async function readMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => null) as { message?: string } | null;
  return data?.message ?? fallback;
}

const formatCep = (value: string) => { const digits = value.replace(/\D/g, "").slice(0, 8); return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits; };
const personalInputClass = "w-full bg-transparent font-semibold text-[#172033] outline-none placeholder:text-[#9aa5b8]";
const personalBoxClass = "flex h-9 items-center gap-2 rounded-[8px] border border-[#dfe7f2] bg-[#f5f8ff] px-3 text-xs text-[#68728a] transition focus-within:border-[#5947ee] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(89,71,238,0.08)]";

type Address = { address: string; country: string; state: string; city: string };
const emptyAddress: Address = { address: "", country: "Brasil", state: "", city: "" };

type FieldErrors = { name?: string; cpf?: string };

// Campo com validação visual (padrão do app): aria-invalid + borda vermelha + shake e mensagem role="alert".
// `key={attempt}` re-dispara o shake a cada envio inválido; o valor mora no estado do pai, então o remonte não o perde.
function InviteField({ attempt, error, icon: Icon, label, onChange, optional = false, ...input }: { attempt: number; error?: string; icon?: typeof User; label: string; onChange: (value: string) => void; optional?: boolean; autoComplete?: string; inputMode?: "numeric"; maxLength?: number; name?: string; placeholder: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold text-[#2d3654]">{label}{optional ? " (opcional)" : ""}</span>
      <span className={cn(personalBoxClass, error && "border-destructive animate-[hp-shake_0.42s_ease-in-out]")} key={`box-${attempt}`}>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-[#7885ab]" /> : null}
        <input {...input} aria-invalid={error ? true : undefined} className={cn(personalInputClass, "aria-invalid:text-destructive")} onChange={(event) => onChange(event.target.value)} />
      </span>
      {error ? <p className="mt-1 text-xs font-medium text-destructive" key={`err-${attempt}`} role="alert">{error}</p> : null}
    </label>
  );
}

// Valida nome e CPF no envio (sem o popup nativo). Devolve os erros por campo; vazio = tudo certo.
function validateProfile(name: string, cpf: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!name.trim()) errors.name = "Informe seu nome.";
  if (!cpf.trim()) errors.cpf = "Informe o CPF.";
  else if (!validCpf(cpf)) errors.cpf = "CPF inválido. Confira os números.";
  return errors;
}

// Dados pessoais do cadastro de colaborador: só CPF é obrigatório; CEP, endereço, país, estado e cidade são opcionais.
// O CEP é lido do formulário (name="postalCode") em `readPersonal`; o resto vem do estado do pai.
function PersonalDataFields({ value, onChange, cpf, onCpfChange, cpfError, attempt }: { value: Address; onChange: (next: Address) => void; cpf: string; onCpfChange: (cpf: string) => void; cpfError?: string; attempt: number }) {
  const postalRef = useRef<HTMLSpanElement>(null); // MaskedInput não repassa ref; o valor é lido do <input> dentro do span
  const [cepError, setCepError] = useState("");
  const [cepLoading, setCepLoading] = useState(false);

  async function lookupPostalCode() {
    const digits = (postalRef.current?.querySelector("input")?.value ?? "").replace(/\D/g, "");
    if (digits.length !== 8) { setCepError("Informe um CEP com 8 dígitos."); return; }
    setCepLoading(true);
    setCepError("");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await response.json() as { erro?: boolean; logradouro?: string; complemento?: string; bairro?: string; localidade?: string; uf?: string; estado?: string };
      if (!response.ok || data.erro) { setCepError("CEP não encontrado. Confira o número e tente novamente."); return; }
      onChange({ address: [data.logradouro, data.complemento, data.bairro].filter(Boolean).join(", "), country: "Brasil", state: data.estado || data.uf || "", city: data.localidade || "" });
    } catch {
      setCepError("Não foi possível consultar o CEP. Tente novamente.");
    } finally {
      setCepLoading(false);
    }
  }

  const label = (text: string) => <span className="mb-1 block text-[11px] font-bold text-[#2d3654]">{text}</span>;
  return (
    <>
      <InviteField attempt={attempt} autoComplete="off" error={cpfError} inputMode="numeric" label="CPF" maxLength={14} name="cpf" onChange={(next) => onCpfChange(formatCpf(next))} placeholder="000.000.000-00" value={cpf} />
      <div className="flex items-end gap-2">
        <label className="block min-w-0 flex-1">{label("CEP (opcional)")}<span className={personalBoxClass} ref={postalRef}><MaskedInput autoComplete="postal-code" className={personalInputClass} formatter={formatCep} inputMode="numeric" maxLength={9} name="postalCode" placeholder="00000-000" /></span></label>
        <Button className="h-9 shrink-0 rounded-[8px] px-3 text-xs" disabled={cepLoading} onClick={() => void lookupPostalCode()} size="sm" type="button" variant="secondary">{cepLoading ? "Buscando..." : "Buscar CEP"}</Button>
      </div>
      {cepError ? <p className="-mt-2 text-xs text-[#b42318]" role="alert">{cepError}</p> : null}
      <InviteField attempt={0} autoComplete="address-line1" label="endereço" onChange={(address) => onChange({ ...value, address })} optional placeholder="Rua, número, bairro e complemento" value={value.address} />
      <InviteField attempt={0} autoComplete="country-name" label="país" onChange={(country) => onChange({ ...value, country })} optional placeholder="Brasil" value={value.country} />
      <InviteField attempt={0} autoComplete="address-level1" label="estado" onChange={(state) => onChange({ ...value, state })} optional placeholder="Estado" value={value.state} />
      <InviteField attempt={0} autoComplete="address-level2" label="cidade" onChange={(city) => onChange({ ...value, city })} optional placeholder="Cidade" value={value.city} />
    </>
  );
}

function readPersonal(form: HTMLFormElement, cpf: string, address: Address) {
  const data = new FormData(form);
  return { cpf, postalCode: String(data.get("postalCode") ?? ""), ...address };
}

export function InviteAcceptScreen({ token, googleStatus }: { token: string; googleStatus?: string }) {
  // ?google=account_exists|invite_email_mismatch vem do callback do Google: mostra a mensagem e leva ao caminho certo.
  const [notice] = useState(() => inviteGoogleNotice(googleStatus));
  const [invitation, setInvitation] = useState<InvitationPreview | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // undefined = ainda verificando; null = sem sessão; { email } = há sessão de alguma conta.
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [step, setStep] = useState<Step>(notice?.step ?? "choose");
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formAttempt, setFormAttempt] = useState(0); // re-dispara o shake a cada envio inválido
  const [address, setAddress] = useState<Address>(emptyAddress);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(notice?.message ?? "");
  const [busy, setBusy] = useState(false);

  // Só para saber de quem é a sessão atual (não monta o app nem redireciona; 401 = sem sessão).
  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => (response.ok ? await response.json() as { user?: { email?: string } } : null))
      .then((data) => { if (active) setSession(data?.user?.email ? { email: data.user.email.toLowerCase() } : null); })
      .catch(() => { if (active) setSession(null); });
    return () => { active = false; };
  }, []);

  // Página pública (sem sessão): o preview não passa pelo cache autenticado do app e nunca é guardado em storage.
  // Falha de rede/5xx é diferente de convite inválido: mostra "tentar novamente".
  useEffect(() => {
    let active = true;
    fetch(`/api/invitations/preview?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("preview");
        return response.json() as Promise<{ invitation: InvitationPreview | null }>;
      })
      .then((data) => { if (active) { setLoadFailed(false); setInvitation(data.invitation && data.invitation.status === "pending" ? data.invitation : null); } })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [token, attempt]);

  function retryPreview() {
    setLoadFailed(false);
    setInvitation(undefined);
    setAttempt((n) => n + 1);
  }

  async function leaveCurrentSession() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* o recarregamento abaixo mostra o estado real */ }
    window.localStorage.setItem("harmonize-session-change", String(Date.now()));
    window.location.reload();
  }

  async function acceptWithCurrentSession() {
    setBusy(true);
    setError("");
    try { await acceptWithSession(); } catch { setError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente."); } finally { setBusy(false); }
  }

  // true = nome e CPF ok. Senão marca os campos (vermelho + shake), foca o primeiro inválido e bloqueia o envio.
  function profileIsValid(form: HTMLFormElement) {
    const errors = validateProfile(name, cpf);
    setFieldErrors(errors);
    if (!errors.name && !errors.cpf) return true;
    setError("");
    setFormAttempt((n) => n + 1);
    requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    return false;
  }

  function changeName(next: string) { setName(next); setFieldErrors((current) => ({ ...current, name: undefined })); }
  function changeCpf(next: string) { setCpf(next); setFieldErrors((current) => ({ ...current, cpf: undefined })); }

  function go(next: Step) {
    setFieldErrors({});
    setError("");
    setPassword("");
    setConfirmation("");
    setStep(next);
  }

  function startGoogle() {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/api/auth/google?intent=login&invite=${encodeURIComponent(token)}`);
  }

  // true = convite aceito (navegou ou mostrou o aviso de outra clínica); false = falhou (erro já exibido).
  async function acceptWithSession(): Promise<boolean> {
    const response = await fetch("/api/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    if (!response.ok) {
      setError(await readMessage(response, "Não foi possível aceitar o convite agora. Tente novamente."));
      return false;
    }
    const data = await response.json().catch(() => null) as { alreadyInOtherClinic?: boolean } | null;
    if (data?.alreadyInOtherClinic) { setStep("done-other-clinic"); return true; }
    openApp();
    return true;
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!profileIsValid(form)) return;
    if (password.length < 8) { setError("A senha deve ter pelo menos 8 caracteres."); return; }
    if (password !== confirmation) { setError("As senhas não coincidem."); return; } // nosemgrep: rules.ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/invite/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, name, password, ...readPersonal(form, cpf, address) }) });
      if (response.ok) { openApp(); return; }
      if (response.status === 409) { go("signin"); setError("Já existe uma conta com este e-mail. Entre com sua senha para aceitar o convite."); return; }
      setError(await readMessage(response, "Não foi possível criar a conta agora. Tente novamente."));
    } catch {
      setError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  // Conta nova pelo Google: a identidade já foi provada no callback (cookie assinado); aqui só vão os dados pessoais.
  async function submitGoogleComplete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!profileIsValid(form)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/invite/google/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, name, ...readPersonal(form, cpf, address) }) });
      if (response.ok) { openApp(); return; }
      const data = await response.json().catch(() => null) as { code?: string; message?: string } | null;
      const message = data?.message ?? "Não foi possível concluir o cadastro agora. Tente novamente.";
      if (response.status === 409) { go("signin"); setError(message); return; }
      // Verificação do Google ausente/expirada ou convite inválido: não adianta reenviar, recomeça pelo Google.
      if (data?.code === "pending_missing" || response.status === 404) { go("choose"); setError(message); return; }
      setError(message);
    } catch {
      setError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function submitSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: invitation.email, password }) });
      const data = await response.json().catch(() => null) as { message?: string; passwordChangeRequired?: boolean } | null;
      if (!response.ok) { setError(loginMessageFor(response.status, data?.message)); return; }
      if (data?.passwordChangeRequired) { go("change-password"); return; }
      await acceptWithSession();
    } catch {
      setError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function submitNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) { setError("As senhas não coincidem."); return; } // nosemgrep: rules.ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack
    setBusy(true);
    setError("");
    let changed = false;
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!response.ok) { setError(await readMessage(response, "Não foi possível salvar a nova senha.")); return; }
      // A senha provisória já foi trocada: se o aceite falhar (resposta de erro ou exceção de rede), volta ao login (reenviar a troca daria 403 enganoso).
      changed = true;
      const accepted = await acceptWithSession();
      const next = stepAfterPasswordChange({ changed: true, accepted });
      if (next.step === "signin") { go("signin"); setError(next.message); }
    } catch {
      if (changed) {
        const next = stepAfterPasswordChange({ changed: true, accepted: false });
        go("signin");
        setError(next.message);
      } else {
        setError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
      }
    } finally {
      setBusy(false);
    }
  }

  const errorBlock = error ? <div aria-live="assertive" className="mt-4" role="alert"><ErrorMessage>{error}</ErrorMessage></div> : <div aria-live="assertive" />;

  return (
    <AuthShell>
      <div className="mx-auto w-full max-w-[360px]">
        {loadFailed ? (
          <>
            <header className="text-center"><h2 className="text-2xl font-black tracking-[0] text-[#211960]">Não foi possível carregar o convite</h2><p className="mt-3 text-[13px] leading-5 text-[#7783a8]">Verifique sua conexão e tente novamente.</p></header>
            <Button className="mt-6 h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" onClick={retryPreview} size="lg" type="button">Tentar novamente</Button>
          </>
        ) : invitation === undefined || session === undefined ? (
          <p aria-live="polite" className="text-center text-sm text-[#7783a8]">Verificando convite...</p>
        ) : invitation === null ? (
          <header className="text-center"><h2 className="text-2xl font-black tracking-[0] text-[#211960]">Convite indisponível</h2><p className="mt-3 text-[13px] leading-5 text-[#7783a8]">{invalidMessage}</p></header>
        ) : session && session.email !== invitation.email && step !== "done-other-clinic" ? (
          <>
            <header className="text-center"><h2 className="text-2xl font-black tracking-[0] text-[#211960]">Você foi convidado!</h2><p className="mt-3 text-[13px] leading-5 text-[#7783a8]">Você foi convidado para a clínica <strong className="text-[#211960]">{invitation.clinicName}</strong>, mas está logado com outra conta. Saia antes de aceitar este convite.</p></header>
            <Button className="mt-6 h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" disabled={busy} onClick={() => void leaveCurrentSession()} size="lg" type="button">{busy ? "Saindo..." : "Sair da conta atual"}</Button>
          </>
        ) : session && session.email === invitation.email && step !== "done-other-clinic" ? (
          <>
            <header className="mb-6 text-center"><h2 className="text-2xl font-black tracking-[0] text-[#211960]">Você foi convidado!</h2><p className="mt-2 text-[13px] leading-5 text-[#7783a8]">Você foi convidado para a clínica <strong className="text-[#211960]">{invitation.clinicName}</strong> como <strong className="text-[#211960]">{roleLabels[invitation.role] ?? "membro da equipe"}</strong>. Você já está logado com {invitation.email}.</p></header>
            {errorBlock}
            <Button className="mt-4 h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" disabled={busy} onClick={() => void acceptWithCurrentSession()} size="lg" type="button"><ArrowRight className="h-4 w-4" />{busy ? "Aceitando..." : "Aceitar convite"}</Button>
          </>
        ) : step === "done-other-clinic" ? (
          <>
            <header className="text-center"><h2 className="text-2xl font-black tracking-[0] text-[#211960]">Convite aceito</h2><p className="mt-3 text-[13px] leading-5 text-[#7783a8]">Você agora também faz parte da clínica {invitation.clinicName}. Por enquanto, o acesso abre a clínica mais antiga da sua conta; a troca de clínica ativa chega em breve.</p></header>
            <Button className="mt-6 h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" onClick={openApp} size="lg" type="button"><ArrowRight className="h-4 w-4" />Ir para o sistema</Button>
          </>
        ) : (
          <>
            <header className="mb-6 text-center">
              <h2 className="text-2xl font-black tracking-[0] text-[#211960]">Você foi convidado!</h2>
              <p className="mt-2 text-[13px] leading-5 text-[#7783a8]">Você foi convidado para a clínica <strong className="text-[#211960]">{invitation.clinicName}</strong> como <strong className="text-[#211960]">{roleLabels[invitation.role] ?? "membro da equipe"}</strong>.</p>
            </header>
            {step === "choose" ? (
              <div className="space-y-3">
                <TextField compact icon={Mail} label="e-mail do convite" onChange={() => {}} placeholder="" readOnly value={invitation.email} />
                <Button aria-label="Entrar com Google" className="h-[42px] w-full rounded-[10px] border-[#d9dff0] bg-white px-4 text-[13px] font-semibold text-[#25263a] shadow-none hover:bg-[#f8f9fc]" onClick={startGoogle} size="lg" type="button" variant="outline"><GoogleMark />Entrar com Google</Button>
                <p className="text-center text-[11px] leading-4 text-[#8b94af]">Use a conta Google com o e-mail acima.</p>
                <Button className="h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" onClick={() => go("register")} size="lg" type="button"><ArrowRight className="h-4 w-4" />Criar conta com senha</Button>
                <button className="w-full text-center text-xs font-medium text-[#4938f4] hover:underline" onClick={() => go("signin")} type="button">Já tenho conta com senha</button>
                {errorBlock}
              </div>
            ) : step === "register" ? (
              <form className="space-y-4" data-autofill="allow" noValidate onSubmit={submitRegister}>
                <TextField compact icon={Mail} label="e-mail do convite" onChange={() => {}} placeholder="" readOnly value={invitation.email} />
                <InviteField attempt={formAttempt} autoComplete="name" error={fieldErrors.name} icon={User} label="seu nome" maxLength={100} onChange={changeName} placeholder="Nome e sobrenome" value={name} />
                <PersonalDataFields attempt={formAttempt} cpf={cpf} cpfError={fieldErrors.cpf} onChange={setAddress} onCpfChange={changeCpf} value={address} />
                <PasswordField compact label="Senha" minLength={8} onChange={setPassword} password={password} placeholder="Pelo menos 8 caracteres" setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="new-password" />
                <PasswordField compact label="Confirmar senha" minLength={8} onChange={setConfirmation} password={confirmation} placeholder="Digite a senha novamente" setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="new-password" />
                {errorBlock}
                <Button className="h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" disabled={busy} size="lg" type="submit"><ArrowRight className="h-4 w-4" />{busy ? "Criando conta..." : "Criar conta e entrar"}</Button>
                <button className="w-full text-center text-xs font-medium text-[#4938f4] hover:underline" onClick={() => go("choose")} type="button">Voltar</button>
              </form>
            ) : step === "google-complete" ? (
              <form className="space-y-4" data-autofill="allow" noValidate onSubmit={submitGoogleComplete}>
                <p className="text-[13px] leading-5 text-[#7783a8]">Google confirmado. Complete seus dados para criar a conta.</p>
                <TextField compact icon={Mail} label="e-mail do convite" onChange={() => {}} placeholder="" readOnly value={invitation.email} />
                <InviteField attempt={formAttempt} autoComplete="name" error={fieldErrors.name} icon={User} label="seu nome" maxLength={100} onChange={changeName} placeholder="Nome e sobrenome" value={name} />
                <PersonalDataFields attempt={formAttempt} cpf={cpf} cpfError={fieldErrors.cpf} onChange={setAddress} onCpfChange={changeCpf} value={address} />
                {errorBlock}
                <Button className="h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" disabled={busy} size="lg" type="submit"><ArrowRight className="h-4 w-4" />{busy ? "Criando conta..." : "Criar conta e entrar"}</Button>
                <button className="w-full text-center text-xs font-medium text-[#4938f4] hover:underline" onClick={() => go("choose")} type="button">Recomeçar</button>
              </form>
            ) : step === "signin" ? (
              <form className="space-y-4" data-autofill="allow" onSubmit={submitSignIn}>
                <TextField compact icon={Mail} label="e-mail do convite" onChange={() => {}} placeholder="" readOnly value={invitation.email} />
                <PasswordField compact label="sua senha" onChange={setPassword} password={password} setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="current-password" />
                {errorBlock}
                <Button className="h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" disabled={busy} size="lg" type="submit"><ArrowRight className="h-4 w-4" />{busy ? "Validando acesso..." : "Entrar e aceitar convite"}</Button>
                <button className="w-full text-center text-xs font-medium text-[#4938f4] hover:underline" onClick={() => go("choose")} type="button">Voltar</button>
              </form>
            ) : (
              <form className="space-y-4" data-autofill="allow" onSubmit={submitNewPassword}>
                <p className="text-[13px] leading-5 text-[#7783a8]">Sua senha é provisória. Defina uma nova senha para continuar e aceitar o convite.</p>
                <PasswordField compact label="Nova senha" minLength={8} onChange={setPassword} password={password} placeholder="Pelo menos 8 caracteres" setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="new-password" />
                <PasswordField compact label="Confirmar nova senha" minLength={8} onChange={setConfirmation} password={confirmation} placeholder="Digite a senha novamente" setShowPassword={setShowPassword} showPassword={showPassword} autoComplete="new-password" />
                {errorBlock}
                <Button className="h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]" disabled={busy} size="lg" type="submit"><ArrowRight className="h-4 w-4" />{busy ? "Salvando..." : "Salvar senha e aceitar convite"}</Button>
              </form>
            )}
          </>
        )}
      </div>
    </AuthShell>
  );
}
