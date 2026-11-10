import type { MascotPose } from "./mascot-rules";

/**
 * Assistente de configuração inicial da clínica. Regras puras: o servidor conta os dados reais da clínica
 * (setup-snapshot.ts) e estas funções decidem o que está concluído; a tela só mostra o resultado.
 */

export const SETUP_STATUSES = ["pending", "in_progress", "completed", "dismissed"] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];

export type SetupStepKey = "clinica" | "equipe" | "agenda" | "procedimentos" | "materiais" | "produtos" | "custos" | "financeiro" | "notificacoes" | "revisao";
export type SetupDecision = "confirmed" | "skipped";
export type SetupDecisions = Partial<Record<SetupStepKey, { decision: SetupDecision; by: string; at: string }>>;

/** Dados contados no servidor, sempre da clínica da sessão. */
export type SetupSnapshot = {
  name: string;
  phone: string | null;
  address: string | null;
  professionalCount: number;
  procedureCount: number;
  materialCount: number;
  productCount: number;
  recurringExpenseCount: number;
  openingTime: string;
  closingTime: string;
  professionalOpeningTime: string;
  professionalClosingTime: string;
};

/** Para onde a ação da etapa leva: uma seção do sistema ou uma subseção de Configurações. */
export type SetupDestination = { kind: "settings"; section: string } | { kind: "section"; section: "procedimentos" | "estoque" | "financeiro" };

export type SetupStepDefinition = {
  key: SetupStepKey;
  title: string;
  required: boolean;
  pose: MascotPose;
  /** Mensagem do Harmo no cabeçalho. */
  harmo: string;
  what: string;
  why: string;
  todo: string;
  example: string;
  /** Etapa só informativa (sem tela para cadastrar): o que aparece é explicação do que o sistema já traz. */
  destination?: SetupDestination;
  actionLabel?: string;
  /** Texto do botão de confirmação explícita (só nas etapas em que `canDecide(key, "confirmed")`). */
  confirmLabel?: string;
  /** Texto do botão "Não utilizamos" (só nas etapas opcionais). */
  skipLabel?: string;
  /** Orientação quando falta algo. */
  missingHint?: string;
  /** Aviso quando a etapa conclui. */
  doneMessage: string;
};

