export function approvedProcedureNames(details: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return [];
  }

  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "items" in parsed && Array.isArray(parsed.items)
      ? parsed.items
      : [];

  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || !("name" in item) || typeof item.name !== "string") return [];
    return [item.name];
  });
}

// Nome da sessão única do orçamento: todos os procedimentos aprovados juntos (ex.: "12 + botox").
export function combinedProcedureName(names: string[]): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  return unique.join(" + ").slice(0, 180);
}

// Agendamento de procedimento criado a partir da sessão; retornos usam "Retorno - " e não entram aqui.
export const PROCEDURE_APPOINTMENT_PREFIX = "Procedimento - ";
export function procedureAppointmentName(sessionProcedureName: string): string {
  return `${PROCEDURE_APPOINTMENT_PREFIX}${sessionProcedureName}`.slice(0, 200);
}
export function isProcedureAppointmentName(procedure: string): boolean {
  return procedure.startsWith(PROCEDURE_APPOINTMENT_PREFIX);
}

// Nome do procedimento sem o prefixo do agendamento criado pela sessão.
export function stripProcedureAppointmentPrefix(procedure: string): string {
  const trimmed = procedure.trim();
  return trimmed.startsWith(PROCEDURE_APPOINTMENT_PREFIX) ? trimmed.slice(PROCEDURE_APPOINTMENT_PREFIX.length).trim() : trimmed;
}

// Nomes (puro e prefixado) que contam como o mesmo procedimento para evitar agendamento duplicado na jornada.
// Retornos e avaliações não entram na regra.
export function procedureAppointmentVariants(procedure: string): string[] | null {
  const base = stripProcedureAppointmentPrefix(procedure);
  if (!base || /^(retorno|avalia)/i.test(base.normalize("NFD").replace(/[̀-ͯ]/g, ""))) return null;
  return [base, `${PROCEDURE_APPOINTMENT_PREFIX}${base}`];
}

// Nomes a buscar no cadastro para achar a duração de um agendamento: o próprio nome, o nome sem prefixo
// ("Procedimento - " ou "Retorno - ") e, se for nome combinado ("A + B"), cada parte.
export const RETURN_APPOINTMENT_PREFIX = "Retorno - ";
function appointmentBaseProcedureName(procedure: string): string {
  const stripped = stripProcedureAppointmentPrefix(procedure);
  return stripped.startsWith(RETURN_APPOINTMENT_PREFIX) ? stripped.slice(RETURN_APPOINTMENT_PREFIX.length).trim() : stripped;
}
export function appointmentDurationLookupNames(procedure: string): string[] {
  const base = appointmentBaseProcedureName(procedure);
  return [...new Set([procedure, base, ...splitCombinedProcedureName(base)].filter(Boolean))];
}

// Duração em minutos do agendamento: nome exato, depois nome sem prefixo, depois soma das partes de um nome combinado
// (só se todas existirem). undefined quando nada casa (quem chama aplica o padrão de 60 min).
export function appointmentProcedureDuration(procedures: Array<{ name: string; durationMinutes: number }>, procedure: string): number | undefined {
  const find = (name: string) => procedures.find((item) => item.name === name)?.durationMinutes;
  const base = appointmentBaseProcedureName(procedure);
  const direct = find(procedure) ?? (base ? find(base) : undefined);
  if (direct !== undefined) return direct;
  const parts = splitCombinedProcedureName(base);
  if (parts.length < 2) return undefined;
  const durations = parts.map(find);
  return durations.every((value): value is number => value !== undefined) ? durations.reduce((sum, value) => sum + value, 0) : undefined;
}

export const DUPLICATE_PROCEDURE_APPOINTMENT_MESSAGE = "Este procedimento já está agendado nesta jornada. Remarque ou cancele o agendamento existente na Agenda.";

// "A + B" (nome combinado) vira ["A", "B"], sem repetir nomes.
export function splitCombinedProcedureName(name: string): string[] {
  return [...new Set(stripProcedureAppointmentPrefix(name).split(" + ").map((part) => part.trim()).filter(Boolean))];
}

// Só rascunho legado (ex.: sessão por item) é atualizado para o nome combinado do orçamento; iniciada/concluída nunca muda.
export function shouldRefreshDraftName(session: { status: string; procedureName: string }, combinedName: string): boolean {
  return session.status === "Rascunho" && Boolean(combinedName) && session.procedureName !== combinedName;
}

