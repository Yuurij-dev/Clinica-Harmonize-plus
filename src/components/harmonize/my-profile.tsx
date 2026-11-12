"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Building2, Camera, Loader2, Moon, Pencil, Search, Sun, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Modal, fieldClassName } from "@/components/ui/modal";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { formatCep, formatCpf, formatPhone } from "@/lib/input-masks";
import type { OwnProfile } from "@/lib/own-profile";
import { isMaskedCpf, parseOwnProfile, type OwnProfileField } from "@/lib/own-profile-rules";
import { profileUpdatedEvent, type ProfileUpdatedDetail } from "@/lib/section-events";
import { THEME_CHANGE_EVENT, isDarkTheme, toggleThemeWithReveal } from "@/lib/theme-transition";
import { lookupViaCep } from "@/lib/viacep";
import { MyProfilePassword } from "./my-profile-password";
import { OwnAvatar } from "./own-avatar";
import { revealValidationTarget } from "./reveal-validation-target";
import { SecuritySettings } from "./security-settings";
import { useUnsavedChangesGuard } from "./use-draft-autosave";
import { LoadingSkeleton, SectionIntro } from "./shared";
import { TeamMemberPhotoDialog } from "./team-member-photo-dialog";

const ME_KEY = "/api/me";
const roleLabels: Record<string, string> = { ADMIN: "Administradora", PROFESSIONAL: "Profissional", STAFF: "Atendente" };
const sectionTitle = "border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

type Draft = Record<OwnProfileField, string>;
const emptyShake: Record<OwnProfileField, number> = { name: 0, phone: 0, cpf: 0, postalCode: 0, address: 0, country: 0, state: 0, city: 0 };
const fieldOrder: OwnProfileField[] = ["name", "phone", "cpf", "postalCode", "address", "country", "state", "city"];

const toDraft = (me: OwnProfile): Draft => ({
  name: me.name,
  phone: me.phone ? formatPhone(me.phone) : "",
  cpf: me.cpf ?? "",
  postalCode: me.postalCode ? formatCep(me.postalCode) : "",
  address: me.address ?? "",
  country: me.country ?? "",
  state: me.state ?? "",
  city: me.city ?? "",
});

function announce(detail: ProfileUpdatedDetail) {
  window.dispatchEvent(new CustomEvent<ProfileUpdatedDetail>(profileUpdatedEvent, { detail }));
}

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(isDarkTheme());
    sync();
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);
  return dark;
}

