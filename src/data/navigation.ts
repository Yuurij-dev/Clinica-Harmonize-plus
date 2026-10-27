import {
  BarChart3,
  CalendarDays,
  CreditCard,
  FileText,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
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
  { id: "estoque", label: "Estoque", icon: Package },
  { id: "compras", label: "Compras", icon: ShoppingCart },
  { id: "orcamentos", label: "Orçamentos", icon: FileText },
  { id: "pagamentos", label: "Pagamentos", icon: CreditCard },
  { id: "financeiro", label: "Financeiro", icon: WalletCards },
  { id: "relatorios", label: "Relatórios", icon: BarChart3 },
  { id: "configuracoes", label: "Configurações", icon: Settings },
];
