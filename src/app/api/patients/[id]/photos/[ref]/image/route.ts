import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { contentDisposition } from "@/lib/clinical-files-rules";
import { recordReadAudit } from "@/lib/clinical-files-server";
import { decodeRefParam } from "@/lib/photo-gallery-rules";
import { loadPhotoBytes } from "@/lib/photo-image";

const json = (message: string, status: number) => Response.json({ message }, { status });
const extension: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
// Janela de deduplicação da trilha de visualização por usuário+foto (miniaturas e reaberturas contam uma vez).
const viewDedupeMinutes = 10;

// Imagem binária de qualquer fonte, só para quem tem clinical:read. A visualização é SEMPRE auditada no servidor (não depende de
// parâmetro do cliente), com deduplicação por usuário+foto na janela acima. ?download=1 baixa e audita cada download.
// Sem cache compartilhado nem do navegador.
export async function GET(request: Request, { params }: { params: Promise<{ id: string; ref: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json("Não autenticado.", 401);
  if (!can(user.role, "clinical:read")) return json("Acesso restrito à equipe clínica.", 403);
  const { id: patientId, ref: rawRef } = await params;
  const ref = decodeRefParam(rawRef);
  if (!ref) return json("Referência inválida.", 400);
  const photo = await loadPhotoBytes(user.clinicId, patientId, ref);
  if (!photo) return json("Foto não encontrada.", 404);
  const download = new URL(request.url).searchParams.get("download") === "1";
  // Fotos da galeria são auditadas pelo id puro, como upload/arquivar/excluir; fontes antigas, pela ref.
  await recordReadAudit(user, patientId, "PHOTO", ref.startsWith("gallery:") ? ref.slice("gallery:".length) : ref, download ? "DOWNLOAD" : "VIEW", { fileName: photo.name }, download ? 0 : viewDedupeMinutes);
  return new Response(photo.bytes as Uint8Array<ArrayBuffer>, {
    headers: { "Content-Type": photo.mime, "Content-Length": String(photo.bytes.length), "Content-Disposition": contentDisposition(photo.name, extension[photo.mime] ?? "jpg", download), "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" },
  });
}