// Ao iniciar a sessão com o procedimento já agendado, o agendamento passa para o instante real do início
// (dia e HH:mm atuais no fuso da clínica, vindos de clinicNow). Ação do profissional: não valida expediente nem horário livre.
export function appointmentStartNow(now: { date: string; minutes: number }): { day: string; time: string } {
  return { day: now.date, time: `${String(Math.floor(now.minutes / 60)).padStart(2, "0")}:${String(now.minutes % 60).padStart(2, "0")}` };
}

// Só agendamento "Procedimento - …" ainda em Agendado é movido; retornos e atendimentos já em andamento ficam como estão.
export function isMovableStartAppointment(appointment: { procedure: string; status: string }): boolean {
  return appointment.status === "Agendado" && isProcedureAppointmentName(appointment.procedure);
}

// Ordem única do agendamento de procedimento "ativo" da jornada (loader do scheduledProcedure e início da sessão).
export function scheduledAppointmentOrder(): Array<{ date: "asc" } | { time: "asc" }> {
  return [{ date: "asc" }, { time: "asc" }];
}

// Validação do corpo do PATCH de sessão (compartilhada pelas rotas de sessão).
export type SessionPhotoInput = { id?: string; name?: string; phase?: string; category?: string; imageUrl?: string; sourceEvaluationPhotoId?: string; width?: number; height?: number };
type MaterialInput = { productId?: string; quantity?: number; allocations?: Array<{ lotId?: string; quantity?: number }> };
const sessionStatuses = new Set(["Rascunho", "Em execução", "Concluída"]);
const photoPhases = new Set(["Antes", "Imediatamente após"]);

export function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function validateSessionPayload(body: unknown) {
  const value = body as Record<string, unknown> | null;
  if (!value || !sessionStatuses.has(String(value.status ?? "Rascunho"))) return "Status de sessão inválido.";
  for (const field of ["technique", "treatedAreas", "anesthesia", "complications", "observations"] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || value[field].length > 5000)) return "Revise os campos clínicos da sessão.";
  }
  if (value.professional !== undefined && (typeof value.professional !== "string" || !value.professional.trim() || value.professional.length > 160)) return "Informe o profissional responsável.";
  for (const field of ["estimatedMinutes", "durationMinutes"] as const) if (value[field] !== undefined && value[field] !== null && (!Number.isInteger(value[field]) || Number(value[field]) < 0 || Number(value[field]) > 1440)) return "A duração deve ser um número de minutos válido.";
  if (value.performedAt !== undefined && (typeof value.performedAt !== "string" || !Number.isFinite(new Date(value.performedAt).getTime()))) return "Data da sessão inválida.";
  for (const field of ["startedAt", "endedAt"] as const) if (value[field] !== undefined && value[field] !== null && (typeof value[field] !== "string" || !Number.isFinite(new Date(value[field]).getTime()))) return "Horário da sessão inválido.";
  if (value.materials !== undefined && (!Array.isArray(value.materials) || value.materials.length > 40 || value.materials.some((item) => !isMaterial(item)))) return "Revise os produtos e quantidades informados.";
  if (value.photos !== undefined && (!Array.isArray(value.photos) || value.photos.length > 20 || value.photos.some((photo) => !isPhoto(photo)))) return "Revise as fotografias. São aceitas até 20 imagens válidas por sessão.";
  return null;
}

function isMaterial(value: unknown): value is MaterialInput {
  const item = value as MaterialInput | null;
  return Boolean(item && typeof item.productId === "string" && item.productId && Number.isFinite(item.quantity) && Number(item.quantity) > 0 && Number(item.quantity) <= 10000 && (!item.allocations || (Array.isArray(item.allocations) && item.allocations.length <= 20 && item.allocations.every((allocation) => typeof allocation.lotId === "string" && allocation.lotId && Number.isFinite(allocation.quantity) && Number(allocation.quantity) > 0))));
}

function isPhoto(value: unknown): value is SessionPhotoInput {
  const photo = value as SessionPhotoInput | null;
  if (!photo || typeof photo.id !== "string" || !photo.id || !photoPhases.has(String(photo.phase))) return false;
  if (photo.sourceEvaluationPhotoId) return photo.phase === "Antes" && !photo.imageUrl;
  return typeof photo.imageUrl === "string" && /^data:image\/(jpeg|png|webp);base64,/i.test(photo.imageUrl) && photo.imageUrl.length <= 8_500_000 && typeof photo.name === "string" && photo.name.length <= 180 && Number.isInteger(photo.width) && Number(photo.width) > 0 && Number(photo.width) <= 8000 && Number.isInteger(photo.height) && Number(photo.height) > 0 && Number(photo.height) <= 8000 && Number(photo.width) * Number(photo.height) <= 25_000_000;
}
