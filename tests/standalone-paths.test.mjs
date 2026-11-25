import assert from "node:assert/strict";
import test from "node:test";
import { isStandalonePath } from "../src/lib/standalone-paths.ts";

test("isStandalonePath: só /login, /convite/<token>, a recuperação de senha e as páginas legais escapam do HarmonizeApp", () => {
  assert.equal(isStandalonePath("/login"), true);
  assert.equal(isStandalonePath("/convite/abc"), true);
  assert.equal(isStandalonePath("/privacidade"), true);
  assert.equal(isStandalonePath("/termos"), true);
  assert.equal(isStandalonePath("/recuperar-senha"), true);
  assert.equal(isStandalonePath("/redefinir-senha"), true);
  for (const p of ["/convite", "/clientes", "/convite-x", "/convitefoo/abc", "/", "/login/x", "/privacidade/x", "/termos-x", "/recuperar-senha/x", "/redefinir-senha-x", "", null, undefined]) {
    assert.equal(isStandalonePath(p), false, String(p));
  }
});
