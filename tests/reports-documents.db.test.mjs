import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { PrismaClient } from "@prisma/client";

// Datasets e documentos dos Relatórios contra o Postgres LOCAL (estoque com todos os tipos de movimento, agendamentos, financeiro
// previsto x recebido, clientes, isolamento entre clínicas, PROFESSIONAL). Ignora se DATABASE_URL não for localhost/127.0.0.1, banco harmonize.
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

let datasets = null;
let documentServer = null;
let legacy = null;
let access = null;
let permissions = null;
let appointmentInstant = null;
if (prisma) {
  globalThis.prisma = prisma;
  legacy = await import("../src/lib/reports-server.ts");
  datasets = await import("../src/lib/reports-datasets.ts");
  documentServer = await import("../src/lib/reports-document-server.ts");
  access = await import("../src/lib/reports-access.ts");
  permissions = await import("../src/lib/permissions.ts");
  ({ appointmentInstant } = await import("../src/lib/clinic-time.ts"));
}

const tag = `zz-e2e-repdocs-${Date.now()}`;
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
const newClinic = async (label) => {
  const clinic = await prisma.clinic.create({ data: { name: `${tag} ${label}`, slug: `${tag}-${label}`.toLowerCase() } });
  clinicIds.push(clinic.id);
  return clinic.id;
};
const newPatient = (clinicId, name, createdDay = "2026-01-10") => prisma.patient.create({ data: { clinicId, name: `${name} SEGREDO`, phone: "11999999999", age: 30, createdAt: at(createdDay) } });
const newAppointment = (clinicId, patientId, day, procedure, professional, status) => prisma.appointment.create({ data: { clinicId, patientId, date: appointmentInstant(day), time: "10:00", procedure, professional, status } });
const bundleFor = (kind, ctx) => documentServer.loadReportBundle(kind, ctx, "Clínica Teste", "2026-11-30T15:00:00.000Z");
const documentFor = (kind, ctx) => documentServer.loadReportDocument(kind, ctx, "Clínica Teste", "2026-11-30T15:00:00.000Z");
const section = (doc, id) => doc.sections.find((item) => item.id === id);
const display = async (cell) => (await import("../src/lib/reports-document.ts")).cellDisplay(cell);

// ---------- Estoque ----------

async function seedStock(label) {
  const clinicId = await newClinic(label);
  const patient = await newPatient(clinicId, "P1");
  const botox = await newAppointment(clinicId, patient.id, "2026-11-04", "Botox", "Dra. Ana", "Atendido");
  const running = await newAppointment(clinicId, patient.id, "2026-11-06", "Botox", "Dra. Ana", "Em atendimento");
  const biaDone = await newAppointment(clinicId, patient.id, "2026-11-05", "Botox", "Dra. Bia", "Finalizado");
  const product = (name, data) => prisma.product.create({ data: { clinicId, name, kind: "material", supplier: "x", ...data } });
  const acid = await product("Ácido", { unit: "ml", costCents: 1000, minStock: 10, kind: "produto" });
  const needle = await product("Agulha", { unit: "unidade", costCents: 0, minStock: 5 });
  await product("Gaze", { unit: "unidade", costCents: 50, minStock: 0 });
  const archived = await product("Antigo", { unit: "unidade", costCents: 10, archivedAt: new Date() });
  const lot = (productId, code, expiresOn) => prisma.stockLot.create({ data: { clinicId, productId, code, expiresOn: new Date(`${expiresOn}T00:00:00Z`) } });
  const l1 = await lot(acid.id, "L1", "2026-11-15"); // vencido em 30/11
  const l2 = await lot(acid.id, "L2", "2027-12-31");
  const l3 = await lot(needle.id, "L3", "2027-12-31");
  const l4 = await lot(archived.id, "L4", "2027-12-31");
  const move = (productId, lotId, data) => prisma.stockMovement.create({ data: { clinicId, productId, lotId, createdAt: at("2026-11-10"), userName: "Admin", ...data } });
  await move(acid.id, l1.id, { type: "initial", quantity: 20, createdAt: at("2026-11-02") });
  await move(acid.id, l2.id, { type: "purchase", quantity: 30, createdAt: at("2026-11-03"), notes: "NF do fornecedor SEGREDO-NOTA" });
  await move(needle.id, l3.id, { type: "purchase", quantity: 100, createdAt: at("2026-11-03") });
  await move(needle.id, l3.id, { type: "purchase", quantity: 5, createdAt: at("2026-10-01") }); // fora do período
  await move(acid.id, l1.id, { type: "attendance", quantity: -2, appointmentId: botox.id, attendanceDate: at("2026-11-04"), attendanceName: "Procedimento - Botox", notes: "Maria SEGREDO" });
  const reversed = await move(acid.id, l1.id, { type: "attendance", quantity: -3, appointmentId: botox.id, attendanceDate: at("2026-11-04"), attendanceName: "Procedimento - Botox" });
  await move(acid.id, l1.id, { type: "reversal", quantity: 3, reversesId: reversed.id, appointmentId: botox.id, attendanceDate: at("2026-11-04"), notes: "Lançado por engano SEGREDO-NOTA" });
  await move(needle.id, l3.id, { type: "attendance", quantity: -4, appointmentId: biaDone.id, attendanceDate: at("2026-11-05"), attendanceName: "Procedimento - Botox" });
  await move(acid.id, l1.id, { type: "attendance", quantity: -1, appointmentId: running.id, attendanceDate: at("2026-11-06"), attendanceName: "Procedimento - Botox" });
  await move(acid.id, l1.id, { type: "manual_out", quantity: -4, reason: "loss", notes: "Frasco caiu SEGREDO-NOTA" });
  await move(acid.id, l1.id, { type: "count_adjustment", quantity: -5, reason: "SEGREDO-NOTA motivo livre", notes: "Contagem" });
  await move(acid.id, l1.id, { type: "count_adjustment", quantity: 2, reason: "count", notes: "Contagem" });
  await move(needle.id, l3.id, { type: "purchase_cancel", quantity: -10, notes: "Cancelamento da compra" });
  await move(needle.id, l3.id, { type: "reversal", quantity: 10, notes: "Desfazer cancelamento da compra" });
  await move(archived.id, l4.id, { type: "purchase", quantity: 3, createdAt: at("2026-10-02") });
  return { clinicId, acid, needle };
}

