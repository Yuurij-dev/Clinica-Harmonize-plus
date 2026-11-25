import { after, NextResponse } from "next/server";
import { invalidateUserAuthCache } from "@/lib/auth";
import { recordSecurityEvent } from "@/lib/auth-session";
import { confirmPasswordReset, notifyPasswordChanged } from "@/lib/password-reset-flow";
import { RESET_TOKEN_IP_LIMIT } from "@/lib/password-reset-rules";
import { passwordResetDeps, readResetRequest, resetError, resetHeaders } from "@/lib/password-reset-server";

// Define a nova senha com o token do e-mail. Encerra sessões e dispositivos confiáveis, mantém o 2FA e não abre sessão.
export async function POST(request: Request) {
  try {
    const deps = passwordResetDeps();
    const guard = await readResetRequest(request, RESET_TOKEN_IP_LIMIT, deps);
    if (guard.error) return guard.error;
    const result = await confirmPasswordReset(guard.body, deps);
    if (!result.ok) {
      return resetError(result.message, 400, { code: result.code, ...(result.code === "invalid_password" ? { field: result.field } : {}) });
    }
    invalidateUserAuthCache(result.userId);
    await recordSecurityEvent({ userId: result.userId, type: "PASSWORD_RESET", request, detail: `${result.sessions} sessão(ões) e ${result.devices} dispositivo(s) confiável(is) encerrados` });
    after(() => notifyPasswordChanged(result.email, deps));
    return NextResponse.json({ success: true }, { headers: resetHeaders });
  } catch (error) {
    console.error("[password-reset-confirm]", (error as { code?: unknown } | null)?.code);
    return resetError("Não foi possível redefinir a senha agora. Tente novamente.", 500);
  }
}
