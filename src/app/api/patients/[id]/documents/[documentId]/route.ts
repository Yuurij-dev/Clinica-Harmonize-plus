import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const { id: patientId, documentId } = await params;
  const document = await prisma.patientDocument.findFirst({ where: { id: documentId, patientId, clinicId: user.clinicId }, select: { name: true, mimeType: true, fileData: true } });
  if (!document?.fileData || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(document.mimeType)) {
    return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
  }
  const encoded = document.fileData.split(",", 2)[1];
  if (!encoded) return NextResponse.json({ message: "Arquivo inválido." }, { status: 404 });
  const bytes = Buffer.from(encoded, "base64");
  const filename = encodeURIComponent(document.name).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16)}`);
  return new Response(bytes, { headers: {
    "Content-Type": document.mimeType,
    "Content-Length": String(bytes.byteLength),
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
