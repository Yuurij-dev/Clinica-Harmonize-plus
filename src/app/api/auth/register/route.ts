import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { parseClinicProfile } from "@/lib/clinic-signup-rules";
import { getAuthSecret } from "@/lib/auth-secret";
import { PASSWORD_RULE_MESSAGE, isStrongPassword } from "@/lib/password-rules";
import { isEmailDeliveryReady, sendSignupCodeEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { createPasswordAccount, readLimitedJson } from "@/lib/signup-account";
import {
  CODE_TTL_MS,
  INVALIDATED_AT,
  MAX_BODY_BYTES,
  expiresAtFrom,
  generateCode,
  hashCode,
  isPlausibleEmail,
  passwordWithinBcryptLimit,
  registerDecision,
  signupDeliveryMode,
  windowCutoff,
} from "@/lib/signup-verification-rules";

const EMAIL_EXISTS = "Já existe uma conta com este e-mail.";
// Mensagem unica para toda negativa de envio (bloqueio, codigo ainda valido, cooldown, limite, corrida): nao distingue casos.
const GENERIC_429 = "Não foi possível enviar um novo código agora. Verifique seu e-mail ou tente novamente em alguns minutos.";
const generic429 = () => NextResponse.json({ message: GENERIC_429 }, { status: 429 });

// Etapa 1 do cadastro com senha: valida, guarda o cadastro pendente e envia o codigo por e-mail.
// A conta (Clinic/User) so e criada em /api/auth/register/verify. Sem provedor de e-mail: fora de producao
// cria direto (dev/e2e); em producao responde 503.
// Limitacao conhecida: sem rate limit por IP no repo; cada e-mail-alvo fica limitado a 6 envios/24 h.
export async function POST(request: Request) {
  const read = await readLimitedJson(request, MAX_BODY_BYTES);
  if (read.tooLarge) return NextResponse.json({ message: "Requisição grande demais." }, { status: 413 });
  const body = read.body as {
    clinicName?: string;
    name?: string;
    email?: string;
    password?: string;
  } | null;

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const parsed = parseClinicProfile(body);
  if (!parsed.ok && parsed.code === "clinic_name") {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  if (!parsed.ok || !email || !password) {
    return NextResponse.json({ message: "Preencha todos os campos." }, { status: 400 });
  }
  if (!isStrongPassword(password)) return NextResponse.json({ message: PASSWORD_RULE_MESSAGE }, { status: 400 });
  if (!passwordWithinBcryptLimit(password)) return NextResponse.json({ message: "A senha pode ter no máximo 72 bytes (cerca de 72 caracteres, menos se usar acentos ou emojis)." }, { status: 400 });
  if (!isPlausibleEmail(email)) return NextResponse.json({ message: "Digite um e-mail válido." }, { status: 400 });
  const profile = parsed.value;

  const mode = signupDeliveryMode(process.env, isEmailDeliveryReady());
  if (mode === "unavailable") {
    return NextResponse.json({ message: "Cadastro indisponível: envio de e-mail não configurado." }, { status: 503 });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return NextResponse.json({ message: EMAIL_EXISTS }, { status: 409 });

    if (mode === "direct") {
      const passwordHash = await hash(password, 12);
      const result = await createPasswordAccount({ email, passwordHash, profile });
      if (result === "email_taken") return NextResponse.json({ message: EMAIL_EXISTS }, { status: 409 });
      return NextResponse.json({ created: true }, { status: 201 });
    }

    const now = new Date();
    // Limpeza oportunista (sem cron): so some o pendente cuja janela de 24 h acabou; o codigo expirado mantem os contadores.
    await prisma.pendingSignup.deleteMany({ where: { windowStartedAt: { lt: windowCutoff(now) } } });

    const pending = await prisma.pendingSignup.findUnique({
      where: { email },
      select: { id: true, expiresAt: true, lastSentAt: true, sends: true, windowStartedAt: true, lockedUntil: true },
    });
    const decision = registerDecision(pending, now);
    if (decision === "reject") return generic429();

    const passwordHash = await hash(password, 12);
    const code = generateCode();
    const codeHash = hashCode(code, email, getAuthSecret());
    const data = { passwordHash, profile: profile as unknown as Prisma.InputJsonValue, codeHash, expiresAt: expiresAtFrom(now), attempts: 0, lastSentAt: now };

    let pendingId: string;
    if (!pending || decision === "restart") {
      if (pending) await prisma.pendingSignup.deleteMany({ where: { id: pending.id, windowStartedAt: pending.windowStartedAt } });
      try {
        pendingId = (await prisma.pendingSignup.create({ data: { email, ...data, sends: 1, windowStartedAt: now }, select: { id: true } })).id;
      } catch (error) {
        // Corrida: outro cadastro criou o pendente entre o find e o create.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return generic429();
        throw error;
      }
    } else {
      // Sobrescrita atomica: so se nada mudou desde a leitura (codigo expirado, sem bloqueio, mesmo envio).
      const updated = await prisma.pendingSignup.updateMany({
        where: { id: pending.id, lastSentAt: pending.lastSentAt, expiresAt: pending.expiresAt, lockedUntil: null, sends: pending.sends },
        data: { ...data, sends: { increment: 1 } },
      });
      if (updated.count === 0) return generic429();
      pendingId = pending.id;
    }

    const sent = await sendSignupCodeEmail({ to: email, code, ttlMinutes: CODE_TTL_MS / 60_000 });
    if (!sent.sent) {
      // Mantem a linha e os contadores; so invalida o codigo que o usuario nunca recebeu.
      await prisma.pendingSignup.updateMany({ where: { id: pendingId }, data: { codeHash: "", expiresAt: INVALIDATED_AT } });
      return NextResponse.json({ message: "Não foi possível enviar o código de verificação agora. Tente novamente em instantes." }, { status: 502 });
    }
    return NextResponse.json({ verificationRequired: true, email });
  } catch (error) {
    console.error("[register]", (error as { code?: unknown } | null)?.code);
    return NextResponse.json({ message: "Não foi possível criar a conta agora. Tente novamente." }, { status: 500 });
  }
}
