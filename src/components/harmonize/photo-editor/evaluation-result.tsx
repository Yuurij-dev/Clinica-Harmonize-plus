"use client";

import { BarChart3, CheckCircle2, PencilLine } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { EvaluationPhoto } from "./types";

type SavedPreview = { photo: EvaluationPhoto; dataUrl: string };

export function EvaluationResult({ previews, onEdit }: { previews: SavedPreview[]; onEdit: () => void }) {
  return (
    <div className="lg:col-span-2">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-[#5147dc]" />
        <h3 className="text-sm font-black text-[#25263a]">Resultado da Avaliação</h3>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {previews.map(({ photo, dataUrl }) => (
          <figure className="overflow-hidden rounded-[8px] border border-[#e3e5f0] bg-[#f8f9fc]" key={photo.id}>
            <div className="flex min-h-[260px] items-center justify-center bg-[#f1f2f7] p-3">
              <Image className="max-h-[520px] w-full object-contain" src={dataUrl} alt={`Resultado da avaliação: ${photo.name}`} width={photo.width} height={photo.height} unoptimized />
            </div>
          </figure>
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-[8px] border border-[#b9e8d8] bg-[#effbf6] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#16805d]" />
          <div>
            <h4 className="text-sm font-black text-[#176b51]">Avaliação salva com sucesso</h4>
            <p className="mt-1 text-xs text-[#4e806f]">As imagens acima já incluem as marcações realizadas.</p>
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={onEdit}>
          <PencilLine className="h-3.5 w-3.5" />
          Editar avaliação
        </Button>
      </div>
    </div>
  );
}
