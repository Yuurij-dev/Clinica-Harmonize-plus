import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { completeLogin } from "@/lib/auth-session";
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

  // Conta nova de convite: sem trusted device/TOTP ainda, então o login pode pedir o código por e-mail.
  const login = await completeLogin({ request, userId: result.userId, origin: "password" });
  if (!login.ok) return NextResponse.json({ message: login.message }, { status: login.status });
  const response = NextResponse.json({
    ok: true,
    alreadyInOtherClinic: result.alreadyInOtherClinic,
    ...(login.mfaRequired ? { mfaRequired: true, method: login.method } : {}),
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
  login.apply(response);
  return response;
}
