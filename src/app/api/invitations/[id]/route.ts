import { NextResponse } from "next/server";
import { adminUser } from "@/lib/api-guards";
import { cancelInvitation } from "@/lib/invitations";
import { prismaInvitationRepo } from "@/lib/invitations-db";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await adminUser(true, "settings:team");
  if ("error" in session) return session.error;
  const { id } = await params;
  const result = await cancelInvitation(prismaInvitationRepo, { clinicId: session.user.clinicId, id });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  return NextResponse.json({ ok: true });
}
