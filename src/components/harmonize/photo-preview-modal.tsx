"use client";

/* eslint-disable @next/next/no-img-element -- Clinical image URLs can be private data URLs. */

import { X } from "lucide-react";
import { Modal } from "@/components/ui/modal";

export function PhotoPreviewModal({ photo, onClose }: { photo: { name: string; imageUrl: string } | null; onClose: () => void }) {
  return (
    <Modal
      open={Boolean(photo)}
      title={photo?.name ?? "Visualização da fotografia"}
      description="Fotografia clínica ampliada."
      onClose={onClose}
      hideHeader
      overlayClassName="modal-overlay-photo"
      panelClassName="max-w-[92vw] border-0 bg-transparent shadow-none"
      bodyClassName="p-0"
    >
      {photo ? (
        <div className="relative grid max-h-[calc(100dvh-2rem)] min-h-[50vh] place-items-center overflow-hidden" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <img src={photo.imageUrl} alt={photo.name} className="max-h-[calc(100dvh-2rem)] max-w-[92vw] object-contain" />
          <button type="button" aria-label="Fechar visualização" onClick={onClose} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/95 text-[#27283b] shadow-lg transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
