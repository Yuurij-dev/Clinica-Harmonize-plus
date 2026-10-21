// Testes ponta a ponta pela API, com a conta de teste, contra o servidor em execução (npm run dev).
// Uso: npm run test:e2e   (E2E_BASE_URL muda o endereço; padrão http://localhost:3000)
//      npm run test:e2e -- estoque agenda   roda só essas partes (e as que elas precisam); ver `suites` abaixo.
// Precisa de TEST_ACCOUNT_EMAIL e TEST_ACCOUNT_PASSWORD no .env. Só roda na clínica de teste, que é esvaziada
// no começo e no fim de cada execução. A parte de navegador usa o Microsoft Edge instalado (E2E_BROWSER muda o canal).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const testClinicName = "Clínica Teste Auditoria";
const email = process.env.TEST_ACCOUNT_EMAIL;
const password = process.env.TEST_ACCOUNT_PASSWORD;
const run = Date.now().toString(36);
const results = [];
const prisma = new PrismaClient();
let cookie = "";

async function api(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const session = response.headers.getSetCookie().find((value) => value.startsWith("harmonize_session="));
  if (session) cookie = session.split(";")[0];
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
  return { status: response.status, data };
}

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
}

const day = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + offset * 86_400_000));
const randomCpf = () => Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join("");

async function login() {
  const response = await api("POST", "/api/auth/login", { login: email, password });
  if (response.status !== 200) throw new Error(`Login da conta de teste falhou (${response.status}): ${JSON.stringify(response.data)}`);
  if (response.data.user?.clinic?.name !== testClinicName) throw new Error(`A conta de teste não está na "${testClinicName}". Abortado para não mexer em clínica real.`);
}

async function patientsAndPayments() {
  let r = await api("POST", "/api/patients", { name: `Paciente ${run}`, phone: "11999990000", age: 30, cpf: "123" });
  check("CPF inválido no cadastro é recusado", r.status === 400, r.status);
  const cpf = randomCpf();
  r = await api("POST", "/api/patients", { name: `Paciente ${run}`, phone: "11999990000", age: 30, cpf });
  const patient = r.data.patient;
  check("cadastro de paciente", r.status === 201, r.status);
  r = await api("POST", "/api/patients", { name: `Outro ${run}`, phone: "11999990001", age: 31, cpf });
  check("CPF repetido devolve 409", r.status === 409, r.status);
  r = await api("POST", "/api/patients", { name: `Paciente ${run}`, phone: "11999990002", age: 40 });
  const homonym = r.data.patient;

  const before = (await api("GET", "/api/finance/summary?period=month")).data.totals?.receivedCents ?? 0;
  r = await api("POST", "/api/payments", { patient: `Paciente ${run}`, value: 10, method: "Pix", installments: "A vista" });
  check("pagamento só com nome é recusado", r.status === 400, r.status);
  r = await api("POST", "/api/payments", { patientId: homonym.id, value: 150.5, method: "Pix", status: "Pago", installments: "A vista" });
  check("pagamento guarda centavos (R$ 150,50)", r.status === 201 && r.data.payment?.value === 150.5, JSON.stringify(r.data.payment?.value));
  check("pagamento fica no paciente escolhido, não no homônimo", r.data.payment?.patientId === homonym.id);
  r = await api("GET", "/api/payments");
  check("lista de pagamentos devolve reais", r.data.payments?.some((payment) => payment.id && payment.value === 150.5));
  const after = (await api("GET", "/api/finance/summary?period=month")).data.totals?.receivedCents ?? 0;
  check("resumo financeiro soma o pagamento em centavos", after - before === 15_050, `${before} → ${after}`);
  r = await api("GET", "/api/dashboard/bootstrap");
  check("dashboard traz total de atendimentos e valores em reais", typeof r.data.appointmentCount === "number" && r.data.payments?.some((payment) => payment.value === 150.5), r.status);
  return { patient, homonym };
}

async function quotesAndProcedures(patient) {
  let r = await api("POST", "/api/quotes", { patientId: patient.id, items: "Botox (1x)", total: 99.4, expires: "30/12/2030" });
  const quote = r.data.quote;
  check("orçamento guarda centavos (R$ 99,40)", quote?.total === 99.4, JSON.stringify(quote?.total));
  const [a, b] = await Promise.all([api("PATCH", `/api/quotes/${quote.id}`, { status: "Aprovado" }), api("PATCH", `/api/quotes/${quote.id}`, { status: "Aprovado" })]);
  r = await api("GET", `/api/patients/${patient.id}/history?tab=Procedimentos`);
  const fromQuote = r.data.patient?.procedureRecords?.filter((procedure) => procedure.quoteId === quote.id) ?? [];
  check("dois 'Aprovado' simultâneos criam um só procedimento", fromQuote.length === 1, `${a.status}/${b.status}, ${fromQuote.length}`);
  const procedureId = fromQuote[0]?.id;
  r = await api("PATCH", `/api/patients/${patient.id}/procedures/${procedureId}`, { photoType: "clinicId", photo: null });
  check("foto recusa photoType fora de before/after", r.status === 400, r.status);
  r = await api("GET", `/api/patients/${patient.id}/history?tab=Procedimentos`);
  check("procedimento continua no prontuário", r.data.patient?.procedureRecords?.some((procedure) => procedure.id === procedureId));
  return quote;
}

async function appointments(patient) {
  let r = await api("POST", "/api/appointments", { patientId: patient.id, procedure: "Retorno", professional: "Teste", time: "09:00", date: `${day(1)}T00:00:00` });
  const appointment = r.data.appointment;
  check("agendamento para amanhã é criado", r.status === 201, JSON.stringify(r.data).slice(0, 120));
  check("dia do agendamento gravado ao meio-dia de São Paulo", appointment?.date === `${day(1)}T15:00:00.000Z`, appointment?.date);
  r = await api("POST", "/api/appointments", { patient: `Paciente ${run}`, procedure: "Retorno", professional: "Teste", time: "10:00", date: day(1) });
  check("agendamento só com nome é recusado", r.status === 400, r.status);
  r = await api("GET", `/api/patients/${patient.id}/history?tab=Agendamentos`);
  check("histórico não marca falta antes da hora", r.data.patient?.appointments?.find((item) => item.id === appointment?.id)?.status === "Agendado");
  r = await api("PATCH", `/api/appointments/${appointment.id}`, { status: "Qualquer" });
  check("status de agendamento inválido é recusado", r.status === 400, r.status);
  r = await api("PATCH", `/api/appointments/${appointment.id}`, { time: "99:99" });
  check("horário inválido é recusado", r.status === 400, r.status);
  r = await api("PATCH", `/api/appointments/${appointment.id}`, { date: `${day(2)}T10:00:00-03:00`, time: "10:00" });
  check("remarcar mantém o dia escolhido", r.data.appointment?.date === `${day(2)}T15:00:00.000Z`, r.data.appointment?.date);
}

async function journeys(patient, quote) {
  let r = await api("GET", `/api/patients/${patient.id}/journeys`);
  const first = r.data.journeys?.[0];
  check("jornadas trazem marcações de progresso", first?.hasPaidQuote === true && first?.hasProcedure === true, JSON.stringify(first));
  r = await api("POST", `/api/patients/${patient.id}/journeys`, { name: "Jornada 2" });
  const second = r.data.journey;
  r = await api("DELETE", `/api/patients/${patient.id}/journeys/${first.id}`);
  check("jornada com orçamento aprovado não pode ser excluída", r.status === 409, r.status);
  await api("PATCH", `/api/quotes/${quote.id}`, { status: "Pendente" });
  r = await api("DELETE", `/api/patients/${patient.id}/journeys/${first.id}`);
  check("jornada sem orçamento aprovado é excluída", r.status === 200, r.status);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  r = await api("PUT", `/api/patients/${patient.id}/evaluation`, { photos: [{ name: "frente", imageUrl: png, width: 1, height: 1, annotations: [] }] });
  check("avaliação é salva", r.status === 200, r.status);
  r = await api("GET", `/api/patients/${patient.id}/journeys`);
  check("avaliação nova cai na jornada ativa", r.data.journeys?.length === 1 && r.data.journeys[0].id === second?.id && r.data.journeys[0].hasEvaluation, JSON.stringify(r.data.journeys));
}

async function settings() {
  let r = await api("GET", "/api/clinic/cost-settings");
  const current = r.data.settings;
  check("configurações da clínica carregam", r.status === 200 && typeof current?.professionalOpeningTime === "string", r.status);
  const tolerance = current.appointmentToleranceMinutes === 20 ? 25 : 20;
  r = await api("PATCH", "/api/clinic/cost-settings", { ...current, appointmentToleranceMinutes: tolerance });
  check("configurações gravam e devolvem o valor salvo", r.status === 200 && r.data.settings?.appointmentToleranceMinutes === tolerance, JSON.stringify(r.data).slice(0, 160));
}

