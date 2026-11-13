import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { PrismaClient } from "@prisma/client";

// Relatórios contra o Postgres LOCAL: isolamento por clínica e o que NÃO conta (Agendado, Em atendimento, Faltou, Cancelado,
// pagamento pendente, estoque estornado/ajuste). Ignora se DATABASE_URL não for localhost/127.0.0.1, banco harmonize.
// Dados com prefixo único, apagados no fim (cascata pela clínica).

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (match) return match[1];
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); } catch (error) {
      if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});

let prisma = null;
let skipReason = null;
const url = databaseUrl();
if (!url) {
  skipReason = "DATABASE_URL ausente";
} else {
  let host = "";
  let dbName = "";
  try { const u = new URL(url); host = u.hostname; dbName = u.pathname.slice(1); } catch { /* url invalida */ }
  if ((host !== "localhost" && host !== "127.0.0.1") || dbName !== "harmonize") {
    skipReason = "DATABASE_URL nao aponta para o banco local de dev (localhost/127.0.0.1, banco harmonize): teste de banco ignorado";
  } else {
    prisma = new PrismaClient({ datasourceUrl: url });
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.stockMovement.count();
    } catch {
      skipReason = "banco local nao respondeu: teste de banco ignorado";
      await prisma.$disconnect().catch(() => {});
      prisma = null;
    }
  }
}
const opts = { skip: skipReason ?? false };

// O servidor de relatórios usa o prisma global: aponta para o cliente local já validado.
let server = null;
let access = null;
let permissions = null;
let rules = null;
let appointmentInstant = null;
if (prisma) {
  globalThis.prisma = prisma;
  server = await import("../src/lib/reports-server.ts");
  access = await import("../src/lib/reports-access.ts");
  permissions = await import("../src/lib/permissions.ts");
  rules = await import("../src/lib/reports-rules.ts");
  ({ appointmentInstant } = await import("../src/lib/clinic-time.ts"));
}

const tag = `zz-e2e-reports-${Date.now()}`;
const clinicIds = [];

after(async () => {
  if (!prisma) return;
  try {
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
  } finally {
    await prisma.$disconnect();
  }
});

const range = { period: "custom", start: "2026-11-01", end: "2026-11-30", days: 30 };
const at = (day) => new Date(`${day}T12:00:00-03:00`);
const adminUser = { role: "ADMIN", name: "Admin" };
const ctxFor = (clinicId, over = {}) => ({
  clinicId, access: access.resolveReportAccess(adminUser), range, previous: null, professional: null, requestedProfessional: null, granularity: "day", today: "2026-11-30", ...over,
});

