import Image from "next/image";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { navItems } from "@/data/navigation";
import type { SectionId } from "@/types/clinic";
import { Button } from "@/components/ui/button";
import { SlidingIndicator } from "@/components/ui/sliding-indicator";
import { cn } from "@/lib/utils";
import { visibleSections, type RolePermissionMatrix } from "@/lib/permissions";
import { useCan } from "./current-user";
import { SectionWarning } from "./stock-alerts";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, readClientCache } from "@/lib/client-cache";

type ActiveSession = { id: string; patientId: string; journeyId: string; procedureName: string; patientName: string; journeyName: string };
const activeSessionsKey = "/api/patients/active-procedures";

function ActiveProcedureWarning({ enabled }: { enabled: boolean }) {
  const [sessions, setSessions] = useState<ActiveSession[]>(() => readClientCache<{ sessions: ActiveSession[] }>(activeSessionsKey)?.sessions ?? []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => getCachedJson<{ sessions: ActiveSession[] }>(activeSessionsKey).then((data) => { if (active) setSessions(data.sessions); }).catch(() => undefined);
    void load();
    const desktop = window.matchMedia("(min-width: 1024px)");
    const timer = window.setInterval(() => { if (desktop.matches && document.visibilityState === "visible") void load(); }, 10_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    const refreshAfterSessionChange = (event: Event) => {
      if ((event as CustomEvent<string[]>).detail?.includes(activeSessionsKey)) void load();
    };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, refreshAfterSessionChange);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, refreshAfterSessionChange); };
  }, [enabled]);
  if (!enabled || !sessions.length) return null;
  return <span className="group/warning relative inline-flex"><span role="button" tabIndex={0} aria-label={`Abrir jornada ${sessions[0].journeyName}; procedimento em andamento`} onClick={(event) => { event.stopPropagation(); window.location.assign(`/clientes?patient=${encodeURIComponent(sessions[0].patientId)}&journey=${encodeURIComponent(sessions[0].journeyId)}`); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); window.location.assign(`/clientes?patient=${encodeURIComponent(sessions[0].patientId)}&journey=${encodeURIComponent(sessions[0].journeyId)}`); } }} className="grid h-6 w-6 cursor-pointer place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span aria-hidden="true" className="stock-alert-dot block h-1.5 w-1.5 rounded-full" /></span><span role="tooltip" className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 w-72 -translate-y-1/2 rounded-md border border-border bg-card p-3 text-left opacity-0 shadow-lg transition-opacity duration-150 group-hover/warning:visible group-hover/warning:opacity-100 group-focus-within/warning:visible group-focus-within/warning:opacity-100"><span className="block text-xs font-semibold text-foreground">Procedimentos em andamento</span>{sessions.map((session) => <span key={session.id} className="mt-2 block text-xs text-muted-foreground">{session.journeyName}: procedimento em andamento ({session.procedureName})</span>)}</span></span>;
}

type SidebarProps = {
  active: SectionId;
  onSelect: (section: SectionId) => void;
  onNewAppointment: () => void;
  clinicName?: string;
  role?: string | null;
  rolePermissions?: RolePermissionMatrix;
  isOwner?: boolean;
};

export function Sidebar({
  active,
  onSelect,
  onNewAppointment,
  clinicName,
  role,
  rolePermissions,
  isOwner,
}: SidebarProps) {
  const allowed = visibleSections(role, rolePermissions, isOwner);
  const canManageAgenda = useCan("agenda:manage");
  const canReadClinical = useCan("clinical:read");
  const visibleNavItems = navItems.filter((item) => allowed.includes(item.id));
  return (
    <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:block">
    <aside className="flex h-full w-[220px] flex-col border-r border-border bg-card px-4 py-5 text-card-foreground">
      <div className="mb-7 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <Image alt="Harmonize+" className="h-auto w-[150px] hp-logo-light" height={300} priority src="/brand/logo-horizontal.svg" unoptimized width={1200} />
          <Image alt="Harmonize+" className="hp-logo-dark h-auto w-[150px]" height={300} priority src="/brand/logo-horizontal-white.svg" unoptimized width={1200} />
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">Gestão para clínicas</p>
        </div>
      </div>

      {canManageAgenda ? <Button className="mb-6 w-full justify-start whitespace-nowrap px-3 text-xs" variant="primary" onClick={onNewAppointment}>
        <Plus className="h-4 w-4" />
        Novo agendamento
      </Button> : null}

      <nav className="relative space-y-0.5">
        <SlidingIndicator variant="block" />
        <SlidingIndicator variant="dot" />
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;

          return (
            <button
              key={item.id}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "hp-pressable relative flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => {
                onSelect(item.id);
              }}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
              <span className="flex items-center gap-2">
                {item.id === "estoque" || item.id === "compras" ? <SectionWarning section={item.id} enabled={allowed.includes(item.id)} inMenu /> : null}
                {item.id === "clientes" ? <ActiveProcedureWarning enabled={canReadClinical && allowed.includes("clientes")} /> : null}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-border px-2 pt-4">
        <p className="text-xs font-semibold text-muted-foreground">{clinicName ?? "Clínica"}</p>
        <p className="mt-1 text-xs font-bold text-foreground">Plano profissional</p>
      </div>
    </aside>
    </div>
  );
}
