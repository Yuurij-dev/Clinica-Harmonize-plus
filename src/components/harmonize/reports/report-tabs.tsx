"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ReportDocument } from "@/lib/reports-document";
import { documentKey } from "@/lib/reports-center-rules";
import { limitationText, formatMoneyBr, formatNumberPtBr, formatPctBr, reportKey, type ReportFilters } from "@/lib/reports-ui-rules";
import { useFinanceResource } from "../finance-shared";
import { BarsChart, Note, ReportPanel, ReportTable, StatTile, TrendChart, chartColor, donutColors } from "./report-parts";
import { ReportDocumentView } from "./report-document-view";
import type { ClientsData, FinanceData, ProceduresData, ProfessionalsData, QuotesData, ReportTabId } from "./report-types";

const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : formatMoneyBr(cents));
const count = (value: number) => formatNumberPtBr(value, 0);
const rate = (value: number | null | undefined) => (value === null || value === undefined ? "—" : formatPctBr(value));
const approvedColor = "#16a870";
const expenseColor = "#f5a524";

// Só os parâmetros que a aba usa entram na chave: trocar a granularidade não refaz Procedimentos, por exemplo.
const keyFor = (path: string, filters: ReportFilters, uses: { compare?: boolean; granularity?: boolean }) =>
  reportKey(path, { ...filters, compare: Boolean(uses.compare) && filters.compare, granularity: uses.granularity ? filters.granularity : null });

type TabProps = { filters: ReportFilters };

// ---------- Procedimentos ----------

