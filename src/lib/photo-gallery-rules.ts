// Regras puras da galeria de fotos: normaliza as fontes (avaliação, sessão, retorno, legado e uploads novos) em um índice único,
// sem duplicar: a identidade de cada foto é "fonte:id". Nenhuma função aqui toca imagem/base64.

export type PhotoSource = "evaluation" | "session" | "followup" | "legacy" | "gallery";
export type GalleryPhase = "ANTES" | "DEPOIS" | "EVOLUCAO" | "OUTRA";
export type EncounterKind = "evaluation" | "session" | "followup" | "other";
export type GalleryView = "all" | "evaluations" | "procedures" | "evolutions" | "beforeafter";

export type GalleryPhoto = {
  id: string; // fonte:...
  source: PhotoSource;
  name: string;
  category: string;
  phase: GalleryPhase;
  takenAt: string; // ISO
  journeyId: string | null;
  journeyName: string;
  encounterKey: string; // agrupa por atendimento
  encounterKind: EncounterKind;
  encounterTitle: string;
  encounterDate: string;
  professional: string;
  width: number;
  height: number;
  hasAnnotations: boolean;
  pairKey: string | null; // sessão (ou tratamento) que liga antes e depois
  archived: boolean;
};

export type PhotoFilters = { view: GalleryView; q: string; category: string; journeyId: string; encounterKey: string; from: string; to: string };
export const defaultPhotoFilters: PhotoFilters = { view: "all", q: "", category: "", journeyId: "", encounterKey: "", from: "", to: "" };

export function mapPhase(raw: unknown): GalleryPhase {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (text === "antes") return "ANTES";
  if (text === "depois" || text.startsWith("imediatamente")) return "DEPOIS";
  if (text === "evolução" || text === "evolucao") return "EVOLUCAO";
  return "OUTRA";
}

export const photoPhaseLabels: Record<GalleryPhase, string> = { ANTES: "Antes", DEPOIS: "Depois", EVOLUCAO: "Evolução", OUTRA: "Outra" };
export const encounterKindLabels: Record<EncounterKind, string> = { evaluation: "Avaliação", session: "Procedimento", followup: "Pós-procedimento", other: "Foto avulsa" };

// Identificador composto: usa ":" como separador; ids vindos do banco não contêm ":" (cuid), mas fotos de JSON podem trazer qualquer texto.
export function photoRef(source: PhotoSource, ...parts: string[]) {
  return [source, ...parts.map((part) => encodeURIComponent(part))].join(":");
}
export function parsePhotoRef(ref: string): { source: PhotoSource; parts: string[] } | null {
  const [source, ...rest] = ref.split(":");
  if (!["evaluation", "session", "followup", "legacy", "gallery"].includes(source) || rest.length === 0 || rest.some((part) => !part)) return null;
  try { return { source: source as PhotoSource, parts: rest.map((part) => decodeURIComponent(part)) }; } catch { return null; }
}

// Parâmetro de rota (já decodificado pelo Next ou ainda com %3A): devolve a referência ou null se malformada.
export function decodeRefParam(raw: string): string | null {
  if (!raw.includes("%") || raw.includes(":")) return raw;
  try { return decodeURIComponent(raw); } catch { return null; }
}

export function matchesView(photo: GalleryPhoto, view: GalleryView, pairedIds: Set<string>) {
  if (view === "all") return true;
  if (view === "evaluations") return photo.encounterKind === "evaluation";
  if (view === "procedures") return photo.encounterKind === "session" || photo.source === "legacy";
  if (view === "evolutions") return photo.encounterKind === "followup" || photo.phase === "EVOLUCAO";
  return pairedIds.has(photo.id);
}

