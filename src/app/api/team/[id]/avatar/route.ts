import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const json = (message: string, status: number) => Response.json({ message }, { status });
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });

async function findMember(id: string, clinicId: string) {
  return prisma.clinicMembership.findFirst({ where: { id, clinicId }, select: { id: true, userId: true, isOwner: true } });
}

// Foto do colaborador: miniatura servida sob demanda; listas nunca carregam bytes.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json("Não autenticado.", 401);
  const member = await findMember((await params).id, user.clinicId);
  if (!member) return json("Colaborador não encontrado nesta clínica.", 404);
  const avatar = await prisma.userAvatar.findUnique({ where: { userId: member.userId }, select: { data: true } });
  if (!avatar) return noContent();
  const bytes = new Uint8Array(avatar.data);
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
}

// Mesma regra do PATCH de dados: admin edita membros só desta clínica; owner só a si; conta compartilhada com outra clínica só o próprio.
async function authorize(id: string) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return { error: json("Não autenticado.", 401) };
  const member = await findMember(id, user.clinicId);
  const isSelf = member?.userId === user.id;
  if (!isSelf && !canForUser(user, "settings:team")) return { error: json("Apenas administradores podem alterar os dados da equipe.", 403) };
  if (!member) return { error: json("Colaborador não encontrado nesta clínica.", 404) };
  if (!isSelf) {
    if (member.isOwner) return { error: json("Só o administrador principal pode editar os próprios dados.", 403) };
    if (await prisma.clinicMembership.count({ where: { userId: member.userId, clinicId: { not: user.clinicId } } }) > 0) return { error: json("Este colaborador também atua em outra clínica. Apenas ele pode alterar a própria foto.", 403) };
  }
  return { member };
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

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize((await params).id);
  if (auth.error) return auth.error;
  // Exige Content-Length válido: sem ele (chunked) o corpo inteiro seria lido em memória antes do limite.
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) return json("Requisição inválida.", 411);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return json("A imagem deve ter até 5 MB.", 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type)) return json("Envie uma imagem (JPG, PNG ou WebP).", 400);
  if (file.size > MAX_UPLOAD_BYTES) return json("A imagem deve ter até 5 MB.", 413);
  const data = await makeAvatar(new Uint8Array(await file.arrayBuffer()));
  if (!data) return json("Não foi possível ler esta imagem. Tente outro arquivo.", 400);
  const bytes = data;
  await prisma.userAvatar.upsert({ where: { userId: auth.member.userId }, create: { userId: auth.member.userId, data: bytes }, update: { data: bytes } });
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize((await params).id);
  if (auth.error) return auth.error;
  await prisma.userAvatar.deleteMany({ where: { userId: auth.member.userId } });
  return Response.json({ ok: true });
}
