// Documento de Estoque refeito: (a) posição atual, (b) movimentações do período (todos os tipos), (c) consumo por item e por
// procedimento. Custo desconhecido (item sem custo cadastrado) é "—", nunca R$ 0,00. Sem dado de paciente.
import type { stockDataset } from "../reports-datasets";
import {
  baseDocument, chart, col, compact, dateOr, datetime, decimal, EMPTY_NOTE, int, kpis, limitRows, moneyOr, note, row, table, text, unknown, unknownReasons,
  type DocumentInput, type KpiItem, type ReportDocument, type Tone,
} from "../reports-document.ts";
import { movementTypeLabel, stockSituationLabels } from "../reports-stock-rules.ts";
import { stockKindLabels, type StockKind } from "../stock-rules.ts";
import { formatNumberPtBr } from "../reports-ui-rules.ts";
import { kpi, kpisHaveData } from "./common.ts";

type Stock = Awaited<ReturnType<typeof stockDataset>>;

const kindLabel = (kind: string) => stockKindLabels[kind as StockKind]?.singular ?? kind;
const plural = (count: number, one: string, many: string) => `${formatNumberPtBr(count)} ${count === 1 ? one : many}`;

export function buildStockDocument(input: DocumentInput, data: Stock): ReportDocument {
  const { position, movements } = data;
  const { summary } = position;
  const hasPosition = position.items.length > 0;
  const hasMovements = movements.totalMovements > 0;
  // PROFESSIONAL (escopo forçado): sem custo unitário nem valor em estoque (saldo, mínimo, situação e validade seguem).
  const hideCost = Boolean(position.costHidden || movements.costHidden);
  const itemsWithoutCost = position.items.filter((item) => item.unitCostCents === null).length;
  const stockedWithoutCost = summary.itemsWithoutCost;

  // (a) Posição atual
  const positionKpis = kpis("position-kpis", compact<KpiItem>([
    kpi("items", "Itens cadastrados", int(summary.items), { hint: `Posição em ${position.asOf.split("-").reverse().join("/")}.` }),
    kpi("belowMinimum", "Abaixo do mínimo", int(summary.belowMinimum), { tone: summary.belowMinimum > 0 ? "warning" : undefined, hint: "Com saldo, mas abaixo do estoque mínimo." }),
    kpi("outOfStock", "Sem estoque", int(summary.outOfStock), { tone: summary.outOfStock > 0 ? "negative" : undefined, hint: "Saldo zerado." }),
    kpi("expiredLots", "Lotes vencidos", int(summary.expiredLots), { tone: summary.expiredLots > 0 ? "negative" : undefined, hint: "Lotes com saldo e validade vencida." }),
    kpi("expiringLots", "Lotes a vencer", int(summary.expiringLots), { tone: summary.expiringLots > 0 ? "warning" : undefined, hint: `Vencem em até ${position.warningDays} dias.` }),
    !hideCost && kpi("stockValue", "Valor total em estoque", moneyOr(summary.totalValueCents, unknownReasons.noCost), { hint: stockedWithoutCost > 0 ? `${plural(stockedWithoutCost, "item com saldo sem custo cadastrado ficou fora", "itens com saldo sem custo cadastrado ficaram fora")} do valor.` : "Saldo × custo unitário cadastrado." }),
  ]));

  const hasData = hasPosition || hasMovements || kpisHaveData(positionKpis.items);
  if (!hasData) {
    return baseDocument("stock", input, { hasData, sections: [positionKpis, note("empty-items", "Nenhum item de estoque cadastrado."), note("empty", EMPTY_NOTE)] });
  }

  const situationTone = (situation: string): Tone | undefined => (situation === "out_of_stock" ? "negative" : situation === "below_minimum" ? "warning" : undefined);
  const positionTable = table({
    id: "position",
    title: "Posição atual por item",
    columns: [
      col("name", "Item", "text", { width: 32 }),
      col("kind", "Tipo", "text", { width: 11 }),
      col("unit", "Unidade", "text", { width: 10 }),
      col("balance", "Saldo atual", "decimal"),
      col("min", "Estoque mínimo", "decimal"),
      col("situation", "Situação", "text", { width: 18 }),
      ...(hideCost ? [] : [col("cost", "Custo unitário", "money"), col("value", "Valor em estoque", "money", { total: "sum" })]),
      col("expiry", "Próxima validade", "date"),
      col("expired", "Lotes vencidos", "int", { total: "sum" }),
      col("expiring", "Lotes a vencer", "int", { total: "sum" }),
    ],
    rows: position.items.map((item) => row([
      text(item.name),
      text(kindLabel(item.kind)),
      text(item.unit),
      decimal(item.balance),
      decimal(item.minStock),
      text(stockSituationLabels[item.situation]),
      ...(hideCost ? [] : [moneyOr(item.unitCostCents, unknownReasons.noCost), moneyOr(item.valueCents, unknownReasons.noCost)]),
      dateOr(item.nextExpiry, "sem lote com saldo"),
      int(item.expiredLots),
      int(item.expiringLots),
    ], situationTone(item.situation))),
    withTotal: true,
    detail: true,
    notes: [
      "Posição atual (hoje), não a do fim do período: o saldo é a soma de todas as movimentações dos lotes.",
      hideCost
        ? "Custo unitário e valor em estoque não são exibidos para o seu perfil (escopo de profissional)."
        : `Itens sem custo cadastrado: ${itemsWithoutCost}. Custo e valor ficam "—" (desconhecidos, não R$ 0,00); o total de valor soma só os que têm custo.`,
      position.archivedWithBalance > 0 ? `${plural(position.archivedWithBalance, "item arquivado com saldo", "itens arquivados com saldo")} não listado(s).` : null,
    ],
  });

  const valueChart = hideCost ? null : chart({
    id: "value-chart",
    title: "Valor em estoque por item (maiores)",
    kind: "bar",
    unit: "money",
    categories: [...position.items].filter((item) => (item.valueCents ?? 0) > 0).sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0)).slice(0, 10).map((item) => item.name),
    series: [{ name: "Valor em estoque", values: [...position.items].filter((item) => (item.valueCents ?? 0) > 0).sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0)).slice(0, 10).map((item) => item.valueCents) }],
  });

  // (b) Movimentações do período
  const totals = movements.summary.totals;
  const professionalNote = movements.professionalScoped ? note("professional-scope", "Filtro de profissional: as movimentações mostram só o consumo em atendimentos dele; entradas, saídas manuais e ajustes são da clínica e ficam fora.", "warning") : null;
  const movementSections = hasMovements
    ? (() => {
        const typeTable = table({
          id: "movements-by-type",
          title: "Movimentações por tipo",
          columns: [col("type", "Tipo", "text", { width: 28 }), col("direction", "Sentido", "text", { width: 10 }), col("count", "Movimentos", "int", { total: "sum" }), ...(hideCost ? [] : [col("cost", "Custo estimado", "money")])],
          rows: movements.summary.types.map((entry) => row([text(entry.label), text(entry.sign === "in" ? "Entrada" : "Saída"), int(entry.movements), ...(hideCost ? [] : [moneyOr(entry.costCents, unknownReasons.noCost)])])),
          notes: [
            hideCost ? "Custos não são exibidos para o seu perfil (escopo de profissional)." : "Custo estimado = quantidade × custo atual do item (não é o custo histórico). Movimentos de itens sem custo cadastrado não entram no custo.",
            !hideCost && totals.movementsWithoutCost > 0 ? `Movimentos de itens sem custo cadastrado: ${formatNumberPtBr(totals.movementsWithoutCost)}.` : null,
            movements.reversalPairs > 0 ? `${plural(movements.reversalPairs, "movimentação estornada (com o respectivo estorno) ficou", "movimentações estornadas (com os respectivos estornos) ficaram")} fora dos totais; continuam no histórico.` : null,
          ],
        });
        const itemTable = table({
          id: "movements-by-item",
          title: "Movimentação por item",
          columns: [col("name", "Item", "text", { width: 32 }), col("unit", "Unidade", "text", { width: 10 }), col("in", "Entradas", "decimal"), col("out", "Saídas", "decimal"), col("net", "Saldo líquido do período", "decimal"), col("count", "Movimentos", "int", { total: "sum" })],
          rows: movements.summary.items.map((item) => row([text(item.name), text(item.unit), decimal(item.inQuantity), decimal(item.outQuantity), decimal(item.netQuantity), int(item.movements)], item.netQuantity < 0 ? "negative" : undefined)),
          withTotal: true,
          notes: ["Quantidades na unidade de cada item (ml, unidade, frasco); não são somadas entre itens."],
        });
        const limited = limitRows(movements.history, movements.history.length, movements.totalMovements);
        const historyTable = table({
          id: "movements-history",
          title: "Histórico de movimentações",
          columns: [col("at", "Data e hora", "datetime", { width: 17 }), col("item", "Item", "text", { width: 30 }), col("type", "Tipo", "text", { width: 26 }), col("quantity", "Quantidade", "decimal"), col("unit", "Unidade", "text", { width: 10 }), col("lot", "Lote", "text", { width: 14 }), col("note", "Motivo", "text", { width: 36 }), col("user", "Usuário", "text", { width: 20 })],
          rows: limited.rows.map((item) => row([
            datetime(item.at),
            text(item.productName),
            text(`${movementTypeLabel(item.type, item.reversesId)}${item.reversed ? " (estornado)" : ""}`),
            decimal(item.quantity),
            text(item.unit),
            text(item.lotCode),
            item.note ? text(item.note) : unknown(unknownReasons.notApplicable),
            item.userName ? text(item.userName) : unknown(unknownReasons.notApplicable),
          ], item.reversed || item.reversesId ? "muted" : item.quantity < 0 ? "negative" : undefined)),
          truncated: limited.truncated,
          detail: true,
          notes: ["Quantidade com sinal: positiva entra no estoque, negativa sai. O motivo mostra só o rótulo padronizado (ex.: Perda/quebra), o procedimento do atendimento ou 'Estorno'; observações digitadas pela equipe não são exportadas (privacidade).", limited.truncated ? `Linhas exibidas: as ${formatNumberPtBr(limited.rows.length)} movimentações mais recentes pela data exibida.` : null],
        });
        return [
          kpis("movements-kpis", [
            kpi("movements", "Movimentações no período", int(movements.totalMovements)),
            kpi("entries", "Entradas", int(totals.entryMovements), { hint: "Entrada inicial, compras, ajustes de contagem (+)." }),
            kpi("exits", "Saídas", int(totals.exitMovements), { hint: "Atendimentos, saídas manuais, ajustes (−) e cancelamentos de compra." }),
            ...(hideCost ? [] : [kpi("entryCost", "Custo estimado das entradas", moneyOr(totals.entryCostCents, unknownReasons.noCost)), kpi("exitCost", "Custo estimado das saídas", moneyOr(totals.exitCostCents, unknownReasons.noCost))]),
          ]),
          typeTable,
          itemTable,
          historyTable,
        ];
      })()
    : [note("no-movements", EMPTY_NOTE)];

  // (c) Consumo
  const consumption = movements.consumption;
  const consumptionSections = consumption.byProduct.length > 0
    ? [
        table({
          id: "consumption-by-item",
          title: "Consumo por item (atendimentos)",
          columns: [col("name", "Item", "text", { width: 32 }), col("unit", "Unidade", "text", { width: 10 }), col("quantity", "Quantidade consumida", "decimal"), ...(hideCost ? [] : [col("cost", "Custo estimado", "money", { total: "sum" })])],
          rows: consumption.byProduct.map((item) => row([text(item.name), text(item.unit), decimal(item.quantity), ...(hideCost ? [] : [moneyOr(item.estimatedCostCents, unknownReasons.noCost)])])),
          withTotal: !hideCost,
          notes: [hideCost ? "Custos não são exibidos para o seu perfil (escopo de profissional)." : "Só saídas de atendimento não estornadas. Itens sem custo cadastrado ficam com custo \"—\" e não entram no total."],
        }),
        table({
          id: "consumption-by-procedure",
          title: "Consumo por procedimento",
          columns: [col("name", "Procedimento", "text", { width: 32 }), col("movements", "Movimentos", "int", { total: "sum" }), ...(hideCost ? [] : [col("cost", "Custo estimado", "money", { total: "sum" }), col("missing", "Movimentos sem custo", "int", { total: "sum" })])],
          rows: consumption.byProcedure.map((item) => row([text(item.name), int(item.movements), ...(hideCost ? [] : [moneyOr(item.estimatedCostCents, unknownReasons.noCost), int(item.missingCostMovements)])])),
          withTotal: consumption.byProcedure.length > 0,
          notes: [consumption.byProcedureTruncated ? `Considera apenas os ${formatNumberPtBr(consumption.byProcedureTruncated)} movimentos mais recentes do período.` : null,
            hideCost ? "Só movimentos ligados a atendimentos realizados." : "Só movimentos ligados a atendimentos realizados. Custo parcial quando alguns itens não têm custo cadastrado (veja \"Movimentos sem custo\")."],
        }),
      ]
    : [];
  const costChart = hideCost ? null : chart({
    id: "consumption-chart",
    title: "Custo estimado de consumo por item (maiores)",
    kind: "bar",
    unit: "money",
    categories: consumption.byProduct.filter((item) => (item.estimatedCostCents ?? 0) > 0).slice(0, 10).map((item) => item.name),
    series: [{ name: "Custo estimado", values: consumption.byProduct.filter((item) => (item.estimatedCostCents ?? 0) > 0).slice(0, 10).map((item) => item.estimatedCostCents) }],
  });

  return baseDocument("stock", input, {
    hasData,
    subtitle: hideCost ? "Posição atual, movimentações do período e consumo." : "Posição atual, movimentações do período e consumo com custo estimado.",
    sections: compact([
      positionKpis,
      hasPosition ? positionTable : note("no-items", "Nenhum item de estoque cadastrado.", "info"),
      valueChart,
      professionalNote,
      ...movementSections,
      ...consumptionSections,
      costChart,
    ]),
  });
}
