"use client";

import { createContext, useContext } from "react";
import { can, type Permission } from "@/lib/permissions";

const CurrentRoleContext = createContext<string | null>(null);

export const CurrentRoleProvider = CurrentRoleContext.Provider;

export function useCurrentRole() {
  return useContext(CurrentRoleContext);
}

// Enquanto o usuário não carregou o papel é nulo, então nada restrito aparece por engano.
export function useCan(permission: Permission) {
  return can(useCurrentRole(), permission);
}
