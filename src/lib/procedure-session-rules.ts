export function approvedProcedureNames(details: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return [];
  }

  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "items" in parsed && Array.isArray(parsed.items)
      ? parsed.items
      : [];

  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || !("name" in item) || typeof item.name !== "string") return [];
    return [item.name];
  });
}
