// Rotas públicas que renderizam a própria página em vez do HarmonizeApp (sem /api/auth/me nem redirecionamento ao login).
export const LEGAL_PATHS = ["/privacidade", "/termos"];

export function isStandalonePath(pathname: string | null | undefined): boolean {
  return pathname === "/login" || Boolean(pathname?.startsWith("/convite/")) || LEGAL_PATHS.includes(pathname ?? "");
}
