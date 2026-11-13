// XLSX do Estoque: aba "Estoque" (posição por item) e aba "Movimentações" (histórico, só rótulos padronizados).
// PROFESSIONAL (costHidden): sem custo unitário nem valor em estoque. Sem paciente nem texto livre.
import { dateOr, datetime, decimal, int, money, text, unknown, unknownReasons, type Cell, type ReportDocument } from "../reports-document.ts";
import { movementTypeLabel, stockSituationLabels, type PositionItem } from "../reports-stock-rules.ts";
import { stockKindLabels, type StockKind } from "../stock-rules.ts";
import { count, is, isKey, sum, type AggregateSpec, type DataColumn, type DataSheet, type XlsxSpec } from "../reports-xlsx-types.ts";
import { baseSpec, kpiGroupsOf, limitDetail } from "./common.ts";

export type StockSource = {
  position: { items: PositionItem[]; costHidden?: boolean };
  movements: { costHidden?: boolean; totalMovements: number; history: Array<{ at: string; type: string; reversesId: string | null; reversed: boolean; productName: string; unit: string; quantity: number; lotCode: string; note: string }> };
};

const ITEMS = "Estoque";
const MOVES = "Movimentações";
const kindLabel = (kind: string) => stockKindLabels[kind as StockKind]?.singular ?? kind;

export function buildStockSpec(doc: ReportDocument, source: StockSource): XlsxSpec {
  const hideCost = Boolean(source.position.costHidden || source.movements.costHidden);
  const items = limitDetail(source.position.items, undefined, "first");
  const itemColumns: DataColumn[] = [
    { key: "name", label: "Item", type: "text", width: 28 },
    { key: "kind", label: "Tipo", type: "text", width: 11 },
    { key: "unit", label: "Unidade", type: "text", width: 10 },
    { key: "balance", label: "Saldo", type: "decimal" },
    { key: "min", label: "Mínimo", type: "decimal" },
    { key: "situation", label: "Situação", type: "text", width: 18 },
    ...(hideCost ? [] : [{ key: "cost", label: "Custo unitário", type: "money" } as DataColumn, { key: "value", label: "Valor em estoque", type: "money", sum: true } as DataColumn]),
    { key: "expiry", label: "Próxima validade", type: "date" },
  ];
  const itemRows: Cell[][] = items.rows.map((item) => [
    text(item.name),
    text(kindLabel(item.kind)),
    text(item.unit),
    decimal(item.balance),
    decimal(item.minStock),
    text(stockSituationLabels[item.situation]),
    ...(hideCost ? [] : [item.unitCostCents === null ? unknown(unknownReasons.noCost) : money(item.unitCostCents), item.valueCents === null ? unknown(unknownReasons.noCost) : money(item.valueCents)]),
    dateOr(item.nextExpiry, "sem lote com saldo"),
  ]);
  const itemsSheet: DataSheet = { name: ITEMS, columns: itemColumns, rows: itemRows, truncated: items.truncated };

  const history = limitDetail(source.movements.history, undefined, "first");
  const moveRows: Cell[][] = history.rows.map((item) => [
    datetime(item.at),
    text(item.productName),
    text(`${movementTypeLabel(item.type, item.reversesId)}${item.reversed ? " (estornado)" : ""}`),
    decimal(item.quantity),
    text(item.unit),
    text(item.lotCode),
    item.note ? text(item.note) : unknown(unknownReasons.notApplicable),
  ]);
  const movesSheet: DataSheet = {
    name: MOVES,
    columns: [
      { key: "at", label: "Data e hora", type: "datetime" },
      { key: "item", label: "Item", type: "text", width: 28 },
      { key: "type", label: "Tipo", type: "text", width: 24 },
      { key: "quantity", label: "Quantidade", type: "decimal" },
      { key: "unit", label: "Unidade", type: "text", width: 10 },
      { key: "lot", label: "Lote", type: "text", width: 12 },
      { key: "reason", label: "Motivo", type: "text", width: 24 },
    ],
    rows: moveRows,
    truncated: history.truncated ?? (source.movements.totalMovements > history.rows.length ? { shown: history.rows.length, total: source.movements.totalMovements } : null),
  };

  // Agregado: posição por situação (calculado das próprias linhas; o documento não traz essa tabela).
  const placeholder = unknown(unknownReasons.noData);
  const situations = ["Normal", "Abaixo do mínimo", "Sem estoque"];
  const aggregate: AggregateSpec = {
    title: "Posição por situação",
    keyLabel: "Situação",
    metrics: hideCost
      ? [{ label: "Itens", type: "int" }, { label: "Participação", type: "percent", share: 0 }]
      : [{ label: "Itens", type: "int" }, { label: "Valor em estoque", type: "money" }, { label: "Participação", type: "percent", share: 0 }],
    rows: situations.map((situation) => {
      const matching = source.position.items.filter((item) => stockSituationLabels[item.situation] === situation);
      const known = matching.filter((item) => item.valueCents !== null);
      const key = [isKey("situation", situation)];
      return hideCost
        ? { key: situation, cells: [int(matching.length), placeholder], exprs: [count(ITEMS, "name", key), null] }
        : { key: situation, cells: [int(matching.length), known.length > 0 ? money(known.reduce((acc, item) => acc + (item.valueCents ?? 0), 0)) : unknown(unknownReasons.noCost), placeholder], exprs: [count(ITEMS, "name", key), sum(ITEMS, "value", key), null] };
    }),
  };

  return baseSpec(doc, {
    kpiGroups: kpiGroupsOf(
      doc,
      {
        items: count(ITEMS, "name"),
        belowMinimum: count(ITEMS, "name", [is("situation", "Abaixo do mínimo")]),
        outOfStock: count(ITEMS, "name", [is("situation", "Sem estoque")]),
        ...(hideCost ? {} : { stockValue: sum(ITEMS, "value") }),
        movements: count(MOVES, "at"),
      },
      { "position-kpis": "Posição atual", "movements-kpis": "Movimentações no período" },
    ),
    aggregate: source.position.items.length > 0 ? aggregate : null,
    sheets: [itemsSheet, movesSheet],
    notes: [
      "Posição atual (hoje), não a do fim do período. Sem texto livre: o motivo mostra só rótulos padronizados.",
      ...(hideCost ? ["Custo unitário e valor em estoque não são exibidos para o seu perfil."] : ["Células vazias: item sem custo cadastrado ou sem lote com saldo."]),
    ],
  });
}
