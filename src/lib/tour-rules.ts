import type { SectionId } from "../types/clinic";
import type { MascotPose } from "./mascot-rules";

/**
 * Tour guiado do primeiro acesso. O "já viu" é só uma preferência de interface (não dado clínico):
 * fica no localStorage, por usuário, para que outro usuário no mesmo navegador também veja o tour.
 */
export const TOUR_SEEN = "1";
const KEY_PREFIX = "harmonize_tour_v1_";

/** O tour usa o mesmo repertório de poses do mascote (ver mascot-rules). */
export type TourPose = MascotPose;

export type TourStep = {
  key: string;
  title: string;
  text: string;
  /** Seção exibida atrás do tour e destacada na navegação (ausente = sem destaque). */
  section?: SectionId;
  pose: TourPose;
  /** Texto para quem não acessa dados clínicos (ex.: STAFF): não cita avaliação, fotos nem documentos. */
  plainText?: string;
  /** Título usado quando o usuário não tem acesso clínico (par do `plainText`). */
  plainTitle?: string;
};

export const TOUR_STEPS: readonly TourStep[] = [
  { key: "oi", title: "Oi, eu sou o Harmo!", text: "Vou te mostrar o Harmonize+ em menos de 1 minuto. Se preferir, é só clicar em “Pular tour”.", pose: "wave" },
  { key: "dashboard", title: "Visão geral da sua clínica", text: "Acompanhe os principais indicadores da clínica, visualize seus resultados financeiros e entenda a evolução do negócio em um só lugar.", section: "dashboard", pose: "point" },
  { key: "agenda", title: "Agenda: organize seus atendimentos", text: "Visualize seus agendamentos por dia, semana ou mês. Gerencie horários, consulte os detalhes dos atendimentos, reagende compromissos e atualize seus status com facilidade.", section: "agenda", pose: "nod" },
  { key: "clientes", title: "Clientes: histórico completo dos pacientes", text: "Cadastre, encontre e gerencie seus pacientes em um só lugar. Consulte o histórico de atendimentos, avaliações, procedimentos realizados, fotos e documentos de cada paciente.", plainTitle: "Clientes: cadastro dos pacientes", plainText: "Cadastre, encontre e gerencie seus pacientes em um só lugar. Consulte os dados de cadastro e o contato de cada paciente.", section: "clientes", pose: "peek" },
  { key: "procedimentos", title: "Procedimentos: catálogo da sua clínica", text: "Cadastre seus procedimentos com preços, duração e fichas técnicas. Defina os materiais utilizados em cada serviço e mantenha seu catálogo organizado.", section: "procedimentos", pose: "point" },
  { key: "estoque", title: "Estoque: controle seus materiais", text: "Acompanhe a quantidade disponível de cada material, defina estoques mínimos e monitore os lotes. O consumo é atualizado automaticamente conforme a utilização dos procedimentos cadastrados nas fichas técnicas.", section: "estoque", pose: "think" },
  { key: "compras", title: "Compras: organize a reposição de materiais", text: "Registre suas compras, informe os materiais adquiridos e controle a entrada de produtos no estoque. Mantenha o histórico de reposições da sua clínica organizado.", section: "compras", pose: "shrug" },
  { key: "orcamentos", title: "Orçamentos: transforme avaliações em planos de tratamento", text: "Crie orçamentos personalizados a partir das avaliações, selecione os procedimentos desejados e apresente os valores ao paciente. Gere e compartilhe propostas de forma profissional.", plainTitle: "Orçamentos: planos de tratamento", plainText: "Crie orçamentos personalizados, selecione os procedimentos desejados e apresente os valores ao paciente. Gere e compartilhe propostas de forma profissional.", section: "orcamentos", pose: "point" },
  { key: "pagamentos", title: "Pagamentos: acompanhe os recebimentos", text: "Registre os pagamentos dos pacientes, acompanhe parcelas e consulte os valores recebidos e pendentes. Tenha mais controle sobre os compromissos financeiros de cada atendimento.", section: "pagamentos", pose: "nod" },
  { key: "financeiro", title: "Financeiro: controle os resultados da clínica", text: "Acompanhe receitas, despesas e movimentações financeiras. Visualize o fluxo financeiro e tenha uma visão clara dos resultados da sua clínica.", section: "financeiro", pose: "think" },
  { key: "relatorios", title: "Relatórios: transforme dados em decisões", text: "Consulte indicadores e relatórios sobre o desempenho da clínica. Analise os resultados e identifique oportunidades para melhorar a gestão e o crescimento do negócio.", section: "relatorios", pose: "peek" },
  { key: "configuracoes", title: "Configurações", text: "Dados da clínica, preferências e tema, tudo no seu lugar.", section: "configuracoes", pose: "wink" },
  { key: "fim", title: "Tudo pronto!", text: "Para rever o tour, clique no “?” lá em cima, ao lado do tema. Bom trabalho!", pose: "cheer" },
];

/** Chave do localStorage por usuário. */
export function tourKey(userId: string): string {
  return tourKeyWithPrefix(KEY_PREFIX, userId);
}

/** Chave por usuário com prefixo próprio: o tour da ficha da paciente guarda a sua marca separada da do tour geral. */
export function tourKeyWithPrefix(prefix: string, userId: string): string {
  return prefix + (userId.replace(/[^A-Za-z0-9._-]/g, "_") || "anon");
}

/** Mostra o tour só quando a leitura funcionou e o usuário ainda não viu (falha de leitura não repete o tour a cada abertura). */
export function shouldShowTour(raw: string | null | undefined, readFailed = false): boolean {
  if (readFailed) return false;
  return raw !== TOUR_SEEN;
}

/** Passos que o usuário pode ver: abertura e fim sempre; os demais só se a seção for permitida. Sem nenhum passo de seção, não há tour. */
export function visibleTourSteps(allowedSections: readonly SectionId[], canReadClinical = true): TourStep[] {
  // O "fim" não depende mais de permissão: o botão que reabre o tour fica na topbar, visível para todos.
  const steps = TOUR_STEPS.filter((step) => !step.section || allowedSections.includes(step.section)).map((step) => {
    if (!canReadClinical) return { ...step, title: step.plainTitle ?? step.title, text: step.plainText ?? step.text };
    return step;
  });
  return steps.some((step) => step.section) ? steps : [];
}

export function isLastStep(index: number, total: number): boolean {
  return index >= total - 1;
}

export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.floor(index) || 0));
}
