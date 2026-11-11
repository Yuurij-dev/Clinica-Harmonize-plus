// Regras puras da interface de segurança (campo de código, rótulos do histórico, arquivo de códigos de recuperação).
import type { SecurityEventType } from "./security-events.ts";

export const OTP_LENGTH = 6;
/** A partir de quantos códigos de recuperação restantes o login avisa para gerar novos. */
export const LOW_RECOVERY_CODES = 3;

export function emptyOtp(length = OTP_LENGTH): string[] {
  return Array.from({ length }, () => "");
}

/** Só dígitos, no máximo `length` (colar "123 456" ou "123-456" funciona). */
export function otpDigits(raw: string, length = OTP_LENGTH): string {
  return raw.replace(/\D/g, "").slice(0, length);
}

/**
 * Digitar ou colar em uma célula do campo de código: distribui os dígitos a partir dela e devolve a célula a focar.
 * Vazio apaga a célula. Colar o código completo preenche tudo a partir da primeira célula.
 */
export function otpInsert(cells: string[], index: number, raw: string, length = OTP_LENGTH): { cells: string[]; focus: number } {
  const next = emptyOtp(length).map((_, position) => cells[position] ?? "");
  let digits = raw.replace(/\D/g, "");
  if (!digits) {
    next[index] = "";
    return { cells: next, focus: index };
  }
  // Digitar numa célula já preenchida (sem selecionar): descarta o dígito antigo e mantém o novo.
  if (digits.length === 2 && next[index] && digits.includes(next[index])) digits = digits.replace(next[index], "");
  let position = digits.length >= length ? 0 : index;
  for (const digit of digits.slice(0, length)) {
    if (position >= length) break;
    next[position] = digit;
    position += 1;
  }
  return { cells: next, focus: Math.min(position, length - 1) };
}

/** Código de recuperação digitado: minúsculo, sem espaços e com o hífen depois do 5º caractere. */
export function formatRecoveryInput(raw: string): string {
  const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return clean.length > 5 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
}

export function isRecoveryInputComplete(value: string): boolean {
  return /^[a-z0-9]{5}-[a-z0-9]{5}$/.test(value);
}

export function recoveryCodesFileText(codes: readonly string[], now: Date = new Date()): string {
  return [
    "Harmonize+ - códigos de recuperação",
    `Gerados em ${now.toLocaleString("pt-BR")}`,
    "",
    "Cada código vale uma única vez. Guarde este arquivo em local seguro.",
    "",
    ...codes,
    "",
  ].join("\n");
}

export function isLowOnRecoveryCodes(remaining: number): boolean {
  return remaining <= LOW_RECOVERY_CODES;
}

export const SECURITY_EVENT_LABELS: Record<SecurityEventType, string> = {
  LOGIN: "Login realizado",
  LOGIN_GOOGLE: "Login com Google",
  LOGIN_FAILED: "Tentativa de login falhou",
  MFA_VERIFIED: "Verificação em duas etapas concluída",
  MFA_FAILED: "Código de verificação inválido",
  MFA_ENABLED: "Verificação em duas etapas ativada",
  MFA_DISABLED: "Verificação em duas etapas desativada",
  RECOVERY_CODE_USED: "Código de recuperação utilizado",
  RECOVERY_CODES_REGENERATED: "Novos códigos de recuperação gerados",
  TRUSTED_DEVICE_ADDED: "Dispositivo confiável adicionado",
  TRUSTED_DEVICE_REMOVED: "Dispositivo confiável removido",
  SESSION_REVOKED: "Sessão encerrada",
  PASSWORD_CHANGED: "Senha alterada",
  ACCOUNT_RECOVERY: "Recuperação de conta",
};

export function securityEventLabel(type: string): string {
  return Object.hasOwn(SECURITY_EVENT_LABELS, type) ? SECURITY_EVENT_LABELS[type as SecurityEventType] : "Evento de segurança";
}

/**
 * SVG do QR como data URL para uso em <img> (o navegador não executa script nem carrega recursos de um SVG assim).
 * Recusa qualquer coisa que não seja um <svg> simples; nesse caso a tela mostra só a chave manual.
 */
export function qrSvgDataUrl(svg: unknown): string | null {
  if (typeof svg !== "string" || svg.length > 200_000) return null;
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) return null;
  if (/<script|<foreignObject|<iframe|<image|\son\w+\s*=|javascript:/i.test(svg)) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
