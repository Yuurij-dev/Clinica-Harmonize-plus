"use client";

import { createContext, useContext } from "react";
import { canForUser, type Permission, type PermissionPrincipal } from "@/lib/permissions";

const CurrentRoleContext = createContext<PermissionPrincipal | null>(null);

export const CurrentRoleProvider = CurrentRoleContext.Provider;

export function useCurrentRole() {
  return useContext(CurrentRoleContext)?.role ?? null;
}

// Enquanto o usuário não carregou o papel é nulo, então nada restrito aparece por engano.
export function useCan(permission: Permission) {
  const user = useContext(CurrentRoleContext);
  return user ? canForUser(user, permission) : false;
}
