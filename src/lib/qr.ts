import QRCode from "qrcode";

/** QR em SVG gerado no servidor: o segredo do 2FA nunca vai a servico externo. */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
}
