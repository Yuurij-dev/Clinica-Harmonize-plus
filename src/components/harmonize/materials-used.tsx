import type { AttendanceKind, StockKind } from "@/lib/stock-rules";

// Material usado no paciente: quantidade, lote, validade e o atendimento em que foi usado.
export type MaterialUsed = {
  id: string;
  appointmentId: string | null;
  name: string;
  productKind: StockKind;
  unit: string;
  quantity: number;
  lotCode: string | null;
  lotExpiresOn: string | null;
  kind: AttendanceKind | null;
  attendanceName: string | null;
  date: string | null;
  status: "used" | "reversed" | "pending";
};
