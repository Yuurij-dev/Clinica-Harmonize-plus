"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { HarmonizeApp } from "./harmonize-app";

export function AppRouterShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return pathname === "/login" ? children : <HarmonizeApp />;
}
