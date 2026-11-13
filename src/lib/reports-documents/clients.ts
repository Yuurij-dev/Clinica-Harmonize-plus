// Documento de Clientes: só contagens e taxas agregadas (nenhum nome, CPF, telefone ou e-mail).
import type { clientsExtras } from "../reports-datasets";
import {
  baseDocument, chart, col, compact, decimalOr, int, kpis, note, percentOr, row, table, text, unknownReasons,
  type DocumentInput, type ReportDocument,
} from "../reports-document.ts";
import type { clientsReport } from "../reports-server";
import { countKpi, kpisHaveData, kpi, rateKpi } from "./common.ts";

type Clients = Awaited<ReturnType<typeof clientsReport>>;
type Extras = Awaited<ReturnType<typeof clientsExtras>>;

export function buildClientsDocument(input: DocumentInput, data: { report: Clients; extras: Extras }): ReportDocument {
  const { report, extras } = data;
  const { stats, previous } = report;

  const summary = kpis("summary", [
    countKpi("registered", "Total cadastrado", extras.totalRegistered, undefined, "Pacientes cadastrados até o fim do período."),
    countKpi("new", "Novos no período", stats.newPatients, previous?.newPatients),
    countKpi("active", "Ativos no período", stats.attendedPatients, undefined, "Com ao menos 1 atendimento realizado no período."),
    countKpi("recurring", "Recorrentes", stats.recurring, undefined, "2 ou mais atendimentos realizados acumulados e ao menos 1 no período."),
    countKpi("inactive", "Sem movimentação recente", stats.inactive, undefined, `Já atendidos e sem atendimento realizado há ${stats.inactiveDays} dias ou mais.`),
    kpi("frequency", "Frequência média", decimalOr(stats.averageFrequency, unknownReasons.noData), { hint: "Atendimentos realizados ÷ pacientes atendidos no período." }),
    rateKpi("returnRate", "Taxa de retorno", stats.returnRate.value, previous ? previous.returnRate : undefined, "Dos pacientes atendidos no período, % que já tinham atendimento realizado antes."),
  ]);

  // Vazio = nenhum dado exibido: nem as bases do relatório nem os KPIs (um KPI diferente de zero nunca é "vazio").
  const hasData = extras.totalRegistered > 0 || kpisHaveData(summary.items);
  if (!hasData) return baseDocument("clients", input, { hasData, sections: [summary, note("empty", "Nenhum cliente cadastrado até o fim do período.")] });

  const visits = table({
    id: "visits",
    title: "Distribuição por número de atendimentos no período",
    columns: [col("group", "Atendimentos no período", "text", { width: 28 }), col("patients", "Pacientes", "int", { total: "sum" }), col("appointments", "Atendimentos", "int", { total: "sum" }), col("share", "% dos pacientes atendidos", "percent")],
    rows: extras.visits.groups.map((group) => row([text(group.label), int(group.patients), int(group.appointments), percentOr(extras.visits.totalPatients > 0 ? (group.patients / extras.visits.totalPatients) * 100 : null, unknownReasons.noData)])),
    withTotal: extras.visits.totalPatients > 0,
    notes: extras.visits.totalPatients === 0 ? ["Nenhum atendimento realizado no período."] : [],
  });
  const visitsChart = chart({ id: "visits-chart", title: "Pacientes por número de atendimentos", kind: "bar", unit: "int", categories: extras.visits.groups.map((group) => group.label), series: [{ name: "Pacientes", values: extras.visits.groups.map((group) => group.patients) }] });

  const points = report.baseSeries.points;
  const evolution = table({
    id: "evolution",
    title: "Evolução da base de pacientes",
    columns: [col("period", "Período", "text", { width: 18 }), col("new", "Novos pacientes", "int", { total: "sum" }), col("total", "Base acumulada", "int")],
    rows: points.map((point) => row([text(point.label), int(point.newPatients), int(point.totalPatients)])),
    withTotal: true,
  });
  const evolutionChart = chart({ id: "evolution-chart", title: "Base de pacientes (acumulada)", kind: "line", unit: "int", categories: points.map((point) => point.label), series: [{ name: "Base acumulada", values: points.map((point) => point.totalPatients), style: "current" }] });

  return baseDocument("clients", input, {
    hasData,
    subtitle: "Base cadastrada, novos, ativos e recorrentes, sem identificar pessoas.",
    sections: compact([summary, note("privacy", "Este relatório traz apenas contagens e taxas: nenhum nome, CPF, telefone ou e-mail de paciente.", "info"), visitsChart, visits, evolutionChart, evolution]),
  });
}
