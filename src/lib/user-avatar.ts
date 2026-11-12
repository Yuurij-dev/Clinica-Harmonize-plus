import { checkAvatarContentLength, checkAvatarFile } from "./avatar-upload-rules";
import { prisma } from "./prisma";

// Foto de perfil do usuário (UserAvatar): lógica única das rotas /api/team/[id]/avatar e /api/me/avatar.
// Quem chama decide QUEM pode mexer em qual usuário; aqui só se lê, valida, reduz e grava.

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const json = (message: string, status: number) => Response.json({ message }, { status, headers: noStoreHeaders });

// Miniatura servida sob demanda; listas nunca carregam bytes.
export async function readUserAvatar(userId: string, opts: { versioned?: boolean } = {}) {
  const avatar = await prisma.userAvatar.findUnique({ where: { userId }, select: { data: true } });
  if (!avatar) return new Response(null, { status: 204, headers: noStoreHeaders });
  const bytes = new Uint8Array(avatar.data);
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(bytes.length), "Cache-Control": opts.versioned ? "private, max-age=86400" : "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
}

async function makeAvatar(bytes: Uint8Array) {
  try {
    const { default: sharp } = await import("sharp");
    const result = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().resize({ width: 720, height: 720, fit: "cover", position: "attention", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return new Uint8Array(result);
  } catch {
    return null;
  }
}

export async function storeUserAvatar(request: Request, userId: string) {
  const lengthIssue = checkAvatarContentLength(request.headers.get("content-length"));
  if (lengthIssue) return json(lengthIssue.message, lengthIssue.status);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const fileIssue = checkAvatarFile(file instanceof File ? file : null);
  if (fileIssue || !(file instanceof File)) return json(fileIssue?.message ?? "Envie uma imagem (JPG, PNG ou WebP).", fileIssue?.status ?? 400);
  const bytes = await makeAvatar(new Uint8Array(await file.arrayBuffer()));
  if (!bytes) return json("Não foi possível ler esta imagem. Tente outro arquivo.", 400);
  await prisma.userAvatar.upsert({ where: { userId }, create: { userId, data: bytes }, update: { data: bytes } });
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}

export async function removeUserAvatar(userId: string) {
  await prisma.userAvatar.deleteMany({ where: { userId } });
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