test("AUDIT: the legacy stock report ignores everything but attendance (clinic with no consumption shows zero)", opts, async () => {
  const clinicId = await newClinic("audit");
  const product = await prisma.product.create({ data: { clinicId, name: "Ácido", unit: "ml", costCents: 1000, supplier: "x" } });
  const lot = await prisma.stockLot.create({ data: { clinicId, productId: product.id, code: "L1", expiresOn: new Date("2027-12-31T00:00:00Z") } });
  const move = (data) => prisma.stockMovement.create({ data: { clinicId, productId: product.id, lotId: lot.id, createdAt: at("2026-11-10"), ...data } });
  await move({ type: "initial", quantity: 40 });
  await move({ type: "purchase", quantity: 10 });
  await move({ type: "manual_out", quantity: -4, reason: "loss", notes: "x" });
  await move({ type: "count_adjustment", quantity: -2, reason: "count", notes: "x" });

  const old = await legacy.stockReport(ctxFor(clinicId));
  assert.equal(old.totalEstimatedCostCents, 0);
  assert.deepEqual(old.byProduct, []);
  assert.deepEqual(old.byProcedure, []);
  assert.equal(old.series.reduce((sum, point) => sum + point.estimatedCostCents, 0), 0);

  const fresh = await datasets.stockDataset(ctxFor(clinicId));
  assert.equal(fresh.position.items[0].balance, 44); // 40 + 10 − 4 − 2
  assert.equal(fresh.position.summary.totalValueCents, 44_000);
  assert.equal(fresh.movements.totalMovements, 4);
  assert.deepEqual(fresh.movements.summary.types.map((entry) => entry.label), ["Entrada inicial", "Compra", "Ajuste de contagem (−)", "Saída manual"]);
  assert.equal(fresh.movements.summary.totals.entryMovements, 2);
  assert.equal(fresh.movements.summary.totals.exitMovements, 2);
  assert.deepEqual(fresh.movements.consumption.byProduct, []); // sem atendimento: sem consumo, mas a posição e as movimentações aparecem
});

test("stock dataset: position, all movement types, reversal pairs, unknown cost and consumption", opts, async () => {
  const { clinicId } = await seedStock("s1");
  // Movimento da clínica A apontando para produto de OUTRA clínica: nunca entra.
  const otherClinic = await newClinic("s1-other");
  const foreign = await prisma.product.create({ data: { clinicId: otherClinic, name: "Alheio", unit: "ml", costCents: 99, supplier: "x" } });
  const foreignLot = await prisma.stockLot.create({ data: { clinicId: otherClinic, productId: foreign.id, code: "F1", expiresOn: new Date("2027-12-31T00:00:00Z") } });
  await prisma.stockMovement.create({ data: { clinicId, productId: foreign.id, lotId: foreignLot.id, type: "purchase", quantity: 999, createdAt: at("2026-11-10") } });

  const data = await datasets.stockDataset(ctxFor(clinicId));
  const { position, movements } = data;
  const byName = Object.fromEntries(position.items.map((item) => [item.name, item]));
  assert.deepEqual(Object.keys(byName).sort((a, b) => a.localeCompare(b, "pt-BR")), ["Ácido", "Agulha", "Gaze"]); // arquivado e produto alheio fora
  assert.equal(byName["Ácido"].balance, 40); // L1 10 + L2 30
  assert.equal(byName["Ácido"].situation, "ok");
  assert.equal(byName["Ácido"].valueCents, 40_000);
  assert.equal(byName["Ácido"].expiredLots, 1);
  assert.equal(byName["Ácido"].nextExpiry, "2026-11-15");
  assert.equal(byName["Agulha"].balance, 101);
  assert.equal(byName["Agulha"].unitCostCents, null);
  assert.equal(byName["Agulha"].valueCents, null);
  assert.equal(byName["Gaze"].situation, "out_of_stock");
  assert.equal(byName["Gaze"].valueCents, 0);
  assert.equal(position.archivedWithBalance, 1);
  assert.deepEqual(
    [position.summary.items, position.summary.belowMinimum, position.summary.outOfStock, position.summary.expiredLots, position.summary.expiringLots, position.summary.totalValueCents, position.summary.itemsWithoutCost],
    [3, 0, 1, 1, 0, 40_000, 1],
  );

  assert.equal(movements.totalMovements, 13);
  assert.equal(movements.reversalPairs, 1);
  const totals = movements.summary.totals;
  assert.deepEqual([totals.entryMovements, totals.exitMovements], [5, 6]); // o par estornado (−3/+3) fica fora
  assert.equal(totals.entryCostCents, 52_000);
  assert.equal(totals.exitCostCents, 12_000);
  assert.equal(totals.movementsWithoutCost, 4);
  const types = Object.fromEntries(movements.summary.types.map((entry) => [entry.label, entry]));
  assert.equal(types["Consumo em atendimento"].movements, 3);
  assert.equal(types["Cancelamento de compra"].costCents, null); // item sem custo: desconhecido
  assert.equal(types["Cancelamento de compra desfeito"].movements, 1);
  const acidItem = movements.summary.items.find((item) => item.name === "Ácido");
  assert.deepEqual([acidItem.inQuantity, acidItem.outQuantity], [52, 12]);

  assert.deepEqual(movements.consumption.byProduct.map((item) => [item.name, item.quantity, item.estimatedCostCents]), [["Ácido", 3, 3_000], ["Agulha", 4, null]]);
  assert.deepEqual(movements.consumption.byProcedure, [{ name: "Botox", movements: 2, estimatedCostCents: 2_000, missingCostMovements: 1 }]); // o "Em atendimento" não entra

  assert.equal(movements.history.length, 13);
  const reversedRow = movements.history.find((item) => item.reversed);
  assert.equal(reversedRow.quantity, -3);
  const attendanceRow = movements.history.find((item) => item.type === "attendance" && item.quantity === -2);
  assert.equal(attendanceRow.note, "Procedimento - Botox"); // texto livre do atendimento não vaza
  assert.ok(movements.history.some((item) => item.type === "manual_out" && item.note === "Perda/quebra")); // rótulo padronizado, nunca o texto livre
  assert.ok(movements.history.filter((item) => item.type === "reversal" && item.reversesId).every((item) => item.note === "Estorno"));
  assert.ok(movements.history.filter((item) => item.type === "purchase").every((item) => item.note === ""));
  assert.ok(!JSON.stringify(data).includes("SEGREDO"));

  const doc = await documentFor("stock", ctxFor(clinicId));
  assert.equal(doc.hasData, true);
  assert.equal(section(doc, "movements-history").rows.length, 13);
  assert.ok(!JSON.stringify(doc).includes("SEGREDO"));
});

