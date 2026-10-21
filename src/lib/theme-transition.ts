// Troca de tema com "reveal" circular (View Transitions API) e fallbacks.
// A classe `dark` em <html> segue sendo a fonte de verdade; o script anti-flash do layout.tsx usa a mesma regra.

export const THEME_STORAGE_KEY = "harmonize-theme";
export const THEME_CHANGE_EVENT = "harmonize-theme-change";

const REVEAL_DURATION_MS = 650;
const REVEAL_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
const FALLBACK_DURATION_MS = 300;

type ViewTransitionLike = { ready: Promise<unknown>; finished: Promise<unknown> };
type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => ViewTransitionLike };

let transitionRunning = false;

export function isDarkTheme() {
  return document.documentElement.classList.contains("dark");
}

/** Tema inicial: preferência salva; sem ela, prefers-color-scheme. */
export function resolveStoredDark() {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved === "dark";
  } catch {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light");
  } catch {}
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function fadeFallback(dark: boolean) {
  const root = document.documentElement;
  root.classList.add("hp-theme-fading");
  applyTheme(dark);
  window.setTimeout(() => root.classList.remove("hp-theme-fading"), FALLBACK_DURATION_MS + 50);
}

export function toggleThemeWithReveal(event: { currentTarget: Element }) {
  if (transitionRunning) return;
  const next = !isDarkTheme();
  const doc = document as ViewTransitionDocument;

  if (prefersReducedMotion()) {
    applyTheme(next);
    return;
  }
  if (typeof doc.startViewTransition !== "function") {
    fadeFallback(next);
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

  transitionRunning = true;
  try {
    const transition = doc.startViewTransition(() => applyTheme(next));
    transition.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: REVEAL_DURATION_MS, easing: REVEAL_EASING, pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {});
    transition.finished.catch(() => {}).finally(() => { transitionRunning = false; });
  } catch {
    transitionRunning = false;
    applyTheme(next);
  }
}
