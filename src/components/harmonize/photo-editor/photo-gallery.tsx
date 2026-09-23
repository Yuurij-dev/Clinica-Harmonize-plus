"use client";

import { ImagePlus, X } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { EvaluationPhoto } from "./types";

export function PhotoGallery({
  photos,
  activePhotoId,
  onUpload,
  onSelect,
  onRemove,
}: {
  photos: EvaluationPhoto[];
  activePhotoId: string | null;
  onUpload: (files: FileList | null) => void;
  onSelect: (photoId: string) => void;
  onRemove: (photoId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {photos.map((photo) => (
        <div
          className={cn(
            "group relative h-24 w-24 overflow-hidden rounded-[8px] border bg-[#f7f8fc]",
            activePhotoId === photo.id ? "border-[#5147dc] ring-2 ring-[#5147dc]/25" : "border-[#e0e2ed]",
          )}
          key={photo.id}
        >
          <button className="absolute inset-0 h-full w-full" type="button" onClick={() => onSelect(photo.id)}>
            <Image className="object-cover" src={photo.imageUrl} alt={photo.name} fill sizes="96px" unoptimized />
          </button>
          <span className="absolute bottom-0 left-0 right-0 truncate bg-[#25263a]/78 px-2 py-1 text-left text-[9px] font-semibold text-white">
            {photo.name}
          </span>
          <button
            aria-label={`Remover ${photo.name}`}
            className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-[#555668] opacity-0 shadow-sm transition group-hover:opacity-100"
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

      <label className="grid h-24 w-24 cursor-pointer place-items-center rounded-[8px] border border-dashed border-[#cfd3e4] bg-[#fbfbfe] text-[#5147dc] transition hover:border-[#5147dc] hover:bg-[#f7f6ff]">
        <span className="grid gap-1 text-center text-[10px] font-bold text-[#5147dc]">
          <ImagePlus className="mx-auto h-5 w-5" />
          Foto
        </span>
        <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => onUpload(event.target.files)} />
      </label>
    </div>
  );
}