test("stock dataset: another clinic never leaks into position or movements", opts, async () => {
  const a = await seedStock("s2a");
  const b = await seedStock("s2b");
  const [da, db] = [await datasets.stockDataset(ctxFor(a.clinicId)), await datasets.stockDataset(ctxFor(b.clinicId))];
  assert.equal(da.position.items.length, 3);
  assert.equal(da.movements.totalMovements, 13);
  assert.equal(db.movements.totalMovements, 13);
  assert.equal(da.position.summary.totalValueCents, 40_000);
  const empty = await newClinic("s2c");
  const none = await datasets.stockDataset(ctxFor(empty));
  assert.equal(none.position.items.length, 0);
  assert.equal(none.movements.totalMovements, 0);
  assert.equal((await documentFor("stock", ctxFor(empty))).hasData, false);
});

test("stock dataset: professional filter keeps only that professional's consumption", opts, async () => {
  const { clinicId } = await seedStock("s3");
  const ana = await datasets.stockMovementsDataset(ctxFor(clinicId, { professional: "Dra. Ana", requestedProfessional: "Dra. Ana" }));
  assert.equal(ana.professionalScoped, true);
  assert.equal(ana.totalMovements, 3); // só atendimentos dela (os estornos e demais tipos ficam de fora)
  assert.deepEqual(ana.summary.types.map((entry) => entry.label), ["Consumo em atendimento"]);
  assert.deepEqual(ana.consumption.byProduct.map((item) => [item.name, item.quantity]), [["Ácido", 3]]);
  const bia = await datasets.stockMovementsDataset(ctxFor(clinicId, { professional: "Dra. Bia", requestedProfessional: "Dra. Bia" }));
  assert.deepEqual(bia.consumption.byProduct.map((item) => [item.name, item.quantity]), [["Agulha", 4]]);
});

// ---------- Agendamentos ----------

test("appointments report: every status, rates, professional filter and clinic isolation", opts, async () => {
  const clinicId = await newClinic("ap1");
  const other = await newClinic("ap2");
  const patient = await newPatient(clinicId, "P1");
  const otherPatient = await newPatient(other, "P2");
  const make = (day, professional, status) => newAppointment(clinicId, patient.id, day, "Botox", professional, status);
  await make("2026-11-02", "Dra. Ana", "Atendido");
  await make("2026-11-03", "Dra. Ana", "Atendido");
  await make("2026-11-04", "Dra. Bia", "Finalizado");
  await make("2026-11-05", "Dra. Ana", "Faltou");
  await make("2026-11-06", "Dra. Bia", "Cancelado");
  await make("2026-11-20", "Dra. Ana", "Agendado"); // data passada em relação a "hoje" (30/11): pendente atrasado
  await make("2026-11-29", "Dra. Bia", "Em atendimento");
  await make("2026-12-05", "Dra. Ana", "Agendado"); // fora do período
  for (let index = 0; index < 5; index += 1) await newAppointment(other, otherPatient.id, "2026-11-10", "Botox", "Dra. Ana", "Atendido");

  const report = await datasets.appointmentsReport(ctxFor(clinicId));
  const t = report.totals;
  assert.deepEqual([t.total, t.done, t.cancelled, t.missed, t.scheduled, t.inProgress, t.pending, t.overdueOpen], [7, 3, 1, 1, 1, 1, 2, 1]);
  assert.equal(t.attendanceRatePct, 75); // 3 ÷ (3 + 1 falta); cancelamento fora
  assert.ok(Math.abs(t.cancellationRatePct - 100 / 7) < 1e-9);
  assert.equal(report.byProfessional.find((item) => item.name === "Dra. Ana").total, 4);
  assert.equal(report.byWeekday.reduce((sum, day) => sum + day.total, 0), 7);
  assert.equal(report.seriesTotal.reduce((sum, point) => sum + point.current, 0), 7);

  const ana = await datasets.appointmentsReport(ctxFor(clinicId, { professional: "Dra. Ana", requestedProfessional: "Dra. Ana" }));
  assert.equal(ana.totals.total, 4);
  assert.deepEqual(ana.byProfessional.map((item) => item.name), ["Dra. Ana"]);

  const compared = await datasets.appointmentsReport(ctxFor(clinicId, { previous: { start: "2026-10-02", end: "2026-10-31" } }));
  assert.equal(compared.previous.total, 0);
  const doc = await documentFor("appointments", ctxFor(clinicId));
  assert.equal(doc.hasData, true);
  assert.ok(!JSON.stringify(doc).includes("SEGREDO"));
});

