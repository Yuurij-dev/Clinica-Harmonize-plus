// Tipos do historico de seguranca. Nunca gravar senha, token, codigo TOTP ou de recuperacao no `detail`.

export const SECURITY_EVENT_TYPES = [
  "LOGIN",
  "LOGIN_GOOGLE",
  "LOGIN_FAILED",
  "MFA_VERIFIED",
  "MFA_FAILED",
  "MFA_ENABLED",
  "MFA_DISABLED",
  "RECOVERY_CODE_USED",
  "RECOVERY_CODES_REGENERATED",
  "TRUSTED_DEVICE_ADDED",
  "TRUSTED_DEVICE_REMOVED",
  "SESSION_REVOKED",
  "PASSWORD_CHANGED",
  "ACCOUNT_RECOVERY",
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const SECURITY_EVENT_DETAIL_MAX = 200;

export function isSecurityEventType(value: unknown): value is SecurityEventType {
  return typeof value === "string" && (SECURITY_EVENT_TYPES as readonly string[]).includes(value);
}

export function clampEventDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  return detail.slice(0, SECURITY_EVENT_DETAIL_MAX);
}

/** Mascara para exibir: IPv4 `187.12.xxx.xxx`; IPv6 mantem os 2 primeiros grupos. */
export function maskIp(ip: string | null | undefined): string {
  const value = String(ip ?? "").trim();
  if (!value) return "—";
  const v4 = value.replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const [a, b] = v4.split(".");
    return `${a}.${b}.xxx.xxx`;
  }
  if (value.includes(":")) {
    const groups = value.split(":").filter(Boolean);
    return `${groups.slice(0, 2).join(":")}:xxxx:xxxx`;
  }
  return "—";
}