export function filterPhotos(photos: GalleryPhoto[], filters: PhotoFilters): GalleryPhoto[] {
  const paired = pairedPhotoIds(photos);
  const text = filters.q.trim().toLocaleLowerCase("pt-BR");
  return photos.filter((photo) => {
    if (!matchesView(photo, filters.view, paired)) return false;
    if (filters.category && photo.category !== filters.category) return false;
    if (filters.journeyId && photo.journeyId !== filters.journeyId) return false;
    if (filters.encounterKey && photo.encounterKey !== filters.encounterKey) return false;
    const day = photo.takenAt.slice(0, 10);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    if (text && !`${photo.name} ${photo.category} ${photo.encounterTitle} ${photo.journeyName}`.toLocaleLowerCase("pt-BR").includes(text)) return false;
    return true;
  });
}

export type EncounterGroup = { key: string; kind: EncounterKind; title: string; date: string; journeyName: string; professional: string; photos: GalleryPhoto[] };

// Mais recente primeiro; dentro do grupo, ordem estável por categoria (frontal primeiro) e data.
const categoryOrder = ["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"];
export function comparePhotos(a: GalleryPhoto, b: GalleryPhoto) {
  const byCategory = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
  return byCategory || a.takenAt.localeCompare(b.takenAt) || a.id.localeCompare(b.id);
}

export function groupByEncounter(photos: GalleryPhoto[]): EncounterGroup[] {
  const groups = new Map<string, EncounterGroup>();
  for (const photo of photos) {
    const group = groups.get(photo.encounterKey) ?? { key: photo.encounterKey, kind: photo.encounterKind, title: photo.encounterTitle, date: photo.encounterDate, journeyName: photo.journeyName, professional: photo.professional, photos: [] };
    group.photos.push(photo);
    groups.set(photo.encounterKey, group);
  }
  return [...groups.values()].map((group) => ({ ...group, photos: [...group.photos].sort(comparePhotos) })).sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}

export type BeforeAfterPair = { key: string; before: GalleryPhoto; after: GalleryPhoto };

// Pares antes/depois por sessão (pairKey): casa pela mesma categoria; o que sobra casa por ordem. Uma foto nunca entra em dois pares.
export function beforeAfterPairs(photos: GalleryPhoto[]): BeforeAfterPair[] {
  const byKey = new Map<string, GalleryPhoto[]>();
  for (const photo of photos) {
    if (!photo.pairKey || photo.archived) continue;
    byKey.set(photo.pairKey, [...(byKey.get(photo.pairKey) ?? []), photo]);
  }
  const pairs: BeforeAfterPair[] = [];
  for (const [key, list] of byKey) {
    const befores = list.filter((photo) => photo.phase === "ANTES").sort(comparePhotos);
    const afters = list.filter((photo) => photo.phase === "DEPOIS" || photo.phase === "EVOLUCAO").sort((a, b) => (a.phase === b.phase ? 0 : a.phase === "DEPOIS" ? -1 : 1) || comparePhotos(a, b));
    const usedAfter = new Set<string>();
    const unmatched: GalleryPhoto[] = [];
    for (const before of befores) {
      const match = afters.find((after) => !usedAfter.has(after.id) && after.category === before.category && after.category !== "Outra");
      if (match) { usedAfter.add(match.id); pairs.push({ key: `${key}:${before.id}`, before, after: match }); } else unmatched.push(before);
    }
    const remaining = afters.filter((after) => !usedAfter.has(after.id));
    unmatched.forEach((before, index) => { const after = remaining[index]; if (after) pairs.push({ key: `${key}:${before.id}`, before, after }); });
  }
  return pairs;
}

export function pairedPhotoIds(photos: GalleryPhoto[]) {
  const ids = new Set<string>();
  for (const pair of beforeAfterPairs(photos)) { ids.add(pair.before.id); ids.add(pair.after.id); }
  return ids;
}

// Fotos visíveis por padrão: as arquivadas só aparecem quando pedidas.
export function visiblePhotos(photos: GalleryPhoto[], includeArchived: boolean) {
  return includeArchived ? photos : photos.filter((photo) => !photo.archived);
}

