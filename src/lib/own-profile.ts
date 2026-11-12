import { isGoogleOnlyAccount } from "./mfa-rules";
import { maskCpf } from "./own-profile-rules";
import { prisma } from "./prisma";

// Dados do PRÓPRIO usuário para /api/me e /api/me/profile. O userId vem sempre da sessão.
// Nunca devolve hash, tokens nem o CPF completo.

export type OwnProfile = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "PROFESSIONAL" | "STAFF";
  isOwner: boolean;
  phone: string | null;
  cpf: string | null;
  postalCode: string | null;
  address: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  hasAvatar: boolean;
  avatarVersion: string | null;
  createdAt: string;
  clinics: Array<{ id: string; name: string; role: string; isOwner: boolean }>;
  activeClinicId: string;
  hasPassword: boolean;
  canChangePassword: boolean;
  mfa: { enabled: boolean };
};

export async function loadOwnProfile(session: { id: string; role: OwnProfile["role"]; isOwner: boolean; clinicId: string }): Promise<OwnProfile | null> {
  const row = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true, name: true, email: true, phone: true, cpf: true, postalCode: true, address: true, country: true, state: true, city: true, createdAt: true,
      avatar: { select: { updatedAt: true } },
      mfaSetting: { select: { enabledAt: true } },
      identities: { where: { provider: "google" }, select: { createdAt: true }, take: 1 },
      memberships: { orderBy: { id: "asc" }, select: { role: true, isOwner: true, clinic: { select: { id: true, name: true } } } },
    },
  });
  if (!row) return null;
  const googleOnly = isGoogleOnlyAccount(row.createdAt, row.identities[0]?.createdAt);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: session.role,
    isOwner: session.isOwner,
    phone: row.phone,
    cpf: maskCpf(row.cpf),
    postalCode: row.postalCode,
    address: row.address,
    country: row.country,
    state: row.state,
    city: row.city,
    hasAvatar: Boolean(row.avatar),
    avatarVersion: row.avatar?.updatedAt.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    clinics: row.memberships.map((membership) => ({ id: membership.clinic.id, name: membership.clinic.name, role: membership.role, isOwner: membership.isOwner })),
    activeClinicId: session.clinicId,
    hasPassword: !googleOnly,
    canChangePassword: !googleOnly,
    mfa: { enabled: Boolean(row.mfaSetting?.enabledAt) },
  };
}
