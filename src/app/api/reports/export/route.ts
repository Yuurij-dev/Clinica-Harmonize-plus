import { getCurrentUser } from "@/lib/auth";
import { renderReportFile } from "@/lib/reports-export";
import { CSV_ALL_MESSAGE, parseExportFormat, parseExportScope } from "@/lib/reports-export-rules";
import { reportDocumentRequest, reportJson } from "@/lib/reports-http";
import { loadReportBundle } from "@/lib/reports-document-server";

// Exportação (somente leitura): GET ?format=xlsx|pdf|csv&tab=<id de relatório>|all + period/from/to/compare/professional/granularity.
// Mesmo ReportDocument da tela (/api/reports/document), renderizado em XLSX (exceljs), PDF (pdf-lib) ou CSV.
// 401 sem sessão; 400 format/tab/filtro inválido; 403 sem reports:access ou sem a permissão do relatório; "all" traz só os permitidos.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reportJson({ message: "Não autenticado." }, 401);
  const params = new URL(request.url).searchParams;
  const format = parseExportFormat(params.get("format"));
  const scope = parseExportScope(params.get("tab"));
  if (!format || !scope) return reportJson({ message: "Informe format (xlsx, pdf ou csv) e tab válidos." }, 400);


  const prepared = await reportDocumentRequest(request, scope, user);
  if ("response" in prepared) return prepared.response;
  // Depois da permissão (403 antes de 400): o consolidado não tem CSV.
  if (format === "csv" && scope === "all") return reportJson({ message: CSV_ALL_MESSAGE }, 400);
  const bundle = await loadReportBundle(scope, prepared.ctx, prepared.clinicName, new Date().toISOString());
  if (!bundle) return reportJson({ message: "Seu cargo não tem permissão para esta área dos relatórios." }, 403);

  const file = await renderReportFile(bundle, format);
  return new Response(Buffer.from(file.body), { headers: file.headers });
}
