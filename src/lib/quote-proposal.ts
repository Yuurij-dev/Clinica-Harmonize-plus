// Proposta comercial em HTML para visualização e impressão A4.
// O helper é puro para continuar utilizável pelos fluxos de jornada e Financeiro.
import { resolveProcedureImage } from "./procedure-images.js";

export type StoredQuoteDetails = { items: Array<{ procedureId: string; name: string; quantity: number; unitPriceCents: number; discountCents: number; subtotalCents: number }>; subtotalCents: number; discountCents: number; totalCents: number; costTotalCents?: number; costs?: { laborCents: number; facilityCents: number; medicationCents: number } };

export type ProposalRow = {
  name: string;
  quantity: number;
  unitPriceCents: number | null;
  discountCents: number | null;
  subtotalCents: number | null;
  description?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
};

export type ProposalInput = {
  goal?: string | null;
  statusLabel: string;
  dateLabel: string;
  proposalNumber?: string | null;
  validUntil?: string | null;
  clinic?: {
    name?: string | null;
    logoUrl?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    social?: string | null;
    primaryColor?: string | null;
  };
  patient?: { name?: string | null; identifier?: string | null; cpf?: string | null };
  professional?: { name?: string | null; registration?: string | null; specialty?: string | null };
  rows: ProposalRow[];
  paymentMethod: string;
  installments: number;
  notes?: string | null;
  conditions?: {
    validity?: string | null;
    special?: string | null;
    appointment?: string | null;
    rescheduling?: string | null;
    cancellation?: string | null;
    observations?: string | null;
    paymentStatus?: string | null;
  };
  financial?: {
    subtotalCents?: number | null;
    discountCents?: number | null;
    additions?: Array<{ label: string; amountCents: number }>;
    totalCents?: number | null;
    compositionNote?: string | null;
  };
  harmonizeMarkUrl?: string | null;
  totalCents: number;
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function escapeHtml(value: string) {
  return value.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

const text = (value: unknown) => escapeHtml(String(value ?? ""));
const hasValue = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const money = (cents: number | null | undefined) => cents === null || cents === undefined || !Number.isFinite(Number(cents)) ? "—" : currency.format(Number(cents) / 100);
const sumKnown = (values: Array<number | null | undefined>) => values.every((value) => typeof value === "number" && Number.isFinite(value)) ? values.reduce<number>((total, value) => total + Number(value), 0) : null;
const installmentText = (totalCents: number, installments: number) => {
  const base = Math.floor(totalCents / installments);
  const remainder = totalCents - base * installments;
  if (remainder === 0) return `${installments}x de ${money(base)}`;
  const standardCount = installments - remainder;
  return `${installments}x (${standardCount}x de ${money(base)} e ${remainder}x de ${money(base + 1)})`;
};

function resolveImageUrl(value: string | null | undefined) {
  if (!hasValue(value)) return "";
  const raw = value.trim();
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z\d+/=\r\n]+$/i.test(raw)) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) {
    if (typeof window !== "undefined") return new URL(raw, window.location.origin).href;
    return raw;
  }
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || (url.protocol === "http:" && typeof window !== "undefined" && url.origin === window.location.origin)) return url.href;
  } catch { /* Invalid or relative non-root URLs are omitted. */ }
  return "";
}

function safeColor(value?: string | null) {
  return value && /^#[\da-f]{6}$/i.test(value) ? value : "#5147dc";
}

function imageTag(url: string | null | undefined, alt: string, className: string, fallback?: string) {
  const source = resolveImageUrl(url);
  if (!source) return fallback ? `<span class="${className} image-fallback" aria-label="${text(alt)}">${text(fallback)}</span>` : "";
  const placeholder = fallback ? `<span class="${className} image-fallback" aria-hidden="true">${text(fallback)}</span>` : "";
  return `<span class="image-frame ${className}">${placeholder}<img src="${text(source)}" alt="${text(alt)}" onerror="this.remove()"></span>`;
}

function detailLine(label: string, value?: string | null) {
  return hasValue(value) ? `<div class="detail-line"><span>${text(label)}</span><strong>${text(value.trim())}</strong></div>` : "";
}

