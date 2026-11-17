// Rótulo curto do plano para a interface (puro). Nunca presume um plano: mostra o que o servidor informou em user.access.
const planNames: Record<string, string> = { start: "Start", pro: "Pro", premium: "Premium" };

export function planLabel(access: { plan?: string | null; contractedPlan?: string | null; mode?: string; reason?: string } | null | undefined): string | null {
  if (!access) return null;
  if (access.reason === "trial") return "Teste grátis";
  if (access.reason === "trial_expired") return "Teste encerrado";
  if (access.reason === "no_subscription") return "Sem assinatura";
  const name = planNames[access.contractedPlan ?? access.plan ?? ""] ?? null;
  if (!name) return null;
  return access.mode === "readonly" ? `Plano ${name} · somente leitura` : `Plano ${name}`;
}
