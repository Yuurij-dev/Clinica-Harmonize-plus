import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { clinicSlug, parseClinicProfile, trialWindow } from "@/lib/clinic-signup-rules";
import { prisma } from "@/lib/prisma";

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

  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";

  const parsed = parseClinicProfile(body);
  if (!parsed.ok && parsed.code === "clinic_name") {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  if (!parsed.ok || !email || password.length < 8) {
    return NextResponse.json({ message: "Preencha todos os campos e informe uma senha com pelo menos 8 caracteres." }, { status: 400 });
  }
  const { clinicName, name, phone, profession, practiceArea, hasSecretary } = parsed.value;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ message: "Já existe uma conta com este e-mail." }, { status: 409 });

  const passwordHash = await hash(password, 12);
  const slug = clinicSlug(clinicName, randomUUID());
  const { trialStartedAt, trialEndsAt } = trialWindow(new Date());
  try {
    await prisma.$transaction(async (transaction) => {
      const clinic = await transaction.clinic.create({ data: { name: clinicName, slug, trialStartedAt, trialEndsAt } });
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
