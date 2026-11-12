"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export const ownInitials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR") || "?";

// Foto do PRÓPRIO usuário (/api/me/avatar) com iniciais de fallback. `version` (updatedAt da foto) troca a URL e vence o cache do navegador.
export function OwnAvatar({ name, version, className }: { name: string; version?: string | null; className?: string }) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  return <span aria-hidden="true" className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent font-black text-accent-foreground", className)}>
    {ownInitials(name)}
    {version && failedFor !== version ? (
      // eslint-disable-next-line @next/next/no-img-element -- endpoint privado que já devolve miniatura.
      <img alt="" className="absolute inset-0 h-full w-full rounded-full object-cover" src={`/api/me/avatar?v=${encodeURIComponent(version)}`} onError={() => setFailedFor(version)} />
    ) : null}
  </span>;
}
