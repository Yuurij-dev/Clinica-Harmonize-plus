import { permissionGroups } from "./permissions.ts";
import { navItems } from "../data/navigation.ts";
import type { SectionId } from "../types/clinic";

export type GlobalSearchResult = { id: string; title: string; description: string; section: SectionId; kind: string; settingsSection?: string };
export type SearchAccess = { dashboard: boolean; patients: boolean; agenda: boolean; appointmentRun: boolean; procedures: boolean; stock: boolean; purchases: boolean; quotes: boolean; payments: boolean; finance: boolean; reports: boolean; settings: boolean; settingsPermissions: boolean; settingsTeam: boolean; clinical: boolean; anamnesis: boolean };
export type SearchResultGroup = { id: string; label: string; results: GlobalSearchResult[] };
export type SearchQuickAction = { id: string; title: string; description: string; section: SectionId; dialog: "appointment" | "client" | "procedure" | "quote" | "payment"; terms: string };
export const SEARCH_RESULTS_PREVIEW_LIMIT = 5;

export function navigateToSearchResult(result: GlobalSearchResult, navigate: (section: SectionId) => void, openSettingsSection: (section: string) => void) {
  if (result.settingsSection) openSettingsSection(result.settingsSection);
  else navigate(result.section);
}

export function previewSearchResults<T>(results: T[], expanded: boolean) {
  return { results: expanded ? results : results.slice(0, SEARCH_RESULTS_PREVIEW_LIMIT), hiddenCount: expanded ? 0 : Math.max(0, results.length - SEARCH_RESULTS_PREVIEW_LIMIT) };
}

export function searchKeyboardAction(key: string, currentIndex: number, optionCount: number, retryAvailable = false) {
  if (key === "Escape") return { type: "close" as const };
  if ((key === "ArrowDown" || key === "ArrowUp") && optionCount > 0) {
    const index = key === "ArrowDown" ? (currentIndex + 1) % optionCount : currentIndex <= 0 || currentIndex >= optionCount ? optionCount - 1 : currentIndex - 1;
    return { type: "move" as const, index };
  }
  if (key === "Enter" && currentIndex >= 0 && currentIndex < optionCount) return { type: "select" as const, index: currentIndex };
  if (key === "Enter" && retryAvailable && currentIndex < 0) return { type: "retry" as const };
  return null;
}

export function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
}

export function orderSearchResults(results: GlobalSearchResult[]) {
  return [...results].sort((a, b) => normalizeSearchText(a.title).localeCompare(normalizeSearchText(b.title), "pt-BR") || a.kind.localeCompare(b.kind, "pt-BR"));
}

export function mergeSearchResults(...collections: GlobalSearchResult[][]) {
  const unique = new Map<string, GlobalSearchResult>();
  for (const result of collections.flat()) unique.set(`${result.kind}:${result.id}`, result);
  return orderSearchResults([...unique.values()]);
}

const resultGroupOrder = ["pages", "functions", "settings", "clients", "appointments", "quotes", "procedures", "stock", "purchases", "payments"];

function resultGroup(result: GlobalSearchResult) {
  if (result.kind === "Área do site") return { id: "pages", label: "Páginas" };
  if (result.kind === "Função do site") return { id: "functions", label: "Funções" };
  if (result.kind === "Configuração") return { id: "settings", label: "Configurações" };
  const groups: Record<string, { id: string; label: string }> = {
    Paciente: { id: "clients", label: "Clientes" }, Agendamento: { id: "appointments", label: "Agendamentos" },
    Orçamento: { id: "quotes", label: "Orçamentos" }, Procedimento: { id: "procedures", label: "Procedimentos" },
    Estoque: { id: "stock", label: "Estoque" }, Compra: { id: "purchases", label: "Compras" }, Pagamento: { id: "payments", label: "Pagamentos" },
  };
  return groups[result.kind] ?? { id: "other", label: "Outros resultados" };
}

export function groupSearchResults(results: GlobalSearchResult[]): SearchResultGroup[] {
  const groups = new Map<string, SearchResultGroup>();
  for (const result of results) {
    const group = resultGroup(result);
    const existing = groups.get(group.id) ?? { ...group, results: [] };
    existing.results.push(result);
    groups.set(group.id, existing);
  }
  return [...groups.values()].sort((a, b) => {
    const aOrder = resultGroupOrder.indexOf(a.id);
    const bOrder = resultGroupOrder.indexOf(b.id);
    return (aOrder < 0 ? resultGroupOrder.length : aOrder) - (bOrder < 0 ? resultGroupOrder.length : bOrder);
  });
}

