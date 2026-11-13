// Leitor mínimo de XLSX para os testes: lê o XML direto (jszip, que vem com o exceljs), porque o exceljs relê tabelas de forma
// incompleta. Devolve abas com células (valor, fórmula, estilo resolvido), alturas, larguras, mesclagens, vista, CF e impressão.
import JSZip from "jszip";

function parseXml(xml) {
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const unescape = (value) => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  let match;
  while ((match = re.exec(xml))) {
    if (match[1]) stack.pop();
    else if (match[2]) {
      const attrs = {};
      for (const attr of (match[3] || "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[attr[1]] = unescape(attr[2] ?? attr[3]);
      const node = { name: match[2].replace(/^.*:/, ""), attrs, children: [], text: "" };
      stack[stack.length - 1].children.push(node);
      if (!match[4]) stack.push(node);
    } else if (match[5] !== undefined && stack.length > 1) stack[stack.length - 1].text += unescape(match[5]);
  }
  return root.children[0];
}
const kids = (node, name) => (node ? node.children.filter((child) => child.name === name) : []);
const kid = (node, name) => kids(node, name)[0];
const rgb6 = (color) => (color && color.attrs.rgb ? color.attrs.rgb.slice(-6).toUpperCase() : "");
const builtin = { 0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%" };

export async function readXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (path) => (zip.file(path) ? parseXml(await zip.file(path).async("string")) : null);
  const styles = await read("xl/styles.xml");
  const workbook = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = kids(sharedXml, "si").map((si) => si.children.map((child) => (child.name === "t" ? child.text : child.children.map((part) => part.text).join(""))).join(""));
  const numFmts = Object.fromEntries(kids(kid(styles, "numFmts"), "numFmt").map((node) => [node.attrs.numFmtId, node.attrs.formatCode]));
  const fonts = kids(kid(styles, "fonts"), "font").map((font) => ({ name: kid(font, "name")?.attrs.val, size: kid(font, "sz")?.attrs.val, bold: Boolean(kid(font, "b")), italic: Boolean(kid(font, "i")), color: rgb6(kid(font, "color")) }));
  const fills = kids(kid(styles, "fills"), "fill").map((fill) => { const pattern = kid(fill, "patternFill"); return pattern && pattern.attrs.patternType === "solid" ? rgb6(kid(pattern, "fgColor")) : ""; });
  const borders = kids(kid(styles, "borders"), "border").map((border) => Object.fromEntries(["left", "right", "top", "bottom"].map((side) => { const edge = kid(border, side); return [side, edge && edge.attrs.style ? `${edge.attrs.style}:${rgb6(kid(edge, "color"))}` : ""]; }).filter(([, value]) => value)));
  const xfs = kids(kid(styles, "cellXfs"), "xf").map((xf) => {
    const alignment = kid(xf, "alignment")?.attrs ?? {};
    const id = xf.attrs.numFmtId ?? "0";
    return { font: fonts[Number(xf.attrs.fontId ?? 0)], fill: fills[Number(xf.attrs.fillId ?? 0)], border: borders[Number(xf.attrs.borderId ?? 0)], numFmt: numFmts[id] ?? builtin[id] ?? `id${id}`, align: { h: alignment.horizontal, v: alignment.vertical, indent: alignment.indent, wrap: alignment.wrapText, shrink: alignment.shrinkToFit } };
  });
  const relTarget = Object.fromEntries(kids(rels, "Relationship").map((rel) => [rel.attrs.Id, rel.attrs.Target]));
  const sheets = [];
  for (const sheet of kids(kid(workbook, "sheets"), "sheet")) {
    const path = `xl/${relTarget[sheet.attrs["r:id"]].replace(/^\//, "").replace(/^xl\//, "")}`;
    const ws = await read(path);
    const cells = {};
    const rowHeights = {};
    for (const row of kids(kid(ws, "sheetData"), "row")) {
      if (row.attrs.ht) rowHeights[row.attrs.r] = Number(row.attrs.ht);
      for (const cell of kids(row, "c")) {
        const formula = kid(cell, "f");
        const value = kid(cell, "v");
        const inline = kid(cell, "is");
        let content = inline ? inline.children.map((part) => part.text).join("") : value ? value.text : null;
        if (cell.attrs.t === "s" && content !== null) content = shared[Number(content)];
        const numeric = cell.attrs.t === undefined || cell.attrs.t === "n";
        cells[cell.attrs.r] = { style: xfs[Number(cell.attrs.s ?? 0)], formula: formula ? formula.text : null, value: content === null ? null : numeric ? Number(content) : content, type: cell.attrs.t ?? "n" };
      }
    }
    const view = kid(kid(ws, "sheetViews"), "sheetView");
    const pane = kid(view, "pane");
    const bar = kid(kid(kid(ws, "conditionalFormatting"), "cfRule"), "dataBar");
    const footer = kid(kid(ws, "headerFooter"), "oddFooter");
    sheets.push({
      name: sheet.attrs.name,
      cells, rowHeights,
      cols: kids(kid(ws, "cols"), "col").map((col) => ({ min: Number(col.attrs.min), max: Number(col.attrs.max), width: Number(col.attrs.width) })),
      merges: kids(kid(ws, "mergeCells"), "mergeCell").map((merge) => merge.attrs.ref),
      gridlines: view?.attrs.showGridLines,
      pane: pane ? { state: pane.attrs.state, ySplit: Number(pane.attrs.ySplit) } : null,
      dataBar: bar ? { sqref: kid(ws, "conditionalFormatting").attrs.sqref, cfvo: kids(bar, "cfvo").map((item) => `${item.attrs.type}:${item.attrs.val}`), color: rgb6(kid(bar, "color")) } : null,
      fitToPage: kid(kid(ws, "sheetPr"), "pageSetUpPr")?.attrs.fitToPage === "1",
      pageSetup: kid(ws, "pageSetup")?.attrs ?? {},
      printOptions: kid(ws, "printOptions")?.attrs ?? {},
      footer: footer?.text ?? "",
      tableParts: kids(kid(ws, "tableParts"), "tablePart").length,
    });
  }
  const tables = [];
  for (const file of Object.keys(zip.files).filter((name) => /xl\/tables\/table\d+\.xml$/.test(name))) {
    const table = await read(file);
    tables.push({ name: table.attrs.name, displayName: table.attrs.displayName, ref: table.attrs.ref, autoFilter: kid(table, "autoFilter")?.attrs.ref, columns: kids(kid(table, "tableColumns"), "tableColumn").map((col) => col.attrs.name), style: kid(table, "tableStyleInfo")?.attrs.name, stripes: kid(table, "tableStyleInfo")?.attrs.showRowStripes });
  }
  const props = await read("docProps/core.xml");
  return {
    sheets, tables,
    definedNames: kids(kid(workbook, "definedNames"), "definedName").map((node) => ({ name: node.attrs.name, sheet: node.attrs.localSheetId, ref: node.text })),
    calcPr: kid(workbook, "calcPr")?.attrs ?? {},
    creator: kid(props, "creator")?.text,
    sheet: (name) => sheets.find((item) => item.name === name),
  };
}

// Assinatura de estilo legível: "Arial/9/b/3F35C4 fill=EEECFD ...".
export function styleSig(style) {
  if (!style) return "";
  const font = style.font || {};
  return `font=${font.name}/${font.size}${font.bold ? "/b" : ""}${font.italic ? "/i" : ""}/${font.color} fill=${style.fill} border=${Object.entries(style.border || {}).map(([side, value]) => `${side}:${value}`).join(",")} fmt=${style.numFmt} align=${Object.entries(style.align || {}).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(",")}`;
}

// Serial de data do Excel (1900) para AAAA-MM-DD.
export const serialOf = (isoDay) => Math.round((Date.UTC(Number(isoDay.slice(0, 4)), Number(isoDay.slice(5, 7)) - 1, Number(isoDay.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 86_400_000);

export const KPI_COLUMNS = ["B", "D", "F", "H", "J"];
// Endereços [rótulo, valor] de cada KPI como o motor posiciona (blocos de 5; título do grupo antes quando existe).
export function kpiAddresses(spec) {
  const addresses = [];
  let row = 8;
  for (const group of spec.kpiGroups) {
    if (group.items.length === 0) continue;
    if (group.title) row += 1;
    for (let start = 0; start < group.items.length; start += 5) {
      group.items.slice(start, start + 5).forEach((item, index) => addresses.push({ item, label: `${KPI_COLUMNS[index]}${row + 1}`, value: `${KPI_COLUMNS[index]}${row + 2}` }));
      row += 5;
    }
  }
  return { addresses, nextRow: row };
}

// Valor de exibição de uma célula do documento (reais, fração, número).
export function displayNumber(cell) {
  if (cell.type === "unknown") return "–";
  if (cell.type === "money") return cell.value / 100;
  if (cell.type === "percent") return cell.value / 100;
  return cell.value;
}