async function stock(patient) {
  let r = await api("POST", "/api/products", { name: `Material ${run}`, kind: "material", unit: "frasco", costCents: 1000, supplier: "Fornecedor", minStock: 0 });
  const product = r.data.product;
  check("material é criado", r.status === 201, r.status);
  check("item criado guarda o tipo", product?.kind === "material", product?.kind);
  r = await api("POST", "/api/products", { name: `Sem tipo ${run}`, unit: "unidade", costCents: 100, supplier: "Fornecedor" });
  check("item sem tipo é recusado", r.status === 400, r.status);
  r = await api("POST", "/api/products", { name: `Tipo errado ${run}`, kind: "Produto", unit: "unidade", costCents: 100, supplier: "Fornecedor" });
  check("tipo inválido é recusado", r.status === 400, r.status);
  r = await api("POST", "/api/purchases", { supplier: "Fornecedor", purchasedOn: day(0), paymentMethod: "Pix", installments: 1, items: [{ productId: product.id, lotCode: `L${run}`, expiresOn: day(300), quantity: 2, unitPriceCents: 5000 }] });
  const purchaseId = r.data.purchase?.id;
  check("compra é registrada", r.status === 201, r.status);
  r = await api("GET", "/api/expenses?period=month");
  check("compra gera despesa na categoria Estoque", r.data.expenses?.some((expense) => expense.category === "Estoque"), JSON.stringify(r.data.expenses?.map((expense) => expense.category)));
  const balance = async () => (await api("GET", `/api/products/${product.id}`)).data.product?.lots?.reduce((sum, lot) => sum + lot.balance, 0);
  check("compra soma ao saldo", (await balance()) === 2, await balance());
  let pair = await Promise.all([api("PATCH", `/api/purchases/${purchaseId}`, { action: "cancel" }), api("PATCH", `/api/purchases/${purchaseId}`, { action: "cancel" })]);
  check("cancelamento duplo simultâneo: só um passa", pair.map((item) => item.status).sort().join() === "200,409", pair.map((item) => item.status).join());
  check("saldo depois de cancelar é 0", (await balance()) === 0, await balance());
  pair = await Promise.all([api("PATCH", `/api/purchases/${purchaseId}`, { action: "restore" }), api("PATCH", `/api/purchases/${purchaseId}`, { action: "restore" })]);
  check("restauração dupla simultânea: só uma passa", pair.map((item) => item.status).sort().join() === "200,409", pair.map((item) => item.status).join());
  check("saldo depois de restaurar é 2", (await balance()) === 2, await balance());
  r = await api("PATCH", `/api/products/${product.id}`, { kind: "produto" });
  check("tipo pode ser trocado mesmo com movimentações", r.status === 200 && r.data.product?.kind === "produto", `${r.status} ${r.data.product?.kind}`);
  r = await api("GET", "/api/products");
  check("lista devolve o tipo e não a categoria", r.data.products?.some((item) => item.id === product.id && item.kind === "produto" && !("category" in item)), JSON.stringify(r.data.products?.[0] ?? {}));
  r = await api("PATCH", `/api/products/${product.id}`, { kind: "outro" });
  check("troca para tipo inválido é recusada", r.status === 400, r.status);

  // Tipo nos avisos, na conferência de materiais e nas pendências.
  r = await api("POST", "/api/products", { name: `Faltando ${run}`, kind: "produto", unit: "unidade", costCents: 500, supplier: "Fornecedor", minStock: 10 });
  const low = r.data.product;
  r = await api("GET", "/api/stock/alerts");
  const lowAlert = r.data.alerts?.find((alert) => alert.kind === "below_minimum" && alert.productId === low?.id);
  check("aviso de abaixo do mínimo traz productKind", lowAlert?.productKind === "produto", JSON.stringify(lowAlert));

  r = await api("POST", "/api/appointments", { patientId: patient.id, procedure: "Retorno estoque", professional: "Teste", time: "11:00", date: `${day(1)}T00:00:00` });
  const attendance = r.data.appointment;
  r = await api("PATCH", `/api/appointments/${attendance?.id}`, { status: "Atendido" });
  check("atendimento marcado como atendido", r.status === 200, r.status);
  r = await api("GET", `/api/appointments/${attendance?.id}/materials`);
  const byId = Object.fromEntries((r.data.materials ?? []).map((item) => [item.id, item.kind]));
  check("conferência de materiais devolve o tipo de cada item", r.status === 200 && byId[product.id] === "produto" && byId[low?.id] === "produto", JSON.stringify(byId));
  r = await api("POST", `/api/appointments/${attendance?.id}/materials`, { items: [{ productId: low.id, quantity: 3 }] });
  check("conferência sem saldo gera pendência", r.status === 200 && r.data.pending?.length === 1, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  r = await api("GET", "/api/stock/pending");
  const output = r.data.outputs?.find((item) => item.product?.id === low.id);
  check("pendência de saída traz product.kind", output?.product?.kind === "produto", JSON.stringify(output?.product));
}

async function loginLockout() {
  const statuses = [];
  for (let attempt = 0; attempt < 10; attempt += 1) statuses.push((await api("POST", "/api/auth/login", { login: email, password: "senha-errada" })).status);
  check("10 senhas erradas devolvem 401", statuses.every((status) => status === 401), statuses.join(","));
  const locked = (await api("POST", "/api/auth/login", { login: email, password })).status;
  check("depois de 10 erros a conta bloqueia, mesmo com a senha certa", locked === 429, locked);
  // Desbloqueia só a conta de teste, para a próxima execução.
  await prisma.user.update({ where: { email }, data: { failedLogins: 0, lockedUntil: null } });
  await login();
  check("senha certa entra depois do desbloqueio", Boolean(cookie));
}

// Telas: os valores aparecem formatados e o pagamento registrado pela tela vai para o paciente escolhido.
// Abre o navegador já logado na conta de teste. pageErrors junta os erros de JavaScript da página.
async function withPage(fn) {
  const instance = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
  try {
    const context = await instance.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
    await context.addCookies([{ name: "harmonize_session", value: cookie.split("=")[1], url: baseUrl }]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(30_000);
    await fn(page, pageErrors);
  } finally {
    await instance.close();
  }
}

async function browser(homonym) {
  await withPage(async (page, pageErrors) => {
    await page.goto(`${baseUrl}/pagamentos`);
    await page.getByRole("cell", { name: "R$ 150,50" }).first().waitFor();
    check("tela de Pagamentos mostra R$ 150,50", true);
    await page.getByRole("button", { name: "Registrar pagamento" }).first().click();
    await page.locator(`select[name="patientId"] option[value="${homonym.id}"]`).waitFor({ state: "attached" });
    await page.locator(`select[name="patientId"]`).selectOption(homonym.id);
    await page.locator(`input[name="value"]`).pressSequentially("1234");
    check("campo de valor formata R$ 12,34", (await page.locator(`input[name="value"]`).inputValue()).replace(/\s/g, " ") === "R$ 12,34", await page.locator(`input[name="value"]`).inputValue());
    await page.locator(`form button[type="submit"]`).click();
    await page.getByRole("cell", { name: "R$ 12,34" }).first().waitFor();
    const saved = (await api("GET", "/api/payments")).data.payments?.find((payment) => payment.value === 12.34);
    check("pagamento pela tela grava 12.34 no paciente escolhido", saved?.patientId === homonym.id, JSON.stringify(saved && { value: saved.value, patientId: saved.patientId }));

    await page.goto(`${baseUrl}/orcamentos`);
    await page.getByRole("cell", { name: "R$ 99,40" }).first().waitFor();
    check("tela de Orçamentos mostra R$ 99,40", true);

    // Estoque: abre em Materiais; o produto só aparece em Produtos; a compra agrupa os itens.
    const material = (await api("POST", "/api/products", { name: `Material tela ${run}`, kind: "material", unit: "frasco", costCents: 100, supplier: "Fornecedor" })).data.product;
    const produto = (await api("POST", "/api/products", { name: `Produto tela ${run}`, kind: "produto", unit: "unidade", costCents: 100, supplier: "Fornecedor" })).data.product;
    await page.goto(`${baseUrl}/estoque`);
    await page.getByText(material.name).first().waitFor();
    check("Estoque abre na aba Materiais e mostra o material", await page.getByRole("button", { name: "Novo material" }).isVisible());
    check("aba Materiais não mostra o produto", (await page.getByText(produto.name).count()) === 0);
    await page.getByRole("button", { name: "Produtos", exact: true }).click();
    await page.getByText(produto.name).first().waitFor();
    check("aba Produtos mostra o produto, tem o botão Novo produto e não mostra o material", (await page.getByText(material.name).count()) === 0 && await page.getByRole("button", { name: "Novo produto" }).isVisible());
    // Troca de tipo pela tela: o material sai de Materiais e passa a aparecer em Produtos.
    const trocado = (await api("POST", "/api/products", { name: `Troca de tipo ${run}`, kind: "material", unit: "frasco", costCents: 100, supplier: "Fornecedor" })).data.product;
    await page.goto(`${baseUrl}/estoque`);
    await page.getByRole("button", { name: "Materiais", exact: true }).click();
    await page.getByText(trocado.name).first().waitFor();
    await page.getByRole("row").filter({ hasText: trocado.name }).getByRole("button", { name: "Abrir" }).click();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page.locator('select[name="kind"]').selectOption("produto");
    await page.getByRole("button", { name: /^Salvar / }).click();
    await page.locator('select[name="kind"]').waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Produtos", exact: true }).click();
    await page.getByText(trocado.name).first().waitFor();
    await page.getByRole("button", { name: "Materiais", exact: true }).click();
    const naLista = await page.getByRole("row").filter({ hasText: trocado.name }).count();
    const tipoGravado = (await api("GET", `/api/products/${trocado.id}`)).data.product?.kind;
    check("trocar o tipo pela tela move o item de Materiais para Produtos", naLista === 0 && tipoGravado === "produto", `linhas em Materiais: ${naLista}, tipo: ${tipoGravado}`);
    check("Estoque não tem mais as abas Compras e Pendências", (await page.getByRole("main").getByRole("button", { name: /^(Compras|Pendências)$/ }).count()) === 0);
    // Compras e Pendências ficam numa seção própria do menu.
    await page.getByRole("navigation").getByRole("button", { name: "Compras" }).first().click();
    await page.waitForURL(`${baseUrl}/compras`);
    await page.getByRole("main").getByRole("button", { name: "Pendências", exact: true }).click();
    await page.getByLabel("Tipo de pendência").waitFor();
    check("menu Compras abre a seção com a aba Pendências", true);
    await page.getByRole("main").getByRole("button", { name: "Compras", exact: true }).click();
    await page.getByRole("button", { name: "Nova compra" }).first().click();
    const itemSelect = page.locator("select").filter({ has: page.locator("option", { hasText: "Selecione um item" }) }).first();
    await itemSelect.locator(`optgroup[label="Materiais"] option`, { hasText: material.name }).waitFor({ state: "attached" });
    check("seleção de item na compra agrupa em Materiais e Produtos", (await itemSelect.locator(`optgroup[label="Produtos"] option`, { hasText: produto.name }).count()) === 1);
    // Aviso de pendência abre Compras direto na aba Pendências, mesmo já estando em Compras.
    const attendance = (await api("POST", "/api/appointments", { patientId: homonym.id, procedure: "Pendência tela", professional: "Teste", time: "15:00", date: `${day(1)}T00:00:00` })).data.appointment;
    await api("PATCH", `/api/appointments/${attendance.id}`, { status: "Atendido" });
    await api("POST", `/api/appointments/${attendance.id}/materials`, { items: [{ productId: material.id, quantity: 1 }] });
    await page.goto(`${baseUrl}/compras`);
    await page.getByRole("button", { name: "Nova compra" }).first().waitFor();
    await page.getByRole("button", { name: "Notificações" }).click();
    await page.getByRole("button", { name: /saída de estoque pendente/ }).click();
    await page.getByLabel("Tipo de pendência").waitFor();
    check("aviso de pendência abre Compras na aba Pendências", page.url() === `${baseUrl}/compras`, page.url());

    // ⚠ no título e no menu de cada seção, só com os avisos dela; passar o mouse mostra a lista.
    const baixo = (await api("POST", "/api/products", { name: `Abaixo tela ${run}`, kind: "material", unit: "frasco", costCents: 100, supplier: "Fornecedor", minStock: 5 })).data.product;
    await page.goto(`${baseUrl}/compras`);
    const titleWarning = page.getByRole("main").getByRole("button", { name: /^\d+ avisos?$/ });
    await titleWarning.hover();
    const comprasTip = page.getByRole("main").getByRole("tooltip");
    await comprasTip.getByText(/saída de estoque pendente/).waitFor();
    check("⚠ de Compras mostra só as pendências", (await comprasTip.getByText(baixo.name).count()) === 0);
    await page.goto(`${baseUrl}/estoque`);
    await titleWarning.hover();
    const estoqueTip = page.getByRole("main").getByRole("tooltip");
    await estoqueTip.getByText(`${baixo.name} abaixo do mínimo`, { exact: false }).waitFor();
    check("⚠ do Estoque mostra o item abaixo do mínimo e não as pendências", (await estoqueTip.getByText(/pendente/).count()) === 0);
    const menu = page.getByRole("navigation");
    check("menu mostra ⚠ em Estoque e em Compras", await menu.getByRole("button", { name: /Estoque/ }).first().getByLabel(/avisos?$/).isVisible() && await menu.getByRole("button", { name: /Compras/ }).first().getByLabel(/avisos?$/).isVisible());

    for (const section of ["dashboard", "agenda", "clientes", "estoque", "compras", "financeiro", "configuracoes"]) {
      await page.goto(`${baseUrl}/${section}`, { waitUntil: "networkidle" });
    }
    check("telas principais abrem sem erro de JavaScript", pageErrors.length === 0, pageErrors.join(" | "));
  });
}

// --- Prontuário, fase 1: anamnese versionada e lista de atendimentos ---

// Roda `fn` com outra sessão (cookie) e restaura a sessão principal depois.
async function withSession(sessionCookie, fn) {
  const saved = cookie;
  cookie = sessionCookie;
  try { return await fn(); } finally { cookie = saved; }
}

async function loginAs(loginName, secret) {
  return withSession("", async () => {
    const response = await api("POST", "/api/auth/login", { login: loginName, password: secret });
    // Colaborador novo entra com sessão de primeiro acesso: troca a senha para obter a sessão completa.
    if (response.status === 200 && response.data.passwordChangeRequired) {
      const changed = await api("POST", "/api/auth/change-password", { password: `${secret}-nova` });
      return { status: changed.status, cookie, data: changed.data };
    }
    return { status: response.status, cookie, data: response.data };
  });
}

async function anamnesis() {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const newPatient = async (label) => {
    const created = await api("POST", "/api/patients", { name: `E2E ${label} ${run}`, phone: "11999990010", age: 35, cpf: randomCpf() });
    if (created.status !== 201) throw new Error(`Paciente "${label}" não criado (${created.status})`);
    return created.data.patient ?? created.data;
  };
  const base = (patient) => `/api/patients/${patient.id}`;
  const overview = async (patient) => (await api("GET", `${base(patient)}/anamnesis`)).data;
  const answer = (value, detail = "") => ({ value, detail });
  const sortedStatuses = (list) => list.map((item) => item.status).sort((a, b) => a - b).join(",");
  const statusMap = (object) => JSON.stringify(Object.fromEntries(Object.entries(object).map(([key, item]) => [key, item.status])));

  const A = await newPatient("Anamnese A");
  const B = await newPatient("Anamnese B");
  const C = await newPatient("Anamnese C");
  const D = await newPatient("Sem dados");

  // 401 sem sessão, em todas as rotas novas.
  const noSession = await withSession("", async () => ({
    get: await api("GET", `${base(A)}/anamnesis`),
    post: await api("POST", `${base(A)}/anamnesis`, { from: "empty" }),
    put: await api("PUT", `${base(A)}/anamnesis`, { draftId: "x", content: {}, expectedUpdatedAt: "x" }),
    del: await api("DELETE", `${base(A)}/anamnesis?draftId=x&expectedUpdatedAt=x`),
    versionGet: await api("GET", `${base(A)}/anamnesis/x`),
    versionPost: await api("POST", `${base(A)}/anamnesis/x`, { action: "complete" }),
    encounters: await api("GET", `${base(A)}/encounters`),
  }));
  check("anamnese e atendimentos sem sessão devolvem 401 em todas as rotas", Object.values(noSession).every((item) => item.status === 401), statusMap(noSession));

  // Estado inicial e entradas inválidas (antes de existir qualquer rascunho).
  let o = await overview(A);
  check("anamnese vazia: sem versões, ausente e sem rascunho", o.restricted === false && o.exists === false && o.state === "AUSENTE" && o.versions?.length === 0 && o.draft === null && o.current === null, JSON.stringify(o).slice(0, 200));
  let r = await api("POST", `${base(A)}/anamnesis`, { from: "qualquer" });
  check("origem inválida da anamnese é recusada", r.status === 400, r.status);
  r = await api("POST", `${base(A)}/anamnesis`, { from: "current" });
  check("nova versão sem anamnese concluída é recusada", r.status === 409, r.status);
  r = await api("POST", `${base(A)}/anamnesis`, { from: "evaluation" });
  check("importar da avaliação sem avaliação devolve 404", r.status === 404, r.status);
  r = await api("POST", `${base(A)}/anamnesis`, { from: "evaluation", evaluationId: "inexistente" });
  check("avaliação inexistente devolve 404", r.status === 404, r.status);
  check("nada foi criado pelas tentativas inválidas", (await overview(A)).versions.length === 0);

  // Avaliações com dados de anamnese: uma da A (a mais recente com dados) e uma da B.
  const evalPhotos = [{ name: "frente", imageUrl: png, width: 1, height: 1, category: "Frontal", annotations: [] }];
  const evalA = await api("PUT", `${base(A)}/evaluation`, { photos: evalPhotos, assessment: { chiefComplaint: "Rugas na testa", patientGoal: "Suavizar", allergies: "Dipirona", contraindications: "Uso de isotretinoína" }, status: "Concluída" });
  const evalB = await api("PUT", `${base(B)}/evaluation`, { photos: evalPhotos, assessment: { chiefComplaint: "Queixa da B" } });
  check("avaliações de teste são salvas", evalA.status === 200 && evalB.status === 200, `${evalA.status}/${evalB.status}`);
  const evaluationAId = evalA.data.evaluation?.id;
  const evaluationBId = evalB.data.evaluation?.id;
  check("avaliações de teste devolvem id", Boolean(evaluationAId && evaluationBId), JSON.stringify(evalA.data).slice(0, 150));
  r = await api("POST", `${base(A)}/anamnesis`, { from: "evaluation", evaluationId: evaluationBId });
  check("avaliação de outro paciente não pode ser importada (404)", r.status === 404, r.status);

  // Corrida: três pedidos simultâneos para o paciente C devolvem o mesmo rascunho.
  const race = await Promise.all([1, 2, 3].map(() => api("POST", `${base(C)}/anamnesis`, { from: "empty" })));
  const raceIds = new Set(race.map((item) => item.data.draft?.id));
  check("criação simultânea de rascunho gera um só rascunho", race.every((item) => [200, 201].includes(item.status)) && raceIds.size === 1 && (await overview(C)).versions.length === 1, race.map((item) => item.status).join(","));

  // Rascunho da A a partir da avaliação mais recente com dados.
  r = await api("POST", `${base(A)}/anamnesis`, { from: "evaluation" });
  const draft = r.data.draft;
  check("rascunho a partir da avaliação é criado (201)", r.status === 201 && r.data.created === true && draft?.version === 1 && draft.status === "RASCUNHO" && draft.origin === "evaluation", `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  check("rascunho traz o texto da avaliação", draft?.content.complaint.chiefComplaint === "Rugas na testa" && draft.content.allergies.notes === "Dipirona" && draft.content.contraindications.notes === "Uso de isotretinoína");
  const allAnswers = [...Object.values(draft.content.health.items), ...Object.values(draft.content.allergies.items)];
  check("texto livre da avaliação não vira Sim/Não (tudo continua null)", allAnswers.every((item) => item.value === null) && draft.content.medications.usesMedication === null && draft.content.previousProcedures.hadPrevious === null);
  check("campo não respondido não gera alerta de Sim/Não", !draft.alerts.some((alert) => /^(health|allergy)-(?!notes)/.test(alert.id)), JSON.stringify(draft.alerts.map((alert) => alert.id)));
  r = await api("POST", `${base(A)}/anamnesis`, { from: "empty" });
  check("segundo pedido devolve o mesmo rascunho (created false)", r.data.draft?.id === draft.id && r.data.created === false, `${r.status} ${r.data.created}`);
  o = await overview(A);
  check("visão geral: só rascunho", o.state === "SOMENTE_RASCUNHO" && o.draft?.id === draft.id && o.exists === false && o.versions.length === 1);

  // Autosave.
  const content = structuredClone(draft.content);
  content.health.items.hypertension = answer("yes", "controlada");
  content.health.items.diabetes = answer("no");
  content.health.items.chronicDiseases = answer("");
  content.health.items.cardiac = answer("talvez");
  content.allergies.items.latex = answer("yes", "luvas");
  content.medications.usesMedication = "yes";
  content.medications.items = [{ id: "m1", name: "Losartana", purpose: "Pressão", dose: "50 mg", notes: "" }, { id: "m2", name: "", purpose: "", dose: "", notes: "" }];
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content });
  check("autosave sem expectedUpdatedAt é recusado (400)", r.status === 400, r.status);
  r = await api("PUT", `${base(A)}/anamnesis`, { content, expectedUpdatedAt: draft.updatedAt });
  check("autosave sem draftId é recusado (400)", r.status === 400, r.status);
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: "inexistente", content, expectedUpdatedAt: draft.updatedAt });
  check("autosave de rascunho inexistente devolve 404", r.status === 404, r.status);
  const draftB = (await api("POST", `${base(B)}/anamnesis`, { from: "empty" })).data.draft;
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draftB.id, content, expectedUpdatedAt: draftB.updatedAt });
  check("autosave com rascunho de outro paciente devolve 404", r.status === 404, r.status);
  const staleRevision = draft.updatedAt;
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content, expectedUpdatedAt: draft.updatedAt });
  check("autosave grava e devolve nova revisão", r.status === 200 && r.data.updatedAt && r.data.updatedAt !== staleRevision, `${r.status} ${JSON.stringify(r.data)}`);
  let revision = r.data.updatedAt;
  r = await api("GET", `${base(A)}/anamnesis/${draft.id}`);
  const saved = r.data.version?.content;
  check("conteúdo gravado: Sim, Não e detalhe exatos", saved?.health.items.hypertension.value === "yes" && saved.health.items.hypertension.detail === "controlada" && saved.health.items.diabetes.value === "no" && saved.allergies.items.latex.value === "yes", JSON.stringify(saved?.health.items.hypertension));
  check("vazio e valor inválido são salvos como null, nunca como Não", saved?.health.items.chronicDiseases.value === null && saved.health.items.cardiac.value === null && saved.health.items.keloid.value === null && saved.allergies.items.foods.value === null);
  check("autosave não perde a linha de medicamento preenchida", saved?.medications.items.some((row) => row.name === "Losartana"));
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content: { ...content, complaint: { chiefComplaint: "SOBRESCRITA", treatmentGoal: "" } }, expectedUpdatedAt: staleRevision });
  check("autosave com revisão defasada devolve 409 stale", r.status === 409 && r.data.code === "stale", `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  check("revisão defasada não grava nada", (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.content.complaint.chiefComplaint === "Rugas na testa");
  const pair = await Promise.all([1, 2].map((n) => api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content: { ...content, complaint: { chiefComplaint: `Aba ${n}`, treatmentGoal: "" } }, expectedUpdatedAt: revision })));
  check("dois autosaves simultâneos com a mesma revisão: só um grava", sortedStatuses(pair) === "200,409", pair.map((item) => item.status).join(","));
  revision = (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.updatedAt;
  const big = { ...content, procedureSpecific: { texto: "a".repeat(130_000) } };
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content: big, expectedUpdatedAt: revision });
  check("autosave acima de 120 KB devolve 413", r.status === 413, r.status);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "complete", expectedUpdatedAt: revision, content: big });
  check("concluir acima de 120 KB devolve 413", r.status === 413, r.status);
  const clipped = structuredClone(content);
  clipped.complaint.chiefComplaint = "x".repeat(5000);
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content: clipped, expectedUpdatedAt: revision });
  check("texto longo é cortado em 2000 caracteres", r.status === 200 && (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.content.complaint.chiefComplaint.length === 2000, r.status);
  revision = r.data.updatedAt;
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content, expectedUpdatedAt: revision });
  revision = r.data.updatedAt;

  // Conclusão.
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "complete", note: "ok" });
  check("concluir sem expectedUpdatedAt é recusado (400)", r.status === 400, r.status);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "complete", expectedUpdatedAt: staleRevision });
  check("concluir com revisão defasada devolve 409 stale", r.status === 409 && r.data.code === "stale", `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "apagar" });
  check("ação desconhecida é recusada (400)", r.status === 400, r.status);
  const emptyC = race[0].data.draft;
  r = await api("POST", `${base(C)}/anamnesis/${emptyC.id}`, { action: "complete", expectedUpdatedAt: emptyC.updatedAt });
  check("concluir rascunho vazio é recusado (400)", r.status === 400, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
  const done = await Promise.all([1, 2].map(() => api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "complete", expectedUpdatedAt: revision })));
  check("conclusão dupla simultânea: uma conclui, a outra recebe 409", sortedStatuses(done) === "200,409", done.map((item) => item.status).join(","));
  const v1 = (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version;
  check("versão concluída: status, autor e data", v1.status === "CONCLUIDA" && v1.completedBy === "E2E Admin" && Boolean(v1.completedAt), `${v1.status} ${v1.completedBy}`);
  check("conclusão descarta a linha de medicamento vazia", v1.content.medications.items.length === 1 && v1.content.medications.items[0].name === "Losartana");
  check("auditoria registra criação e conclusão", ["draft-created", "completed"].every((action) => v1.audit.some((entry) => entry.action === action && entry.by === "E2E Admin")), JSON.stringify(v1.audit.map((entry) => entry.action)));
  check("alertas só para Sim, com nível e sem apto/inapto", v1.alerts.some((alert) => alert.id === "allergy-latex" && alert.level === "important") && v1.alerts.some((alert) => alert.id === "health-hypertension") && !v1.alerts.some((alert) => alert.id === "health-diabetes") && !/\binapto|\bapto\b|liberad/i.test(JSON.stringify(v1.alerts)), JSON.stringify(v1.alerts.map((alert) => alert.id)));

  // Imutabilidade.
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content: { ...content, complaint: { chiefComplaint: "ALTERADA", treatmentGoal: "" } }, expectedUpdatedAt: v1.updatedAt });
  check("versão concluída não aceita autosave (409)", r.status === 409, r.status);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "complete", expectedUpdatedAt: v1.updatedAt });
  check("concluir de novo uma versão concluída devolve 409", r.status === 409, r.status);
  r = await api("DELETE", `${base(A)}/anamnesis?draftId=${draft.id}&expectedUpdatedAt=${encodeURIComponent(v1.updatedAt)}`);
  check("versão concluída não pode ser apagada", r.status === 404, r.status);
  const v1Again = (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version;
  check("versão concluída permanece intacta", v1Again.content.complaint.chiefComplaint !== "ALTERADA" && v1Again.updatedAt === v1.updatedAt && v1Again.status === "CONCLUIDA");
  r = await api("POST", `${base(A)}/anamnesis`, { from: "empty" });
  check("com versão concluída e sem rascunho, from empty cria rascunho v2 sem tocar a v1", r.status === 201 && r.data.draft.version === 2, `${r.status} ${r.data.draft?.version}`);
  const strayDraft = r.data.draft;
  r = await api("DELETE", `${base(A)}/anamnesis?draftId=${strayDraft.id}&expectedUpdatedAt=${encodeURIComponent(strayDraft.updatedAt)}`);
  check("rascunho vazio extra é descartado", r.status === 200, r.status);

  // Revisão.
  o = await overview(A);
  check("visão geral após concluir: revisada, versão atual e alertas", o.state === "REVISADA" && o.exists === true && o.current?.id === draft.id && o.alerts.some((alert) => alert.id === "allergy-latex"), `${o.state}`);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "confirm-review", note: "Conferido com a paciente" });
  check("confirmar revisão registra autor e data", r.status === 200 && r.data.version.reviewConfirmedBy === "E2E Admin" && Boolean(r.data.version.reviewConfirmedAt) && r.data.version.status === "CONCLUIDA", `${r.status}`);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "" });
  check("pedir revisão sem motivo é recusado (400)", r.status === 400, r.status);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "Paciente engravidou" });
  check("pedir revisão marca pendente com motivo e autor", r.status === 200 && r.data.version.status === "PENDENTE_REVISAO" && r.data.version.reviewReason === "Paciente engravidou" && r.data.version.reviewRequestedBy === "E2E Admin", `${r.status}`);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "de novo" });
  check("pedir revisão duas vezes devolve 409", r.status === 409, r.status);
  o = await overview(A);
  check("visão geral: revisão pendente manual", o.state === "REVISAO_PENDENTE" && o.reason === "manual", `${o.state}`);
  const audit = (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.audit.map((entry) => entry.action);
  check("auditoria guarda revisão confirmada e solicitada", audit.includes("review-confirmed") && audit.includes("review-requested"), audit.join(","));
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "confirm-review", note: "ok" });
  check("confirmar revisão devolve a versão a concluída", r.status === 200 && r.data.version.status === "CONCLUIDA", `${r.status}`);

  // Nova versão.
  r = await api("POST", `${base(A)}/anamnesis`, { from: "current" });
  const v2draft = r.data.draft;
  check("nova versão: rascunho v2 copiado da v1", r.status === 201 && v2draft.version === 2 && v2draft.basedOnVersion === 1 && v2draft.origin === "current-version" && v2draft.content.health.items.hypertension.value === "yes" && v2draft.content.health.items.cardiac.value === null, `${r.status}`);
  check("nova versão não altera a concluída", (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.status === "CONCLUIDA");
  r = await api("POST", `${base(A)}/anamnesis/${v2draft.id}`, { action: "request-review", note: "x" });
  check("só a versão atual pode ser revisada (rascunho recusado)", r.status === 409, r.status);
  o = await overview(A);
  check("visão geral com rascunho e versão atual", o.versions.length === 2 && o.current.id === draft.id && o.draft.id === v2draft.id && o.state === "REVISADA");
  const content2 = structuredClone(v2draft.content);
  content2.health.items.hypertension = answer("no");
  content2.health.items.pregnancy = answer("yes", "12 semanas");
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: v2draft.id, content: content2, expectedUpdatedAt: v2draft.updatedAt });
  r = await api("POST", `${base(A)}/anamnesis/${v2draft.id}`, { action: "complete", expectedUpdatedAt: r.data.updatedAt, note: "atualizada" });
  check("v2 concluída", r.status === 200 && r.data.version.status === "CONCLUIDA" && r.data.version.version === 2, `${r.status}`);
  o = await overview(A);
  check("histórico traz as duas versões e a v2 como atual", o.versions.map((item) => item.version).join(",") === "2,1" && o.current.id === v2draft.id && o.draft === null && o.alerts.some((alert) => alert.id === "health-pregnancy" && alert.level === "important") && !o.alerts.some((alert) => alert.id === "health-hypertension"), JSON.stringify(o.versions.map((item) => `${item.version}:${item.status}`)));
  const v1Final = (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version;
  check("v1 segue imutável depois da v2", v1Final.content.health.items.hypertension.value === "yes" && v1Final.status === "CONCLUIDA");
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "antiga" });
  check("versão superada não pode ser revisada (409)", r.status === 409, r.status);

  // Descarte de rascunho.
  const v3 = (await api("POST", `${base(A)}/anamnesis`, { from: "current" })).data.draft;
  const delBase = `${base(A)}/anamnesis?draftId=${v3.id}`;
  r = await api("DELETE", delBase);
  check("descartar sem expectedUpdatedAt é recusado (400)", r.status === 400, r.status);
  r = await api("DELETE", `${base(A)}/anamnesis?expectedUpdatedAt=${encodeURIComponent(v3.updatedAt)}`);
  check("descartar sem draftId é recusado (400)", r.status === 400, r.status);
  r = await api("DELETE", `${delBase}&expectedUpdatedAt=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`);
  check("descartar com revisão defasada devolve 409 stale e mantém o rascunho", r.status === 409 && r.data.code === "stale" && (await api("GET", `${base(A)}/anamnesis/${v3.id}`)).status === 200, `${r.status}`);
  r = await api("DELETE", `${delBase}&expectedUpdatedAt=${encodeURIComponent(v3.updatedAt)}`);
  check("descartar rascunho com a revisão certa", r.status === 200, r.status);
  check("rascunho descartado some e as versões concluídas ficam", (await api("GET", `${base(A)}/anamnesis/${v3.id}`)).status === 404 && (await overview(A)).versions.length === 2);

  // Isolamento: outro paciente da mesma clínica.
  r = await api("GET", `${base(B)}/anamnesis/${draft.id}`);
  check("versão de outro paciente da mesma clínica: GET 404", r.status === 404, r.status);
  r = await api("POST", `${base(B)}/anamnesis/${draft.id}`, { action: "request-review", note: "x" });
  check("versão de outro paciente da mesma clínica: POST 404", r.status === 404, r.status);
  check("a versão do outro paciente não mudou", (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.status === "CONCLUIDA");
  o = await overview(B);
  check("visão geral da B não mistura versões da A", o.versions.length === 1 && o.versions[0].id === draftB.id);

  // Outra clínica e STAFF. Tudo que for criado fora da conta de teste é removido no finally.
  const otherEmail = `e2e-outra-${run}@example.com`;
  const otherPassword = `E2e-${run}-Outra9!`;
  const otherClinic = `E2E Clínica Externa ${run}`;
  let team = null;
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990020", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const probe = await withSession(other.cookie, async () => {
        const created = await api("POST", "/api/patients", { name: `E2E Externo ${run}`, phone: "11999990021", age: 40, cpf: randomCpf() });
        return {
          foreign: created.data.patient ?? created.data,
          overview: await api("GET", `${base(A)}/anamnesis`),
          create: await api("POST", `${base(A)}/anamnesis`, { from: "empty" }),
          put: await api("PUT", `${base(A)}/anamnesis`, { draftId: v2draft.id, content: {}, expectedUpdatedAt: v2draft.updatedAt }),
          del: await api("DELETE", `${base(A)}/anamnesis?draftId=${draftB.id}&expectedUpdatedAt=${encodeURIComponent(draftB.updatedAt)}`),
          versionGet: await api("GET", `${base(A)}/anamnesis/${draft.id}`),
          versionPost: await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "x" }),
          encounters: await api("GET", `${base(A)}/encounters`),
        };
      });
      const { foreign, ...calls } = probe;
      check("paciente de outra clínica: todas as rotas devolvem 404", Object.values(calls).every((item) => item.status === 404), statusMap(calls));
      const viaOwnPatient = await withSession(other.cookie, () => api("GET", `${base(foreign)}/anamnesis/${draft.id}`));
      check("versão da minha clínica lida por paciente da outra clínica devolve 404", viaOwnPatient.status === 404, viaOwnPatient.status);
      check("tentativas da outra clínica não alteraram a anamnese", (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.status === "CONCLUIDA" && (await api("GET", `${base(B)}/anamnesis/${draftB.id}`)).status === 200);
    } else {
      check("segunda clínica criada para testar isolamento", false, `registro ${r.status} login ${other?.status}`);
    }

    const staffEmail = `e2e-staff-${run}@example.com`;
    const staffPassword = `E2e-${run}-Staff9!`;
    r = await api("POST", "/api/team", { name: "E2E Atendente", email: staffEmail, password: staffPassword, role: "STAFF" });
    team = r.status === 201 ? r.data.member : null;
    const staff = team ? await loginAs(staffEmail, staffPassword) : null;
    if (staff?.status === 200) {
      const s = await withSession(staff.cookie, async () => ({
        overview: await api("GET", `${base(A)}/anamnesis`),
        overviewNone: await api("GET", `${base(C)}/anamnesis`),
        version: await api("GET", `${base(A)}/anamnesis/${draft.id}`),
        create: await api("POST", `${base(D)}/anamnesis`, { from: "empty" }),
        put: await api("PUT", `${base(B)}/anamnesis`, { draftId: draftB.id, content: {}, expectedUpdatedAt: draftB.updatedAt }),
        del: await api("DELETE", `${base(B)}/anamnesis?draftId=${draftB.id}&expectedUpdatedAt=${encodeURIComponent(draftB.updatedAt)}`),
        action: await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "x" }),
        encounters: await api("GET", `${base(A)}/encounters`),
      }));
      check("STAFF: visão geral devolve só restricted e exists", JSON.stringify(Object.keys(s.overview.data).sort()) === JSON.stringify(["exists", "restricted"]) && s.overview.data.restricted === true && s.overview.data.exists === true && s.overviewNone.data.exists === false, JSON.stringify(s.overview.data).slice(0, 150));
      check("STAFF não recebe conteúdo clínico nem alertas", !/Losartana|Rugas|hypertension|latex/.test(JSON.stringify(s.overview.data)));
      check("STAFF não lê versão, não escreve e não vê atendimentos (403)", [s.version, s.create, s.put, s.del, s.action, s.encounters].every((item) => item.status === 403), statusMap(s));
      check("STAFF não alterou nada", (await overview(D)).versions.length === 0 && (await api("GET", `${base(B)}/anamnesis/${draftB.id}`)).status === 200 && (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.status === "CONCLUIDA");
    } else {
      check("usuário STAFF criado para testar permissões", false, `team ${r.status} login ${staff?.status}`);
    }
  } finally {
    // A clínica de teste precisa voltar a ter só a conta de teste, senão resetTestClinic recusa a limpeza.
    if (team) await api("DELETE", "/api/team", { membershipId: team.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: otherEmail } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: otherEmail } });
  }

  // Lista de atendimentos.
  r = await api("GET", `${base(D)}/encounters`);
  check("atendimentos sem dados: lista vazia, sem retorno, sem corte", r.status === 200 && Array.isArray(r.data.items) && r.data.items.length === 0 && r.data.nextReturn === null && r.data.truncated === false, `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  const returnAppointment = await api("POST", "/api/appointments", { patientId: A.id, procedure: "Retorno", professional: "Teste", time: "14:30", date: `${day(3)}T00:00:00` });
  const photoEval = await api("PUT", `${base(A)}/evaluation`, { photos: [{ name: "frente", imageUrl: png, width: 1, height: 1, category: "Frontal", annotations: [] }], assessment: { chiefComplaint: "Com foto" } });
  check("retorno e avaliação com foto criados", returnAppointment.status === 201 && photoEval.status === 200, `${returnAppointment.status}/${photoEval.status}`);
  r = await api("GET", `${base(A)}/encounters`);
  const text = JSON.stringify(r.data);
  const items = r.data.items ?? [];
  check("atendimentos da A: avaliações listadas, só da A", r.status === 200 && items.length >= 1 && items.every((item) => item.type === "evaluation") && items.some((item) => item.id === evaluationAId) && !items.some((item) => item.id === evaluationBId), `${r.status} ${items.length}`);
  check("atendimentos: contagem de fotos sem imagem na resposta", items.some((item) => item.photoCount === 1) && !text.includes("data:image") && !text.includes("base64") && !text.includes("imageUrl"), text.length);
  check("atendimentos: próximo retorno agendado", r.data.nextReturn?.procedure === "Retorno" && r.data.nextReturn.time === "14:30", JSON.stringify(r.data.nextReturn));
  check("atendimentos: do mais recente ao mais antigo", items.every((item, index) => index === 0 || new Date(items[index - 1].occurredAt) >= new Date(item.occurredAt)));
  const encountersB = await api("GET", `${base(B)}/encounters`);
  check("atendimentos da B não trazem retorno nem dados da A", encountersB.data.nextReturn === null && encountersB.data.items.length === 1 && encountersB.data.items[0].id === evaluationBId, JSON.stringify(encountersB.data.items?.map((item) => item.id)));
}

