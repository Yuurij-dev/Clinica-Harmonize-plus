import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedProcedureNames, parseJson, validateSessionPayload } from "../src/lib/procedure-session-rules.ts";

test("approved procedure names are read from the quote details items object", () => {
  assert.deepEqual(approvedProcedureNames(JSON.stringify({ items: [{ name: "Preenchimento" }, { name: "Botox" }] })), ["Preenchimento", "Botox"]);
});

test("approved procedure names tolerate legacy arrays and malformed quote details", () => {
  assert.deepEqual(approvedProcedureNames(JSON.stringify([{ name: "Preenchimento" }])), ["Preenchimento"]);
  assert.deepEqual(approvedProcedureNames("not-json"), []);
  assert.deepEqual(approvedProcedureNames(JSON.stringify({ items: [{ procedureId: "x" }, null] })), []);
});

test("combined procedure name joins every approved item once", async () => {
  const { combinedProcedureName } = await import("../src/lib/procedure-session-rules.ts");
  assert.equal(combinedProcedureName(["12", "botox"]), "12 + botox");
  assert.equal(combinedProcedureName(["Botox", " Botox ", ""]), "Botox");
  assert.equal(combinedProcedureName([]), "");
});

test("only legacy drafts are renamed to the combined quote name", async () => {
  const { shouldRefreshDraftName } = await import("../src/lib/procedure-session-rules.ts");
  assert.equal(shouldRefreshDraftName({ status: "Rascunho", procedureName: "12" }, "12 + botox"), true);
  assert.equal(shouldRefreshDraftName({ status: "Rascunho", procedureName: "12 + botox" }, "12 + botox"), false);
  assert.equal(shouldRefreshDraftName({ status: "Em execução", procedureName: "12" }, "12 + botox"), false);
  assert.equal(shouldRefreshDraftName({ status: "Concluída", procedureName: "12" }, "12 + botox"), false);
});

test("agendamento de procedimento usa prefixo próprio e não se confunde com retorno", async () => {
  const { procedureAppointmentName, isProcedureAppointmentName } = await import("../src/lib/procedure-session-rules.ts");
  assert.equal(procedureAppointmentName("12 + botox"), "Procedimento - 12 + botox");
  assert.equal(isProcedureAppointmentName("Procedimento - 12 + botox"), true);
  assert.equal(isProcedureAppointmentName("Retorno - 12 + botox"), false);
});

test("variantes de duplicata cobrem nome puro e prefixado, mas ignoram retorno e avaliação", async () => {
  const { procedureAppointmentVariants, splitCombinedProcedureName } = await import("../src/lib/procedure-session-rules.ts");
  assert.deepEqual(procedureAppointmentVariants("Procedimento - Botox"), ["Botox", "Procedimento - Botox"]);
  assert.deepEqual(procedureAppointmentVariants("Botox"), ["Botox", "Procedimento - Botox"]);
  assert.equal(procedureAppointmentVariants("Retorno - Botox"), null);
  assert.equal(procedureAppointmentVariants("Avaliação"), null);
  assert.deepEqual(splitCombinedProcedureName("Procedimento - A + B + A"), ["A", "B"]);
});

test("appointmentStartNow usa o dia e o HH:mm exatos da clínica", async () => {
  const { appointmentStartNow } = await import("../src/lib/procedure-session-rules.ts");
  assert.deepEqual(appointmentStartNow({ date: "2026-10-21", minutes: 9 * 60 + 5 }), { day: "2026-10-21", time: "09:05" });
  assert.deepEqual(appointmentStartNow({ date: "2026-10-21", minutes: 23 * 60 + 59 }), { day: "2026-10-21", time: "23:59" });
});

test("isMovableStartAppointment move só Procedimento agendado", async () => {
  const { isMovableStartAppointment } = await import("../src/lib/procedure-session-rules.ts");
  assert.equal(isMovableStartAppointment({ procedure: "Procedimento - Botox", status: "Agendado" }), true);
  assert.equal(isMovableStartAppointment({ procedure: "Procedimento - Botox", status: "Em atendimento" }), false);
  assert.equal(isMovableStartAppointment({ procedure: "Retorno - Botox", status: "Agendado" }), false);
});

test("appointment duration resolves prefixed and combined names from the procedure catalog", async () => {
  const { appointmentProcedureDuration, appointmentDurationLookupNames } = await import("../src/lib/procedure-session-rules.ts");
  const catalog = [{ name: "Botox", durationMinutes: 30 }, { name: "Preenchimento", durationMinutes: 120 }];
  assert.equal(appointmentProcedureDuration(catalog, "Botox"), 30);
  assert.equal(appointmentProcedureDuration(catalog, "Procedimento - Preenchimento"), 120);
  assert.equal(appointmentProcedureDuration(catalog, "Retorno - Botox"), 30);
  assert.equal(appointmentProcedureDuration(catalog, "Procedimento - Botox + Preenchimento"), 150);
  assert.equal(appointmentProcedureDuration(catalog, "Procedimento - Botox + Outro"), undefined);
  assert.equal(appointmentProcedureDuration(catalog, "Avaliação"), undefined);
  assert.equal(appointmentProcedureDuration([{ name: "Procedimento - X", durationMinutes: 45 }], "Procedimento - X"), 45);
  assert.deepEqual(appointmentDurationLookupNames("Procedimento - A + B"), ["Procedimento - A + B", "A + B", "A", "B"]);
});

test("validateSessionPayload recusa status, materiais e fotos inválidos e aceita um rascunho simples", () => {
  const photo = { id: "p1", phase: "Antes", imageUrl: "data:image/png;base64,AAAA", name: "antes", width: 10, height: 10 };
  assert.equal(validateSessionPayload({ status: "Rascunho", technique: "x" }), null);
  assert.equal(validateSessionPayload({ status: "Em execução", photos: [photo] }), null);
  assert.equal(validateSessionPayload(null), "Status de sessão inválido.");
  assert.equal(validateSessionPayload({ status: "Cancelada" }), "Status de sessão inválido.");
  assert.match(validateSessionPayload({ materials: [{ productId: "a", quantity: 0 }] }), /produtos/);
  assert.match(validateSessionPayload({ photos: [{ ...photo, phase: "Depois" }] }), /fotografias/);
  assert.match(validateSessionPayload({ photos: Array.from({ length: 21 }, (_, index) => ({ ...photo, id: `p${index}` })) }), /fotografias/);
  assert.match(validateSessionPayload({ durationMinutes: 1441 }), /duração/);
});

test("parseJson devolve o padrão para JSON inválido", () => {
  assert.deepEqual(parseJson("[1]", []), [1]);
  assert.deepEqual(parseJson("{", []), []);
});
