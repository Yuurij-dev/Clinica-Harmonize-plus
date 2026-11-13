// Documento consolidado (`all`): capa + resumo (KPIs) de cada relatório permitido. Os documentos individuais vêm prontos.
import { baseDocument, compact, kpis, note, reportDefinitions, type DocumentInput, type ReportDocument, type Section } from "../reports-document.ts";

export function buildAllDocument(input: DocumentInput, parts: ReportDocument[]): ReportDocument {
  const sections: Section[] = [
    note("cover", `Consolidado com ${parts.length} relatório(s): ${parts.map((part) => part.title).join(", ")}. Cada bloco traz os indicadores principais; o detalhe está no relatório individual.`),
  ];
  for (const part of parts) {
    const summary = part.sections.find((section) => section.type === "kpis");
    if (part.hasData && summary && summary.type === "kpis") sections.push(kpis(`${part.kind}-summary`, summary.items, part.title));
    else sections.push(note(`${part.kind}-empty`, `${part.title}: Nenhuma movimentação no período.`));
    const warnings = part.sections.filter((section) => section.type === "note" && section.tone === "warning");
    for (const warning of warnings) if (warning.type === "note") sections.push(note(`${part.kind}-${warning.id}`, `${part.title}: ${warning.text}`, "warning"));
  }
  return baseDocument("all", input, {
    hasData: parts.some((part) => part.hasData),
    subtitle: reportDefinitions.all.description,
    sections: compact(sections),
  });
}
