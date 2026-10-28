import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readStoredBytes } from "@/lib/clinical-storage";
import { isValidId } from "@/lib/procedure-catalog-rules";
import { deleteAssetIfUnused } from "@/lib/procedure-server";

const json = (message: string, status: number) => Response.json({ message }, { status });

// Imagem personalizada de procedimento, para qualquer papel autenticado DA MESMA clínica (a agenda mostra a imagem ao STAFF).
// O id nunca é reaproveitado, então o navegador pode manter cópia privada; nada é compartilhável entre clínicas.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json("Não autenticado.", 401);
  const id = (await params).id;
  if (!isValidId(id)) return json("Imagem não encontrada.", 404);
  const asset = await prisma.procedureImageAsset.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true, mimeType: true, storageDriver: true, storageKey: true } });
  if (!asset) return json("Imagem não encontrada.", 404);
  const bytes = await readStoredBytes("procedure-image", asset.id, asset);
  if (!bytes) return json("Imagem não encontrada.", 404);
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": asset.mimeType, "Content-Length": String(bytes.length), "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'",
    },
  });
}

// Remove uma imagem enviada que nenhum procedimento da clínica usa (ADMIN). Em uso → 409; de outra clínica ou inexistente → 404.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return json("Não autenticado.", 401);
  if (!canForUser(user, "procedures:manage")) return json("Acesso restrito a administradores.", 403);
  const id = (await params).id;
  if (!isValidId(id)) return json("Imagem não encontrada.", 404);
  // Apagadores concorrentes da mesma imagem: o perdedor reencontra a imagem já removida (404).
  const result = await deleteAssetIfUnused(user.clinicId, id);
  if (result === "missing") return json("Imagem não encontrada.", 404);
  if (result === "in-use") return json("A imagem está em uso por um procedimento.", 409);
  return Response.json({ ok: true });
}
