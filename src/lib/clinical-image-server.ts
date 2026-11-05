import sharp from "sharp";

const maxPixels = 25_000_000;
const maxSide = 8_000;

// Valida os bytes reais da imagem antes de armazená-la; dimensões do formulário são dados do cliente.
export async function inspectClinicalImage(bytes: Uint8Array, mime: string) {
  try {
    const image = sharp(bytes, { limitInputPixels: maxPixels, failOn: "error" });
    const metadata = await image.metadata();
    const expectedFormat = mime === "image/jpeg" ? "jpeg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : null;
    const { width, height, format } = metadata;
    if (!expectedFormat || format !== expectedFormat || !width || !height || width > maxSide || height > maxSide || width * height > maxPixels) return null;
    await sharp(bytes, { limitInputPixels: maxPixels, failOn: "error" }).stats();
    return { width, height };
  } catch {
    return null;
  }
}
