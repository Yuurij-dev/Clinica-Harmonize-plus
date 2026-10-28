"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

export function AppToaster() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  // No celular os avisos sobem para o topo, longe do "Desfazer", da barra inferior e do FAB.
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023.98px)");
    const sync = () => setMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const syncTheme = () => setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    syncTheme();
    window.addEventListener("harmonize-theme-change", syncTheme);
    return () => window.removeEventListener("harmonize-theme-change", syncTheme);
  }, []);

  return <Toaster position={mobile ? "top-center" : "bottom-right"} mobileOffset={{ top: "calc(4.5rem + env(safe-area-inset-top))", left: 16, right: 16 }} theme={theme} richColors closeButton />;
}