// ---------- Financeiro ----------

test("finance extras: received x receivable x payable, by method, detail without patient, clinic isolation", opts, async () => {
  const clinicId = await newClinic("fn1");
  const other = await newClinic("fn2");
  const patient = await newPatient(clinicId, "P1");
  const pay = (id, patientId, valueCents, method, status, day) => prisma.payment.create({ data: { clinicId: id, patientId, valueCents, method, installments: "1x", status, date: at(day) } });
  await pay(clinicId, patient.id, 10_000, "Pix", "Pago", "2026-11-10");
  await pay(clinicId, patient.id, 5_000, "Cartão", "Pago", "2026-11-12");
  await pay(clinicId, patient.id, 7_000, "Pix", "Pendente", "2026-11-20");
  await pay(clinicId, patient.id, 2_000, "Pix", "Parcial", "2026-11-25");
  await pay(clinicId, patient.id, 999, "Pix", "Pago", "2026-10-31"); // fora do período
  await pay(clinicId, null, 4_000, "Pix", "Pendente", "2026-10-15"); // período anterior; sem paciente
  const expense = (id, amountCents, status, dueOn, paidOn = null, category = "Aluguel") => prisma.expense.create({ data: { clinicId: id, description: "Conta", category, amountCents, dueOn: new Date(`${dueOn}T00:00:00Z`), paymentMethod: "Pix", status, paidOn: paidOn ? new Date(`${paidOn}T00:00:00Z`) : null } });
  await expense(clinicId, 3_000, "paid", "2026-11-10", "2026-11-12");
  await expense(clinicId, 9_000, "open", "2026-11-28", null, "Luz");
  await expense(clinicId, 1_000, "open", "2026-12-10", null, "Luz"); // vencimento fora
  await expense(clinicId, 8_000, "cancelled", "2026-11-13");
  await expense(clinicId, 1_500, "open", "2026-10-20");
  // Outra clínica com valores maiores: não pode somar.
  const otherPatient = await newPatient(other, "P2");
  await pay(other, otherPatient.id, 100_000, "Pix", "Pago", "2026-11-10");
  await pay(other, otherPatient.id, 70_000, "Boleto", "Pendente", "2026-11-11");
  await expense(other, 50_000, "open", "2026-11-11");

  const ctx = ctxFor(clinicId, { previous: { start: "2026-10-02", end: "2026-10-31" } });
  const extras = await datasets.financeExtras(ctx);
  assert.deepEqual(extras.receivedByMethod, [{ method: "Pix", count: 1, valueCents: 10_000 }, { method: "Cartão", count: 1, valueCents: 5_000 }]);
  assert.deepEqual([extras.receivable.cents, extras.receivable.count, extras.receivable.previousCents], [9_000, 2, 4_000]); // Pendente + Parcial
  assert.deepEqual([extras.payable.cents, extras.payable.count, extras.payable.previousCents], [9_000, 1, 1_500]);
  assert.deepEqual([extras.payments.paid.total, extras.payments.pending.total], [2, 2]); // pagos x pendentes/parciais, cada um com a sua contagem
  assert.deepEqual([extras.payments.paid.rows.length, extras.payments.pending.rows.length], [2, 2]);
  assert.ok(extras.payments.paid.rows.every((item) => item.status === "Pago") && extras.payments.pending.rows.every((item) => item.status !== "Pago"));
  assert.deepEqual(Object.keys(extras.payments.paid.rows[0]).sort(), ["date", "installments", "method", "status", "valueCents"]); // sem paciente
  assert.deepEqual([extras.expenses.paid.total, extras.expenses.open.total], [1, 1]); // paga em novembro + aberta com vencimento em novembro; cancelada e fora do período não
  assert.ok(!JSON.stringify(extras).includes("SEGREDO"));

  const noCompare = await datasets.financeExtras(ctxFor(clinicId));
  assert.equal(noCompare.receivable.previousCents, null);

  const doc = await documentFor("finance", ctx);
  const kpi = async (key) => display(section(doc, "summary").items.find((item) => item.key === key).value);
  assert.equal(await kpi("received"), "R$ 150,00");
  assert.equal(await kpi("expensesPaid"), "R$ 30,00");
  assert.equal(await kpi("receivable"), "R$ 90,00");
  assert.equal(await kpi("payable"), "R$ 90,00");
  assert.equal(section(doc, "payments-pending").rows.length, 2);
  assert.ok(!JSON.stringify(doc).includes("SEGREDO"));
});

// ---------- Clientes ----------

