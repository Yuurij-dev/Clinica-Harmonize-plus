"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, Pencil, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField, fieldClassName } from "@/components/ui/modal";
import { LoadingSkeleton } from "./shared";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { formatCpf } from "@/lib/input-masks";

export type TeamMemberDetailData = {
  id: string;
  role: string;
  isOwner: boolean;
  laborCostCents: number | null;
  user: { id: string; name: string; email: string; createdAt: string; cpf: string | null; postalCode: string | null; address: string | null; city: string | null; state: string | null; country: string | null };
};

type Response = { member?: TeamMemberDetailData };

const roleName = (role: string) => (role === "PROFESSIONAL" ? "Profissional" : role === "STAFF" ? "Equipe" : "Administrador");
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
const maskCep = (v: string) => v.replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
const maskCpf = (v: string) => v.replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");

type Draft = { name: string; cpf: string; postalCode: string; address: string; country: string; state: string; city: string };
const toDraft = (u: TeamMemberDetailData["user"]): Draft => ({ name: u.name, cpf: u.cpf ? formatCpf(u.cpf) : "", postalCode: maskCep(u.postalCode ?? ""), address: u.address ?? "", country: u.country ?? "", state: u.state ?? "", city: u.city ?? "" });

const sectionTitle = "border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export function TeamMemberDetail({ memberId, onBack }: { memberId: string; onBack: () => void }) {
  const key = `/api/team/${encodeURIComponent(memberId)}`;
  const [member, setMember] = useState<TeamMemberDetailData | undefined>(() => readClientCache<Response>(key)?.member);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [cepLoading, setCepLoading] = useState(false);

  useEffect(() => {
    let active = true;
    getCachedJson<Response>(key)
      .then((data) => { if (active) { setMember(data.member); setError(data.member ? "" : "Colaborador não encontrado."); } })
      .catch(() => { if (active) setError("Não foi possível carregar os dados do colaborador."); });
    return () => { active = false; };
  }, [key]);

  const user = member?.user;
  const values: Draft | null = editing && draft ? draft : user ? toDraft(user) : null;
  const set = (field: keyof Draft, value: string) => setDraft((current) => (current ? { ...current, [field]: value } : current));

  function startEdit() { if (!user) return; setDraft(toDraft(user)); setFormError(""); setEditing(true); }
  function cancelEdit() { if (saving) return; setEditing(false); setDraft(null); setFormError(""); }

  async function lookupCep() {
    if (!draft) return;
    const digits = draft.postalCode.replace(/\D/g, "");
    if (digits.length !== 8) { setFormError("Informe um CEP com 8 dígitos."); return; }
    setCepLoading(true);
    setFormError("");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await response.json() as { erro?: boolean; logradouro?: string; complemento?: string; bairro?: string; localidade?: string; uf?: string; estado?: string };
      if (!response.ok || data.erro) { setFormError("CEP não encontrado. Confira o número e tente novamente."); return; }
      setDraft((current) => current ? { ...current, address: [data.logradouro, data.complemento, data.bairro].filter(Boolean).join(", "), country: "Brasil", state: data.estado || data.uf || "", city: data.localidade || "" } : current);
    } catch {
      setFormError("Não foi possível consultar o CEP. Tente novamente.");
    } finally {
      setCepLoading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch(key, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const data = await response.json().catch(() => null) as { member?: TeamMemberDetailData; message?: string } | null;
      if (!response.ok || !data?.member) { setFormError(data?.message ?? "Não foi possível salvar. Tente novamente."); return; }
      setMember(data.member);
      invalidateClientCache(key, "/api/team", "/api/team/professionals", "/api/agenda/bootstrap", "/api/appointments/options", "/api/invitations");
      setEditing(false);
      setDraft(null);
    } catch {
      setFormError("Não foi possível salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  const ro = !editing;
  return (
    <div className="space-y-4">
      <Button type="button" variant="secondary" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />Voltar para a equipe</Button>
      {error && !member ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
      {!member && !error ? (
        <Card className="border-border/70"><CardContent className="space-y-3 py-6"><LoadingSkeleton className="h-14 w-14 rounded-full" /><LoadingSkeleton className="h-4 w-48" /><LoadingSkeleton className="h-3 w-64" /></CardContent></Card>
      ) : null}
      {member && user && values ? (
        <>
          <Card className="border-border/70">
            <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center">
              <div aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-bold text-accent-foreground">{initials(user.name)}</div>
              <div className="min-w-0 flex-1 space-y-2">
                <h2 className="break-words text-xl font-bold text-foreground">{user.name}</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={member.role === "STAFF" ? "green" : "purple"}>{roleName(member.role)}</Badge>
                  {member.isOwner ? <Badge variant="purple">Proprietário</Badge> : null}
                </div>
              </div>
              {!editing ? <Button type="button" variant="secondary" size="sm" onClick={startEdit}><Pencil className="h-4 w-4" />Editar</Button> : null}
            </CardContent>
          </Card>
          <form onSubmit={save} noValidate>
            <Card className="border-border/70">
              <CardContent className="space-y-6 py-6">
                <section className="space-y-3">
                  <h3 className={sectionTitle}>Dados pessoais</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Nome completo" required><input className={fieldClassName} value={values.name} readOnly={ro} maxLength={100} autoComplete="off" onChange={(e) => set("name", e.target.value)} /></FormField>
                    <FormField label="CPF" required><input className={fieldClassName} value={values.cpf} readOnly={ro} inputMode="numeric" placeholder="000.000.000-00" maxLength={14} onChange={(e) => set("cpf", maskCpf(e.target.value))} /></FormField>
                  </div>
                </section>
                <section className="space-y-3">
                  <h3 className={sectionTitle}>Acesso à conta</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="E-mail de acesso" description="O e-mail é o login e não pode ser alterado aqui."><input className={fieldClassName} value={user.email} readOnly /></FormField>
                    <FormField label="Membro desde"><input className={fieldClassName} value={user.createdAt ? new Date(user.createdAt).toLocaleDateString("pt-BR") : "—"} readOnly /></FormField>
                    {member.role === "PROFESSIONAL" ? <FormField label="Custo de mão de obra" description="Editado em Custos e orçamento."><input className={fieldClassName} readOnly value={member.laborCostCents === null ? "—" : (member.laborCostCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} /></FormField> : null}
                  </div>
                </section>
                <section className="space-y-3">
                  <h3 className={sectionTitle}>Localidade</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <FormField label="CEP"><input className={fieldClassName} value={values.postalCode} readOnly={ro} inputMode="numeric" placeholder="00000-000" maxLength={9} onChange={(e) => set("postalCode", maskCep(e.target.value))} /></FormField>
                      {editing ? <Button type="button" variant="secondary" size="sm" disabled={cepLoading} onClick={() => void lookupCep()}>{cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{cepLoading ? "Buscando CEP..." : "Buscar CEP"}</Button> : null}
                    </div>
                    <div className="sm:col-span-2"><FormField label="Endereço"><input className={fieldClassName} value={values.address} readOnly={ro} maxLength={200} placeholder="Rua, número, bairro e complemento" onChange={(e) => set("address", e.target.value)} /></FormField></div>
                    <FormField label="País"><input className={fieldClassName} value={values.country} readOnly={ro} maxLength={100} placeholder="Brasil" onChange={(e) => set("country", e.target.value)} /></FormField>
                    <FormField label="Estado"><input className={fieldClassName} value={values.state} readOnly={ro} maxLength={100} placeholder="Estado" onChange={(e) => set("state", e.target.value)} /></FormField>
                    <FormField label="Cidade"><input className={fieldClassName} value={values.city} readOnly={ro} maxLength={100} placeholder="Cidade" onChange={(e) => set("city", e.target.value)} /></FormField>
                  </div>
                </section>
                {formError ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{formError}</p> : null}
                {editing ? <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="secondary" disabled={saving} onClick={cancelEdit}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar alterações"}</Button></div> : null}
              </CardContent>
            </Card>
          </form>
        </>
      ) : null}
    </div>
  );
}
