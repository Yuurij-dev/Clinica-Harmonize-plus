"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isStandalonePath } from "@/lib/standalone-paths";
import { HarmonizeApp } from "./harmonize-app";

export function AppRouterShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return isStandalonePath(pathname) ? children : <HarmonizeApp />;
}