export const SETUP_STEPS: readonly SetupStepDefinition[] = [
  {
    key: "clinica",
    title: "Dados da clínica",
    required: true,
    pose: "wave",
    harmo: "Vamos começar pelo básico: quem é a sua clínica?",
    what: "Nome, telefone e endereço que identificam a clínica no sistema.",
    why: "Esses dados aparecem em orçamentos, documentos e comunicações com os pacientes.",
    todo: "Preencha nome, telefone e endereço. CNPJ e e-mail são opcionais.",
    example: "Clínica Bela Face · (11) 99999-0000 · Rua das Flores, 120, São Paulo",
    destination: { kind: "settings", section: "Dados da clínica" },
    actionLabel: "Abrir dados da clínica",
    missingHint: "Ainda faltam dados da clínica. Vamos completar nome, telefone e endereço?",
    doneMessage: "Perfeito! Os dados da clínica estão completos.",
  },
  {
    key: "equipe",
    title: "Profissionais e equipe",
    required: true,
    pose: "point",
    harmo: "Quem realiza os atendimentos na sua clínica?",
    what: "As pessoas que usam o sistema: administradores, profissionais e atendentes.",
    why: "Cada atendimento é feito por um profissional, e o cargo define o que cada pessoa pode ver e alterar.",
    todo: "Cadastre ao menos um profissional. Se você mesmo realiza os atendimentos por enquanto, basta confirmar.",
    example: "Dra. Ana (profissional) e Carla (atendente).",
    destination: { kind: "settings", section: "Profissionais e equipe" },
    actionLabel: "Abrir profissionais e equipe",
    confirmLabel: "Eu mesmo realizo os atendimentos por enquanto",
    missingHint: "Você ainda não cadastrou nenhum profissional. Vamos adicionar o primeiro, ou confirmar que você mesmo atende?",
    doneMessage: "Perfeito! A equipe está definida.",
  },
  {
    key: "agenda",
    title: "Agenda e horários",
    required: true,
    pose: "think",
    harmo: "Vamos conferir os horários da agenda.",
    what: "Horário de funcionamento da clínica, horário dos profissionais e a tolerância para marcar falta.",
    why: "A agenda usa esses horários para oferecer horários livres e avisar sobre atrasos e faltas.",
    todo: "Revise os horários (em Dados da clínica) e a tolerância (em Agenda e horários) e confirme.",
    example: "Clínica abre às 08:00 e fecha às 19:00; tolerância de 15 minutos.",
    destination: { kind: "settings", section: "Agenda e horários" },
    actionLabel: "Abrir agenda e horários",
    confirmLabel: "Conferi a agenda e os horários",
    missingHint: "Confira os horários e confirme esta etapa quando estiver tudo certo.",
    doneMessage: "Perfeito! A agenda está pronta.",
  },
  {
    key: "procedimentos",
    title: "Procedimentos",
    required: true,
    pose: "cheer",
    harmo: "Hora de cadastrar o que você oferece.",
    what: "O catálogo de procedimentos da clínica, com preço e duração.",
    why: "Agendamentos, orçamentos e atendimentos partem dos procedimentos cadastrados.",
    todo: "Cadastre ao menos um procedimento com valor e duração.",
    example: "Preenchimento labial · R$ 1.200 · 60 minutos.",
    destination: { kind: "section", section: "procedimentos" },
    actionLabel: "Abrir procedimentos",
    missingHint: "Você ainda não cadastrou nenhum procedimento. Vamos adicionar o primeiro?",
    doneMessage: "Perfeito! Seu catálogo de procedimentos já tem itens.",
  },
  {
    key: "materiais",
    title: "Materiais",
    required: false,
    pose: "nod",
    harmo: "Agora os materiais usados nos atendimentos.",
    what: "Itens de consumo como agulhas, luvas e algodão, com controle de estoque.",
    why: "Com materiais cadastrados, o sistema calcula custos e dá baixa no estoque a cada atendimento.",
    todo: "Cadastre os materiais que você mais usa. Se não controla estoque, pode pular.",
    example: "Agulha 30G · caixa com 100 unidades.",
    destination: { kind: "section", section: "estoque" },
    actionLabel: "Abrir estoque",
    skipLabel: "Não utilizamos materiais",
    missingHint: "Nenhum material cadastrado ainda. Quer adicionar o primeiro ou pular esta etapa?",
    doneMessage: "Perfeito! Seus materiais estão cadastrados.",
  },
  {
    key: "produtos",
    title: "Produtos",
    required: false,
    pose: "peek",
    harmo: "E os produtos, como você controla?",
    what: "Produtos aplicados ou vendidos, como ácido hialurônico e toxina, com lotes e validade.",
    why: "Permite rastrear lotes, receber avisos de validade e saber o custo real de cada procedimento.",
    todo: "Cadastre seus produtos. Se não controla estoque de produtos, pode pular.",
    example: "Ácido hialurônico 1 ml · lote com validade.",
    destination: { kind: "section", section: "estoque" },
    actionLabel: "Abrir estoque",
    skipLabel: "Não utilizamos produtos",
    missingHint: "Nenhum produto cadastrado ainda. Quer adicionar o primeiro ou pular esta etapa?",
    doneMessage: "Perfeito! Seus produtos estão cadastrados.",
  },
  {
    key: "custos",
    title: "Custos e orçamento",
    required: false,
    pose: "think",
    harmo: "Vamos olhar os custos que entram no orçamento.",
    what: "Mão de obra por profissional, custo de estrutura e de medicação usados para calcular o custo dos procedimentos.",
    why: "Os orçamentos mostram o custo e a margem a partir desses valores.",
    todo: "Revise os valores e confirme. Se preferir, pode pular e ajustar depois.",
    example: "Mão de obra da Dra. Ana: R$ 80 por hora.",
    destination: { kind: "settings", section: "Custos e orçamento" },
    actionLabel: "Abrir custos e orçamento",
    confirmLabel: "Revisei os custos",
    skipLabel: "Não utilizamos",
    missingHint: "Revise os custos e confirme, ou pule esta etapa.",
    doneMessage: "Perfeito! Os custos foram revisados.",
  },
  {
    key: "financeiro",
    title: "Financeiro",
    required: false,
    pose: "wink",
    harmo: "Vamos ver o financeiro da clínica.",
    what: "Custos fixos recorrentes (aluguel, internet, salários) e as formas de pagamento e categorias que o sistema já traz.",
    why: "Os custos fixos alimentam o resumo financeiro e o fluxo de caixa.",
    todo: "Cadastre seus custos fixos, ou confirme que vai fazer isso depois. As formas de pagamento e categorias são padrão do sistema.",
    example: "Aluguel · R$ 3.500 · todo dia 5.",
    destination: { kind: "section", section: "financeiro" },
    actionLabel: "Abrir financeiro",
    confirmLabel: "Entendi, vou cadastrar depois",
    skipLabel: "Não utilizamos",
    missingHint: "Nenhum custo fixo cadastrado ainda. Quer adicionar o primeiro?",
    doneMessage: "Perfeito! O financeiro está encaminhado.",
  },
  {
    key: "notificacoes",
    title: "Notificações e integrações",
    required: false,
    pose: "nod",
    harmo: "Quais avisos você quer receber?",
    what: "Alertas de agendamento, som de notificação, avisos de estoque e antecedência do aviso de validade.",
    why: "Os avisos ajudam a não perder horários nem deixar produtos vencerem.",
    todo: "Revise os alertas e confirme. Integrações externas (como WhatsApp) ainda não estão disponíveis.",
    example: "Aviso de validade 30 dias antes do vencimento.",
    destination: { kind: "settings", section: "Notificações" },
    actionLabel: "Abrir notificações",
    confirmLabel: "Revisei as notificações",
    skipLabel: "Não utilizamos",
    missingHint: "Revise os alertas e confirme, ou pule esta etapa.",
    doneMessage: "Perfeito! As notificações foram revisadas.",
  },
  {
    key: "revisao",
    title: "Revisão final",
    required: false,
    pose: "cheer",
    harmo: "Quase lá! Vamos revisar tudo.",
    what: "Um resumo do que foi configurado e do que ficou pendente.",
    why: "Você vê de uma vez o que já está pronto e pode voltar a qualquer etapa.",
    todo: "Confira o resumo e finalize. As etapas obrigatórias precisam estar concluídas.",
    example: "4 de 4 etapas obrigatórias concluídas.",
    doneMessage: "Configuração finalizada!",
  },
];

