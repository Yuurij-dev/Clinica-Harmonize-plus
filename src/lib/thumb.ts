export const thumbMaxSide = 480;
export const thumbQuality = 72;

// sharp é dependência direta (também usada pelo Next na otimização de imagens).
// Por isso tudo aqui degrada: sem sharp a rota entrega o original e o upload mantém as dimensões declaradas.

// Miniatura JPEG (lado maior <= 480 px) com sharp. Se o sharp não carregar ou a imagem não decodificar, devolve null
// e a rota entrega o original.
export async function makeThumbnail(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { default: sharp } = await import("sharp");
    const output = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "none" })
      .rotate()
      .resize({ width: thumbMaxSide, height: thumbMaxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: thumbQuality })
      .toBuffer();
    return new Uint8Array(output);
  } catch {
    return null;
  }
}

// Largura/altura reais (já com a orientação EXIF aplicada) lidas só do cabeçalho. null se o sharp não está disponível ou não lê a imagem.
export async function readImageSize(bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const { width, height, orientation } = await sharp(bytes, { failOn: "none" }).metadata();
    if (!width || !height) return null;
    return orientation && orientation >= 5 ? { width: height, height: width } : { width, height };
  } catch {
    return null;
  }
}