// "Meu perfil": dados, foto, senha, segurança, clínicas e tema do PRÓPRIO usuário (todos os papéis). Tudo vem de /api/me*; o userId é sempre o da sessão.
export function MyProfile() {
  const baseId = useId();
  const dark = useIsDark();
  const [me, setMe] = useState<OwnProfile | null>(() => readClientCache<OwnProfile>(ME_KEY) ?? null);
  const [loadError, setLoadError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<OwnProfileField, string>>>({});
  const [shake, setShake] = useState(emptyShake);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [photoMenu, setPhotoMenu] = useState<null | "menu" | "upload">(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [securityTick, setSecurityTick] = useState(0);

  useEffect(() => {
    let active = true;
    getCachedJson<OwnProfile>(ME_KEY)
      .then((data) => { if (active) { setMe(data); setLoadError(""); } })
      .catch((error: unknown) => { if (active && !(error instanceof DOMException)) setLoadError("Não foi possível carregar o seu perfil. Confira a conexão e tente novamente."); });
    return () => { active = false; };
  }, [reloadTick]);

  // Só há aviso se algo realmente mudou em relação ao que está salvo.
  const dirty = editing && draft !== null && me !== null && JSON.stringify(draft) !== JSON.stringify(toDraft(me));
  useUnsavedChangesGuard(dirty);

  async function reloadMe() {
    invalidateClientCache(ME_KEY);
    const data = await getCachedJson<OwnProfile>(ME_KEY);
    setMe(data);
    return data;
  }

  const fieldId = (field: OwnProfileField) => `${baseId}-${field}`;
  const set = (field: OwnProfileField, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  function startEdit() { if (!me) return; setDraft(toDraft(me)); setErrors({}); setFormError(""); setEditing(true); }
  function cancelEdit() { if (saving) return; setEditing(false); setDraft(null); setErrors({}); setFormError(""); }

  function failFields(next: Partial<Record<OwnProfileField, string>>) {
    setErrors(next);
    setShake((current) => Object.fromEntries(fieldOrder.map((field) => [field, current[field] + (next[field] ? 1 : 0)])) as Record<OwnProfileField, number>);
    const first = fieldOrder.find((field) => next[field]);
    if (first) revealValidationTarget(fieldId(first));
  }

  async function lookupCep() {
    if (!draft) return;
    setCepLoading(true);
    setFormError("");
    const result = await lookupViaCep(draft.postalCode);
    setCepLoading(false);
    if (!result.ok) { setFormError(result.message); return; }
    setDraft((current) => current ? { ...current, address: result.address, country: result.country, state: result.state, city: result.city } : current);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !me || saving) return;
    setFormError("");
    const checked = parseOwnProfile(draft);
    if (!checked.ok) { failFields(checked.fields); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/me/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const data = await response.json().catch(() => null) as (OwnProfile & { message?: string; fields?: Partial<Record<OwnProfileField, string>> }) | null;
      if (!response.ok || !data?.id) {
        if (data?.fields && Object.keys(data.fields).length) failFields(data.fields);
        else setFormError(data?.message ?? "Não foi possível salvar. Tente novamente.");
        return;
      }
      invalidateClientCache(ME_KEY, "/api/team", "/api/team/professionals", "/api/agenda/bootstrap", "/api/appointments/options", "/api/invitations");
      setMe(data);
      if (data.name !== me.name) announce({ name: data.name });
      setEditing(false);
      setDraft(null);
      toast.success("Dados atualizados.");
    } catch {
      setFormError("Não foi possível salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function afterPhotoChange() {
    try {
      const data = await reloadMe();
      announce({ avatarVersion: data.avatarVersion });
    } catch {
      setPhotoError("A foto foi salva, mas não foi possível atualizar a tela. Recarregue a página.");
    }
  }

  async function removePhoto() {
    setPhotoMenu(null);
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const response = await fetch("/api/me/avatar", { method: "DELETE" });
      if (!response.ok) { const data = await response.json().catch(() => null) as { message?: string } | null; setPhotoError(data?.message ?? "Não foi possível remover a foto."); return; }
      await afterPhotoChange();
      toast.success("Foto removida.");
    } catch {
      setPhotoError("Não foi possível remover a foto.");
    } finally {
      setPhotoBusy(false);
    }
  }

  const header = <SectionIntro title="Meu perfil" description="Seus dados pessoais, foto, senha e segurança da conta. Só você vê e altera estas informações." />;

  if (!me) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {header}
        {loadError ? (
          <Card className="border-border/70"><CardContent className="space-y-3 py-6">
            <p className="text-sm text-destructive" role="alert">{loadError}</p>
            <Button size="sm" variant="outline" onClick={() => { setLoadError(""); setReloadTick((tick) => tick + 1); }}>Tentar novamente</Button>
          </CardContent></Card>
        ) : (
          <Card className="border-border/70" aria-busy="true"><CardContent className="space-y-3 py-6"><LoadingSkeleton className="h-20 w-20 rounded-full" /><LoadingSkeleton className="h-4 w-48" /><LoadingSkeleton className="h-3 w-64" /></CardContent></Card>
        )}
      </div>
    );
  }

  const values: Draft = editing && draft ? draft : toDraft(me);
  const ro = !editing;
  const activeClinic = me.clinics.find((clinic) => clinic.id === me.activeClinicId);

  const input = (field: OwnProfileField, props: { label: string; required?: boolean; description?: string; placeholder?: string; maxLength: number; inputMode?: "numeric" | "tel"; autoComplete?: string; onChange?: (value: string) => void; onFocus?: () => void; onBlur?: () => void }) => (
    <FormField label={props.label} required={props.required} htmlFor={fieldId(field)} description={props.description}>
      <div key={`${field}-${shake[field]}`} className={errors[field] ? "hp-field-shake" : undefined}>
        <input id={fieldId(field)} className={fieldClassName} value={values[field]} readOnly={ro} maxLength={props.maxLength} inputMode={props.inputMode} autoComplete={props.autoComplete ?? "off"} placeholder={ro ? "Não informado" : props.placeholder} aria-invalid={errors[field] ? true : undefined} aria-describedby={errors[field] ? `${fieldId(field)}-error` : undefined} onChange={(event) => (props.onChange ?? ((value) => set(field, value)))(event.target.value)} onFocus={props.onFocus} onBlur={props.onBlur} />
      </div>
      {errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="text-xs font-medium text-destructive">{errors[field]}</p> : null}
    </FormField>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {header}

      <Card className="border-border/70">
        <CardContent className="flex flex-col items-center gap-4 py-6 text-center sm:flex-row sm:items-center sm:text-left">
          <div className="relative h-24 w-24 shrink-0">
            <OwnAvatar className="h-24 w-24 border-4 border-accent text-2xl" name={me.name} version={me.hasAvatar ? me.avatarVersion : null} />
            <button type="button" aria-label={me.hasAvatar ? "Alterar foto de perfil" : "Adicionar foto de perfil"} title={me.hasAvatar ? "Alterar foto" : "Adicionar foto"} disabled={photoBusy} onClick={() => setPhotoMenu(me.hasAvatar ? "menu" : "upload")} className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60">
              {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="break-words text-xl font-bold text-foreground">{me.name}</h3>
            <p className="break-all text-sm text-muted-foreground">{me.email}</p>
            <p className="text-xs text-muted-foreground">O e-mail é o seu login e não pode ser alterado aqui.</p>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <Badge variant={me.role === "STAFF" ? "green" : "purple"}>{roleLabels[me.role] ?? me.role}</Badge>
              {me.isOwner ? <Badge variant="purple">Proprietário</Badge> : null}
              {activeClinic ? <Badge variant="outline" className="max-w-full"><Building2 aria-hidden="true" className="mr-1 h-3 w-3 shrink-0" /><span className="truncate">{activeClinic.name}</span></Badge> : null}
            </div>
          </div>
        </CardContent>
      </Card>
      {photoError ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{photoError}</p> : null}
      <Modal open={photoMenu === "menu"} onClose={() => setPhotoMenu(null)} title="Foto do perfil" panelClassName="max-w-sm">
        <div className="-mx-1 divide-y divide-border/70 text-center text-sm">
          <button type="button" className="w-full px-4 py-3 font-semibold text-foreground hover:bg-muted/50" onClick={() => setPhotoMenu("upload")}>Trocar foto</button>
          <button type="button" className="flex w-full items-center justify-center gap-2 px-4 py-3 font-semibold text-destructive hover:bg-destructive/5" disabled={photoBusy} onClick={() => void removePhoto()}><Trash2 className="h-4 w-4" />Remover foto</button>
          <button type="button" className="w-full px-4 py-3 text-muted-foreground hover:bg-muted/50" onClick={() => setPhotoMenu(null)}>Cancelar</button>
        </div>
      </Modal>
      {photoMenu === "upload" ? <TeamMemberPhotoDialog avatarUrl="/api/me/avatar" title="Foto do perfil" usage="A imagem escolhida será usada como a sua foto de perfil." onSaved={() => { setPhotoError(""); void afterPhotoChange(); }} onClose={() => setPhotoMenu(null)} /> : null}

      <form onSubmit={save} noValidate>
        <Card className="border-border/70">
          <CardHeader className="border-b border-border/70">
            <div><CardTitle className="flex items-center gap-2"><UserRound className="h-4 w-4" />Dados pessoais</CardTitle></div>
            {!editing ? <Button type="button" variant="secondary" size="sm" onClick={startEdit}><Pencil className="h-4 w-4" />Editar</Button> : null}
          </CardHeader>
          <CardContent className="space-y-6 pt-4">
            <section className="space-y-3" aria-labelledby={`${baseId}-identity`}>
              <h3 id={`${baseId}-identity`} className={sectionTitle}>Identificação</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">{input("name", { label: "Nome completo", required: true, maxLength: 100, autoComplete: "name" })}</div>
                {input("phone", { label: "Telefone", maxLength: 15, inputMode: "tel", autoComplete: "tel-national", placeholder: "(00) 00000-0000", onChange: (value) => set("phone", formatPhone(value)) })}
                {input("cpf", {
                  label: "CPF", maxLength: 14, inputMode: "numeric", placeholder: "000.000.000-00",
                  description: editing && me.cpf ? "Por segurança só os 2 últimos dígitos aparecem. Para trocar, digite o CPF completo." : undefined,
                  onChange: (value) => set("cpf", formatCpf(value)),
                  // CPF mascarado não é editável "pela metade": ao focar vira campo limpo; sair sem digitar mantém o atual.
                  onFocus: () => { if (editing && draft && isMaskedCpf(draft.cpf)) set("cpf", ""); },
                  onBlur: () => { if (editing && draft && !draft.cpf && me.cpf) set("cpf", me.cpf); },
                })}
              </div>
            </section>
            <section className="space-y-3" aria-labelledby={`${baseId}-place`}>
              <h3 id={`${baseId}-place`} className={sectionTitle}>Localidade</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  {input("postalCode", { label: "CEP", maxLength: 9, inputMode: "numeric", placeholder: "00000-000", autoComplete: "postal-code", onChange: (value) => set("postalCode", formatCep(value)) })}
                  {editing ? <Button type="button" variant="secondary" size="sm" disabled={cepLoading} onClick={() => void lookupCep()}>{cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{cepLoading ? "Buscando CEP..." : "Buscar CEP"}</Button> : null}
                </div>
                <div className="sm:col-span-2">{input("address", { label: "Endereço", maxLength: 200, placeholder: "Rua, número, bairro e complemento", autoComplete: "street-address" })}</div>
                {input("country", { label: "País", maxLength: 100, placeholder: "Brasil", autoComplete: "country-name" })}
                {input("state", { label: "Estado", maxLength: 100, placeholder: "Estado", autoComplete: "address-level1" })}
                {input("city", { label: "Cidade", maxLength: 100, placeholder: "Cidade", autoComplete: "address-level2" })}
              </div>
            </section>
            {formError ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{formError}</p> : null}
            {editing ? <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="secondary" disabled={saving} onClick={cancelEdit}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar alterações"}</Button></div> : null}
          </CardContent>
        </Card>
      </form>

      <MyProfilePassword email={me.email} canChangePassword={me.canChangePassword} onChanged={() => { setSecurityTick((tick) => tick + 1); invalidateClientCache("/api/security/overview", "/api/security/events"); }} />

      <section aria-labelledby={`${baseId}-security`} className="space-y-3">
        <h3 id={`${baseId}-security`} className="text-sm font-bold text-foreground">Segurança da conta</h3>
        <SecuritySettings key={securityTick} />
      </section>

      <Card className="border-border/70">
        <CardHeader className="border-b border-border/70"><div><CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" />Minhas clínicas</CardTitle><p className="mt-1 text-sm text-muted-foreground">Para trocar de clínica, use o seletor no topo da tela.</p></div></CardHeader>
        <CardContent className="pt-4">
          {me.clinics.length ? (
            <ul className="divide-y divide-border/70">
              {me.clinics.map((clinic) => (
                <li key={clinic.id} className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 break-words text-sm font-semibold text-foreground">{clinic.name}</span>
                  {clinic.id === me.activeClinicId ? <Badge variant="green">Ativa</Badge> : null}
                  {clinic.isOwner ? <Badge variant="purple">Proprietário</Badge> : null}
                  <Badge variant="slate">{roleLabels[clinic.role] ?? clinic.role}</Badge>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Nenhuma clínica vinculada.</p>}
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="border-b border-border/70"><div><CardTitle className="flex items-center gap-2">{dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}Aparência</CardTitle><p className="mt-1 text-sm text-muted-foreground">O tema fica salvo só neste navegador.</p></div></CardHeader>
        <CardContent className="pt-4">
          <Button type="button" variant="secondary" aria-pressed={dark} onClick={toggleThemeWithReveal}>{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{dark ? "Usar tema claro" : "Usar tema escuro"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