export const SETUP_TOTAL = SETUP_STEPS.length;
export const SETUP_FIRST_STEP: SetupStepKey = "clinica";

const STEP_KEYS = new Set<string>(SETUP_STEPS.map((step) => step.key));
const CONFIRMABLE = new Set<SetupStepKey>(["equipe", "agenda", "custos", "financeiro", "notificacoes"]);
const SKIPPABLE = new Set<SetupStepKey>(["materiais", "produtos", "custos", "financeiro", "notificacoes"]);

export function isSetupStepKey(value: unknown): value is SetupStepKey {
  return typeof value === "string" && STEP_KEYS.has(value);
}

export function isSetupStatus(value: unknown): value is SetupStatus {
  return typeof value === "string" && (SETUP_STATUSES as readonly string[]).includes(value);
}

export function isSetupDecision(value: unknown): value is SetupDecision {
  return value === "confirmed" || value === "skipped";
}

/** Pular só vale para etapas opcionais; confirmar, só para as que dependem de uma conferência do administrador. */
export function canDecide(step: unknown, decision: unknown) {
  if (!isSetupStepKey(step) || !isSetupDecision(decision)) return false;
  return decision === "skipped" ? SKIPPABLE.has(step) : CONFIRMABLE.has(step);
}

/** Etapas de conferência: salvar com sucesso na tela de destino (vindo pelo assistente) já registra a confirmação. */
export function confirmsOnSave(step: unknown) {
  return (step === "agenda" || step === "custos" || step === "notificacoes") && canDecide(step, "confirmed");
}

/** Lê o JSON salvo sem confiar nele: descarta chaves desconhecidas e decisões que a etapa não aceita. */
export function parseSetupDecisions(raw: unknown): SetupDecisions {
  const result: SetupDecisions = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSetupStepKey(key) || !value || typeof value !== "object") continue;
    const entry = value as { decision?: unknown; by?: unknown; at?: unknown };
    if (!canDecide(key, entry.decision)) continue;
    result[key] = { decision: entry.decision as SetupDecision, by: typeof entry.by === "string" ? entry.by : "", at: typeof entry.at === "string" ? entry.at : "" };
  }
  return result;
}

function clockMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

function validRange(opening: string, closing: string) {
  const start = clockMinutes(opening);
  const end = clockMinutes(closing);
  return start !== null && end !== null && start < end;
}

export function hasValidSetupHours(snapshot: Pick<SetupSnapshot, "openingTime" | "closingTime" | "professionalOpeningTime" | "professionalClosingTime">) {
  return validRange(snapshot.openingTime, snapshot.closingTime) && validRange(snapshot.professionalOpeningTime, snapshot.professionalClosingTime);
}

