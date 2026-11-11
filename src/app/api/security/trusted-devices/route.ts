import { NextResponse } from "next/server";
import { revokeUserTrustedDevices } from "@/lib/auth-session";
import { noStore, requireSecurityUser } from "@/lib/security-api";
import { TRUSTED_DEVICE_COOKIE } from "@/lib/trusted-device-rules";

// Remove todos os dispositivos confiáveis do próprio usuário.
export async function DELETE(request: Request) {
  const { user, error } = await requireSecurityUser(request, { mutation: true });
  if (error) return error;
  const removed = await revokeUserTrustedDevices(user.id, { request, reason: "removidos pelo usuário" });
  const response = NextResponse.json({ success: true, removed }, { headers: noStore });
  response.cookies.set({ name: TRUSTED_DEVICE_COOKIE, value: "", maxAge: 0, path: "/" });
  return response;
}
