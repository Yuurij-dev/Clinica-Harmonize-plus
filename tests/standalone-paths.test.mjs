import assert from "node:assert/strict";
import test from "node:test";
import { isStandalonePath } from "../src/lib/standalone-paths.ts";

test("isStandalonePath: só /login, /convite/<token> e as páginas legais escapam do HarmonizeApp", () => {
  assert.equal(isStandalonePath("/login"), true);
  assert.equal(isStandalonePath("/convite/abc"), true);
  assert.equal(isStandalonePath("/privacidade"), true);
  assert.equal(isStandalonePath("/termos"), true);
  for (const p of ["/convite", "/clientes", "/convite-x", "/convitefoo/abc", "/", "/login/x", "/privacidade/x", "/termos-x", "", null, undefined]) {
    assert.equal(isStandalonePath(p), false, String(p));
  }
});