// --- Prontuário: documentos clínicos e fotos ---
async function clinicalFiles() {
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const png = Buffer.from(pngB64, "base64");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
  const dataUrl = `data:image/png;base64,${pngB64}`;
  const form = (buffer, name, type, fields = {}) => {
    const body = new FormData();
    body.set("file", new Blob([buffer], { type }), name);
    for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
    return body;
  };
  // Chamada que aceita FormData e pode devolver bytes e cabeçalhos; usa a sessão atual (`cookie`).
  const call = async (method, path, body, { raw = false } = {}) => {
    const json = body && !(body instanceof FormData);
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: json ? JSON.stringify(body) : body, redirect: "manual" });
    if (raw) return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
    return { status: response.status, data };
  };
  const created = await api("POST", "/api/patients", { name: `E2E Arquivos ${run}`, phone: "11999990030", age: 33, cpf: randomCpf() });
  if (created.status !== 201) throw new Error(`Paciente de arquivos não criado (${created.status})`);
  const P = (created.data.patient ?? created.data).id;
  const docs = `/api/patients/${P}/documents`;
  const photosPath = `/api/patients/${P}/photos`;
  const ref = (value) => encodeURIComponent(value);
  const statuses = (object) => JSON.stringify(Object.fromEntries(Object.entries(object).map(([key, item]) => [key, item.status])));
  const safeHeaders = (h) => h.get("cache-control") === "private, no-store" && h.get("x-content-type-options") === "nosniff" && /cookie/i.test(h.get("vary") ?? "");

  // 401 sem sessão.
  const anon = await withSession("", async () => ({
    list: await call("GET", docs), post: await call("POST", docs, form(pdf, "a.pdf", "application/pdf", { category: "TERMOS" })),
    patch: await call("PATCH", `${docs}/x`, { name: "x" }), del: await call("DELETE", `${docs}/x`, { confirm: true }), file: await call("GET", `${docs}/x/file`, null, { raw: true }),
    photos: await call("GET", photosPath), photoPost: await call("POST", photosPath, form(png, "a.png", "image/png", { width: 1, height: 1 })),
    photo: await call("GET", `${photosPath}/gallery%3Ax`), image: await call("GET", `${photosPath}/gallery%3Ax/image`, null, { raw: true }),
  }));
  check("documentos e fotos sem sessão devolvem 401 em todas as rotas", Object.values(anon).every((item) => item.status === 401), statuses(anon));

  // Upload válido e recusas.
  let r = await call("POST", docs, form(pdf, "Termo de consentimento.pdf", "application/pdf", { category: "TERMOS", signatureStatus: "ASSINADO" }));
  const termo = r.data.item;
  check("upload de PDF em TERMOS", r.status === 201 && termo?.name === "Termo de consentimento" && termo.category === "TERMOS" && termo.signatureStatus === "ASSINADO" && termo.mimeType === "application/pdf", `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  r = await call("POST", docs, form(pdf, "Laudo facial.pdf", "application/pdf", { category: "EXAMES" }));
  const laudo = r.data.item;
  r = await call("POST", docs, form(png, "Receita.png", "image/png", { category: "RECEITAS" }));
  const receita = r.data.item;
  check("upload de imagem pequena como documento", r.status === 201 && receita?.mimeType === "image/png", r.status);
  r = await call("POST", docs, form(exe, "virus.pdf", "application/pdf", { category: "TERMOS" }));
  check("executável renomeado para .pdf é recusado (415)", r.status === 415, r.status);
  r = await call("POST", docs, form(pdf, "a.pdf", "image/png", { category: "TERMOS" }));
  check("MIME incoerente com o conteúdo é recusado (415)", r.status === 415, r.status);
  r = await call("POST", docs, form(Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024)]), "grande.pdf", "application/pdf", { category: "TERMOS" }));
  check("arquivo maior que 4 MB devolve 413", r.status === 413, r.status);
  {
    const probe = new Response(form(pdf, "c.pdf", "application/pdf", { category: "TERMOS" }));
    const contentType = probe.headers.get("content-type");
    const raw = Buffer.from(await probe.arrayBuffer());
    const stream = new ReadableStream({ start(c) { c.enqueue(raw); c.close(); } });
    const res = await fetch(`${baseUrl}${docs}`, { method: "POST", headers: { cookie, "content-type": contentType }, body: stream, duplex: "half" }).catch(() => ({ status: 0 }));
    check("sem Content-Length (chunked) devolve 413", res.status === 413, res.status);
  }
  r = await call("POST", docs, form(pdf, "a.pdf", "application/pdf", { category: "HACK" }));
  check("categoria inválida é recusada (400)", r.status === 400, r.status);
  r = await call("POST", docs, form(pdf, "a.pdf", "application/pdf", {}));
  check("upload sem categoria é recusado (400)", r.status === 400, r.status);
  r = await call("POST", docs, form(pdf, "../../etc/passwd.pdf", "application/pdf", { category: "TERMOS" }));
  check("nome com ../ é sanitizado", r.status === 201 && r.data.item.name === "passwd", JSON.stringify(r.data.item?.name));
  r = await call("POST", docs, form(pdf, "a.pdf", "application/pdf", { category: "TERMOS", journeyId: "inexistente" }));
  check("vínculo a tratamento inexistente é recusado (400)", r.status === 400, r.status);

  // Listagem paginada com contagens.
  r = await call("GET", docs);
  check("lista: total e contagens por categoria", r.status === 200 && r.data.total === 4 && r.data.counts.all === 4 && r.data.counts.TERMOS === 2 && r.data.counts.EXAMES === 1 && r.data.counts.RECEITAS === 1, JSON.stringify(r.data.counts));
  check("lista sem conteúdo binário", !JSON.stringify(r.data).includes("JVBER") && !("data" in (r.data.items?.[0] ?? {})));
  r = await call("GET", `${docs}?page=2&pageSize=9`);
  check("paginação no servidor: página 2 (tamanho 9) vazia, total 4", r.status === 200 && r.data.items.length === 0 && r.data.total === 4 && r.data.page === 2 && r.data.pageSize === 9, JSON.stringify([r.data.items?.length, r.data.total, r.data.page]));
  r = await call("GET", `${docs}?pageSize=3`);
  check("tamanho de página inválido volta para 9", r.status === 200 && r.data.pageSize === 9 && r.data.items.length === 4, JSON.stringify([r.data.pageSize, r.data.items?.length]));
  r = await call("GET", `${docs}?q=laudo`);
  check("busca por nome", r.data.total === 1 && r.data.items[0].id === laudo.id, r.data.total);

  // Download e visualização.
  r = await call("GET", `${docs}/${termo.id}/file?download=1`, null, { raw: true });
  check("download do documento: bytes iguais, attachment e cabeçalhos seguros", r.status === 200 && r.buffer.equals(pdf) && /attachment/.test(r.headers.get("content-disposition") ?? "") && safeHeaders(r.headers), `${r.status} ${r.headers.get("cache-control")}`);
  r = await call("GET", `${docs}/${laudo.id}/file`, null, { raw: true });
  check("visualização do documento: cabeçalhos seguros e sem attachment", r.status === 200 && r.buffer.equals(pdf) && safeHeaders(r.headers) && !/attachment/.test(r.headers.get("content-disposition") ?? ""), `${r.status} ${r.headers.get("content-disposition")}`);
  r = await call("GET", `${docs}/${receita.id}/file?thumb=1`, null, { raw: true });
  check("miniatura de imagem: 200, image/png, sem cache", r.status === 200 && r.headers.get("content-type") === "image/png" && safeHeaders(r.headers), `${r.status} ${r.headers.get("content-type")}`);

  // PATCH.
  r = await call("PATCH", `${docs}/${termo.id}`, { name: "Termo renomeado" });
  check("renomear documento", r.status === 200 && r.data.item.name === "Termo renomeado", r.status);
  r = await call("PATCH", `${docs}/${termo.id}`, { category: "DECLARACOES", signatureStatus: "PENDENTE" });
  check("recategorizar e mudar assinatura", r.status === 200 && r.data.item.category === "DECLARACOES" && r.data.item.signatureStatus === "PENDENTE", JSON.stringify(r.data.item));
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const journey = await api("POST", `/api/patients/${P}/journeys`, { name: `Tratamento arquivos ${run}`, professionalId: professional?.id });
  const journeyId = journey.data.journey?.id;
  check("tratamento criado para vincular documentos", journey.status < 300 && Boolean(journeyId), `${journey.status} ${JSON.stringify(journey.data).slice(0, 150)}`);
  r = await call("PATCH", `${docs}/${receita.id}`, { journeyId });
  check("vincular documento a tratamento", r.status === 200 && r.data.item.journeyId === journeyId, r.status);
  r = await call("GET", `${docs}?journeyId=${journeyId}`);
  check("filtro por tratamento vinculado", r.data.total === 1 && r.data.items[0].id === receita.id, r.data.total);
  r = await call("PATCH", `${docs}/${laudo.id}`, { archived: true, reason: "duplicado" });
  check("arquivar documento", r.status === 200 && r.data.item.archived === true, r.status);
  r = await call("GET", docs);
  check("arquivado some da lista padrão", r.data.total === 3 && !r.data.items.some((item) => item.id === laudo.id), r.data.total);
  r = await call("PATCH", `${docs}/${laudo.id}`, { name: "x" });
  check("documento arquivado não é editável (409)", r.status === 409, r.status);
  r = await call("PATCH", `${docs}/${laudo.id}`, { archived: false });
  check("desarquivar documento", r.status === 200 && r.data.item.archived === false, r.status);

  // Fotos: índice, upload e galeria.
  const evaluation = await api("PUT", `/api/patients/${P}/evaluation`, { photos: [{ name: "Aval frontal", imageUrl: dataUrl, width: 1, height: 1, category: "Frontal", annotations: [] }], assessment: { chiefComplaint: "Manchas" } });
  check("avaliação com foto criada", evaluation.status === 200, evaluation.status);
  r = await call("GET", photosPath);
  const text = JSON.stringify(r.data);
  const evalPhoto = (r.data.photos ?? []).find((photo) => photo.id.startsWith("evaluation:"));
  check("índice de fotos reúne a avaliação, sem base64", r.status === 200 && Boolean(evalPhoto) && !text.includes("base64") && !text.includes("iVBOR"), `${r.status} ${text.length}`);
  r = await call("POST", photosPath, form(png, "Frontal 1.png", "image/png", { width: 1, height: 1, phase: "ANTES", category: "Frontal" }));
  const galleryId = r.data.id;
  check("upload de foto nova", r.status === 201 && Boolean(galleryId), `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  r = await call("POST", photosPath, form(pdf, "doc.pdf", "application/pdf", { width: 1, height: 1 }));
  check("PDF não entra como foto (415)", r.status === 415, r.status);
  r = await call("POST", photosPath, form(png, "f.png", "image/png", { width: 99999, height: 1 }));
  check("dimensões inválidas da foto (400)", r.status === 400, r.status);
  r = await call("GET", photosPath);
  check("foto nova aparece no índice", r.data.photos.some((photo) => photo.id === `gallery:${galleryId}`));
  r = await call("GET", `${photosPath}/${ref(`gallery:${galleryId}`)}/image`, null, { raw: true });
  check("imagem da galeria: bytes iguais e cabeçalhos seguros", r.status === 200 && r.buffer.equals(png) && r.headers.get("content-type") === "image/png" && safeHeaders(r.headers), `${r.status} ${r.headers.get("cache-control")}`);
  r = await call("GET", `${photosPath}/${ref(evalPhoto?.id ?? "evaluation:x")}/image`, null, { raw: true });
  check("imagem da avaliação servida por referência", r.status === 200 && r.buffer.equals(png), r.status);
  r = await call("GET", `${photosPath}/session%3A%E0%A4%A/image`, null, { raw: true });
  check("referência malformada devolve 400 (imagem)", r.status === 400, r.status);
  r = await call("GET", `${photosPath}/session%3A%E0%A4%A`);
  check("referência malformada devolve 400 (detalhe)", r.status === 400, r.status);
  r = await call("PATCH", `${photosPath}/${ref(`gallery:${galleryId}`)}`, { name: "Frontal renomeada", category: "Sorriso", phase: "DEPOIS", journeyId });
  check("PATCH de foto da galeria", r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  r = await call("PATCH", `${photosPath}/${ref(evalPhoto?.id ?? "evaluation:x")}`, { name: "x" });
  check("foto de avaliação não é editável pela galeria (400)", r.status === 400, r.status);

  // Itens de sistema: anamnese concluída.
  const draft = (await api("POST", `/api/patients/${P}/anamnesis`, { from: "empty" })).data.draft;
  draft.content.complaint.chiefComplaint = "Manchas";
  await api("PUT", `/api/patients/${P}/anamnesis`, { draftId: draft.id, content: draft.content, expectedUpdatedAt: draft.updatedAt });
  const current = (await api("GET", `/api/patients/${P}/anamnesis`)).data;
  await api("POST", `/api/patients/${P}/anamnesis/${draft.id}`, { action: "complete", expectedUpdatedAt: (current.draft ?? draft).updatedAt });
  r = await call("GET", docs);
  const system = r.data.items.filter((item) => item.system);
  check("anamnese concluída aparece em Documentos para o ADMIN (somente leitura)", system.some((item) => item.kind === "anamnesis" && item.name === "Anamnese (v1)"), JSON.stringify(system).slice(0, 200));
  check("nenhum ClinicalDocument criado para itens de sistema", await prisma.clinicalDocument.count({ where: { patientId: P, name: { contains: "Anamnese" } } }) === 0);

  // Outra clínica e STAFF (removidos no finally).
  const otherEmail = `e2e-arq-outra-${run}@example.com`;
  const otherPassword = `E2e-${run}-Outra9!`;
  const otherClinic = `E2E Arquivos Externa ${run}`;
  const staffEmail = `e2e-arq-staff-${run}@example.com`;
  const staffPassword = `E2e-${run}-Staff9!`;
  let team = null;
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990020", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const o = await withSession(other.cookie, async () => ({
        list: await call("GET", docs), upload: await call("POST", docs, form(pdf, "a.pdf", "application/pdf", { category: "TERMOS" })),
        file: await call("GET", `${docs}/${termo.id}/file`, null, { raw: true }), patch: await call("PATCH", `${docs}/${termo.id}`, { name: "invasor" }),
        del: await call("DELETE", `${docs}/${termo.id}`, { confirm: true }),
        photos: await call("GET", photosPath), photoPost: await call("POST", photosPath, form(png, "a.png", "image/png", { width: 1, height: 1 })),
        image: await call("GET", `${photosPath}/${ref(`gallery:${galleryId}`)}/image`, null, { raw: true }),
        evalImage: await call("GET", `${photosPath}/${ref(evalPhoto?.id ?? "evaluation:x")}/image`, null, { raw: true }),
        photoPatch: await call("PATCH", `${photosPath}/${ref(`gallery:${galleryId}`)}`, { name: "x" }),
        photoDel: await call("DELETE", `${photosPath}/${ref(`gallery:${galleryId}`)}`, { confirm: true }),
      }));
      check("outra clínica recebe 404 em documentos e fotos", Object.values(o).every((item) => item.status === 404), statuses(o));
    } else {
      check("segunda clínica criada para testar isolamento de arquivos", false, `registro ${r.status} login ${other?.status}`);
    }

    r = await api("POST", "/api/team", { name: "E2E Atendente Arquivos", email: staffEmail, password: staffPassword, role: "STAFF" });
    team = r.status === 201 ? r.data.member : null;
    const staff = team ? await loginAs(staffEmail, staffPassword) : null;
    if (staff?.status === 200) {
      await withSession(staff.cookie, async () => {
        r = await call("POST", docs, form(pdf, "x.pdf", "application/pdf", { category: "EXAMES" }));
        check("STAFF não envia EXAMES (403)", r.status === 403, r.status);
        r = await call("POST", docs, form(pdf, "x.pdf", "application/pdf", { category: "OUTROS" }));
        check("STAFF não envia OUTROS (403)", r.status === 403, r.status);
        r = await call("POST", docs, form(pdf, "Orientações pós.pdf", "application/pdf", { category: "ORIENTACOES" }));
        const orient = r.data.item;
        check("STAFF envia ORIENTACOES", r.status === 201 && orient?.category === "ORIENTACOES", r.status);
        r = await call("POST", docs, form(png, "Declaração.png", "image/png", { category: "DECLARACOES" }));
        check("STAFF envia DECLARACOES", r.status === 201, r.status);
        r = await call("GET", docs);
        check("STAFF lista só categorias administrativas, sem EXAMES/RECEITAS e sem itens de sistema", r.status === 200 && r.data.items.length > 0 && r.data.items.every((item) => ["TERMOS", "DECLARACOES", "ORIENTACOES"].includes(item.category) && !item.system) && r.data.counts.EXAMES === undefined && r.data.counts.RECEITAS === undefined, JSON.stringify(r.data.counts));
        r = await call("GET", `${docs}?category=EXAMES`);
        check("STAFF com ?category=EXAMES não amplia o acesso", r.status === 200 && r.data.total === 0 && r.data.items.length === 0, `${r.status} ${r.data.total}`);
        r = await call("GET", `${docs}/${laudo.id}/file`, null, { raw: true });
        check("STAFF recebe 404 em arquivo de categoria oculta", r.status === 404, r.status);
        r = await call("PATCH", `${docs}/${laudo.id}`, { name: "x" });
        check("STAFF recebe 404 ao editar categoria oculta", r.status === 404, r.status);
        r = await call("PATCH", `${docs}/${orient.id}`, { category: "EXAMES" });
        check("STAFF não recategoriza para EXAMES (403)", r.status === 403, r.status);
        r = await call("DELETE", `${docs}/${orient.id}`, { confirm: true });
        check("STAFF não exclui documento (403)", r.status === 403, r.status);
        r = await call("POST", docs, form(pdf, "v.pdf", "application/pdf", { category: "TERMOS", encounterType: "session", encounterId: "qualquer" }));
        check("STAFF tentando vínculo de atendimento recebe 400", r.status === 400, r.status);
        r = await call("GET", photosPath);
        check("STAFF não vê fotos (403)", r.status === 403, r.status);
        r = await call("POST", photosPath, form(png, "f.png", "image/png", { width: 1, height: 1 }));
        check("STAFF não envia foto (403)", r.status === 403, r.status);
        r = await call("GET", `${photosPath}/${ref(`gallery:${galleryId}`)}/image`, null, { raw: true });
        check("STAFF não lê imagem de foto (403)", r.status === 403, r.status);
        r = await call("PATCH", `${photosPath}/${ref("gallery:nao-existe")}`, { name: "x" });
        check("STAFF em PATCH de foto inexistente recebe 403, não 404", r.status === 403, r.status);
      });
    } else {
      check("usuário STAFF criado para testar permissões de arquivos", false, `team ${r.status} login ${staff?.status}`);
    }
  } finally {
    if (team) await api("DELETE", "/api/team", { membershipId: team.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [otherEmail, staffEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [otherEmail, staffEmail] } } });
  }

  // Exclusão: só ADMIN, com confirmação, deixando trilha mínima.
  r = await call("DELETE", `${docs}/${laudo.id}`, {});
  check("exclusão sem confirm:true é recusada (400)", r.status === 400, r.status);
  check("bytes existem antes de excluir", await prisma.clinicalDocumentBlob.count({ where: { documentId: laudo.id } }) === 1);
  r = await call("DELETE", `${docs}/${laudo.id}`, { confirm: true, reason: "teste" });
  check("ADMIN exclui documento definitivamente", r.status === 200, r.status);
  check("exclusão apaga metadados e bytes", await prisma.clinicalDocument.count({ where: { id: laudo.id } }) === 0 && await prisma.clinicalDocumentBlob.count({ where: { documentId: laudo.id } }) === 0);
  const trail = await prisma.clinicalFileAudit.findFirst({ where: { fileId: laudo.id, action: "DELETE" } });
  check("trilha mínima da exclusão permanece", trail?.fileName === "Laudo facial" && trail.category === "EXAMES" && trail.note === "teste", JSON.stringify(trail));
  r = await call("GET", `${docs}/${laudo.id}/file`, null, { raw: true });
  check("documento excluído não abre (404)", r.status === 404, r.status);
  r = await call("DELETE", `${photosPath}/${ref(`gallery:${galleryId}`)}`, { confirm: true, reason: "teste" });
  check("ADMIN exclui foto da galeria", r.status === 200, r.status);
  check("foto excluída sem bytes e com trilha", await prisma.clinicalPhoto.count({ where: { id: galleryId } }) === 0 && await prisma.clinicalPhotoBlob.count({ where: { photoId: galleryId } }) === 0 && await prisma.clinicalFileAudit.count({ where: { fileId: galleryId, action: "DELETE" } }) === 1);
}

