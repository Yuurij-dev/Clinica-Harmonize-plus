import assert from "node:assert/strict";
import { test } from "node:test";
import { baseDocument, note } from "../src/lib/reports-document.ts";
import { renderXlsx, XLSX_FORMATS } from "../src/lib/reports-xlsx-layout.ts";
import { buildAllSpec } from "../src/lib/reports-xlsx-specs/index.ts";
import { allBundles, appointmentRows, catalog, doneRows, financeBundle, input, proceduresBundle, stockBundle } from "./reports-xlsx-fixtures.mjs";
import { displayNumber, kpiAddresses, readXlsx, serialOf, styleSig } from "./reports-xlsx-reader.mjs";

const read = async (bundle) => readXlsx(await renderXlsx(bundle.spec));
const MONEY = XLSX_FORMATS.money;

test("layout do modelo: abas, grade desligada, faixa roxa, alturas, larguras, fontes e cores exatas", async () => {
  const x = await read(proceduresBundle());
  assert.deepEqual(x.sheets.map((sheet) => sheet.name), ["Resumo", "Procedimentos"]);
  assert.ok(x.sheets.every((sheet) => sheet.gridlines === "0"));
  const resumo = x.sheet("Resumo");
  assert.deepEqual(resumo.cols.map((col) => col.width), [2, 24, 3, 24, 3, 24, 3, 24, 3, 24, 2]);
  assert.deepEqual([1, 2, 3, 5, 6, 8, 9, 10, 11].map((row) => resumo.rowHeights[row]), [10, 34, 20, 16, 22, 8, 20, 34, 18]);
  // faixa roxa A1:K3
  for (const ref of ["A1", "K1", "A2", "K2", "A3", "K3", "F2"]) assert.equal(resumo.cells[ref].style.fill, "5B4FE8", ref);
  assert.equal(styleSig(resumo.cells.B2.style), "font=Arial/18/b/FFFFFF fill=5B4FE8 border= fmt=General align=v=center");
  assert.equal(resumo.cells.B2.value, "Harmonize+  ·  Relatório de Procedimentos");
  assert.equal(styleSig(resumo.cells.J2.style), "font=Arial/11/b/FFFFFF fill=5B4FE8 border= fmt=General align=h=right,v=center");
  assert.equal(resumo.cells.J2.value, "Clinica");
  assert.equal(styleSig(resumo.cells.B3.style), "font=Arial/10/DCD8FF fill=5B4FE8 border= fmt=General align=v=top");
  // filtros
  assert.deepEqual(["B5", "D5", "F5", "H5", "J5"].map((ref) => resumo.cells[ref].value), ["PERÍODO", "PROFISSIONAL", "AGRUPAMENTO", "COMPARAÇÃO", "GERADO EM"]);
  assert.equal(styleSig(resumo.cells.B5.style), "font=Arial/8/b/6B7280 fill= border= fmt=General align=");
  assert.deepEqual(["B6", "D6", "F6", "H6", "J6"].map((ref) => resumo.cells[ref].value), ["15/10/2026 – 13/11/2026", "Todos", "Diário", "Desligada", "13/11/2026 12:45"]);
  assert.equal(resumo.cells.B6.style.border.bottom, "medium:5B4FE8");
  assert.equal(resumo.cells.B6.style.font.size, "11");
  // cards: borda grossa roxa, fundo lilás, rótulo 9pt roxo-texto, valor 20pt
  assert.equal(resumo.cells.B8.style.border.top, "thick:5B4FE8");
  assert.equal(resumo.cells.B8.style.fill, "EEECFD");
  assert.equal(styleSig(resumo.cells.B9.style), "font=Arial/9/b/3F35C4 fill=EEECFD border= fmt=General align=h=left,v=center,indent=1,shrink=1");
  assert.equal(styleSig(resumo.cells.B10.style), "font=Arial/20/b/111827 fill=EEECFD border= fmt=0 align=h=left,v=center,indent=1,shrink=1");
  assert.equal(resumo.cells.D10.style.numFmt, MONEY);
  assert.equal(resumo.cells.B11.style.fill, "EEECFD");
  // impressão
  assert.ok(resumo.fitToPage);
  assert.equal(resumo.pageSetup.orientation, "landscape");
  assert.equal(resumo.pageSetup.fitToWidth, "1");
  assert.equal(resumo.pageSetup.fitToHeight, "0");
  assert.equal(resumo.printOptions.horizontalCentered, "1");
  for (const sheet of x.sheets) assert.equal(sheet.footer, "&RPágina &P de &N");
  assert.equal(x.calcPr.fullCalcOnLoad, "1");
  assert.equal(x.creator, "Harmonize+");
});

