"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSkeleton } from "./shared";
import { getCachedJson, readClientCache } from "@/lib/client-cache";
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
const orDash = (value?: string | null) => (value && value.trim() ? value : "—");
const formatCep = (value?: string | null) => {
  if (!value || !value.trim()) return "—";
  const digits = value.replace(/\D/g, "");
  return digits.length === 8 ? digits.replace(/(\d{5})(\d{3})/, "$1-$2") : value;
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function TeamMemberDetail({ memberId, onBack }: { memberId: string; onBack: () => void }) {
  const key = `/api/team/${encodeURIComponent(memberId)}`;
  const [member, setMember] = useState<TeamMemberDetailData | undefined>(() => readClientCache<Response>(key)?.member);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getCachedJson<Response>(key)
      .then((data) => { if (active) { setMember(data.member); setError(data.member ? "" : "Colaborador não encontrado."); } })
      .catch(() => { if (active) setError("Não foi possível carregar os dados do colaborador."); });
    return () => { active = false; };
  }, [key]);

  const user = member?.user;
  const address = user ? [user.address, user.city && user.state ? `${user.city} - ${user.state}` : user.city || user.state, user.country].filter((part) => part && part.trim()).join(", ") : "";

  return (
    <div className="space-y-4">
      <Button type="button" variant="secondary" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />Voltar para a equipe</Button>
      {error && !member ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
      {!member && !error ? (
        <Card className="border-border/70"><CardContent className="space-y-3 py-6"><LoadingSkeleton className="h-14 w-14 rounded-full" /><LoadingSkeleton className="h-4 w-48" /><LoadingSkeleton className="h-3 w-64" /></CardContent></Card>
      ) : null}
      {member && user ? (
        <>
          <Card className="border-border/70">
            <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center">
              <div aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-bold text-accent-foreground">{initials(user.name)}</div>
              <div className="min-w-0 space-y-2">
                <h2 className="break-words text-xl font-bold text-foreground">{user.name}</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={member.role === "STAFF" ? "green" : "purple"}>{roleName(member.role)}</Badge>
                  {member.isOwner ? <Badge variant="purple">Proprietário</Badge> : null}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/70">
            <CardContent className="grid gap-5 py-6 sm:grid-cols-2">
              <Field label="E-mail" value={orDash(user.email)} />
              <Field label="CPF" value={user.cpf ? formatCpf(user.cpf) : "—"} />
              <Field label="CEP" value={formatCep(user.postalCode)} />
              <Field label="Endereço" value={orDash(address)} />
              <Field label="Membro desde" value={user.createdAt ? new Date(user.createdAt).toLocaleDateString("pt-BR") : "—"} />
              {member.role === "PROFESSIONAL" ? <Field label="Custo de mão de obra" value={member.laborCostCents === null ? "—" : (member.laborCostCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} /> : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