// Gate do termo de consentimento (Fase A): Rascunho -> Em execução exige termo ASSINADO, ativo e da mesma jornada.
async function consentGate() {
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const dataUrl = `data:image/png;base64,${pngB64}`;
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const upload = async (path, name, fields = {}) => {
    const body = new FormData();
    body.set("file", new Blob([pdf], { type: "application/pdf" }), name);
    for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: cookie ? { cookie } : {}, body, redirect: "manual" });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
    return { status: response.status, data };
  };
  let r = await api("GET", "/api/quotes/options");
  let procedure = r.data.procedures?.[0];
  if (!procedure) {
    await api("POST", "/api/procedures", { name: `E2E Botox ${run}`, category: "Facial", price: 900, durationMinutes: 30, margin: 30 });
    procedure = (await api("GET", "/api/quotes/options")).data.procedures?.[0];
  }
  const P = (await api("POST", "/api/patients", { name: `E2E Termo ${run}`, phone: "11999990040", age: 35, cpf: randomCpf() })).data.patient.id;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const mkJourney = async (name) => (await api("POST", `/api/patients/${P}/journeys`, { name, professionalId: professional?.id })).data.journey;
  const J1 = await mkJourney(`E2E Termo A ${run}`);
  const J2 = await mkJourney(`E2E Termo B ${run}`);
  const mkSession = async (journey) => {
    const ev = (await api("PUT", `/api/patients/${P}/evaluation`, { journeyId: journey.id, photos: [], assessment: { chiefComplaint: "Queixa", patientGoal: "Obj" }, status: "Concluída" })).data.evaluation;
    const q = await api("POST", "/api/quotes", { patientId: P, journeyId: journey.id, evaluationId: ev.id, details: [{ procedureId: procedure.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" });
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote.id}`, { status, evaluationId: ev.id });
    const s = await api("POST", `/api/patients/${P}/procedure-sessions`, { journeyId: journey.id, quoteId: q.data.quote.id, procedureId: procedure.id });
    return { id: s.data.session?.id, quoteId: q.data.quote.id, journeyId: journey.id, status: s.status };
  };
  const S1 = await mkSession(J1);
  const S2 = await mkSession(J2);
  check("sessões de teste do gate criadas", S1.status === 201 && S2.status === 201, `${S1.status}/${S2.status}`);
  const dup = await api("POST", `/api/patients/${P}/procedure-sessions`, { journeyId: S1.journeyId, quoteId: S1.quoteId });
  check("POST de sessão é idempotente: reaproveita o rascunho do orçamento (sessão única)", dup.status === 200 && dup.data.reused === true && dup.data.session?.id === S1.id, `${dup.status} ${dup.data?.session?.id}`);
  const sPath = (s) => `/api/patients/${P}/procedure-sessions/${s.id}`;
  // Agendamento "Procedimento - X" ativo na jornada J1: só muda quando o início é efetivado.
  const futureDay = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const apptRes = await api("POST", "/api/appointments", { patientId: P, journeyId: J1.id, procedure: `Procedimento - ${procedure.name}`, professional: "E2E Prof", date: futureDay, time: "10:00", notes: "" });
  const apptId = apptRes.data?.appointment?.id;
  const start = (s, extra = {}) => api("PATCH", sPath(s), { status: "Em execução", technique: "E2E técnica", treatedAreas: "E2E região", photos: [{ id: `ph-${run}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 }], ...extra });
  const summary = async (s) => (await api("GET", `/api/patients/${P}/procedure-sessions?journeyId=${s.journeyId}&quoteId=${s.quoteId}`)).data;
  const docs = `/api/patients/${P}/documents`;
  const blocked = (res) => res.status === 409 && res.data?.code === "CONSENT_REQUIRED";

  // GET: contagens e nome da clínica.
  let g = await summary(S1);
  check("GET sessões sem termo: consent vazio com mensagem e clinicName", g.consent?.signed === false && g.consent.signedCount === 0 && g.consent.pendingCount === 0 && /termo de consentimento/i.test(g.consent.message) && g.clinicName === testClinicName, JSON.stringify([g.consent, g.clinicName]));
  r = await start(S1);
  check("iniciar sem termo => 409 CONSENT_REQUIRED", blocked(r), `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  r = await api("PATCH", sPath(S1), { technique: "Técnica X" });
  check("editar campos da sessão sem termo não é bloqueado", r.status === 200, r.status);
  r = await api("PATCH", sPath(S1), { status: "Concluída" });
  check("concluir sessão em rascunho segue recusada pela regra antiga, não pelo termo", r.status === 409 && r.data?.code !== "CONSENT_REQUIRED", `${r.status} ${r.data?.code}`);

  // Pendente não libera.
  r = await upload(docs, "Termo pendente.pdf", { category: "TERMOS", signatureStatus: "PENDENTE", journeyId: J1.id });
  const pend = r.data.item;
  check("upload de termo pendente na jornada", r.status === 201 && pend?.signatureStatus === "PENDENTE" && pend.journeyId === J1.id, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  g = await summary(S1);
  check("GET com termo pendente: signed=false, pendingCount=1, mensagem de pendente", g.consent?.signed === false && g.consent.pendingCount === 1 && g.consent.signedCount === 0 && /não assinado/.test(g.consent.message), JSON.stringify(g.consent));
  r = await start(S1);
  check("iniciar com termo pendente => 409 CONSENT_REQUIRED", blocked(r), `${r.status} ${r.data?.code}`);

  // Termo assinado em OUTRA jornada, sem jornada ou de outra categoria não libera.
  r = await upload(docs, "Termo outra jornada.pdf", { category: "TERMOS", signatureStatus: "ASSINADO", journeyId: J2.id });
  const other = r.data.item;
  await upload(docs, "Termo sem jornada.pdf", { category: "TERMOS", signatureStatus: "ASSINADO" });
  await upload(docs, "Laudo assinado.pdf", { category: "EXAMES", signatureStatus: "ASSINADO", journeyId: J1.id });
  g = await summary(S1);
  check("termo assinado de outra jornada, sem jornada ou de outra categoria não conta", g.consent?.signedCount === 0 && g.consent.pendingCount === 1, JSON.stringify(g.consent));
  r = await start(S1);
  check("iniciar com termo de outra jornada => 409", blocked(r), `${r.status} ${r.data?.code}`);

  // Assinado libera; arquivado volta a bloquear.
  r = await api("PATCH", `${docs}/${pend.id}`, { signatureStatus: "ASSINADO" });
  check("ADMIN marca o termo como assinado", r.status === 200 && r.data.item?.signatureStatus === "ASSINADO", r.status);
  g = await summary(S1);
  check("GET com termo assinado: signed=true, mensagem vazia", g.consent?.signed === true && g.consent.signedCount === 1 && g.consent.pendingCount === 0 && g.consent.message === "", JSON.stringify(g.consent));
  r = await api("PATCH", `${docs}/${pend.id}`, { archived: true, reason: "teste" });
  check("ADMIN arquiva o termo", r.status === 200, r.status);
  r = await start(S1);
  check("iniciar com termo arquivado => 409", blocked(r), `${r.status} ${r.data?.code}`);
  await api("PATCH", `${docs}/${pend.id}`, { archived: false });
  r = await start(S1, { technique: "" });
  check("iniciar sem técnica (obrigatória) => 400", r.status === 400, r.status);
  r = await start(S1, { treatedAreas: " " });
  check("iniciar sem região tratada (obrigatória) => 400", r.status === 400, r.status);
  const stillScheduled = (await summary(S1)).scheduledProcedure;
  check("início recusado (409/400) NÃO altera o agendamento do procedimento", apptRes.status === 201 && stillScheduled?.id === apptId && stillScheduled.date === futureDay && stillScheduled.time === "10:00", JSON.stringify([apptRes.status, stillScheduled]));
  r = await start(S1);
  check("iniciar com termo assinado => 200 Em execução", r.status === 200 && r.data.session?.status === "Em execução", `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  const nowSp = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date());
  const movedSummary = (await summary(S1)).scheduledProcedure;
  const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  check("iniciar com agendamento ativo move o horário para agora (hoje, hora atual)", movedSummary?.id === apptId && movedSummary.date === nowSp.slice(0, 10) && Math.abs(minutesOf(movedSummary.time) - minutesOf(nowSp.slice(11, 16))) <= 2, JSON.stringify([movedSummary, nowSp]));
  check("auditoria da sessão registra a alteração do agendamento", Boolean(r.data.session?.auditLog?.some((entry) => /Agendamento alterado/.test(entry.action))), JSON.stringify(r.data.session?.auditLog));
  const downgraded = await api("PATCH", `${docs}/${pend.id}`, { signatureStatus: "PENDENTE" });
  r = await api("PATCH", sPath(S1), { technique: "Técnica Z" });
  check("sessão já iniciada continua editável mesmo com o termo rebaixado", downgraded.status === 200 && r.status === 200, `${downgraded.status}/${r.status}`);
  await api("PATCH", `${docs}/${other.id}`, { archived: true, reason: "teste" });
  r = await start(S2);
  check("sessão da jornada B segue bloqueada (termo assinado da A não vale)", blocked(r), `${r.status} ${r.data?.code}`);
  await api("PATCH", `${docs}/${other.id}`, { archived: false });

  // Clique duplo.
  await api("PATCH", `${docs}/${other.id}`, { signatureStatus: "PENDENTE" });
  const [d1, d2] = await Promise.all([start(S2), start(S2)]);
  check("início duplo sem termo assinado: as duas recusadas", blocked(d1) && blocked(d2), `${d1.status}/${d2.status}`);
  await api("PATCH", `${docs}/${other.id}`, { signatureStatus: "ASSINADO" });
  const [e1, e2] = await Promise.all([start(S2), start(S2)]);
  const after = (await summary(S2)).sessions?.find((s) => s.id === S2.id);
  check("início duplo com termo assinado: sem 500 e sessão em execução", e1.status < 500 && e2.status < 500 && [e1, e2].some((x) => x.status === 200) && after?.status === "Em execução", `${e1.status}/${e2.status} ${after?.status}`);

  // Papéis: STAFF e PROFESSIONAL.
  const mk = async (roleName, tag) => {
    const login = `e2e-termo-${tag}-${run}@example.com`;
    const secret = `E2e-${run}-${tag}9!`;
    const created = await api("POST", "/api/team", { name: `E2E ${roleName} Termo`, email: login, password: secret, role: roleName });
    const session = created.status === 201 ? await loginAs(login, secret) : null;
    return { login, member: created.data.member, session, status: created.status };
  };
  const staff = await mk("STAFF", "staff");
  const prof = await mk("PROFESSIONAL", "prof");
  try {
    if (staff.session?.status === 200) {
      await withSession(staff.session.cookie, async () => {
        let s = await upload(docs, "Staff assinado.pdf", { category: "TERMOS", signatureStatus: "ASSINADO", journeyId: J1.id });
        check("STAFF não cria TERMOS já ASSINADO (403)", s.status === 403, s.status);
        s = await upload(docs, "Staff pendente.pdf", { category: "TERMOS", signatureStatus: "PENDENTE", journeyId: J1.id });
        const own = s.data.item;
        check("STAFF cria TERMOS pendente", s.status === 201, s.status);
        s = await api("PATCH", `${docs}/${own?.id}`, { signatureStatus: "ASSINADO" });
        check("STAFF não marca TERMOS como ASSINADO (403)", s.status === 403, s.status);
        s = await api("PATCH", `${docs}/${own?.id}`, { category: "DECLARACOES" });
        check("STAFF recategoriza termo pendente (a trava só protege assinados)", s.status === 200, s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { signatureStatus: "PENDENTE" });
        check("STAFF não rebaixa termo ASSINADO (403)", s.status === 403, s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { category: "DECLARACOES" });
        check("STAFF não recategoriza termo ASSINADO (403)", s.status === 403, s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { journeyId: J1.id });
        check("STAFF não muda jornada de termo ASSINADO (403)", s.status === 403, s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { journeyId: null });
        check("STAFF não remove jornada de termo ASSINADO (403)", s.status === 403, s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { name: `E2E Renomeado ${run}` });
        check("STAFF renomeia termo ASSINADO", s.status === 200 && s.data.item?.name === `E2E Renomeado ${run}` && s.data.item.signatureStatus === "ASSINADO", `${s.status} ${s.data.item?.name}`);
        const still = await prisma.clinicalDocument.findUnique({ where: { id: other.id }, select: { signatureStatus: true, category: true, journeyId: true } });
        check("termo ASSINADO manteve status, categoria e jornada após as tentativas do STAFF", still.signatureStatus === "ASSINADO" && still.category === "TERMOS" && still.journeyId === J2.id, JSON.stringify(still));
        s = await api("PATCH", sPath(S2), { technique: "x" });
        check("STAFF não altera sessão (403)", s.status === 403, s.status);
      });
    } else check("usuário STAFF do gate criado", false, `team ${staff.status} login ${staff.session?.status}`);
    if (prof.session?.status === 200) {
      await withSession(prof.session.cookie, async () => {
        let s = await upload(docs, "Prof assinado.pdf", { category: "TERMOS", signatureStatus: "ASSINADO", journeyId: J1.id });
        check("PROFESSIONAL cria TERMOS ASSINADO", s.status === 201 && s.data.item?.signatureStatus === "ASSINADO", s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { signatureStatus: "PENDENTE" });
        check("PROFESSIONAL rebaixa termo ASSINADO", s.status === 200 && s.data.item?.signatureStatus === "PENDENTE", s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { signatureStatus: "ASSINADO", journeyId: J1.id });
        check("PROFESSIONAL reassina e muda a jornada do termo", s.status === 200 && s.data.item?.journeyId === J1.id, s.status);
      });
    } else check("usuário PROFESSIONAL do gate criado", false, `team ${prof.status} login ${prof.session?.status}`);
  } finally {
    for (const m of [staff, prof]) if (m.member) await api("DELETE", "/api/team", { membershipId: m.member.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [staff.login, prof.login] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [staff.login, prof.login] } } });
  }
}

