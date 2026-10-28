import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { checkUpload, maxUploadBytes } from "@/lib/clinical-files-rules";
import { readUploadForm, sha256 } from "@/lib/clinical-files-server";
import { prepareStorage, removeStoredBytes } from "@/lib/clinical-storage";
import { maxProcedureImagesPerClinic, procedureImageUrl } from "@/lib/procedure-image-rules";
import { purgeOrphanImages } from "@/lib/procedure-server";

const dimension = (value: FormDataEntryValue | null) => {
  const number = Number(value);
  return typeof value === "string" && Number.isInteger(number) && number >= 1 && number <= 8000 ? number : null;
};

// Upload de UMA imagem personalizada de procedimento (multipart, campo "file"). Só administradores.
// JPEG/PNG/WebP validados pelos bytes (SVG e demais formatos são recusados), até 4 MB. Devolve { id, url } para usar em imageAssetId.
export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "procedures:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const clinicId = user.clinicId;

  const read = await readUploadForm(request);
  if ("response" in read) return read.response;
  const file = read.form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Envie uma imagem." }, { status: 400 });
  if (file.size > maxUploadBytes) return NextResponse.json({ message: "A imagem excede 4 MB." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes, file.type || undefined, { imageOnly: true });
  if (!check.ok) return NextResponse.json({ message: check.status === 415 ? "Envie uma imagem JPEG, PNG ou WebP válida." : check.message }, { status: check.status });
  // O limite é conferido sem trava: envios simultâneos podem passar do teto por poucas unidades (aceito; o teto só limita abuso).
  await purgeOrphanImages(clinicId);
  if (await prisma.procedureImageAsset.count({ where: { clinicId } }) >= maxProcedureImagesPerClinic) {
    return NextResponse.json({ message: "Limite de imagens personalizadas atingido. Remova imagens não usadas." }, { status: 409 });
  }

  const id = crypto.randomUUID().replace(/-/g, "");
  const stored = await prepareStorage("procedure-image", clinicId, "procedure", id, bytes as Uint8Array<ArrayBuffer>, check.file.mime).catch(() => null);
  if (!stored) return NextResponse.json({ message: "Não foi possível gravar a imagem." }, { status: 502 });
  const created = await prisma.procedureImageAsset.create({
    data: { id, clinicId, mimeType: check.file.mime, sizeBytes: bytes.length, sha256: sha256(bytes), width: dimension(read.form.get("width")), height: dimension(read.form.get("height")), storageDriver: stored.storageDriver, storageKey: stored.storageKey, uploadedBy: user.id, blob: stored.blob },
    select: { id: true },
  }).catch(async (error) => { await removeStoredBytes(stored); throw error; });
  return NextResponse.json({ id: created.id, url: procedureImageUrl(created.id) }, { status: 201 });
}
