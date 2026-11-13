// Insights determinísticos dos Relatórios (puros, sem banco). Cada insight traz id, disponibilidade e mensagem;
// sem dados suficientes, available:false com a explicação.
import { changePct } from "./reports-rules.ts";

export type Insight = { id: string; available: boolean; tone: "positive" | "negative" | "neutral"; message: string };

export type InsightInput = {
  revenue: { current: number | null; previous: number | null } | null;
  procedures: Array<{ name: string; executions: number }>;
  // null = não mostrar (usuário PROFESSIONAL ou filtro de profissional aplicado).
  professionals: Array<{ name: string; done: number }> | null;
  weekdayCounts: number[];
  returnRate: { current: number | null; previous: number | null };
  quoteConversion: { current: number | null; previous: number | null } | null;
};

const weekdayNames = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const fmtPct = (value: number) => `${Math.abs(value).toFixed(1).replace(".", ",")}%`;
const fmtPp = (value: number) => `${Math.abs(value).toFixed(1).replace(".", ",")} p.p.`;
const unavailable = (id: string, message: string): Insight => ({ id, available: false, tone: "neutral", message });
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function buildInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];

  if (input.revenue) {
    const { current, previous } = input.revenue;
    const pct = changePct(current, previous);
    if (pct === null || current === null) insights.push(unavailable("revenue", "Sem receita no período anterior para comparar."));
    else if (pct === 0) insights.push({ id: "revenue", available: true, tone: "neutral", message: "A receita recebida ficou igual à do período anterior." });
    else insights.push({ id: "revenue", available: true, tone: pct > 0 ? "positive" : "negative", message: `A receita recebida ${pct > 0 ? "subiu" : "caiu"} ${fmtPct(pct)} em relação ao período anterior.` });
  }

  const top = [...input.procedures].sort((a, b) => b.executions - a.executions || a.name.localeCompare(b.name, "pt-BR"))[0];
  insights.push(top ? { id: "topProcedure", available: true, tone: "neutral", message: `${top.name} foi o procedimento mais realizado (${plural(top.executions, "execução", "execuções")}).` } : unavailable("topProcedure", "Nenhum atendimento realizado no período."));

  if (input.professionals) {
    const best = [...input.professionals].sort((a, b) => b.done - a.done || a.name.localeCompare(b.name, "pt-BR"))[0];
    insights.push(best && best.done > 0 ? { id: "topProfessional", available: true, tone: "neutral", message: `${best.name} fez mais atendimentos (${best.done}).` } : unavailable("topProfessional", "Nenhum atendimento realizado no período."));
  }

  const total = input.weekdayCounts.reduce((sum, value) => sum + value, 0);
  if (total === 0) insights.push(unavailable("busiestWeekday", "Nenhum atendimento realizado no período."));
  else {
    const max = Math.max(...input.weekdayCounts);
    const index = input.weekdayCounts.indexOf(max);
    const tied = input.weekdayCounts.filter((value) => value === max).length > 1;
    insights.push(tied
      ? unavailable("busiestWeekday", "Mais de um dia da semana empatou como o de maior movimento.")
      : { id: "busiestWeekday", available: true, tone: "neutral", message: `${weekdayNames[index][0].toUpperCase()}${weekdayNames[index].slice(1)} é o dia de maior movimento (${plural(max, "atendimento", "atendimentos")}).` });
  }

  const { current: rateNow, previous: ratePrev } = input.returnRate;
  if (rateNow === null || ratePrev === null) insights.push(unavailable("returnRate", "Sem pacientes atendidos em um dos períodos para comparar a taxa de retorno."));
  else if (rateNow === ratePrev) insights.push({ id: "returnRate", available: true, tone: "neutral", message: "A taxa de retorno ficou igual à do período anterior." });
  else insights.push({ id: "returnRate", available: true, tone: rateNow > ratePrev ? "positive" : "negative", message: `A taxa de retorno ${rateNow > ratePrev ? "subiu" : "caiu"} ${fmtPp(rateNow - ratePrev)} em relação ao período anterior.` });

  if (input.quoteConversion) {
    const { current, previous } = input.quoteConversion;
    if (current === null || previous === null) insights.push(unavailable("quoteConversion", "Sem orçamentos criados em um dos períodos para comparar a conversão."));
    else if (current === previous) insights.push({ id: "quoteConversion", available: true, tone: "neutral", message: "A conversão de orçamentos ficou igual à do período anterior." });
    else insights.push({ id: "quoteConversion", available: true, tone: current > previous ? "positive" : "negative", message: `A conversão de orçamentos ${current > previous ? "melhorou" : "piorou"} ${fmtPp(current - previous)} em relação ao período anterior.` });
  }

  return insights;
}