export function countByView(photos: GalleryPhoto[]): Record<GalleryView, number> {
  const paired = pairedPhotoIds(photos);
  const counts: Record<GalleryView, number> = { all: photos.length, evaluations: 0, procedures: 0, evolutions: 0, beforeafter: 0 };
  for (const photo of photos) for (const view of ["evaluations", "procedures", "evolutions", "beforeafter"] as const) if (matchesView(photo, view, paired)) counts[view] += 1;
  return counts;
}

// Vizinhos para a navegação do visualizador (sem dar a volta).
export function neighbors(list: GalleryPhoto[], id: string) {
  const index = list.findIndex((photo) => photo.id === id);
  return { index, previous: index > 0 ? list[index - 1] : null, next: index >= 0 && index < list.length - 1 ? list[index + 1] : null };
}

// ---- Montagem do índice a partir das linhas do banco (sem imageUrl) ----

export type EvaluationRow = { id: string; journeyId: string | null; professional: string; status: string; createdAt: string; photos: Array<{ id: string; name: string; category: string; width: number; height: number; hasAnnotations: boolean; createdAt: string }> };
export type SessionPhotoMeta = { __invalid?: unknown; id?: unknown; phase?: unknown; sourceEvaluationPhotoId?: unknown; name?: unknown; category?: unknown; width?: unknown; height?: unknown };
export type SessionRow = { id: string; journeyId: string; evaluationId: string; procedureName: string; treatedAreas: string; professional: string; performedAt: string; photos: SessionPhotoMeta[] };
export type FollowUpRow = { id: string; sessionId: string; journeyId: string; occurredAt: string; professional: string; procedureName: string; photos: SessionPhotoMeta[]; removedPhotoIds: string[] };
export type LegacyRow = { id: string; journeyId: string | null; name: string; professional: string; performedAt: string; hasBefore: boolean; hasAfter: boolean; sessions: Array<{ id: string; name: string; hasBefore: boolean; hasAfter: boolean }> };
export type GalleryUploadRow = { id: string; journeyId: string | null; encounterType: string | null; encounterId: string | null; phase: string; category: string; name: string; width: number; height: number; takenAt: string; uploadedByName: string; archivedAt: string | null };

const str = (value: unknown, fallback = "") => typeof value === "string" && value ? value : fallback;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
const categoryOf = (value: unknown) => categoryOrder.includes(str(value)) ? str(value) : "Outra";

