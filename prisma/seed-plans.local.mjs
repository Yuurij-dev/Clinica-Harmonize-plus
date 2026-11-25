import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

// Carrega primeiro o .env.local e preserva qualquer variável já exportada pelo shell.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const prisma = new PrismaClient();
const plans = [
  { id: "start", label: "Start" },
  { id: "pro", label: "Pro" },
  { id: "premium", label: "Premium" },
];

function assertLocalOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Este seed só pode ser executado fora de produção.");
  }
  if (process.env.SEED_LOCAL_PLAN_ACCOUNTS !== "1") {
    throw new Error("Seed local bloqueado. Defina SEED_LOCAL_PLAN_ACCOUNTS=1 para confirmar a execução.");
  }

  for (const [name, value] of [["DATABASE_URL", process.env.DATABASE_URL], ["DIRECT_URL", process.env.DIRECT_URL]]) {
    let url;
    try {
      url = new URL(value ?? "");
    } catch {
      throw new Error(`${name} precisa apontar para o PostgreSQL local do projeto (localhost:5433/harmonize).`);
    }

    const localHost = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (!(["postgres:", "postgresql:"].includes(url.protocol)) || !localHost || url.port !== "5433" || url.pathname !== "/harmonize") {
      throw new Error(`${name} precisa apontar para o PostgreSQL local do projeto (localhost:5433/harmonize).`);
    }
  }
}

// Sem regra de tamanho/força: são contas de teste só no Postgres local, nunca alcançáveis em produção (assertLocalOnly).
function getPassword() {
  const password = process.env.SEED_PLAN_ACCOUNTS_PASSWORD;
  if (!password) {
    throw new Error("Defina SEED_PLAN_ACCOUNTS_PASSWORD com a senha das contas de teste locais.");
  }
  return password;
}

async function main() {
  assertLocalOnly();
  const passwordHash = await hash(getPassword(), 12);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const plan of plans) {
      const slug = `seed-local-${plan.id}`;
      // @teste.com: modo de teste do projeto já aceita 000000 como código de verificação (login e cadastro),
      // então essas contas entram sem precisar de e-mail de verdade. Remove a conta de uma versão anterior
      // deste seed (@harmonize.local, sem o código fixo) para não deixar um admin órfão na mesma clínica.
      const email = `seed.${plan.id}@teste.com`;
      await tx.user.deleteMany({ where: { email: `seed.${plan.id}@harmonize.local` } });
      const clinic = await tx.clinic.upsert({
        where: { slug },
        update: { name: `Clínica Seed ${plan.label}`, trialStartedAt: null, trialEndsAt: null },
        create: { name: `Clínica Seed ${plan.label}`, slug },
        select: { id: true },
      });
      const user = await tx.user.upsert({
        where: { email },
        update: { name: `Conta ${plan.label}`, passwordHash, role: "ADMIN", emailVerifiedAt: now, activeClinicId: clinic.id },
        create: { name: `Conta ${plan.label}`, email, passwordHash, role: "ADMIN", emailVerifiedAt: now, activeClinicId: clinic.id },
        select: { id: true },
      });

      await tx.clinicMembership.upsert({
        where: { userId_clinicId: { userId: user.id, clinicId: clinic.id } },
        update: { role: "ADMIN", isOwner: true },
        create: { userId: user.id, clinicId: clinic.id, role: "ADMIN", isOwner: true },
      });
      await tx.clinicSubscription.upsert({
        where: { clinicId: clinic.id },
        update: { plan: plan.id, status: "ACTIVE", trialStartedAt: null, trialEndsAt: null, currentPeriodStart: now, currentPeriodEnd: null, canceledAt: null },
        create: { clinicId: clinic.id, plan: plan.id, status: "ACTIVE", currentPeriodStart: now },
      });
    }
  });

  console.log("Contas locais prontas (senha definida por SEED_PLAN_ACCOUNTS_PASSWORD):");
  for (const plan of plans) {
    console.log(`- ${plan.label}: seed.${plan.id}@teste.com`);
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