async function seed(label, { extraScale = 1, botoxPrice = 1000, productCost = 1_000 } = {}) {
  const clinic = await prisma.clinic.create({ data: { name: `${tag} ${label}`, slug: `${tag}-${label}`.toLowerCase() } });
  clinicIds.push(clinic.id);
  const clinicId = clinic.id;
  const patient = (name, createdDay) => prisma.patient.create({ data: { clinicId, name: `${name} ${label}`, phone: "11999999999", age: 30, createdAt: at(createdDay) } });
  const [p1, p2, p3, p4] = await Promise.all([patient("P1", "2026-11-03"), patient("P2", "2026-01-10"), patient("P3", "2026-01-11"), patient("P4", "2026-01-12")]);
  const botox = await prisma.procedure.create({ data: { clinicId, name: "Botox", price: botoxPrice, durationMinutes: 30, materials: "" } });
  const appt = (patientId, day, procedure, professional, status) => prisma.appointment.create({ data: { clinicId, patientId, date: appointmentInstant(day), time: "10:00", procedure, professional, status } });
  // Dentro do período: 2 realizados (Ana/Botox e Bia/Peeling), e um de cada status que NÃO conta.
  const botoxDone = await appt(p1.id, "2026-11-04", "Botox", "Dra. Ana", "Atendido");
  await appt(p2.id, "2026-11-05", "Peeling", "Dra. Bia", "Finalizado");
  const running = await appt(p3.id, "2026-11-06", "Botox", "Dra. Ana", "Em atendimento");
  await appt(p3.id, "2026-11-07", "Botox", "Dra. Ana", "Agendado");
  await appt(p3.id, "2026-11-08", "Botox", "Dra. Ana", "Cancelado");
  await appt(p4.id, "2026-11-09", "Botox", "Dra. Ana", "Faltou");
  // Fora do período (e antes): p2 já tinha realizado antes -> retorno.
  await appt(p2.id, "2026-09-01", "Peeling", "Dra. Bia", "Atendido");
  await appt(p1.id, "2026-12-05", "Botox", "Dra. Ana", "Atendido");

  const pay = (valueCents, status, day) => prisma.payment.create({ data: { clinicId, patientId: p1.id, valueCents: valueCents * extraScale, method: "Pix", installments: "1x", status, date: at(day) } });
  await pay(10_000, "Pago", "2026-11-10");
  await pay(5_000, "Pendente", "2026-11-11");
  await pay(7_000, "Pago", "2026-10-31");
  const expense = (amountCents, status, paidOn) => prisma.expense.create({ data: { clinicId, description: "Conta", category: "Aluguel", amountCents, dueOn: new Date(`${paidOn ?? "2026-11-15"}T00:00:00Z`), paymentMethod: "Pix", status, paidOn: paidOn ? new Date(`${paidOn}T00:00:00Z`) : null } });
  await expense(3_000, "paid", "2026-11-12");
  await expense(9_000, "open", null);
  await expense(8_000, "cancelled", "2026-11-13");

  const quote = (data) => prisma.quote.create({ data: { clinicId, patientId: p1.id, items: "[]", totalCents: 5_000, createdBy: "Dra. Ana", createdAt: at("2026-11-02"), ...data } });
  await quote({ status: "Aprovado", approvedAt: at("2026-11-04") });
  await quote({ status: "Pendente" });
  await quote({ status: "Recusado", refusedAt: at("2026-11-06") });

  const product = await prisma.product.create({ data: { clinicId, name: "Ácido", unit: "ml", costCents: productCost, supplier: "x" } });
  await prisma.procedureMaterial.create({ data: { procedureId: botox.id, productId: product.id, quantity: 2 } });
  const lot = await prisma.stockLot.create({ data: { clinicId, productId: product.id, code: "L1", expiresOn: new Date("2027-12-31T00:00:00Z") } });
  const move = (data) => prisma.stockMovement.create({ data: { clinicId, productId: product.id, lotId: lot.id, ...data } });
  await move({ type: "purchase", quantity: 50 });
  await move({ type: "attendance", quantity: -2, appointmentId: botoxDone.id, attendanceDate: at("2026-11-04") });
  await move({ type: "attendance", quantity: -1, appointmentId: running.id, attendanceDate: at("2026-11-06") });
  const reversed = await move({ type: "attendance", quantity: -3, appointmentId: botoxDone.id, attendanceDate: at("2026-11-04") });
  await move({ type: "reversal", quantity: 3, reversesId: reversed.id });
  await move({ type: "count_adjustment", quantity: -5 });
  await move({ type: "manual_out", quantity: -4 });
  return { clinicId, productId: product.id, botoxId: botox.id };
}

test("overview counts only Atendido/Finalizado and paid payments, scoped to the clinic", opts, async () => {
  const a = await seed("a");
  const b = await seed("b", { extraScale: 10 });
  const overview = await server.overviewReport(ctxFor(a.clinicId));
  assert.equal(overview.cards.appointments.value, 2);
  assert.equal(overview.cards.revenue.value, 10_000);
  assert.equal(overview.cards.avgTicket.value, 5_000);
  assert.equal(overview.cards.newPatients.value, 1);
  assert.equal(overview.cards.returnRate.value, 50); // p1 novo, p2 já atendido em setembro
  assert.deepEqual(overview.professionals, ["Dra. Ana", "Dra. Bia"]);
  assert.equal(overview.series.appointments.reduce((s, p) => s + p.current, 0), 2);
  assert.equal(overview.series.revenue.reduce((s, p) => s + p.current, 0), 10_000);
  const other = await server.overviewReport(ctxFor(b.clinicId));
  assert.equal(other.cards.revenue.value, 100_000); // só a clínica B (valor x10), sem somar A
  assert.equal(other.cards.appointments.value, 2);
});

