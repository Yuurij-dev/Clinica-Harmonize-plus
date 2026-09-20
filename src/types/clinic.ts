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
  status: string;
  lastVisit: string;
  nextReturn: string;
  value: string;
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
