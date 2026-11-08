import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { acceptInvitation } from "@/lib/invitations";
import { prismaInvitationRepo } from "@/lib/invitations-db";

const noStore = { "Cache-Control": "no-store" };

// Exige sessao. Usuario vem da SESSAO; o corpo so traz o token. Motivos exatos nao sao expostos.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401, headers: noStore });
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  let result;
  try {
    result = await acceptInvitation(prismaInvitationRepo, { token: body?.token, user: { id: user.id, email: user.email } });
  } catch (error) {
    // P2002 aqui e corrida na criacao da membership (nao um convite ja usado): mensagem neutra.
    if ((error as { code?: string } | null)?.code === "P2002") {
      return NextResponse.json({ message: "Não foi possível aceitar o convite agora. Tente novamente." }, { status: 409, headers: noStore });
    }
    throw error;
  }
  if (!result.ok) {
    if (result.code === "accepted") return NextResponse.json({ message: "Este convite já foi utilizado." }, { status: 409, headers: noStore });
    return NextResponse.json({ message: "Este convite não é válido para a sua conta." }, { status: 404, headers: noStore });
  }
  return NextResponse.json({ ok: true, alreadyInOtherClinic: result.alreadyInOtherClinic }, { headers: noStore });
}
