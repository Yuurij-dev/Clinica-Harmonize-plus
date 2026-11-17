import { NextResponse } from "next/server";
import { revokeUserTrustedDevices } from "@/lib/auth-session";
import { getMobileBearerUser } from "@/lib/mobile-bearer-user";
import { prisma } from "@/lib/prisma";
import { hashTrustedDeviceToken } from "@/lib/trusted-device-rules";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const user = await getMobileBearerUser(request);
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401, headers: noStore });
  const token = request.headers.get("x-harmonize-trusted-device");
  const currentHash = token && token.length <= 200 ? hashTrustedDeviceToken(token) : null;
  const devices = await prisma.trustedDevice.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    take: 50,
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true, tokenHash: true },
  });
  return NextResponse.json({
    devices: devices.map(({ tokenHash, ...device }) => ({ ...device, current: currentHash !== null && tokenHash === currentHash })),
  }, { headers: noStore });
}

export async function DELETE(request: Request) {
  const user = await getMobileBearerUser(request);
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401, headers: noStore });
  const removed = await revokeUserTrustedDevices(user.id, { request, reason: "removidos pelo usuário no app mobile" });
  return NextResponse.json({ success: true, removed }, { headers: noStore });
}