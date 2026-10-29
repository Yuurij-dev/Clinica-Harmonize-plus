"use client";

import { Images } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatDate, useCachedResource } from "./patient-clinical-data";
import { LoadingSkeleton } from "./shared";

type EvaluationSummary = {
  evaluation: null | {
    id: string; professional: string; status: string; createdAt: string; chiefComplaint: string; patientGoal: string; medicalHistory: string; allergies: string; pregnancyStatus: string;
    anticoagulantUse: string; autoimmuneDiseases: string; contraindications: string; previousProcedures: string; clinicalNotes: string; facialNotes?: string;
  };
};

const fields: Array<[keyof NonNullable<EvaluationSummary["evaluation"]>, string]> = [
  ["chiefComplaint", "Queixa principal"], ["patientGoal", "Objetivo do paciente"], ["medicalHistory", "Histórico médico"], ["allergies", "Alergias"], ["pregnancyStatus", "Gestação / amamentação"],
  ["anticoagulantUse", "Uso de anticoagulantes"], ["autoimmuneDiseases", "Doenças autoimunes"], ["contraindications", "Contraindicações"], ["previousProcedures", "Procedimentos anteriores"], ["clinicalNotes", "Observações clínicas"],
  ["facialNotes", "Observações da avaliação facial"],
];

// Resumo somente leitura de uma avaliação concluída (destino de "Abrir atendimento" em Atendimentos); as fotos ficam na sub-aba Fotos.
export function EvaluationSummaryDialog({ patientId, evaluationId, onClose, onViewPhotos }: { patientId: string; evaluationId: string | null; onClose: () => void; onViewPhotos: (evaluationId: string) => void }) {
  const key = evaluationId ? `/api/patients/${encodeURIComponent(patientId)}/evaluation?summary=1&evaluationId=${encodeURIComponent(evaluationId)}` : "";
  const { data, loading, error } = useCachedResource<EvaluationSummary>(key);
  const evaluation = data?.evaluation;
  return <Modal open={Boolean(evaluationId)} onClose={onClose} title="Resumo da avaliação" description={evaluation ? `${formatDate(evaluation.createdAt)} · ${evaluation.professional || "Profissional não informado"}` : undefined}>
    <div className="space-y-3 text-xs">
      {loading ? <LoadingSkeleton className="h-32 w-full" /> : error || !evaluation ? <p className="rounded-md bg-muted/50 p-3 text-muted-foreground">Não foi possível carregar a avaliação.</p> : <>
        <Badge variant={evaluation.status === "Concluída" ? "green" : "amber"}>{evaluation.status}</Badge>
        <dl className="space-y-2">{fields.filter(([field]) => String(evaluation[field] ?? "").trim()).map(([field, label]) => <div key={field}><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap">{String(evaluation[field])}</dd></div>)}</dl>
        {!fields.some(([field]) => String(evaluation[field] ?? "").trim()) ? <p className="text-muted-foreground">Nenhum campo preenchido nesta avaliação.</p> : null}
      </>}
      <div className="flex flex-wrap justify-end gap-2 pt-1"><Button variant="outline" onClick={onClose}>Fechar</Button>{evaluationId ? <Button onClick={() => onViewPhotos(evaluationId)}><Images className="h-4 w-4" />Ver fotos</Button> : null}</div>
    </div>
  </Modal>;
}