export function splitSearchHighlight(value: string, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [{ text: value, match: false }];
  let normalized = "";
  const sourceIndexes: number[] = [];
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index)!;
    const character = String.fromCodePoint(codePoint);
    const folded = normalizeSearchText(character);
    for (let offset = 0; offset < folded.length; offset += 1) sourceIndexes.push(index);
    normalized += folded;
    index += character.length;
  }
  const matches: Array<{ from: number; to: number }> = [];
  for (let matchAt = normalized.indexOf(normalizedQuery); matchAt >= 0; matchAt = normalized.indexOf(normalizedQuery, matchAt + normalizedQuery.length)) {
    const from = sourceIndexes[matchAt];
    const lastSourceIndex = sourceIndexes[matchAt + normalizedQuery.length - 1];
    const to = lastSourceIndex + String.fromCodePoint(value.codePointAt(lastSourceIndex)!).length;
    const lastMatch = matches[matches.length - 1];
    if (lastMatch && from < lastMatch.to) lastMatch.to = Math.max(lastMatch.to, to);
    else matches.push({ from, to });
  }
  if (!matches.length) return [{ text: value, match: false }];
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.from > cursor) parts.push({ text: value.slice(cursor, match.from), match: false });
    parts.push({ text: value.slice(match.from, match.to), match: true });
    cursor = match.to;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor), match: false });
  return parts;
}

const quickActionCatalog: SearchQuickAction[] = [
  { id: "new-appointment", title: "Novo agendamento", description: "Criar um horário na agenda", section: "agenda", dialog: "appointment", terms: "agendamento agendar agenda atendimento" },
  { id: "new-client", title: "Novo cliente", description: "Cadastrar um cliente", section: "clientes", dialog: "client", terms: "cliente paciente cadastro" },
  { id: "new-procedure", title: "Novo procedimento", description: "Cadastrar um procedimento", section: "procedimentos", dialog: "procedure", terms: "procedimento tratamento" },
  { id: "new-quote", title: "Novo orçamento", description: "Criar um orçamento", section: "orcamentos", dialog: "quote", terms: "orçamento orcamento proposta" },
  { id: "new-payment", title: "Novo pagamento", description: "Registrar um pagamento", section: "pagamentos", dialog: "payment", terms: "pagamento cobrança cobranca" },
];

