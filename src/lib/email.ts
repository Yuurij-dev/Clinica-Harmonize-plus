// Envio de e-mail via Resend (fetch, sem dependencia). NUNCA logar token, URL do convite, corpo do e-mail,
// e-mail do destinatario, chave nem a resposta bruta do provedor: o unico log permitido e um codigo estavel de lista fechada.

import { composeEmail, heading, paragraph, button, note, escapeHtml } from "./email-layout.ts";

export { escapeHtml };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8_000;

type Env = Record<string, string | undefined>;

export type EmailFailureReason =
  | "not_configured"
  | "no_site_url"
  | "unverified_domain_or_test_recipient"
  | "invalid_api_key"
  | "invalid_from"
  | "rate_limited"
  | "timeout"
  | "network"
  | "provider_error";

// content = base64 (nunca logar).
export type EmailAttachment = { filename: string; content: string };

export type EmailResult = { sent: true } | { sent: false; reason: EmailFailureReason };

// Mapeia a falha do Resend para um codigo estavel a partir do status HTTP e do campo `name` da resposta
// (nada mais da resposta e lido ou propagado). Mapeamento desconhecido => provider_error.
export function mapProviderFailure(status: number, name: unknown): EmailFailureReason {
  const n = typeof name === "string" ? name : "";
  if (status === 429 || ["rate_limit_exceeded", "daily_quota_exceeded", "monthly_quota_exceeded"].includes(n)) return "rate_limited";
  if (["invalid_api_key", "restricted_api_key", "missing_api_key"].includes(n) || status === 401) return "invalid_api_key";
  if (n === "invalid_from_address") return "invalid_from";
  // Dominio nao verificado / modo de teste (so entrega para o e-mail da conta): 403 validation_error.
  if (status === 403 && n === "validation_error") return "unverified_domain_or_test_recipient";
  return "provider_error";
}

const STABLE_CODE = /^[A-Za-z0-9_]{1,40}$/;
function logFailure(reason: string) {
  console.warn("[email]", STABLE_CODE.test(reason) ? reason : "unknown");
}

// Le so o campo `name` de um corpo JSON pequeno (limite de 4 KB; corpo hostil, enorme ou sem JSON => undefined).
async function readErrorName(response: Response): Promise<unknown> {
  try {
    const reader = response.body?.getReader();
    if (!reader) return undefined;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 4096) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});
    const text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    const parsed = JSON.parse(text) as { name?: unknown } | null;
    return parsed && typeof parsed === "object" ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

// Link publico do convite. Producao sem NEXT_PUBLIC_SITE_URL => null (nao deriva do header Host).
export function buildInviteUrl(token: string, env: Env = process.env): string | null {
  const site = env.NEXT_PUBLIC_SITE_URL?.trim() || (env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!site) return null;
  try {
    return `${new URL(site).origin}/convite/${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

// Em producao, convite sem entrega por e-mail nao pode existir (a URL nunca e devolvida ao admin).
export function isInviteDeliveryReady(env: Env = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim() && env.NEXT_PUBLIC_SITE_URL?.trim());
}

// A URL so pode ser devolvida ao admin fora de producao (teste sem provedor).
export function canRevealInviteUrl(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production";
}

export function isEmailDeliveryReady(env: Env = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

// Nucleo generico de envio: nunca lanca e so loga um codigo estavel (sem destinatario, corpo, chave ou resposta do provedor).
export async function sendEmail(
  input: { to: string; subject: string; html: string; text: string; attachments?: EmailAttachment[] },
  deps: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<EmailResult> {
  const env = deps.env ?? process.env;
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };
  try {
    const response = await (deps.fetchImpl ?? fetch)(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html, text: input.text, ...(input.attachments?.length ? { attachments: input.attachments } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.ok) return { sent: true };
    const reason = mapProviderFailure(response.status, await readErrorName(response));
    logFailure(reason);
    return { sent: false, reason };
  } catch (error) {
    const timedOut = (error as { name?: unknown } | null)?.name === "TimeoutError" || (error as { name?: unknown } | null)?.name === "AbortError";
    const reason: EmailFailureReason = timedOut ? "timeout" : "network";
    logFailure(reason);
    return { sent: false, reason };
  }
}

const roleLabels: Record<string, string> = { PROFESSIONAL: "profissional", STAFF: "recepção/apoio" };

export async function sendInvitationEmail(
  input: { to: string; clinicName: string; inviterName: string; role: string; url: string | null },
  deps: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<EmailResult> {
  const env = deps.env ?? process.env;
  if (!isEmailDeliveryReady(env)) return { sent: false, reason: "not_configured" };
  if (!input.url) return { sent: false, reason: "no_site_url" };

  const role = roleLabels[input.role] ?? "equipe";
  const body = composeEmail({
    preheader: `${input.inviterName} convidou você para a clínica ${input.clinicName}.`,
    blocks: [
      heading("Você recebeu um convite"),
      paragraph(`${input.inviterName} convidou você para entrar na clínica ${input.clinicName} como ${role} no Harmonize+.`),
      button(input.url, "Aceitar convite"),
      note("Ou copie e cole este link no navegador:"),
      note(input.url),
      note("O convite vale por 7 dias. Se você não esperava este e-mail, pode ignorá-lo."),
    ],
  });
  return sendEmail({ to: input.to, subject: `${input.inviterName} convidou você para a clínica ${input.clinicName}`, html: body.html, text: body.text }, deps);
}
