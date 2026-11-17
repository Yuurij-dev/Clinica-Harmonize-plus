import { reportContext, reportJson } from "@/lib/reports-http";
import { reportProfessionalNames } from "@/lib/reports-server";

// Lista de profissionais do filtro dos Relatórios. Exige só a página de Relatórios (`reports`, Pro+), sem liberar a visão geral.
// Mesmo recorte do overview: escopo restrito (PROFESSIONAL) nunca recebe a equipe. Só nomes.
export async function GET(request: Request) {
  const result = await reportContext(request);
  if ("response" in result) return result.response;
  return reportJson({ professionals: await reportProfessionalNames(result.ctx) });
}
