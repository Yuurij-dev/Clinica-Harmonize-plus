import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { sendVerificationEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

function slugPart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "clinica";
}

function hashVerificationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    name?: string;
    phone?: string;
    profession?: string;
    practiceArea?: string;
    hasSecretary?: string;
    email?: string;
    password?: string;
  } | null;

  const name = body?.name?.trim() ?? "";
  const phone = body?.phone?.trim() ?? "";
  const profession = body?.profession?.trim() ?? "";
  const practiceArea = body?.practiceArea?.trim() ?? "";
  const hasSecretary = body?.hasSecretary === "Sim" ? true : body?.hasSecretary === "Não" ? false : null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";

  if (!name || !phone || !profession || !practiceArea || hasSecretary === null || !email || password.length < 6) {
    return NextResponse.json({ message: "Preencha todos os campos e informe uma senha com pelo menos 6 caracteres." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ message: "Já existe uma conta com este e-mail." }, { status: 409 });

  const passwordHash = await hash(password, 12);
  const firstName = name.split(/\s+/)[0];
  const clinicName = `Clínica ${firstName}`;
  const clinicSlug = `${slugPart(clinicName)}-${randomUUID().slice(0, 8)}`;
  const trialStartedAt = new Date();
  const trialEndsAt = new Date(trialStartedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
  const verificationToken = randomBytes(32).toString("hex");
  const verificationExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

  try {
    const account = await prisma.$transaction(async (transaction) => {
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
          emailVerificationTokenHash: hashVerificationToken(verificationToken),
          emailVerificationExpiresAt: verificationExpiresAt,
          role: "ADMIN",
        },
      });
      await transaction.clinicMembership.create({
        data: { userId: createdUser.id, clinicId: clinic.id, role: "ADMIN", isOwner: true },
      });
      return { user: createdUser, clinic };
    });

    const verificationUrl = new URL(`/api/auth/verify-email?token=${encodeURIComponent(verificationToken)}`, request.url).toString();
    try {
      const developmentVerificationUrl = await sendVerificationEmail({ recipient: email, name, verificationUrl });
      return NextResponse.json({
        verificationRequired: true,
        email,
        ...(developmentVerificationUrl ? { verificationUrl: developmentVerificationUrl } : {}),
      }, { status: 201 });
    } catch (error) {
      await prisma.$transaction(async (transaction) => {
        await transaction.clinic.delete({ where: { id: account.clinic.id } });
        await transaction.user.delete({ where: { id: account.user.id } });
      });
      console.error("[email-verification]", error);
      return NextResponse.json({ message: "Não foi possível enviar o e-mail de confirmação. Tente novamente." }, { status: 503 });
    }

  } catch (error) {
    console.error("[register]", error);
    return NextResponse.json({ message: "Não foi possível criar a conta agora. Tente novamente." }, { status: 500 });
  }
}