export function buildGalleryIndex(input: {
  evaluations: EvaluationRow[]; sessions: SessionRow[]; followUps: FollowUpRow[]; legacy: LegacyRow[]; uploads: GalleryUploadRow[]; journeyNames: Map<string, string>;
}): GalleryPhoto[] {
  const journeyName = (id: string | null) => (id ? input.journeyNames.get(id) ?? "" : "");
  const photos: GalleryPhoto[] = [];
  // Foto de avaliação usada como "Antes" por uma sessão: a mesma foto (sem cópia), ligada à sessão para o par antes/depois.
  const sessionByEvaluationPhoto = new Map<string, string>();
  for (const session of input.sessions) for (const photo of session.photos) if (str(photo.sourceEvaluationPhotoId)) sessionByEvaluationPhoto.set(str(photo.sourceEvaluationPhotoId), session.id);
  // Sem referência explícita, a foto de avaliação serve de "antes" da primeira sessão feita a partir dela.
  const sessionByEvaluation = new Map<string, string>();
  for (const session of [...input.sessions].sort((a, b) => a.performedAt.localeCompare(b.performedAt))) if (!sessionByEvaluation.has(session.evaluationId)) sessionByEvaluation.set(session.evaluationId, session.id);
  const evaluationById = new Map(input.evaluations.map((evaluation) => [evaluation.id, evaluation]));

  for (const evaluation of input.evaluations) {
    for (const photo of evaluation.photos) {
      photos.push({
        id: photoRef("evaluation", photo.id), source: "evaluation", name: photo.name, category: categoryOf(photo.category), phase: "ANTES", takenAt: photo.createdAt,
        journeyId: evaluation.journeyId, journeyName: journeyName(evaluation.journeyId), encounterKey: photoRef("evaluation", evaluation.id), encounterKind: "evaluation",
        encounterTitle: evaluation.status === "Concluída" ? "Avaliação inicial" : "Avaliação (rascunho)", encounterDate: evaluation.createdAt, professional: evaluation.professional,
        width: photo.width, height: photo.height, hasAnnotations: photo.hasAnnotations, pairKey: sessionByEvaluationPhoto.get(photo.id) ?? sessionByEvaluation.get(evaluation.id) ?? null, archived: false,
      });
    }
  }
  for (const session of input.sessions) {
    session.photos.forEach((photo, index) => {
      // Item que não era objeto no JSON (mantido só para preservar o índice idxN) e referência a foto da avaliação (já listada acima): não entram.
      if (photo.__invalid || str(photo.sourceEvaluationPhotoId)) return;
      const id = str(photo.id, `idx${index}`);
      photos.push({
        id: photoRef("session", session.id, id), source: "session", name: str(photo.name, "Foto do procedimento"), category: categoryOf(photo.category), phase: mapPhase(photo.phase), takenAt: session.performedAt,
        journeyId: session.journeyId, journeyName: journeyName(session.journeyId), encounterKey: photoRef("session", session.id), encounterKind: "session",
        encounterTitle: session.procedureName + (session.treatedAreas ? ` · ${session.treatedAreas}` : ""), encounterDate: session.performedAt, professional: session.professional,
        width: num(photo.width), height: num(photo.height), hasAnnotations: false, pairKey: session.id, archived: false,
      });
    });
  }
  const sessionById = new Map(input.sessions.map((session) => [session.id, session]));
  for (const followUp of input.followUps) {
    const removed = new Set(followUp.removedPhotoIds);
    followUp.photos.forEach((photo, index) => {
      if (photo.__invalid) return;
      const id = str(photo.id, `idx${index}`);
      if (removed.has(id)) return;
      const phase = mapPhase(photo.phase);
      photos.push({
        id: photoRef("followup", followUp.id, id), source: "followup", name: str(photo.name, "Foto de retorno"), category: categoryOf(photo.category), phase: phase === "OUTRA" ? "EVOLUCAO" : phase, takenAt: followUp.occurredAt,
        journeyId: followUp.journeyId, journeyName: journeyName(followUp.journeyId), encounterKey: photoRef("followup", followUp.id), encounterKind: "followup",
        encounterTitle: `Retorno · ${followUp.procedureName}`, encounterDate: followUp.occurredAt, professional: followUp.professional || sessionById.get(followUp.sessionId)?.professional || "",
        width: num(photo.width), height: num(photo.height), hasAnnotations: false, pairKey: followUp.sessionId, archived: false,
      });
    });
  }
  for (const procedure of input.legacy) {
    const entries: Array<[string, string, "ANTES" | "DEPOIS", string]> = [];
    if (procedure.hasBefore) entries.push([photoRef("legacy", "procedure", procedure.id, "before"), procedure.name, "ANTES", procedure.id]);
    if (procedure.hasAfter) entries.push([photoRef("legacy", "procedure", procedure.id, "after"), procedure.name, "DEPOIS", procedure.id]);
    for (const session of procedure.sessions) {
      if (session.hasBefore) entries.push([photoRef("legacy", "photosession", session.id, "before"), `${procedure.name} · ${session.name}`, "ANTES", session.id]);
      if (session.hasAfter) entries.push([photoRef("legacy", "photosession", session.id, "after"), `${procedure.name} · ${session.name}`, "DEPOIS", session.id]);
    }
    for (const [id, name, phase, pair] of entries) {
      photos.push({
        id, source: "legacy", name, category: "Outra", phase, takenAt: procedure.performedAt, journeyId: procedure.journeyId, journeyName: journeyName(procedure.journeyId),
        encounterKey: photoRef("legacy", "procedure", procedure.id), encounterKind: "session", encounterTitle: procedure.name, encounterDate: procedure.performedAt, professional: procedure.professional,
        width: 0, height: 0, hasAnnotations: false, pairKey: `legacy:${pair}`, archived: false,
      });
    }
  }
  for (const upload of input.uploads) {
    const linked = upload.encounterType && upload.encounterId ? (upload.encounterType === "evaluation" ? evaluationById.get(upload.encounterId) : upload.encounterType === "session" ? sessionById.get(upload.encounterId) : undefined) : undefined;
    const kind: EncounterKind = linked && upload.encounterType === "evaluation" ? "evaluation" : linked && upload.encounterType === "session" ? "session" : "other";
    const encounterKey = linked && upload.encounterType && upload.encounterId ? photoRef(upload.encounterType as PhotoSource, upload.encounterId) : photoRef("gallery", upload.journeyId ?? "avulsas");
    const linkedSession = linked && upload.encounterType === "session" ? sessionById.get(upload.encounterId!) : undefined;
    photos.push({
      id: photoRef("gallery", upload.id), source: "gallery", name: upload.name, category: categoryOf(upload.category), phase: mapPhase(upload.phase), takenAt: upload.takenAt,
      journeyId: upload.journeyId, journeyName: journeyName(upload.journeyId), encounterKey, encounterKind: kind,
      encounterTitle: linkedSession ? linkedSession.procedureName : linked && upload.encounterType === "evaluation" ? "Avaliação inicial" : upload.journeyId ? "Fotos do tratamento" : "Fotos avulsas",
      encounterDate: linked ? (linkedSession?.performedAt ?? (linked as EvaluationRow).createdAt) : upload.takenAt, professional: upload.uploadedByName,
      width: upload.width, height: upload.height, hasAnnotations: false, pairKey: upload.encounterType === "session" ? upload.encounterId : upload.journeyId ? `journey:${upload.journeyId}` : null, archived: Boolean(upload.archivedAt),
    });
  }
  return photos.sort((a, b) => b.takenAt.localeCompare(a.takenAt) || a.id.localeCompare(b.id));
}

