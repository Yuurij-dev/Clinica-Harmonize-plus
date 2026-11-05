import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { inspectClinicalImage } from "../src/lib/clinical-image-server.ts";

const image = async (format, width = 320, height = 240) => {
  const pipeline = sharp({ create: { width, height, channels: 4, background: { r: 81, g: 71, b: 220, alpha: 1 } } });
  return format === "jpeg" ? pipeline.jpeg().toBuffer() : pipeline[format]().toBuffer();
};

test("valida e mede o conteúdo real de JPEG, PNG e WEBP", async () => {
  for (const [format, mime] of [["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]) {
    const bytes = await image(format);
    assert.deepEqual(await inspectClinicalImage(bytes, mime), { width: 320, height: 240 }, format);
  }
});

test("rejeita imagem corrompida, formato divergente e dimensões fora do limite", async () => {
  const png = await image("png");
  assert.equal(await inspectClinicalImage(png.subarray(0, 16), "image/png"), null, "truncada");
  assert.equal(await inspectClinicalImage(png, "image/jpeg"), null, "MIME divergente");
  assert.equal(await inspectClinicalImage(await image("png", 8_001, 1), "image/png"), null, "largura acima do limite");
  assert.equal(await inspectClinicalImage(Buffer.from("não é uma imagem"), "image/png"), null, "payload inválido");
});
