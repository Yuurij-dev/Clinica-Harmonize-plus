import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { SectionId } from "@/types/clinic";

type SearchResult = { id: string; title: string; description: string; section: SectionId; kind: string };
const resultLimit = 5;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const rawQuery = new URL(request.url).searchParams.get("q") ?? "";
  const query = rawQuery.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  if (query.length < 2) return NextResponse.json({ results: [] satisfies SearchResult[] });

  const clinicId = user.clinicId;
  const pattern = `%${query}%`;
  const matches: Prisma.Sql[] = [];

  if (canForUser(user, "patients:access")) matches.push(Prisma.sql`
    (SELECT p."id", p."name" AS title, concat_ws(' · ', p."phone", p."status") AS description,
      'clientes' AS section, 'Paciente' AS kind
     FROM "Patient" p WHERE p."clinicId" = ${clinicId}
       AND (p."name" ILIKE ${pattern} OR p."phone" ILIKE ${pattern} OR p."status" ILIKE ${pattern})
     ORDER BY p."name" LIMIT ${resultLimit})`);

  // Notas do agendamento são texto clínico e não são devolvidas: só entram no filtro com clinical:read.
  const appointmentNotesMatch = canForUser(user, "clinical:read") ? Prisma.sql`OR a."notes" ILIKE ${pattern} ` : Prisma.empty;
  if (canForUser(user, "agenda:access")) matches.push(Prisma.sql`
    (SELECT a."id", concat_ws(' · ', p."name", a."procedure") AS title,
      concat_ws(' · ', to_char(a."date" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || ' ' || a."time", a."professional", a."status") AS description,
      'agenda' AS section, 'Agendamento' AS kind
     FROM "Appointment" a JOIN "Patient" p ON p."id" = a."patientId"
     WHERE a."clinicId" = ${clinicId}
       AND (a."procedure" ILIKE ${pattern} OR a."professional" ILIKE ${pattern} ${appointmentNotesMatch}OR a."status" ILIKE ${pattern} OR p."name" ILIKE ${pattern})
     ORDER BY a."date" DESC LIMIT ${resultLimit})`);

  if (canForUser(user, "procedures:access")) matches.push(Prisma.sql`
    (SELECT p."id", p."name" AS title, concat_ws(' · ', nullif(p."category", ''), nullif(p."materials", '')) AS description,
      'procedimentos' AS section, 'Procedimento' AS kind
     FROM "Procedure" p WHERE p."clinicId" = ${clinicId}
       AND (p."name" ILIKE ${pattern} OR p."category" ILIKE ${pattern} OR p."materials" ILIKE ${pattern})
     ORDER BY p."name" LIMIT ${resultLimit})`);

  if (canForUser(user, "stock:access")) {
    matches.push(Prisma.sql`
      (SELECT p."id", p."name" AS title, concat_ws(' · ', nullif(p."category", ''), p."supplier", p."unit") AS description,
        'estoque' AS section, 'Estoque' AS kind
       FROM "Product" p WHERE p."clinicId" = ${clinicId}
         AND (p."name" ILIKE ${pattern} OR p."category" ILIKE ${pattern} OR p."supplier" ILIKE ${pattern} OR p."unit" ILIKE ${pattern})
       ORDER BY p."name" LIMIT ${resultLimit})`);
    matches.push(Prisma.sql`
      (SELECT m."id", p."name" AS title, concat_ws(' · ', m."type", m."reason") AS description,
        'estoque' AS section, 'Movimentação de estoque' AS kind
       FROM "StockMovement" m JOIN "Product" p ON p."id" = m."productId"
       WHERE m."clinicId" = ${clinicId}
         AND (m."type" ILIKE ${pattern} OR m."reason" ILIKE ${pattern} OR m."notes" ILIKE ${pattern} OR p."name" ILIKE ${pattern})
       ORDER BY m."createdAt" DESC LIMIT ${resultLimit})`);
  }

  if (canForUser(user, "purchases:access")) matches.push(Prisma.sql`
    (SELECT b."id", b."supplier" AS title, concat_ws(' · ', b."invoiceNumber", to_char(b."purchasedOn", 'DD/MM/YYYY'), b."status") AS description,
      'compras' AS section, 'Compra' AS kind
     FROM "Purchase" b WHERE b."clinicId" = ${clinicId}
       AND (b."supplier" ILIKE ${pattern} OR b."invoiceNumber" ILIKE ${pattern} OR b."userName" ILIKE ${pattern}
         OR EXISTS (SELECT 1 FROM "PurchaseItem" i JOIN "Product" p ON p."id" = i."productId" WHERE i."purchaseId" = b."id" AND p."name" ILIKE ${pattern}))
     ORDER BY b."purchasedOn" DESC LIMIT ${resultLimit})`);

  if (canForUser(user, "quotes:access")) matches.push(Prisma.sql`
    (SELECT q."id", coalesce(p."name", 'Orçamento') AS title, left(q."items" || ' · ' || q."status", 180) AS description,
      'orcamentos' AS section, 'Orçamento' AS kind
     FROM "Quote" q LEFT JOIN "Patient" p ON p."id" = q."patientId"
     WHERE q."clinicId" = ${clinicId}
       AND (q."items" ILIKE ${pattern} OR q."notes" ILIKE ${pattern} OR q."status" ILIKE ${pattern} OR p."name" ILIKE ${pattern})
     ORDER BY q."createdAt" DESC LIMIT ${resultLimit})`);

  if (canForUser(user, "payments:access")) matches.push(Prisma.sql`
    (SELECT pay."id", coalesce(p."name", 'Pagamento') AS title,
      concat_ws(' · ', pay."method", pay."status", to_char(pay."date" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'), 'R$ ' || to_char(pay."valueCents" / 100.0, 'FM999999990D00')) AS description,
      'pagamentos' AS section, 'Pagamento' AS kind
     FROM "Payment" pay LEFT JOIN "Patient" p ON p."id" = pay."patientId"
     WHERE pay."clinicId" = ${clinicId}
       AND (pay."method" ILIKE ${pattern} OR pay."status" ILIKE ${pattern} OR pay."installments" ILIKE ${pattern} OR p."name" ILIKE ${pattern})
     ORDER BY pay."date" DESC LIMIT ${resultLimit})`);

  if (canForUser(user, "finance:access")) {
    matches.push(Prisma.sql`
      (SELECT e."id", e."description" AS title, concat_ws(' · ', e."category", e."status", to_char(e."dueOn", 'DD/MM/YYYY')) AS description,
        'financeiro' AS section, 'Despesa' AS kind
       FROM "Expense" e WHERE e."clinicId" = ${clinicId}
         AND (e."description" ILIKE ${pattern} OR e."category" ILIKE ${pattern} OR e."paymentMethod" ILIKE ${pattern} OR e."status" ILIKE ${pattern})
       ORDER BY e."dueOn" DESC LIMIT ${resultLimit})`);
    matches.push(Prisma.sql`
      (SELECT r."id", r."description" AS title, concat_ws(' · ', r."category", r."frequency") AS description,
        'financeiro' AS section, 'Despesa recorrente' AS kind
       FROM "RecurringExpense" r WHERE r."clinicId" = ${clinicId}
         AND (r."description" ILIKE ${pattern} OR r."category" ILIKE ${pattern} OR r."paymentMethod" ILIKE ${pattern} OR r."frequency" ILIKE ${pattern})
       ORDER BY r."description" LIMIT ${resultLimit})`);
  }

  // Conteúdo de anamnese exige anamnesis:read além de clinical:read.
  const anamnesisMatch = canForUser(user, "anamnesis:read")
    ? Prisma.sql`OR EXISTS (SELECT 1 FROM "PatientAnamnesis" a WHERE a."patientId" = p."id" AND a."clinicId" = ${clinicId} AND (a."content" ILIKE ${pattern} OR a."reviewReason" ILIKE ${pattern} OR a."status" ILIKE ${pattern}))`
    : Prisma.empty;
  if (canForUser(user, "patients:access") && canForUser(user, "clinical:read")) matches.push(Prisma.sql`
    (SELECT p."id", p."name" AS title, 'Registro clínico corresponde à busca' AS description,
      'clientes' AS section, 'Registro clínico' AS kind
     FROM "Patient" p WHERE p."clinicId" = ${clinicId} AND (
       EXISTS (SELECT 1 FROM "PatientObservation" o WHERE o."patientId" = p."id" AND o."clinicId" = ${clinicId} AND o."text" ILIKE ${pattern})
       OR EXISTS (SELECT 1 FROM "Evaluation" e WHERE e."patientId" = p."id" AND e."clinicId" = ${clinicId} AND (e."chiefComplaint" ILIKE ${pattern} OR e."patientGoal" ILIKE ${pattern} OR e."medicalHistory" ILIKE ${pattern} OR e."allergies" ILIKE ${pattern} OR e."pregnancyStatus" ILIKE ${pattern} OR e."anticoagulantUse" ILIKE ${pattern} OR e."autoimmuneDiseases" ILIKE ${pattern} OR e."contraindications" ILIKE ${pattern} OR e."previousProcedures" ILIKE ${pattern} OR e."clinicalNotes" ILIKE ${pattern}))
       ${anamnesisMatch}
       OR EXISTS (SELECT 1 FROM "PatientProcedureSession" s WHERE s."patientId" = p."id" AND s."clinicId" = ${clinicId} AND (s."procedureName" ILIKE ${pattern} OR s."technique" ILIKE ${pattern} OR s."treatedAreas" ILIKE ${pattern} OR s."anesthesia" ILIKE ${pattern} OR s."complications" ILIKE ${pattern} OR s."observations" ILIKE ${pattern} OR s."professional" ILIKE ${pattern}))
       OR EXISTS (SELECT 1 FROM "PatientProcedureFollowUp" f WHERE f."patientId" = p."id" AND f."clinicId" = ${clinicId} AND (f."complaints" ILIKE ${pattern} OR f."guidanceText" ILIKE ${pattern} OR f."observations" ILIKE ${pattern} OR f."complications" ILIKE ${pattern}))
       OR EXISTS (SELECT 1 FROM "PatientJourney" j WHERE j."patientId" = p."id" AND j."clinicId" = ${clinicId} AND j."archivedAt" IS NULL AND (j."name" ILIKE ${pattern} OR j."professional" ILIKE ${pattern} OR j."status" ILIKE ${pattern}))
       OR EXISTS (SELECT 1 FROM "ClinicalDocument" d WHERE d."patientId" = p."id" AND d."clinicId" = ${clinicId} AND d."archivedAt" IS NULL AND (d."name" ILIKE ${pattern} OR d."originalName" ILIKE ${pattern} OR d."category" ILIKE ${pattern}))
       OR EXISTS (SELECT 1 FROM "ClinicalPhoto" c WHERE c."patientId" = p."id" AND c."clinicId" = ${clinicId} AND c."archivedAt" IS NULL AND (c."name" ILIKE ${pattern} OR c."category" ILIKE ${pattern} OR c."phase" ILIKE ${pattern}))
     ) ORDER BY p."name" LIMIT ${resultLimit})`);

  if (!matches.length) return NextResponse.json({ results: [] satisfies SearchResult[] });

  try {
    const results = await prisma.$queryRaw<SearchResult[]>(Prisma.sql`
      SELECT "id", "title", "description", "section", "kind"
      FROM (${Prisma.join(matches, " UNION ALL ")}) AS search_matches
      LIMIT 30
    `);
    return NextResponse.json({ results, partial: false });
  } catch {
    return NextResponse.json({ results: [] satisfies SearchResult[], partial: true });
  }
}
