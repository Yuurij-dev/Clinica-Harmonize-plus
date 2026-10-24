"use client";

import { Loader2 } from "lucide-react";
import { useMinimumVisible } from "./use-photo-sync-poll";

// Aviso de que uma foto enviada pelo app está sendo buscada (fica visível ao menos ~600 ms). A região fica sempre montada (leitores de tela só
// anunciam mudanças em região existente); o ícone só gira sem prefers-reduced-motion, o texto aparece sempre.
export function IncomingPhotoStatus({ active }: { active: boolean }) {
  const visible = useMinimumVisible(active);
  return <div role="status" aria-live="polite">
    {visible ? <p className="mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Recebendo foto do aplicativo...</p> : null}
  </div>;
}
