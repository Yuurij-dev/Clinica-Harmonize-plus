import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import type { ClinicProfile } from "@/lib/clinic-signup-rules";
import { getAuthSecret } from "@/lib/auth-secret";
import { prisma } from "@/lib/prisma";
import { createPasswordAccount, readLimitedJson } from "@/lib/signup-account";
import {
  INVALIDATED_AT,
  MAX_ATTEMPTS,
  MAX_BODY_BYTES,
  MAX_TOTAL_ATTEMPTS,
  canGuess,
  codeMatches,
  isValidCodeFormat,
  normalizeCode,
  passwordWithinBcryptLimit,
  windowEndsAt,
} from "@/lib/signup-verification-rules";

// Resposta UNICA para "sem pendente", "bloqueado", "expirado", "tentativas esgotadas" e "codigo errado".
const INVALID = "Código inválido ou expirado. Confira o código ou peça um novo.";
const invalid = () => NextResponse.json({ message: INVALID }, { status: 400 });
// Hash de mentira para a comparacao de custo igual quando nao ha pendente.
const DUMMY_HASH = "0".repeat(64);

function readProfile(value: unknown): ClinicProfile | null {
  const p = value as Partial<ClinicProfile> | null;
  if (!p || typeof p !== "object") return null;
  if (typeof p.clinicName !== "string" || typeof p.name !== "string" || typeof p.phone !== "string" || typeof p.profession !== "string" || typeof p.practiceArea !== "string" || typeof p.hasSecretary !== "boolean") return null;
  return { clinicName: p.clinicName, name: p.name, phone: p.phone, profession: p.profession, practiceArea: p.practiceArea, hasSecretary: p.hasSecretary };
}

// Etapa 2: confere o codigo e so entao cria a conta. Limites por janela de 24 h: 5 palpites por codigo
// e 15 acumulados (estourar 15 bloqueia ate o fim da janela). Contagem atomica antes de comparar.
// Body: { email, code, password }; sucesso exige codigo E senha corretos (senha errada = palpite errado, mesma resposta).
export async function POST(request: Request) {
  const read = await readLimitedJson(request, MAX_BODY_BYTES);
  if (read.tooLarge) return NextResponse.json({ message: "Requisição grande demais." }, { status: 413 });
  const body = read.body as { email?: unknown; code?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = normalizeCode(body?.code);
  if (!email || !isValidCodeFormat(code)) return NextResponse.json({ message: "Informe o código de 6 dígitos." }, { status: 400 });

  try {
    const secret = getAuthSecret();
    const now = new Date();
    const pending = await prisma.pendingSignup.findUnique({ where: { email } });
    const matches = codeMatches(code, email, pending?.codeHash || DUMMY_HASH, secret);
    if (!pending || !canGuess(pending, now)) return invalid();

    // Reserva o palpite de forma atomica (sem update que lanca): paralelismo nao burla os limites.
    const reserved = await prisma.pendingSignup.updateMany({
      where: { id: pending.id, lockedUntil: null, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS }, totalAttempts: { lt: MAX_TOTAL_ATTEMPTS } },
      data: { attempts: { increment: 1 }, totalAttempts: { increment: 1 } },
    });
    if (reserved.count === 0) return invalid();

    // A senha digitada no formulario tambem precisa bater com a do pendente (fecha o pre-hijack por sobrescrita).
    // O bcrypt so roda DEPOIS da reserva (max. 5 por codigo / 15 por janela), sem DoS de CPU; ausente/nao-string/>72 bytes conta como errada.
    const password = typeof body?.password === "string" && passwordWithinBcryptLimit(body.password) ? body.password : null;
    const passwordOk = password !== null && await compare(password, pending.passwordHash);

    if (!matches || !passwordOk) {
      const attempts = pending.attempts + 1;
      const totalAttempts = pending.totalAttempts + 1;
      if (totalAttempts >= MAX_TOTAL_ATTEMPTS) {
        // Bloqueia ate o fim da janela e inutiliza o codigo; a linha fica (os contadores sobrevivem).
        await prisma.pendingSignup.updateMany({ where: { id: pending.id }, data: { lockedUntil: windowEndsAt(pending.windowStartedAt), codeHash: "", expiresAt: INVALIDATED_AT } });
      } else if (attempts >= MAX_ATTEMPTS) {
        await prisma.pendingSignup.updateMany({ where: { id: pending.id }, data: { codeHash: "", expiresAt: INVALIDATED_AT } });
      }
      return invalid();
    }

    const profile = readProfile(pending.profile);
    if (!profile) {
      await prisma.pendingSignup.updateMany({ where: { id: pending.id }, data: { codeHash: "", expiresAt: INVALIDATED_AT } });
      return invalid();
    }

    const result = await createPasswordAccount({ email, passwordHash: pending.passwordHash, profile, pendingId: pending.id });
    if (result === "email_taken") {
      await prisma.pendingSignup.deleteMany({ where: { id: pending.id } });
      return NextResponse.json({ message: "Já existe uma conta com este e-mail." }, { status: 409 });
    }
    return NextResponse.json({ created: true }, { status: 201 });
  } catch (error) {
    console.error("[register-verify]", (error as { code?: unknown } | null)?.code);
    return NextResponse.json({ message: "Não foi possível verificar o código agora. Tente novamente." }, { status: 500 });
  }
}
