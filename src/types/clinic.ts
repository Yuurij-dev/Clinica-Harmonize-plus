import type { LucideIcon } from "lucide-react";

export type SectionId =
  | "dashboard"
  | "agenda"
  | "clientes"
  | "procedimentos"
  | "orcamentos"
  | "pagamentos"
  | "financeiro"
  | "relatorios"
  | "configuracoes";

export type NavItem = {
  id: SectionId;
  label: string;
  icon: LucideIcon;
};

export type Patient = {
  name: string;
  phone: string;
  age: number;
  status: string;
  lastVisit: string;
  nextReturn: string;
  value: string;
};

export type JourneyStageId =
  | "lead"
  | "evaluation"
  | "quote"
  | "procedure"
  | "return"
  | "aftercare";

export type JourneyStageStatus =
  | "completed"
  | "current"
  | "pending"
  | "cancelled";

export type JourneyDetail = {
  label: string;
  value: string | string[];
  tone?: "default" | "positive" | "warning";
};

export type CustomerJourneyStage = {
  id: JourneyStageId;
  label: string;
  status: JourneyStageStatus;
  date: string | null;
  details: JourneyDetail[];
  actionLabel?: string;
};

export type PatientJourneyEvents = {
  leadAt: string;
  evaluationCompletedAt?: string;
  quoteApprovedAt?: string;
  procedureCompletedAt?: string;
  returnCompletedAt?: string;
  aftercareCompletedAt?: string;
  scheduledProcedureAt?: string;
  scheduledReturnAt?: string;
  cancelledStages?: JourneyStageId[];
};

export type PatientJourneyRecord = {
  events: PatientJourneyEvents;
  details: Partial<Record<JourneyStageId, JourneyDetail[]>>;
};

export type Appointment = {
  time: string;
  patient: string;
  procedure: string;
  professional: string;
  status: string;
};

export type Product = {
  name: string;
  category: string;
  unit: string;
  cost: number;
  supplier: string;
};

export type Procedure = {
  name: string;
  category: string;
  price: number;
  duration: string;
  materials: string;
  margin: string;
};

export type Quote = {
  patient: string;
  items: string;
  total: string;
  status: string;
  expires: string;
};

export type Payment = {
  patient: string;
  value: string;
  method: string;
  date: string;
  status: string;
  installments: string;
};
