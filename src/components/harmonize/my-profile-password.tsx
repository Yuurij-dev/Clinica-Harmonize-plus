"use client";

import { useId, useState, type FormEvent } from "react";
import { Check, Circle, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, fieldClassName } from "@/components/ui/modal";
import { validatePasswordChange, type PasswordChangeField } from "@/lib/own-profile-rules";
import { PASSWORD_RULE_LABELS, passwordChecks, passwordStrength } from "@/lib/password-rules";
import { cn } from "@/lib/utils";
import { revealValidationTarget } from "./reveal-validation-target";

const strengthColors = ["bg-muted", "bg-destructive", "bg-warning", "bg-success/70", "bg-success"];

type FieldKey = PasswordChangeField | "confirmPassword";
type Errors = Partial<Record<FieldKey, string>>;

// Medidor e checklist com as mesmas regras do cadastro (password-rules), em tokens do tema (o da tela de login usa cores fixas).
function PasswordChecklist({ id, password, highlightMissing }: { id: string; password: string; highlightMissing: boolean }) {
  const { score, label } = passwordStrength(password);
  const checks = passwordChecks(password);
  return (
    <div aria-live="polite" id={id} className="space-y-2">
      <div aria-hidden="true" className="flex items-center gap-1.5">{[1, 2, 3, 4].map((segment) => <span className={cn("h-1 flex-1 rounded-full transition-colors", segment <= score ? strengthColors[score] : "bg-muted")} key={segment} />)}</div>
      <p className="text-xs font-semibold text-foreground">Força da senha: <span className="text-muted-foreground">{password ? label : "—"}</span></p>
      <ul className="space-y-1">{PASSWORD_RULE_LABELS.map(({ key, label: ruleLabel }) => (
        <li className={cn("flex items-center gap-2 text-xs", checks[key] ? "font-semibold text-success" : highlightMissing ? "font-semibold text-destructive" : "text-muted-foreground")} key={key}>
          {checks[key] ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <Circle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
          {ruleLabel}<span className="sr-only">{checks[key] ? " (cumprida)" : " (pendente)"}</span>
        </li>
      ))}</ul>
    </div>
  );
}

export function MyProfilePassword({ email, canChangePassword, onChanged }: { email: string; canChangePassword: boolean; onChanged: () => void }) {
  const baseId = useId();
  const ids: Record<FieldKey, string> = { currentPassword: `${baseId}-current`, newPassword: `${baseId}-new`, confirmPassword: `${baseId}-confirm` };
  const checklistId = `${baseId}-rules`;
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [warning, setWarning] = useState("");
  const [shake, setShake] = useState<Record<FieldKey, number>>({ currentPassword: 0, newPassword: 0, confirmPassword: 0 });

  if (!canChangePassword) {
    return (
      <Card className="border-border/70">
        <CardHeader className="border-b border-border/70"><div><CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Alterar senha</CardTitle></div></CardHeader>
        <CardContent className="pt-4"><p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Sua conta entra com o Google e não tem uma senha do Harmonize+. Para mudar como você entra, use as configurações da sua conta Google. A verificação em duas etapas, abaixo, continua disponível.</p></CardContent>
      </Card>
    );
  }

  function set(field: FieldKey, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    setDone(false);
    setWarning("");
  }

  function fail(next: Errors) {
    setErrors(next);
    setShake((current) => ({ currentPassword: current.currentPassword + (next.currentPassword ? 1 : 0), newPassword: current.newPassword + (next.newPassword ? 1 : 0), confirmPassword: current.confirmPassword + (next.confirmPassword ? 1 : 0) }));
    const first = (["currentPassword", "newPassword", "confirmPassword"] as const).find((field) => next[field]);
    if (first) revealValidationTarget(ids[first]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setFormError("");
    const checked = validatePasswordChange(values);
    const next: Errors = {};
    if (!checked.ok) next[checked.field] = checked.message;
    if (values.newPassword !== values.confirmPassword) next.confirmPassword = "As senhas não coincidem.";
    if (Object.keys(next).length) { fail(next); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/me/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }) });
      const data = await response.json().catch(() => null) as { message?: string; field?: PasswordChangeField; code?: string; warning?: string } | null;
      if (!response.ok) {
        if (data?.code === "invalid_password") fail({ currentPassword: "Senha atual incorreta." });
        else if (data?.field) fail({ [data.field]: data.message ?? "Confira este campo." });
        else setFormError(data?.message ?? "Não foi possível alterar a senha. Tente novamente.");
        return;
      }
      setValues({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setErrors({});
      setDone(true);
      setWarning(data?.warning ?? "");
      toast.success("Senha alterada.");
      onChanged();
    } catch {
      setFormError("Não foi possível alterar a senha. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  const field = (name: FieldKey, label: string, autoComplete: string, extra?: { describedBy?: string }) => (
    <FormField label={label} htmlFor={ids[name]}>
      <div key={`${name}-${shake[name]}`} className={errors[name] ? "hp-field-shake" : undefined}>
        <input id={ids[name]} className={fieldClassName} type={show && name !== "currentPassword" ? "text" : "password"} value={values[name]} autoComplete={autoComplete} aria-invalid={errors[name] ? true : undefined} aria-describedby={[errors[name] ? `${ids[name]}-error` : "", extra?.describedBy ?? ""].filter(Boolean).join(" ") || undefined} maxLength={128} onChange={(event) => set(name, event.target.value)} />
      </div>
      {errors[name] ? <p id={`${ids[name]}-error`} role="alert" className="text-xs font-medium text-destructive">{errors[name]}</p> : null}
    </FormField>
  );

  return (
    <Card className="border-border/70">
      <CardHeader className="border-b border-border/70">
        <div>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Alterar senha</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Ao trocar a senha, os outros dispositivos e sessões serão desconectados. Esta sessão continua aberta.</p>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <form className="space-y-4" noValidate onSubmit={submit}>
          {/* Campo de usuário oculto: o gerenciador de senhas associa a nova senha ao e-mail certo. */}
          <input type="text" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 sm:max-w-sm">{field("currentPassword", "Senha atual", "current-password")}</div>
            {field("newPassword", "Nova senha", "new-password", { describedBy: checklistId })}
            {field("confirmPassword", "Confirmar nova senha", "new-password")}
          </div>
          <PasswordChecklist id={checklistId} password={values.newPassword} highlightMissing={Boolean(errors.newPassword)} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" aria-pressed={show} onClick={() => setShow((value) => !value)}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{show ? "Ocultar nova senha" : "Mostrar nova senha"}</Button>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{saving ? "Alterando..." : "Alterar senha"}</Button>
          </div>
          {formError ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{formError}</p> : null}
          {done && !warning ? <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success" role="status">Senha alterada. Os outros dispositivos foram desconectados.</p> : null}
          {done && warning ? <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning" role="status">{warning}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
