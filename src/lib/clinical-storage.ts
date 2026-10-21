import { prisma } from "./prisma";

// Armazenamento de bytes de documentos e fotos novas, atrás de uma interface simples.
// - driver "db" (padrão): bytes em ClinicalDocumentBlob/ClinicalPhotoBlob, separados dos metadados para listas nunca carregarem conteúdo.
// - driver "supabase" (desligado por padrão): bucket PRIVADO via REST, usado só se CLINICAL_STORAGE_DRIVER=supabase e as variáveis abaixo existirem.
//   Os bytes continuam passando pela rota autenticada do app (nunca há URL pública). Ainda não validado contra um projeto real.
// Cada linha guarda o driver com que foi gravada, então trocar o driver não quebra arquivos antigos.

export type StorageKind = "document" | "photo";
export type StoredRef = { storageDriver: string; storageKey: string | null };

type SupabaseConfig = { url: string; key: string; bucket: string };

function supabaseConfig(): SupabaseConfig | null {
  if (process.env.CLINICAL_STORAGE_DRIVER !== "supabase") return null;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.CLINICAL_STORAGE_BUCKET;
  return url && key && bucket ? { url: url.replace(/\/$/, ""), key, bucket } : null;
}

export function activeDriver(): "db" | "supabase" {
  return supabaseConfig() ? "supabase" : "db";
}

function objectUrl(config: SupabaseConfig, key: string) {
  return `${config.url}/storage/v1/object/${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export type PreparedStorage = { storageDriver: "db" | "supabase"; storageKey: string | null; blob: { create: { data: Uint8Array<ArrayBuffer> } } | undefined };

// Chamado antes de criar o registro. No driver db devolve o blob para o create aninhado (mesma transação); no supabase envia o objeto.
export async function prepareStorage(kind: StorageKind, clinicId: string, patientId: string, id: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<PreparedStorage> {
  const config = supabaseConfig();
  if (!config) return { storageDriver: "db", storageKey: null, blob: { create: { data: bytes } } };
  const key = `${clinicId}/${patientId}/${kind}/${id}`;
  const response = await fetch(objectUrl(config, key), { method: "POST", headers: { Authorization: `Bearer ${config.key}`, "Content-Type": mime, "x-upsert": "false" }, body: bytes });
  if (!response.ok) throw new Error("Falha ao gravar no armazenamento privado.");
  return { storageDriver: "supabase", storageKey: key, blob: undefined };
}

export async function readStoredBytes(kind: StorageKind, id: string, ref: StoredRef): Promise<Uint8Array | null> {
  if (ref.storageDriver === "supabase") {
    const config = supabaseConfig();
    if (!config || !ref.storageKey) return null;
    const response = await fetch(objectUrl(config, ref.storageKey), { headers: { Authorization: `Bearer ${config.key}` }, cache: "no-store" });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  }
  const row = kind === "document"
    ? await prisma.clinicalDocumentBlob.findUnique({ where: { documentId: id }, select: { data: true } })
    : await prisma.clinicalPhotoBlob.findUnique({ where: { photoId: id }, select: { data: true } });
  return row ? row.data : null;
}

// Remove os bytes de objeto externo. No driver db os bytes saem junto com o registro (cascata); aqui nada a fazer.
// Falha de remoção é registrada (sem segredo) para limpeza posterior; também serve para limpar objeto órfão quando o create no banco falha.
export async function removeStoredBytes(ref: StoredRef) {
  if (ref.storageDriver !== "supabase") return;
  const config = supabaseConfig();
  if (!config || !ref.storageKey) { console.error("[clinical-storage] remoção ignorada: driver supabase sem configuração", ref.storageKey); return; }
  try {
    const response = await fetch(objectUrl(config, ref.storageKey), { method: "DELETE", headers: { Authorization: `Bearer ${config.key}` } });
    if (!response.ok) console.error("[clinical-storage] remoção falhou", response.status, ref.storageKey);
  } catch {
    console.error("[clinical-storage] remoção falhou (rede)", ref.storageKey);
  }
}
