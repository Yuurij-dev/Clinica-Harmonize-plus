// Orquestra datasets de servidor + builders puros e devolve o pacote de exportação (documento + especificação de planilha) de um
// relatório ou do consolidado. Todas as consultas usam o clinicId de ctx (sessão). Permissão: `null` quando o relatório exige
// capacidade que o usuário não tem (a rota responde 403). Em sequência, para a exportação não disputar conexões do banco.
import { appointmentsReport, clientsExtras, financeExtras, proceduresExtras, professionalsExtras, quotesExtras, stockDataset } from "./reports-datasets";
import { allowedReportIds, reportDefinitions, type DocumentInput, type ReportDocument, type ReportKind } from "./reports-document";
import {
  buildAllDocument, buildAppointmentsDocument, buildClientsDocument, buildFinanceDocument, buildOverviewDocument, buildProceduresDocument,
  buildProfessionalsDocument, buildQuotesDocument, buildStockDocument,
} from "./reports-documents/index";
import { clientsReport, financeReport, loadAppointments, loadCatalog, loadQuotes, overviewReport, proceduresReport, professionalsReport, quotesReport, span, type ReportContext } from "./reports-server";
import { granularityLabels } from "./reports-ui-rules";
import {
  buildAllSpec, buildAppointmentsSpec, buildClientsSpec, buildFinanceSpec, buildGenericSpec, buildProceduresSpec, buildProfessionalsSpec, buildQuotesSpec, buildStockSpec,
  type ExportBundle,
} from "./reports-xlsx-specs/index";

export type { ExportBundle };

export function documentInputFor(ctx: ReportContext, clinicName: string, generatedAt: string): DocumentInput {
  return { clinicName, range: ctx.range, previous: ctx.previous, professional: ctx.professional, granularityLabel: granularityLabels[ctx.granularity], generatedAt };
}

export function canBuildReport(kind: ReportKind, ctx: ReportContext) {
  const need = reportDefinitions[kind].need;
  return need === null || ctx.access.capabilities[need];
}

async function single(kind: Exclude<ReportKind, "all">, ctx: ReportContext, input: DocumentInput): Promise<ExportBundle> {
  // Agendamentos/catálogo/orçamentos vêm do cache por requisição (loadX): o consolidado não relê o banco a cada relatório.
  switch (kind) {
    case "finance": {
      const extras = await financeExtras(ctx);
      const doc = buildFinanceDocument(input, { report: await financeReport(ctx), extras });
      return { doc, spec: buildFinanceSpec(doc, extras) };
    }
    case "procedures": {
      const doc = buildProceduresDocument(input, { report: await proceduresReport(ctx), extras: await proceduresExtras(ctx) });
      return { doc, spec: buildProceduresSpec(doc, { rows: await loadAppointments(ctx, span(ctx)), catalog: await loadCatalog(ctx) }) };
    }
    case "professionals": {
      const doc = buildProfessionalsDocument(input, { report: await professionalsReport(ctx), extras: await professionalsExtras(ctx) });
      return { doc, spec: buildProfessionalsSpec(doc, { rows: await loadAppointments(ctx, span(ctx)), catalog: await loadCatalog(ctx) }) };
    }
    case "appointments": {
      const doc = buildAppointmentsDocument(input, await appointmentsReport(ctx));
      return { doc, spec: buildAppointmentsSpec(doc, { rows: await loadAppointments(ctx, span(ctx)) }) };
    }
    case "clients": {
      const report = await clientsReport(ctx);
      const doc = buildClientsDocument(input, { report, extras: await clientsExtras(ctx) });
      return { doc, spec: buildClientsSpec(doc, { points: report.baseSeries.points, granularity: ctx.granularity, rows: await loadAppointments(ctx, span(ctx)) }) };
    }
    case "quotes": {
      const doc = buildQuotesDocument(input, { report: await quotesReport(ctx), extras: await quotesExtras(ctx) });
      return { doc, spec: buildQuotesSpec(doc, { rows: await loadQuotes(ctx, span(ctx)) }) };
    }
    case "stock": {
      const data = await stockDataset(ctx);
      const doc = buildStockDocument(input, data);
      return { doc, spec: buildStockSpec(doc, data) };
    }
    case "overview": {
      const doc = buildOverviewDocument(input, await overviewReport(ctx));
      return { doc, spec: buildGenericSpec(doc) };
    }
  }
}

export async function loadReportBundle(kind: ReportKind, ctx: ReportContext, clinicName: string, generatedAt: string): Promise<ExportBundle | null> {
  if (!canBuildReport(kind, ctx)) return null;
  const input = documentInputFor(ctx, clinicName, generatedAt);
  if (kind !== "all") return single(kind, ctx, input);
  const parts: ExportBundle[] = [await single("overview", ctx, input)];
  for (const id of allowedReportIds(ctx.access.capabilities)) parts.push(await single(id, ctx, input));
  const doc = buildAllDocument(input, parts.map((part) => part.doc));
  return { doc, spec: buildAllSpec(doc, parts) };
}

export async function loadReportDocument(kind: ReportKind, ctx: ReportContext, clinicName: string, generatedAt: string): Promise<ReportDocument | null> {
  return (await loadReportBundle(kind, ctx, clinicName, generatedAt))?.doc ?? null;
}
