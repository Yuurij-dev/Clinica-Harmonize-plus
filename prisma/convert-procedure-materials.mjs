// Converte o texto livre de materiais dos procedimentos em ficha técnica (quantidade 1).
// Só mexe em procedimentos que ainda não têm ficha; pode rodar mais de uma vez.
// Procedimentos com texto de materiais ficam marcados para revisão.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { convertMaterialsText } from "../src/lib/stock-rules.ts";

const prisma = new PrismaClient();

async function main() {
  const procedures = await prisma.procedure.findMany({
    where: { technicalSheet: { none: {} }, materialsNeedReview: false, NOT: { materials: "" } },
    select: { id: true, clinicId: true, name: true, materials: true },
  });
  const productsByClinic = new Map();
  let converted = 0;
  for (const procedure of procedures) {
    if (!productsByClinic.has(procedure.clinicId)) {
      productsByClinic.set(procedure.clinicId, await prisma.product.findMany({ where: { clinicId: procedure.clinicId }, select: { id: true, name: true } }));
    }
    const items = convertMaterialsText(procedure.materials, productsByClinic.get(procedure.clinicId));
    await prisma.$transaction([
      ...items.map((item) => prisma.procedureMaterial.create({ data: { procedureId: procedure.id, productId: item.productId, quantity: item.quantity } })),
      prisma.procedure.update({ where: { id: procedure.id }, data: { materialsNeedReview: true } }),
    ]);
    converted += 1;
    console.log(`${procedure.name}: ${items.length} material(is) encontrado(s) em "${procedure.materials}"`);
  }
  console.log(`${converted} procedimento(s) marcados para revisão.`);
}

main().finally(() => prisma.$disconnect());
