import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const clinic = await prisma.clinic.upsert({
    where: { slug: "harmonize-demo" },
    update: { name: "Clínica Harmonize" },
    create: { name: "Clínica Harmonize", slug: "harmonize-demo" },
  });

  const users = await prisma.user.findMany({ select: { id: true, role: true } });
  for (const user of users) {
    await prisma.clinicMembership.upsert({
      where: { userId_clinicId: { userId: user.id, clinicId: clinic.id } },
      update: { role: user.role },
      create: { userId: user.id, clinicId: clinic.id, role: user.role },
    });
  }

  await prisma.patient.updateMany({ where: { clinicId: null }, data: { clinicId: clinic.id } });
  await prisma.appointment.updateMany({ where: { clinicId: null }, data: { clinicId: clinic.id } });
  await prisma.procedure.updateMany({ where: { clinicId: null }, data: { clinicId: clinic.id } });
  await prisma.evaluation.updateMany({ where: { clinicId: null }, data: { clinicId: clinic.id } });

  console.log(`Clínica pronta: ${clinic.name} (${clinic.id})`);
  console.log(`Usuários vinculados: ${users.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
