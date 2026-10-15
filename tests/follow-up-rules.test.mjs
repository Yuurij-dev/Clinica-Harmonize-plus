import assert from "node:assert/strict";
import { test } from "node:test";
import { validateFollowUpDraft } from "../src/lib/follow-up-rules.ts";

const empty = { guidanceText: "", guidanceSent: false, observations: "", complications: "", photoCount: 0, appointmentId: "" };

test("empty follow-up gets one inline content error", () => {
  assert.deepEqual(validateFollowUpDraft(empty), {
    content: "Adicione uma orientação, observação, intercorrência, foto ou retorno para registrar a evolução.",
  });
});

test("sent guidance requires its text without duplicating the empty-content error", () => {
  assert.deepEqual(validateFollowUpDraft({ ...empty, guidanceSent: true }), {
    guidance: "Informe o texto das orientações que foram enviadas.",
  });
});

test("any valid clinical record satisfies the minimum content rule", () => {
  for (const update of [{ guidanceText: "Cuidados" }, { observations: "Evolução" }, { complications: "Sem intercorrências" }, { photoCount: 1 }, { appointmentId: "return-1" }]) {
    assert.deepEqual(validateFollowUpDraft({ ...empty, ...update }), {});
  }
});

test("follow-up photos are limited to twelve per record", () => {
  assert.deepEqual(validateFollowUpDraft({ ...empty, photoCount: 13 }), {
    photos: "Cada registro aceita até 12 fotografias.",
  });
});