test("tabela agregada: cabeçalho, linhas zebradas (F9FAFB alternando), total com borda preta e data bar lilás 0..1", async () => {
  const x = await read(proceduresBundle());
  const resumo = x.sheet("Resumo");
  assert.equal(resumo.cells.B13.value, "Desempenho por procedimento");
  assert.equal(styleSig(resumo.cells.B13.style), "font=Arial/12/b/111827 fill= border= fmt=General align=");
  assert.deepEqual(["B14", "D14", "F14", "H14", "J14"].map((ref) => resumo.cells[ref].value), ["Procedimento", "Execuções", "Valor de tabela", "Custo de material", "Participação"]);
  assert.equal(styleSig(resumo.cells.B14.style), "font=Arial/9/b/6B7280 fill= border=bottom:thin:E5E7EB fmt=General align=h=left,indent=1");
  assert.equal(styleSig(resumo.cells.D14.style), "font=Arial/9/b/6B7280 fill= border=bottom:thin:E5E7EB fmt=General align=h=right,indent=1");
  assert.equal(resumo.rowHeights[15], 20);
  assert.equal(resumo.cells.B15.style.fill, "");
  assert.equal(resumo.cells.B16.style.fill, "F9FAFB");
  assert.equal(resumo.cells.B17.style.fill, "");
  assert.equal(styleSig(resumo.cells.B15.style), "font=Arial/10/111827 fill= border=bottom:thin:E5E7EB fmt=General align=h=left,v=center,indent=1");
  assert.equal(resumo.cells.D15.style.numFmt, "0");
  assert.equal(resumo.cells.F15.style.numFmt, MONEY);
  assert.equal(resumo.cells.J15.style.numFmt, XLSX_FORMATS.percent);
  assert.match(resumo.cells.D15.formula, /^COUNTIF\(Procedimentos!B2:B33,B15\)$/);
  assert.match(resumo.cells.F15.formula, /^SUMIFS\(Procedimentos!D2:D33,Procedimentos!B2:B33,B15\)$/);
  assert.match(resumo.cells.H15.formula, /^SUMIFS\(Procedimentos!E2:E33,Procedimentos!B2:B33,B15\)$/);
  assert.equal(resumo.cells.J15.formula, "IFERROR(F15/$F$21,0)");
  assert.deepEqual(resumo.dataBar, { sqref: "J15:J20", cfvo: ["num:0", "num:1"], color: "A5A0F5" });
  assert.equal(resumo.rowHeights[21], 22);
  assert.equal(styleSig(resumo.cells.B21.style), "font=Arial/10/b/111827 fill= border=top:medium:111827 fmt=General align=h=left,v=center,indent=1");
  assert.equal(resumo.cells.D21.formula, "SUM(D15:D20)");
  assert.equal(resumo.cells.F21.formula, "SUM(F15:F20)");
  assert.equal(resumo.cells.D21.value, 32);
  // rodapé itálico 8pt, sem a frase de dados fictícios
  const footer = Object.entries(resumo.cells).find(([, cell]) => typeof cell.value === "string" && cell.value.startsWith("Gerado pelo Harmonize+"));
  assert.equal(footer[1].value, "Gerado pelo Harmonize+ · Clinica · 13/11/2026 12:45");
  assert.equal(footer[1].style.font.size, "8");
  assert.equal(footer[1].style.font.italic, true);
});

