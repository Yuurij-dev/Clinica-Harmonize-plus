"use client";

import { useEffect, useState } from "react";
import { getCachedJson, readClientCache } from "@/lib/client-cache";
import { cleanSearchQuery, patientLookupKey, patientLookupMinLength } from "@/lib/patient-list-rules";

export type LookupPatient = { id: string; name: string; cpf: string | null };
type LookupResponse = { patients?: LookupPatient[] };

export const patientLookupDebounceMs = 300;

// Pesquisa de paciente sob demanda para os seletores (nome ou CPF): espera o usuário parar de digitar e pede ao servidor
// poucos resultados, em vez de baixar todos os pacientes da clínica. Resultado em cache (mesma busca) aparece na hora.
export function usePatientLookup(query: string, enabled = true) {
  const term = cleanSearchQuery(query);
  const key = enabled && term.length >= patientLookupMinLength ? patientLookupKey(term) : "";
  const tooShort = enabled && term.length > 0 && term.length < patientLookupMinLength;
  const cached = key ? readClientCache<LookupResponse>(key) : undefined;
  const [state, setState] = useState<{ key: string; patients: LookupPatient[]; error: boolean }>({ key: "", patients: [], error: false });

  useEffect(() => {
    if (!key || cached) return;
    let active = true;
    const timer = window.setTimeout(() => {
      getCachedJson<LookupResponse>(key)
        .then((data) => { if (active) setState({ key, patients: data.patients ?? [], error: false }); })
        .catch(() => { if (active) setState({ key, patients: [], error: true }); });
    }, patientLookupDebounceMs);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, cached]);

  if (!key) return { patients: [] as LookupPatient[], loading: false, error: false, tooShort };
  if (cached) return { patients: cached.patients ?? [], loading: false, error: false, tooShort };
  const ready = state.key === key;
  return { patients: ready ? state.patients : [], loading: !ready, error: ready && state.error, tooShort };
}