export type SetupStepState = {
  key: SetupStepKey;
  title: string;
  required: boolean;
  /** Concluída: por dados, por confirmação ou por "não utilizamos". */
  done: boolean;
  skipped: boolean;
  confirmed: boolean;
};

export type SetupEvaluation = {
  steps: SetupStepState[];
  doneCount: number;
  total: number;
  percent: number;
  /** As etapas obrigatórias (1 a 4) estão concluídas. */
  canFinish: boolean;
  /** Primeira etapa ainda não concluída (a revisão só aparece quando todas as outras estão resolvidas); null se tudo concluído. */
  nextPendingKey: SetupStepKey | null;
};

function isDoneByData(key: SetupStepKey, snapshot: SetupSnapshot, confirmed: boolean) {
  switch (key) {
    case "clinica":
      return Boolean(snapshot.name.trim() && snapshot.phone?.trim() && snapshot.address?.trim());
    case "equipe":
      return snapshot.professionalCount >= 1 || confirmed;
    case "agenda":
      return confirmed && hasValidSetupHours(snapshot);
    case "procedimentos":
      return snapshot.procedureCount >= 1;
    case "materiais":
      return snapshot.materialCount >= 1;
    case "produtos":
      return snapshot.productCount >= 1;
    case "custos":
    case "notificacoes":
      return confirmed;
    case "financeiro":
      return snapshot.recurringExpenseCount >= 1 || confirmed;
    case "revisao":
      return false;
  }
}

/**
 * Avalia cada etapa com os dados reais e as decisões salvas. `finished` (status "completed") conclui a revisão final;
 * mesmo assim ela só conta se as obrigatórias continuam cumpridas.
 */
export function evaluateSetup(snapshot: SetupSnapshot, decisions: SetupDecisions, finished = false): SetupEvaluation {
  const steps: SetupStepState[] = SETUP_STEPS.map((definition) => {
    const decision = decisions[definition.key]?.decision;
    const confirmed = decision === "confirmed" && CONFIRMABLE.has(definition.key);
    const skipped = decision === "skipped" && SKIPPABLE.has(definition.key);
    const byData = definition.key === "revisao" ? false : isDoneByData(definition.key, snapshot, confirmed);
    return { key: definition.key, title: definition.title, required: definition.required, done: byData || skipped, skipped: skipped && !byData, confirmed };
  });
  const canFinish = steps.filter((step) => step.required).every((step) => step.done);
  const review = steps[steps.length - 1];
  review.done = finished && canFinish;
  const doneCount = steps.filter((step) => step.done).length;
  const beforeReview = steps.slice(0, -1);
  const firstPending = beforeReview.find((step) => !step.done);
  const nextPendingKey = firstPending ? firstPending.key : review.done ? null : "revisao";
  return { steps, doneCount, total: steps.length, percent: Math.round((doneCount / steps.length) * 100), canFinish, nextPendingKey };
}

/** Convite pós-tour e card do Dashboard: só enquanto o administrador ainda não decidiu. */
export function shouldInviteSetup(status: SetupStatus) {
  return status === "pending";
}

export function showsSetupProgress(status: SetupStatus) {
  return status !== "completed";
}

/** Um alvo do destaque, na ordem do plano. `fieldKey` marca campos de formulário (concluídos quando preenchidos); botões não têm. */
export type SetupSpotlightItem = { selector: string; hint: string; fieldKey?: string };
export type SetupSpotlightPlan = { items: SetupSpotlightItem[] };

const targetSelector = (key: string) => `[data-setup-target="${key}"]`;
const buttonItem = (key: string, hint: string): SetupSpotlightPlan => ({ items: [{ selector: targetSelector(key), hint }] });

/**
 * O que destacar na tela da etapa (valores de data-setup-target nas telas existentes), um alvo por vez, na ordem.
 * Em "clinica": nome, telefone, endereço (o destaque pula os já preenchidos e volta se forem apagados) e depois "Salvar dados".
 */