test("aba de dados: Tabela do Excel (nome = aba, filtro, TableStyleLight1), cabeçalho roxo congelado, formatos e datas como serial", async () => {
  const bundle = proceduresBundle();
  const x = await read(bundle);
  const data = x.sheet("Procedimentos");
  assert.equal(x.tables.length, 1);
  assert.deepEqual(x.tables[0], { name: "Procedimentos", displayName: "Procedimentos", ref: "A1:F33", autoFilter: "A1:F33", columns: ["Data", "Procedimento", "Profissional", "Valor de tabela", "Custo de material", "Margem"], style: "TableStyleLight1", stripes: "1" });
  assert.deepEqual(data.pane, { state: "frozen", ySplit: 1 });
  assert.equal(data.rowHeights[1], 26);
  assert.equal(styleSig(data.cells.A1.style), "font=Arial/10/b/FFFFFF fill=5B4FE8 border= fmt=General align=h=left,v=center,indent=1");
  assert.equal(data.cells.D1.style.align.h, "right"); // numéricos à direita
  assert.deepEqual(x.definedNames, [{ name: "_xlnm.Print_Titles", sheet: "1", ref: "'Procedimentos'!$1:$1" }]);
  assert.ok(data.fitToPage);
  assert.equal(data.pageSetup.orientation, "landscape");
  assert.equal(data.pageSetup.fitToHeight, "0");
  // linha 2: data real (serial), texto à esquerda com recuo, moeda à direita com o formato do modelo, margem calculada
  assert.equal(data.cells.A2.value, serialOf("2026-10-15"));
  assert.equal(data.cells.A2.style.numFmt, "DD/MM/YYYY");
  assert.equal(styleSig(data.cells.A2.style), "font=Arial/10/111827 fill= border= fmt=DD/MM/YYYY align=h=left,v=center,indent=1");
  assert.equal(styleSig(data.cells.B2.style), "font=Arial/10/111827 fill= border= fmt=General align=h=left,v=center,indent=1");
  assert.equal(styleSig(data.cells.D2.style), `font=Arial/10/111827 fill= border= fmt=${MONEY} align=h=right,v=center,indent=1`);
  assert.equal(data.cells.F2.formula, "D2-E2");
  // total FORA da tabela (linha 34) com SUBTOTAL(109) e estilo do modelo
  assert.equal(data.cells.A34.value, "Total");
  assert.equal(styleSig(data.cells.A34.style), "font=Arial/10/b/111827 fill=EEECFD border=top:medium:5B4FE8 fmt=General align=h=left,v=center,indent=1");
  assert.equal(data.cells.D34.formula, "SUBTOTAL(109,D2:D33)");
  assert.equal(data.cells.E34.formula, "SUBTOTAL(109,E2:E33)");
  assert.equal(data.cells.F34.formula, "SUBTOTAL(109,F2:F33)");
  // paciente nunca é exportado
  assert.ok(!x.tables[0].columns.includes("Paciente"));
  const sumValue = bundle.spec.sheets[0].rows.reduce((acc, row) => acc + (row[3].type === "money" ? row[3].value : 0), 0) / 100;
  assert.ok(Math.abs(data.cells.D34.value - sumValue) < 1e-6);
});

