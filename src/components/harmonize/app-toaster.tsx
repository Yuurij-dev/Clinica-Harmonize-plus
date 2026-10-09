"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

export function AppToaster() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const syncTheme = () => setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    syncTheme();
    window.addEventListener("harmonize-theme-change", syncTheme);
    return () => window.removeEventListener("harmonize-theme-change", syncTheme);
  }, []);

  return <Toaster position="bottom-right" theme={theme} richColors closeButton />;
}
