import { getCurrentUserFromToken } from "./auth";
import { parseBearerToken } from "./bearer-rules";

/** Mobile security routes require the exact authenticated Bearer session, never an ambient browser cookie. */
export async function getMobileBearerUser(request: Request) {
  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  return getCurrentUserFromToken(token);
}
