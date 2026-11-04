import assert from "node:assert/strict";
import { test } from "node:test";
import { collectFeatureSearchResults, collectSearchQuickActions, groupSearchResults, mergeSearchResults, navigateToSearchResult, orderSearchResults, previewSearchResults, searchKeyboardAction, splitSearchHighlight, suggestFeatureSearchTerms } from "../src/lib/global-search-rules.ts";

const allAccess = {
  dashboard: true, patients: true, agenda: true, appointmentRun: true, procedures: true, stock: true,
  purchases: true, quotes: true, payments: true, finance: true, reports: true,
  settings: true, settingsPermissions: true, settingsTeam: true, clinical: true, anamnesis: true,
};

test("busca nomes de todas as áreas e liga cada opção à seção correta", () => {
  const cases = [
    ["dashboard", "dashboard"], ["agenda", "agenda"], ["clientes", "clientes"],
    ["procedimentos", "procedimentos"], ["estoque", "estoque"], ["compras", "compras"],
    ["orçamentos", "orcamentos"], ["pagamentos", "pagamentos"], ["financeiro", "financeiro"],
    ["relatórios", "relatorios"], ["configurações", "configuracoes"],
  ];
  for (const [query, section] of cases) {
    assert.ok(collectFeatureSearchResults(query, allAccess).some((result) => result.kind === "Área do site" && result.section === section), query);
  }
});

test("busca funções e abre a subseção exata de segurança e permissões", () => {
  const results = collectFeatureSearchResults("segurança", allAccess);
  assert.ok(results.some((result) => result.title === "Segurança e permissões" && result.section === "configuracoes" && result.settingsSection === "Segurança e permissões"));
  assert.ok(collectFeatureSearchResults("criar e editar agendamentos", allAccess).some((result) => result.section === "agenda" && result.kind === "Função do site"));
  assert.ok(collectFeatureSearchResults("visualizar dados clínicos", allAccess).some((result) => result.section === "clientes" && result.kind === "Função do site"));
});

test("encontra todas as subseções de Configurações pelos seus termos usuais", () => {
  const cases = [
    ["endereço", "Dados da clínica"], ["equipe", "Profissionais e equipe"],
    ["funcionamento", "Agenda e horários"], ["custos", "Custos e orçamento"],
    ["alertas", "Notificações"], ["segurança", "Segurança e permissões"],
    ["integrações", "Integrações"],
  ];
  for (const [query, settingsSection] of cases) {
    assert.ok(collectFeatureSearchResults(query, allAccess).some((result) => result.settingsSection === settingsSection), `${query} -> ${settingsSection}`);
  }
});

test("não mostra opções fora das áreas e permissões liberadas", () => {
  const restricted = { ...allAccess, settings: false, settingsPermissions: false, finance: false, clinical: false, anamnesis: false, appointmentRun: false };
  const security = collectFeatureSearchResults("segurança", restricted);
  assert.equal(security.some((result) => result.title === "Segurança e permissões"), false);
  assert.equal(collectFeatureSearchResults("financeiro", restricted).some((result) => result.section === "financeiro"), false);
  assert.equal(collectFeatureSearchResults("dados clínicos", restricted).some((result) => result.kind === "Função do site"), false);
});

test("resultados são ordenados pelo título sem diferenciar acentos ou maiúsculas", () => {
  const results = ["Orçamentos", "Árvore", "agenda", "Ácido"].map((title) => ({ id: title, title, description: "", section: "clientes", kind: "Área" }));
  assert.deepEqual(orderSearchResults(results).map((result) => result.title), ["Ácido", "agenda", "Árvore", "Orçamentos"]);
});

test("combina resultados imediatos e do servidor, elimina duplicatas sem duplicar títulos distintos", () => {
  const local = [
    { id: "1", title: "Ana", description: "", section: "clientes", kind: "Paciente" },
    { id: "2", title: "Agenda", description: "", section: "agenda", kind: "Área do site" },
  ];
  const remote = [
    { id: "1", title: "Ana Souza", description: "5555", section: "clientes", kind: "Paciente" },
    { id: "3", title: "Ana", description: "", section: "agenda", kind: "Agendamento" },
  ];
  const merged = mergeSearchResults(local, remote);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((result) => result.id === "1" && result.kind === "Paciente").title, "Ana Souza");
  assert.deepEqual(merged.map((result) => result.title), ["Agenda", "Ana", "Ana Souza"]);
});

test("agrupa resultados por destino e tipo de conteúdo", () => {
  const results = [
    { id: "p", title: "Ana", description: "", section: "clientes", kind: "Paciente" },
    { id: "a", title: "Agenda", description: "", section: "agenda", kind: "Área do site" },
    { id: "f", title: "Criar agenda", description: "", section: "agenda", kind: "Função do site" },
    { id: "c", title: "Segurança", description: "", section: "configuracoes", kind: "Configuração" },
  ];
  assert.deepEqual(groupSearchResults(results).map(({ id, label, results: grouped }) => [id, label, grouped.length]), [
    ["pages", "Páginas", 1], ["functions", "Funções", 1], ["settings", "Configurações", 1], ["clients", "Clientes", 1],
  ]);
});

