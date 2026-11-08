"use client";

import { useState } from "react";
import { Building2, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type UserClinic = { id: string; name: string; role: string; isOwner: boolean };

export const roleLabels: Record<string, string> = { ADMIN: "Administradora", PROFESSIONAL: "Profissional", STAFF: "Atendente" };

type ClinicChooserProps = {
  clinics: UserClinic[];
  activeClinicId: string;
  onChoose: (clinicId: string) => Promise<string | null>;
  onLogout: () => void;
};

// Etapa "Escolha a clínica" exibida antes de abrir o app para quem pertence a 2+ clínicas.
export function ClinicChooser({ clinics, activeClinicId, onChoose, onLogout }: ClinicChooserProps) {
  const [selected, setSelected] = useState(activeClinicId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSubmitting(true);
    setError("");
    const failure = await onChoose(selected);
    if (failure) {
      setError(failure);
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <div className="w-full max-w-[400px] rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl">
        <h1 className="text-xl font-black tracking-tight">Escolha a clínica</h1>
        <p className="mt-1 text-sm text-muted-foreground">Você participa de mais de uma clínica. Qual deseja abrir agora?</p>
        <div className="mt-4 space-y-2" role="radiogroup" aria-label="Clínicas">
          {clinics.map((clinic) => (
            <button
              aria-checked={selected === clinic.id}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition ${selected === clinic.id ? "border-ring bg-accent" : "border-border bg-background hover:bg-muted"}`}
              disabled={submitting}
              key={clinic.id}
              onClick={() => setSelected(clinic.id)}
              role="radio"
              type="button"
            >
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{clinic.name}</span>
                <span className="block text-xs text-muted-foreground">{roleLabels[clinic.role] ?? clinic.role}</span>
              </span>
              {selected === clinic.id ? <Check className="h-4 w-4 shrink-0" /> : null}
            </button>
          ))}
        </div>
        {error ? <p className="mt-3 text-xs font-semibold text-destructive" role="alert">{error}</p> : null}
        <div className="mt-5 flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={submitting} onClick={onLogout}>Sair</Button>
          <Button type="button" variant="primary" size="sm" className="ml-auto" disabled={submitting} onClick={() => void submit()}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Entrar
          </Button>
        </div>
      </div>
    </div>
  );
}
