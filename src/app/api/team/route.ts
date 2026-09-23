import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const members = await prisma.clinicMembership.findMany({
    where: { clinicId: user.clinicId },
    orderBy: { user: { name: "asc" } },
    select: { id: true, role: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
  });
  return NextResponse.json({ members });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Apenas administradores podem cadastrar colaboradores." }, { status: 403 });

  const body = await request.json().catch(() => null) as { name?: string; email?: string; password?: string; role?: "ADMIN" | "PROFESSIONAL" | "STAFF" } | null;
  const name = body?.name?.trim();
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? "";
  const role = body?.role ?? "PROFESSIONAL";
  if (!name || !email || password.length < 6 || !["ADMIN", "PROFESSIONAL", "STAFF"].includes(role)) {
    return NextResponse.json({ message: "Informe nome, e-mail e uma senha com pelo menos 6 caracteres." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ message: "Já existe uma conta com este e-mail." }, { status: 409 });

  const passwordHash = await hash(password, 12);
  const member = await prisma.$transaction(async (transaction) => {
    const createdUser = await transaction.user.create({ data: { name, email, passwordHash, role } });
    return transaction.clinicMembership.create({
      data: { userId: createdUser.id, clinicId: user.clinicId, role },
      select: { id: true, role: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
    });
  });
  return NextResponse.json({ member }, { status: 201 });
}
