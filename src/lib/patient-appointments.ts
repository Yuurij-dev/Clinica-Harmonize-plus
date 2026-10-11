export function mergePatientAppointments<T extends { id?: string }>(appointments: T[], additions: T[]) {
  const existingIds = new Set(appointments.flatMap((appointment) => appointment.id ? [appointment.id] : []));
  return [...appointments, ...additions.filter((appointment) => !appointment.id || !existingIds.has(appointment.id))];
}

const letterOrNumber = /[\p{L}\p{N}]/u;

function isLetterOrNumberAt(value: string, index: number) {
  const codePoint = value.codePointAt(index);
  return codePoint !== undefined && letterOrNumber.test(String.fromCodePoint(codePoint));
}

function containsProcedureName(cardName: string, procedureName: string) {
  const name = procedureName.trim().toLocaleLowerCase("pt-BR");
  if (!name) return false;
  const card = cardName.toLocaleLowerCase("pt-BR");
  let index = card.indexOf(name);
  while (index !== -1) {
    const previousUnit = card.charCodeAt(index - 1);
    const previousIndex = index > 1 && previousUnit >= 0xdc00 && previousUnit <= 0xdfff ? index - 2 : index - 1;
    if (!isLetterOrNumberAt(card, previousIndex) && !isLetterOrNumberAt(card, index + name.length)) return true;
    index = card.indexOf(name, index + 1);
  }
  return false;
}

export function assignProcedureAppointmentsToCards<T extends { procedure: string; status: string }>(appointments: T[], cards: Array<{ name: string }>, procedureNames: Array<{ name: string }>) {
  const assignments: Array<T | undefined> = Array(cards.length).fill(undefined);
  const assignedAppointmentIndexes = new Set<number>();
  const matches: Array<{ appointmentIndex: number; cardIndex: number; specificity: number; active: number }> = [];

  appointments.forEach((appointment, appointmentIndex) => {
    cards.forEach((card, cardIndex) => {
      if (appointment.procedure === card.name) {
        matches.push({ appointmentIndex, cardIndex, specificity: 0, active: 0 });
        return;
      }
      const catalogMatch = procedureNames.find(({ name }) => name === appointment.procedure && containsProcedureName(card.name, name));
      if (catalogMatch) {
        const extraTitleLength = Math.max(0, card.name.trim().length - catalogMatch.name.trim().length);
        matches.push({ appointmentIndex, cardIndex, specificity: 100 + extraTitleLength, active: ["Agendado", "Em atendimento", "Faltou"].includes(appointment.status) ? 0 : 1 });
      }
    });
  });

  matches.sort((left, right) => left.specificity - right.specificity || left.active - right.active || left.appointmentIndex - right.appointmentIndex || left.cardIndex - right.cardIndex);
  for (const match of matches) {
    if (assignments[match.cardIndex] || assignedAppointmentIndexes.has(match.appointmentIndex)) continue;
    assignments[match.cardIndex] = appointments[match.appointmentIndex];
    assignedAppointmentIndexes.add(match.appointmentIndex);
  }
  return assignments;
}

export function procedureCardScheduleAction(status: string, canScheduleProcedure: boolean, canScheduleReturn: boolean) {
  if (canScheduleReturn) return { kind: "return" as const, label: "Marcar retorno", disabled: false };
  if (canScheduleProcedure) return { kind: "procedure" as const, label: "Marcar procedimento", disabled: false };
  return status === "Realizado"
    ? { kind: "return" as const, label: "Retorno marcado", disabled: true }
    : { kind: "procedure" as const, label: "Procedimento marcado", disabled: true };
}
