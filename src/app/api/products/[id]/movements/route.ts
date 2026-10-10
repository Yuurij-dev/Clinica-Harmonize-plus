import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lockLots, lotBalances, materialDetail } from "@/lib/stock";
import { manualMovement } from "@/lib/stock-rules";

async function adminUser(requireActiveTrial = false) {
  const user = await getCurrentUser({ requireActiveTrial });
  if (!user) return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  if (user.role !== "ADMIN") return { error: NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 }) };
  return { user };
}

// Histórico de movimentações do material (ou de um lote), da mais recente para a mais antiga.
// Com type=attendance lista só as saídas em pacientes (rastreio de recall), paginado por ?page.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await adminUser();
  if (error) return error;
  const productId = (await params).id;
  const search = new URL(request.url).searchParams;
  const lotId = search.get("lotId");
  const onlyAttendance = search.get("type") === "attendance";
  const page = Math.max(0, Number(search.get("page")) || 0);
  const pageSize = onlyAttendance ? 50 : 200;
  const movements = await prisma.stockMovement.findMany({
    where: { clinicId: user.clinicId, productId, ...(lotId ? { lotId } : {}), ...(onlyAttendance ? { type: "attendance" } : {}) },
    orderBy: { createdAt: "desc" },
    skip: page * pageSize,
    take: pageSize + 1,
    select: {
      id: true, type: true, quantity: true, reason: true, notes: true, userName: true, createdAt: true,
      attendanceKind: true, attendanceName: true, attendanceDate: true,
      lot: { select: { code: true } }, patient: { select: { name: true } }, reversedBy: { select: { id: true } },
    },
  });
  return NextResponse.json({
    hasMore: movements.length > pageSize,
    movements: movements.slice(0, pageSize).map(({ lot, patient, reversedBy, ...movement }) => ({ ...movement, lotCode: lot.code, patientName: patient?.name ?? null, reversed: Boolean(reversedBy) })),
  });
}

// Saída manual (perda, vencimento, uso interno) ou correção de contagem.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await adminUser(true);
  if (error) return error;
  const productId = (await params).id;
  const body = await request.json().catch(() => null) as { lotId?: string; reason?: string; direction?: "in" | "out"; quantity?: number; notes?: string } | null;
  const lot = await prisma.stockLot.findFirst({ where: { id: body?.lotId ?? "", productId, clinicId: user.clinicId }, select: { id: true, product: { select: { unit: true } } } });
  if (!lot) return NextResponse.json({ message: "Lote não encontrado." }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    await lockLots(tx, [lot.id]);
    const balance = (await lotBalances(user.clinicId, { lotId: lot.id }, tx)).get(lot.id) ?? 0;
    const movement = manualMovement({ reason: String(body?.reason ?? ""), direction: body?.direction, quantity: Number(body?.quantity), unit: lot.product.unit, lotBalance: balance, notes: String(body?.notes ?? "") });
    if ("error" in movement) return movement;
    await tx.stockMovement.create({ data: { clinicId: user.clinicId, productId, lotId: lot.id, type: movement.type, quantity: movement.quantity, reason: body!.reason, notes: String(body!.notes).trim(), userId: user.id, userName: user.name } });
    return movement;
  });
  if ("error" in result) return NextResponse.json({ message: result.error }, { status: 400 });
  return NextResponse.json({ product: await materialDetail(user.clinicId, productId) }, { status: 201 });
}
