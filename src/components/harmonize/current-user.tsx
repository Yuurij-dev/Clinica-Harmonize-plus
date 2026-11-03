"use client";

import { createContext, useContext } from "react";
import { canForUser, type Permission, type PermissionPrincipal } from "@/lib/permissions";

// `id` e `tourEnabled` servem aos tours (marca de "já viu" por usuário; sem tour com teste expirado ou app ainda carregando).
type CurrentPrincipal = PermissionPrincipal & { id?: string; tourEnabled?: boolean };

const CurrentRoleContext = createContext<CurrentPrincipal | null>(null);

export const CurrentRoleProvider = CurrentRoleContext.Provider;

export function useCurrentRole() {
  return useContext(CurrentRoleContext)?.role ?? null;
}

// Enquanto o usuário não carregou o papel é nulo, então nada restrito aparece por engano.
export function useCan(permission: Permission) {
  const user = useContext(CurrentRoleContext);
  return user ? canForUser(user, permission) : false;
}

/** Usuário para os tours; nulo enquanto o app não está pronto ou quando o tour está desligado (ex.: teste expirado). */
export function useTourUserId() {
  const user = useContext(CurrentRoleContext);
  return user?.id && user.tourEnabled ? user.id : null;
}
