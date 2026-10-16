"use client";

import { Calculator, ChevronDown, ChevronUp, ReceiptText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Product } from "@/types/clinic";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function CostCalculator({ materials, charged = 0, procedureName = "Procedimento" }: { materials: Product[]; charged?: number; procedureName?: string }) {
  const [showAllMaterials, setShowAllMaterials] = useState(false);
  const materialsSectionRef = useRef<HTMLDivElement>(null);
  const firstMaterialRef = useRef<HTMLDivElement>(null);
  const shouldScrollMaterials = useRef(false);
  const totalCost = materials.reduce((sum, material) => sum + material.costCents, 0) / 100;
  const grossResult = charged - totalCost;
  const margin = (grossResult / charged) * 100;

  useEffect(() => {
    if (!shouldScrollMaterials.current) return;
    shouldScrollMaterials.current = false;
    (showAllMaterials ? materialsSectionRef.current : firstMaterialRef.current)?.scrollIntoView({ behavior: "smooth", block: showAllMaterials ? "end" : "start" });
  }, [showAllMaterials]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-[#071338] text-white">
        <div>
          <Badge className="mb-3 bg-white/10 text-white">Calculadora de custos</Badge>
          <CardTitle className="text-white">Análise de custos do procedimento</CardTitle>
          <p className="mt-1 text-sm text-[#c6d1f5]">
            Procedimento: {procedureName}
          </p>
        </div>
        <Calculator className="h-6 w-6 text-[#9fb1ff]" />
      </CardHeader>
      <CardContent className="pt-5">
        <div ref={materialsSectionRef}>
          <div className="relative space-y-3">
            {materials.slice(0, showAllMaterials ? undefined : 4).map((material, index) => {
              const subtotal = material.costCents / 100;

              return (
                <div
                  className={`rounded-[8px] border border-[#e5e9f4] p-4 ${!showAllMaterials && index === 3 ? "max-h-14 overflow-hidden" : ""}`}
                  key={material.name}
                  ref={index === 0 ? firstMaterialRef : undefined}
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
            {!showAllMaterials && materials.length > 3 ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-[8px] bg-gradient-to-b from-white/0 via-white/55 to-white/95 backdrop-blur-[1px]" /> : null}
          </div>
          {materials.length > 3 ? <button
            type="button"
            aria-expanded={showAllMaterials}
            className="mx-auto mt-3 flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-black uppercase tracking-[0.08em] text-[#5147dc] transition-colors hover:bg-[#f3f1ff] hover:text-[#3f35c4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5147dc]"
            onClick={() => {
              shouldScrollMaterials.current = true;
              setShowAllMaterials((expanded) => !expanded);
            }}
          >
            {showAllMaterials ? "Mostrar menos" : "Mostrar mais"}
            {showAllMaterials ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button> : null}
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
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
