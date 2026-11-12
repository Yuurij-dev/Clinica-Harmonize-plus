import { NextResponse } from "next/server";
import { CRON_LIMIT, drainCalendarJobs } from "@/lib/calendar-runtime";
import { purgeOldJobs } from "@/lib/calendar-sync-queue";
import { checkCronAuth } from "@/lib/cron-auth";
import { getCalendarConfig } from "@/lib/google-calendar-config";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

// Cron (Vercel: Authorization: Bearer CRON_SECRET). Processa a fila de sincronização de todas as clínicas. Nunca pública.
async function run(request: Request) {
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "unconfigured") return NextResponse.json({ message: "Cron não configurado." }, { status: 503, headers: noStore });
  if (auth === "unauthorized") return NextResponse.json({ message: "Não autorizado." }, { status: 401, headers: noStore });
  if (!getCalendarConfig()) return NextResponse.json({ ok: true, configured: false }, { headers: noStore });
  const summary = await drainCalendarJobs({ limit: CRON_LIMIT, budgetMs: 45_000 });
  const purged = await purgeOldJobs(prisma).catch(() => 0);
  return NextResponse.json({ ok: true, configured: true, summary, purged }, { headers: noStore });
}

export const GET = run;
export const POST = run;
