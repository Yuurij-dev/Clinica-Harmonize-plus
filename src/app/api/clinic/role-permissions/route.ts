import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, invalidateAllUserAuthCache } from "@/lib/auth";
import { canForUser, normalizeRolePermissionMatrix, permissionGroups, roles, type RolePermissionMatrix } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const permissionKeys = permissionGroups.flatMap((group) => group.permissions.map(({ key }) => key));

function isCompleteMatrix(value: unknown): value is RolePermissionMatrix {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const matrix = value as Record<string, unknown>;
  return roles.every((role) => {
    const rolePermissions = matrix[role];
    if (!rolePermissions || typeof rolePermissions !== "object" || Array.isArray(rolePermissions)) return false;
    const permissions = rolePermissions as Record<string, unknown>;
    return permissionKeys.every((key) => typeof permissions[key] === "boolean");
  });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:permissions")) return NextResponse.json({ message: "Acesso restrito à administração das permissões." }, { status: 403 });
  return NextResponse.json({ matrix: user.rolePermissions });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:permissions")) return NextResponse.json({ message: "Acesso restrito à administração das permissões." }, { status: 403 });

  const body = await request.json().catch(() => null) as { matrix?: unknown } | null;
  if (!isCompleteMatrix(body?.matrix)) return NextResponse.json({ message: "A matriz de permissões está incompleta ou inválida." }, { status: 400 });

  const matrix = normalizeRolePermissionMatrix(body.matrix);
  await prisma.clinic.update({ where: { id: user.clinicId }, data: { rolePermissions: matrix as Prisma.InputJsonValue }, select: { id: true } });
  invalidateAllUserAuthCache();
  return NextResponse.json({ matrix });
}
