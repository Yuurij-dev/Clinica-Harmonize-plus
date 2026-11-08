import { NextResponse } from "next/server";
import { adminUser } from "@/lib/api-guards";
import { buildInviteUrl, canRevealInviteUrl, isInviteDeliveryReady, sendInvitationEmail } from "@/lib/email";
import { deliverInvitation, resendInvitation } from "@/lib/invitations";
import { prismaInvitationRepo } from "@/lib/invitations-db";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await adminUser(true, "settings:team");
  if ("error" in session) return session.error;
  const { user } = session;
  const { id } = await params;
  const result = await resendInvitation(prismaInvitationRepo, { clinicId: user.clinicId, id, deliveryReady: isInviteDeliveryReady() });
  const noStore = { "Cache-Control": "no-store" };
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status, headers: noStore });

  const delivery = await deliverInvitation(
    { buildUrl: buildInviteUrl, send: sendInvitationEmail, revealUrl: canRevealInviteUrl() },
    { token: result.token, email: result.email, role: result.role, clinicName: user.clinic.name, inviterName: user.name },
  );
  return NextResponse.json({ invitation: result.invitation, ...delivery }, { headers: noStore });
}
