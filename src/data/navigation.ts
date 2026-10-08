import {
  BarChart3,
  Calculator,
  CalendarDays,
  CreditCard,
  FileText,
  LayoutDashboard,
  Settings,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react";
import type { NavItem } from "@/types/clinic";

export const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "procedimentos", label: "Procedimentos", icon: Sparkles },
  { id: "orcamentos", label: "Orçamentos", icon: FileText },
  { id: "pagamentos", label: "Pagamentos", icon: CreditCard },
  { id: "financeiro", label: "Financeiro", icon: WalletCards },
  { id: "relatorios", label: "Relatórios", icon: BarChart3 },
  { id: "calculadora", label: "Calculadora", icon: Calculator },
  { id: "configuracoes", label: "Configurações", icon: Settings },
];
