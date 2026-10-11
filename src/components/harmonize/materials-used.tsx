"use client";

import { Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { attendanceKindLabels, formatQuantity, type AttendanceKind } from "@/lib/stock-rules";
import { formatDateOnly } from "./stock-shared";

export type MaterialUsed = {
  id: string;
  appointmentId: string | null;
  name: string;
  unit: string;
  quantity: number;
  lotCode: string | null;
  lotExpiresOn: string | null;
  kind: AttendanceKind | null;
  attendanceName: string | null;
  date: string | null;
  status: "used" | "reversed" | "pending";
};

function attendanceLabel(item: MaterialUsed) {
  const parts = [item.kind ? attendanceKindLabels[item.kind] : null, item.attendanceName, item.date ? new Date(item.date).toLocaleDateString("pt-BR") : null].filter(Boolean);
  return parts.join(" · ");
}

// Materiais usados no paciente: quantidade, lote, validade e o atendimento em que foram usados.
export function MaterialsUsedList({ items, title = "Materiais usados", showAttendance = true }: { items: MaterialUsed[]; title?: string; showAttendance?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="rounded-[7px] border border-[#ececf3] bg-[#fbfbfe] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase text-[#858696]"><Package className="h-3.5 w-3.5" />{title}</p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li className={`text-xs ${item.status === "reversed" ? "text-muted-foreground line-through" : "text-[#3f4053]"}`} key={item.id}>
            <strong>{formatQuantity(item.quantity, item.unit)} {item.name}</strong>
            {item.lotCode ? <span>{` · lote ${item.lotCode}`}{item.lotExpiresOn ? `, val. ${formatDateOnly(item.lotExpiresOn).slice(3)}` : ""}</span> : null}
            {showAttendance ? <span className="text-[#858696]">{` · em ${attendanceLabel(item)}`}</span> : null}
            {item.status === "reversed" ? <Badge className="ml-2 no-underline" variant="slate">Estornado</Badge> : null}
            {item.status === "pending" ? <Badge className="ml-2" variant="amber">Saída pendente</Badge> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
