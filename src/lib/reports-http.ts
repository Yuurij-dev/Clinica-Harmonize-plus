// Borda HTTP dos Relatórios: autenticação, permissão (reports:access + capacidade da aba) e resolução de período/filtros.
import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { clinicToday } from "./clinic-time";
import type { ReportKind } from "./reports-document";
import { exportScopeNeed } from "./reports-export-rules";
import { appliedProfessional, isValidProfessionalParam, resolveReportAccess } from "./reports-access";
import { comparisonRange, defaultGranularity, isReportGranularity, resolveReportRange } from "./reports-rules";
import type { ReportContext } from "./reports-server";

// Respostas privadas: nunca cache público.
export const reportJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// Autentica, valida permissão (reports:access e, se pedida, a capacidade da aba) e resolve período/filtros.
type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

// `knownUser`: quem já leu a sessão nesta requisição a repassa (uma única leitura de getCurrentUser por requisição).
export async function reportContext(request: Request, need?: "finance" | "quotes" | "stock", knownUser?: SessionUser): Promise<{ ctx: ReportContext } | { response: NextResponse }> {
  const user = knownUser ?? (await getCurrentUser());
  if (!user) return { response: reportJson({ message: "Não autenticado." }, 401) };
  const access = resolveReportAccess(user);
  if (!access.allowed) return { response: reportJson({ message: "Seu cargo não tem permissão para ver relatórios." }, 403) };
  if (need && !access.capabilities[need]) return { response: reportJson({ message: "Seu cargo não tem permissão para esta área dos relatórios." }, 403) };
  const params = new URL(request.url).searchParams;
  const today = clinicToday();
  const resolved = resolveReportRange({ period: params.get("period"), from: params.get("from"), to: params.get("to") }, today);
  if (!resolved.ok) return { response: reportJson({ message: resolved.message }, 400) };
  if (!isValidProfessionalParam(params.get("professional"))) return { response: reportJson({ message: "Profissional inválido." }, 400) };
  const granularityParam = params.get("granularity");
  if (granularityParam && !isReportGranularity(granularityParam)) return { response: reportJson({ message: "Granularidade inválida." }, 400) };
  return {
    ctx: {
      clinicId: user.clinicId,
      access,
      range: resolved.range,
      previous: params.get("compare") === "1" ? comparisonRange(resolved.range) : null,
      professional: appliedProfessional(access, params.get("professional")),
      requestedProfessional: access.canChooseProfessional ? appliedProfessional(access, params.get("professional")) : null,
      granularity: isReportGranularity(granularityParam) ? granularityParam : defaultGranularity(resolved.range.days),
      today,
    },
  };
}

// Base das rotas que devolvem o ReportDocument (document/export): autentica, valida permissão do relatório e resolve os
// filtros. `scope` já validado (id de relatório ou "all"); o nome da clínica vem da sessão.
export async function reportDocumentRequest(request: Request, scope: ReportKind, user: SessionUser): Promise<{ ctx: ReportContext; clinicName: string } | { response: NextResponse }> {
  const result = await reportContext(request, exportScopeNeed(scope) ?? undefined, user);
  if ("response" in result) return result;
  return { ctx: result.ctx, clinicName: user.clinic.name };
}
