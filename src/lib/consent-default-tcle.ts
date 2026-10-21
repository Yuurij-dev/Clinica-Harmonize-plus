// Modelo padrão de TCLE para impressão (assinatura em papel). Estrutura e textos fixos vêm do modelo anexado pelo usuário;
// os trechos que o modelo deixa entre colchetes continuam como lacunas para o profissional preencher à mão.
// NÃO é um texto aprovado clínica ou juridicamente: revisar antes do uso real. Nada é gravado ao gerar.

// Mesma implementação de escapeHtml de quote-proposal.ts (um teste garante a paridade). Cópia local porque este módulo
// precisa carregar no node:test, que não resolve a importação de quote-proposal sem extensão.
export function escapeHtml(value: string) {
  return value.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

export type DefaultTcleInput = {
  clinicName?: string | null;
  patientName?: string | null;
  patientCpf?: string | null;
  professionalName?: string | null;
  procedureName?: string | null;
  date?: string | null;
};

export const tcleReviewNotice = "Modelo padrão sem aprovação clínica ou jurídica. Revise o texto antes do uso real.";

type Section = { heading: string; before?: string[]; gap?: string; after?: string[]; list?: string[] };

// Rótulos das lacunas = texto do modelo entre colchetes (orientação ao profissional), nunca conteúdo clínico próprio.
const sections: Section[] = [
  { heading: "1. Sobre o procedimento", before: ["Fui informado(a) de que o procedimento proposto consiste em:"], gap: "Descrição clara de como o procedimento é realizado, região tratada, finalidade e técnica utilizada." },
  { heading: "2. Benefícios e resultados esperados", before: ["O profissional explicou os objetivos e benefícios esperados, incluindo:"], gap: "Benefícios esperados específicos do procedimento.", after: ["Estou ciente de que os resultados podem variar conforme minhas características individuais e que não existe garantia de um resultado estético específico."] },
  { heading: "3. Riscos e possíveis complicações", before: ["Recebi explicações sobre os riscos, desconfortos, efeitos adversos e possíveis complicações associados ao procedimento."], gap: "Riscos específicos, incluindo complicações relevantes e sua gravidade, preenchidos pelo profissional responsável.", after: ["Também fui informado(a) sobre as condutas que devo adotar caso apresente sinais ou sintomas de complicações."] },
  { heading: "4. Alternativas e não realização", before: ["Foram explicadas as alternativas disponíveis, quando aplicáveis, bem como as possíveis consequências de não realizar o procedimento."], gap: "Alternativas e consequências pertinentes." },
  { heading: "5. Cuidados e orientações", before: ["Recebi orientações sobre os cuidados necessários antes e após o procedimento, possíveis restrições e acompanhamento."], gap: "Orientações específicas fornecidas pelo profissional." },
  { heading: "6. Declaração do paciente", before: ["Declaro que:"], list: [
    "Recebi informações claras e compreensíveis sobre o procedimento.",
    "Tive a oportunidade de fazer perguntas e esclarecer minhas dúvidas.",
    "Fui informado(a) sobre benefícios, riscos, alternativas e possíveis complicações.",
    "Compreendo que posso recusar o procedimento e retirar meu consentimento, respeitadas as medidas necessárias à minha segurança caso o procedimento já tenha começado.",
    "Manifesto minha decisão livremente, sem coerção.",
  ] },
];

const closingNote = "Documento referente exclusivamente ao procedimento e às informações aqui descritos. A autorização para divulgação de imagens, quando desejada, deverá ser solicitada separadamente.";

const blank = "______________________________";
const value = (input?: string | null) => {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  return text ? escapeHtml(text) : blank;
};

const style = `
:root{--proposal-font:"Geist",Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;--ink:#201d3b;--muted:#66708a;--line:#9a9cb0}
*{box-sizing:border-box}html{background:#ececf3}
body{margin:0;color:var(--ink);font:10.5pt/1.5 var(--proposal-font)}
.sheet{width:210mm;margin:14px auto;background:#fff;box-shadow:0 3px 18px #20203a1a}
table.page{width:100%;border-collapse:collapse}
td.gutter{padding:0 18mm}
.spacer{height:16mm}
h1{margin:0 0 4mm;font-size:16pt;text-align:center;letter-spacing:.02em}
h2{margin:6mm 0 2mm;font-size:11.5pt;break-after:avoid;page-break-after:avoid}
p{margin:0 0 2mm}
.clinic{margin:0 0 4mm;text-align:center;font-size:12.5pt;font-weight:700}
.notice{margin:0 0 5mm;padding:2.5mm 3mm;border:1px solid #e0b34a;border-radius:2mm;background:#fff8e6;color:#6b4a00;font-size:9pt}
.ident{margin:0 0 4mm;padding:0 0 3mm;border-bottom:1px solid #d7d8e3}
.ident p{margin:0 0 1mm}
.gap{margin:2mm 0 3mm;break-inside:avoid;page-break-inside:avoid}
.gap small{display:block;color:var(--muted);font-size:8pt;font-style:italic}
.gap i{display:block;height:7mm;border-bottom:1px solid var(--line)}
ul{margin:0 0 2mm;padding-left:6mm}li{margin:0 0 1mm}
.decision{margin:2mm 0;break-inside:avoid;page-break-inside:avoid}
.decision p{display:flex;gap:2mm;align-items:flex-start}
.sign{margin:5mm 0 0;break-inside:avoid;page-break-inside:avoid}
.sign strong{display:block;margin-bottom:6mm}
.sign .line{border-bottom:1px solid #444;height:9mm;margin-bottom:1mm}
.sign p{color:var(--ink)}
.note{margin-top:7mm;padding-top:3mm;border-top:1px solid #d7d8e3;color:var(--muted);font-size:8.5pt;font-style:italic}
@page{size:A4 portrait;margin:0}
@media print{html{background:#fff}.sheet{width:auto;margin:0;box-shadow:none}.notice{-webkit-print-color-adjust:exact;print-color-adjust:exact}thead{display:table-header-group}tfoot{display:table-footer-group}}
@media screen and (max-width:700px){.sheet{width:100%;margin:0}td.gutter{padding:0 6mm}}
`;

// HTML autônomo do termo (escape em TODO valor interpolado). Abre a impressão sozinho ao carregar.
export function buildDefaultTcleHtml(input: DefaultTcleInput = {}) {
  const sectionMarkup = sections.map((section) => `<section>
<h2>${escapeHtml(section.heading)}</h2>
${(section.before ?? []).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
${section.gap ? `<div class="gap"><small>A preencher pelo profissional: ${escapeHtml(section.gap)}</small><i></i><i></i><i></i><i></i></div>` : ""}
${section.list ? `<ul>${section.list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
${(section.after ?? []).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
</section>`).join("\n");
  const signature = (title: string, name: string) => `<div class="sign"><strong>${escapeHtml(title)}</strong><div class="line"></div><p>Assinatura</p><p>Nome: ${name}</p><p>Data: ____/____/________</p></div>`;
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Termo de Consentimento Livre e Esclarecido</title>
<style>${style}</style>
</head><body><div class="sheet"><table class="page"><thead><tr><td class="gutter"><div class="spacer"></div></td></tr></thead><tbody><tr><td class="gutter">
<h1>TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO</h1>
<p class="clinic">${value(input.clinicName)}</p>
<p class="notice">${escapeHtml(tcleReviewNotice)}</p>
<div class="ident">
<p><strong>Procedimento:</strong> ${value(input.procedureName)}</p>
<p><strong>Paciente:</strong> ${value(input.patientName)}</p>
<p><strong>CPF:</strong> ${value(input.patientCpf)}</p>
<p><strong>Profissional responsável:</strong> ${value(input.professionalName)} &nbsp; Registro profissional: ${blank}</p>
<p><strong>Data:</strong> ${value(input.date)}</p>
</div>
${sectionMarkup}
<h2>Minha decisão</h2>
<div class="decision"><p><span>&#9744;</span><span>Autorizo a realização do procedimento descrito.</span></p><p><span>&#9744;</span><span>Não autorizo a realização do procedimento descrito.</span></p></div>
<h2>7. Assinaturas</h2>
${signature("Paciente ou representante legal", value(input.patientName))}
${signature("Profissional responsável", value(input.professionalName))}
<p class="note">${escapeHtml(closingNote)}</p>
</td></tr></tbody><tfoot><tr><td class="gutter"><div class="spacer"></div></td></tr></tfoot></table></div>
<script>window.addEventListener("load",()=>window.print());</script>
</body></html>`;
}
