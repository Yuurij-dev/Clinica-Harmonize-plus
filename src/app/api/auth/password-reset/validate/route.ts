import { NextResponse } from "next/server";
import { isValidResetToken } from "@/lib/password-reset-flow";
import { RESET_TOKEN_IP_LIMIT } from "@/lib/password-reset-rules";
import { passwordResetDeps, readResetRequest, resetError, resetHeaders } from "@/lib/password-reset-server";

// Confere o link ao abrir a tela, sem consumir. POST para o token nunca ir na URL.
export async function POST(request: Request) {
  try {
    const deps = passwordResetDeps();
    const guard = await readResetRequest(request, RESET_TOKEN_IP_LIMIT, deps);
    if (guard.error) return guard.error;
    return NextResponse.json({ valid: await isValidResetToken(guard.body?.token, deps) }, { headers: resetHeaders });
  } catch (error) {
    console.error("[password-reset-validate]", (error as { code?: unknown } | null)?.code);
    return resetError("Não foi possível conferir o link agora. Tente novamente.", 503);
  }
}
