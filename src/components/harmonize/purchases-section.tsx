"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, readClientCache } from "@/lib/client-cache";
import { PendingPanel } from "./pending-panel";
import { PurchasesPanel } from "./purchases-panel";
import { useCurrentRole } from "./current-user";
import { SectionIntro } from "./shared";
import { SectionWarning, useStockAlerts, warningTabClass } from "./stock-alerts";
import type { StockMaterial } from "./stock-shared";

const productsKey = "/api/products";

export type PurchasesTab = "purchases" | "pending";

// A aba fica no app para que um aviso de pendência abra Compras direto em Pendências.
export function PurchasesSection({ tab, onTabChange: setTab, onSaved }: { tab: PurchasesTab; onTabChange: (tab: PurchasesTab) => void; onSaved?: (message: string, undo?: () => void) => void }) {
  const isAdmin = useCurrentRole() === "ADMIN";
  const hasPendingAlert = useStockAlerts(isAdmin).some((alert) => alert.kind === "pending");
  const [creatingPurchase, setCreatingPurchase] = useState(false);
  // Itens do estoque oferecidos no formulário de compra.
  const [materials, setMaterials] = useState<StockMaterial[]>(() => readClientCache<{ products?: StockMaterial[] }>(productsKey)?.products ?? []);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handle = (event: Event) => { if ((event as CustomEvent<string[]>).detail?.includes(productsKey)) setRefreshKey((current) => current + 1); };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
  }, []);

  useEffect(() => {
    let active = true;
    getCachedJson<{ products?: StockMaterial[] }>(productsKey).then((data) => { if (active) setMaterials(data.products ?? []); }).catch(() => undefined);
    return () => { active = false; };
  }, [refreshKey]);

  return (
    <div>
      <SectionIntro title="Compras" titleAddon={<SectionWarning section="compras" enabled={isAdmin} />} description="Compras de materiais e produtos, saídas pendentes e conferências de atendimentos." action={tab === "purchases" ? "Nova compra" : undefined} onAction={() => setCreatingPurchase(true)} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant={tab === "purchases" ? "primary" : "secondary"} size="sm" onClick={() => setTab("purchases")}>Compras</Button>
        <Button variant={tab === "pending" ? "primary" : "secondary"} size="sm" className={warningTabClass(hasPendingAlert, tab === "pending")} onClick={() => setTab("pending")}>Pendências</Button>
      </div>
      {tab === "pending" ? <PendingPanel onSaved={onSaved} /> : <PurchasesPanel materials={materials} creating={creatingPurchase} onCloseCreate={() => setCreatingPurchase(false)} onSaved={onSaved} />}
    </div>
  );
}
