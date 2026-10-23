"use client";

import { createContext, useContext } from "react";
import { can, type Permission } from "@/lib/permissions";

const CurrentRoleContext = createContext<string | null>(null);

export const CurrentRoleProvider = CurrentRoleContext.Provider;

// Nome do usuário logado (só em memória), para travar o profissional na agenda do papel PROFESSIONAL.
const CurrentUserNameContext = createContext<string | null>(null);

export const CurrentUserNameProvider = CurrentUserNameContext.Provider;

// Nome do profissional logado quando o papel só agenda para si mesmo; nulo para os demais papéis.
export function useOwnProfessionalName() {
  const role = useContext(CurrentRoleContext);
  const name = useContext(CurrentUserNameContext);
  return role === "PROFESSIONAL" && name ? name : null;
}

export function useCurrentRole() {
  return useContext(CurrentRoleContext);
}

// Enquanto o usuário não carregou o papel é nulo, então nada restrito aparece por engano.
export function useCan(permission: Permission) {
  return can(useCurrentRole(), permission);
}