test("selecionar um resultado navega para a página ou subseção correspondente", () => {
  const navigated = [];
  const openedSettings = [];
  const navigate = (section) => navigated.push(section);
  const openSettingsSection = (section) => openedSettings.push(section);
  for (const section of ["dashboard", "agenda", "clientes", "procedimentos", "estoque", "compras", "orcamentos", "pagamentos", "financeiro", "relatorios", "configuracoes"]) {
    navigateToSearchResult({ id: section, title: section, description: "", kind: "Área do site", section }, navigate, openSettingsSection);
  }
  navigateToSearchResult({ id: "security", title: "Segurança", description: "", kind: "Configuração", section: "configuracoes", settingsSection: "Segurança e permissões" }, navigate, openSettingsSection);
  assert.deepEqual(navigated, ["dashboard", "agenda", "clientes", "procedimentos", "estoque", "compras", "orcamentos", "pagamentos", "financeiro", "relatorios", "configuracoes"]);
  assert.deepEqual(openedSettings, ["Segurança e permissões"]);
});

test("destaca o termo sem diferenciar acentos e preserva o texto restante", () => {
  assert.deepEqual(splitSearchHighlight("Segurança e permissões", "seguranca"), [
    { text: "Segurança", match: true }, { text: " e permissões", match: false },
  ]);
  assert.deepEqual(splitSearchHighlight("Ana Souza", "xyz"), [{ text: "Ana Souza", match: false }]);
});

test("ações rápidas exigem intenção de criação e respeitam acesso da área", () => {
  assert.deepEqual(collectSearchQuickActions("agendamento", allAccess), []);
  assert.deepEqual(collectSearchQuickActions("Novo agendamento", allAccess).map(({ id }) => id), ["new-appointment"]);
  assert.deepEqual(collectSearchQuickActions("criar orçamento", { ...allAccess, quotes: false }), []);
  assert.deepEqual(collectSearchQuickActions("cadastrar cliente", allAccess).map(({ id }) => id), ["new-client"]);
});

test("sugere termos próximos sem revelar áreas sem permissão", () => {
  assert.ok(suggestFeatureSearchTerms("agnda", allAccess).includes("Agenda"));
  assert.equal(suggestFeatureSearchTerms("seguraca", { ...allAccess, settingsPermissions: false }).includes("Segurança e permissões"), false);
  assert.deepEqual(suggestFeatureSearchTerms("abc", allAccess), []);
  assert.ok(suggestFeatureSearchTerms("financiro", allAccess).length <= 3);
});

test("expande a prévia sem perder resultados e respeita o limite inicial", () => {
  const results = Array.from({ length: 8 }, (_, index) => `resultado-${index + 1}`);
  assert.deepEqual(previewSearchResults(results, false), { results: results.slice(0, 5), hiddenCount: 3 });
  assert.deepEqual(previewSearchResults(results.slice(0, 5), false), { results: results.slice(0, 5), hiddenCount: 0 });
  assert.deepEqual(previewSearchResults(results, true), { results, hiddenCount: 0 });
  assert.deepEqual(previewSearchResults([], false), { results: [], hiddenCount: 0 });
});

test("teclado percorre opções, contorna as extremidades e seleciona apenas índice válido", () => {
  assert.deepEqual(searchKeyboardAction("ArrowDown", -1, 3), { type: "move", index: 0 });
  assert.deepEqual(searchKeyboardAction("ArrowDown", 2, 3), { type: "move", index: 0 });
  assert.deepEqual(searchKeyboardAction("ArrowUp", 0, 3), { type: "move", index: 2 });
  assert.deepEqual(searchKeyboardAction("ArrowUp", -1, 3), { type: "move", index: 2 });
  assert.deepEqual(searchKeyboardAction("ArrowUp", 6, 3), { type: "move", index: 2 });
  assert.deepEqual(searchKeyboardAction("Enter", 1, 3), { type: "select", index: 1 });
  assert.equal(searchKeyboardAction("Enter", 3, 3), null);
  assert.equal(searchKeyboardAction("Enter", -1, 0), null);
  assert.deepEqual(searchKeyboardAction("Enter", -1, 0, true), { type: "retry" });
  assert.equal(searchKeyboardAction("ArrowDown", -1, 0), null);
  assert.deepEqual(searchKeyboardAction("Escape", -1, 0), { type: "close" });
  assert.equal(searchKeyboardAction("Tab", 0, 3), null);
});

test("ações rápidas cobrem todos os cadastros e nunca aparecem sem intenção explícita", () => {
  const cases = [
    ["criar agenda", "new-appointment", "agenda"], ["novo cliente", "new-client", "patients"],
    ["adicionar procedimento", "new-procedure", "procedures"], ["novo orçamento", "new-quote", "quotes"],
    ["registrar pagamento", "new-payment", "payments"],
  ];
  for (const [query, expectedId] of cases) {
    assert.ok(collectSearchQuickActions(query, allAccess).some(({ id }) => id === expectedId), query);
  }
  for (const [query, , restrictedAccess] of cases) {
    assert.deepEqual(collectSearchQuickActions(query, { ...allAccess, [restrictedAccess]: false }), [], query);
  }
  assert.deepEqual(collectSearchQuickActions("criar relatório", allAccess), []);
  assert.deepEqual(collectSearchQuickActions("novo", allAccess), []);
});

test("destaque trata consultas vazias, caixa, acentos e caracteres fora do BMP", () => {
  assert.deepEqual(splitSearchHighlight("Segurança", ""), [{ text: "Segurança", match: false }]);
  assert.deepEqual(splitSearchHighlight("Clínica clínica", "CLINICA").map(({ text, match }) => [text, match]), [["Clínica", true], [" ", false], ["clínica", true]]);
  assert.deepEqual(splitSearchHighlight("🩺 Agenda", "agenda"), [{ text: "🩺 ", match: false }, { text: "Agenda", match: true }]);
});
