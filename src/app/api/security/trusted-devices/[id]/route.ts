import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revokeTrustedDevice } from "@/lib/auth-session";
import { noStore, requireSecurityUser, securityError } from "@/lib/security-api";
import { TRUSTED_DEVICE_COOKIE, hashTrustedDeviceToken } from "@/lib/trusted-device-rules";

// Remove um dispositivo confiável do próprio usuário (id de outro usuário = 404).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSecurityUser(request, { mutation: true });
  if (error) return error;
  const { id } = await params;

  if (id.includes(String.fromCharCode(0)) || id.length > 64) return NextResponse.json({ message: "Dispositivo não encontrado." }, { status: 404 });
  const device = await revokeTrustedDevice(user.id, id, request);
  if (!device) return securityError("Dispositivo não encontrado.", 404);

  const response = NextResponse.json({ success: true }, { headers: noStore });
  const token = (await cookies()).get(TRUSTED_DEVICE_COOKIE)?.value;
  if (token && token.length <= 200 && hashTrustedDeviceToken(token) === device.tokenHash) {
    response.cookies.set({ name: TRUSTED_DEVICE_COOKIE, value: "", maxAge: 0, path: "/" });
  }
  return response;
}