// Um card por procedimento: fotos ligadas pelo mesmo pairKey (sessão) ficam juntas — antes da avaliação, durante/depois da sessão e evoluções
// dos retornos. Fotos sem pairKey ficam no próprio atendimento. Dentro do card: antes, depois, evolução e o resto.
export type ProcedureGroup = EncounterGroup & { hasPair: boolean };
const phaseRank: Record<GalleryPhase, number> = { ANTES: 0, DEPOIS: 1, EVOLUCAO: 2, OUTRA: 3 };
export function groupByProcedure(photos: GalleryPhoto[]): ProcedureGroup[] {
  const groups = new Map<string, GalleryPhoto[]>();
  for (const photo of photos) {
    const key = photo.pairKey ?? photo.encounterKey;
    groups.set(key, [...(groups.get(key) ?? []), photo]);
  }
  return [...groups.entries()].map(([key, list]) => {
    // O título e a data vêm da sessão do procedimento quando há; senão, da foto mais antiga do grupo.
    const head = list.find((photo) => photo.encounterKind === "session") ?? [...list].sort((a, b) => a.encounterDate.localeCompare(b.encounterDate))[0];
    const sorted = [...list].sort((a, b) => phaseRank[a.phase] - phaseRank[b.phase] || comparePhotos(a, b));
    return { key, kind: head.encounterKind, title: head.encounterTitle, date: head.encounterDate, journeyName: head.journeyName, professional: head.professional, photos: sorted, hasPair: beforeAfterPairs(list).length > 0 };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}
