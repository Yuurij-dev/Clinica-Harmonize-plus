// Criacao da conta (Clinic + User + Membership) do cadastro com senha. Usada pela verificacao do codigo
// e pelo cadastro direto (sem provedor de e-mail, fora de producao).
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { clinicSlug, trialWindow, type ClinicProfile } from "@/lib/clinic-signup-rules";
import { prisma } from "@/lib/prisma";

export type CreateAccountResult = "created" | "email_taken";

export async function createPasswordAccount(
  input: { email: string; passwordHash: string; profile: ClinicProfile; pendingId?: string },
): Promise<CreateAccountResult> {
  const { email, passwordHash, profile, pendingId } = input;
  const slug = clinicSlug(profile.clinicName, randomUUID());
  const { trialStartedAt, trialEndsAt } = trialWindow(new Date());
  try {
    await prisma.$transaction(async (transaction) => {
      const clinic = await transaction.clinic.create({ data: { name: profile.clinicName, slug, trialStartedAt, trialEndsAt } });
      const createdUser = await transaction.user.create({
        data: {
          name: profile.name,
          email,
          passwordHash,
          emailVerifiedAt: new Date(),
          role: "ADMIN",
        },
      });
      await transaction.clinicMembership.create({
        data: { userId: createdUser.id, clinicId: clinic.id, role: "ADMIN", isOwner: true },
      });
      if (pendingId) await transaction.pendingSignup.deleteMany({ where: { id: pendingId } });
    });
    return "created";
  } catch (error) {
    // Corrida: outro cadastro com o mesmo e-mail entre o find e o create.
    // So o e-mail: outra unique (se o schema ganhar uma) cai no 500 generico do chamador.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = error.meta?.target;
      const onEmail = Array.isArray(target) ? target.includes("email") : typeof target === "string" && target.includes("email");
      if (onEmail) return "email_taken";
    }
    throw error;
  }
}

// Le o corpo JSON com teto de tamanho (content-length e texto). tooLarge => o chamador responde 413.
export async function readLimitedJson(request: Request, maxBytes: number): Promise<{ tooLarge: true } | { tooLarge: false; body: unknown }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };
  const text = await request.text().catch(() => "");
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { tooLarge: true };
  try { return { tooLarge: false, body: JSON.parse(text) }; } catch { return { tooLarge: false, body: null }; }
}
