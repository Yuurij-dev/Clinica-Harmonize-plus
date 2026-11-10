// Layout compartilhado dos e-mails transacionais (Harmonize+). HTML em tabela com CSS inline,
// compatível com Gmail/Outlook/Apple Mail, sem imagens remotas, sem JavaScript, responsivo.
// Paleta da marca (globals.css). Todo valor dinâmico passa por escapeHtml.
export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type Block = { html: string; text: string };
export type Row = [label: string, value: string];
export type Tone = "brand" | "success" | "danger";

const C = {
  page: "#f8f9fc",
  headerBg: "#f1f0ff",
  card: "#ffffff",
  border: "#e5e7ef",
  soft: "#f1f0ff",
  text: "#191a2e",
  muted: "#77788a",
  brand: "#5147dc",
  logoInk: "#0f081a",
  success: "#16805d",
  danger: "#b42318",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,Helvetica,sans-serif";
const toneColor: Record<Tone, string> = { brand: C.brand, success: C.success, danger: C.danger };
const toneBg: Record<Tone, string> = { brand: "#f1f0ff", success: "#e7f4ef", danger: "#fdecea" };

const wordmark = (size: number) =>
  `<span style="font-family:${FONT};font-size:${size}px;font-weight:700;letter-spacing:0.2px;color:${C.logoInk};">Harmonize<span style="color:${C.brand};">+</span></span>`;

// Título da mensagem.
export function heading(text: string): Block {
  return {
    html: `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:21px;line-height:1.3;font-weight:700;color:${C.text};">${escapeHtml(text)}</h1>`,
    text: `${text}\n`,
  };
}

// Parágrafo de texto (escapado).
export function paragraph(text: string): Block {
  return {
    html: `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.text};">${escapeHtml(text)}</p>`,
    text: `${text}\n`,
  };
}

// Card com pares rótulo/valor empilhados (bom no mobile).
export function infoCard(rows: Row[]): Block {
  const cells = rows
    .map(
      ([label, value], index) =>
        `<tr><td style="padding:${index === 0 ? "0" : "12px"} 0 0;font-family:${FONT};">` +
        `<div style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted};">${escapeHtml(label)}</div>` +
        `<div style="margin-top:3px;font-size:16px;font-weight:700;color:${C.text};">${escapeHtml(value)}</div>` +
        `</td></tr>`,
    )
    .join("");
  const html =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border:1px solid ${C.border};border-radius:12px;background:${C.page};">` +
    `<tr><td style="padding:18px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cells}</table></td></tr></table>`;
  const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n") + "\n";
  return { html, text };
}

// Destaque grande e centralizado (ex.: novo horário, valor total).
export function highlight(label: string, value: string, tone: Tone = "brand"): Block {
  const color = toneColor[tone];
  const html =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border-radius:12px;background:${toneBg[tone]};">` +
    `<tr><td style="padding:18px 20px;text-align:center;font-family:${FONT};">` +
    `<div style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${color};">${escapeHtml(label)}</div>` +
    `<div style="margin-top:4px;font-size:20px;font-weight:700;color:${color};">${escapeHtml(value)}</div>` +
    `</td></tr></table>`;
  return { html, text: `${label}: ${value}\n` };
}

// Botão "bulletproof" (tabela + âncora com padding), cor da marca.
export function button(href: string, label: string): Block {
  const html =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;"><tr>` +
    `<td align="center" bgcolor="${C.brand}" style="border-radius:8px;">` +
    `<a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>` +
    `</td></tr></table>`;
  return { html, text: `${label}: ${href}\n` };
}

// Observação pequena e discreta (validade, aviso).
export function note(text: string): Block {
  return {
    html: `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};">${escapeHtml(text)}</p>`,
    text: `${text}\n`,
  };
}

function footer(clinic: { name: string; rows: Row[] } | undefined, automated: boolean): Block {
  // Site como texto puro (sem <a>): e-mails ao paciente ficam sem link, o que ajuda na entregabilidade.
  const parts: string[] = [
    `<div style="font-family:${FONT};">${wordmark(16)}</div>`,
    `<div style="font-family:${FONT};font-size:12px;color:${C.brand};margin-top:3px;">harmonizeplus.com.br</div>`,
  ];
  const textParts: string[] = ["Harmonize+", "harmonizeplus.com.br"];
  if (clinic) {
    const rows = [`<strong style="color:${C.text};">${escapeHtml(clinic.name)}</strong>`, ...clinic.rows.map(([l, v]) => `${escapeHtml(l)}: ${escapeHtml(v)}`)].join("<br>");
    parts.push(`<div style="height:1px;background:${C.border};max-width:220px;margin:16px auto;"></div>`);
    parts.push(`<div style="font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};">${rows}</div>`);
    textParts.push("", clinic.name, ...clinic.rows.map(([l, v]) => `${l}: ${v}`));
  }
  if (automated) {
    parts.push(`<div style="font-family:${FONT};font-size:11px;color:${C.muted};margin-top:16px;">Este é um e-mail automático. Não é necessário responder.</div>`);
    textParts.push("", "Este é um e-mail automático. Não é necessário responder.");
  }
  return { html: parts.join("\n"), text: textParts.join("\n") };
}

// Monta o e-mail completo (documento HTML + versão texto) a partir dos blocos.
export function composeEmail(opts: {
  preheader: string;
  greeting?: string;
  blocks: Block[];
  clinic?: { name: string; rows: Row[] };
  automated?: boolean;
}): { html: string; text: string } {
  const foot = footer(opts.clinic, opts.automated ?? true);
  const greetingHtml = opts.greeting ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.text};">Olá, ${escapeHtml(opts.greeting)},</p>` : "";
  const bodyHtml = [greetingHtml, ...opts.blocks.map((b) => b.html)].filter(Boolean).join("\n");
  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Harmonize+</title>
</head>
<body style="margin:0;padding:0;background:${C.page};color-scheme:light;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;font-size:1px;line-height:1px;">${escapeHtml(opts.preheader)}&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;border-collapse:separate;">
<tr><td style="background:${C.headerBg};border-radius:16px 16px 0 0;padding:24px 32px;text-align:center;">${wordmark(22)}</td></tr>
<tr><td style="background:${C.card};padding:36px 32px 28px;border-left:1px solid ${C.border};border-right:1px solid ${C.border};">${bodyHtml}</td></tr>
<tr><td style="background:${C.card};border-radius:0 0 16px 16px;border:1px solid ${C.border};border-top:0;padding:24px 32px 28px;text-align:center;">${foot.html}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  const greetingText = opts.greeting ? `Olá, ${opts.greeting},\n\n` : "";
  const text = `${greetingText}${opts.blocks.map((b) => b.text).join("\n")}\n${foot.text}`;
  return { html, text };
}
