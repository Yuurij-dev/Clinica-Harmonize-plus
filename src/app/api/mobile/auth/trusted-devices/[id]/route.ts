import { NextResponse } from "next/server";
import { revokeTrustedDevice } from "@/lib/auth-session";
import { getMobileBearerUser } from "@/lib/mobile-bearer-user";

const noStore = { "Cache-Control": "no-store" };

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getMobileBearerUser(request);
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401, headers: noStore });
  const { id } = await params;
  if (id.includes(String.fromCharCode(0)) || id.length > 64) return NextResponse.json({ message: "Dispositivo não encontrado." }, { status: 404, headers: noStore });
  const device = await revokeTrustedDevice(user.id, id, request);
  if (!device) return NextResponse.json({ message: "Dispositivo não encontrado." }, { status: 404, headers: noStore });
  return NextResponse.json({ success: true }, { headers: noStore });
}