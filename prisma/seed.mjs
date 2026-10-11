import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

function seedPassword(name, required = false) {
  const password = process.env[name];
  if (!password && !required) return null;
  if (!password || password.length < 12) {
    throw new Error(`${name} precisa ter pelo menos 12 caracteres para executar o seed.`);
  }
  return password;
}

async function main() {
  const adminPassword = seedPassword("SEED_ADMIN_PASSWORD", true);
  const testPassword = seedPassword("SEED_TEST_PASSWORD");
  const proPassword = seedPassword("SEED_PRO_PASSWORD");
  const passwordHash = await hash(adminPassword, 12);
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

  if (testPassword) {
    await ensureDemoAccount({ email: "teste", name: "Clínica Teste", password: testPassword, clinicName: "Clínica Teste Grátis", slug: "clinica-teste-gratis", trial: true });
  }
  if (proPassword) {
    await ensureDemoAccount({ email: "pro", name: "Clínica Pro", password: proPassword, clinicName: "Clínica Pro", slug: "clinica-pro", trial: false });
  }
  console.log("Usuário administrador atualizado: admin");
  if (testPassword) console.log("Conta de teste atualizada: teste");
  if (proPassword) console.log("Conta profissional atualizada: pro");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
