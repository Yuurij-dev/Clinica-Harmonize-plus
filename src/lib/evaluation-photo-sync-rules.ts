// Regras puras da sincronização do editor com fotos enviadas pelo app durante a edição. Sem imports: carregável direto pelo node:test.
// O servidor não empurra eventos (sem SSE/websocket): a detecção é por checagem leve de ids neste intervalo, só com a aba visível.
export const syncIntervalMs = 5_000;
export const maxEditorPhotos = 20; // mesmo limite do PUT da avaliação e do PATCH da sessão

// Ids do servidor que o editor nunca viu. "Visto" inclui o que o usuário removeu: foto removida localmente não volta.
export function unseenPhotoIds(seen: ReadonlySet<string>, serverIds: readonly string[], currentCount: number): string[] {
  const fresh = [...new Set(serverIds)].filter((id) => !seen.has(id));
  return fresh.slice(0, Math.max(0, maxEditorPhotos - currentCount));
}

// Anexa ao fim, sem reordenar nem sobrescrever: ignora ids já presentes e continua o sortOrder depois do maior atual.
export function appendIncomingPhotos<T extends { id: string; sortOrder: number }>(current: readonly T[], incoming: readonly T[]): T[] {
  const present = new Set(current.map((photo) => photo.id));
  let next = current.reduce((max, photo) => Math.max(max, photo.sortOrder), -1) + 1;
  const added = incoming.filter((photo) => !present.has(photo.id) && present.add(photo.id)).slice(0, Math.max(0, maxEditorPhotos - current.length));
  return [...current, ...added.map((photo) => ({ ...photo, sortOrder: next++ }))];
}

// Versão sem sortOrder (fotos de sessão): anexa só ids ainda ausentes, respeitando o teto, sem reordenar.
export function appendUnseenById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const present = new Set(current.map((photo) => photo.id));
  const added = incoming.filter((photo) => !present.has(photo.id) && present.add(photo.id)).slice(0, Math.max(0, maxEditorPhotos - current.length));
  return [...current, ...added];
}

// ---- Backoff, parada e reconciliação do polling de fotos do app ----
export type PollOutcome = "ok" | "retry" | "stop";
const backoffSteps = [syncIntervalMs, 10_000, 20_000, 60_000];

// Atraso até a próxima checagem: 5 s normal; 10 s, 20 s e 60 s (teto) a cada falha seguida.
export const nextPollDelay = (failures: number) => backoffSteps[Math.min(Math.max(0, failures), backoffSteps.length - 1)];

// Resposta HTTP -> ação: ok segue; 5xx tenta de novo com backoff; 401/403/404 (e demais 4xx, exceto 408/429) param, pois repetir não resolve.
export function pollOutcomeForStatus(status: number): PollOutcome {
  if (status >= 200 && status < 300) return "ok";
  return status >= 500 || status === 408 || status === 429 ? "retry" : "stop";
}

// Falhas seguidas ao buscar o mesmo id: ao chegar no limite o id vira "tentado" (skipped) e deixa de ligar o spinner a cada ciclo.
export function idsToSkipAfterFailure(counts: Map<string, number>, ids: readonly string[], limit = 2): string[] {
  const skip: string[] = [];
  for (const id of ids) {
    const total = (counts.get(id) ?? 0) + 1;
    counts.set(id, total);
    if (total >= limit) skip.push(id);
  }
  return skip;
}

// Tempo que ainda falta para o spinner completar o mínimo de exibição (evita piscar).
export const remainingVisibleMs = (shownAt: number, now: number, minMs = 600) => Math.max(0, minMs - (now - shownAt));

// Checagem barata da sessão: o cliente manda o updatedAt que já conhece; igual = nada mudou (o servidor nem toca no JSON de fotos).
export const sessionUnchanged = (since: string | null, updatedAt: Date | string) => Boolean(since) && new Date(since as string).getTime() === new Date(updatedAt).getTime();

// Depois do PATCH: a lista do servidor manda, mas foto exibida que a resposta não trouxe e que NÃO foi enviada nessa requisição
// (anexada durante o voo) continua na tela. Respeita o teto.
export function reconcileAfterSave<T extends { id: string }>(response: readonly T[], displayed: readonly T[], sentIds: Iterable<string>): T[] {
  const skip = new Set<string>([...response.map((photo) => photo.id), ...sentIds]);
  const extra = displayed.filter((photo) => !skip.has(photo.id));
  return [...response, ...extra].slice(0, Math.max(response.length, maxEditorPhotos));
}

// Ids que o servidor deve tratar como "conhecidos": o que está na tela (mesmo estado do save) + o que o usuário removeu.
export const knownIdsForSave = (displayed: readonly { id: string }[], removed: Iterable<string>) => [...new Set([...displayed.map((photo) => photo.id), ...removed])];

// Quais ids removidos pelo usuário: estavam na tela e não estão na nova lista.
export const removedByEdit = (before: readonly { id: string }[], after: readonly { id: string }[]) => { const keep = new Set(after.map((photo) => photo.id)); return before.filter((photo) => !keep.has(photo.id)).map((photo) => photo.id); };

// Edição do usuário sobre a lista exibida no render (`base`), aplicada ao estado mais recente (`current`): o que estava em base e saiu de `edited` foi
// removido por ele; foto que entrou em `current` depois do render (anexada pelo poll) e não está em `edited` é mantida, respeitando o teto.
export function applyPhotoEdit<T extends { id: string }>(base: readonly T[], edited: readonly T[], current: readonly T[]): { photos: T[]; removed: string[] } {
  const keep = new Set(edited.map((photo) => photo.id));
  const was = new Set(base.map((photo) => photo.id));
  const removed = base.filter((photo) => !keep.has(photo.id)).map((photo) => photo.id);
  const added = current.filter((photo) => !was.has(photo.id) && !keep.has(photo.id));
  return { photos: [...edited, ...added].slice(0, Math.max(edited.length, maxEditorPhotos)), removed };
}
