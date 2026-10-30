import type { EvaluationPhoto, PhotoAnnotation } from "./types";
import { labelLayout } from "@/lib/annotation-label-rules";

export type ExportOptions = {
  /** Desenhar as marcações (padrão: sim). Com `false` sai só a foto original. */
  marks?: boolean;
  /** Desenhar as legendas das marcações (padrão: sim); só vale com `marks`. */
  labels?: boolean;
};

/**
 * Foto + marcações (e legendas) em PNG, no tamanho original da foto.
 * A prévia salva e a galeria usam o padrão (tudo); o botão "Exportar PNG" da avaliação facial segue as chaves "Mostrar marcações / legendas" da tela.
 */
export async function renderExport(photo: EvaluationPhoto, options: ExportOptions = {}) {
  const { marks = true, labels = true } = options;
  const canvas = document.createElement("canvas");
  canvas.width = photo.width;
  canvas.height = photo.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a exportação.");
  const image = await getImageElement(photo.imageUrl);
  context.drawImage(image, 0, 0, photo.width, photo.height);
  if (marks) {
    photo.annotations.forEach((annotation) => drawAnnotation(context, annotation));
    if (labels) photo.annotations.forEach((annotation) => drawLabel(context, annotation, photo.width, photo.height));
  }
  return canvas.toDataURL("image/png");
}

function getImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawLabel(context: CanvasRenderingContext2D, annotation: PhotoAnnotation, photoWidth: number, photoHeight: number) {
  // Exportação em tamanho original: sem redução de tela, a letra é proporcional à foto.
  const layout = labelLayout(annotation, photoWidth, photoHeight, 0);
  if (!layout) return;
  const { pill, anchor, join, fontSize, text } = layout;
  context.save();
  context.lineCap = "round";
  context.lineWidth = Math.max(1.5, fontSize * 0.07);
  context.strokeStyle = annotation.color.toLowerCase() === "#ffffff" ? "#b9a7f5" : annotation.color;
  context.beginPath();
  context.moveTo(anchor.x, anchor.y);
  context.lineTo(join.x, join.y);
  context.stroke();
  const radius = pill.height / 2;
  context.beginPath();
  context.moveTo(pill.x + radius, pill.y);
  context.arcTo(pill.x + pill.width, pill.y, pill.x + pill.width, pill.y + pill.height, radius);
  context.arcTo(pill.x + pill.width, pill.y + pill.height, pill.x, pill.y + pill.height, radius);
  context.arcTo(pill.x, pill.y + pill.height, pill.x, pill.y, radius);
  context.arcTo(pill.x, pill.y, pill.x + pill.width, pill.y, radius);
  context.closePath();
  context.fillStyle = "#f3efff";
  context.fill();
  context.lineWidth = Math.max(1, fontSize * 0.06);
  context.strokeStyle = "#b9a7f5";
  context.stroke();
  context.fillStyle = "#5b21b6";
  context.font = `600 ${fontSize}px Inter, Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, pill.x + pill.width / 2, pill.y + pill.height / 2);
  context.restore();
}

function drawAnnotation(context: CanvasRenderingContext2D, annotation: PhotoAnnotation) {
  context.save();
  context.strokeStyle = annotation.color;
  context.fillStyle = annotation.color;
  context.lineWidth = annotation.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (annotation.type === "text") {
    context.textBaseline = "top"; // y é o topo do texto, como no editor
    context.font = `${annotation.fontSize}px Inter, Arial, sans-serif`;
    context.fillText(annotation.text, annotation.x, annotation.y);
    context.restore();
    return;
  }

  if (annotation.type === "point") {
    context.beginPath();
    context.arc(annotation.x, annotation.y, annotation.radius, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = Math.max(1, annotation.strokeWidth);
    context.strokeStyle = "#ffffff";
    context.stroke();
    context.restore();
    return;
  }

  if (annotation.type === "ellipse" || annotation.type === "rectangle" || annotation.type === "triangle") {
    const left = Math.min(annotation.x, annotation.x + annotation.width);
    const top = Math.min(annotation.y, annotation.y + annotation.height);
    const boxWidth = Math.abs(annotation.width);
    const boxHeight = Math.abs(annotation.height);
    context.beginPath();
    if (annotation.type === "ellipse") {
      context.ellipse(left + boxWidth / 2, top + boxHeight / 2, boxWidth / 2, boxHeight / 2, 0, 0, Math.PI * 2);
    } else if (annotation.type === "rectangle") {
      context.rect(left, top, boxWidth, boxHeight);
    } else {
      context.moveTo(left + boxWidth / 2, top);
      context.lineTo(left + boxWidth, top + boxHeight);
      context.lineTo(left, top + boxHeight);
      context.closePath();
    }
    context.stroke();
    context.restore();
    return;
  }

  if (annotation.points.length < 4) {
    context.restore();
    return;
  }
  context.beginPath();
  context.moveTo(annotation.points[0], annotation.points[1]);
  for (let index = 2; index < annotation.points.length; index += 2) context.lineTo(annotation.points[index], annotation.points[index + 1]);
  context.stroke();

  if (annotation.type === "arrow") {
    const end = annotation.points.length - 2;
    const beforeEnd = Math.max(0, end - 2);
    const angle = Math.atan2(annotation.points[end + 1] - annotation.points[beforeEnd + 1], annotation.points[end] - annotation.points[beforeEnd]);
    const size = 14;
    context.beginPath();
    context.moveTo(annotation.points[end], annotation.points[end + 1]);
    context.lineTo(annotation.points[end] - size * Math.cos(angle - Math.PI / 6), annotation.points[end + 1] - size * Math.sin(angle - Math.PI / 6));
    context.lineTo(annotation.points[end] - size * Math.cos(angle + Math.PI / 6), annotation.points[end + 1] - size * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
  }
  context.restore();
}
