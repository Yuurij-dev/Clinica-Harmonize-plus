import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { quoteForPlan, stripQuoteCosts } from "../src/lib/plan-data.ts";
import { costsAreHidden, resolveReportAccess } from "../src/lib/reports-access.ts";
import { createDefaultRolePermissionMatrix } from "../src/lib/permissions.ts";
import { evaluateSetup, setupUnavailableSteps, SETUP_STEPS } from "../src/lib/setup-rules.ts";
import { resolveEntitlements } from "../src/lib/entitlements.ts";
import { hasFeature } from "../src/lib/plan-guards.ts";

// ===== Dados por plano (puro) =====

test("stripQuoteCosts remove costs e costTotalCents do retrato do orçamento, preserva o resto e entradas inválidas", () => {
  const details = JSON.stringify({ items: [{ procedureId: "p1", name: "Botox", quantity: 1, unitPriceCents: 100000, discountCents: 0, subtotalCents: 100000 }], totalCents: 120000, costs: { laborCents: 10000, facilityCents: 5000, medicationCents: 5000 }, costTotalCents: 20000 });
  const stripped = JSON.parse(stripQuoteCosts(details));
  assert.equal("costs" in stripped, false);
  assert.equal("costTotalCents" in stripped, false);
  assert.equal(stripped.totalCents, 120000);
  assert.equal(stripped.items[0].name, "Botox");
  // sem custo no texto, devolve o mesmo valor; JSON inválido/array/não-string passam como vieram
  assert.equal(stripQuoteCosts('{"items":[]}'), '{"items":[]}');
  assert.equal(stripQuoteCosts("{ cost quebrado"), "{ cost quebrado");
  assert.equal(stripQuoteCosts('[{"costs":1}]'), '[{"costs":1}]');
  assert.equal(stripQuoteCosts(undefined), undefined);
  assert.equal(stripQuoteCosts(42), 42);
});

test("quoteForPlan: só remove custos quando a clínica NÃO tem o recurso costs", () => {
  const quote = { id: "q1", total: 1200, details: JSON.stringify({ totalCents: 120000, costs: { laborCents: 1 } }) };
  assert.equal(quoteForPlan(quote, true), quote);
  assert.equal("costs" in JSON.parse(quoteForPlan(quote, false).details), false);
  assert.equal(quoteForPlan(quote, false).id, "q1");
  const noDetails = { id: "q2" };
  assert.equal(quoteForPlan(noDetails, false), noDetails);
});

test("hasFeature reflete o plano: Start sem recursos, Pro/Premium/teste com estoque, compras, ficha e custos", () => {
  const at = new Date("2026-11-20T12:00:00Z");
  const ent = (subscription) => ({ entitlements: resolveEntitlements(subscription, at) });
  const start = ent({ plan: "start", status: "ACTIVE" });
  for (const feature of ["stock", "purchases", "technicalSheet", "costs"]) assert.equal(hasFeature(start, feature), false, feature);
  for (const plan of ["pro", "premium"]) {
    const user = ent({ plan, status: "ACTIVE" });
    for (const feature of ["stock", "purchases", "technicalSheet", "costs"]) assert.equal(hasFeature(user, feature), true, `${plan}/${feature}`);
  }
  const trial = ent({ plan: null, status: "TRIALING", trialEndsAt: new Date("2026-11-21T12:00:00Z") });
  assert.equal(hasFeature(trial, "stock"), true);
  // somente leitura continua vendo os recursos do plano (os dados nao somem); sem assinatura nao ve nada
  assert.equal(hasFeature(ent({ plan: "pro", status: "EXPIRED" }), "stock"), true);
  assert.equal(hasFeature(ent(null), "stock"), false);
});

// ===== Assistente inicial =====

