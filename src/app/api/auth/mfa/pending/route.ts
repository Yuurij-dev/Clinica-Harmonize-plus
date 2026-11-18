import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { mfaCookieName, verifyMfaPendingToken } from "@/lib/auth-session";

const noStore = { "Cache-Control": "no-store" };

// GET leve para o retorno do login com Google (redirect, sem corpo): a tela de verificação lê o método
// pendente (TOTP ou e-mail) a partir do cookie harmonize_mfa assinado, nunca do corpo/query.
export async function GET() {
  const pending = await verifyMfaPendingToken((await cookies()).get(mfaCookieName)?.value);
  if (!pending) {
    return NextResponse.json({ message: "A verificação expirou. Entre novamente.", code: "mfa_expired" }, { status: 401, headers: noStore });
  }
  return NextResponse.json({ method: pending.method }, { headers: noStore });
}
