// Planos do Harmonize+ — DADOS MOCKADOS. Ainda não existe sistema de planos/assinaturas: nomes, preços e benefícios
// abaixo são provisórios e ficam só aqui. Para ligar os planos reais, troque esta lista (ou carregue-a da API)
// sem mexer no componente visual (trial-ended-modal.tsx).
export type PlanId = "start" | "pro" | "premium";

export type PlanOffer = {
  id: PlanId;
  name: string;
  description: string;
  /** Texto de preço já formatado (mock). */
  price: string;
  priceSuffix: string;
  benefits: string[];
  recommended?: boolean;
};

export const planOffers: PlanOffer[] = [
  {
    id: "start",
    name: "Harmonize Start",
    description: "O essencial para organizar a rotina da clínica.",
    price: "R$ XX,XX",
    priceSuffix: "/mês",
    benefits: ["Agenda e clientes", "Procedimentos e orçamentos", "Pagamentos básicos", "1 profissional"],
  },
  {
    id: "pro",
    name: "Harmonize Pro",
    description: "Gestão completa para clínicas em crescimento.",
    price: "R$ XX,XX",
    priceSuffix: "/mês",
    benefits: ["Tudo do Start", "Financeiro e estoque", "Relatórios e desempenho", "Até 5 profissionais"],
    recommended: true,
  },
  {
    id: "premium",
    name: "Harmonize Premium",
    description: "Recursos avançados para operações maiores.",
    price: "R$ XX,XX",
    priceSuffix: "/mês",
    benefits: ["Tudo do Pro", "Exportação de relatórios (Excel/PDF)", "Integração com Google Agenda", "Profissionais ilimitados", "Suporte prioritário"],
  },
];

export const PLAN_CHECKOUT_SOON_MESSAGE = "Em breve você poderá contratar seu plano diretamente por aqui.";
