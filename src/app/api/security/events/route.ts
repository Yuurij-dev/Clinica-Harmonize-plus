import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStore, requireSecurityUser } from "@/lib/security-api";
import { maskIp } from "@/lib/security-events";
import { deviceLabel } from "@/lib/user-agent";

const defaultLimit = 20;
const maxLimit = 50;

// Histórico de segurança do próprio usuário, mais recentes primeiro. Cursor = id do último evento; só leitura (sem edição/exclusão).
// Política de IP (LGPD): o IP completo fica só no banco; a API devolve ipMasked.
export async function GET(request: Request) {
  const { user, error } = await requireSecurityUser(request);
  if (error) return error;
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, maxLimit) : defaultLimit;
  const cursor = url.searchParams.get("cursor");

  const rows = await prisma.securityEvent.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor && cursor.length <= 40 && !cursor.includes(String.fromCharCode(0)) ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, type: true, success: true, createdAt: true, ip: true, userAgent: true, detail: true },
  });
  const page = rows.slice(0, limit);
  return NextResponse.json({
    events: page.map((event) => ({
      id: event.id,
      type: event.type,
      success: event.success,
      createdAt: event.createdAt,
      ipMasked: maskIp(event.ip),
      device: event.userAgent ? deviceLabel(event.userAgent) : null,
      detail: event.detail,
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  }, { headers: noStore });
}