function ProceduresTab({ filters }: TabProps) {
  const resource = useFinanceResource<ProceduresData>(keyFor("/api/reports/procedures", filters, {}));
  const [showAll, setShowAll] = useState(false);
  return (
    <ReportPanel resource={resource} isEmpty={(data) => data.rows.length === 0} emptyTitle="Nenhum procedimento realizado no período" emptyDescription="Atendimentos concluídos aparecem aqui.">
      {(data) => {
        const rows = showAll ? data.rows : data.rows.slice(0, 10);
        return (
          <div className="space-y-4">
            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <ReportTable
                  caption="Procedimentos realizados no período, com quantidade, valor de tabela e participação"
                  minWidth={760}
                  columns={[{ header: "#" }, { header: "Procedimento" }, { header: "Qtde", align: "right" }, { header: "Valor de tabela", align: "right" }, { header: "% do total" }, { header: "Custo de material", align: "right" }, { header: "Margem de contribuição", align: "right" }]}
                  rows={rows.map((row, index) => ({
                    key: row.name,
                    cells: [
                      index + 1,
                      <span key="n" className="font-semibold text-foreground">{row.name}</span>,
                      count(row.executions),
                      row.matched ? money(row.tableValueCents) : <span key="v" title="Sem procedimento cadastrado com este nome: sem valor de tabela">—</span>,
                      row.tableSharePct === null ? "—" : <div key="s" className="flex min-w-28 items-center gap-2"><Progress value={row.tableSharePct} className="h-1.5 flex-1" aria-label={`${row.name}: ${formatPctBr(row.tableSharePct)} do valor de tabela`} /><span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatPctBr(row.tableSharePct)}</span></div>,
                      row.materialCostCents === null ? <span key="c" title={row.materialCostReason === "restricted" ? "Restrito ao seu perfil" : row.materialCostReason === "item_without_cost" ? "Sem custo cadastrado em itens da ficha técnica" : "Sem ficha técnica"}>—</span> : money(row.materialCostCents),
                      row.marginCents === null ? <span key="m" title={row.materialCostReason === "restricted" ? "Restrito ao seu perfil" : row.materialCostReason === "item_without_cost" ? "Sem custo cadastrado em itens da ficha técnica" : "Sem ficha técnica"}>—</span> : money(row.marginCents),
                    ],
                  }))}
                />
                {data.rows.length > 10 ? <Button className="mt-2" size="sm" variant="ghost" onClick={() => setShowAll((current) => !current)}>{showAll ? "Mostrar só os 10 primeiros" : `Mostrar todos os ${data.rows.length} procedimentos do período`}</Button> : null}
              </div>
              <Card className="p-4">
                <p className="text-sm font-bold text-foreground">Distribuição por valor de tabela</p>
                {data.distribution.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhum procedimento com valor de tabela cadastrado no período.</p> : (
                  <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
                    <div className="relative h-44 w-44 shrink-0" aria-hidden>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={data.distribution} dataKey="valueCents" nameKey="name" innerRadius={56} outerRadius={80} paddingAngle={data.distribution.length > 1 ? 2 : 0} stroke="none">
                            {data.distribution.map((item, index) => <Cell key={item.name} fill={donutColors[index % donutColors.length]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                        <div><p className="text-[10px] font-semibold text-muted-foreground">Valor de tabela</p><p className="text-sm font-black text-foreground">{formatMoneyBr(data.totalCents)}</p></div>
                      </div>
                    </div>
                    <ul className="min-w-0 flex-1 space-y-1.5 self-stretch text-xs">
                      {data.distribution.map((item, index) => (
                        <li key={item.name} className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: donutColors[index % donutColors.length] }} aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-semibold text-foreground" title={item.name}>{item.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{formatPctBr(item.pct)} · {formatMoneyBr(item.valueCents)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <Note>{count(data.totalExecutions)} execuções no período · valor de tabela total {data.tableTotalCents === null ? <span title="Nenhum procedimento do período tem preço cadastrado">— (sem preço cadastrado)</span> : formatMoneyBr(data.tableTotalCents)}{data.tableTotalCents !== null && data.pricedExecutions < data.totalExecutions ? " (parcial: há execuções sem preço cadastrado)" : ""}. {data.valueLabel}.</Note>
                <Note>{limitationText(data.limitation)} Custo de material e margem só aparecem para procedimentos com ficha técnica (custo atual do item).</Note>
              </div>
              <Button asChild size="sm" variant="ghost" className="text-primary"><Link href="/procedimentos">Ver todos os procedimentos<ArrowRight className="h-3.5 w-3.5" /></Link></Button>
            </div>
          </div>
        );
      }}
    </ReportPanel>
  );
}

// ---------- Profissionais ----------

function ProfessionalsTab({ filters }: TabProps) {
  const resource = useFinanceResource<ProfessionalsData>(keyFor("/api/reports/professionals", filters, {}));
  return (
    <ReportPanel resource={resource} isEmpty={(data) => data.rows.length === 0} emptyTitle="Nenhum atendimento no período" emptyDescription="Atendimentos realizados, cancelados e faltas aparecem aqui.">
      {(data) => (
        <div className="space-y-3">
          <ReportTable
            caption="Desempenho por profissional no período"
            minWidth={780}
            columns={[{ header: "Profissional" }, { header: "Realizados", align: "right" }, { header: "Pacientes", align: "right" }, { header: "Cancelados", align: "right" }, { header: "Faltas", align: "right" }, { header: "Cancelamento", align: "right" }, { header: "Produção de tabela", align: "right" }, { header: "Ticket de tabela", align: "right" }]}
            rows={data.rows.map((row) => ({
              key: row.name,
              cells: [<span key="n" className="font-semibold text-foreground">{row.name}</span>, count(row.done), count(row.patients), count(row.cancelled), count(row.missed), rate(row.cancellationRatePct), money(row.tableValueCents), money(row.tableTicketCents)],
            }))}
          />
          <Note>{data.cancellationRateNote} Produção e ticket são valor de tabela (não é receita recebida).</Note>
          <Note>{limitationText(data.limitation)}</Note>
        </div>
      )}
    </ReportPanel>
  );
}

// ---------- Clientes ----------

function ClientsTab({ filters }: TabProps) {
  const resource = useFinanceResource<ClientsData>(keyFor("/api/reports/clients", filters, { compare: true, granularity: true }));
  return (
    <ReportPanel resource={resource} emptyTitle="Sem dados" emptyDescription="Sem dados de clientes no período.">
      {(data) => {
        const { stats, previous } = data;
        const showChange = previous !== null;
        return (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatTile label="Novos pacientes" value={count(stats.newPatients)} showChange={showChange} change={previous?.newPatientsChangePct} />
              <StatTile label="Pacientes atendidos" value={count(stats.attendedPatients)} note="Com atendimento realizado no período." />
              <StatTile label="Pacientes recorrentes" value={count(stats.recurring)} note="2 ou mais atendimentos realizados no total e ao menos 1 no período." />
              <StatTile label="Pacientes inativos" value={count(stats.inactive)} note={`Já atendidos e sem atendimento realizado há ${stats.inactiveDays} dias ou mais.`} />
              <StatTile label="Frequência média" value={stats.averageFrequency === null ? "—" : formatNumberPtBr(stats.averageFrequency, 1)} note="Atendimentos realizados por paciente atendido." />
              <StatTile label="Taxa de retorno" value={rate(stats.returnRate.value)} showChange={showChange} change={previous?.returnRateChangePp} changeKind="pp" note="Atendidos no período que já tinham atendimento antes." />
            </div>
            {data.baseSeries.points.length > 0 ? (
              <Card>
                <CardHeader><CardTitle className="text-base">Evolução da base de pacientes</CardTitle></CardHeader>
                <CardContent>
                  <TrendChart
                    points={data.baseSeries.points.map((point) => ({ label: point.label, date: point.date, current: point.totalPatients, previous: null }))}
                    unit="count"
                    granularity={data.baseSeries.granularity}
                    compare={false}
                    noun="Pacientes cadastrados"
                    ariaLabel="Gráfico de área com o total acumulado de pacientes cadastrados"
                  />
                  <Note>Pacientes cadastrados acumulados no fim de cada intervalo.</Note>
                </CardContent>
              </Card>
            ) : null}
          </div>
        );
      }}
    </ReportPanel>
  );
}

// ---------- Orçamentos ----------

function QuotesTab({ filters }: TabProps) {
  const resource = useFinanceResource<QuotesData>(keyFor("/api/reports/quotes", filters, { compare: true, granularity: true }));
  return (
    <ReportPanel resource={resource} emptyTitle="Sem dados" emptyDescription="Sem orçamentos no período.">
      {(data) => {
        const { stats, previous, changes } = data;
        const showChange = previous !== null;
        return (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Criados" value={count(stats.created)} />
              <StatTile label="Aprovados" value={count(stats.approved)} />
              <StatTile label="Recusados" value={count(stats.refused)} />
              <StatTile label="Expirados" value={count(stats.expired)} note="Em aberto com validade vencida." />
              <StatTile label="Conversão" value={rate(stats.conversionPct)} showChange={showChange} change={changes?.conversionPp} changeKind="pp" note="Dos criados no período, % hoje aprovado ou pago." />
              <StatTile label="Valor aprovado" value={money(stats.approvedValueCents)} showChange={showChange} change={changes?.approvedValuePct} note="Aprovado não é o mesmo que recebido." />
              <StatTile label="Tempo médio de aprovação" value={stats.averageApprovalDays === null ? "—" : `${formatNumberPtBr(stats.averageApprovalDays, 1)} dias`} note="Do envio (ou criação) até a aprovação." />
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">Orçamentos criados e aprovados</CardTitle></CardHeader>
              <CardContent>
                <BarsChart
                  unit="count"
                  ariaLabel="Gráfico de barras com orçamentos criados e aprovados por período"
                  series={[{ key: "created", label: "Criados", color: chartColor }, { key: "approved", label: "Aprovados", color: approvedColor }]}
                  data={data.series.created.map((point, index) => ({ label: point.label, date: point.date, created: point.value, approved: data.series.approved[index]?.value ?? 0 }))}
                />
              </CardContent>
            </Card>
            {data.professionalNote ? <Note>{data.professionalNote}</Note> : null}
          </div>
        );
      }}
    </ReportPanel>
  );
}

// ---------- Financeiro ----------

function FinanceTab({ filters }: TabProps) {
  const resource = useFinanceResource<FinanceData>(keyFor("/api/reports/finance", filters, { compare: true, granularity: true }));
  return (
    <ReportPanel resource={resource} emptyTitle="Sem dados" emptyDescription="Sem movimentações no período.">
      {(data) => {
        const { summary, changes } = data;
        const showChange = changes !== null;
        const empty = summary.revenueCents === 0 && summary.expensesCents === 0;
        return (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Receita recebida" value={money(summary.revenueCents)} showChange={showChange} change={changes?.revenuePct} note="Pagamentos com status Pago no período." />
              <StatTile label="Despesas pagas" value={money(summary.expensesCents)} showChange={showChange} change={changes?.expensesPct} />
              <StatTile label="Resultado" value={<span className={summary.resultCents < 0 ? "text-destructive" : undefined}>{money(summary.resultCents)}</span>} showChange={showChange} change={changes?.resultPct} note="Receita recebida menos despesas pagas." />
              <StatTile label="Margem" value={rate(summary.marginPct)} showChange={showChange} change={changes?.marginPp} changeKind="pp" note="Resultado ÷ receita recebida." />
            </div>
            {data.limitation ? <Note>O filtro de profissional não se aplica ao financeiro. {limitationText(data.limitation)}</Note> : null}
            {empty ? <Note>Nenhuma receita recebida ou despesa paga no período.</Note> : (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <Card>
                  <CardHeader><CardTitle className="text-base">Receitas e despesas por período</CardTitle></CardHeader>
                  <CardContent>
                    <BarsChart
                      unit="money"
                      ariaLabel="Gráfico de barras com receitas e despesas pagas por período"
                      series={[{ key: "revenue", label: "Receitas", color: chartColor }, { key: "expenses", label: "Despesas", color: expenseColor }]}
                      data={data.series.revenue.map((point, index) => ({ label: point.label, date: point.date, revenue: point.current, expenses: data.series.expenses[index]?.current ?? 0 }))}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Despesas pagas por categoria</CardTitle></CardHeader>
                  <CardContent>
                    {data.expensesByCategory.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma despesa paga no período.</p> : (
                      <ReportTable caption="Despesas pagas por categoria" minWidth={280} columns={[{ header: "Categoria" }, { header: "Valor", align: "right" }]} rows={data.expensesByCategory.map((item) => ({ key: item.category, cells: [item.category, money(item.valueCents)] }))} />
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="secondary"><Link href={data.links.finance}>Abrir Financeiro<ArrowRight className="h-3.5 w-3.5" /></Link></Button>
              <Button asChild size="sm" variant="secondary"><Link href={data.links.payments}>Abrir Pagamentos<ArrowRight className="h-3.5 w-3.5" /></Link></Button>
            </div>
          </div>
        );
      }}
    </ReportPanel>
  );
}

// ---------- Estoque e Agendamentos (documento compartilhado com XLSX/PDF/CSV) ----------

function DocumentTab({ kind, filters }: TabProps & { kind: "stock" | "appointments" }) {
  const resource = useFinanceResource<ReportDocument>(documentKey(kind, filters));
  return (
    <ReportPanel resource={resource} emptyTitle="Sem dados" emptyDescription="Sem dados no período.">
      {(doc) => <ReportDocumentView doc={doc} showMeta={false} />}
    </ReportPanel>
  );
}

export function ReportTabContent({ tab, filters }: { tab: ReportTabId; filters: ReportFilters }) {
  switch (tab) {
    case "procedures": return <ProceduresTab filters={filters} />;
    case "professionals": return <ProfessionalsTab filters={filters} />;
    case "clients": return <ClientsTab filters={filters} />;
    case "quotes": return <QuotesTab filters={filters} />;
    case "finance": return <FinanceTab filters={filters} />;
    case "stock": return <DocumentTab kind="stock" filters={filters} />;
    case "appointments": return <DocumentTab kind="appointments" filters={filters} />;
  }
}
