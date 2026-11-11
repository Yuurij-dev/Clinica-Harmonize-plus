import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { recordSecurityEvent } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";
import { noStore, requireSecurityUser, securityError } from "@/lib/security-api";
import { TRUSTED_DEVICE_COOKIE, hashTrustedDeviceToken } from "@/lib/trusted-device-rules";

// Remove um dispositivo confiável do próprio usuário (id de outro usuário = 404).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSecurityUser(request, { mutation: true });
  if (error) return error;
  const { id } = await params;

  if (id.includes(String.fromCharCode(0)) || id.length > 64) return NextResponse.json({ message: "Dispositivo não encontrado." }, { status: 404 });
  const device = await prisma.trustedDevice.findFirst({ where: { id, userId: user.id, revokedAt: null }, select: { id: true, label: true, tokenHash: true } });
  if (!device) return securityError("Dispositivo não encontrado.", 404);
  await prisma.trustedDevice.updateMany({ where: { id: device.id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await recordSecurityEvent({ userId: user.id, type: "TRUSTED_DEVICE_REMOVED", request, detail: device.label });

  const response = NextResponse.json({ success: true }, { headers: noStore });
  const token = (await cookies()).get(TRUSTED_DEVICE_COOKIE)?.value;
  if (token && token.length <= 200 && hashTrustedDeviceToken(token) === device.tokenHash) {
    response.cookies.set({ name: TRUSTED_DEVICE_COOKIE, value: "", maxAge: 0, path: "/" });
  }
  return response;
}
