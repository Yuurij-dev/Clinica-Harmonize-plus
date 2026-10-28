import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { parseClockMinutes } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const cnpj = typeof body?.cnpj === "string" ? body.cnpj.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const openingTime = typeof body?.openingTime === "string" ? body.openingTime : "";
  const closingTime = typeof body?.closingTime === "string" ? body.closingTime : "";
  const openingMinutes = parseClockMinutes(openingTime);
  const closingMinutes = parseClockMinutes(closingTime);

  if (name.length < 2 || name.length > 120 || cnpj.length > 24 || phone.length > 32 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || address.length > 240 || openingMinutes === null || closingMinutes === null || closingMinutes <= openingMinutes) {
    return NextResponse.json({ message: "Confira os dados e os horários informados." }, { status: 400 });
  }

  const settings = await prisma.clinic.update({
    where: { id: user.clinicId },
    data: { name, cnpj: cnpj || null, phone: phone || null, email: email || null, address: address || null, openingTime, closingTime },
    select: { name: true, cnpj: true, phone: true, email: true, address: true, openingTime: true, closingTime: true },
  });
  return NextResponse.json({ settings });
}
