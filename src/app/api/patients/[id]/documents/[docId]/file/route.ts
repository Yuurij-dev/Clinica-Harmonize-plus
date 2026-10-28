import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { prisma } from "@/lib/prisma";
import { canViewDocumentCategory, contentDisposition } from "@/lib/clinical-files-rules";
import { recordReadAudit } from "@/lib/clinical-files-server";
import { readStoredBytes } from "@/lib/clinical-storage";

const json = (message: string, status: number) => Response.json({ message }, { status });
const extensions: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Visualização/baixa só por esta rota autenticada: sessão, clínica, paciente e categoria visível ao papel. Nunca há URL pública.
// ?download=1 baixa (DOWNLOAD). ?thumb=1 só vale para imagens e serve para a miniatura da lista, sem trilha de visualização
// (PDF ou outro tipo com thumb=1 é tratado como visualização normal e auditado). Sem cache compartilhado nem do navegador.
export async function GET(request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json("Não autenticado.", 401);
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const { id: patientId, docId } = await params;
  const row = await prisma.clinicalDocument.findFirst({ where: { id: docId, clinicId: user.clinicId, patientId }, select: { id: true, name: true, category: true, mimeType: true, storageDriver: true, storageKey: true } });
  if (!row || !canViewDocumentCategory(user.role, row.category, user.rolePermissions)) return json("Documento não encontrado.", 404);
  const bytes = await readStoredBytes("document", row.id, row);
  if (!bytes) return json("Arquivo indisponível.", 404);
  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const thumb = url.searchParams.get("thumb") === "1" && row.mimeType.startsWith("image/");
  if (!thumb) await recordReadAudit(user, patientId, "DOCUMENT", row.id, download ? "DOWNLOAD" : "VIEW", { fileName: row.name, category: row.category });
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": row.mimeType, "Content-Length": String(bytes.length), "Content-Disposition": contentDisposition(row.name, extensions[row.mimeType] ?? "bin", download),
      "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff",
    },
  });
}
