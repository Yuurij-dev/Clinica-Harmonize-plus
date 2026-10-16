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
