import assert from "node:assert/strict";
import test from "node:test";
import * as email from "../src/lib/email.ts";
import * as pe from "../src/lib/patient-emails.ts";

const env = { RESEND_API_KEY: "re_SECRETKEY", EMAIL_FROM: "Harmonize <no-reply@h.com>" };
const base = { to: "paciente@x.com", patientName: "Ana <b>Souza</b>", clinicName: "Clínica <Um> & Cia", clinicPhone: "11999990000", clinicCnpj: "12345678000190", clinicAddress: "Rua \"A\", 1" };

const capture = async (fn) => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return new Response("{}", { status: 200 }); };
  const result = await fn({ env, fetchImpl });
  return { result, seen };
};

const cases = {
  confirmation: (deps) => pe.sendAppointmentConfirmationEmail({ ...base, procedure: "Botox <x>", professional: "Dr. \"X\"", date: "2026-12-05", time: "14:30" }, deps),
  rescheduled: (deps) => pe.sendAppointmentRescheduledEmail({ ...base, procedure: "Botox <x>", professional: "Dr. \"X\"", oldDate: "2026-12-05", oldTime: "14:30", newDate: "2026-12-07", newTime: "10:00" }, deps),
  cancelled: (deps) => pe.sendAppointmentCancelledEmail({ ...base, procedure: "Botox <x>", date: "2026-12-05", time: "14:30" }, deps),
  quote: (deps) => pe.sendQuoteEmail({ ...base, totalCents: 123456, expires: "2026-12-31", itemCount: 2 }, deps),
};

test("cada e-mail chama o Resend com from/to/subject/html/text corretos", async () => {
  const subjects = {
    confirmation: "Agendamento confirmado — Botox <x> em 05/12/2026",
    rescheduled: "Seu agendamento foi remarcado — Botox <x>",
    cancelled: "Agendamento cancelado — Botox <x>",
    quote: "Seu orçamento na clínica Clínica <Um> & Cia",
  };
  for (const [name, run] of Object.entries(cases)) {
    const { result, seen } = await capture(run);
    assert.deepEqual(result, { sent: true }, name);
    assert.equal(seen.url, "https://api.resend.com/emails");
    assert.equal(seen.init.headers.Authorization, "Bearer re_SECRETKEY");
    assert.equal(seen.body.from, env.EMAIL_FROM);
    assert.deepEqual(seen.body.to, ["paciente@x.com"]);
    assert.equal(seen.body.subject, subjects[name]);
    assert.ok(seen.body.text.length > 0 && seen.body.html.length > 0);
    assert.ok(seen.body.text.includes("Clínica <Um> & Cia"), name);
    // Rodapé rotulado, com telefone e CNPJ formatados a partir dos dígitos.
    assert.ok(seen.body.text.includes("Telefone: (11) 99999-0000"), name);
    assert.ok(seen.body.text.includes("CNPJ: 12.345.678/0001-90"), name);
    assert.ok(seen.body.text.includes("Endereço: Rua \"A\", 1"), name);
    assert.ok(seen.body.html.includes("Telefone: (11) 99999-0000"), name);
  }
});

test("telefone/CNPJ invalidos vao como estao, sem mascara enganosa", async () => {
  const { seen } = await capture((deps) => pe.sendAppointmentCancelledEmail({ ...base, clinicPhone: "21313131313131313131", clinicCnpj: "", procedure: "Teste", date: "2026-12-05", time: "14:30" }, deps));
  assert.ok(seen.body.text.includes("Telefone: 21313131313131313131"));
  assert.ok(!seen.body.text.includes("CNPJ:"));
});

test("html escapa nome hostil e nao injeta tags", async () => {
  for (const [name, run] of Object.entries(cases)) {
    const { seen } = await capture(run);
    const html = seen.body.html;
    assert.ok(!html.includes("<Um>"), name);
    assert.ok(!html.includes("<b>Souza"), name);
    assert.ok(!html.includes("<x>"), name);
    assert.ok(html.includes("&lt;Um&gt; &amp; Cia"), name);
    assert.ok(html.includes("Ana &lt;b&gt;Souza&lt;/b&gt;"), name);
    assert.ok(!/<img|src=|<a /i.test(html), name);
  }
  const { seen } = await capture(cases.confirmation);
  assert.ok(seen.body.html.includes("Dr. &quot;X&quot;"));
});

