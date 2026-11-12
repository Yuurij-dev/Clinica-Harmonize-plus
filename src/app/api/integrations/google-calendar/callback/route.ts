import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAuthSecret } from "@/lib/auth-secret";
import { afterCalendarConnected, drainCalendarJobs } from "@/lib/calendar-runtime";
import { createCalendarClient, createIdTokenVerifier, getCalendarConfig } from "@/lib/google-calendar-config";
import { CALENDAR_FLOW_COOKIE, calendarOutcomeRedirect, handleCalendarCallback } from "@/lib/google-calendar-oauth-service";
import { GOOGLE_CALENDAR_FLOW_COOKIE_PATH } from "@/lib/google-calendar-rules";
import { prisma } from "@/lib/prisma";

// Callback do consentimento do Google Agenda. Destino sempre fixo (/configuracoes?gcal=codigo): sem tokens, code ou returnTo na URL.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const flowToken = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CALENDAR_FLOW_COOKIE}=`))?.slice(CALENDAR_FLOW_COOKIE.length + 1) ?? null;
  const config = getCalendarConfig();

  let redirect = calendarOutcomeRedirect("error");
  let backfilledClinic: string | null = null;
  if (config) {
    try {
      const result = await handleCalendarCallback({
        config,
        secret: getAuthSecret(),
        now: () => new Date(),
        db: prisma,
        client: createCalendarClient(config),
        verifyIdToken: createIdTokenVerifier(config),
        getSessionUser: async () => {
          // Mesma regra de connect/sync: trial vencido não conecta (sessão nula => redirect de erro).
          const user = await getCurrentUser({ requireActiveTrial: true });
          return user ? { id: user.id, clinicId: user.clinicId, role: user.role, isOwner: user.isOwner, rolePermissions: user.rolePermissions } : null;
        },
        enqueueBackfill: async ({ clinicId, connectionType, userId }) => {
          await afterCalendarConnected({ clinicId, ...(connectionType === "PROFESSIONAL" ? { userId } : {}) });
          backfilledClinic = clinicId;
        },
        env: process.env,
      }, {
        error: url.searchParams.get("error"),
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
        flowToken,
      });
      redirect = result.redirect;
    } catch {
      console.warn("[google-calendar-oauth]", "callback_failed");
    }
  } else {
    redirect = calendarOutcomeRedirect("unavailable");
  }
  if (backfilledClinic) {
    const clinicId: string = backfilledClinic;
    try {
      after(() => drainCalendarJobs({ clinicId, limit: 20, budgetMs: 20_000 }));
    } catch {
      // o cron recupera
    }
  }
  // Nunca deriva o host do cabeçalho Host: sem origem configurada, redireciona para o caminho relativo fixo.
  const response = new NextResponse(null, { status: 302, headers: { Location: config?.appOrigin ? new URL(redirect, config.appOrigin).toString() : redirect, "Cache-Control": "no-store" } });
  // Cookie de fluxo é de uso único: apagado em qualquer desfecho.
  response.cookies.set({ name: CALENDAR_FLOW_COOKIE, value: "", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0, path: GOOGLE_CALENDAR_FLOW_COOKIE_PATH });
  return response;
}
