// Regras puras do Google Agenda: escopos, URL de autorização, redirect URI, id determinístico de evento,
// payload do evento e diff de estado. Sem Prisma, sem rede. Nunca logar code, tokens, verifier ou state.
import { createHash } from "node:crypto";
import { appointmentRange, appointmentDurationMinutes, cleanProfessionalName, professionalKey } from "./appointment-conflict-rules.ts";
import { clinicTimeZone } from "./clinic-time.ts";
import { GOOGLE_AUTH_ENDPOINT } from "./google-oauth-rules.ts";

export const GOOGLE_CALENDAR_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"] as const;
export const GOOGLE_CALENDAR_SCOPE = GOOGLE_CALENDAR_SCOPES.join(" ");
export const GOOGLE_CALENDAR_CALLBACK_PATH = "/api/integrations/google-calendar/callback";
export const GOOGLE_CALENDAR_FLOW_COOKIE_PATH = "/api/integrations/google-calendar";
export const GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID = "primary";
export const DEFAULT_EVENT_MINUTES = 60;
export const MAX_EVENT_MINUTES = 24 * 60;

export type CalendarConnectionType = "ADMIN" | "PROFESSIONAL";
export type CalendarConnectionStatus = "CONNECTED" | "DISCONNECTED" | "ERROR";

export function parseConnectionType(value: unknown): CalendarConnectionType | null {
  return value === "ADMIN" || value === "PROFESSIONAL" ? value : null;
}

type Env = Record<string, string | undefined>;

/** O scope concedido contém o necessário para criar/editar eventos? (o usuário pode desmarcar escopos na tela do Google) */
export function hasCalendarScope(grantedScope: string | null | undefined) {
  return (grantedScope ?? "").split(/\s+/).includes("https://www.googleapis.com/auth/calendar.events");
}

/** GOOGLE_CALENDAR_REDIRECT_URI (https; http só fora de produção) ou origin de NEXT_PUBLIC_SITE_URL + callback. Nunca do header Host. */
export function resolveCalendarRedirectUri(env: Env = process.env): string | null {
  const explicit = env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      // Produção só aceita https; http (loopback) só fora de produção.
      if (url.protocol === "https:") return url.toString();
      return url.protocol === "http:" && env.NODE_ENV !== "production" ? url.toString() : null;
    } catch {
      return null;
    }
  }
  const site = env.NEXT_PUBLIC_SITE_URL?.trim() || (env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!site) return null;
  try {
    return `${new URL(site).origin}${GOOGLE_CALENDAR_CALLBACK_PATH}`;
  } catch {
    return null;
  }
}

/** Origem pública do app (links nos eventos/e-mails). */
export function resolveAppOrigin(env: Env = process.env): string | null {
  const site = env.NEXT_PUBLIC_SITE_URL?.trim() || (env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!site) return null;
  try {
    return new URL(site).origin;
  } catch {
    return null;
  }
}

export function appointmentLink(origin: string | null) {
  return origin ? `${origin}/agenda` : null;
}

export function buildCalendarAuthUrl(input: { clientId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string; loginHint?: string }) {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

// ---------- id determinístico de evento ----------

const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

function base32hex(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return out;
}

/** Id aceito pelo Google (base32hex minúsculo, 5–1024 chars): igual para o mesmo (conexão, agendamento), sempre. */
export function calendarEventId(connectionId: string, appointmentId: string) {
  return base32hex(createHash("sha256").update(`harmonize:${connectionId}:${appointmentId}`).digest());
}

export function isValidGoogleEventId(id: unknown) {
  return typeof id === "string" && id.length >= 5 && id.length <= 1024 && /^[a-v0-9]+$/.test(id);
}

// ---------- e-mail ----------

const EMAIL_PATTERN = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]{2,}$/;

export function normalizeCalendarEmail(email: string | null | undefined) {
  return (email ?? "").trim().toLowerCase();
}

