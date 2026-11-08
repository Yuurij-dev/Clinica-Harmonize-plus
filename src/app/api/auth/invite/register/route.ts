import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { createSession, sessionCookieName } from "@/lib/auth";
import { registerByInvite } from "@/lib/invitations";
import { prismaInvitationRepo } from "@/lib/invitations-db";

// Publico: cria a conta do convidado (e-mail vem do convite) e aceita o convite na mesma transacao.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { token?: unknown; name?: unknown; password?: unknown; cpf?: unknown; postalCode?: unknown; address?: unknown; country?: unknown; state?: unknown; city?: unknown } | null;
  const result = await registerByInvite(prismaInvitationRepo, {
    token: body?.token, name: body?.name, password: body?.password,
    cpf: body?.cpf, postalCode: body?.postalCode, address: body?.address, country: body?.country, state: body?.state, city: body?.city,
    hashPassword: (password) => hash(password, 12),
  });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status, headers: { "Cache-Control": "no-store" } });

  // Mesmos atributos de cookie do login por senha.
  const response = NextResponse.json({ ok: true, alreadyInOtherClinic: result.alreadyInOtherClinic }, { status: 201, headers: { "Cache-Control": "no-store" } });
  response.cookies.set({
    name: sessionCookieName,
    value: await createSession(result.userId),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}
