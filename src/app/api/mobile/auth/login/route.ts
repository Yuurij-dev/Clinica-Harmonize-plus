import { decodeJwt } from "jose";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { authenticateLogin } from "@/lib/login";

// Token do app dura 3 dias (a web, 7). Não há revogação antes do vencimento (nem na troca de senha); a mitigação é o TTL curto.
// Revogar de verdade exigiria tokenVersion/passwordChangedAt no schema (backlog).
const tokenTtl = "3d";
const noStore = { "Cache-Control": "no-store" };

// Login do app: mesma validação da web, mas devolve o JWT no corpo (sem cookie). Só equipe clínica; troca de senha inicial é feita na web.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { login?: string; password?: string } | null;
  const result = await authenticateLogin(body?.login, body?.password);
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status, headers: noStore });

  const { user, role, clinic } = result;
  if (user.mustChangePassword) {
    return NextResponse.json({ passwordChangeRequired: true, message: "Defina uma nova senha pelo sistema web antes de usar o app." }, { status: 403, headers: noStore });
  }
  if (role === "STAFF") return NextResponse.json({ message: "O app é para a equipe clínica." }, { status: 403, headers: noStore });

  const token = await createSession(user.id, tokenTtl);
  const exp = decodeJwt(token).exp;
  return NextResponse.json({
    token,
    expiresAt: new Date((exp ?? Math.floor(Date.now() / 1000) + 3 * 86_400) * 1000).toISOString(),
    user: { id: user.id, name: user.name, email: user.email, role, clinic: { id: clinic.id, name: clinic.name, trialEndsAt: clinic.trialEndsAt } },
  }, { headers: noStore });
}