export function setupSpotlightPlan(key: SetupStepKey): SetupSpotlightPlan | null {
  switch (key) {
    case "clinica":
      return {
        items: [
          { selector: targetSelector("clinica:name"), fieldKey: "name", hint: "Preencha o nome da clínica" },
          { selector: targetSelector("clinica:phone"), fieldKey: "phone", hint: "Preencha o telefone da clínica, com DDD" },
          { selector: targetSelector("clinica:address"), fieldKey: "address", hint: "Preencha o endereço da clínica" },
          { selector: targetSelector("clinica:save"), hint: "Agora clique em Salvar dados" },
        ],
      };
    case "equipe": return buttonItem("equipe", "Clique aqui para cadastrar seu primeiro profissional");
    case "agenda": return buttonItem("agenda", "Confira a tolerância da agenda; depois volte ao assistente e confirme");
    case "procedimentos": return buttonItem("procedimentos", "Clique aqui para cadastrar seu primeiro procedimento");
    case "materiais": return buttonItem("materiais", "Clique aqui para cadastrar seu primeiro material");
    case "produtos": return buttonItem("produtos", "Clique aqui para cadastrar seu primeiro produto");
    case "custos": return buttonItem("custos", "Revise a mão de obra e os custos; depois volte e confirme");
    case "financeiro": return buttonItem("financeiro", "Clique aqui para cadastrar seu primeiro custo fixo");
    case "notificacoes": return buttonItem("notificacoes", "Revise os alertas; depois volte e confirme");
    case "revisao": return null;
  }
}

/** Campo preenchido: texto não vazio; telefone exige os dígitos da máscara (DDD + número, 10 ou mais). */
export function isSetupFieldFilled(fieldKey: string, value: string) {
  if (fieldKey === "phone") return value.replace(/\D/g, "").length >= 10;
  return value.trim().length > 0;
}

/**
 * Índice do alvo atual: o primeiro, na ordem do plano, que ainda pede ação. `filled`: `null` = o alvo não está na tela
 * (ignorado); `true` = campo preenchido (pulado); `false` = pendente. Botões (`fieldKey` ausente) nunca contam como feitos:
 * seguem como alvo até a etapa concluir no servidor, quando o destaque inteiro sai. -1 se não há alvo.
 */
export function currentSetupTargetIndex(items: readonly SetupSpotlightItem[], filled: ReadonlyArray<boolean | null>) {
  return items.findIndex((item, index) => filled[index] !== null && (!item.fieldKey || filled[index] === false));
}

export type SetupRect = { x: number; y: number; w: number; h: number };

const overlapArea = (a: SetupRect, b: SetupRect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Posição do balão do Harmo: nunca sobre um alvo nem sobre obstáculos (barra de retorno, navegação inferior).
 * Desktop tenta ao lado do primeiro alvo e depois acima/abaixo da união dos alvos; celular, abaixo ou acima.
 * Sem nenhum lugar livre, escolhe o de menor sobreposição (sempre dentro da tela, para o "Entendi" ficar visível).
 */
export function placeBalloon(input: { targets: SetupRect[]; obstacles: SetupRect[]; viewport: { w: number; h: number }; size: { w: number; h: number }; desktop: boolean; margin?: number; gap?: number }) {
  const { targets, obstacles, viewport, size, desktop } = input;
  const margin = input.margin ?? 12;
  const gap = input.gap ?? 14;
  if (!targets.length) return { left: margin, top: margin };
  const first = targets[0];
  const x1 = Math.min(...targets.map((t) => t.x));
  const y1 = Math.min(...targets.map((t) => t.y));
  const x2 = Math.max(...targets.map((t) => t.x + t.w));
  const y2 = Math.max(...targets.map((t) => t.y + t.h));
  const unionCenter = (x1 + x2) / 2 - size.w / 2;
  const firstCenter = first.x + first.w / 2 - size.w / 2;
  const raw: Array<{ left: number; top: number }> = [
    ...(desktop ? [{ left: first.x + first.w + gap, top: first.y + first.h / 2 - size.h / 2 }, { left: first.x - gap - size.w, top: first.y + first.h / 2 - size.h / 2 }] : []),
    { left: unionCenter, top: y2 + gap },
    { left: unionCenter, top: y1 - gap - size.h },
    { left: firstCenter, top: first.y + first.h + gap },
    { left: firstCenter, top: first.y - gap - size.h },
    { left: unionCenter, top: viewport.h - margin - size.h },
    { left: unionCenter, top: margin },
  ];
  const clamp = (value: number, max: number) => Math.max(margin, Math.min(value, max));
  const avoid = [...targets, ...obstacles];
  let best = { left: margin, top: margin };
  let bestScore = Infinity;
  for (const candidate of raw) {
    const left = clamp(candidate.left, viewport.w - size.w - margin);
    const top = clamp(candidate.top, viewport.h - size.h - margin);
    const box = { x: left, y: top, w: size.w, h: size.h };
    const score = avoid.reduce((sum, rect) => sum + overlapArea(box, rect), 0);
    if (score === 0) return { left, top };
    if (score < bestScore) { best = { left, top }; bestScore = score; }
  }
  return best;
}
