export type FollowUpValidationErrors = { content?: string; guidance?: string; photos?: string };

export function validateFollowUpDraft(input: { guidanceText: string; guidanceSent: boolean; observations: string; complications: string; photoCount: number; appointmentId: string }) {
  const errors: FollowUpValidationErrors = {};
  const guidanceText = input.guidanceText.trim();
  if (input.guidanceSent && !guidanceText) errors.guidance = "Informe o texto das orientações que foram enviadas.";
  if (input.photoCount > 12) errors.photos = "Cada registro aceita até 12 fotografias.";
  if (!guidanceText && !input.observations.trim() && !input.complications.trim() && input.photoCount === 0 && !input.appointmentId && !errors.guidance) {
    errors.content = "Adicione uma orientação, observação, intercorrência, foto ou retorno para registrar a evolução.";
  }
  return errors;
}
