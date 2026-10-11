export function getAuthSecret() {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "");
  if (secret.length < 32) throw new Error("AUTH_SECRET precisa ter pelo menos 32 bytes.");
  return secret;
}
