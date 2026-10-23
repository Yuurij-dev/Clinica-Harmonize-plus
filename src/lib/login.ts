import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";

const maxFailedLogins = 10;
const lockMinutes = 15;
// Hash descartável (custo 12, como os reais): usuário inexistente também paga um bcrypt compare, para não revelar por tempo se o e-mail existe.
const dummyHash = "$2b$12$1pnI5DgbUzucx00jr7W1tuKML9ukG7YnizYFDQLTJ.5bLXy.G0e/m";

export type LoginResult =
  | { ok: false; status: 400 | 401 | 403 | 429; message: string }
  | {
      ok: true;
      user: { id: string; name: string; email: string; mustChangePassword: boolean };
      role: "ADMIN" | "PROFESSIONAL" | "STAFF";
      clinic: { id: string; name: string; trialEndsAt: Date | null };
    };

// Validação de usuário/senha compartilhada pelo login da web (cookie) e do app (token): bloqueio de 10 falhas por 15 minutos incluso.
export async function authenticateLogin(rawLogin: unknown, rawPassword: unknown): Promise<LoginResult> {
  const login = typeof rawLogin === "string" ? rawLogin.trim().toLowerCase() : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";
  if (!login || !password) return { ok: false, status: 400, message: "Informe usuário e senha." };

  const user = await prisma.user.findUnique({
    where: { email: login },
    include: {
      memberships: {
        take: 1,
        orderBy: { id: "asc" },
        include: { clinic: { select: { id: true, name: true, trialEndsAt: true } } },
      },
    },
  });
  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return { ok: false, status: 429, message: `Muitas tentativas erradas. Tente de novo em ${lockMinutes} minutos.` };
  }
  if (!user || !(await compare(password, user.passwordHash))) {
    if (!user) await compare(password, dummyHash);
    if (user) {
      // Incremento atômico: tentativas simultâneas contam todas.
      const updated = await prisma.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
      if (updated.failedLogins >= maxFailedLogins) {
        await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + lockMinutes * 60_000) } });
      }
    }
    return { ok: false, status: 401, message: "Usuário ou senha inválidos." };
  }
  if (user.failedLogins || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  }
  const membership = user.memberships[0];
  if (!membership) return { ok: false, status: 403, message: "Este usuário ainda não está vinculado a uma clínica." };

  return {
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, mustChangePassword: user.mustChangePassword },
    role: membership.role,
    clinic: membership.clinic,
  };
}
