"use client";

import { ArrowDown, ArrowUp, ImagePlus, Replace, X } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { EvaluationPhoto } from "./types";

export function PhotoGallery({
  photos,
  activePhotoId,
  onUpload,
  onSelect,
  onRemove,
  onCategoryChange,
  onMove,
  onReplace,
}: {
  photos: EvaluationPhoto[];
  activePhotoId: string | null;
  onUpload: (files: FileList | null) => void;
  onSelect: (photoId: string) => void;
  onRemove: (photoId: string) => void;
  onCategoryChange: (photoId: string, category: EvaluationPhoto["category"]) => void;
  onMove: (photoId: string, direction: -1 | 1) => void;
  onReplace: (photoId: string, file: File | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {photos.map((photo) => (
        <div
          className={cn(
            "group relative w-32 overflow-hidden rounded-[8px] border bg-[#f7f8fc]",
            activePhotoId === photo.id ? "border-[#5147dc] ring-2 ring-[#5147dc]/25" : "border-[#e0e2ed]",
          )}
          key={photo.id}
        >
          <button className="relative block aspect-square w-full" type="button" onClick={() => onSelect(photo.id)} aria-label={`Abrir foto ${photo.name}`}>
            <Image className="object-cover" src={photo.imageUrl} alt={photo.name} fill sizes="128px" unoptimized />
          </button>
          <div className="grid gap-1.5 p-1.5">
            <select aria-label={`Categoria de ${photo.name}`} className="h-7 w-full rounded border border-[#dfe2ee] bg-white px-1 text-[9px]" value={photo.category} onChange={(event) => onCategoryChange(photo.id, event.target.value as EvaluationPhoto["category"])}>
              {["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"].map((category) => <option key={category}>{category}</option>)}
            </select>
            <span className="truncate text-[9px] text-[#606176]" title={photo.name}>{photo.name}</span>
          </div>
          <div className="absolute right-1 top-1 flex gap-1">
            <button aria-label={`Mover ${photo.name} para cima`} className="grid h-6 w-6 place-items-center rounded-full bg-white/95 text-[#555668] shadow-sm" type="button" onClick={() => onMove(photo.id, -1)}><ArrowUp className="h-3 w-3" /></button>
            <button aria-label={`Mover ${photo.name} para baixo`} className="grid h-6 w-6 place-items-center rounded-full bg-white/95 text-[#555668] shadow-sm" type="button" onClick={() => onMove(photo.id, 1)}><ArrowDown className="h-3 w-3" /></button>
          </div>
          <label aria-label={`Substituir ${photo.name}`} className="absolute left-1 top-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full bg-white/95 text-[#555668] shadow-sm" title="Substituir foto">
            <Replace className="h-3 w-3" />
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { onReplace(photo.id, event.target.files?.[0]); event.target.value = ""; }} />
          </label>
          <button
            aria-label={`Remover ${photo.name}`}
            className="absolute bottom-10 right-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-[#555668] opacity-0 shadow-sm transition group-hover:opacity-100 focus:opacity-100"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRemove(photo.id);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <label className="grid h-[182px] w-32 cursor-pointer place-items-center rounded-[8px] border border-dashed border-[#cfd3e4] bg-[#fbfbfe] text-[#5147dc] transition hover:border-[#5147dc] hover:bg-[#f7f6ff]">
        <span className="grid gap-1 text-center text-[10px] font-bold text-[#5147dc]">
          <ImagePlus className="mx-auto h-5 w-5" />
          Foto
        </span>
        <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => onUpload(event.target.files)} />
      </label>
    </div>
  );
}