export function buildQuoteProposalHtml(input: ProposalInput) {
  const primary = safeColor(input.clinic?.primaryColor);
  const clinicName = hasValue(input.clinic?.name) ? input.clinic!.name!.trim() : "";
  const markUrl = input.harmonizeMarkUrl === null ? "" : (input.harmonizeMarkUrl ?? "/brand/mark.svg");
  const clinicLogoUrl = resolveImageUrl(input.clinic?.logoUrl);
  const compactClass = input.rows.length <= 2 && !hasValue(input.goal) && !input.rows.some((item) => hasValue(item.description)) ? "compact" : "";
  const clinicLogo = clinicLogoUrl ? imageTag(clinicLogoUrl, clinicName || "Logo da clínica", "clinic-logo") : "";
  const mark = imageTag(markUrl, "Marca Harmonize+", "system-mark");
  const headerContacts = [input.clinic?.phone, input.clinic?.email, input.clinic?.address, input.clinic?.social].filter(hasValue);
  const headerIdentity = clinicLogo || (clinicName ? `<div class="clinic-name">${text(clinicName)}</div>` : "");
  const contactMarkup = headerContacts.map((value) => `<span>${text(value!.trim())}</span>`).join("");
  const proposalMeta = [
    detailLine("Proposta", input.proposalNumber),
    detailLine("Emissão", input.dateLabel),
    detailLine("Validade", input.validUntil ?? input.conditions?.validity),
  ].filter(Boolean).join("");
  const patientMarkup = input.patient && (hasValue(input.patient.name) || hasValue(input.patient.identifier))
    ? `<section class="identity-card"><span class="eyebrow">Paciente</span>${hasValue(input.patient.name) ? `<strong>${text(input.patient.name.trim())}</strong>` : ""}${detailLine("Identificação", input.patient.identifier)}${detailLine("CPF", input.patient.cpf)}</section>`
    : "";
  const professionalMarkup = input.professional && [input.professional.name, input.professional.registration, input.professional.specialty].some(hasValue)
    ? `<section class="identity-card"><span class="eyebrow">Profissional responsável</span>${hasValue(input.professional.name) ? `<strong>${text(input.professional.name.trim())}</strong>` : ""}${detailLine("Registro profissional", input.professional.registration)}${detailLine("Especialidade", input.professional.specialty)}</section>`
    : "";
  const goalMarkup = hasValue(input.goal) ? `<section class="goal"><span class="eyebrow">Objetivo do tratamento</span><p>${text(input.goal.trim())}</p></section>` : "";

  const rows = input.rows.map((item) => {
    const procedureImage = resolveProcedureImage(item.name, item.imageUrl);
    const image = resolveImageUrl(procedureImage.src);
    const alt = item.imageAlt ?? procedureImage.alt;
    return `<tr><td><div class="treatment-row">${image ? imageTag(image, alt, "row-image") : ""}<div><strong>${text(item.name)}</strong>${hasValue(item.description) ? `<small>${text(item.description.trim())}</small>` : ""}</div></div></td><td class="numeric">${text(item.quantity)}</td><td class="numeric">${money(item.unitPriceCents)}</td><td class="numeric">${money(item.discountCents)}</td><td class="numeric amount">${money(item.subtotalCents)}</td></tr>`;
  }).join("");
  const presentationRows = input.rows.filter((item) => hasValue(item.description) || resolveImageUrl(resolveProcedureImage(item.name, item.imageUrl).src));
  const presentationCards = presentationRows.map((item) => {
    const procedureImage = resolveProcedureImage(item.name, item.imageUrl);
    const image = imageTag(procedureImage.src, item.imageAlt ?? procedureImage.alt, "procedure-image", item.name.slice(0, 1));
    return `<article class="procedure-card">${image}<div><h3>${text(item.name)}</h3>${hasValue(item.description) ? `<p>${text(item.description.trim())}</p>` : ""}</div></article>`;
  });
  const presentationContent = presentationCards.length >= 8
    ? `<div class="presentation-grid">${presentationCards.slice(0, 6).join("")}</div><div class="presentation-grid presentation-grid-following">${presentationCards.slice(6).join("")}</div>`
    : `<div class="presentation-grid">${presentationCards.join("")}</div>`;
  const presentation = presentationRows.length ? `<section class="section procedure-section"><h2>Sobre os procedimentos</h2>${presentationContent}</section>` : "";
  const densePresentationClass = presentationRows.length >= 6 ? "dense-presentation" : "";

  const subtotal = input.financial?.subtotalCents ?? sumKnown(input.rows.map((item) => item.subtotalCents));
  const discount = input.financial?.discountCents ?? sumKnown(input.rows.map((item) => item.discountCents));
  const additions = (input.financial?.additions ?? []).filter((item) => hasValue(item.label) && Number.isFinite(item.amountCents));
  const total = input.financial?.totalCents ?? input.totalCents;
  const knownSubtotal = subtotal !== null ? subtotal : null;
  const knownDiscount = discount !== null ? discount : null;
  const knownAdditions = sumKnown(additions.map((item) => item.amountCents));
  const unexplained = knownSubtotal !== null && knownDiscount !== null && knownAdditions !== null
    ? total - knownSubtotal + knownDiscount - knownAdditions
    : null;
  const summaryLines = [
    subtotal !== null ? detailLine("Subtotal dos procedimentos", money(subtotal)) : "",
    discount !== null ? detailLine("Descontos", money(discount)) : "",
    ...additions.map((item) => detailLine(item.label, money(item.amountCents))),
    unexplained !== null && unexplained !== 0 ? detailLine("Ajuste sem detalhamento salvo", money(unexplained)) : "",
  ].filter(Boolean).join("");
  const compositionNote = hasValue(input.financial?.compositionNote) ? `<p class="composition-note">${text(input.financial!.compositionNote!.trim())}</p>` : "";
  const summary = `<section class="financial-summary">${summaryLines}<div class="total-line"><span>Investimento total</span><strong>${money(total)}</strong></div>${compositionNote}</section>`;
  const installments = Math.max(1, Math.floor(Number(input.installments) || 1));
  const installmentValue = installments > 1 && Number.isFinite(total) ? installmentText(total, installments) : "";
  const paymentDescription = `${text(input.paymentMethod)}${input.paymentMethod === "Cartão de crédito" && installmentValue ? ` · ${text(installmentValue)}` : ""}`;
  const conditionRows = [
    ["Forma de pagamento", paymentDescription],
    ["Pagamento", input.conditions?.paymentStatus],
    ["Validade", input.validUntil ?? input.conditions?.validity],
    ["Agendamento", input.conditions?.appointment],
    ["Reagendamento", input.conditions?.rescheduling],
    ["Cancelamento", input.conditions?.cancellation],
    ["Condições especiais", input.conditions?.special],
    ["Observações", input.conditions?.observations ?? input.notes],
  ].filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([label, value]) => `<div class="condition-row"><span>${text(label)}</span><strong>${text(value)}</strong></div>`).join("");
  const conditions = conditionRows ? `<section class="section"><h2>Condições da proposta</h2><div class="condition-list">${conditionRows}</div></section>` : "";
  const acceptance = `<section class="acceptance"><h2>Aceite da proposta</h2><p>Declaro que recebi e tomei conhecimento dos procedimentos, valores e condições comerciais apresentados nesta proposta de tratamento.</p><div class="signature-line"></div><span class="signature-label">Assinatura do cliente</span><div class="signature-details">${detailLine("Nome", input.patient?.name)}${detailLine("CPF", input.patient?.cpf)}${detailLine("Data", "____/____/________")}${detailLine("Proposta", input.proposalNumber)}</div></section>`;
  const statusLine = hasValue(input.statusLabel) ? `<span class="status-pill">${text(input.statusLabel)}</span>` : "";
  const footerName = clinicName ? `${text(clinicName)} · ` : "";
  const footerContacts = contactMarkup ? `<div class="footer-contacts">${contactMarkup}</div>` : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data: blob:; font-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Proposta de tratamento${clinicName ? ` · ${text(clinicName)}` : ""}</title>
