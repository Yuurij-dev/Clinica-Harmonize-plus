"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { ExportExtension } from "@/lib/reports-document";
import { downloadFileName, exportSuccessMessage, exportUrl } from "@/lib/reports-center-rules";
import type { ReportFilters } from "@/lib/reports-ui-rules";

export type ExportBusy = { kind: string; format: ExportExtension } | null;

// Baixa o arquivo de /api/reports/export (blob) com os filtros aplicados na tela. Uma exportação por vez.
export function useReportExport(filters: ReportFilters) {
  const [busy, setBusy] = useState<ExportBusy>(null);
  const running = useRef(false);

  const run = useCallback(async (kind: string, format: ExportExtension) => {
    if (running.current) return;
    running.current = true;
    setBusy({ kind, format });
    try {
      const response = await fetch(exportUrl(kind, format, filters), { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        toast.error(body?.message ?? "Não foi possível gerar o arquivo. Tente novamente.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadFileName(response.headers.get("Content-Disposition"), kind, format);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(exportSuccessMessage(format));
      const truncated = /^(\d+)\/(\d+)$/.exec(response.headers.get("X-Report-Truncated") ?? "");
      if (truncated) toast.warning(`O arquivo traz só as ${Number(truncated[1]).toLocaleString("pt-BR")} linhas mais recentes de ${Number(truncated[2]).toLocaleString("pt-BR")}. Reduza o período para ver o restante.`);
    } catch {
      toast.error("Não foi possível gerar o arquivo. Verifique a conexão e tente novamente.");
    } finally {
      running.current = false;
      setBusy(null);
    }
  }, [filters]);

  return { busy, run };
}