test("clients extras: total registered up to the end of the period and visit distribution without identifying anyone", opts, async () => {
  const clinicId = await newClinic("cl1");
  const other = await newClinic("cl2");
  const p1 = await newPatient(clinicId, "P1");
  const p2 = await newPatient(clinicId, "P2");
  const p3 = await newPatient(clinicId, "P3", "2026-11-10");
  await newPatient(clinicId, "P4");
  await newPatient(clinicId, "P5", "2026-12-05"); // cadastrado depois do fim do período
  await newPatient(other, "X");
  const done = (patient, day) => newAppointment(clinicId, patient.id, day, "Botox", "Dra. Ana", "Atendido");
  await done(p1, "2026-11-02");
  await done(p1, "2026-11-09");
  await done(p2, "2026-11-03");
  for (const day of ["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]) await done(p3, day);

  const extras = await datasets.clientsExtras(ctxFor(clinicId));
  assert.equal(extras.totalRegistered, 4);
  assert.deepEqual(extras.visits.groups.map((group) => [group.patients, group.appointments]), [[1, 1], [1, 2], [1, 4]]);
  assert.equal(extras.visits.totalPatients, 3);
  const withProfessional = await datasets.clientsExtras(ctxFor(clinicId, { professional: "Dra. Ana", requestedProfessional: "Dra. Ana" }));
  assert.equal(withProfessional.totalRegistered, 3); // só quem tem agendamento com ela
  const doc = await documentFor("clients", ctxFor(clinicId));
  assert.equal(section(doc, "summary").items.find((item) => item.key === "registered").value.value, 4);
  assert.ok(!JSON.stringify(doc).includes("SEGREDO"));
});

// ---------- Procedimentos, profissionais, orçamentos ----------

test("procedures/professionals/quotes extras and documents", opts, async () => {
  const clinicId = await newClinic("pr1");
  const patient = await newPatient(clinicId, "P1");
  await prisma.procedure.create({ data: { clinicId, name: "Botox", price: 1000, durationMinutes: 30, materials: "" } });
  await newAppointment(clinicId, patient.id, "2026-11-04", "Botox", "Dra. Ana", "Atendido");
  await newAppointment(clinicId, patient.id, "2026-11-05", "Botox", "Dra. Bia", "Finalizado");
  await newAppointment(clinicId, patient.id, "2026-11-06", "Peeling", "Dra. Ana", "Atendido");
  await newAppointment(clinicId, patient.id, "2026-11-07", "Peeling", "Dra. Ana", "Faltou");
  const quote = (data) => prisma.quote.create({ data: { clinicId, patientId: patient.id, items: "[]", totalCents: 5_000, createdBy: "Dra. Ana", createdAt: at("2026-11-02"), ...data } });
  await quote({ status: "Aprovado", sentAt: at("2026-11-03"), approvedAt: at("2026-11-04") });
  await quote({ status: "Pendente" });

  const procedures = await datasets.proceduresExtras(ctxFor(clinicId));
  assert.deepEqual(procedures.professionals.map((item) => [item.procedure, item.professional, item.executions]), [["Botox", "Dra. Ana", 1], ["Botox", "Dra. Bia", 1], ["Peeling", "Dra. Ana", 1]]);
  assert.equal(procedures.series.executions.reduce((sum, point) => sum + point.current, 0), 3);
  assert.equal(procedures.series.tableValueCents.reduce((sum, point) => sum + point.current, 0), 200_000); // Peeling sem cadastro = 0 no valor

  const procDoc = await documentFor("procedures", ctxFor(clinicId));
  const peeling = section(procDoc, "ranking").rows.find((item) => item.cells[0].value === "Peeling");
  assert.equal(peeling.cells[2].type, "unknown"); // sem cadastro: valor desconhecido, não 0
  assert.equal(peeling.cells[5].type, "unknown"); // sem ficha técnica

  const professionals = await datasets.professionalsExtras(ctxFor(clinicId));
  const ana = professionals.byProfessional.find((item) => item.name === "Dra. Ana");
  assert.equal(ana.distinctProcedures, 2); // Botox e Peeling realizados
  assert.ok(Math.abs(ana.attendanceRatePct - 200 / 3) < 1e-9); // 2 realizados ÷ (2 + 1 falta)
  const proDoc = await documentFor("professionals", ctxFor(clinicId));
  assert.equal(section(proDoc, "ranking").rows.length, 2);

  const quotes = await datasets.quotesExtras(ctxFor(clinicId));
  assert.deepEqual([quotes.funnel.created, quotes.funnel.sent, quotes.funnel.approved], [2, 1, 1]);
  assert.deepEqual(quotes.funnel.valueByStatus.map((item) => item.status), ["Pendente", "Aprovado"]);
  assert.equal((await documentFor("quotes", ctxFor(clinicId))).hasData, true);
});

// ---------- Vazio, consolidado, permissões ----------

test("empty clinic: every document builds without error and says there is no movement", opts, async () => {
  const clinicId = await newClinic("em1");
  for (const kind of ["finance", "procedures", "professionals", "appointments", "clients", "quotes", "stock", "overview"]) {
    const doc = await documentFor(kind, ctxFor(clinicId));
    assert.ok(doc, kind);
    assert.equal(doc.hasData, false, kind);
    assert.ok(doc.sections.every((item) => item.type === "note" || item.type === "kpis"), kind); // vazio traz só os KPIs (zerados) e a nota
    assert.equal(doc.clinicName, "Clínica Teste");
    assert.equal(doc.period.from, "2026-11-01");
  }
  const all = await documentFor("all", ctxFor(clinicId));
  assert.equal(all.hasData, false);
  assert.ok(all.sections.length >= 8);
});

test("permissions: forced PROFESSIONAL gets only own data and never finance; STAFF and unpermitted get nothing", opts, async () => {
  const { clinicId } = await seedStock("pm1");
  const patient = await newPatient(clinicId, "PX");
  await newAppointment(clinicId, patient.id, "2026-11-12", "Botox", "Dra. Bia", "Atendido");
  const matrix = permissions.createDefaultRolePermissionMatrix();
  for (const key of ["reports:access", "finance:access", "stock:access"]) matrix.PROFESSIONAL[key] = true;
  const principal = { role: "PROFESSIONAL", name: "Dra. Ana", rolePermissions: permissions.normalizeRolePermissionMatrix(matrix) };
  const anaAccess = access.resolveReportAccess(principal);
  assert.equal(anaAccess.capabilities.finance, false);
  assert.equal(anaAccess.capabilities.stock, true);
  const anaCtx = ctxFor(clinicId, { access: anaAccess, professional: access.appliedProfessional(anaAccess, "Dra. Bia") });
  assert.equal(anaCtx.professional, "Dra. Ana");

  assert.equal(documentServer.canBuildReport("finance", anaCtx), false);
  assert.equal(await documentFor("finance", anaCtx), null);
  assert.equal(anaAccess.capabilities.quotes, true); // orçamentos seguem quotes:access; só os criados por ela
  assert.equal((await documentFor("quotes", anaCtx)).hasData, false);

  const appointments = await documentFor("appointments", anaCtx);
  assert.equal(section(appointments, "by-professional").rows.length, 1);
  assert.equal(section(appointments, "by-professional").rows[0].cells[0].value, "Dra. Ana");
  const stockDoc = await documentFor("stock", anaCtx);
  assert.equal(stockDoc.filters[0].value, "Dra. Ana");
  assert.equal(section(stockDoc, "professional-scope").tone, "warning");
  assert.deepEqual(section(stockDoc, "movements-by-type").rows.map((item) => item.cells[0].value), ["Consumo em atendimento"]);

  const all = await documentFor("all", anaCtx);
  assert.ok(section(all, "stock-summary"));
  assert.equal(section(all, "finance-summary"), undefined);
  assert.equal(section(all, "finance-empty"), undefined);

  for (const role of ["STAFF", "PROFESSIONAL"]) {
    const denied = access.resolveReportAccess({ role, name: "Fulano", rolePermissions: undefined });
    assert.equal(denied.allowed, false, role);
    assert.deepEqual(denied.capabilities, { finance: false, quotes: false, stock: false });
  }
});

// ---------- Correções pós-revisão ----------

test("privacy: neither patient names nor free-text notes reach the JSON, XLSX (every cell), PDF text or CSV of any report", opts, async () => {
  const { readXlsx } = await import("./reports-xlsx-reader.mjs");
  const { renderReportFile } = await import("../src/lib/reports-export.ts");
  const { pdfPageTexts } = await import("./reports-fixtures.mjs");
  const { clinicId } = await seedStock("priv1"); // pacientes "... SEGREDO" e notas com SEGREDO-NOTA (reversal, manual_out, purchase, reason livre)
  const patient = await newPatient(clinicId, "SEGREDO-PACIENTE");
  await newAppointment(clinicId, patient.id, "2026-11-08", "Botox", "Dra. Ana", "Atendido");
  const kinds = ["finance", "procedures", "professionals", "appointments", "clients", "quotes", "stock", "overview", "all"];
  for (const kind of kinds) {
    const bundle = await bundleFor(kind, ctxFor(clinicId));
    assert.ok(bundle, kind);
    assert.ok(!/SEGREDO/.test(JSON.stringify(bundle.doc)), `JSON ${kind}`);
    if (kind !== "all") assert.ok(!/SEGREDO/.test(new TextDecoder().decode((await renderReportFile(bundle, "csv")).body)), `CSV ${kind}`);
    const xlsx = await readXlsx(Buffer.from((await renderReportFile(bundle, "xlsx")).body));
    const cells = xlsx.sheets.flatMap((sheet) => Object.values(sheet.cells).map((cell) => String(cell.value) + String(cell.formula ?? "")));
    assert.ok(!/SEGREDO/.test(cells.join("\n")), `XLSX ${kind}`);
    const pdf = (await pdfPageTexts((await renderReportFile(bundle, "pdf")).body)).join("\n");
    assert.ok(!/SEGREDO/.test(pdf), `PDF ${kind}`);
  }
  // O histórico existe e mostra só rótulos padronizados.
  const stock = await documentFor("stock", ctxFor(clinicId));
  const history = section(stock, "movements-history");
  assert.ok(history.rows.length > 0);
  assert.ok(history.rows.some((item) => item.cells[6].type === "text" && item.cells[6].value === "Perda/quebra"));
  assert.ok(history.rows.some((item) => item.cells[6].type === "text" && item.cells[6].value === "Estorno"));
});

test("stock history: a movement whose lot belongs to another clinic never enters totals or history", opts, async () => {
  const { clinicId, acid } = await seedStock("lot1");
  const otherClinic = await newClinic("lot1-other");
  const foreignProduct = await prisma.product.create({ data: { clinicId: otherClinic, name: "Alheio", unit: "ml", costCents: 99, supplier: "x" } });
  const foreignLot = await prisma.stockLot.create({ data: { clinicId: otherClinic, productId: foreignProduct.id, code: "ZZ9", expiresOn: new Date("2027-12-31T00:00:00Z") } });
  // Dado inconsistente: produto da clínica A com lote da clínica B.
  await prisma.stockMovement.create({ data: { clinicId, productId: acid.id, lotId: foreignLot.id, type: "purchase", quantity: 777, createdAt: at("2026-11-10") } });
  const data = await datasets.stockMovementsDataset(ctxFor(clinicId));
  assert.equal(data.totalMovements, 13);
  assert.ok(!data.history.some((item) => item.lotCode === "ZZ9" || item.quantity === 777));
  assert.equal(data.summary.items.find((item) => item.name === "Ácido").inQuantity, 52);
});

test("stock history: newest N by DISPLAYED date (attendanceDate ?? createdAt), consistent between dated and undated movements", opts, async () => {
  const { clinicId, acid } = await seedStock("ord1");
  const data = await datasets.stockMovementsDataset(ctxFor(clinicId));
  const times = data.history.map((item) => item.at);
  assert.deepEqual(times, [...times].sort().reverse());
  assert.equal(acid.id.length > 0, true);
});

test("stock position: forced PROFESSIONAL gets no unit cost or value; balance, minimum, situation and expiry stay", opts, async () => {
  const { clinicId } = await seedStock("pro1");
  const forced = { ...ctxFor(clinicId), access: { ...access.resolveReportAccess(adminUser), forcedProfessional: "Dra. Ana", canChooseProfessional: false }, professional: "Dra. Ana", requestedProfessional: null };
  const position = await datasets.stockPositionDataset(forced);
  assert.equal(position.costHidden, true);
  assert.ok(position.items.every((item) => item.unitCostCents === null && item.valueCents === null));
  assert.equal(position.summary.totalValueCents, null);
  const acidItem = position.items.find((item) => item.name === "Ácido");
  assert.deepEqual([acidItem.balance, acidItem.situation, acidItem.nextExpiry], [40, "ok", "2026-11-15"]);
  const doc = await documentFor("stock", forced);
  const positionTable = section(doc, "position");
  assert.ok(!positionTable.columns.some((column) => column.key === "cost" || column.key === "value"));
  assert.ok(positionTable.notes.some((noteText) => noteText.includes("não são exibidos")));
  assert.equal((await datasets.stockPositionDataset(ctxFor(clinicId))).costHidden, false);
});

test("per-request memo: the same context reads appointments and catalog once; a new context reads again", opts, async () => {
  const clinicId = await newClinic("memo1");
  const ctx = ctxFor(clinicId);
  const window = { start: "2026-11-01", end: "2026-11-30" };
  assert.equal(legacy.loadAppointments(ctx, window), legacy.loadAppointments(ctx, window));
  assert.equal(legacy.loadCatalog(ctx), legacy.loadCatalog(ctx));
  assert.notEqual(legacy.loadAppointments(ctx, window), legacy.loadAppointments(ctxFor(clinicId), window));
  assert.notEqual(legacy.loadAppointments(ctx, window), legacy.loadAppointments(ctx, { start: "2026-11-02", end: "2026-11-30" }));
});

test("finance extras: truncation is per table (a huge pending list does not hide the paid total)", opts, async () => {
  const clinicId = await newClinic("fin-trunc");
  const patient = await newPatient(clinicId, "P1");
  await prisma.payment.create({ data: { clinicId, patientId: patient.id, valueCents: 1_000, method: "Pix", installments: "1x", status: "Pago", date: at("2026-11-10") } });
  await prisma.payment.create({ data: { clinicId, patientId: patient.id, valueCents: 2_000, method: "Pix", installments: "1x", status: "Pendente", date: at("2026-11-11") } });
  const extras = await datasets.financeExtras(ctxFor(clinicId));
  const doc = await documentFor("finance", ctxFor(clinicId));
  assert.equal(extras.payments.paid.total, 1);
  assert.equal(section(doc, "payments-paid").truncated, null);
  assert.equal(section(doc, "payments-paid").total.cells[4].value, 1_000);
  assert.equal(section(doc, "payments-pending").total.cells[4].value, 2_000);
});

test("xlsx from the real database: KPI cards (formulas or values) equal the document KPIs, with the same formulas covering the detail rows", opts, async () => {
  const { readXlsx, kpiAddresses, displayNumber } = await import("./reports-xlsx-reader.mjs");
  const { renderReportFile } = await import("../src/lib/reports-export.ts");
  const { clinicId } = await seedStock("xl1");
  const patient = await newPatient(clinicId, "P1");
  await newAppointment(clinicId, patient.id, "2026-11-08", "Botox", "Dra. Ana", "Atendido");
  await newAppointment(clinicId, patient.id, "2026-11-09", "Peeling", "Dra. Bia", "Faltou");
  await prisma.payment.create({ data: { clinicId, patientId: patient.id, valueCents: 12_345, method: "Pix", installments: "1x", status: "Pago", date: at("2026-11-10") } });
  await prisma.expense.create({ data: { clinicId, description: "SEGREDO-DESC", category: "Aluguel", amountCents: 2_000, dueOn: new Date("2026-11-10T00:00:00Z"), paymentMethod: "Pix", status: "paid", paidOn: new Date("2026-11-11T00:00:00Z") } });
  for (const kind of ["finance", "procedures", "professionals", "appointments", "clients", "quotes", "stock", "overview"]) {
    const bundle = await bundleFor(kind, ctxFor(clinicId));
    const xlsx = await readXlsx(Buffer.from((await renderReportFile(bundle, "xlsx")).body));
    const resumo = xlsx.sheet("Resumo");
    let formulas = 0;
    for (const { item, value } of kpiAddresses(bundle.spec).addresses) {
      const expected = displayNumber(item.value);
      const cell = resumo.cells[value];
      if (typeof expected === "string") assert.equal(cell.value, "–", `${kind}: ${item.label}`);
      else assert.ok(Math.abs(cell.value - expected) < 1e-9, `${kind}: ${item.label} = ${cell.value}, tela = ${expected}`);
      if (cell.formula) formulas += 1;
    }
    if (kind !== "clients" && kind !== "quotes") assert.ok(formulas >= 1, `${kind}: ao menos um KPI com fórmula`); // Clientes e Orçamentos: o card derivável vale zero (valor simples)
  }
});

test("forced PROFESSIONAL: no derived stock cost in dataset, document, XLSX, CSV and PDF; procedure material cost/margin restricted; ADMIN still sees them", opts, async () => {
  const { readXlsx } = await import("./reports-xlsx-reader.mjs");
  const { renderReportFile } = await import("../src/lib/reports-export.ts");
  const { pdfPageTexts } = await import("./reports-fixtures.mjs");
  const { clinicId, acid } = await seedStock("rst1");
  const patient = await newPatient(clinicId, "PX");
  await newAppointment(clinicId, patient.id, "2026-11-04", "Botox", "Dra. Ana", "Atendido");
  const botox = await prisma.procedure.create({ data: { clinicId, name: "Botox", price: 1500, durationMinutes: 30, materials: "" } });
  await prisma.procedureMaterial.create({ data: { procedureId: botox.id, productId: acid.id, quantity: 2 } });
  const forced = { ...ctxFor(clinicId), access: { ...access.resolveReportAccess(adminUser), forcedProfessional: "Dra. Ana", canChooseProfessional: false }, professional: "Dra. Ana", requestedProfessional: null };

  const adminProcedures = (await legacy.proceduresReport(ctxFor(clinicId))).rows.find((r) => r.name === "Botox");
  assert.equal(adminProcedures.materialCostCents, adminProcedures.executions * 2_000); // ADMIN vê (2 ml × R$ 10,00 por execução)
  const proProcedures = (await legacy.proceduresReport(forced)).rows.find((r) => r.name === "Botox");
  assert.deepEqual([proProcedures.materialCostCents, proProcedures.marginCents, proProcedures.materialCostReason, proProcedures.costKnown], [null, null, "restricted", false]);
  assert.equal(proProcedures.tableValueCents, proProcedures.executions * 150_000); // valor de tabela segue visível

  const movements = await datasets.stockMovementsDataset(forced);
  assert.equal(movements.costHidden, true);
  assert.ok(movements.summary.types.every((entry) => entry.costCents === null));
  assert.ok(movements.consumption.byProduct.every((item) => item.estimatedCostCents === null));
  assert.equal((await datasets.stockMovementsDataset(ctxFor(clinicId))).costHidden, false);

  for (const kind of ["stock", "procedures", "professionals", "overview", "all"]) {
    const bundle = await bundleFor(kind, forced);
    assert.ok(bundle, kind);
    const json = JSON.stringify(bundle.doc);
    assert.ok(!/Custo estimado das|"Custo unitário"|"Valor em estoque"/.test(json), `JSON ${kind}`);
    if (kind === "stock") {
      const labels = bundle.doc.sections.flatMap((section) => (section.type === "kpis" ? section.items.map((item) => item.label) : []));
      assert.ok(!labels.some((label) => /Custo|Valor total/.test(label)), labels.join("|"));
      assert.ok(!bundle.doc.sections.some((section) => section.type === "chart" && /custo|valor/i.test(section.title)));
    }
    if (kind === "procedures") {
      const kpiItems = bundle.doc.sections.find((section) => section.type === "kpis").items;
      assert.equal(kpiItems.find((item) => item.key === "materialCost").value.type, "unknown");
      assert.equal(kpiItems.find((item) => item.key === "margin").value.type, "unknown");
    }
    const xlsx = await readXlsx(Buffer.from((await renderReportFile(bundle, "xlsx")).body));
    const text = xlsx.sheets.flatMap((sheet) => Object.values(sheet.cells).map((cell) => String(cell.value))).join("\n").replace(/(Custo[^\n]*|Valor em estoque[^\n]*)não são exibidos[^\n]*/g, "");
    assert.ok(!/Custo estimado|Custo unitário|Valor total em estoque|Valor em estoque/.test(text), `XLSX ${kind}`);
    if (kind === "procedures") {
      const data = xlsx.sheet("Procedimentos");
      const lastData = bundle.spec.sheets[0].rows.length + 1;
      assert.ok(Object.entries(data.cells).filter(([ref]) => /^[EF]d+$/.test(ref) && Number(ref.slice(1)) > 1 && Number(ref.slice(1)) <= lastData).every(([, cell]) => cell.value === null || cell.value === undefined));
    }
    if (kind !== "all") {
      const csv = new TextDecoder().decode((await renderReportFile(bundle, "csv")).body);
      if (kind === "stock") assert.ok(!/Custo|Valor em estoque/.test(csv.split("\r\n")[0]));
    }
    const pdf = (await pdfPageTexts((await renderReportFile(bundle, "pdf")).body)).join("\n").replace(/(Custo[^\n]*|Valor em estoque[^\n]*)n\xE3o s\xE3o exibidos[^\n]*/g, "");
    assert.ok(!/Custo estimado das|Custo unit\xE1rio|Valor total em estoque/.test(pdf), `PDF ${kind}`);
  }
  // ADMIN: documento de estoque traz custo estimado
  assert.ok(JSON.stringify((await bundleFor("stock", ctxFor(clinicId))).doc).includes("Custo estimado"));
});

test("finance: expense description (free text) is neither selected nor exported; category is used", opts, async () => {
  const clinicId = await newClinic("desc1");
  await prisma.expense.create({ data: { clinicId, description: "SEGREDO-DESC conta da Maria", category: "Aluguel", amountCents: 5_000, dueOn: new Date("2026-11-10T00:00:00Z"), paymentMethod: "Pix", status: "paid", paidOn: new Date("2026-11-12T00:00:00Z") } });
  await prisma.expense.create({ data: { clinicId, description: "SEGREDO-DESC aberta", category: "Luz", amountCents: 3_000, dueOn: new Date("2026-11-20T00:00:00Z"), paymentMethod: "Pix", status: "open", paidOn: null } });
  const extras = await datasets.financeExtras(ctxFor(clinicId));
  for (const row of [...extras.expenses.paid.rows, ...extras.expenses.open.rows]) assert.deepEqual(Object.keys(row).sort(), ["amountCents", "category", "dueOn", "paidOn", "status"]);
  const bundle = await bundleFor("finance", ctxFor(clinicId));
  assert.ok(!JSON.stringify(bundle.doc).includes("SEGREDO"));
  const paidTable = section(bundle.doc, "expenses-paid");
  assert.deepEqual(paidTable.columns.map((column) => column.key), ["due", "paidOn", "category", "status", "value"]);
  assert.equal(paidTable.rows[0].cells[2].value, "Aluguel");
  const { renderReportFile } = await import("../src/lib/reports-export.ts");
  const csv = new TextDecoder().decode((await renderReportFile(bundle, "csv")).body);
  assert.ok(!csv.includes("SEGREDO") && csv.includes("Aluguel"));
});
