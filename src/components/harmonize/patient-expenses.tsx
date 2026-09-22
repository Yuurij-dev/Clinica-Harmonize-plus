"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  CirclePlus,
  CreditCard,
  Eye,
  FileDown,
  Info,
  Pencil,
  Save,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const expenseItems = [
  { name: "Preenchimento labial", material: "Ácido hialurônico", defaultQuantity: 1, unitPrice: 1200, options: [[0.5, "0,5 ml"], [1, "1,0 ml"], [1.5, "1,5 ml"], [2, "2,0 ml"]], color: "#356fd6" },
  { name: "Botox", material: "Toxina botulínica", defaultQuantity: 25, unitPrice: 36, options: [[10, "10 un"], [15, "15 un"], [20, "20 un"], [25, "25 un"], [30, "30 un"], [40, "40 un"]], color: "#7655cf" },
  { name: "Bioestimulador de colágeno", material: "Ácido poli-L-láctico", defaultQuantity: 1, unitPrice: 2500, options: [[0.5, "0,5 ml"], [1, "1,0 ml"], [1.5, "1,5 ml"], [2, "2,0 ml"]], color: "#ca4f8d" },
  { name: "Preenchimento de olheiras", material: "Ácido hialurônico", defaultQuantity: 0.5, unitPrice: 1800, options: [[0.3, "0,3 ml"], [0.5, "0,5 ml"], [0.8, "0,8 ml"], [1, "1,0 ml"]], color: "#356fd6" },
  { name: "Fios de sustentação", material: "Fios de PDO", defaultQuantity: 2, unitPrice: 3200, options: [[1, "1 un"], [2, "2 un"], [4, "4 un"], [6, "6 un"]], color: "#2f9b7b" },
  { name: "Toxina botulínica (outra área)", material: "Toxina botulínica", defaultQuantity: 25, unitPrice: 36, options: [[10, "10 un"], [15, "15 un"], [20, "20 un"], [25, "25 un"], [30, "30 un"]], color: "#7655cf" },
];