export function isValidCalendarEmail(email: string | null | undefined) {
  const value = normalizeCalendarEmail(email);
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

// ---------- duração ----------

/** Duração do procedimento (por nome, sem caixa/espaços extras) no catálogo da clínica; fallback 60 min. */
export function eventDurationMinutes(procedureName: string, procedures: Array<{ name: string; durationMinutes: number | null }>) {
  const wanted = procedureName.trim().replace(/\s+/g, " ");
  const match = procedures.find((item) => item.name === wanted) ?? procedures.find((item) => item.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR") === wanted.toLocaleLowerCase("pt-BR"));
  return Math.min(appointmentDurationMinutes(match?.durationMinutes), MAX_EVENT_MINUTES);
}

// ---------- payload ----------

export type CalendarAppointmentState = {
  status: string;
  day: string; // YYYY-MM-DD no fuso da clínica
  time: string; // HH:mm
  procedure: string;
  professional: string;
  durationMinutes: number;
};

export type CalendarEventInput = CalendarAppointmentState & {
  appointmentId: string;
  clinicId: string;
  patientName: string;
  attendeeEmail?: string | null;
  link?: string | null;
};

export type GoogleEventPayload = {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  status: "confirmed" | "cancelled";
  attendees: Array<{ email: string }>;
  guestsCanInviteOthers: false;
  extendedProperties: { private: { harmonizeAppointmentId: string; clinicId: string } };
};

function plainText(value: string, max: number) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

// A descrição do Google aceita HTML básico: escapa para o texto sair literal.
function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// O Brasil não tem horário de verão desde 2019: America/Sao_Paulo é fixo em -03:00 (mesmo offset de appointmentInstant em clinic-time.ts).
// Se o fuso da clínica voltar a variar, derivar o offset via Intl a partir de clinicTimeZone.
function localDateTime(ms: number) {
  return `${new Date(ms - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;
}

function clockOf(ms: number) {
  return new Date(ms - 3 * 3_600_000).toISOString().slice(11, 16);
}

export function appointmentIsCancelled(status: string) {
  return status === "Cancelado";
}

/**
 * Payload do evento. Não inclui notas, diagnóstico, fotos, telefone nem CPF. Nome do paciente: só o nome (identifica na agenda da clínica).
 * null quando data/hora forem inválidas. `attendees` sempre presente (vazio remove convidados num patch).
 */
export function buildEventPayload(input: CalendarEventInput): GoogleEventPayload | null {
  const duration = Math.min(appointmentDurationMinutes(input.durationMinutes), MAX_EVENT_MINUTES);
  const range = appointmentRange(input.day, input.time, duration);
  if (!range) return null;
  const procedure = plainText(input.procedure, 120) || "Procedimento";
  const professional = cleanProfessionalName(plainText(input.professional, 120));
  const patient = plainText(input.patientName, 120);
  const lines = [
    `Paciente: ${patient || "—"}`,
    `Procedimento: ${procedure}`,
    `Horário: ${input.time} às ${clockOf(range.end)} (${duration} min)`,
    `Profissional: ${professional || "—"}`,
  ];
  if (input.link) lines.push("", `Abrir no Harmonize+: ${input.link}`);
  const email = normalizeCalendarEmail(input.attendeeEmail);
  return {
    summary: `Atendimento - ${procedure}`.slice(0, 250),
    description: escapeHtml(lines.join("\n")).slice(0, 8000),
    start: { dateTime: localDateTime(range.start), timeZone: clinicTimeZone },
    end: { dateTime: localDateTime(range.end), timeZone: clinicTimeZone },
    status: appointmentIsCancelled(input.status) ? "cancelled" : "confirmed",
    attendees: email && isValidCalendarEmail(email) ? [{ email }] : [],
    guestsCanInviteOthers: false,
    extendedProperties: { private: { harmonizeAppointmentId: input.appointmentId, clinicId: input.clinicId } },
  };
}

// ---------- diff ----------

export type AppointmentChangeField = "day" | "time" | "durationMinutes" | "procedure" | "professional" | "status";
export type AppointmentChange = { field: AppointmentChangeField; before: string; after: string };

/** Campos que mudaram entre dois estados (profissional comparado por professionalKey; procedimento sem espaços extras). */
export function diffAppointmentState(before: CalendarAppointmentState, after: CalendarAppointmentState): AppointmentChange[] {
  const changes: AppointmentChange[] = [];
  const push = (field: AppointmentChangeField, a: string | number, b: string | number) => changes.push({ field, before: String(a), after: String(b) });
  if (before.day !== after.day) push("day", before.day, after.day);
  if (before.time !== after.time) push("time", before.time, after.time);
  if (appointmentDurationMinutes(before.durationMinutes) !== appointmentDurationMinutes(after.durationMinutes)) push("durationMinutes", appointmentDurationMinutes(before.durationMinutes), appointmentDurationMinutes(after.durationMinutes));
  if (before.procedure.trim().replace(/\s+/g, " ") !== after.procedure.trim().replace(/\s+/g, " ")) push("procedure", before.procedure.trim(), after.procedure.trim());
  if (professionalKey(before.professional) !== professionalKey(after.professional)) push("professional", cleanProfessionalName(before.professional), cleanProfessionalName(after.professional));
  if (before.status !== after.status) push("status", before.status, after.status);
  return changes;
}

/** Mudança que altera o compromisso no Google (ignora Atendido/Faltou/Em atendimento, que não movem o evento). */
export function changeAffectsCalendar(changes: AppointmentChange[], before: { status: string }, after: { status: string }) {
  if (changes.some((change) => change.field !== "status")) return true;
  return appointmentIsCancelled(before.status) !== appointmentIsCancelled(after.status);
}
