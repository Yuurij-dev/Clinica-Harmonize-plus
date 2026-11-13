import { appointmentsReport } from "@/lib/reports-datasets";
import { reportContext, reportJson } from "@/lib/reports-http";

// Relatórios (somente leitura, escopo da clínica da sessão). Só reports:access; PROFESSIONAL vê apenas os próprios agendamentos
// (filtro forçado em reportContext). Sem nome de paciente: só contagens por situação, profissional e dia da semana.
export async function GET(request: Request) {
  const result = await reportContext(request);
  if ("response" in result) return result.response;
  return reportJson(await appointmentsReport(result.ctx));
}
