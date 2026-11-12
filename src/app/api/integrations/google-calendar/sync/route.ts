import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { backfillCalendar, drainCalendarJobs } from "@/lib/calendar-runtime";
import { clinicHasActiveConnection } from "@/lib/calendar-sync-queue";
import { getCalendarConfig } from "@/lib/google-calendar-config";
import { canConnectCalendar } from "@/lib/google-calendar-oauth-service";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/same-origin";

export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

// "Sincronizar agora": ADMIN enfileira o backfill da clínica; PROFESSIONAL só os próprios agendamentos. Depois drena parte da fila.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: "Origem da requisição não permitida." }, { status: 403, headers: noStore });
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401, headers: noStore });
  const actor = { id: user.id, clinicId: user.clinicId, role: user.role, isOwner: user.isOwner, rolePermissions: user.rolePermissions };
  const clinicWide = canConnectCalendar(actor, "ADMIN");
  if (!clinicWide && !canConnectCalendar(actor, "PROFESSIONAL")) return NextResponse.json({ message: "Seu cargo não tem permissão para esta ação." }, { status: 403, headers: noStore });
  if (!getCalendarConfig()) return NextResponse.json({ message: "A integração com o Google Agenda não está configurada.", configured: false }, { status: 503, headers: noStore });

  if (!clinicWide) {
    const own = await prisma.googleCalendarConnection.count({ where: { clinicId: user.clinicId, userId: user.id, connectionType: "PROFESSIONAL", status: "CONNECTED" } });
    if (!own) return NextResponse.json({ message: "Conecte sua agenda do Google antes de sincronizar." }, { status: 409, headers: noStore });
  } else if (!(await clinicHasActiveConnection(prisma, user.clinicId))) {
    return NextResponse.json({ message: "Conecte uma agenda do Google antes de sincronizar." }, { status: 409, headers: noStore });
  }

  const backfill = await backfillCalendar({ clinicId: user.clinicId, ...(clinicWide ? {} : { userId: user.id }) });
  const processed = await drainCalendarJobs({ clinicId: user.clinicId, limit: 15, budgetMs: 15_000 });
  try {
    after(() => drainCalendarJobs({ clinicId: user.clinicId, limit: 50, budgetMs: 30_000 }));
  } catch {
    // o cron recupera o restante
  }
  return NextResponse.json({ ok: true, enqueued: backfill.enqueued, processed: clinicWide && processed ? { completed: processed.completed, retried: processed.retried, failed: processed.failed } : null }, { headers: noStore });
}
