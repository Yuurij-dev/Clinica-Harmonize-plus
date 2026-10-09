"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCachedJson, readClientCache } from "@/lib/client-cache";
import { ListAccordion } from "./list-accordion";
import { PhotoEditor, type SavedEvaluation } from "./photo-editor/photo-editor";
import { LoadingSkeleton } from "./shared";

const NEW_EVALUATION_ID = "__new__";

export function PatientEvaluations({ patientId, patientName, journeyId, onEvaluationSaved }: { patientId: string; patientName: string; journeyId?: string; onEvaluationSaved?: () => void }) {
  const listCacheKey = `/api/patients/${patientId}/evaluation?list=1${journeyId ? `&journeyId=${encodeURIComponent(journeyId)}` : ""}`;
  const cached = readClientCache<{ evaluations?: SavedEvaluation[] }>(listCacheKey);
  const [evaluations, setEvaluations] = useState<SavedEvaluation[]>(cached?.evaluations ?? []);
  const [loading, setLoading] = useState(!cached);
  const [loadError, setLoadError] = useState(false);
  const [openEvaluationId, setOpenEvaluationId] = useState<string | null>(null);
  const [creatingEvaluation, setCreatingEvaluation] = useState(false);

  useEffect(() => {
    getCachedJson<{ evaluations?: SavedEvaluation[] }>(listCacheKey)
      .then((data) => setEvaluations(data.evaluations ?? []))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [listCacheKey]);

  function startNewEvaluation() {
    setCreatingEvaluation(true);
    setOpenEvaluationId(NEW_EVALUATION_ID);
  }

  function handleSaved(evaluation: SavedEvaluation) {
    setEvaluations((current) => current.some((item) => item.id === evaluation.id) ? current.map((item) => item.id === evaluation.id ? evaluation : item) : [evaluation, ...current]);
    onEvaluationSaved?.();
    // Depois de salva, a avaliação nova passa a ser um item aberto da lista.
    if (openEvaluationId === NEW_EVALUATION_ID) {
      setCreatingEvaluation(false);
      setOpenEvaluationId(evaluation.id);
    }
  }

  const newEvaluationOpen = creatingEvaluation && openEvaluationId === NEW_EVALUATION_ID;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-bold text-[#27283b]">Avaliações</h3><p className="mt-0.5 text-[10px] text-[#858696]">Clique em uma avaliação para abrir as fotos e marcações.</p></div>
        <Button type="button" disabled={newEvaluationOpen} onClick={startNewEvaluation}><Plus className="h-4 w-4" />Adicionar avaliação</Button>
      </div>
      {newEvaluationOpen ? (
        <ListAccordion title="Nova avaliação" subtitle={new Date().toLocaleDateString("pt-BR")} open onToggle={() => { setCreatingEvaluation(false); setOpenEvaluationId(null); }}>
          <PhotoEditor patientId={patientId} journeyId={journeyId} patientName={patientName} onSaved={handleSaved} />
        </ListAccordion>
      ) : null}
      {loading ? (
        <Card className="space-y-3 p-4"><LoadingSkeleton className="h-6 w-1/2" /><LoadingSkeleton className="h-6 w-1/3" /></Card>
      ) : loadError ? (
        <Card className="p-6 text-center text-xs text-[#b42318]">Não foi possível carregar as avaliações.</Card>
      ) : evaluations.length === 0 && !newEvaluationOpen ? (
        <Card className="p-6 text-center text-xs text-[#77788a]">Nenhuma avaliação cadastrada. Clique em “Adicionar avaliação” para criar a primeira.</Card>
      ) : (
        evaluations.map((evaluation) => (
          <ListAccordion
            key={evaluation.id}
            title={new Date(evaluation.createdAt).toLocaleDateString("pt-BR")}
            subtitle={evaluation.professional || "Profissional não informado"}
            meta={<span className="rounded-full bg-[#f2f3f7] px-2 py-1 text-[10px] font-bold text-[#747587]">{evaluation.photoCount} foto{evaluation.photoCount === 1 ? "" : "s"}</span>}
            open={openEvaluationId === evaluation.id}
            onToggle={() => { setCreatingEvaluation(false); setOpenEvaluationId((current) => current === evaluation.id ? null : evaluation.id); }}
          >
            <PhotoEditor patientId={patientId} journeyId={journeyId} evaluationId={evaluation.id} patientName={patientName} onSaved={handleSaved} />
          </ListAccordion>
        ))
      )}
    </div>
  );
}
