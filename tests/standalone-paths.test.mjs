import assert from "node:assert/strict";
import test from "node:test";
import { isStandalonePath } from "../src/lib/standalone-paths.ts";

test("isStandalonePath: só /login e /convite/<token> escapam do HarmonizeApp", () => {
  assert.equal(isStandalonePath("/login"), true);
  assert.equal(isStandalonePath("/convite/abc"), true);
  for (const p of ["/convite", "/clientes", "/convite-x", "/convitefoo/abc", "/", "/login/x", "", null, undefined]) {
    assert.equal(isStandalonePath(p), false, String(p));
  }
});