test("assistente: sem estoque, custos e financeiro as etapas materiais, produtos, custos e financeiro não existem (e o total só conta as disponíveis)", () => {
  const start = setupUnavailableSteps(() => false);
  assert.deepEqual(start, ["materiais", "produtos", "custos", "financeiro"]);
  assert.deepEqual(setupUnavailableSteps(() => true), []);
  assert.deepEqual(setupUnavailableSteps((feature) => feature === "stock"), ["custos", "financeiro"]);
  assert.deepEqual(setupUnavailableSteps((feature) => feature !== "finance"), ["financeiro"]);
  const snapshot = { name: "C", phone: "1", address: "a", professionalCount: 1, procedureCount: 1, materialCount: 0, productCount: 0, recurringExpenseCount: 0, openingTime: "08:00", closingTime: "19:00", professionalOpeningTime: "09:00", professionalClosingTime: "18:00", appointmentNotificationsEnabled: true, appointmentNotificationSoundEnabled: true, stockNotificationsEnabled: true, expiryWarningDays: 30, pendingInvitations: 0 };
  const full = evaluateSetup(snapshot, {}, false, []);
  const filtered = evaluateSetup(snapshot, {}, false, start);
  assert.equal(full.total, SETUP_STEPS.length);
  assert.equal(filtered.total, SETUP_STEPS.length - 4);
  assert.deepEqual(filtered.steps.map((step) => step.key).filter((key) => ["materiais", "produtos", "custos", "financeiro"].includes(key)), []);
  assert.equal(filtered.steps[filtered.steps.length - 1].key, "revisao");
  // a etapa pendente nunca aponta para uma etapa indisponível
  assert.ok(!start.includes(filtered.nextPendingKey));
});

// ===== Relatórios =====

const adminWith = (features) => ({ role: "ADMIN", name: "Admin", isOwner: true, rolePermissions: createDefaultRolePermissionMatrix(), ...(features ? { features } : {}) });

test("relatórios: aba Estoque e custos derivados de material dependem do recurso stock", () => {
  const without = resolveReportAccess(adminWith(new Set()));
  assert.equal(without.capabilities.stock, false);
  assert.equal(without.costsHidden, true);
  assert.equal(costsAreHidden(without), true);
  const withStock = resolveReportAccess(adminWith(new Set(["stock"])));
  assert.equal(withStock.capabilities.stock, true);
  assert.equal(costsAreHidden(withStock), false);
  // sem a informacao de plano (testes puros/legado) nada muda
  const legacy = resolveReportAccess(adminWith(undefined));
  assert.equal(legacy.capabilities.stock, true);
  assert.equal(costsAreHidden(legacy), false);
  // escopo de profissional continua escondendo custos, com ou sem estoque
  const professional = resolveReportAccess({ ...adminWith(new Set(["stock"])), role: "PROFESSIONAL", name: "Dra. Ana", isOwner: false });
  assert.equal(costsAreHidden({ ...professional }), costsAreHidden(professional));
  assert.equal(costsAreHidden({ forcedProfessional: "Dra. Ana", costsHidden: false }), true);
});

// ===== Estrutura: nenhuma rota de módulo restrito sem trava de plano =====

const apiRoot = join(process.cwd(), "src", "app", "api");
const routes = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path); else if (name === "route.ts") routes.push(path);
  }
})(apiRoot);
const rel = (file) => relative(process.cwd(), file).replaceAll("\\", "/");
const read = (file) => readFileSync(file, "utf8");
function handlers(source) {
  const marks = [...source.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)];
  return marks.map((mark) => {
    const close = source.indexOf("\n}", mark.index);
    return { method: mark[1], code: source.slice(mark.index, close < 0 ? source.length : close + 2) };
  });
}

const gated = [
  ["stock", ["products/route.ts", "products/[id]/route.ts", "products/[id]/movements/route.ts", "products/[id]/initial-balance/route.ts", "stock-catalog/route.ts", "stock/alerts/route.ts", "stock/pending/route.ts", "stock/pending/[id]/route.ts", "stock/movements/[id]/reverse/route.ts", "clinic/stock-settings/route.ts", "appointments/[id]/materials/route.ts"]],
  ["purchases", ["purchases/route.ts", "purchases/[id]/route.ts"]],
];

test("toda rota de estoque, compras e custos exige o recurso do plano em TODOS os handlers", () => {
  for (const [feature, files] of gated) {
    for (const file of files) {
      const code = read(join(apiRoot, file));
      for (const handler of handlers(code)) {
        const ok = code && (handler.code.includes(`denyUnlessFeature(user, "${feature}"`) || new RegExp(`adminUser\\((?:true|false), "[a-z:]+", "${feature}"\\)`).test(handler.code));
        assert.ok(ok, `${file} ${handler.method}: falta a trava do recurso ${feature}`);
      }
    }
  }
});

