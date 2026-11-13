import { getCurrentUser } from "@/lib/auth";
import { loadReportDocument } from "@/lib/reports-document-server";
import { parseExportScope } from "@/lib/reports-export-rules";
import { reportDocumentRequest, reportJson } from "@/lib/reports-http";

// Prévia/tela dos relatórios: GET ?tab=<id de relatório>|all + period/from/to/compare/professional/granularity devolve o
// ReportDocument (JSON) que o XLSX/PDF/CSV também usam. Mesmos filtros e permissões da exportação; nada de nome de paciente.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reportJson({ message: "Não autenticado." }, 401);
  const scope = parseExportScope(new URL(request.url).searchParams.get("tab"));
  if (!scope) return reportJson({ message: "Informe um tab válido." }, 400);

  const prepared = await reportDocumentRequest(request, scope, user);
  if ("response" in prepared) return prepared.response;
  const doc = await loadReportDocument(scope, prepared.ctx, prepared.clinicName, new Date().toISOString());
  if (!doc) return reportJson({ message: "Seu cargo não tem permissão para esta área dos relatórios." }, 403);
  return reportJson(doc);
}
