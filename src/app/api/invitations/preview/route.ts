import { NextResponse } from "next/server";
import { previewInvitation } from "@/lib/invitations";
import { prismaInvitationRepo } from "@/lib/invitations-db";

// Publico (sem sessao). Sempre 200: token inexistente e invalido tem a mesma resposta.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const invitation = await previewInvitation(prismaInvitationRepo, token);
  return NextResponse.json({ invitation }, { headers: { "Cache-Control": "no-store" } });
}