test("datas em pt-BR e valores em BRL", async () => {
  const conf = (await capture(cases.confirmation)).seen.body;
  assert.ok(conf.text.includes("05/12/2026 às 14:30"));
  const re = (await capture(cases.rescheduled)).seen.body;
  assert.ok(re.text.includes("Antes: 05/12/2026 às 14:30") && re.text.includes("Novo horário: 07/12/2026 às 10:00"));
  const q = (await capture(cases.quote)).seen.body;
  assert.ok(/R\$\s?1\.234,56/.test(q.text.replace(/ /g, " ")));
  assert.ok(q.text.includes("2 procedimentos") && q.text.includes("31/12/2026") && q.text.includes("recepção"));
  const one = await capture((deps) => pe.sendQuoteEmail({ ...base, totalCents: 100, itemCount: 1 }, deps));
  assert.ok(one.seen.body.text.includes("1 procedimento.") && !one.seen.body.text.includes("Válido até"));
});

test("cancelamento nao traz motivo interno nem campos extras", async () => {
  const { seen } = await capture((deps) => pe.sendAppointmentCancelledEmail({ ...base, procedure: "Botox", date: "2026-12-05", time: "09:00", cancellationReason: "NOTA INTERNA" }, deps));
  assert.ok(!seen.body.text.includes("NOTA INTERNA") && !seen.body.html.includes("NOTA INTERNA"));
});

test("sem provedor => not_configured sem chamar fetch", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return new Response("{}"); };
  for (const run of Object.values(cases)) {
    assert.deepEqual(await run({ env: {}, fetchImpl }), { sent: false, reason: "not_configured" });
  }
  assert.equal(called, 0);
});

test("nunca lanca e so loga codigo estavel, sem PII", async () => {
  const lines = [];
  const orig = {};
  for (const m of ["log", "info", "warn", "error", "debug"]) { orig[m] = console[m]; console[m] = (...a) => lines.push(a.map(String).join(" ")); }
  const results = [];
  try {
    for (const run of Object.values(cases)) {
      results.push(await run({ env, fetchImpl: async () => new Response("paciente@x.com Ana", { status: 500 }) }));
      results.push(await run({ env, fetchImpl: async () => { throw new Error("falha paciente@x.com re_SECRETKEY"); } }));
      results.push(await run({ env, fetchImpl: async () => { throw new DOMException("t", "TimeoutError"); } }));
    }
  } finally {
    for (const m of Object.keys(orig)) console[m] = orig[m];
  }
  assert.ok(results.every((r) => r.sent === false));
  assert.ok(lines.length > 0);
  for (const l of lines) assert.match(l, /^\[email\] (provider_error|network|timeout)$/);
});

test("isEmailDeliveryReady exige chave e remetente", () => {
  assert.equal(email.isEmailDeliveryReady(env), true);
  assert.equal(email.isEmailDeliveryReady({ RESEND_API_KEY: "k" }), false);
  assert.equal(email.isEmailDeliveryReady({ EMAIL_FROM: "a@b.c", RESEND_API_KEY: " " }), false);
  assert.equal(email.isEmailDeliveryReady({}), false);
});

test("orçamento com anexo envia attachments ao Resend; sem anexo o payload não tem a chave", async () => {
  const attachment = { filename: "orcamento.pdf", content: "JVBERi0=" };
  const withFile = await capture((deps) => pe.sendQuoteEmail({ ...base, totalCents: 1000, attachment }, deps));
  assert.deepEqual(withFile.result, { sent: true });
  assert.deepEqual(withFile.seen.body.attachments, [attachment]);
  const without = await capture((deps) => pe.sendQuoteEmail({ ...base, totalCents: 1000 }, deps));
  assert.equal("attachments" in without.seen.body, false);
});
