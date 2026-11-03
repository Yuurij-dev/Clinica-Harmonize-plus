import assert from "node:assert/strict";
import { test } from "node:test";
import { PATIENT_TOUR_STEPS, patientTourKey, patientTourSelector, patientTourTarget, visiblePatientTourSteps } from "../src/lib/patient-tour-rules.ts";
import { MASCOT_POSES } from "../src/lib/mascot-rules.ts";
import { shouldShowTour, tourKey, TOUR_SEEN } from "../src/lib/tour-rules.ts";

test("tour da ficha tem os 12 passos, abertura e fim sem destaque", () => {
  assert.equal(PATIENT_TOUR_STEPS.length, 12);
  assert.equal(PATIENT_TOUR_STEPS[0].key, "inicio");
  assert.equal(PATIENT_TOUR_STEPS.at(-1).key, "fim");
  assert.equal(PATIENT_TOUR_STEPS[0].target, undefined);
  assert.equal(PATIENT_TOUR_STEPS.at(-1).target, undefined);
  assert.equal(new Set(PATIENT_TOUR_STEPS.map((s) => s.key)).size, 12);
  for (const s of PATIENT_TOUR_STEPS) assert.ok(s.title && s.text && MASCOT_POSES.includes(s.pose));
});

test("chave do localStorage é própria, por usuário e distinta do tour geral", () => {
  assert.equal(patientTourKey("abc-1"), "harmonize_tour_patient_v1_abc-1");
  assert.notEqual(patientTourKey("a"), patientTourKey("b"));
  assert.notEqual(patientTourKey("a"), tourKey("a"));
  assert.equal(patientTourKey("a/b c"), "harmonize_tour_patient_v1_a_b_c");
  assert.equal(patientTourKey(""), "harmonize_tour_patient_v1_anon");
});

test("mesma regra de primeiro acesso: falha de leitura não reabre", () => {
  assert.equal(shouldShowTour(null), true);
  assert.equal(shouldShowTour(TOUR_SEEN), false);
  assert.equal(shouldShowTour(null, true), false);
});

test("com acesso clínico mostra os 12 passos com os textos originais", () => {
  const steps = visiblePatientTourSteps(true);
  assert.equal(steps.length, 12);
  assert.ok(steps.some((s) => s.key === "fotos"));
  assert.match(steps.find((s) => s.key === "prontuario").text, /fotos/);
});

// Termos que prometem conteúdo clínico: nenhum texto mostrado a quem não lê dados clínicos pode usá-los como algo que a pessoa acessa.
const clinicalTerms = /avalia[çc]|foto|imagem|antes e (o )?depois|alergi|medica[çc]|observa[çc][õo]es cl[íi]nicas|hist[óo]rico cl[íi]nico|evolu[çc]|marca[çc][õo]es|procedimento/i;

test("sem acesso clínico some Fotos e nenhum campo de nenhum passo promete conteúdo clínico", () => {
  const steps = visiblePatientTourSteps(false);
  assert.equal(steps.length, 11);
  assert.ok(!steps.some((s) => s.key === "fotos"));
  for (const step of steps) {
    const original = PATIENT_TOUR_STEPS.find((x) => x.key === step.key);
    const clinicalFree = (text) => !clinicalTerms.test(text);
    // O que o perfil recebe é a variante simples quando existe; sem variante, o texto original precisa já estar livre de termos clínicos.
    assert.ok(clinicalFree(step.title), "título: " + step.key);
    assert.ok(clinicalFree(step.text.replace(/restrit[oa]s? à equipe clínica/g, "")), "texto: " + step.key);
    if (original.plainTitle) assert.equal(step.title, original.plainTitle);
    if (original.plainText) assert.equal(step.text, original.plainText);
  }
});

test("sem acesso clínico, o título da área continua batendo com o rótulo real da aba", () => {
  for (const step of visiblePatientTourSteps(false)) {
    if (step.recordTab) assert.equal(step.title, step.recordTab);
    else if (step.tab) assert.ok(step.title.startsWith(step.tab));
  }
});

test("STAFF: cada área descreve o que o perfil realmente vê", () => {
  const by = Object.fromEntries(visiblePatientTourSteps(false).map((s) => [s.key, s]));
  // Documentos: STAFF vê as categorias administrativas (termos, declarações, orientações) — não é negado nem prometido tudo.
  assert.match(by.documentos.text, /termos/i);
  assert.match(by.documentos.text, /restritas à equipe clínica/);
  // Resumo clínico: STAFF vê o aviso de restrição e as observações administrativas.
  assert.match(by["resumo-clinico"].text, /restrito à equipe clínica/);
  assert.match(by["resumo-clinico"].text, /administrativas/);
  // Anamnese: a aba existe, mas as respostas são restritas (anamnesis:read).
  assert.match(by.anamnese.text, /restrito à equipe clínica/);
  assert.doesNotMatch(by.anamnese.text, /alergias|medicações/);
  // Tratamentos: lista de jornadas com etapa, sem citar avaliação.
  assert.match(by.tratamentos.text, /etapa/);
});

test("com acesso clínico nenhum passo usa texto simples", () => {
  const steps = visiblePatientTourSteps(true);
  for (const step of steps) {
    const original = PATIENT_TOUR_STEPS.find((x) => x.key === step.key);
    assert.equal(step.title, original.title);
    assert.equal(step.text, original.text);
  }
});

test("alvos de abas e áreas casam com os passos", () => {
  assert.equal(patientTourTarget("Visão geral", "tab"), "visao-geral");
  assert.equal(patientTourTarget("Prontuário", "tab"), "prontuario");
  assert.equal(patientTourTarget("Documentos clínicos", "record"), "documentos");
  assert.equal(patientTourTarget("Fotos", "record"), "fotos");
  assert.equal(patientTourTarget("Inexistente", "tab"), undefined);
  assert.equal(patientTourSelector({ target: "fotos" }), '[data-tour-patient="fotos"]');
  assert.equal(patientTourSelector({}), undefined);
});

test("passos de área do prontuário abrem a aba Prontuário", () => {
  for (const s of PATIENT_TOUR_STEPS) if (s.recordTab) assert.equal(s.tab, "Prontuário");
});
