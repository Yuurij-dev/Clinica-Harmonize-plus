import { after, NextResponse } from "next/server";
import { processPasswordResetRequest } from "@/lib/password-reset-flow";
import { RESET_REQUEST_IP_LIMIT, normalizeResetEmail } from "@/lib/password-reset-rules";
import { passwordResetDeps, readResetRequest, resetError, resetHeaders } from "@/lib/password-reset-server";

// Pedido de link de redefinição. A resposta é SEMPRE a mesma (e-mail existente ou não, só-Google, limitado ou com falha no
// provedor): tudo o que depende da conta roda depois dela, em after().
export async function POST(request: Request) {
  try {
    const deps = passwordResetDeps();
    const guard = await readResetRequest(request, RESET_REQUEST_IP_LIMIT, deps);
    if (guard.error) return guard.error;
    const email = normalizeResetEmail(guard.body?.email);
    if (!email) return resetError("Informe um e-mail válido.", 400, { code: "invalid_email" });
    const { ip } = guard;
    after(() => processPasswordResetRequest(email, ip, deps));
    return NextResponse.json({ ok: true }, { headers: resetHeaders });
  } catch (error) {
    console.error("[password-reset-request]", (error as { code?: unknown } | null)?.code);
    return resetError("Não foi possível processar o pedido agora. Tente novamente.", 503);
  }
}
