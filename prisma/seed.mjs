import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash("admin", 12);
  await prisma.user.upsert({
    where: { email: "admin" },
    update: { name: "Dra. Ana", passwordHash, role: "ADMIN" },
    create: { name: "Dra. Ana", email: "admin", passwordHash, role: "ADMIN" },
  });
  console.log("Usuário administrador criado: admin / admin");
}

main().finally(() => prisma.$disconnect());
