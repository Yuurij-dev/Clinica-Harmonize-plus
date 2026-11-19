"use client";

import { useEffect, useState } from "react";
import { CLIENT_CACHE_INVALIDATED_EVENT, CLIENT_CACHE_SCOPE_CHANGED_EVENT, CLIENT_CACHE_UNAUTHORIZED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { cn } from "@/lib/utils";

type AvatarStatus = { sexDefined: boolean };

export function PatientAvatar({ patientId, name, size = "sm", className }: { patientId?: string; name: string; size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<{ patientId: string; sexDefined: boolean } | null>(null);
  const statusKey = patientId ? `/api/patients/${encodeURIComponent(patientId)}/avatar-status` : "";
  useEffect(() => {
    if (!patientId) return;
    let active = true;
    const loadStatus = () => {
      const cached = readClientCache<AvatarStatus>(statusKey);
      if (cached) setStatus({ patientId, sexDefined: cached.sexDefined });
      void getCachedJson<AvatarStatus>(statusKey).then((result) => {
        if (active) setStatus({ patientId, sexDefined: result.sexDefined });
      }).catch(() => {});
    };
    loadStatus();
    const refresh = (event?: Event) => {
      if (event instanceof CustomEvent) {
        const detail = event.detail;
        if (Array.isArray(detail)) {
          const patientKey = `/api/patients/${encodeURIComponent(patientId)}`;
          const changedPatient = detail.some((key) => typeof key === "string" && (key === "/api/patients" || key.startsWith("/api/patients?") || key === patientKey));
          const changedPhoto = detail.some((key) => typeof key === "string" && key.startsWith(`${patientKey}/`));
          if (!changedPatient && !changedPhoto) return;
          if (changedPatient) invalidateClientCache(statusKey);
          if (!changedPhoto) loadStatus();
          if (!changedPhoto) return;
        } else {
          loadStatus();
        }
      }
      setFailed(false);
      setRevision((value) => value + 1);
    };
    const changed = (event: Event) => refresh(event);
    const scopeChanged = () => { setStatus(null); loadStatus(); refresh(); };
    const unauthorized = () => { setStatus(null); refresh(); };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, changed);
    window.addEventListener(CLIENT_CACHE_SCOPE_CHANGED_EVENT, scopeChanged);
    window.addEventListener(CLIENT_CACHE_UNAUTHORIZED_EVENT, unauthorized);
    return () => {
      active = false;
      window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, changed);
      window.removeEventListener(CLIENT_CACHE_SCOPE_CHANGED_EVENT, scopeChanged);
      window.removeEventListener(CLIENT_CACHE_UNAUTHORIZED_EVENT, unauthorized);
    };
  }, [patientId, statusKey]);

  const sizeClass = { xs: "h-7 w-7 text-[9px]", sm: "h-9 w-9 text-[11px]", md: "h-12 w-12 text-sm", lg: "h-14 w-14 text-base" }[size];
  const warningDotClass = { xs: "h-2 w-2", sm: "h-2.5 w-2.5", md: "h-3 w-3", lg: "h-3.5 w-3.5" }[size];
  const sexDefined = status?.patientId === patientId ? status.sexDefined : undefined;
  return <span role="img" aria-label={sexDefined === false ? `${name}; sexo não informado` : name} className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#efedff]", sizeClass, className)}>
    {patientId && !failed ? <>
      {/* eslint-disable-next-line @next/next/no-img-element -- Private image endpoint is already a resized thumbnail. */}
      <img alt="" className="absolute inset-0 h-full w-full rounded-full object-cover" loading="lazy" decoding="async" src={`/api/patients/${encodeURIComponent(patientId)}/profile-photo?v=${revision}`} onError={() => setFailed(true)} />
    </> : null}
    {patientId && sexDefined === false ? <span aria-hidden="true" title="Sexo não informado" className={cn("absolute right-0 top-0 rounded-full border-2 border-white bg-amber-500 shadow-sm", warningDotClass)} /> : null}
  </span>;
}