test("professional filter limits appointments and nulls the revenue with a limitation", opts, async () => {
  const a = await seed("c");
  const overview = await server.overviewReport(ctxFor(a.clinicId, { professional: "Dra. Bia", requestedProfessional: "Dra. Bia" }));
  assert.equal(overview.cards.appointments.value, 1);
  assert.equal(overview.cards.revenue, null);
  assert.equal(overview.cards.revenueLimitation, "payment_without_professional");
  assert.equal(overview.cards.avgTicket, null);
  assert.equal(overview.cards.newPatients.value, 0);
  const forced = access.resolveReportAccess({ role: "PROFESSIONAL", name: "Dra. Ana", rolePermissions: undefined });
  assert.equal(forced.allowed, false);
});

test("compare returns the previous period and a null change when it is zero", opts, async () => {
  const a = await seed("d");
  const overview = await server.overviewReport(ctxFor(a.clinicId, { previous: { start: "2026-10-02", end: "2026-10-31" } }));
  assert.equal(overview.cards.revenue.previous, 7_000);
  assert.equal(overview.cards.appointments.previous, 0); // setembro fica fora do período anterior (02-31/out)
  assert.equal(overview.cards.appointments.changePct, null);
  assert.ok(overview.series.appointments.every((point) => point.previous !== undefined));
});

test("procedures and professionals reports ignore non-completed appointments", opts, async () => {
  const a = await seed("e");
  const procedures = await server.proceduresReport(ctxFor(a.clinicId));
  assert.equal(procedures.totalExecutions, 2);
  assert.deepEqual(procedures.rows.map((r) => [r.name, r.executions]).sort(), [["Botox", 1], ["Peeling", 1]]);
  assert.equal(procedures.tableTotalCents, 100_000);
  assert.equal(procedures.categories, null);
  assert.equal(procedures.limitation, "category_not_registered");
  assert.equal(procedures.totalCents, 100_000);
  const professionals = await server.professionalsReport(ctxFor(a.clinicId));
  const ana = professionals.rows.find((r) => r.name === "Dra. Ana");
  assert.deepEqual([ana.done, ana.cancelled, ana.missed], [1, 1, 1]);
  assert.ok(Math.abs(ana.cancellationRatePct - 100 / 3) < 1e-9);
});

test("clients, quotes, finance and stock reports respect status rules and clinic scope", opts, async () => {
  const a = await seed("f");
  await seed("g", { extraScale: 10 });
  const clients = await server.clientsReport(ctxFor(a.clinicId));
  assert.equal(clients.stats.attendedPatients, 2);
  assert.equal(clients.stats.newPatients, 1);
  assert.equal(clients.baseSeries.points.at(-1).totalPatients, 4);

  const quotes = await server.quotesReport(ctxFor(a.clinicId));
  assert.deepEqual([quotes.stats.created, quotes.stats.approved, quotes.stats.refused], [3, 1, 1]);
  assert.equal(quotes.stats.approvedValueCents, 5_000);
  assert.equal(Math.round(quotes.stats.conversionPct), 33);

  const finance = await server.financeReport(ctxFor(a.clinicId));
  assert.equal(finance.summary.revenueCents, 10_000); // pendente e fora do período não contam
  assert.equal(finance.summary.expensesCents, 3_000); // aberta e cancelada não contam
  assert.equal(finance.summary.resultCents, 7_000);
  assert.equal(finance.summary.marginPct, 70);

  const stock = await server.stockReport(ctxFor(a.clinicId));
  assert.equal(stock.totalEstimatedCostCents, 3_000); // 2 + 1 un.; estornada, ajuste de contagem e saída manual ficam de fora
  assert.deepEqual(stock.byProduct.map((p) => [p.name, p.quantity]), [["Ácido", 3]]);
  assert.deepEqual(stock.byProcedure, [{ name: "Botox", movements: 1, missingCostMovements: 0, costKnown: true, estimatedCostCents: 2_000 }]); // a do "Em atendimento" não entra por procedimento
});

