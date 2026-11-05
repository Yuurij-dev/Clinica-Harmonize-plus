"use client";

import { useEffect, useState } from "react";
import { CLIENT_CACHE_INVALIDATED_EVENT, CLIENT_CACHE_SCOPE_CHANGED_EVENT, CLIENT_CACHE_UNAUTHORIZED_EVENT } from "@/lib/client-cache";
import { cn } from "@/lib/utils";
import { useCan } from "./current-user";

export function PatientAvatar({ patientId, name, size = "sm", className }: { patientId?: string; name: string; size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const canSeeClinicalPhotos = useCan("clinical:read");
  useEffect(() => {
    if (!patientId || !canSeeClinicalPhotos) return;
    const refresh = (event?: Event) => {
      if (event instanceof CustomEvent) {
        const detail = event.detail;
        if (Array.isArray(detail) && !detail.some((key) => typeof key === "string" && key.startsWith(`/api/patients/${encodeURIComponent(patientId)}/`))) return;
      }
      setFailed(false);
      setRevision((value) => value + 1);
    };
    const changed = (event: Event) => refresh(event);
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, changed);
    window.addEventListener(CLIENT_CACHE_SCOPE_CHANGED_EVENT, refresh);
    window.addEventListener(CLIENT_CACHE_UNAUTHORIZED_EVENT, refresh);
    return () => {
      window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, changed);
      window.removeEventListener(CLIENT_CACHE_SCOPE_CHANGED_EVENT, refresh);
      window.removeEventListener(CLIENT_CACHE_UNAUTHORIZED_EVENT, refresh);
    };
  }, [patientId, canSeeClinicalPhotos]);

  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR") || "?";
  const sizeClass = { xs: "h-7 w-7 text-[9px]", sm: "h-9 w-9 text-[11px]", md: "h-12 w-12 text-sm", lg: "h-14 w-14 text-base" }[size];
  return <span aria-hidden="true" className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#efedff] font-black text-[#5147dc]", sizeClass, className)}>
    {initials}
    {patientId && canSeeClinicalPhotos && !failed ? <>
      {/* eslint-disable-next-line @next/next/no-img-element -- Private image endpoint is already a resized thumbnail. */}
      <img alt="" className="absolute inset-0 h-full w-full rounded-full object-cover" loading="lazy" decoding="async" src={`/api/patients/${encodeURIComponent(patientId)}/profile-photo?v=${revision}`} onError={() => setFailed(true)} />
    </> : null}
  </span>;
}
