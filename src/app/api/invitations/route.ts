import { NextResponse } from "next/server";
import { adminUser } from "@/lib/api-guards";
import { buildInviteUrl, canRevealInviteUrl, isInviteDeliveryReady, sendInvitationEmail } from "@/lib/email";
import { createInvitation, deliverInvitation, listInvitations } from "@/lib/invitations";
import { prismaInvitationRepo } from "@/lib/invitations-db";

const permission = "settings:team";
const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await adminUser(true, permission);
  if ("error" in session) return session.error;
  // clinicId SEMPRE da sessao.
  const invitations = await listInvitations(prismaInvitationRepo, { clinicId: session.user.clinicId });
  return NextResponse.json({ invitations });
}

export async function POST(request: Request) {
  const session = await adminUser(true, permission);
  if ("error" in session) return session.error;
  const { user } = session;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  // Corpo so aceita email e role; qualquer outro campo (clinicId, permissions, status...) e recusado.
  if (!body || typeof body !== "object" || Object.keys(body).some((key) => key !== "email" && key !== "role")) {
    return NextResponse.json({ message: "Informe apenas e-mail e cargo." }, { status: 400, headers: noStore });
  }
  const result = await createInvitation(prismaInvitationRepo, { clinicId: user.clinicId, invitedById: user.id, email: body.email, role: body.role, deliveryReady: isInviteDeliveryReady() });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status, headers: noStore });

  const delivery = await deliverInvitation(
    { buildUrl: buildInviteUrl, send: sendInvitationEmail, revealUrl: canRevealInviteUrl() },
    { token: result.token, email: result.invitation.email, role: result.invitation.role, clinicName: user.clinic.name, inviterName: user.name },
  );
  return NextResponse.json({ invitation: result.invitation, ...delivery }, { status: 201, headers: noStore });
}