test("a trava do recurso vem DEPOIS do login (401) e do bloqueio de somente leitura, e leitura usa 'read'", () => {
  for (const [, files] of gated) {
    for (const file of files) {
      for (const handler of handlers(read(join(apiRoot, file)))) {
        const guard = handler.code.search(/denyUnlessFeature\(user|adminUser\(/);
        const auth = handler.code.search(/getCurrentUser\(|adminUser\(/);
        assert.ok(auth >= 0 && auth <= guard, `${file} ${handler.method}: trava antes do login`);
        if (handler.method === "GET") assert.ok(!/denyUnlessFeature\(user, "[a-z]+", "write"\)/.test(handler.code), `${file}: GET não deve exigir escrita`);
        else if (handler.code.includes("denyUnlessFeature(user,")) assert.ok(/denyUnlessFeature\(user, "[a-z]+", "write"\)/.test(handler.code), `${file} ${handler.method}: escrita deve usar "write"`);
      }
    }
  }
});

test("nenhuma outra rota lê ou grava estoque/compras fora das protegidas sem checar o recurso", () => {
  const protectedFiles = new Set(gated.flatMap(([, files]) => files).map((file) => `src/app/api/${file}`));
  const allowedWithChecks = new Set([
    "src/app/api/search/route.ts",                                      // clausulas de estoque/compras condicionadas a hasFeature
    "src/app/api/patients/[id]/history/route.ts",                       // movimentos/pendencias so com stock
    "src/app/api/patients/[id]/encounters/route.ts",                    // pendencias so com stock
    "src/app/api/patients/[id]/procedure-sessions/route.ts",            // produtos/saldos so com stock
    "src/app/api/patients/[id]/procedure-sessions/[sessionId]/route.ts",// baixa so com stock
    "src/app/api/patients/[id]/journeys/[journeyId]/route.ts",          // so apaga pendencias da propria jornada (limpeza)
    "src/app/api/quotes/options/route.ts",                              // ficha/custos so com os recursos
    "src/app/api/procedures/route.ts", "src/app/api/procedures/[id]/route.ts",
  ]);
  const offenders = routes.map(rel).filter((file) => !protectedFiles.has(file) && !allowedWithChecks.has(file) && /prisma\.(product|stockLot|stockMovement|pendingStockOutput|purchase|purchaseItem|procedureMaterial)\b|lotBalances\(|registerAttendanceOutputs\(/.test(read(file)));
  assert.deepEqual(offenders, []);
  // a limpeza de pendencias ao apagar uma jornada nao le nem expoe dado de estoque: fica fora da exigencia
  for (const file of [...allowedWithChecks].filter((item) => !item.includes("journeys/[journeyId]"))) assert.ok(/hasFeature\(user,|denyUnlessFeature\(user,/.test(read(file)), `${file}: usa dados de módulo restrito sem checar o recurso`);
});

test("conferência de materiais pendente só é GRAVADA com o recurso stock (todos os caminhos)", () => {
  // grava = aparece dentro de data: { ... materialsCheck: "pending" } (as leituras/filtros das rotas de estoque ficam de fora)
  const writers = routes.filter((file) => /data:\s*\{[^}]*materialsCheck: "pending"/.test(read(file))).map(rel).sort();
  assert.deepEqual(writers, [
    "src/app/api/appointments/[id]/route.ts",
    "src/app/api/appointments/auto-process/route.ts",
    "src/app/api/patients/[id]/procedure-sessions/[sessionId]/follow-ups/route.ts",
  ]);
  for (const file of writers) assert.ok(/hasFeature\(user, "stock"\)/.test(read(join(process.cwd(), file))), file + " grava materialsCheck pending sem checar o recurso stock");
});

test("cost-settings: dados gerais valem para todos os planos; só os campos de custo dependem do recurso costs", () => {
  const code = read(join(apiRoot, "clinic/cost-settings/route.ts"));
  assert.ok(code.includes("function settingsForPlan("), "GET/PATCH devem omitir os campos de custo sem o recurso");
  assert.ok(code.includes("settingsForPlan(settings, hasFeature(user, \"costs\"))"), "GET omite custos sem costs");
  assert.ok(code.includes("settingsForPlan(settings, costsAllowed)"), "PATCH omite custos sem costs");
  assert.ok(code.includes("denyUnlessFeature(user, \"costs\", \"write\")"), "enviar campo de custo sem o recurso é 403");
  assert.ok(!code.includes("denyUnlessFeature(user, \"costs\", \"read\")"), "o GET não pode ser bloqueado: traz os dados gerais da clínica");
  for (const field of ["laborCost", "facilityCost", "medicationCost", "professionalHourlyCost"]) assert.ok(code.includes(`\"${field}\"`), field);
});

test("custos: orçamento nunca grava retrato de custos sem o recurso costs e quotes/options omite a chave", () => {
  for (const file of ["quotes/route.ts", "quotes/[id]/route.ts"]) {
    const code = read(join(apiRoot, file));
    assert.ok(code.includes('hasFeature(user, "costs")'), `${file}: não checa costs`);
    assert.ok(/costsAllowed(?: \|\| historical)? \? \{ \.\.\.calculated, costs: costSnapshot \} : quoteWithoutCostFields\(calculated\)/.test(code.replace(/\s+/g, " ")), `${file}: retrato de custos deve ser condicionado ao recurso`);
    assert.ok(code.includes("quoteForPlan("), `${file}: respostas devem remover custos sem o recurso`);
  }
  const options = read(join(apiRoot, "quotes/options/route.ts"));
  assert.ok(options.includes("...(costSnapshot ? { costs:"), "quotes/options deve omitir a chave costs (nunca zerar)");
  const team = read(join(apiRoot, "team/route.ts"));
  assert.ok(team.includes('denyUnlessFeature(user, "costs", "write")'), "alterar custo de mão de obra exige costs");
});

test("orçamento: PATCH sem costs preserva o retrato histórico (storedQuoteCosts)", async () => {
  const { storedQuoteCosts } = await import("../src/lib/plan-data.ts");
  const details = JSON.stringify({ items: [], totalCents: 1, costs: { laborCents: 7500, facilityCents: 2000, medicationCents: 1000 } });
  assert.deepEqual(storedQuoteCosts(details), { laborCents: 7500, facilityCents: 2000, medicationCents: 1000 });
  assert.equal(storedQuoteCosts(JSON.stringify({ items: [] })), null);
  assert.equal(storedQuoteCosts("não é json costs"), null);
  assert.equal(storedQuoteCosts(JSON.stringify({ costs: { laborCents: -1, facilityCents: 0, medicationCents: 0 } })), null);
  assert.ok(read(join(apiRoot, "quotes/[id]/route.ts")).includes("storedQuoteCosts(existingDetails)"));
});

test("ordem: permissão do papel vem antes do recurso do plano nas rotas de estoque/compras", () => {
  const files = ["appointments/[id]/materials/route.ts", "clinic/stock-settings/route.ts", "products/route.ts", "products/[id]/initial-balance/route.ts", "purchases/route.ts", "purchases/[id]/route.ts", "stock/alerts/route.ts", "stock/movements/[id]/reverse/route.ts", "stock/pending/route.ts", "stock/pending/[id]/route.ts", "stock-catalog/route.ts"];
  for (const file of files) {
    for (const handler of read(join(apiRoot, file)).split(/export async function /).slice(1)) {
      const feature = handler.indexOf("denyUnlessFeature(");
      const role = handler.search(/denyUnless\(|canForUser\(/);
      assert.ok(role >= 0 && role < feature, `${file}: papel deve ser checado antes do recurso`);
    }
  }
});

// ===== Etapa 6: relatórios, financeiro, Google Agenda e automações =====

const apiFile = (file) => read(join(apiRoot, file));
const planHandlerOk = (code, feature) => new RegExp(`denyUnlessFeature\\(user, "${feature}"`).test(code) || new RegExp(`adminUser\\((?:true|false), "[a-z:]+", "${feature}"\\)`).test(code);

test("financeiro: todo handler de /finance, /expenses e /recurring-expenses exige o recurso finance, depois do papel", () => {
  const files = ["finance/accounts/route.ts", "finance/flow/route.ts", "finance/movements/route.ts", "finance/summary/route.ts", "expenses/route.ts", "expenses/[id]/route.ts", "recurring-expenses/route.ts", "recurring-expenses/[id]/route.ts", "recurring-expenses/sync/route.ts"];
  for (const file of files) {
    for (const handler of handlers(apiFile(file))) {
      assert.ok(planHandlerOk(handler.code, "finance"), `${file} ${handler.method}: falta o recurso finance`);
      const login = handler.code.indexOf("getCurrentUser(");
      const readonly = handler.code.indexOf("denyIfReadonly(");
      const role = handler.code.search(/canForUser\(/);
      const plan = handler.code.indexOf('denyUnlessFeature(user, "finance"');
      assert.ok(login >= 0 && role > login && plan > role, `${file} ${handler.method}: ordem login -> papel -> plano`);
      if (handler.method === "GET") assert.ok(!handler.code.includes('"finance", "write"'), `${file}: GET não exige escrita`);
      else {
        assert.ok(readonly > login && readonly < role, `${file} ${handler.method}: somente leitura antes do papel`);
        assert.ok(handler.code.includes('"finance", "write"'), `${file} ${handler.method}: escrita usa "write"`);
      }
    }
  }
});

test("financeiro: nenhuma outra rota lê despesas; busca só pesquisa despesas com o recurso; pagamento do orçamento segue livre", () => {
  const financeFiles = new Set(["finance/accounts", "finance/flow", "finance/movements", "finance/summary", "expenses", "expenses/[id]", "recurring-expenses", "recurring-expenses/[id]", "recurring-expenses/sync"].map((item) => `src/app/api/${item}/route.ts`));
  const offenders = routes.map(rel).filter((file) => !financeFiles.has(file) && /prisma\.(expense|recurringExpense)\b|"Expense"|"RecurringExpense"/.test(read(file)));
  // compras criam/cancelam a despesa da compra (já exigem purchases, que depende de finance)
  assert.deepEqual(offenders.filter((file) => !["src/app/api/purchases/route.ts", "src/app/api/purchases/[id]/route.ts"].includes(file)), ["src/app/api/search/route.ts"]);
  assert.ok(/canForUser\(user, "finance:access"\) && hasFeature\(user, "finance"\)/.test(apiFile("search/route.ts")));
  for (const file of ["payments/route.ts", "payments/[id]/route.ts"]) assert.ok(!/"finance"/.test(apiFile(file)), `${file}: pagamento de orçamento não depende do módulo financeiro`);
});

test("relatórios: toda rota /reports/* passa por reportContext/reportDocumentRequest (o gate de plano mora em reports-http)", () => {
  const dir = join(apiRoot, "reports");
  const reportRoutes = routes.filter((file) => file.startsWith(dir));
  assert.equal(reportRoutes.length, 11);
  for (const file of reportRoutes) {
    const code = read(file);
    assert.ok(/reportContext\(|reportDocumentRequest\(/.test(code), `${rel(file)}: sem o gate de relatórios`);
    assert.ok(!/prisma\./.test(code), `${rel(file)}: não consulta o banco direto`);
  }
  assert.ok(apiFile("reports/overview/route.ts").includes('kind: "overview"'), "visão geral exige reportsAdvanced");
  assert.ok(apiFile("reports/export/route.ts").includes("reportDocumentRequest(request, scope, user, true)"), "exportação exige reportsExport");
  const http = read(join(process.cwd(), "src", "lib", "reports-http.ts"));
  assert.ok(http.indexOf("roleCapabilities[need]") > 0 && http.indexOf("roleCapabilities[need]") < http.indexOf("missingReportFeature("), "papel antes do plano");
  assert.ok(http.indexOf("access.allowed") < http.indexOf("missingReportFeature("), "papel antes do plano");
});

test("Google Agenda: connect/sync/status/callback exigem googleCalendar; desconectar não é bloqueado nem por plano nem por somente leitura", () => {
  const base = "integrations/google-calendar/";
  for (const route of ["connect", "sync"]) {
    const code = apiFile(`${base}${route}/route.ts`);
    assert.ok(code.includes('denyUnlessFeature(user, "googleCalendar"'), `${route}: falta o recurso`);
    assert.ok(code.indexOf("getCurrentUser(") < code.indexOf('denyUnlessFeature(user, "googleCalendar"'), `${route}: plano antes do login`);
  }
  const status = apiFile(`${base}status/route.ts`);
  assert.ok(status.indexOf('role === "STAFF"') < status.indexOf('hasFeature(user, "googleCalendar")'), "status: papel antes do plano");
  const sync = apiFile(`${base}sync/route.ts`);
  assert.ok(sync.indexOf('canConnectCalendar(actor, "PROFESSIONAL")') < sync.indexOf('denyUnlessFeature(user, "googleCalendar"'), "sync: papel antes do plano");
  const connect = apiFile(`${base}connect/route.ts`);
  assert.ok(connect.indexOf("startCalendarOAuth(") < connect.indexOf('denyUnlessFeature(user, "googleCalendar"'), "connect: papel antes do plano");
  assert.ok(apiFile(`${base}callback/route.ts`).includes('hasFeature(user, "googleCalendar")'));
  assert.ok(!/denyIfReadonly|denyUnlessFeature|hasFeature/.test(apiFile(`${base}disconnect/route.ts`)), "desconectar continua permitido em qualquer plano e em somente leitura");
});

test("Google Agenda: fila, processador, backfill e e-mails ao profissional respeitam o plano da clínica", () => {
  const lib = (file) => read(join(process.cwd(), "src", "lib", file));
  assert.ok(lib("calendar-appointment-hooks.ts").includes('clinicHasFeature(db, change.clinicId, "googleCalendar")'), "enqueue");
  assert.ok(lib("calendar-appointment-hooks.ts").includes('clinicHasFeature(db, change.clinicId, "emailNotifications")'), "e-mail ao profissional");
  assert.ok(lib("calendar-sync-job-processor.ts").includes("clinicCanSyncCalendar") && lib("calendar-sync-job-processor.ts").includes("clinicsBlockedForCalendarSync"), "processador/cron");
  assert.ok(lib("plan-usage.ts").includes('entitlements.features.has("googleCalendar")'), "clinicCanSyncCalendar/clinicsBlockedForCalendarSync exigem o recurso googleCalendar");
  assert.ok(lib("calendar-runtime.ts").includes('clinicHasFeature(prisma, input.clinicId, "googleCalendar")'), "backfill");
});

test("automações e e-mails: auto-process, falta automática, avanço de jornada e e-mails ao paciente exigem o recurso do plano", () => {
  const autoProcess = apiFile("appointments/auto-process/route.ts");
  assert.ok(autoProcess.includes('denyUnlessFeature(user, "agendaAutomations", "write")'));
  assert.ok(autoProcess.indexOf('canForUser(user, "agenda:access")') < autoProcess.indexOf('"agendaAutomations", "write"'), "papel antes do plano");
  assert.ok(apiFile("patients/[id]/history/route.ts").includes('!hasFeature(user, "agendaAutomations")'), "falta automática no histórico");
  assert.ok(apiFile("patients/route.ts").includes('hasFeature(user, "agendaAutomations")') && apiFile("patients/[id]/route.ts").includes('hasFeature(user, "agendaAutomations")'), "avanço de jornada");
  assert.ok(apiFile("appointments/route.ts").includes('hasFeature(user, "emailNotifications")'));
  assert.ok(apiFile("appointments/[id]/route.ts").includes('hasFeature(user, "emailNotifications")'));
  const prefs = apiFile("clinic/preferences/route.ts");
  assert.ok(prefs.includes('autoMarkMissedAppointmentsEnabled: "agendaAutomations"') && prefs.includes("denyUnlessFeature(user, requiredFeature"));
  assert.ok(apiFile("clinic/role-permissions/route.ts").includes('denyUnlessFeature(user, "rolePermissions", "write")'));
});

test("googleCalendar: clinicsWithoutFeature separa Premium/teste de Start/Pro/sem assinatura (fila e cron)", async () => {
  const { clinicsWithoutFeature, clinicHasFeature } = await import("../src/lib/plan-usage.ts");
  const rows = [
    { clinicId: "premium", plan: "premium", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null },
    { clinicId: "pro", plan: "pro", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null },
    { clinicId: "start", plan: "start", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null },
    { clinicId: "trial", plan: null, status: "TRIALING", trialEndsAt: null, currentPeriodEnd: null },
  ];
  const db = {
    clinicSubscription: {
      findMany: async ({ where }) => rows.filter((row) => where.clinicId.in.includes(row.clinicId)),
      findUnique: async ({ where }) => rows.find((row) => row.clinicId === where.clinicId) ?? null,
    },
  };
  assert.deepEqual(await clinicsWithoutFeature(db, ["premium", "pro", "start", "trial", "ghost"], "googleCalendar"), ["pro", "start", "ghost"]);
  assert.deepEqual(await clinicsWithoutFeature(db, ["premium", "pro", "start"], "emailNotifications"), ["start"]);
  assert.deepEqual(await clinicsWithoutFeature(db, [], "googleCalendar"), []);
  assert.equal(await clinicHasFeature(db, "premium", "googleCalendar"), true);
  assert.equal(await clinicHasFeature(db, "pro", "googleCalendar"), false);
  assert.equal(await clinicHasFeature(db, "ghost", "emailNotifications"), false);
});

test("orçamento sem costs não grava costTotalCents (nem zerado)", async () => {
  const { quoteWithoutCostFields } = await import("../src/lib/plan-data.ts");
  const out = quoteWithoutCostFields({ items: [], subtotalCents: 100, discountCents: 0, costTotalCents: 0, totalCents: 100 });
  assert.equal("costTotalCents" in out, false);
  assert.equal(out.totalCents, 100);
});

// ===== Etapa 7 =====

test("relatórios: /api/reports/filters exige só `reports` (sem kind => sem overview/insights), papel antes do plano, e devolve só nomes", async () => {
  const route = apiFile("reports/filters/route.ts");
  assert.ok(route.includes("reportContext(request)") && !route.includes("kind:"), "sem kind: não exige reportsAdvanced");
  assert.ok(!/prisma./.test(route));
  const { missingReportFeature } = await import("../src/lib/reports-access.ts");
  assert.equal(missingReportFeature(new Set(["reports"]), null), null, "Pro (reports) passa");
  assert.equal(missingReportFeature(new Set(), null), "reports", "Start: 403 PLAN_FEATURE");
  assert.equal(missingReportFeature(new Set(["reports"]), "overview"), "reportsAdvanced", "overview continua Premium");
  const http = read(join(process.cwd(), "src", "lib", "reports-http.ts"));
  assert.ok(http.indexOf("access.allowed") < http.indexOf("missingReportFeature("), "papel antes do plano");
  // servidor: só quem pode escolher profissional recebe a lista, sempre da clínica da sessão
  const server = read(join(process.cwd(), "src", "lib", "reports-server.ts"));
  const fn = server.slice(server.indexOf("export async function reportProfessionalNames"), server.indexOf("// ---------- Visão geral"));
  assert.ok(fn.includes("if (!ctx.access.canChooseProfessional) return [];") && fn.includes("where: { clinicId: ctx.clinicId }"));
  const professional = resolveReportAccess({ ...adminWith(new Set(["reports"])), role: "PROFESSIONAL", name: "Dra. Ana", isOwner: false });
  assert.equal(professional.canChooseProfessional, false, "PROFESSIONAL nunca recebe a equipe");
  assert.equal(resolveReportAccess(adminWith(new Set(["reports"]))).canChooseProfessional, true);
});

test("Google Agenda sem o recurso: status responde 200 mínimo (planBlocked + conexão ativa por escopo), nunca e-mail/contadores; STAFF segue 403", async () => {
  const code = apiFile("integrations/google-calendar/status/route.ts");
  assert.ok(code.includes('if (!hasFeature(user, "googleCalendar")) return NextResponse.json(await loadPlanBlockedCalendarStatus(prisma, user)'));
  assert.ok(code.indexOf('role === "STAFF"') < code.indexOf('hasFeature(user, "googleCalendar")'));
  const { loadPlanBlockedCalendarStatus } = await import("../src/lib/google-calendar-connection-service.ts");
  const queries = [];
  const db = { googleCalendarConnection: { findFirst: async (args) => { queries.push(args); return { id: "x" }; } } };
  const admin = { id: "u1", clinicId: "c1", role: "ADMIN", isOwner: true };
  const result = await loadPlanBlockedCalendarStatus(db, admin);
  assert.deepEqual(result, { planBlocked: true, central: true, individual: true });
  assert.deepEqual(Object.keys(result).sort(), ["central", "individual", "planBlocked"]);
  assert.ok(queries.every((query) => query.where.clinicId === "c1" && JSON.stringify(query.select) === '{"id":true}'));
  assert.ok(queries.some((query) => query.where.userId === "u1"), "individual: só do próprio usuário");
  const none = await loadPlanBlockedCalendarStatus({ googleCalendarConnection: { findFirst: async () => null } }, admin);
  assert.deepEqual(none, { planBlocked: true, central: false, individual: false });
  // PROFESSIONAL não consulta nem desconecta a central
  queries.length = 0;
  const pro = await loadPlanBlockedCalendarStatus(db, { id: "u2", clinicId: "c1", role: "PROFESSIONAL", isOwner: false });
  assert.deepEqual(pro, { planBlocked: true, central: false, individual: true });
  assert.equal(queries.length, 1);
});

test("Google Agenda: o processador revalida o recurso E o modo de acesso no banco logo antes de sincronizar cada job", () => {
  const code = read(join(process.cwd(), "src", "lib", "calendar-sync-job-processor.ts"));
  assert.ok(code.includes("clinicCanSyncCalendar(db, job.clinicId"));
  assert.ok(code.indexOf("clinicCanSyncCalendar(db, job.clinicId") < code.indexOf("await syncAppointment("));
  assert.ok(code.includes("clinicsBlockedForCalendarSync("), "groupBy/notIn de bloqueadas mantido");
});

test("plan-usage: clinicCanSyncCalendar e clinicsBlockedForCalendarSync exigem acesso COMPLETO, não só o recurso", async () => {
  const { clinicCanSyncCalendar, clinicsBlockedForCalendarSync } = await import("../src/lib/plan-usage.ts");
  const now = new Date("2026-06-01T00:00:00Z");
  const db = {
    clinicSubscription: {
      findUnique: async ({ where: { clinicId } }) => rows[clinicId] ?? null,
      findMany: async ({ where: { clinicId: { in: ids } } }) => ids.map((id) => rows[id]).filter(Boolean),
    },
  };
  const rows = {
    premiumFull: { clinicId: "premiumFull", plan: "premium", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date("2026-12-01") },
    premiumExpired: { clinicId: "premiumExpired", plan: "premium", status: "EXPIRED", trialEndsAt: null, currentPeriodEnd: new Date("2026-01-01") },
    // PAST_DUE fora da carência de 7 dias (plan-guards): vira somente leitura.
    premiumPastDue: { clinicId: "premiumPastDue", plan: "premium", status: "PAST_DUE", trialEndsAt: null, currentPeriodEnd: new Date("2026-05-01") },
    pro: { clinicId: "pro", plan: "pro", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date("2026-12-01") },
  };
  // Premium com acesso completo: sincroniza. Premium vencido (somente leitura), em carência vencida e Pro (sem o recurso): não.
  assert.equal(await clinicCanSyncCalendar(db, "premiumFull", now), true);
  assert.equal(await clinicCanSyncCalendar(db, "premiumExpired", now), false);
  assert.equal(await clinicCanSyncCalendar(db, "pro", now), false);
  assert.equal(await clinicCanSyncCalendar(db, "ghost", now), false);
  assert.deepEqual(
    (await clinicsBlockedForCalendarSync(db, ["premiumFull", "premiumExpired", "premiumPastDue", "pro", "ghost"], now)).sort(),
    ["ghost", "premiumExpired", "premiumPastDue", "pro"].sort(),
  );
  assert.deepEqual(await clinicsBlockedForCalendarSync(db, [], now), []);
});
