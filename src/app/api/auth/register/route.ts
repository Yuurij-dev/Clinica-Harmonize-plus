import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function slugPart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "clinica";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    clinicName?: string;
    name?: string;
    phone?: string;
    profession?: string;
    practiceArea?: string;
    hasSecretary?: string;
    email?: string;
    password?: string;
  } | null;

  const clinicName = body?.clinicName?.trim() ?? "";
  const name = body?.name?.trim() ?? "";
  const phone = body?.phone?.trim() ?? "";
  const profession = body?.profession?.trim() ?? "";
  const practiceArea = body?.practiceArea?.trim() ?? "";
  const hasSecretary = body?.hasSecretary === "Sim" ? true : body?.hasSecretary === "Não" ? false : null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";

  if (!clinicName || clinicName.length > 100) {
    return NextResponse.json({ message: "Informe um nome para a clínica com até 100 caracteres." }, { status: 400 });
  }

  if (!name || !phone || !profession || !practiceArea || hasSecretary === null || !email || password.length < 6) {
    return NextResponse.json({ message: "Preencha todos os campos e informe uma senha com pelo menos 6 caracteres." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ message: "Já existe uma conta com este e-mail." }, { status: 409 });

  const passwordHash = await hash(password, 12);
  const clinicSlug = `${slugPart(clinicName)}-${randomUUID().slice(0, 8)}`;
  const trialStartedAt = new Date();
  const trialEndsAt = new Date(trialStartedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
  try {
    await prisma.$transaction(async (transaction) => {
      const clinic = await transaction.clinic.create({ data: { name: clinicName, slug: clinicSlug, trialStartedAt, trialEndsAt } });
      const createdUser = await transaction.user.create({
        data: {
          name,
          email,
          passwordHash,
          phone,
          profession,
          practiceArea,
          hasSecretary,
          emailVerifiedAt: new Date(),
          role: "ADMIN",
        },
      });
      await transaction.clinicMembership.create({
        data: { userId: createdUser.id, clinicId: clinic.id, role: "ADMIN", isOwner: true },
      });
    });
    return NextResponse.json({ created: true }, { status: 201 });
  } catch (error) {
    console.error("[register]", error);
    return NextResponse.json({ message: "Não foi possível criar a conta agora. Tente novamente." }, { status: 500 });
  }
}
