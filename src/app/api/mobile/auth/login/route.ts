import { NextResponse } from "next/server";
import { createTrustedDevice, findTrustedDevice, getMfaState, issueSession, MOBILE_SESSION_TTL_SECONDS, recordMfaOutcome, recordSecurityEvent } from "@/lib/auth-session";
import { authenticateLogin } from "@/lib/login";
import { classifyMfaCode } from "@/lib/mfa-input";
import { MFA_GENERIC_ERROR, MFA_LOCKED_ERROR, verifyMfaCode } from "@/lib/mfa-verify";

// Token do app dura 3 dias (a web, 7) e agora tem sid (AuthSession): revogável em Configurações > Segurança,
// por troca de senha e ao ativar/desativar 2FA.
const noStore = { "Cache-Control": "no-store" };

// Login do app: mesma validação da web, mas devolve o JWT no corpo (sem cookie). Só equipe clínica; troca de senha inicial é feita na web.
// Com 2FA ativo exige `mfaCode` (TOTP de 6 dígitos ou código de recuperação), com o mesmo bloqueio/replay da web.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { login?: string; password?: string; mfaCode?: unknown; trustDevice?: unknown } | null;
  const result = await authenticateLogin(body?.login, body?.password);
  if (!result.ok) {
    if (result.failedUserId) await recordSecurityEvent({ userId: result.failedUserId, type: "LOGIN_FAILED", success: false, request });
    return NextResponse.json({ message: result.message }, { status: result.status, headers: noStore });
  }

  const { user, role, clinic } = result;
  if (user.mustChangePassword) {
    return NextResponse.json({ passwordChangeRequired: true, message: "Defina uma nova senha pelo sistema web antes de usar o app." }, { status: 403, headers: noStore });
  }
  if (role === "STAFF") return NextResponse.json({ message: "O app é para a equipe clínica." }, { status: 403, headers: noStore });

  const mfa = await getMfaState(user.id);
  if (mfa.required && !mfa.active) {
    return NextResponse.json({ mfaSetupRequired: true, message: "Ative a verificação em duas etapas pelo sistema web antes de usar o app." }, { status: 403, headers: noStore });
  }
  const presentedDeviceToken = request.headers.get("x-harmonize-trusted-device");
  const recognizedDevice = mfa.active ? await findTrustedDevice(user.id, presentedDeviceToken) : null;
  const trustedDeviceInvalid = Boolean(presentedDeviceToken && !recognizedDevice);
  let trustedDevice = null as Awaited<ReturnType<typeof createTrustedDevice>> | null;
  if (mfa.active) {
    if (!recognizedDevice) {
      const input = classifyMfaCode(body?.mfaCode);
      if (!input.code && !input.recoveryCode) {
        return NextResponse.json({ mfaRequired: true, ...(trustedDeviceInvalid ? { trustedDeviceInvalid: true } : {}), message: "Informe o código de verificação." }, { status: 401, headers: noStore });
      }
      const verified = await verifyMfaCode(user.id, input);
      await recordMfaOutcome(user.id, request, verified);
      if (!verified.ok) {
        return verified.locked
          ? NextResponse.json({ mfaRequired: true, ...(trustedDeviceInvalid ? { trustedDeviceInvalid: true } : {}), message: MFA_LOCKED_ERROR }, { status: 429, headers: noStore })
          : NextResponse.json({ mfaRequired: true, ...(trustedDeviceInvalid ? { trustedDeviceInvalid: true } : {}), message: MFA_GENERIC_ERROR }, { status: 401, headers: noStore });
      }
      // Código de recuperação nunca cria confiança; seu uso também revoga as credenciais anteriores.
      if (body?.trustDevice === true && verified.method === "totp") trustedDevice = await createTrustedDevice(user.id, request);
      if (trustedDevice) await recordSecurityEvent({ userId: user.id, type: "TRUSTED_DEVICE_ADDED", request });
    }
  }

  const trustedDeviceId = recognizedDevice?.id ?? trustedDevice?.id ?? null;
  const { token, expiresAt } = await issueSession({ userId: user.id, request, ttlSeconds: MOBILE_SESSION_TTL_SECONDS, trustedDeviceId });
  await recordSecurityEvent({ userId: user.id, type: "LOGIN", request, detail: recognizedDevice ? "App mobile (dispositivo confiável)" : "App mobile" });
  return NextResponse.json({
    token,
    expiresAt: expiresAt.toISOString(),
    trustedDeviceUsed: Boolean(recognizedDevice),
    ...(recognizedDevice ? { trustedDeviceExpiresAt: recognizedDevice.expiresAt.toISOString() } : {}),
    ...(trustedDevice ? { trustedDeviceToken: trustedDevice.token, trustedDeviceExpiresAt: trustedDevice.expiresAt.toISOString() } : {}),
    ...(trustedDeviceInvalid ? { trustedDeviceInvalid: true } : {}),
    user: { id: user.id, name: user.name, email: user.email, role, clinic: { id: clinic.id, name: clinic.name, trialEndsAt: clinic.trialEndsAt } },
  }, { headers: noStore });
}
