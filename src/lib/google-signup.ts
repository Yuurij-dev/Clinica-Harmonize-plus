import { clinicSlug, parseClinicProfile, trialWindow, type ClinicProfile } from "./clinic-signup-rules.ts";

// Cadastro de clinica nova via Google (usuario novo vira dono). A identidade ja foi provada no callback
// (cookie assinado `google_signup_pending`); aqui entram so os dados da clinica. Sem Next, sem Prisma.

export type PendingGoogleSignup = { sub: string; email: string; name: string };

export type SignupTx = {
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  findIdentity(sub: string): Promise<{ userId: string } | null>;
  // Cria Clinic + User ADMIN + UserIdentity(google) + ClinicMembership owner. Devolve o id do usuario.
  createClinicOwner(input: {
    clinicName: string;
    slug: string;
    trialStartedAt: Date;
    trialEndsAt: Date;
    user: Omit<ClinicProfile, "clinicName"> & { email: string; passwordHash: string };
    sub: string;
    now: Date;
  }): Promise<string>;
};

export type SignupRepo = { transaction<T>(fn: (tx: SignupTx) => Promise<T>): Promise<T> };

export type GoogleSignupResult =
  | { ok: true; userId: string }
  | { ok: false; code: "invalid_profile"; message: string }
  | { ok: false; code: "account_exists" };

const isP2002 = (error: unknown) => (error as { code?: unknown } | null)?.code === "P2002";

export async function completeGoogleSignup(
  repo: SignupRepo,
  input: { pending: PendingGoogleSignup; profile: Record<string, unknown> | null; makePasswordHash: () => Promise<string>; newSuffix: () => string },
  now: Date = new Date(),
): Promise<GoogleSignupResult> {
  const parsed = parseClinicProfile(input.profile);
  if (!parsed.ok) return { ok: false, code: "invalid_profile", message: parsed.message };
  const { clinicName, ...personal } = parsed.value;
  // bcrypt (caro) so depois de o perfil passar.
  const passwordHash = await input.makePasswordHash();
  try {
    return await repo.transaction(async (tx): Promise<GoogleSignupResult> => {
      // E-mail e sub vem so do cookie assinado (Google verificado). Nunca vincula a conta existente (pre-hijacking).
      const [byEmail, identity] = await Promise.all([tx.findUserByEmail(input.pending.email), tx.findIdentity(input.pending.sub)]);
      if (byEmail || identity) return { ok: false, code: "account_exists" };
      const userId = await tx.createClinicOwner({
        clinicName,
        slug: clinicSlug(clinicName, input.newSuffix()),
        ...trialWindow(now),
        user: { ...personal, email: input.pending.email, passwordHash },
        sub: input.pending.sub,
        now,
      });
      return { ok: true, userId };
    });
  } catch (error) {
    // Corrida: outro cadastro com o mesmo e-mail/sub entre o find e o create.
    if (isP2002(error)) return { ok: false, code: "account_exists" };
    throw error;
  }
}
