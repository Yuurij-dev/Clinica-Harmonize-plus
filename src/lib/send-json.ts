// Envia uma mutação JSON sem lançar erro: falha de rede vira { ok: false }.
export async function sendJson<T = { message?: string }>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null) as (T & { message?: string }) | null;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: "Sem conexão com o servidor. Tente novamente." } as T & { message?: string } };
  }
}
