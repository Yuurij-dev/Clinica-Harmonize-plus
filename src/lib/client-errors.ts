export function httpErrorMessage(response: Response, fallback: string) {
  const status = response.statusText ? `${response.status} ${response.statusText}` : String(response.status);
  return `${fallback} (HTTP ${status}).`;
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export async function responseErrorMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => null) as { message?: unknown } | null;
  return typeof data?.message === "string" && data.message.trim()
    ? data.message
    : httpErrorMessage(response, fallback);
}

export async function fetchForSave(input: RequestInfo | URL, init: RequestInit, fallback: string) {
  try {
    return await fetch(input, init);
  } catch (error) {
    return Response.json({ message: `${fallback}. Motivo: ${errorMessage(error, "falha de conexão com o servidor")}` }, { status: 503 });
  }
}
