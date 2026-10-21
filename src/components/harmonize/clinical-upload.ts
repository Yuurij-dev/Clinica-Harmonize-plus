import { maxUploadBytes } from "@/lib/clinical-files-rules";

// Utilitários de envio de documentos/fotos: compressão de imagem no cliente e POST com progresso por arquivo.

export type PreparedImage = { blob: Blob; width: number; height: number; name: string };

const maxSide = 1600;

function loadImage(file: Blob) {
  return new Promise<{ image: HTMLImageElement; url: string } | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    image.src = url;
  });
}

// Mesma regra das fotos de atendimento: até 1600 px e JPEG 0,82 quando o arquivo é grande. Imagem pequena segue como está.
export async function prepareImage(file: File): Promise<PreparedImage | { error: string }> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { error: "Formato não permitido. Use JPG, PNG ou WEBP." };
  const loaded = await loadImage(file);
  if (!loaded) return { error: "Não foi possível ler a imagem." };
  const { image, url } = loaded;
  try {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (file.size <= 500_000 && width <= maxSide && height <= maxSide) return file.size > maxUploadBytes ? { error: "A imagem excede 4 MB." } : { blob: file, width, height, name: file.name };
    const scale = Math.min(1, maxSide / width, maxSide / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return { error: "Não foi possível processar a imagem." };
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) return { error: "Não foi possível processar a imagem." };
    if (blob.size > maxUploadBytes) return { error: "A imagem excede 4 MB mesmo após a compressão." };
    return { blob, width: canvas.width, height: canvas.height, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function isImageFile(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

// POST multipart com progresso (fetch não expõe progresso de envio). Resolve com status e corpo JSON (ou null).
export function postForm(url: string, form: FormData, onProgress: (percent: number) => void) {
  return new Promise<{ ok: boolean; status: number; body: { message?: string } & Record<string, unknown> | null }>((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.withCredentials = true;
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => {
      let body: { message?: string } & Record<string, unknown> | null = null;
      try { body = JSON.parse(request.responseText); } catch { body = null; }
      resolve({ ok: request.status >= 200 && request.status < 300, status: request.status, body });
    };
    request.onerror = () => resolve({ ok: false, status: 0, body: { message: "Falha de conexão. Tente novamente." } });
    request.send(form);
  });
}

export async function sendJson(url: string, method: "PATCH" | "DELETE", body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = await response?.json().catch(() => null) as { message?: string } | null;
  return { ok: Boolean(response?.ok), message: data?.message ?? (response ? "Não foi possível concluir a ação." : "Falha de conexão.") };
}

export type UploadEntry = { id: string; name: string; status: "queued" | "uploading" | "done" | "error"; progress: number; error?: string };