test("KPIs: cada fórmula tem o MESMO valor do KPI do documento (resultado em cache) e referencia a aba de dados", async () => {
  for (const [kind, bundle] of Object.entries(allBundles())) {
    const x = await read(bundle);
    const resumo = x.sheet("Resumo");
    const { addresses } = kpiAddresses(bundle.spec);
    assert.ok(addresses.length > 0, kind);
    for (const { item, label, value } of addresses) {
      assert.equal(resumo.cells[label].value, item.label, `${kind}: rótulo ${item.label}`);
      const cell = resumo.cells[value];
      const expected = displayNumber(item.value);
      if (typeof expected === "string") assert.equal(cell.value, "–", `${kind}: ${item.label} desconhecido`);
      else assert.ok(Math.abs(cell.value - expected) < 1e-9, `${kind}: ${item.label} = ${cell.value}, tela = ${expected}`);
      if (cell.formula) assert.ok(/'?[\p{L}_ ]+'?!/u.test(cell.formula) || /^[A-Z]+\d+/.test(cell.formula), `${kind}: ${item.label} fórmula ${cell.formula}`);
    }
    // os KPIs deriváveis das linhas de detalhe levam fórmula (COUNTA/SUM/COUNTIF(S)/SUMIFS/IFERROR)
    const withFormula = addresses.filter(({ value }) => resumo.cells[value].formula);
    assert.ok(withFormula.length >= 1, `${kind}: ao menos um KPI com fórmula`);
    for (const { value } of withFormula) assert.match(resumo.cells[value].formula, /^(COUNTA|COUNT|SUM|COUNTIFS?|SUMIFS|IFERROR|\()/);
  }
});

test("procedimentos: KPIs seguem o modelo (COUNTA, SUM, IFERROR) com resultados iguais à tela", async () => {
  const bundle = proceduresBundle();
  const x = await read(bundle);
  const resumo = x.sheet("Resumo");
  assert.equal(resumo.cells.B10.formula, "COUNTA(Procedimentos!B2:B33)");
  assert.equal(resumo.cells.B10.value, 32);
  assert.equal(resumo.cells.D10.formula, "SUM(Procedimentos!D2:D33)");
  assert.equal(resumo.cells.D10.value, bundle.report.tableTotalCents / 100);
  assert.equal(resumo.cells.F10.formula, "IFERROR(SUM(Procedimentos!D2:D33)/COUNT(Procedimentos!D2:D33),0)");
  assert.equal(resumo.cells.H10.formula, "SUM(Procedimentos!E2:E33)");
  assert.equal(resumo.cells.J10.formula, "SUM(Procedimentos!F2:F33)");
});

test("desconhecido: tabela de dados com célula VAZIA (SUM ignora), cards e agregados com \"–\"; nunca 0 inventado", async () => {
  const bundle = proceduresBundle();
  const x = await read(bundle);
  const data = x.sheet("Procedimentos");
  // "Limpeza de pele" não tem ficha técnica: custo e margem vazios
  const limpeza = bundle.spec.sheets[0].rows.findIndex((row) => row[1].value === "Limpeza de pele") + 2;
  assert.ok(limpeza >= 2);
  assert.equal(data.cells[`E${limpeza}`]?.value ?? null, null);
  assert.equal(data.cells[`F${limpeza}`]?.value ?? null, null);
  assert.equal(data.cells[`F${limpeza}`]?.formula ?? null, null);
  assert.ok(data.cells[`D${limpeza}`].value > 0);
  const resumo = x.sheet("Resumo");
  const rowOf = Object.entries(resumo.cells).find(([, cell]) => cell.value === "Limpeza de pele")[0].replace("B", "");
  assert.equal(resumo.cells[`H${rowOf}`].value, "–");
  assert.equal(resumo.cells.B21.value, "Total (parcial)");
});

test("texto hostil (= + - @) nunca vira fórmula; chave com operador/curinga vira valor, não COUNTIF", async () => {
  const hostile = ["=HYPERLINK(\"http://x\")", "+1+1", "-2", "@SUM(A1)", ">5", "a*b"];
  const rows = hostile.map((name, index) => ({ day: "2026-11-01", patientId: `p${index}`, procedure: name, professional: "=cmd|' /C calc'!A0", status: "Atendido" }));
  const bundle = proceduresBundle({ rows, cat: [...catalog, ...hostile.map((name) => ({ name, priceCents: 1000, materialCostCents: 100, materialCostReason: null }))] });
  const x = await read(bundle);
  const data = x.sheet("Procedimentos");
  hostile.forEach((name) => {
    const cell = Object.values(data.cells).find((candidate) => candidate.value === name);
    assert.ok(cell, name);
    assert.equal(cell.formula, null, name);
    assert.ok(cell.type === "s" || cell.type === "inlineStr", `texto: ${name}`);
  });
  assert.ok(Object.values(data.cells).some((cell) => cell.value === "=cmd|' /C calc'!A0" && cell.formula === null));
  const resumo = x.sheet("Resumo");
  // Chaves com operador, curinga ou cara de número/data não viram COUNTIF (o Excel as reinterpretaria); "@SUM(A1)" é texto literal inofensivo.
  for (const name of ["=HYPERLINK(\"http://x\")", ">5", "a*b", "+1+1", "-2"]) {
    const ref = Object.entries(resumo.cells).find(([key, cell]) => key.startsWith("B") && cell.value === name)?.[0];
    assert.ok(ref, `linha agregada de ${name}`);
    const row = ref.slice(1);
    assert.equal(resumo.cells[`D${row}`].formula, null, `${name}: sem COUNTIF`);
    assert.equal(resumo.cells[`D${row}`].value, 1);
  }
  const atRow = Object.entries(resumo.cells).find(([key, cell]) => key.startsWith("B") && cell.value === "@SUM(A1)")[0].slice(1);
  assert.equal(resumo.cells[`D${atRow}`].value, 1);
  assert.ok(!resumo.cells[`B${atRow}`].formula); // a chave continua texto
});

test("estado vazio (os 8 relatórios): Resumo com faixa, filtros, KPIs e bloco \"Nenhuma movimentação no período\"; dados só com cabeçalho, sem tabela", async () => {
  const empties = {
    procedures: proceduresBundle({ rows: [] }),
    stock: stockBundle({ empty: true }),
    finance: financeBundle({ empty: true }),
  };
  const { appointmentsBundle, clientsBundle, professionalsBundle, quotesBundle } = await import("./reports-xlsx-fixtures.mjs");
  empties.appointments = appointmentsBundle({ rows: [] });
  empties.professionals = professionalsBundle({ rows: [] });
  empties.quotes = quotesBundle({ rows: [] });
  empties.clients = clientsBundle({ rows: [], registered: 0, newPatients: 0 });
  for (const [kind, bundle] of Object.entries(empties)) {
    assert.equal(bundle.spec.empty, true, kind);
    const x = await read(bundle);
    const resumo = x.sheet("Resumo");
    assert.equal(resumo.cells.B2.value, `Harmonize+  ·  Relatório de ${bundle.doc.title}`);
    assert.equal(resumo.cells.B6.value, "15/10/2026 – 13/11/2026");
    assert.ok(bundle.spec.kpiGroups.length > 0, `${kind}: KPIs presentes mesmo vazio`);
    const message = Object.values(resumo.cells).find((cell) => cell.value === "Nenhuma movimentação no período");
    assert.ok(message, kind);
    assert.deepEqual(resumo.merges.filter((ref) => ref.startsWith("B") && ref.endsWith("J" + ref.match(/\d+/)[0])).length > 0, true);
    assert.ok(!Object.values(resumo.cells).some((cell) => cell.value === "Participação"), `${kind}: sem tabela agregada`);
    assert.equal(x.tables.length, 0, `${kind}: sem tabela do Excel (o Excel exige 1+ linha)`);
    for (const sheet of x.sheets.filter((item) => item.name !== "Resumo")) {
      assert.ok(sheet.cells.A1.value, `${kind}: cabeçalho em ${sheet.name}`);
      assert.deepEqual(Object.keys(sheet.cells).filter((ref) => !ref.endsWith("1") || ref.length > 3 && !/^[A-Z]1$/.test(ref)), [], `${kind}: só a linha 1`);
      assert.equal(sheet.cells.A1.style.fill, "5B4FE8");
    }
    // KPIs batem com a tela: valor de cada card = valor do documento (ou "–")
    for (const { item, value } of kpiAddresses(bundle.spec).addresses) {
      const expected = displayNumber(item.value);
      if (typeof expected === "string") assert.equal(resumo.cells[value].value, "–");
      else assert.ok(Math.abs(resumo.cells[value].value - expected) < 1e-9, `${kind}: ${item.label}`);
    }
  }
});

test("bug do vazio: KPI diferente de zero nunca deixa o relatório \"vazio\" (Clientes com novos pacientes e sem atendimentos)", async () => {
  const { clientsBundle } = await import("./reports-xlsx-fixtures.mjs");
  const bundle = clientsBundle({ rows: [], registered: 0 });
  // clientsBundle usa newPatients = 3 nos KPIs (clientStats): a tela mostra "Novos no período: 3"
  const kpiNew = bundle.doc.sections.find((section) => section.type === "kpis").items.find((item) => item.key === "new");
  assert.equal(kpiNew.value.value, 3);
  assert.equal(bundle.doc.hasData, true);
  assert.equal(bundle.spec.empty, false);
  const x = await read(bundle);
  assert.ok(!Object.values(x.sheet("Resumo").cells).some((cell) => cell.value === "Nenhuma movimentação no período"));
});

test("truncado (> 5.000 linhas): KPIs usam o valor do documento (sem fórmula), nota no Resumo e total das linhas exibidas", async () => {
  const bundle = proceduresBundle({ rows: doneRows(5100) });
  assert.deepEqual(bundle.spec.sheets[0].truncated, { shown: 5000, total: 5100 });
  const x = await read(bundle);
  const resumo = x.sheet("Resumo");
  assert.equal(resumo.cells.B10.formula, null);
  assert.equal(resumo.cells.B10.value, 5100); // valor do documento, não das 5.000 linhas
  assert.equal(resumo.cells.D10.formula, null);
  assert.equal(resumo.cells.D15.formula, null);
  assert.ok(Object.values(resumo.cells).some((cell) => typeof cell.value === "string" && cell.value.includes("exibindo 5000 de 5100 linhas")));
  const data = x.sheet("Procedimentos");
  assert.equal(x.tables[0].ref, "A1:F5001");
  assert.equal(data.cells.A5002.value, "Total (linhas exibidas)");
  assert.equal(data.cells.D5002.formula, "SUBTOTAL(109,D2:D5001)");
});

test("PROFESSIONAL: estoque sem custo unitário nem valor em estoque (abas, colunas e cards)", async () => {
  const x = await read(stockBundle({ costHidden: true }));
  const items = x.sheet("Estoque");
  assert.deepEqual(x.tables.find((table) => table.name === "Estoque").columns, ["Item", "Tipo", "Unidade", "Saldo", "Mínimo", "Situação", "Próxima validade"]);
  const labels = Object.values(x.sheet("Resumo").cells).map((cell) => cell.value);
  assert.ok(!labels.includes("Valor total em estoque"));
  assert.ok(!labels.includes("Valor em estoque"));
  assert.ok(items.cells.A2.value);
  const full = await read(stockBundle());
  assert.ok(full.tables.find((table) => table.name === "Estoque").columns.includes("Custo unitário"));
});

test("estoque: aba Estoque (posição) + aba Movimentações; custo desconhecido vazio e motivo padronizado", async () => {
  const x = await read(stockBundle());
  assert.deepEqual(x.sheets.map((sheet) => sheet.name), ["Resumo", "Estoque", "Movimentações"]);
  assert.deepEqual(x.tables.map((table) => table.name), ["Estoque", "Movimentações"]);
  assert.deepEqual(x.tables[1].columns, ["Data e hora", "Item", "Tipo", "Quantidade", "Unidade", "Lote", "Motivo"]);
  const moves = x.sheet("Movimentações");
  assert.equal(moves.cells.A2.style.numFmt, "DD/MM/YYYY HH:MM");
  assert.ok(Object.values(moves.cells).some((cell) => cell.value === "Perda/quebra"));
  const items = x.sheet("Estoque");
  const agulha = Object.entries(items.cells).find(([, cell]) => cell.value === "Agulha 30G")[0].replace("A", "");
  assert.equal(items.cells[`G${agulha}`]?.value ?? null, null); // sem custo cadastrado: vazio
  assert.equal(items.cells.G2.style.numFmt, MONEY);
  const formulas = Object.values(x.sheet("Resumo").cells).map((cell) => cell.formula).filter(Boolean);
  assert.ok(formulas.some((formula) => formula.startsWith("COUNTA(Estoque!A2:A")));
  assert.ok(formulas.some((formula) => formula.startsWith("COUNTA('Movimentações'!A2:A")));
});

test("financeiro: SUMIFS por tipo/situação batem com os KPIs; resultado = recebido − pago; sem descrição livre", async () => {
  const bundle = financeBundle();
  const x = await read(bundle);
  const resumo = x.sheet("Resumo");
  const byLabel = Object.fromEntries(kpiAddresses(bundle.spec).addresses.map(({ item, value }) => [item.label, resumo.cells[value]]));
  assert.match(byLabel.Recebido.formula, /^SUMIFS\(Financeiro!F2:F\d+,Financeiro!B2:B\d+,"Recebimento",Financeiro!D2:D\d+,"Pago"\)$/);
  assert.equal(byLabel.Recebido.value, 2500);
  assert.match(byLabel.Resultado.formula, /^\(SUMIFS\(.*\)-SUMIFS\(.*\)\)$/);
  assert.equal(byLabel.Resultado.value, 1900);
  assert.match(byLabel["A receber (previsto)"].formula, /"<>Pago"/);
  assert.match(byLabel["Margem"].formula, /^IFERROR\(/);
  assert.ok(Math.abs(byLabel.Margem.value - 0.76) < 1e-9);
  const text = JSON.stringify(x.sheets.map((sheet) => Object.values(sheet.cells).map((cell) => cell.value)));
  assert.ok(!text.includes("SEGREDO"));
});

test("consolidado (all): Resumo geral + uma aba de dados (tabela) por relatório, nomes e tabelas únicos e válidos", async () => {
  const parts = Object.values(allBundles());
  const doc = baseDocument("all", input({ previous: null }), { hasData: true, sections: [note("c", "Consolidado")] });
  const spec = buildAllSpec(doc, parts);
  const x = await readXlsx(await renderXlsx(spec));
  assert.equal(x.sheets[0].name, "Resumo");
  const names = x.sheets.map((sheet) => sheet.name);
  assert.deepEqual(names, ["Resumo", "Procedimentos", "Profissionais", "Agendamentos", "Orçamentos", "Clientes", "Financeiro", "Estoque", "Visão geral"].filter((name) => names.includes(name)));
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length);
  assert.ok(names.every((name) => name.length <= 31 && !/[:\\/?*[\]]/.test(name)));
  assert.equal(new Set(x.tables.map((table) => table.name.toLowerCase())).size, x.tables.length);
  assert.ok(x.tables.every((table) => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(table.name)));
  assert.equal(x.tables.length, names.length - 1);
  const resumo = x.sheet("Resumo");
  const titles = Object.values(resumo.cells).map((cell) => cell.value);
  for (const title of ["Procedimentos", "Financeiro", "Estoque", "Visão geral"]) assert.ok(titles.includes(title), title);
  assert.equal(resumo.cells.B2.value, "Harmonize+  ·  Relatório de Consolidado");
  assert.ok(!Object.values(resumo.cells).some((cell) => cell.formula)); // valores do documento, sem fórmulas
});

test("nomes de aba e tabela únicos mesmo com relatórios repetidos; aba de dados nunca chama \"Resumo\"", async () => {
  const bundle = proceduresBundle();
  const spec = { ...bundle.spec, sheets: [bundle.spec.sheets[0], { ...bundle.spec.sheets[0], name: "Procedimentos" }, { ...bundle.spec.sheets[0], name: "Resumo" }] };
  const x = await readXlsx(await renderXlsx(spec));
  const names = x.sheets.map((sheet) => sheet.name);
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length);
  assert.equal(names.filter((name) => name === "Resumo").length, 1);
  assert.equal(new Set(x.tables.map((table) => table.name.toLowerCase())).size, x.tables.length);
});

test("agendamentos: hora, situação e contagens por COUNTIF(S) coerentes com a tela", async () => {
  const { appointmentsBundle } = await import("./reports-xlsx-fixtures.mjs");
  const bundle = appointmentsBundle({ rows: appointmentRows(40) });
  const x = await read(bundle);
  assert.deepEqual(x.tables[0].columns, ["Data", "Hora", "Profissional", "Procedimento", "Situação"]);
  const resumo = x.sheet("Resumo");
  const formulas = kpiAddresses(bundle.spec).addresses.map(({ value }) => resumo.cells[value].formula);
  assert.ok(formulas.some((formula) => formula && formula.includes('"Atendido"') && formula.includes('"Finalizado"')));
  assert.ok(formulas.some((formula) => formula && formula.startsWith("IFERROR(")));
});
