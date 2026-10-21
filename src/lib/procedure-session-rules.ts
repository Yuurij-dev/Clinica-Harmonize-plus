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