async function sessionPerQuote() {
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const dataUrl = `data:image/png;base64,${pngB64}`;
  const nameA = `E2E Sessao A ${run}`;
  const nameB = `E2E Sessao B ${run}`;
  const nameC = `E2E Sessao C ${run}`;
  const mkProc = async (name, durationMinutes) => {
    await api("POST", "/api/procedures", { name, category: "Facial", price: 500, durationMinutes, margin: 30 });
    return (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === name);
  };
  const pa = await mkProc(nameA, 20);
  const pb = await mkProc(nameB, 45);
  const pc = await mkProc(nameC, 10);
  check("sessão única: procedimentos criados", pa && pb && pc, JSON.stringify([pa?.id, pb?.id, pc?.id]));
  if (!pa || !pb || !pc) return;
  const P = (await api("POST", "/api/patients", { name: `E2E Sessao Unica ${run}`, phone: "11999990050", age: 35, cpf: randomCpf() })).data.patient.id;
  const P2 = (await api("POST", "/api/patients", { name: `E2E Sessao Outro ${run}`, phone: "11999990051", age: 35, cpf: randomCpf() })).data.patient.id;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const J = (await api("POST", `/api/patients/${P}/journeys`, { name: `E2E Sessao J ${run}`, professionalId: professional?.id })).data.journey;
  const ev = (await api("PUT", `/api/patients/${P}/evaluation`, { journeyId: J.id, photos: [], assessment: { chiefComplaint: "Queixa", patientGoal: "Obj" }, status: "Concluída" })).data.evaluation;
  const mkQuote = async (details, approve) => {
    const q = await api("POST", "/api/quotes", { patientId: P, journeyId: J.id, evaluationId: ev.id, details, paymentMethod: "Pix", installments: 1, notes: "" });
    if (approve) for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote.id}`, { status, evaluationId: ev.id });
    return q.data.quote?.id;
  };
  const Q = await mkQuote([{ procedureId: pa.id, quantity: 2, discountCents: 0 }, { procedureId: pb.id, quantity: 1, discountCents: 0 }], true);
  const Qother = await mkQuote([{ procedureId: pc.id, quantity: 1, discountCents: 0 }], true);
  const Qdraft = await mkQuote([{ procedureId: pa.id, quantity: 1, discountCents: 0 }], false);
  const url = `/api/patients/${P}/procedure-sessions`;
  const count = (quoteId) => prisma.patientProcedureSession.count({ where: { patientId: P, quoteId } });

  let r = await api("POST", url, { journeyId: J.id, quoteId: Qdraft });
  check("sessão única: orçamento não aprovado é recusado (409) e nada é gravado", r.status === 409 && await count(Qdraft) === 0, `${r.status} ${await count(Qdraft)}`);
  r = await api("POST", url, { journeyId: J.id });
  check("sessão única: sem quoteId => 400", r.status === 400, r.status);
  r = await api("POST", url, { journeyId: J.id, quoteId: "inexistente" });
  check("sessão única: orçamento inexistente => 404", r.status === 404, r.status);
  r = await api("POST", "/api/patients/inexistente/procedure-sessions", { journeyId: J.id, quoteId: Q });
  check("sessão única: paciente inexistente/de outra clínica => 404 sem vazar dados", r.status === 404 && !JSON.stringify(r.data).includes(nameA), `${r.status}`);
  r = await api("POST", `/api/patients/${P2}/procedure-sessions`, { journeyId: J.id, quoteId: Q });
  check("sessão única: orçamento de outro paciente => 404 e nada gravado", r.status === 404 && await prisma.patientProcedureSession.count({ where: { patientId: P2 } }) === 0, r.status);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q, procedureId: pc.id });
  check("sessão única: procedureId fora do orçamento => 400 e nada gravado", r.status === 400 && await count(Q) === 0, `${r.status} ${await count(Q)}`);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q, performedAt: "não é data" });
  check("sessão única: data inválida => 400", r.status === 400 && await count(Q) === 0, r.status);

  const [d1, d2] = await Promise.all([api("POST", url, { journeyId: J.id, quoteId: Q }), api("POST", url, { journeyId: J.id, quoteId: Q })]);
  const codes = [d1.status, d2.status].sort();
  check("sessão única: POST duplo simultâneo => 201 + 200, mesmo id, 1 sessão no banco", codes[0] === 200 && codes[1] === 201 && d1.data.session?.id === d2.data.session?.id && await count(Q) === 1, `${d1.status}/${d2.status} n=${await count(Q)}`);
  const created = [d1, d2].find((x) => x.status === 201);
  if (!created) return;
  const S = created.data.session;
  const combined = `${nameA} + ${nameB}`;
  check("sessão única: nome combinado, minutos somados (20x2+45=85), status Rascunho", S.procedureName === combined && S.estimatedMinutes === 85 && S.status === "Rascunho", JSON.stringify([S.procedureName, S.estimatedMinutes, S.status]));
  check("sessão única: reused:true só no POST que reaproveitou", [d1, d2].find((x) => x.status === 200)?.data.reused === true && created.data.reused === false);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q });
  check("sessão única: novo POST devolve 200, reused:true e o mesmo id", r.status === 200 && r.data.reused === true && r.data.session?.id === S.id, `${r.status} ${r.data.session?.id}`);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q, procedureId: pb.id });
  check("sessão única: procedureId do orçamento é aceito e reaproveita a sessão", r.status === 200 && r.data.session?.id === S.id && await count(Q) === 1, `${r.status} n=${await count(Q)}`);
  const parents = await prisma.patientProcedure.count({ where: { quoteId: Q } });
  check("sessão única: um único registro de procedimento por orçamento", parents === 1, parents);
  const list = (await api("GET", `${url}?journeyId=${J.id}&quoteId=${Q}`)).data;
  check("sessão única: GET devolve exatamente 1 sessão com nome combinado", list.sessions?.length === 1 && list.sessions[0].procedureName === combined, JSON.stringify(list.sessions?.map((x) => x.procedureName)));

  const sPath = `${url}/${S.id}`;
  r = await api("PATCH", sPath, { procedureName: "Nome arbitrário qualquer" });
  check("sessão única: PATCH com nome arbitrário => 400", r.status === 400, r.status);
  r = await api("PATCH", sPath, { procedureName: nameC });
  check("sessão única: PATCH com procedimento de outro orçamento => 400", r.status === 400, r.status);
  r = await api("PATCH", sPath, { procedureName: nameA });
  check("sessão única: PATCH com um item do orçamento => 200", r.status === 200 && r.data.session?.procedureName === nameA, `${r.status} ${r.data.session?.procedureName}`);
  r = await api("PATCH", sPath, { procedureName: combined });
  check("sessão única: PATCH com o nome combinado => 200", r.status === 200 && r.data.session?.procedureName === combined, `${r.status} ${r.data.session?.procedureName}`);
  r = await api("PATCH", sPath, { procedureName: "x".repeat(200) });
  check("sessão única: PATCH com nome de 200 caracteres => 400", r.status === 400, r.status);

  const start = (extra = {}) => api("PATCH", sPath, { status: "Em execução", technique: "E2E técnica", treatedAreas: "E2E região", photos: [{ id: `ph-${run}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 }], ...extra });
  r = await start();
  check("sessão única: iniciar sem termo assinado => 409 CONSENT_REQUIRED", r.status === 409 && r.data?.code === "CONSENT_REQUIRED", `${r.status} ${r.data?.code}`);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const form = new FormData();
  form.set("file", new Blob([pdf], { type: "application/pdf" }), "Termo sessao.pdf");
  form.set("category", "TERMOS"); form.set("signatureStatus", "ASSINADO"); form.set("journeyId", J.id);
  const up = await fetch(`${baseUrl}/api/patients/${P}/documents`, { method: "POST", headers: { cookie }, body: form });
  check("sessão única: termo assinado enviado", up.status === 201, up.status);
  r = await start({ technique: "" });
  check("sessão única: iniciar sem técnica => 400", r.status === 400, r.status);
  r = await start({ treatedAreas: "" });
  check("sessão única: iniciar sem região => 400", r.status === 400, r.status);
  r = await start({ photos: [] });
  check("sessão única: iniciar sem foto de antes => 400", r.status === 400, r.status);
  r = await start();
  check("sessão única: iniciar completo com termo => 200 Em execução", r.status === 200 && r.data.session?.status === "Em execução", `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q });
  check("sessão única: POST com sessão em execução reaproveita (200, mesmo id)", r.status === 200 && r.data.session?.id === S.id && await count(Q) === 1, `${r.status} n=${await count(Q)}`);

  await prisma.patientProcedureSession.update({ where: { id: S.id }, data: { status: "Concluída" } });
  const [n1, n2] = await Promise.all([api("POST", url, { journeyId: J.id, quoteId: Q }), api("POST", url, { journeyId: J.id, quoteId: Q })]);
  const newer = [n1, n2].find((x) => x.status === 201);
  check("sessão única: com a anterior concluída, POST duplo cria só 1 nova (201+200)", [n1.status, n2.status].sort().join() === "200,201" && newer?.data.session.id !== S.id && n1.data.session?.id === n2.data.session?.id && await count(Q) === 2, `${n1.status}/${n2.status} n=${await count(Q)}`);
  check("sessão única: a nova também traz nome combinado e 85 minutos", newer?.data.session.procedureName === combined && newer.data.session.estimatedMinutes === 85, JSON.stringify([newer?.data.session.procedureName, newer?.data.session.estimatedMinutes]));
  r = await api("POST", url, { journeyId: J.id, quoteId: Qother });
  check("sessão única: outro orçamento aprovado tem a própria sessão (nome simples, 10 min)", r.status === 201 && r.data.session?.procedureName === nameC && r.data.session.estimatedMinutes === 10 && r.data.session.id !== S.id, `${r.status} ${r.data.session?.procedureName} ${r.data.session?.estimatedMinutes}`);
}

async function scheduledProcedure() {
  const name = `E2E Agendado ${run}`;
  await api("POST", "/api/procedures", { name, category: "Facial", price: 300, durationMinutes: 30, margin: 30 });
  const proc = (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === name);
  check("agenda do procedimento: procedimento criado", Boolean(proc), proc?.id);
  if (!proc) return;
  const P = (await api("POST", "/api/patients", { name: `E2E Agenda Proc ${run}`, phone: "11999990060", age: 35, cpf: randomCpf() })).data.patient.id;
  const P2 = (await api("POST", "/api/patients", { name: `E2E Agenda Outro ${run}`, phone: "11999990061", age: 35, cpf: randomCpf() })).data.patient.id;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const mkJourney = async (patientId, label) => {
    const j = (await api("POST", `/api/patients/${patientId}/journeys`, { name: `E2E ${label} ${run}`, professionalId: professional?.id })).data.journey;
    const ev = (await api("PUT", `/api/patients/${patientId}/evaluation`, { journeyId: j.id, photos: [], assessment: { chiefComplaint: "Queixa", patientGoal: "Obj" }, status: "Concluída" })).data.evaluation;
    const q = await api("POST", "/api/quotes", { patientId, journeyId: j.id, evaluationId: ev.id, details: [{ procedureId: proc.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" });
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote.id}`, { status, evaluationId: ev.id });
    return { id: j.id, quoteId: q.data.quote.id };
  };
  const J1 = await mkJourney(P, "Agenda J1");
  const J2 = await mkJourney(P, "Agenda J2");
  const JO = await mkJourney(P2, "Agenda Outro");
  const sessUrl = `/api/patients/${P}/procedure-sessions`;
  const getSessions = (j = J1) => api("GET", `${sessUrl}?journeyId=${j.id}&quoteId=${j.quoteId}`);
  const procName = `Procedimento - ${name}`;
  const returnName = `Retorno - ${name}`;
  const body = (extra = {}) => ({ patientId: P, journeyId: J1.id, procedure: procName, professional: "Teste", time: "10:00", date: day(2), ...extra });
  const activeCount = (journeyId, procedure) => prisma.appointment.count({ where: { patientId: P, journeyId, procedure, status: { in: ["Agendado", "Em atendimento"] } } });

  let r = await getSessions();
  check("agenda do procedimento: sem agendamento => scheduledProcedure null", r.status === 200 && r.data.scheduledProcedure === null, `${r.status} ${JSON.stringify(r.data.scheduledProcedure)}`);
  const sess = (await api("POST", sessUrl, { journeyId: J1.id, quoteId: J1.quoteId })).data.session;

  r = await api("POST", "/api/appointments", body({ date: day(-1) }));
  check("agenda do procedimento: data passada => 400", r.status === 400, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", body({ time: "99:99" }));
  check("agenda do procedimento: horário inválido => 400", r.status === 400, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", body({ time: "03:00" }));
  check("agenda do procedimento: horário fora do expediente => 400", r.status === 400, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", body({ date: "não é data" }));
  check("agenda do procedimento: data inválida => 400", r.status === 400, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", body({ journeyId: JO.id }));
  check("agenda do procedimento: jornada de outro paciente => 404 e nada gravado", r.status === 404 && await prisma.appointment.count({ where: { journeyId: JO.id } }) === 0, `${r.status}`);
  r = await api("POST", "/api/appointments", body({ patientId: "inexistente" }));
  check("agenda do procedimento: paciente inexistente/de outra clínica => 404", r.status === 404, r.status);
  check("agenda do procedimento: recusas não gravaram nada", await prisma.appointment.count({ where: { patientId: P } }) === 0);

  const [a, b] = await Promise.all([api("POST", "/api/appointments", body()), api("POST", "/api/appointments", body())]);
  const created = [a, b].find((x) => x.status === 201);
  check("agenda do procedimento: POST duplo simultâneo => 1x 201 e 1x 409, 1 agendamento no banco", [a.status, b.status].sort().join() === "201,409" && await activeCount(J1.id, procName) === 1, `${a.status}/${b.status} n=${await activeCount(J1.id, procName)}`);
  if (!created) return;
  const first = created.data.appointment;
  // Se a corrida criou duplicata (bug reportado acima), cancela a sobra para os próximos passos continuarem isolados.
  for (const extra of [a, b].filter((x) => x.status === 201 && x !== created)) await api("PATCH", `/api/appointments/${extra.data.appointment.id}`, { status: "Cancelado" });
  check("agenda do procedimento: criado como Agendado, dia gravado", first.status === "Agendado" && first.date === `${day(2)}T15:00:00.000Z` && first.journeyId === J1.id, JSON.stringify([first.status, first.date]));
  r = await api("POST", "/api/appointments", body({ time: "14:00", date: day(3) }));
  check("agenda do procedimento: mesmo procedimento/jornada ainda Agendado => 409 mesmo em outro horário", r.status === 409, r.status);

  r = await api("POST", "/api/appointments", body({ procedure: returnName, time: "11:00" }));
  check("agenda do procedimento: 'Retorno - nome' é independente (201)", r.status === 201, `${r.status} ${r.data.message}`);
  const ret1 = r.data.appointment;
  r = await api("POST", "/api/appointments", body({ procedure: returnName, time: "12:00" }));
  check("agenda do procedimento: segundo 'Retorno - nome' continua permitido (201)", r.status === 201, r.status);
  r = await api("POST", "/api/appointments", body({ journeyId: J2.id, time: "10:00" }));
  check("agenda do procedimento: mesmo nome em outra jornada do mesmo paciente => 201", r.status === 201, `${r.status} ${r.data.message}`);
  const otherJourneyAppt = r.data.appointment;
  r = await api("POST", "/api/appointments", { patientId: P2, journeyId: JO.id, procedure: procName, professional: "Teste", time: "10:00", date: day(2) });
  check("agenda do procedimento: mesmo nome em outro paciente => 201", r.status === 201, `${r.status} ${r.data.message}`);
  const otherPatientAppt = r.data.appointment;

  r = await getSessions();
  const sp = r.data.scheduledProcedure;
  check("agenda do procedimento: GET devolve scheduledProcedure com os campos esperados", r.status === 200 && sp?.id === first.id && sp.date === day(2) && sp.time === "10:00" && sp.procedure === procName && sp.professional === "Teste" && sp.status === "Agendado" && !("notes" in sp), JSON.stringify(sp));
  check("agenda do procedimento: só 6 campos (sem notes, sem paciente)", sp && Object.keys(sp).sort().join() === "date,id,procedure,professional,status,time", Object.keys(sp ?? {}).join());
  check("agenda do procedimento: não devolve retorno nem agendamento de outra jornada/paciente", ![ret1.id, otherJourneyAppt.id, otherPatientAppt.id].includes(sp?.id) && !JSON.stringify(r.data).includes(otherPatientAppt.id) && !JSON.stringify(r.data).includes(otherJourneyAppt.id));
  const s1 = r.data.sessions?.find((x) => x.id === sess?.id);
  check("agenda do procedimento: sessão continua Rascunho (não iniciou)", s1?.status === "Rascunho" && r.data.sessions.length === 1, `${s1?.status} n=${r.data.sessions?.length}`);
  r = await api("GET", `${sessUrl}?journeyId=${J2.id}&quoteId=${J2.quoteId}`);
  check("agenda do procedimento: GET da outra jornada traz só o agendamento dela", r.data.scheduledProcedure?.id === otherJourneyAppt.id, r.data.scheduledProcedure?.id);
  r = await api("GET", `/api/patients/${P2}/procedure-sessions?journeyId=${J1.id}&quoteId=${J1.quoteId}`);
  check("agenda do procedimento: GET com jornada de outro paciente => 404 sem vazar", r.status === 404 && !JSON.stringify(r.data).includes(first.id), r.status);
  r = await api("GET", `/api/patients/inexistente/procedure-sessions?journeyId=${J1.id}&quoteId=${J1.quoteId}`);
  check("agenda do procedimento: GET paciente inexistente/de outra clínica => 404", r.status === 404, r.status);

  r = await api("PATCH", `/api/appointments/${first.id}`, { status: "Cancelado" });
  check("agenda do procedimento: cancelar o agendamento", r.status === 200 && r.data.appointment?.status === "Cancelado", `${r.status}`);
  r = await getSessions();
  check("agenda do procedimento: após cancelar, scheduledProcedure volta a null", r.data.scheduledProcedure === null, JSON.stringify(r.data.scheduledProcedure));
  r = await api("POST", "/api/appointments", body({ time: "15:00" }));
  check("agenda do procedimento: após cancelar, novo agendamento => 201", r.status === 201, `${r.status} ${r.data.message}`);
  r = await getSessions();
  check("agenda do procedimento: GET devolve o novo agendamento (não o cancelado)", r.data.scheduledProcedure?.time === "15:00" && r.data.scheduledProcedure?.id !== first.id, JSON.stringify(r.data.scheduledProcedure));
  check("agenda do procedimento: sessão segue Rascunho", (await prisma.patientProcedureSession.findUnique({ where: { id: sess.id }, select: { status: true } }))?.status === "Rascunho");

  // Duplicata também vale para o nome puro e a variante prefixada; Retorno/Avaliação ficam de fora.
  r = await api("POST", "/api/appointments", body({ procedure: name, time: "16:00" }));
  check("agenda do procedimento: nome puro com 'Procedimento - X' ativo => 409", r.status === 409, r.status);
  r = await api("POST", "/api/appointments", body({ procedure: `Avaliação ${name}`, time: "16:00" }));
  check("agenda do procedimento: 'Avaliação…' não é tratada como duplicata (201)", r.status === 201, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", { patientId: P2, journeyId: JO.id, procedure: name, professional: "Teste", time: "11:00", date: day(2) });
  check("agenda do procedimento: nome puro vs prefixada já ativa em outra jornada/paciente => 409", r.status === 409, r.status);
  const J3 = await mkJourney(P, "Agenda J3");
  r = await api("POST", "/api/appointments", body({ journeyId: J3.id, procedure: name }));
  check("agenda do procedimento: nome puro na jornada nova => 201", r.status === 201, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", body({ journeyId: J3.id }));
  check("agenda do procedimento: 'Procedimento - X' com nome puro ativo => 409", r.status === 409, r.status);
  const J4 = await mkJourney(P, "Agenda J4");
  const [c1, c2] = await Promise.all([api("POST", "/api/appointments", body({ journeyId: J4.id, procedure: name })), api("POST", "/api/appointments", body({ journeyId: J4.id }))]);
  check("agenda do procedimento: nome puro e prefixado simultâneos => 1x 201 e 1x 409", [c1.status, c2.status].sort().join() === "201,409", `${c1.status}/${c2.status}`);

  // PATCH de procedure
  const retId = ret1.id;
  r = await api("PATCH", `/api/appointments/${retId}`, { procedure: procName });
  check("agenda do procedimento: PATCH procedure para nome já ativo na jornada => 409 e nada muda", r.status === 409 && (await prisma.appointment.findUnique({ where: { id: retId }, select: { procedure: true } })).procedure === returnName, r.status);
  r = await api("PATCH", `/api/appointments/${retId}`, { procedure: name });
  check("agenda do procedimento: PATCH para nome puro de procedimento ativo => 409", r.status === 409, r.status);
  const activeId = (await getSessions()).data.scheduledProcedure?.id;
  r = await api("PATCH", `/api/appointments/${activeId}`, { procedure: procName, notes: "ok" });
  check("agenda do procedimento: PATCH mantendo o próprio nome (exclui o próprio id) => 200", r.status === 200, `${r.status} ${r.data.message}`);
  r = await api("PATCH", `/api/appointments/${retId}`, { procedure: `Procedimento - ${name} livre` });
  check("agenda do procedimento: PATCH para nome sem duplicata => 200", r.status === 200 && r.data.appointment?.procedure === `Procedimento - ${name} livre`, `${r.status} ${r.data.message}`);

  // notes > 500
  const longNotes = "n".repeat(501);
  r = await api("POST", "/api/appointments", body({ journeyId: undefined, procedure: returnName, time: "17:00", notes: longNotes }));
  check("agenda do procedimento: POST com notes de 501 caracteres => 400", r.status === 400, r.status);
  r = await api("PATCH", `/api/appointments/${activeId}`, { notes: longNotes });
  check("agenda do procedimento: PATCH com notes de 501 caracteres => 400", r.status === 400, r.status);
  r = await api("PATCH", `/api/appointments/${activeId}`, { notes: "n".repeat(500) });
  check("agenda do procedimento: PATCH com notes de 500 caracteres => 200", r.status === 200, r.status);

  // procedureNames da jornada
  const combined = `Procedimento - ${name} + ${name} B`;
  const J5 = await mkJourney(P, "Agenda J5");
  await api("POST", "/api/appointments", body({ journeyId: J5.id, procedure: combined, time: "09:00", date: day(4) }));
  r = await api("GET", `/api/patients/${P}/journeys`);
  const names = r.data.journeys?.flatMap((j) => j.procedureNames) ?? [];
  const names5 = r.data.journeys?.find((j) => j.id === J5.id)?.procedureNames ?? [];
  check("agenda do procedimento: journeys.procedureNames sem prefixo 'Procedimento - '", names.length > 0 && !names.some((n) => n.startsWith("Procedimento - ")), JSON.stringify(names.filter((n) => n.startsWith("Procedimento - "))));
  check("agenda do procedimento: nome combinado vira itens sem duplicata", !names5.some((n) => n.includes(" + ")) && names5.length === new Set(names5).size && names5.includes(name) && names5.includes(`${name} B`), JSON.stringify(names5));

  // Jornada padrão (sem journeyId no corpo)
  const P5 = (await api("POST", "/api/patients", { name: `E2E Agenda Padrao ${run}`, phone: "11999990062", age: 35, cpf: randomCpf() })).data.patient.id;
  const noJ = (extra = {}) => ({ patientId: P5, procedure: procName, professional: "Teste", time: "10:00", date: day(2), ...extra });
  r = await api("POST", "/api/appointments", noJ());
  check("agenda do procedimento: POST sem journeyId cria na jornada padrão (201)", r.status === 201, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", noJ({ time: "11:00" }));
  check("agenda do procedimento: POST sem journeyId duplicando na jornada padrão => 409", r.status === 409, r.status);
  const [d1, d2] = await Promise.all([api("POST", "/api/appointments", noJ({ procedure: returnName })), api("POST", "/api/appointments", noJ({ procedure: returnName }))]);
  check("agenda do procedimento: Retorno sem journeyId não sofre trava de duplicata", d1.status === 201 && d2.status === 201, `${d1.status}/${d2.status}`);

  // Reabrir / renomear encerrado
  r = await api("PATCH", `/api/appointments/${first.id}`, { status: "Agendado" });
  check("agenda do procedimento: reabrir Cancelado->Agendado com outro ativo do mesmo procedimento => 409", r.status === 409, `${r.status}`);
  check("agenda do procedimento: reabertura recusada não alterou o status", (await prisma.appointment.findUnique({ where: { id: first.id }, select: { status: true } })).status === "Cancelado");
  r = await api("PATCH", `/api/appointments/${first.id}`, { procedure: name });
  check("agenda do procedimento: renomear agendamento Cancelado para nome ativo NÃO dá 409 (200)", r.status === 200 && r.data.appointment?.status === "Cancelado", `${r.status} ${r.data.message}`);

  // PATCH simultâneo
  const J6 = await mkJourney(P, "Agenda J6");
  const rA = (await api("POST", "/api/appointments", body({ journeyId: J6.id, procedure: returnName, time: "09:00" }))).data.appointment;
  const rB = (await api("POST", "/api/appointments", body({ journeyId: J6.id, procedure: returnName, time: "09:30" }))).data.appointment;
  const target = `Procedimento - ${name} simultaneo`;
  const [e1, e2] = await Promise.all([api("PATCH", `/api/appointments/${rA.id}`, { procedure: target }), api("PATCH", `/api/appointments/${rB.id}`, { procedure: target })]);
  check("agenda do procedimento: dois PATCH simultâneos para o mesmo nome => 200 + 409", [e1.status, e2.status].sort().join() === "200,409" && await activeCount(J6.id, target) === 1, `${e1.status}/${e2.status} n=${await activeCount(J6.id, target)}`);

  // Tipos errados
  for (const [label, extra] of [["procedure numérico", { procedure: 123 }], ["time numérico", { time: 900 }], ["notes objeto", { notes: { a: 1 } }]]) {
    r = await api("POST", "/api/appointments", body({ journeyId: J6.id, time: "13:00", ...extra }));
    check(`agenda do procedimento: POST com ${label} => 400 'Dados do agendamento inválidos.'`, r.status === 400 && r.data.message === "Dados do agendamento inválidos.", `${r.status} ${r.data.message}`);
  }
  for (const [label, extra] of [["procedure numérico", { procedure: 123 }], ["time numérico", { time: 900 }], ["notes objeto", { notes: { a: 1 } }]]) {
    r = await api("PATCH", `/api/appointments/${activeId}`, extra);
    check(`agenda do procedimento: PATCH com ${label} => 400 'Dados do agendamento inválidos.'`, r.status === 400 && r.data.message === "Dados do agendamento inválidos.", `${r.status} ${r.data.message}`);
  }
}

async function startMovesAppointment() {
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const name = `E2E Inicio ${run}`;
  await api("POST", "/api/procedures", { name, category: "Facial", price: 300, durationMinutes: 30, margin: 30 });
  const proc = (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === name);
  check("início move agendamento: procedimento criado", Boolean(proc), proc?.id);
  if (!proc) return;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const mkPatient = async (label, phone) => (await api("POST", "/api/patients", { name: `E2E Inicio ${label} ${run}`, phone, age: 35, cpf: randomCpf() })).data.patient.id;
  const P = await mkPatient("A", "11999990070");
  const P2 = await mkPatient("B", "11999990071");
  const upload = async (patientId, journeyId, signatureStatus) => {
    const form = new FormData();
    form.set("file", new Blob([pdf], { type: "application/pdf" }), "Termo.pdf");
    form.set("category", "TERMOS"); form.set("signatureStatus", signatureStatus); form.set("journeyId", journeyId);
    return fetch(`${baseUrl}/api/patients/${patientId}/documents`, { method: "POST", headers: { cookie }, body: form });
  };
  const mk = async (patientId, label, { signed = true } = {}) => {
    const j = (await api("POST", `/api/patients/${patientId}/journeys`, { name: `E2E ${label} ${run}`, professionalId: professional?.id })).data.journey;
    const ev = (await api("PUT", `/api/patients/${patientId}/evaluation`, { journeyId: j.id, photos: [], assessment: { chiefComplaint: "Queixa", patientGoal: "Obj" }, status: "Concluída" })).data.evaluation;
    const q = await api("POST", "/api/quotes", { patientId, journeyId: j.id, evaluationId: ev.id, details: [{ procedureId: proc.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" });
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote.id}`, { status, evaluationId: ev.id });
    const s = (await api("POST", `/api/patients/${patientId}/procedure-sessions`, { journeyId: j.id, quoteId: q.data.quote.id, procedureId: proc.id })).data.session;
    if (signed) await upload(patientId, j.id, "ASSINADO");
    return { patientId, journeyId: j.id, quoteId: q.data.quote.id, sessionId: s?.id };
  };
  const procName = `Procedimento - ${name}`;
  const otherName = `Procedimento - ${name} Outro`;
  const mkAppt = async (J, extra = {}) => (await api("POST", "/api/appointments", { patientId: J.patientId, journeyId: J.journeyId, procedure: procName, professional: "Teste", date: day(7), time: "10:00", notes: "", ...extra })).data.appointment;
  const start = (J, extra = {}) => api("PATCH", `/api/patients/${J.patientId}/procedure-sessions/${J.sessionId}`, { status: "Em execução", technique: "E2E técnica", treatedAreas: "E2E região", professional: "E2E Prof", photos: [{ id: `ph-${run}-${Math.random()}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 }], ...extra });
  const row = (id) => prisma.appointment.findUnique({ where: { id }, select: { date: true, time: true, status: true } });
  const snap = async (id) => JSON.stringify(await row(id));
  const nowSp = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date());
  const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const auditMoves = (s) => (s?.auditLog ?? []).filter((e) => /Agendamento alterado para o início/.test(e.action)).length;

  // Recusas não mexem no agendamento.
  const A = await mk(P, "Inicio A", { signed: false });
  const apptA = await mkAppt(A);
  const retA = await mkAppt(A, { procedure: `Retorno - ${name}`, time: "11:00" });
  const J2 = await mk(P, "Inicio A2");
  const apptJ2 = await mkAppt(J2, { time: "12:00" });
  const JO = await mk(P2, "Inicio Outro");
  const apptO = await mkAppt(JO, { time: "13:00" });
  check("início move agendamento: agendamentos de preparo criados", [apptA, retA, apptJ2, apptO].every(Boolean), JSON.stringify([apptA?.id, retA?.id, apptJ2?.id, apptO?.id]));
  if (![apptA, retA, apptJ2, apptO].every(Boolean)) return;
  const before = { a: await snap(apptA.id), ret: await snap(retA.id), j2: await snap(apptJ2.id), o: await snap(apptO.id) };
  let r = await start(A);
  check("início sem termo (ausente) => 409 CONSENT_REQUIRED, mensagem de termo ausente e agendamento intacto", r.status === 409 && r.data?.code === "CONSENT_REQUIRED" && /anexe o termo de consentimento assinado/.test(r.data.message) && await snap(apptA.id) === before.a, `${r.status} ${r.data?.code} ${r.data?.message}`);
  await upload(P, A.journeyId, "PENDENTE");
  r = await start(A);
  check("início com termo só pendente => 409 e mensagem de termo pendente (não a de ausente)", r.status === 409 && r.data?.code === "CONSENT_REQUIRED" && /não assinado/.test(r.data.message) && !/anexe o termo/.test(r.data.message) && await snap(apptA.id) === before.a, `${r.status} ${r.data?.message}`);
  await upload(P, A.journeyId, "ASSINADO");
  r = await start(A, { technique: "" });
  const r2 = await start(A, { treatedAreas: "  " });
  const r3 = await start(A, { photos: [] });
  const r4 = await start(A, { photos: [{ id: "x", phase: "Imediatamente após", imageUrl: dataUrl, name: "d", width: 1, height: 1 }] });
  check("início sem técnica / sem região / sem foto de antes => 400 e agendamento intacto", [r.status, r2.status, r3.status, r4.status].every((s) => s === 400) && await snap(apptA.id) === before.a, `${r.status}/${r2.status}/${r3.status}/${r4.status}`);

  // Início duplo concorrente: um só move.
  const [d1, d2] = await Promise.all([start(A), start(A)]);
  const moved = [d1, d2].filter((x) => x.data?.appointment?.id === apptA.id);
  const rowA = await row(apptA.id);
  const clock = nowSp();
  const dayStr = rowA.date.toISOString().slice(0, 10);
  check("início duplo: sem 500 e exatamente uma resposta traz o agendamento movido", d1.status < 500 && d2.status < 500 && moved.length === 1, `${d1.status}/${d2.status} moved=${moved.length}`);
  const winner = moved[0];
  check("início: resposta traz appointment {id,date,time} de hoje e hora atual (±2 min)", winner?.status === 200 && winner.data.appointment.date === clock.slice(0, 10) && Math.abs(mins(winner.data.appointment.time) - mins(clock.slice(11, 16))) <= 2, JSON.stringify([winner?.data?.appointment, clock]));
  check("início: banco do agendamento = hoje e hora atual, ainda Agendado", dayStr === clock.slice(0, 10) && rowA.time === winner?.data?.appointment?.time && rowA.status === "Agendado", JSON.stringify([rowA, clock]));
  const sessList = (await api("GET", `/api/patients/${P}/procedure-sessions?journeyId=${A.journeyId}&quoteId=${A.quoteId}`)).data;
  check("início: scheduledProcedure reflete a nova data/hora", sessList.scheduledProcedure?.id === apptA.id && sessList.scheduledProcedure.date === clock.slice(0, 10) && sessList.scheduledProcedure.time === rowA.time, JSON.stringify(sessList.scheduledProcedure));
  const boot = (await api("GET", "/api/agenda/bootstrap")).data.appointments?.find((a) => a.id === apptA.id);
  check("início: agenda/bootstrap mostra o agendamento de hoje na hora atual", boot && String(boot.date).slice(0, 10) === clock.slice(0, 10) && boot.time === rowA.time, JSON.stringify(boot));
  check("início: auditLog tem 'Agendamento alterado para o início' uma única vez", auditMoves(winner?.data?.session) === 1 && sessList.sessions?.find((s) => s.id === A.sessionId)?.status === "Em execução", `${auditMoves(winner?.data?.session)}`);
  check("início: Retorno, outra jornada e outro paciente NÃO foram tocados", await snap(retA.id) === before.ret && await snap(apptJ2.id) === before.j2 && await snap(apptO.id) === before.o, "");

  // Já movido não move de novo.
  const future = new Date(`${day(9)}T15:00:00.000Z`);
  await prisma.appointment.update({ where: { id: apptA.id }, data: { date: future, time: "09:00" } });
  r = await api("PATCH", `/api/patients/${P}/procedure-sessions/${A.sessionId}`, { status: "Em execução", observations: "E2E obs", scheduledAppointmentId: apptA.id });
  const afterRe = await row(apptA.id);
  check("PATCH em sessão já em execução não move o agendamento de novo (mesmo com scheduledAppointmentId)", r.status === 200 && (r.data.appointment ?? null) === null && afterRe.time === "09:00" && afterRe.date.toISOString() === future.toISOString() && auditMoves(r.data.session) === 1, `${r.status} ${JSON.stringify(r.data.appointment)} ${JSON.stringify(afterRe)}`);

  // Sem agendamento.
  const N = await mk(P, "Inicio N");
  r = await start(N);
  check("início sem agendamento => 200 e appointment null", r.status === 200 && r.data.session?.status === "Em execução" && r.data.appointment === null && auditMoves(r.data.session) === 0, `${r.status} ${JSON.stringify(r.data.appointment)}`);

  // Cancelado, Em atendimento, só Retorno.
  const C = await mk(P, "Inicio C");
  const apptC = await mkAppt(C);
  await api("PATCH", `/api/appointments/${apptC.id}`, { status: "Cancelado" });
  const E = await mk(P, "Inicio E");
  const apptE = await mkAppt(E);
  await prisma.appointment.update({ where: { id: apptE.id }, data: { status: "Em atendimento" } });
  const R = await mk(P, "Inicio R");
  const apptR = await mkAppt(R, { procedure: `Retorno - ${name}` });
  const sn = { c: await snap(apptC.id), e: await snap(apptE.id), r: await snap(apptR.id) };
  const rc = await start(C), re = await start(E), rr = await start(R);
  check("início não move agendamento Cancelado, Em atendimento nem só-Retorno", [rc, re, rr].every((x) => x.status === 200 && x.data.appointment === null) && await snap(apptC.id) === sn.c && await snap(apptE.id) === sn.e && await snap(apptR.id) === sn.r, `${rc.status}/${re.status}/${rr.status}`);

  // scheduledAppointmentId: ids fora do escopo não movem nada; o início segue.
  const bad = [];
  const mkBadCase = async (label, makeId) => {
    const J = await mk(P, `Inicio Id ${label}`);
    const decoy = await mkAppt(J, { procedure: otherName, time: "14:00" });
    const id = await makeId(J);
    const decoyBefore = await snap(decoy.id);
    const idBefore = id && await row(id) ? await snap(id) : null;
    const res = await start(J, { scheduledAppointmentId: id });
    const ok = res.status === 200 && res.data.session?.status === "Em execução" && res.data.appointment === null && await snap(decoy.id) === decoyBefore && (idBefore === null || await snap(id) === idBefore);
    if (!ok) bad.push(`${label}: ${res.status} ${JSON.stringify(res.data.appointment)}`);
  };
  await mkBadCase("outro paciente", async () => apptO.id);
  await mkBadCase("outra jornada", async () => apptJ2.id);
  await mkBadCase("inexistente", async () => "inexistente-xyz");
  await mkBadCase("retorno da própria jornada", async (J) => (await mkAppt(J, { procedure: `Retorno - ${name}`, time: "15:00" })).id);
  await mkBadCase("cancelado da própria jornada", async (J) => { const a = await mkAppt(J, { procedure: `Procedimento - ${name} Cancelado`, time: "16:00" }); await api("PATCH", `/api/appointments/${a.id}`, { status: "Cancelado" }); return a.id; });
  check("scheduledAppointmentId de outro paciente/jornada/inexistente/retorno/cancelado: nada move e o início segue", bad.length === 0 && await snap(apptO.id) === before.o && await snap(apptJ2.id) === before.j2, bad.join(" | "));

  // scheduledAppointmentId válido move exatamente esse (mesmo com nome diferente do da sessão).
  const V = await mk(P, "Inicio Id valido");
  const vSame = await mkAppt(V, { time: "10:30" });
  const vOther = await mkAppt(V, { procedure: otherName, time: "11:30" });
  const vSameBefore = await snap(vSame.id);
  r = await start(V, { scheduledAppointmentId: vOther.id });
  const clockV = nowSp();
  const vRow = await row(vOther.id);
  check("scheduledAppointmentId válido move exatamente esse agendamento e só ele", r.status === 200 && r.data.appointment?.id === vOther.id && vRow.time === r.data.appointment.time && vRow.date.toISOString().slice(0, 10) === clockV.slice(0, 10) && await snap(vSame.id) === vSameBefore, `${r.status} ${JSON.stringify(r.data.appointment)} ${JSON.stringify(vRow)}`);

  // Sem id: só o de nome exato da sessão; nomes diferentes não são movidos.
  const B = await mk(P, "Inicio Nome");
  const bOther = await mkAppt(B, { procedure: otherName, time: "08:30" });
  const bSame = await mkAppt(B, { time: "17:00" });
  const bOtherBefore = await snap(bOther.id);
  r = await start(B);
  check("sem id, 2 ativos de nomes diferentes: move só o da sessão (mesmo sendo o mais tarde)", r.status === 200 && r.data.appointment?.id === bSame.id && await snap(bOther.id) === bOtherBefore, `${r.status} ${JSON.stringify(r.data.appointment)}`);
  const Q = await mk(P, "Inicio Nome so outro");
  const qOther = await mkAppt(Q, { procedure: otherName, time: "08:30" });
  const qBefore = await snap(qOther.id);
  r = await start(Q);
  check("sem id, só agendamento com outro nome: nada move", r.status === 200 && r.data.appointment === null && await snap(qOther.id) === qBefore, `${r.status} ${JSON.stringify(r.data.appointment)}`);
}

// Apaga os dados de negócio da clínica de teste (mantém clínica, usuário e vínculo).
// Recusa se a clínica não for exatamente a de teste com um único membro: a conta de teste.
async function resetTestClinic() {
  const memberships = await prisma.clinicMembership.findMany({ where: { user: { email } }, select: { clinic: { select: { id: true, name: true, memberships: { select: { user: { select: { email: true } } } } } } } });
  const clinic = memberships[0]?.clinic;
  if (memberships.length !== 1 || clinic.name !== testClinicName || clinic.memberships.length !== 1 || clinic.memberships[0].user.email !== email) {
    throw new Error("A conta de teste não está sozinha na clínica de teste. Limpeza recusada.");
  }
  const clinicId = clinic.id;
  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { clinicId } }),
    prisma.pendingStockOutput.deleteMany({ where: { clinicId } }),
    prisma.expense.deleteMany({ where: { clinicId } }),
    prisma.purchase.deleteMany({ where: { clinicId } }),
    prisma.recurringExpense.deleteMany({ where: { clinicId } }),
    prisma.product.deleteMany({ where: { clinicId } }),
    prisma.procedure.deleteMany({ where: { clinicId } }),
    prisma.quote.deleteMany({ where: { clinicId } }),
    prisma.payment.deleteMany({ where: { clinicId } }),
    prisma.patientAnamnesis.deleteMany({ where: { clinicId } }),
    prisma.clinicalDocument.deleteMany({ where: { clinicId } }),
    prisma.clinicalPhoto.deleteMany({ where: { clinicId } }),
    prisma.clinicalFileAudit.deleteMany({ where: { clinicId } }),
    prisma.patient.deleteMany({ where: { clinicId } }),
  ]);
}

// Partes do roteiro, na ordem em que rodam. `needs` lista as partes que criam os dados que esta usa.
const suites = {
  pacientes: { needs: [], run: async (state) => Object.assign(state, await patientsAndPayments()) },
  orcamentos: { needs: ["pacientes"], run: async (state) => { state.quote = await quotesAndProcedures(state.patient); } },
  agenda: { needs: ["pacientes"], run: (state) => appointments(state.patient) },
  jornadas: { needs: ["orcamentos"], run: (state) => journeys(state.patient, state.quote) },
  configuracoes: { needs: [], run: () => settings() },
  estoque: { needs: ["pacientes"], run: (state) => stock(state.patient) },
  anamnese: { needs: [], run: () => anamnesis() },
  documentos: { needs: [], run: () => clinicalFiles() },
  consentimento: { needs: [], run: () => consentGate() },
  sessao_unica: { needs: [], run: () => sessionPerQuote() },
  agendar_procedimento: { needs: [], run: () => scheduledProcedure() },
  inicio_move_agenda: { needs: [], run: () => startMovesAppointment() },
  telas: { needs: ["orcamentos"], run: (state) => browser(state.homonym) },
  login: { needs: [], run: () => loginLockout() },
};

// Sem nomes, roda tudo. Com nomes, roda essas partes e as que elas precisam.
function selectSuites(names) {
  if (names.length === 0) return new Set(Object.keys(suites));
  const selected = new Set();
  const add = (name) => {
    if (!suites[name]) throw new Error(`Parte desconhecida: "${name}". Use: ${Object.keys(suites).join(", ")}.`);
    if (selected.has(name)) return;
    selected.add(name);
    suites[name].needs.forEach(add);
  };
  names.forEach(add);
  return selected;
}

async function main() {
  if (!email || !password) throw new Error("Defina TEST_ACCOUNT_EMAIL e TEST_ACCOUNT_PASSWORD no .env.");
  const selected = selectSuites(process.argv.slice(2));
  const alive = await fetch(`${baseUrl}/login`).catch(() => null);
  if (!alive?.ok) throw new Error(`Servidor fora do ar em ${baseUrl}. Rode npm run dev.`);
  await login();
  await resetTestClinic();

  const state = {};
  for (const [name, suite] of Object.entries(suites)) if (selected.has(name)) await suite.run(state);

  for (const result of results) console.log(`${result.ok ? "OK    " : "FALHOU"} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passaram (execução ${run}).`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  for (const result of results) console.log(`${result.ok ? "OK    " : "FALHOU"} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  console.error(`ERRO: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  if (email) await resetTestClinic().catch((error) => { console.error(`Limpeza da clínica de teste falhou: ${error.message}`); process.exitCode = 1; });
  await prisma.$disconnect();
});