export function collectSearchQuickActions(query: string, access: SearchAccess) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = normalizedQuery.split(/\s+/).filter((token) => token.length > 2);
  const createIntent = /\b(novo|nova|criar|crie|adicionar|adicione|cadastrar|cadastre|registrar|registre)\b/.test(normalizedQuery);
  if (!createIntent) return [];
  return quickActionCatalog.filter((action) => {
    const permitted = action.dialog === "appointment" ? access.agenda : action.dialog === "client" ? access.patients : action.dialog === "procedure" ? access.procedures : action.dialog === "quote" ? access.quotes : access.payments;
    return permitted && tokens.some((token) => normalizeSearchText(action.terms).split(/\s+/).some((term) => term.startsWith(token) || token.startsWith(term)));
  });
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(previous[rightIndex] + 1, previous[rightIndex - 1] + 1, diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function suggestFeatureSearchTerms(query: string, access: SearchAccess) {
  const normalizedQuery = normalizeSearchText(query).trim();
  if (normalizedQuery.length < 4) return [];
  const accessBySection: Record<SectionId, boolean> = {
    dashboard: access.dashboard, agenda: access.agenda, clientes: access.patients,
    procedimentos: access.procedures, estoque: access.stock, compras: access.purchases,
    orcamentos: access.quotes, pagamentos: access.payments, financeiro: access.finance,
    relatorios: access.reports, configuracoes: access.settings,
  };
  const candidates = [
    ...navItems.filter((item) => accessBySection[item.id]).map((item) => item.label),
    ...settingsSearchFeatures.filter((item) => access[item.access]).map((item) => item.title),
  ];
  const maxDistance = Math.min(2, Math.floor(normalizedQuery.length * 0.25));
  return candidates.map((title) => {
    const normalizedTitle = normalizeSearchText(title);
    const distance = Math.min(editDistance(normalizedQuery, normalizedTitle), ...normalizedTitle.split(/\s+/).map((word) => editDistance(normalizedQuery, word)));
    return { title, distance };
  })
    .filter(({ title, distance }) => distance > 0 && distance <= maxDistance && normalizeSearchText(title) !== normalizedQuery)
    .sort((a, b) => a.distance - b.distance || a.title.localeCompare(b.title, "pt-BR"))
    .slice(0, 3).map(({ title }) => title);
}

const settingsSearchFeatures = [
  { title: "Dados da clínica", description: "Perfil, endereço, contato, cadastro e dados da clínica", synonyms: "estabelecimento identidade endereço telefone email", focus: "Dados da clínica", access: "settings" },
  { title: "Profissionais e equipe", description: "Equipe, profissionais, colaboradores e acesso de funcionários", synonyms: "equipe colaboradores funcionários profissional", focus: "Profissionais e equipe", access: "settingsTeam" },
  { title: "Agenda e horários", description: "Horário de funcionamento, disponibilidade e agenda", synonyms: "expediente funcionamento horário disponibilidade", focus: "Agenda e horários", access: "settings" },
  { title: "Custos e orçamento", description: "Custos da clínica, custos profissionais e orçamento", synonyms: "custos orçamento valores", focus: "Custos e orçamento", access: "settingsTeam" },
  { title: "Notificações", description: "Alertas, avisos e sons de notificação", synonyms: "alertas avisos som", focus: "Notificações", access: "settings" },
  { title: "Segurança e permissões", description: "Cargos, acesso, segurança e permissões da equipe", synonyms: "seguranca permissao permissoes cargo acesso controle", focus: "Segurança e permissões", access: "settingsPermissions" },
  { title: "Integrações", description: "Integrações e serviços conectados", synonyms: "conectar serviços", focus: "Integrações", access: "settings" },
] as const;

function sectionForPermission(permission: string): SectionId | null {
  if (permission.startsWith("dashboard:")) return "dashboard";
  if (permission.startsWith("agenda:") || permission.startsWith("appointment")) return "agenda";
  if (permission.startsWith("patients:") || permission.startsWith("clinical:") || permission.startsWith("anamnesis:")) return "clientes";
  if (permission.startsWith("procedures:")) return "procedimentos";
  if (permission.startsWith("stock:")) return "estoque";
  if (permission.startsWith("purchases:")) return "compras";
  if (permission.startsWith("quotes:") || permission.startsWith("quote:")) return "orcamentos";
  if (permission.startsWith("payments:")) return "pagamentos";
  if (permission.startsWith("finance:")) return "financeiro";
  if (permission.startsWith("reports:")) return "relatorios";
  if (permission.startsWith("settings:")) return "configuracoes";
  return null;
}

function permissionIsSearchable(permission: string, section: SectionId, access: SearchAccess, accessBySection: Record<SectionId, boolean>) {
  if (!accessBySection[section]) return false;
  if (permission.startsWith("clinical:")) return access.clinical;
  if (permission.startsWith("anamnesis:")) return access.anamnesis;
  if (permission === "appointment:run") return access.appointmentRun;
  if (permission === "settings:permissions") return access.settingsPermissions;
  if (permission === "settings:team") return access.settingsTeam;
  return true;
}

export function collectFeatureSearchResults(query: string, access: SearchAccess): GlobalSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];
  const features: GlobalSearchResult[] = [];
  const accessBySection: Record<SectionId, boolean> = {
    dashboard: access.dashboard, agenda: access.agenda, clientes: access.patients,
    procedimentos: access.procedures, estoque: access.stock, compras: access.purchases,
    orcamentos: access.quotes, pagamentos: access.payments, financeiro: access.finance,
    relatorios: access.reports, configuracoes: access.settings,
  };
  for (const item of navItems) {
    const text = normalizeSearchText(`${item.label} ${item.id}`);
    if (accessBySection[item.id] && text.includes(normalizedQuery)) features.push({ id: `area:${item.id}`, title: item.label, description: "Abrir esta área do Harmonize+", section: item.id, kind: "Área do site" });
  }
  for (const item of settingsSearchFeatures) {
    const text = normalizeSearchText(`${item.title} ${item.description} ${item.synonyms}`);
    if (access[item.access] && text.includes(normalizedQuery)) features.push({ id: `config:${item.focus}`, title: item.title, description: item.description, section: "configuracoes", kind: "Configuração", settingsSection: item.focus });
  }
  for (const group of permissionGroups) {
    const section = sectionForPermission(group.permissions[0]?.key ?? "");
    if (!section || !group.permissions.some((permission) => permissionIsSearchable(permission.key, sectionForPermission(permission.key) ?? section, access, accessBySection))) continue;
    if (normalizeSearchText(group.label).includes(normalizedQuery)) features.push({ id: `grupo:${group.label}`, title: group.label, description: "Funções e permissões desta área", section, kind: "Função do site" });
    for (const item of group.permissions) {
      const target = sectionForPermission(item.key);
      if (target && permissionIsSearchable(item.key, target, access, accessBySection) && normalizeSearchText(`${item.label} ${item.description}`).includes(normalizedQuery)) {
        const settingsSection = item.key === "settings:permissions" ? "Segurança e permissões" : item.key === "settings:team" ? "Profissionais e equipe" : item.key === "settings:manage" ? "Dados da clínica" : undefined;
        features.push({ id: `funcao:${item.key}`, title: item.label, description: item.description, section: target, kind: "Função do site", ...(settingsSection ? { settingsSection } : {}) });
      }
    }
  }
  return features;
}