test("forced PROFESSIONAL (real user and permission matrix) sees only own data and never finance", opts, async () => {
  const a = await seed("h");
  const matrix = permissions.createDefaultRolePermissionMatrix();
  for (const key of ["reports:access", "finance:access", "stock:access"]) matrix.PROFESSIONAL[key] = true;
  await prisma.clinic.update({ where: { id: a.clinicId }, data: { rolePermissions: matrix } });
  const create = async (label, name) => {
    const user = await prisma.user.create({ data: { name, email: `${tag}-h-${label}@example.invalid`, passwordHash: "x" } });
    await prisma.clinicMembership.create({ data: { userId: user.id, clinicId: a.clinicId, role: "PROFESSIONAL" } });
    return user;
  };
  const clinic = await prisma.clinic.findUnique({ where: { id: a.clinicId }, select: { rolePermissions: true } });
  const principal = (user) => ({ role: "PROFESSIONAL", name: user.name, rolePermissions: permissions.normalizeRolePermissionMatrix(clinic.rolePermissions) });
  const bia = await create("bia", "Dra.  Bia ");
  const ana = await create("ana", "Dra. Ana");

  const biaAccess = access.resolveReportAccess(principal(bia));
  assert.equal(biaAccess.capabilities.finance, false);
  assert.equal(biaAccess.capabilities.stock, true);
  const biaProfessional = access.appliedProfessional(biaAccess, "Dra. Ana"); // query ignorada
  assert.equal(biaProfessional, "Dra. Bia");
  const biaCtx = ctxFor(a.clinicId, { access: biaAccess, professional: biaProfessional });
  const overview = await server.overviewReport(biaCtx);
  assert.equal(overview.cards.appointments.value, 1);
  assert.equal(overview.cards.revenue, null);
  assert.equal(overview.cards.revenueLimitation, "forbidden");
  assert.equal(overview.capabilities.finance, false);
  assert.deepEqual(overview.professionals, []);
  assert.equal((await server.clientsReport(biaCtx)).stats.attendedPatients, 1);
  assert.equal((await server.quotesReport(biaCtx)).stats.created, 0); // orçamentos criados pela Dra. Ana
  assert.equal((await server.stockReport(biaCtx)).totalEstimatedCostCents, 0); // consumo foi em atendimentos da Dra. Ana
  assert.deepEqual((await server.professionalsReport(biaCtx)).rows.map((r) => r.name), ["Dra. Bia"]);

  const anaAccess = access.resolveReportAccess(principal(ana));
  const anaCtx = ctxFor(a.clinicId, { access: anaAccess, professional: access.appliedProfessional(anaAccess, null) });
  assert.equal((await server.overviewReport(anaCtx)).cards.appointments.value, 1);
  assert.equal((await server.quotesReport(anaCtx)).stats.created, 3);
  const anaStock = await server.stockReport(anaCtx);
  assert.equal(anaStock.totalEstimatedCostCents, null); // PROFESSIONAL nunca recebe custo derivado (custo desconhecido por restrição)
  assert.ok(anaStock.byProduct.every((item) => item.estimatedCostCents === null));
  assert.deepEqual(anaStock.byProduct.map((item) => item.quantity), [3]); // a quantidade segue visível
  assert.equal(anaAccess.capabilities.finance, false);
});

