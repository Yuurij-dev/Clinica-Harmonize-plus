import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// O script de autocomplete é uma string inline no layout (não importável): estes testes conferem o contrato no código-fonte.
// O comportamento real foi verificado no navegador (formulário comum recebe off; data-autofill="allow" fica intacto).
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("layout: o script pula formularios data-autofill=allow", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /closest\('form\[data-autofill="allow"\]'\)/);
  assert.match(layout, /if \(allowed\(element\)\) return;/);
  // o resto continua desligando autocomplete
  assert.match(layout, /element\.autocomplete = "off"/);
});

test("todos os formularios de autenticacao declaram data-autofill=allow", () => {
  for (const file of ["src/components/harmonize/login-screen.tsx", "src/components/harmonize/invite-accept-screen.tsx"]) {
    const forms = read(file).match(/<form\b[^>]*>/g) ?? [];
    assert.ok(forms.length > 0, file);
    for (const tag of forms) assert.match(tag, /data-autofill="allow"/, `${file}: ${tag}`);
  }
});
