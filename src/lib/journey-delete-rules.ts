// Sem import para o módulo seguir carregável por node:test; a rota calcula as permissões com `can()`.
export type JourneyDeleteCounts = { payments: number; documents: number; photos: number };
export type JourneyDeleteAbilities = { deletePayments: boolean; deleteClinicalFiles: boolean };

// Excluir a jornada apaga em cascata pagamentos, documentos e fotos: quem não pode apagá-los isoladamente também não pode por aqui.
export function journeyDeleteDecision(abilities: JourneyDeleteAbilities, counts: JourneyDeleteCounts): { allowed: true } | { allowed: false; message: string } {
  const blocksPayments = counts.payments > 0 && !abilities.deletePayments;
  const blocksFiles = counts.documents + counts.photos > 0 && !abilities.deleteClinicalFiles;
  if (!blocksPayments && !blocksFiles) return { allowed: true };
  const what = blocksPayments && blocksFiles ? "pagamentos, documentos ou fotos registrados" : blocksPayments ? "pagamentos registrados" : "documentos ou fotos clínicas registrados";
  return { allowed: false, message: `Esta jornada tem ${what}. Só um administrador pode excluí-la.` };
}
