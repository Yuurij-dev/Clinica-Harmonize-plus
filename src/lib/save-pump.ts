// Fila serial de gravações de rascunho: no máximo uma gravação em voo por vez e cada nova gravação já parte da
// revisão salva pela anterior. Evita que dois flush simultâneos enviem a mesma revisão esperada (409 falso).
export function createSavePump<R>({ latest, scope, save }: {
  latest: () => R;          // revisão local mais recente (o que o usuário já digitou)
  scope: () => string;      // mudou de escopo no meio da gravação => resultado descartado
  save: () => Promise<boolean>; // envia o conteúdo mais recente; devolve se gravou
}) {
  let saved: R | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const dirty = () => saved !== latest();

  // Repete até o salvo alcançar o mais recente; devolve false na primeira falha ou se o escopo mudou.
  async function drain() {
    while (dirty()) {
      const started = latest();
      const startedScope = scope();
      let ok = false;
      try { ok = await save(); } catch { ok = false; }
      if (startedScope !== scope()) return false;
      if (!ok) return false;
      saved = started;
    }
    return true;
  }

  return {
    flush(): Promise<boolean> {
      pending += 1;
      const run = tail.then(drain, drain).finally(() => { pending -= 1; });
      tail = run.catch(() => undefined);
      return run;
    },
    markSaved(revision: R) { saved = revision; },
    isDirty: dirty,
    get busy() { return pending > 0; },
  };
}
