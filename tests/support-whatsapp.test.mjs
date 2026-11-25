import assert from "node:assert/strict";
import test from "node:test";
import { getSupportWhatsappLink } from "../src/lib/support-whatsapp.ts";

test("getSupportWhatsappLink: sem numero ou sem mensagem configurados, retorna null (mantem o comportamento atual da tela)", () => {
  assert.equal(getSupportWhatsappLink({}), null);
  assert.equal(getSupportWhatsappLink({ SUPPORT_WHATSAPP_NUMBER: "556181417913" }), null);
  assert.equal(getSupportWhatsappLink({ SUPPORT_WHATSAPP_MESSAGE: "Ola" }), null);
  assert.equal(getSupportWhatsappLink({ SUPPORT_WHATSAPP_NUMBER: "556181417913", SUPPORT_WHATSAPP_MESSAGE: "   " }), null);
});

test("getSupportWhatsappLink: gera link wa.me, numero so com digitos (com ou sem +55 já incluso) e \\n vira quebra de linha real antes de codificar", () => {
  const withCountryCode = getSupportWhatsappLink({ SUPPORT_WHATSAPP_NUMBER: "+55 61 8141-7913", SUPPORT_WHATSAPP_MESSAGE: "Ola!\\nTudo bem?" });
  assert.equal(withCountryCode, "https://wa.me/556181417913?text=Ola!%0ATudo%20bem%3F");

  const withoutCountryCode = getSupportWhatsappLink({ SUPPORT_WHATSAPP_NUMBER: "(61) 8141-7913", SUPPORT_WHATSAPP_MESSAGE: "Ola!\\nTudo bem?" });
  assert.equal(withoutCountryCode, "https://wa.me/556181417913?text=Ola!%0ATudo%20bem%3F");
});

test("getSupportWhatsappLink: preserva acentos, emojis e multiplas quebras de linha (round-trip identico a mensagem original)", () => {
  const message = "Olá! Tudo bem? 👋\\n\\nPreciso de ajuda para acessar o Harmonize+.\\n\\n📧 E-mail cadastrado:\\n\\nAguardo o retorno. Obrigado(a)!";
  const expected = message.replace(/\\n/g, "\n");
  const link = getSupportWhatsappLink({ SUPPORT_WHATSAPP_NUMBER: "556181417913", SUPPORT_WHATSAPP_MESSAGE: message });
  const encodedText = link.split("?text=")[1];
  assert.equal(decodeURIComponent(encodedText), expected);
});
