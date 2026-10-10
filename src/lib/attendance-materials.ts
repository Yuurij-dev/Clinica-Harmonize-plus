import { clinicToday, dateOnly } from "./clinic-time";
import { prisma } from "./prisma";
import { lockLots, lotBalances, movementTypes, type StockTransaction } from "./stock";
import { allocateLots, attendanceKind, roundQuantity, validateQuantity } from "./stock-rules";

export class AttendanceMaterialsError extends Error {}

type ItemInput = { productId: string; quantity: number; allocations?: Array<{ lotId: string; quantity: number }> };

export async function findAttendance(clinicId: string, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    select: { id: true, procedure: true, date: true, status: true, materialsCheck: true, patientId: true, patient: { select: { name: true } } },
  });
  if (!appointment) return null;
  return { ...appointment, kind: attendanceKind(appointment.procedure) };
}

// Dados da conferência: sugestão da ficha técnica (só em procedimento) e os materiais com lotes
// utilizáveis (não vencidos e com saldo), em ordem de validade. Sem custos.
export async function attendanceCheckData(clinicId: string, appointmentId: string) {
  const attendance = await findAttendance(clinicId, appointmentId);
  if (!attendance) return null;
  const today = clinicToday();
  const [procedure, products, balances] = await Promise.all([
    attendance.kind === "procedure" ? prisma.procedure.findFirst({ where: { clinicId, name: attendance.procedure }, select: { technicalSheet: { select: { productId: true, quantity: true } } } }) : null,
    prisma.product.findMany({ where: { clinicId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, lots: { where: { expiresOn: { gte: new Date(`${today}T00:00:00Z`) } }, orderBy: { expiresOn: "asc" }, select: { id: true, code: true, expiresOn: true } } } }),
    lotBalances(clinicId),
  ]);
  return {
    appointment: { id: attendance.id, kind: attendance.kind, name: attendance.procedure, date: attendance.date, status: attendance.status, materialsCheck: attendance.materialsCheck, patientName: attendance.patient.name },
    suggestions: (procedure?.technicalSheet ?? []).filter((item) => products.some((product) => product.id === item.productId)),
    materials: products.map((product) => ({
      id: product.id, name: product.name, unit: product.unit,
      lots: product.lots.map((lot) => ({ id: lot.id, code: lot.code, expiresOn: dateOnly(lot.expiresOn), balance: balances.get(lot.id) ?? 0 })).filter((lot) => lot.balance > 0),
    })),
  };
}

// Registra as saídas do atendimento numa transação. Lotes vencidos e quantidades inválidas são
// recusados; o que faltar de saldo vira saída pendente. Nunca bloqueia o atendimento.
export async function registerAttendanceOutputs(tx: StockTransaction, input: { clinicId: string; userId: string; userName: string; attendance: NonNullable<Awaited<ReturnType<typeof findAttendance>>>; items: ItemInput[] }) {
  const { clinicId, attendance } = input;
  if (new Set(input.items.map((item) => item.productId)).size !== input.items.length) throw new AttendanceMaterialsError("Um material aparece mais de uma vez.");
  const products = await tx.product.findMany({ where: { clinicId, id: { in: input.items.map((item) => item.productId) } }, select: { id: true, name: true, unit: true, lots: { select: { id: true, code: true, expiresOn: true } } } });
  const allLotIds = products.flatMap((product) => product.lots.map((lot) => lot.id));
  await lockLots(tx, allLotIds);
  const balances = await lotBalances(clinicId, { lotId: { in: allLotIds } }, tx);
  const today = clinicToday();
  const pending: Array<{ name: string; unit: string; quantity: number }> = [];
  const attendanceData = { appointmentId: attendance.id, patientId: attendance.patientId, attendanceKind: attendance.kind, attendanceName: attendance.procedure, attendanceDate: attendance.date };

  for (const item of input.items) {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product) throw new AttendanceMaterialsError("Material não encontrado.");
    const quantityError = validateQuantity(item.quantity, product.unit);
    if (quantityError) throw new AttendanceMaterialsError(`${product.name}: ${quantityError}`);
    const lots = product.lots.map((lot) => ({ id: lot.id, code: lot.code, expiresOn: dateOnly(lot.expiresOn), balance: balances.get(lot.id) ?? 0 }));

    let allocations = item.allocations;
    if (allocations) {
      const used = new Map<string, number>();
      for (const allocation of allocations) {
        const lot = lots.find((candidate) => candidate.id === allocation.lotId);
        if (!lot) throw new AttendanceMaterialsError(`${product.name}: lote inválido.`);
        if (lot.expiresOn < today) throw new AttendanceMaterialsError(`${product.name}: o lote ${lot.code} está vencido e não pode ser usado em paciente.`);
        const allocationError = validateQuantity(allocation.quantity, product.unit);
        if (allocationError) throw new AttendanceMaterialsError(`${product.name}: ${allocationError}`);
        used.set(lot.id, roundQuantity((used.get(lot.id) ?? 0) + allocation.quantity));
        if ((used.get(lot.id) ?? 0) > lot.balance) throw new AttendanceMaterialsError(`${product.name}: o lote ${lot.code} não tem saldo suficiente.`);
      }
      if (roundQuantity(allocations.reduce((sum, allocation) => sum + allocation.quantity, 0)) > item.quantity) throw new AttendanceMaterialsError(`${product.name}: os lotes somam mais que a quantidade usada.`);
    } else {
      allocations = allocateLots(item.quantity, lots, today).allocations;
    }

    for (const allocation of allocations) {
      await tx.stockMovement.create({ data: { clinicId, productId: product.id, lotId: allocation.lotId, type: movementTypes.attendance, quantity: -allocation.quantity, userId: input.userId, userName: input.userName, ...attendanceData } });
      balances.set(allocation.lotId, roundQuantity((balances.get(allocation.lotId) ?? 0) - allocation.quantity));
    }
    const missing = roundQuantity(item.quantity - allocations.reduce((sum, allocation) => sum + allocation.quantity, 0));
    if (missing > 0) {
      await tx.pendingStockOutput.create({ data: { clinicId, productId: product.id, quantity: missing, ...attendanceData, attendanceDate: attendance.date } });
      pending.push({ name: product.name, unit: product.unit, quantity: missing });
    }
  }
  return pending;
}
