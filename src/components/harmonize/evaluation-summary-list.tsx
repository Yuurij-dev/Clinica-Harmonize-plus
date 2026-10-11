"use client";

import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getCachedJson, readClientCache } from "@/lib/client-cache";

type EvaluationRow = { id: string; professional: string; createdAt: string };
type Response = { evaluations?: EvaluationRow[] };

// Visão do atendente: só registra que houve avaliação, quando e com quem. Nada abre.
export function EvaluationSummaryList({ patientId }: { patientId: string }) {
  const url = `/api/patients/${patientId}/evaluation?list=1`;
  const [rows, setRows] = useState<EvaluationRow[] | null>(() => readClientCache<Response>(url)?.evaluations ?? null);

  useEffect(() => {
    if (!patientId) return;
    let active = true;
    getCachedJson<Response>(url).then((data) => { if (active) setRows(data.evaluations ?? []); }).catch(() => { if (active) setRows((current) => current ?? []); });
    return () => { active = false; };
  }, [patientId, url]);

  if (rows === null) return <Card className="p-5 text-xs text-[#858696]">Carregando...</Card>;
  if (!rows.length) return <Card className="p-5 text-xs text-[#858696]">Este cliente ainda não possui avaliações.</Card>;
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <Card className="flex items-center gap-3 p-4" key={row.id}>
          <ClipboardList className="h-4 w-4 text-[#5147dc]" />
          <div>
            <p className="text-sm font-bold text-[#303144]">Avaliação realizada</p>
            <p className="mt-1 text-xs text-[#858696]">{new Date(row.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}{row.professional ? ` · ${row.professional}` : ""}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}