test("catalog prices, technical sheet and costs are isolated between clinics", opts, async () => {
  const a = await seed("i");
  const b = await seed("j", { botoxPrice: 5000, productCost: 7_000 });
  const botox = async (clinicId) => (await server.proceduresReport(ctxFor(clinicId))).rows.find((r) => r.name === "Botox");
  const rowA = await botox(a.clinicId);
  assert.deepEqual([rowA.unitPriceCents, rowA.materialCostCents, rowA.tableValueCents], [100_000, 2_000, 100_000]);
  const rowB = await botox(b.clinicId);
  assert.deepEqual([rowB.unitPriceCents, rowB.materialCostCents, rowB.tableValueCents], [500_000, 14_000, 500_000]);
  // Dado inconsistente: ficha técnica da clínica A apontando para produto da clínica B não deve entrar no custo.
  await prisma.procedureMaterial.create({ data: { procedureId: a.botoxId, productId: b.productId, quantity: 1 } });
  assert.equal((await botox(a.clinicId)).materialCostCents, 2_000);
  assert.equal((await server.stockReport(ctxFor(b.clinicId))).totalEstimatedCostCents, 21_000);
});

test("quote expiring today is not expired and yesterday is (calendar date at 00:00Z)", opts, async () => {
  const a = await seed("k");
  const quote = (status, expires) => prisma.quote.create({ data: { clinicId: a.clinicId, items: "[]", totalCents: 100, status, createdBy: "x", createdAt: at("2026-11-02"), expires: new Date(expires) } });
  await quote("Pendente", "2026-11-30T00:00:00Z"); // hoje (ctx.today = 30/11): ainda vale
  await quote("Enviado", "2026-11-29T00:00:00Z"); // ontem: expirado
  await quote("Aprovado", "2026-11-28T00:00:00Z"); // fechado não expira
  const stats = (await server.quotesReport(ctxFor(a.clinicId))).stats;
  assert.equal(stats.expired, 1);
  assert.equal(stats.created, 6);
});

test("overview works at the 2000 boundary: comparison outside the accepted years is dropped", opts, async () => {
  const a = await seed("l");
  const early = { period: "custom", start: "2000-01-01", end: "2000-01-10", days: 10 };
  assert.equal(rules.resolveReportRange({ from: "1999-12-31", to: "2000-01-10" }, "2026-11-30").ok, false);
  const previous = rules.comparisonRange(early);
  assert.equal(previous, null);
  const overview = await server.overviewReport(ctxFor(a.clinicId, { range: early, previous }));
  assert.equal(overview.previousRange, null);
  assert.equal(overview.cards.appointments.value, 0);
  assert.equal(overview.cards.appointments.previous, null);
});

test("legacy stock and procedures reports: item without registered cost is unknown (null), never R$ 0,00", opts, async () => {
  const a = await seed("m", { productCost: 0 });
  const stock = await server.stockReport(ctxFor(a.clinicId));
  assert.equal(stock.totalEstimatedCostCents, null);
  assert.deepEqual(stock.byProduct.map((p) => [p.name, p.quantity, p.costKnown, p.estimatedCostCents]), [["Ácido", 3, false, null]]);
  assert.deepEqual(stock.byProcedure, [{ name: "Botox", movements: 1, missingCostMovements: 1, costKnown: false, estimatedCostCents: null }]);
  assert.equal(stock.movementsWithoutCost, 2);
  assert.match(stock.costNote, /sem custo cadastrado/);
  const botox = (await server.proceduresReport(ctxFor(a.clinicId))).rows.find((r) => r.name === "Botox");
  assert.deepEqual([botox.materialCostCents, botox.marginCents, botox.costKnown, botox.materialCostReason], [null, null, false, "item_without_cost"]);
  assert.ok(botox.tableValueCents > 0); // o valor de tabela segue conhecido
});

test("procedures report: no priced execution gives an unknown table total (null), never R$ 0,00", opts, async () => {
  const a = await seed("n");
  await prisma.procedure.deleteMany({ where: { clinicId: a.clinicId } }); // nenhum procedimento cadastrado: execuções sem preço
  const report = await server.proceduresReport(ctxFor(a.clinicId));
  assert.ok(report.totalExecutions > 0);
  assert.equal(report.tableTotalCents, null);
  assert.equal(report.pricedExecutions, 0);
  assert.ok(report.rows.every((r) => r.tableValueCents === null));
});