<style>
:root{--proposal-font:"Geist",Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;--brand:${primary};--ink:#201d3b;--muted:#66708a;--line:#e3e5ef;--soft:#f7f7fc;--brand-soft:#f0efff}
*{box-sizing:border-box}html{background:#ececf3}body{max-width:210mm;min-height:297mm;margin:18px auto;padding:14mm;color:var(--ink);background:#fff;font:10pt/1.45 var(--proposal-font);box-shadow:0 3px 18px #20203a1a}
h1,h2,h3,p{margin:0}h1{font-size:25pt;line-height:1.12;font-weight:750}h2{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:13pt;line-height:1.2}h2:before{content:"";width:3px;height:15px;border-radius:3px;background:var(--brand)}h3{font-size:10pt;line-height:1.25}p{color:var(--muted)}
.proposal-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:12px;border-bottom:1px solid var(--line)}.brand-block{min-width:0}.clinic-logo{width:46mm;height:15mm;object-fit:contain;object-position:left center}.clinic-name{font-size:18pt;font-weight:750;color:var(--ink)}.brand-contact{display:flex;flex-wrap:wrap;gap:3px 12px;margin-top:6px;color:var(--muted);font-size:8pt}.meta-block{min-width:45mm;text-align:right}.detail-line{display:flex;justify-content:space-between;gap:12px;padding:3px 0;color:var(--muted);font-size:8.5pt}.detail-line strong{color:var(--ink);font-weight:600;text-align:right}.meta-block .detail-line{justify-content:flex-end}.meta-block .detail-line span{margin-right:auto}.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:15px 0 12px}.eyebrow{display:block;margin-bottom:5px;color:var(--brand);font-size:8pt;font-weight:700;text-transform:uppercase}.hero p{margin-top:5px;font-size:10pt}.status-pill{display:inline-flex;align-items:center;border-radius:999px;padding:5px 10px;background:var(--brand-soft);color:var(--brand);font-size:8pt;font-weight:700;white-space:nowrap}
.identities{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:15px}.identity-card,.goal{border:1px solid var(--line);border-radius:8px;padding:11px 12px;background:linear-gradient(120deg,#fafaff,#fff)}.identity-card>strong{display:block;margin-bottom:4px;font-size:11pt}.identity-card .detail-line:first-of-type{margin-top:2px}.goal{margin-bottom:15px}.goal p{color:var(--ink)}.section{margin-top:16px}.plan-subtitle{margin:-5px 0 9px;color:var(--muted);font-size:9pt}.treatment-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.5pt}.treatment-table th{padding:8px 7px;background:var(--brand-soft);color:var(--brand);font-size:7.3pt;text-align:left;text-transform:uppercase}.treatment-table th:nth-child(1){width:42%}.treatment-table th:nth-child(2){width:8%}.treatment-table th:nth-child(n+3){width:16.6%}.treatment-table td{padding:9px 7px;border-bottom:1px solid var(--line);vertical-align:middle;overflow-wrap:anywhere}.treatment-table tr{break-inside:avoid;page-break-inside:avoid}.numeric{text-align:right;white-space:nowrap}.amount{font-weight:700;color:var(--ink)}.treatment-row{display:flex;align-items:center;gap:8px}.treatment-row strong{display:block}.treatment-row small{display:block;margin-top:2px;color:var(--muted);font-size:7.5pt}.image-frame{position:relative;display:inline-grid;flex:none;place-items:center;overflow:hidden;background:var(--brand-soft)}.row-image{width:12mm;height:12mm;border-radius:5px;object-fit:cover}.image-frame img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.image-fallback{display:grid;place-items:center;background:var(--brand-soft);color:var(--brand);font-weight:700}.financial-summary{width:min(100%,110mm);margin:13px 0 0 auto;padding:9px 12px;border-radius:8px;background:var(--soft)}.financial-summary .detail-line{font-size:9pt}.total-line{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:5px;padding-top:8px;border-top:1px solid #d9d6ff;font-size:12pt;font-weight:700}.total-line strong{color:var(--brand);font-size:17pt;white-space:nowrap}.payment-strip{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.payment-chip{flex:1 1 45mm;border:1px solid var(--line);border-radius:7px;padding:8px 10px;background:#fff}.payment-chip span{display:block;color:var(--muted);font-size:7.5pt}.payment-chip strong{display:block;margin-top:2px;font-size:9pt}.procedure-section{break-before:auto}.procedure-card{display:flex;align-items:center;gap:12px;margin:8px 0;padding:9px 11px;border-radius:8px;background:var(--soft);break-inside:avoid;page-break-inside:avoid}.procedure-image{width:24mm;height:18mm;border-radius:6px;object-fit:cover}.procedure-card>div:last-child{min-width:0}.procedure-card p{margin-top:3px;font-size:9pt}.condition-list{border-top:1px solid var(--line)}.condition-row{display:grid;grid-template-columns:34% 1fr;gap:14px;padding:7px 9px;border-bottom:1px solid var(--line);font-size:9pt;break-inside:avoid}.condition-row span{color:var(--muted)}.condition-row strong{font-weight:500}.acceptance{margin-top:18px;padding:12px 14px;border:1px solid #d8d5ff;border-radius:8px;background:linear-gradient(120deg,#fcfbff,#fff);break-inside:avoid;page-break-inside:avoid}.acceptance h2{margin-bottom:7px}.acceptance p{max-width:155mm;font-size:9pt}.signature-line{width:min(100%,110mm);height:19mm;margin:13px 0 2px;border-bottom:1px solid #73758b}.signature-label{display:block;color:var(--muted);font-size:8pt}.signature-details{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin-top:10px}.signature-details .detail-line{border-top:1px solid #f0f0f5}.proposal-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding-top:9px;border-top:1px solid var(--line);color:var(--muted);font-size:7.5pt}.footer-brand{display:flex;align-items:center;gap:6px;white-space:nowrap}.system-mark{width:8mm;height:8mm;object-fit:contain}.footer-contacts{display:flex;flex-wrap:wrap;gap:3px 9px;justify-content:flex-end;text-align:right}
@page{size:A4 portrait;margin:2mm 14mm 4mm;@bottom-right{content:counter(page) " / " counter(pages);color:#66708a;font:8pt var(--proposal-font)}}
@media print{html{background:#fff}body{width:auto;max-width:none;min-height:0;margin:0;padding:3mm 0 2mm;box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}h2{break-after:avoid-page;page-break-after:avoid}.proposal-header,.proposal-footer{break-inside:avoid}.proposal-footer{margin-top:12px}.section{break-inside:auto}.identity-card,.goal,.financial-summary{break-inside:avoid;page-break-inside:avoid}.compact .hero{padding:8px 0 6px}.compact .identities{margin-bottom:7px}.compact .identity-card,.compact .goal{padding:7px 9px}.compact .section{margin-top:8px}.compact .treatment-table td{padding-top:5px;padding-bottom:5px}.compact .financial-summary{margin-top:7px;padding:6px 9px}.compact .condition-row{padding-top:3px;padding-bottom:3px}.compact .acceptance{margin-top:7px;padding:7px 9px}.compact .acceptance h2{margin-bottom:4px}.compact .signature-line{height:9mm;margin:8px 0 1px}.compact .signature-details{gap:2px 14px;margin-top:5px}.compact .proposal-footer{margin-top:4px;padding-top:3px}.compact .system-mark{width:6mm;height:6mm}.dense-presentation .presentation-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}.dense-presentation .procedure-card{margin:0;padding:4px 6px;gap:6px}.dense-presentation .procedure-image{width:14mm;height:12mm}.dense-presentation .procedure-card p{font-size:7.5pt;line-height:1.3}.dense-presentation .presentation-grid-following{break-before:page;page-break-before:always}.dense-presentation .condition-row{padding-top:4px;padding-bottom:4px}.dense-presentation .acceptance{margin-top:9px;padding:9px 11px}.dense-presentation .signature-line{height:15mm;margin:9px 0 1px}.dense-presentation .signature-details{gap:2px 14px;margin-top:6px}.dense-presentation .proposal-footer{margin-top:8px;padding-top:6px}a{color:inherit;text-decoration:none}}
@media screen and (max-width:700px){html{background:#fff}body{min-height:100vh;margin:0;padding:20px;box-shadow:none}.proposal-header{gap:12px}.clinic-logo{width:38mm}.meta-block{min-width:35mm}.hero{align-items:flex-start}.identities{grid-template-columns:1fr}.treatment-table{font-size:7.5pt}.treatment-table th,.treatment-table td{padding:6px 4px}.row-image{width:9mm;height:9mm}.numeric{white-space:normal}.financial-summary{width:100%}.condition-row{grid-template-columns:1fr;gap:2px}.proposal-footer{align-items:flex-start;flex-direction:column}.footer-contacts{justify-content:flex-start;text-align:left}}
</style>
</head>
<body class="${[compactClass, densePresentationClass].filter(Boolean).join(" ")}">
<header class="proposal-header"><div class="brand-block">${headerIdentity}${contactMarkup ? `<div class="brand-contact">${contactMarkup}</div>` : ""}</div><div class="meta-block">${proposalMeta}</div></header>
<main>
  <section class="hero"><div><span class="eyebrow">Proposta comercial</span><h1>Proposta de tratamento</h1><p>Um plano de tratamento personalizado para você.</p></div>${statusLine}</section>
  ${patientMarkup || professionalMarkup ? `<div class="identities">${patientMarkup}${professionalMarkup}</div>` : ""}
  ${goalMarkup}
  <section class="section"><h2>Seu plano de tratamento</h2><p class="plan-subtitle">Procedimentos e valores apresentados nesta proposta.</p><table class="treatment-table"><thead><tr><th>Procedimento</th><th>Qtd.</th><th>Valor unitário</th><th>Desconto</th><th>Subtotal</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Nenhum procedimento informado.</td></tr>`}</tbody></table>${summary}</section>
  ${presentation}
  ${conditions.replace('<section class="section">', '<section class="section conditions-section">')}
  ${acceptance}
</main>
<footer class="proposal-footer"><div class="footer-brand">${mark}<span>${footerName}Gerado com Harmonize+</span></div>${footerContacts}</footer>
<script>window.addEventListener("load",()=>{const images=[...document.images];Promise.all(images.map(image=>image.complete?(image.naturalWidth||image.remove(),Promise.resolve()):new Promise(resolve=>{image.addEventListener("load",resolve,{once:true});image.addEventListener("error",()=>{image.remove();resolve()},{once:true})}))).then(()=>window.print())});</script>
</body></html>`;
}

export function parseQuoteDetails(value?: string | null): StoredQuoteDetails | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as StoredQuoteDetails;
    return Array.isArray(parsed.items) ? parsed : null;
  } catch { return null; }
}

export function quoteFinancialSnapshot(details: string | null | undefined, fallbackTotalCents: number): NonNullable<ProposalInput["financial"]> {
  const stored = parseQuoteDetails(details);
  if (!stored) return { totalCents: fallbackTotalCents, compositionNote: "O detalhamento financeiro original deste orçamento não está disponível." };
  const additions = stored.costs ? [
    { label: "Custo de mão de obra", amountCents: stored.costs.laborCents },
    { label: "Custo de estrutura da clínica", amountCents: stored.costs.facilityCents },
    { label: "Custo de medicação", amountCents: stored.costs.medicationCents },
  ].filter((item) => item.amountCents > 0) : (stored.costTotalCents ?? 0) > 0
    ? [{ label: "Custos adicionais da clínica", amountCents: stored.costTotalCents! }]
    : [];
  return {
    subtotalCents: stored.subtotalCents,
    discountCents: stored.discountCents,
    additions,
    totalCents: stored.totalCents ?? fallbackTotalCents,
    compositionNote: stored.items.length ? null : "O detalhamento financeiro original deste orçamento não está disponível.",
  };
}

// Linhas da proposta a partir do orçamento salvo: usa o detalhamento; orçamentos antigos só têm o texto "Nome (2x), ...".
export function proposalRowsFromQuote(quote: { items: string; details?: string | null }): ProposalRow[] {
  const stored = parseQuoteDetails(quote.details);
  if (stored?.items.length) return stored.items.map((item) => ({ name: item.name, quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1, unitPriceCents: item.unitPriceCents, discountCents: item.discountCents, subtotalCents: item.subtotalCents }));
  return quote.items.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const match = entry.match(/^(.*?)\s*\((\d+)x\)$/);
    return { name: match ? match[1] : entry, quantity: match ? Number(match[2]) : 1, unitPriceCents: null, discountCents: null, subtotalCents: null };
  });
}

// Abre a janela de impressão. Deve ser chamada direto do clique (senão o navegador bloqueia o pop-up). Retorna false se bloqueada.
export function openQuoteProposal(html: string) {
  const popup = window.open("", "_blank", "width=900,height=720");
  if (!popup) return false;
  const appFont = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim();
  const fontStack = appFont.replace(/[^\w,"' -]/g, "");
  const fontFaces = Array.from(document.styleSheets).flatMap((sheet) => {
    try {
      return Array.from(sheet.cssRules)
        .filter((rule) => rule instanceof CSSFontFaceRule && /Geist/i.test(rule.style.fontFamily))
        .map((rule) => rule.cssText);
    } catch { return []; }
  });
  const fontStyle = fontFaces.length ? `<style>${fontFaces.join("\n")}</style>` : "";
  const preparedHtml = html
    .replace("<head>", `<head>${fontStyle}`)
    .replace('--proposal-font:"Geist",Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;', `--proposal-font:${fontStack || '"Geist",Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif'};`);
  popup.document.write(preparedHtml);
  popup.document.close();
  return true;
}
