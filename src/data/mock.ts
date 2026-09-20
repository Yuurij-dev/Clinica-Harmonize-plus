import {
  BarChart3,
  CalendarDays,
  CreditCard,
  FileText,
  LayoutDashboard,
  Settings,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react";
import type {
  Appointment,
  NavItem,
  Patient,
  Payment,
  Procedure,
  Product,
  Quote,
} from "@/types/clinic";

export const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "procedimentos", label: "Procedimentos", icon: Sparkles },
  { id: "orcamentos", label: "Orçamentos", icon: FileText },
  { id: "pagamentos", label: "Pagamentos", icon: CreditCard },
  { id: "financeiro", label: "Financeiro", icon: WalletCards },
  { id: "relatorios", label: "Relatórios", icon: BarChart3 },
  { id: "configuracoes", label: "Configurações", icon: Settings },
];

export const stats = [
  { label: "Receita", value: "R$ 18.450", detail: "+12% vs. mês anterior" },
  { label: "Despesas", value: "R$ 5.200", detail: "Materiais e despesas" },
  { label: "Resultado", value: "R$ 13.250", detail: "Margem média 71,8%" },
  { label: "Atendimentos", value: "23", detail: "6 confirmados hoje" },
  { label: "Retornos", value: "8", detail: "Próximos 7 dias" },
  { label: "Orçamentos", value: "17", detail: "R$ 42.800 em aberto" },
];

export const patients: Patient[] = [
  {
    name: "Maria Silva",
    phone: "(11) 98842-2210",
    status: "Ativa",
    lastVisit: "18 set. 2026",
    nextReturn: "25 set. 2026",
    value: "R$ 1.500",
  },
  {
    name: "Amanda Carvalho",
    phone: "(21) 99714-8831",
    status: "Retorno",
    lastVisit: "16 set. 2026",
    nextReturn: "22 set. 2026",
    value: "R$ 2.100",
  },
  {
    name: "Beatriz Almeida",
    phone: "(31) 98440-7712",
    status: "Orçamento",
    lastVisit: "12 set. 2026",
    nextReturn: "A definir",
    value: "R$ 4.600",
  },
  {
    name: "Rafael Costa",
    phone: "(41) 99908-4420",
    status: "Pendente",
    lastVisit: "09 set. 2026",
    nextReturn: "24 set. 2026",
    value: "R$ 900",
  },
];

export const appointments: Appointment[] = [
  {
    time: "08:00",
    patient: "Maria Silva",
    procedure: "Harmonização facial",
    professional: "Dra. Ana",
    status: "Confirmado",
  },
  {
    time: "09:30",
    patient: "Luís Carlos da Silva",
    procedure: "Preenchimento labial",
    professional: "Dra. Ana",
    status: "Agendado",
  },
  {
    time: "11:00",
    patient: "Thiago Monteiro",
    procedure: "Botox",
    professional: "Dra. Michelle",
    status: "Em atendimento",
  },
  {
    time: "13:30",
    patient: "Beatriz Almeida",
    procedure: "Bioestimulador",
    professional: "Dra. Carla",
    status: "Atendido",
  },
  {
    time: "16:00",
    patient: "Rafael Costa",
    procedure: "Rinomodelação",
    professional: "Dr. Joel",
    status: "Faltou",
  },
  {
    time: "18:00",
    patient: "Amanda Carvalho",
    procedure: "Consulta de retorno",
    professional: "Dra. Ana",
    status: "Agendado",
  },
];

export const products: Product[] = [
  {
    name: "Ácido hialurônico",
    category: "Preenchedores",
    unit: "ml",
    cost: 180,
    supplier: "Derma Supply",
  },
  {
    name: "Toxina botulínica",
    category: "Injetáveis",
    unit: "unidade",
    cost: 8,
    supplier: "Bio Estética",
  },
  {
    name: "Anestésico tópico",
    category: "Apoio clínico",
    unit: "unidade",
    cost: 15,
    supplier: "Clin Med",
  },
  {
    name: "Fio de sustentação",
    category: "Fios",
    unit: "unidade",
    cost: 95,
    supplier: "Lift Pro",
  },
];

export const procedures: Procedure[] = [
  {
    name: "Preenchimento labial",
    category: "Preenchimento",
    price: 1200,
    duration: "50 min",
    materials: "Ácido hialurônico, anestésico",
    margin: "78%",
  },
  {
    name: "Botox",
    category: "Toxina",
    price: 900,
    duration: "40 min",
    materials: "Toxina botulínica",
    margin: "72%",
  },
  {
    name: "Bioestimulador",
    category: "Bioestimulação",
    price: 2500,
    duration: "70 min",
    materials: "Bioestimulador, anestésico",
    margin: "69%",
  },
  {
    name: "Rinomodelação",
    category: "Preenchimento",
    price: 1500,
    duration: "60 min",
    materials: "Ácido hialurônico",
    margin: "74%",
  },
];

export const quotes: Quote[] = [
  {
    patient: "Beatriz Almeida",
    items: "Preenchimento labial, Botox, Bioestimulador",
    total: "R$ 4.600",
    status: "Enviado",
    expires: "24 set. 2026",
  },
  {
    patient: "Camila Rocha",
    items: "Rinomodelação, Preenchimento de olheiras",
    total: "R$ 2.850",
    status: "Pendente",
    expires: "28 set. 2026",
  },
  {
    patient: "Amanda Carvalho",
    items: "Fios de sustentação",
    total: "R$ 3.200",
    status: "Aprovado",
    expires: "30 set. 2026",
  },
];

export const payments: Payment[] = [
  {
    patient: "Maria Silva",
    value: "R$ 1.500",
    method: "Pix",
    date: "20 set. 2026",
    status: "Pago",
    installments: "À vista",
  },
  {
    patient: "Amanda Carvalho",
    value: "R$ 2.100",
    method: "Cartão de crédito",
    date: "19 set. 2026",
    status: "Parcial",
    installments: "2 de 3",
  },
  {
    patient: "Rafael Costa",
    value: "R$ 900",
    method: "Transferência",
    date: "22 set. 2026",
    status: "Pendente",
    installments: "À vista",
  },
];

export const reportItems = [
  { label: "Receita por período", value: "R$ 62.900" },
  { label: "Resultado por período", value: "R$ 44.120" },
  { label: "Procedimento mais realizado", value: "Botox" },
  { label: "Maior margem", value: "Preenchimento labial" },
  { label: "Pagamentos pendentes", value: "R$ 8.740" },
];

export const revenueBars = [52, 68, 46, 82, 74, 95, 88, 100, 78, 91, 86, 104];

export const financialByProcedure = [
  { name: "Preenchimento labial", revenue: "R$ 6.000", cost: "R$ 1.200", result: "R$ 4.800" },
  { name: "Botox", revenue: "R$ 4.500", cost: "R$ 1.100", result: "R$ 3.400" },
  { name: "Bioestimulador", revenue: "R$ 7.500", cost: "R$ 2.350", result: "R$ 5.150" },
];

export const costMaterials = [
  { name: "Ácido hialurônico", qty: 1.2, unit: "ml", unitCost: 180 },
  { name: "Toxina botulínica", qty: 25, unit: "unidades", unitCost: 8 },
  { name: "Anestésico tópico", qty: 1, unit: "unidade", unitCost: 15 },
];
