// Protecao CSRF extra (alem do SameSite=lax) para POST/DELETE de seguranca. Funcao pura.

type HeaderSource = { headers: { get(name: string): string | null } };

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Aceita so requisicoes do proprio site. Ordem: Sec-Fetch-Site, depois Origin x Host.
 * Sem nenhum dos cabecalhos (cliente nao-navegador) rejeita: rotas de seguranca sao de navegador.
 */
export function isSameOrigin(request: HeaderSource): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const origin = request.headers.get("origin");
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0].trim().toLowerCase();
  if (!origin || !host) return false;
  return hostOf(origin) === host;
}
