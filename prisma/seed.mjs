import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash("admin", 12);
  await prisma.user.upsert({
    where: { email: "admin" },
    update: { name: "Dra. Ana", passwordHash, role: "ADMIN", emailVerifiedAt: new Date() },
    create: { name: "Dra. Ana", email: "admin", passwordHash, role: "ADMIN", emailVerifiedAt: new Date() },
  });

  async function ensureDemoAccount({ email, name, password, clinicName, slug, trial }) {
    const accountPasswordHash = await hash(password, 12);
    const existingClinic = await prisma.clinic.findUnique({ where: { slug } });
    const now = new Date();
    const clinic = existingClinic ?? await prisma.clinic.create({
      data: {
        name: clinicName,
        slug,
        ...(trial ? { trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) } : {}),
      },
    });
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, passwordHash: accountPasswordHash, role: "ADMIN", emailVerifiedAt: new Date() },
      create: { name, email, passwordHash: accountPasswordHash, role: "ADMIN", emailVerifiedAt: new Date() },
    });
    await prisma.clinicMembership.upsert({
      where: { userId_clinicId: { userId: user.id, clinicId: clinic.id } },
      update: { role: "ADMIN", isOwner: true },
      create: { userId: user.id, clinicId: clinic.id, role: "ADMIN", isOwner: true },
    });
  }

  await ensureDemoAccount({ email: "teste", name: "Clínica Teste", password: "teste123", clinicName: "Clínica Teste Grátis", slug: "clinica-teste-gratis", trial: true });
  await ensureDemoAccount({ email: "pro", name: "Clínica Pro", password: "pro123", clinicName: "Clínica Pro", slug: "clinica-pro", trial: false });
  console.log("Usuário administrador criado: admin / admin");
  console.log("Conta de teste criada: teste / teste123");
  console.log("Conta profissional criada: pro / pro123");
}

main().finally(() => prisma.$disconnect());