const extraCosts = [
  ["Mão de obra / Honorários", 1200],
  ["Sala / Estrutura", 300],
  ["Anestésico / Medicamentos", 150],
] as const;

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function PatientExpenses() {
  const [selected, setSelected] = useState(() => new Set([0, 1, 2]));
  const [quantities, setQuantities] = useState(() => expenseItems.map((item) => item.defaultQuantity));
  const [notice, setNotice] = useState<string | null>(null);
  const calculatedItems = expenseItems.map((item, index) => ({
    ...item,
    quantity: quantities[index],
    quantityLabel: item.options.find(([value]) => value === quantities[index])?.[1] ?? String(quantities[index]),
    subtotal: quantities[index] * item.unitPrice,
  }));
  const selectedItems = calculatedItems.filter((_, index) => selected.has(index));
  const materialsSubtotal = selectedItems.reduce((total, item) => total + item.subtotal, 0);
  const extrasSubtotal = extraCosts.reduce((total, [, value]) => total + value, 0);
  const total = materialsSubtotal + extrasSubtotal;

  const materialGroups = selectedItems.slice(0, 4);

  function toggleItem(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    setNotice(null);
  }

  function updateQuantity(index: number, quantity: number) {
    setQuantities((current) => current.map((value, itemIndex) => itemIndex === index ? quantity : value));
    setNotice(null);
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <Card className="overflow-hidden">
          <div className="border-b border-[#ececf2] px-4 py-4">
            <h3 className="text-sm font-bold text-[#27283b]">Calculadora de gastos do procedimento</h3>
            <p className="mt-1 text-[10px] leading-4 text-[#858696]">
              Selecione os procedimentos e a quantidade utilizada para calcular o custo deste atendimento.
            </p>
          </div>

          <div className="overflow-x-auto p-3">
            <div className="min-w-[720px] overflow-hidden rounded-[6px] border border-[#e9e9ef]">
              <div className="grid grid-cols-[1.55fr_0.72fr_0.68fr_0.68fr] bg-[#fafafd] px-3 py-2.5 text-[9px] font-bold text-[#77798d]">
                <span>Procedimento / Material</span><span>Qtd. / ml</span><span>Valor unitário</span><span>Subtotal</span>
              </div>
              {calculatedItems.map((item, index) => {
                const checked = selected.has(index);
                return (
                  <div className="grid min-h-14 grid-cols-[1.55fr_0.72fr_0.68fr_0.68fr] items-center border-t border-[#eeeeF3] px-3 text-[10px]" key={item.name}>
                    <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => toggleItem(index)}>
                      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border", checked ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#cfd0da] bg-white text-transparent")}>
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-[#3f4053]">{item.name}</strong>
                        <span className="mt-0.5 block truncate text-[8px] text-[#999aaa]">{item.material}</span>
                      </span>
                    </button>
                    <label className="relative block w-[94px]">
                      <select
                        aria-label={`Quantidade de ${item.name}`}
                        className="h-8 w-full appearance-none rounded-[5px] border border-[#dddde6] bg-white px-2 pr-7 text-[10px] font-semibold text-[#555668] outline-none transition focus:border-[#5147dc] focus:ring-2 focus:ring-[#5147dc]/10"
                        value={item.quantity}
                        onChange={(event) => updateQuantity(index, Number(event.target.value))}
                      >
                        {item.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3 w-3 text-[#77788a]" />
                    </label>
                    <span className="font-semibold text-[#555668]">{currency.format(item.unitPrice)}</span>
                    <span className={cn("font-bold", checked ? "text-[#353648]" : "text-[#a2a3b0]")}>{currency.format(item.subtotal)}</span>
                  </div>
                );
              })}
              <div className="border-t border-[#eeeeF3] p-3">
                <Button variant="secondary" size="sm"><CirclePlus className="h-3.5 w-3.5" />Adicionar procedimento / material</Button>
              </div>
            </div>
          </div>

          <div className="border-t border-[#ececf2] bg-[#fbfbfd] px-4 py-4">
            <p className="mb-3 text-[9px] font-bold uppercase text-[#8c8d9d]">Resumo dos materiais</p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {materialGroups.map((item) => (
                <div className="flex items-center gap-2 rounded-[6px] border border-[#e8e8ef] bg-white p-2.5" key={item.name}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ backgroundColor: item.color }}><WalletCards className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0">
                    <strong className="block truncate text-[9px] text-[#4b4c5f]">{item.material}</strong>
                    <span className="block text-[8px] text-[#999aaa]">{item.quantityLabel}</span>
                    <span className="mt-0.5 block text-[9px] font-bold text-[#353648]">{currency.format(item.subtotal)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-[#ececf2] px-4 py-3">
            <h3 className="text-xs font-bold text-[#303144]">Histórico de gastos deste atendimento</h3>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[660px] grid-cols-[0.65fr_1.3fr_0.7fr_0.65fr_32px] bg-[#fafafd] px-4 py-2 text-[8px] font-bold uppercase text-[#9697a6]">
              <span>Data</span><span>Procedimento / Material</span><span>Qtd. / ml</span><span>Valor</span><span />
            </div>
            {selectedItems.slice(0, 3).map((item) => (
              <div className="grid min-w-[660px] grid-cols-[0.65fr_1.3fr_0.7fr_0.65fr_32px] items-center border-t border-[#eeeeF3] px-4 py-3 text-[10px] text-[#5d5e70]" key={item.name}>
                <span>17/09/2026</span><strong>{item.name}</strong><span>{item.quantityLabel}</span><span>{currency.format(item.subtotal)}</span><Eye className="h-3.5 w-3.5 text-[#5147dc]" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-24">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[#292a3d]">Resumo do orçamento</h3>
            <Button variant="secondary" size="sm"><Pencil className="h-3.5 w-3.5" />Editar</Button>
          </div>

          <div className="mt-4 space-y-2.5">
            {selectedItems.map((item) => (
              <div className="flex justify-between gap-3 text-[10px]" key={item.name}>
                <span className="text-[#5f6072]">{item.name} ({item.quantityLabel})</span>
                <strong className="whitespace-nowrap text-[#424355]">{currency.format(item.subtotal)}</strong>
              </div>
            ))}
          </div>

          <SummaryLine className="mt-4 border-t pt-3" label="Subtotal dos materiais" value={currency.format(materialsSubtotal)} />
          <p className="mt-4 text-[10px] font-bold text-[#4a4b5d]">Outros custos</p>
          <div className="mt-2 space-y-2">
            {extraCosts.map(([label, value]) => <SummaryLine key={label} label={label} value={currency.format(value)} />)}
          </div>
          <SummaryLine className="mt-4 border-t pt-3" label="Subtotal geral" value={currency.format(total)} strong />

          <div className="mt-3 flex items-center gap-3 rounded-[7px] bg-[#5147dc] p-3 text-white shadow-[0_10px_24px_rgba(81,71,220,0.2)]">
            <span className="grid h-9 w-9 place-items-center rounded-[6px] bg-white/15"><WalletCards className="h-4 w-4" /></span>
            <div><p className="text-[9px] text-white/75">Total do atendimento</p><p className="text-lg font-bold">{currency.format(total)}</p></div>
          </div>

          <div className="mt-4">
            <p className="text-[9px] font-bold uppercase text-[#8f90a0]">Forma de pagamento</p>
            <button className="mt-2 flex h-10 w-full items-center justify-between rounded-[6px] border border-[#dfdfe7] px-3 text-xs font-semibold text-[#505164]">
              <span className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-[#5147dc]" />Cartão de crédito</span><ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase text-[#8f90a0]">Status do pagamento</span>
            <Badge variant="amber">Pendente</Badge>
          </div>

          <div className="mt-4 space-y-2">
            <Button className="w-full" onClick={() => setNotice("Orçamento salvo como rascunho.")}><Save className="h-4 w-4" />Salvar orçamento</Button>
            <Button className="w-full" variant="secondary" onClick={() => setNotice("Documento preparado para geração em PDF.")}><FileDown className="h-4 w-4" />Gerar PDF</Button>
          </div>
          {notice ? <p className="mt-3 rounded-[6px] bg-[#eef8f2] px-3 py-2 text-[10px] font-semibold text-[#287a50]">{notice}</p> : null}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between"><p className="flex items-center gap-2 text-xs font-bold text-[#454659]"><Info className="h-3.5 w-3.5 text-[#5147dc]" />Observações</p><Pencil className="h-3.5 w-3.5 text-[#8c8d9d]" /></div>
          <p className="mt-3 text-[10px] leading-5 text-[#727386]">Cliente realizou preenchimento labial e botox. Retorno agendado para 15/10/2026.</p>
        </Card>
      </aside>
    </div>
  );
}

function SummaryLine({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return <div className={cn("flex items-center justify-between gap-3 border-[#ececf2] text-[10px]", className, strong && "text-xs")}><span className={strong ? "font-bold text-[#393a4d]" : "text-[#68697b]"}>{label}</span><strong className="whitespace-nowrap text-[#3e3f52]">{value}</strong></div>;
}
