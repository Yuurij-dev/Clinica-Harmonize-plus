import { reportContext, reportJson } from "@/lib/reports-http";
import { overviewReport } from "@/lib/reports-server";

// Relatórios (somente leitura, escopo da clínica da sessão). Filtros de período/profissional resolvidos no servidor.
export async function GET(request: Request) {
  const result = await reportContext(request);
  if ("response" in result) return result.response;
  return reportJson(await overviewReport(result.ctx));
}
