"use client";

import { Calculator, ReceiptText } from "lucide-react";
import type { Product } from "@/types/clinic";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function CostCalculator({ materials, charged = 0, patientName = "Atendimento", procedureName = "Procedimento" }: { materials: Product[]; charged?: number; patientName?: string; procedureName?: string }) {
  const totalCost = materials.reduce((sum, material) => sum + material.costCents, 0) / 100;
  const grossResult = charged - totalCost;
  const margin = (grossResult / charged) * 100;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-[#071338] text-white">
        <div>
          <Badge className="mb-3 bg-white/10 text-white">Calculadora de custo</Badge>
          <CardTitle className="text-white">Atendimento de {patientName}</CardTitle>
          <p className="mt-1 text-sm text-[#c6d1f5]">
            Procedimento: {procedureName}
          </p>
        </div>
        <Calculator className="h-6 w-6 text-[#9fb1ff]" />
      </CardHeader>
      <CardContent className="pt-5">
        <div className="space-y-3">
          {materials.map((material) => {
            const subtotal = material.costCents / 100;

            return (
              <div
                className="rounded-[8px] border border-[#e5e9f4] p-4"
                key={material.name}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-black text-[#121733]">{material.name}</p>
                    <p className="text-sm text-[#65708b]">
                      1 {material.unit} × {currency.format(subtotal)}
                    </p>
                  </div>
                  <strong className="text-[#1438ff]">{currency.format(subtotal)}</strong>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Metric label="Custo dos materiais" value={currency.format(totalCost)} />
          <Metric label="Valor cobrado" value={currency.format(charged)} />
          <Metric label="Resultado bruto" value={currency.format(grossResult)} positive />
          <Metric label="Margem" value={`${margin.toFixed(2).replace(".", ",")}%`} positive />
        </div>

        <div className="mt-5 rounded-[8px] bg-[#eaf8ef] p-4">
          <div className="flex gap-3">
            <ReceiptText className="mt-0.5 h-5 w-5 text-[#157a3b]" />
            <p className="text-sm leading-6 text-[#23613a]">
              Fórmula aplicada: quantidade utilizada × custo unitário. O estoque
              não é movimentado neste MVP.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-[8px] bg-[#f7f9fd] p-4">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-[#7c86a2]">
        {label}
      </p>
      <p className={positive ? "mt-2 text-xl font-black text-[#157a3b]" : "mt-2 text-xl font-black text-[#121733]"}>
        {value}
      </p>
    </div>
  );
}
