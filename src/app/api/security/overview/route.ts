import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { mfaRequiredForMemberships } from "@/lib/mfa-rules";
import { prisma } from "@/lib/prisma";
import { noStore, requireSecurityUser } from "@/lib/security-api";
import { maskIp } from "@/lib/security-events";
import { TRUSTED_DEVICE_COOKIE, hashTrustedDeviceToken } from "@/lib/trusted-device-rules";
import { deviceLabel, parseUserAgent } from "@/lib/user-agent";

// Estado de segurança do próprio usuário. Sem hashes, segredos nem IP completo (ipMasked).
export async function GET(request: Request) {
  const { user, error } = await requireSecurityUser(request, { allowMfaSetup: true });
  if (error) return error;
  const now = new Date();

  const trustedToken = (await cookies()).get(TRUSTED_DEVICE_COOKIE)?.value;
  const [setting, memberships, remaining, devices, sessions] = await Promise.all([
    prisma.mfaSetting.findUnique({ where: { userId: user.id }, select: { enabledAt: true } }),
    prisma.clinicMembership.findMany({ where: { userId: user.id }, select: { role: true, isOwner: true } }),
    prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } }),
    prisma.trustedDevice.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastUsedAt: "desc" },
      take: 50,
      select: { id: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true, tokenHash: true },
    }),
    prisma.authSession.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastSeenAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, userAgent: true, ip: true, trustedDeviceId: true },
    }),
  ]);
  const currentHash = trustedToken && trustedToken.length <= 200 ? hashTrustedDeviceToken(trustedToken) : null;

  return NextResponse.json({
    mfa: {
      enabled: Boolean(setting?.enabledAt),
      enabledAt: setting?.enabledAt ?? null,
      setupPending: Boolean(setting && !setting.enabledAt),
      required: mfaRequiredForMemberships(memberships),
      recoveryCodesRemaining: setting?.enabledAt ? remaining : 0,
    },
    trustedDevices: devices.map((device) => ({
      id: device.id,
      label: device.label,
      createdAt: device.createdAt,
      lastUsedAt: device.lastUsedAt,
      expiresAt: device.expiresAt,
      current: currentHash !== null && device.tokenHash === currentHash,
    })),
    sessions: sessions.map((session) => {
      const { browser, os } = parseUserAgent(session.userAgent);
      return {
        id: session.id,
        label: deviceLabel(session.userAgent),
        browser,
        os,
        ipMasked: maskIp(session.ip),
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        current: session.id === user.sessionId,
        trusted: session.trustedDeviceId !== null,
      };
    }),
  }, { headers: noStore });
}
