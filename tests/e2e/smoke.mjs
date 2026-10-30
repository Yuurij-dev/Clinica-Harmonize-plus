// Testes ponta a ponta pela API, com a conta de teste, contra o servidor em execução (npm run dev).
// Uso: npm run test:e2e   (E2E_BASE_URL muda o endereço; padrão http://localhost:3000)
//      npm run test:e2e -- estoque agenda   roda só essas partes (e as que elas precisam); ver `suites` abaixo.
// Precisa de TEST_ACCOUNT_EMAIL e TEST_ACCOUNT_PASSWORD no .env. Só roda na clínica de teste, que é esvaziada
// no começo e no fim de cada execução. A parte de navegador usa o Microsoft Edge instalado (E2E_BROWSER muda o canal).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const testClinicName = "Clínica Teste Auditoria";
const email = process.env.TEST_ACCOUNT_EMAIL;
const password = process.env.TEST_ACCOUNT_PASSWORD;
const run = Date.now().toString(36);
const results = [];
const prisma = new PrismaClient();
// Avaliação completa: para CONCLUIR, a API exige queixa, objetivo, os 5 campos da anamnese rápida e observações.
const fullAssessment = { chiefComplaint: "Queixa", patientGoal: "Obj", allergies: "Não", pregnancyStatus: "Não", anticoagulantUse: "Não", autoimmuneDiseases: "Não", previousProcedures: "Não", clinicalNotes: "Obs" };
let cookie = "";
// Nome da conta de teste (autor gravado em anamnese, auditoria etc.); vem do login.
let accountName = "";

async function api(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const session = response.headers.getSetCookie().find((value) => value.startsWith("harmonize_session="));
  if (session) cookie = session.split(";")[0];
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
  return { status: response.status, data };
}

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
}

const day = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + offset * 86_400_000));
const randomCpf = () => Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join("");

async function login() {
  const response = await api("POST", "/api/auth/login", { login: email, password });
  if (response.status !== 200) throw new Error(`Login da conta de teste falhou (${response.status}): ${JSON.stringify(response.data)}`);
  if (response.data.user?.clinic?.name !== testClinicName) throw new Error(`A conta de teste não está na "${testClinicName}". Abortado para não mexer em clínica real.`);
  accountName = response.data.user.name;
}

async function patientsAndPayments() {
  let r = await api("POST", "/api/patients", { name: `Paciente ${run}`, phone: "11999990000", age: 30, cpf: "123" });
  check("CPF inválido no cadastro é recusado", r.status === 400, r.status);
  const cpf = randomCpf();
  r = await api("POST", "/api/patients", { name: `Paciente ${run}`, phone: "11999990000", age: 30, cpf });
  const patient = r.data.patient;
  check("cadastro de paciente", r.status === 201, r.status);
  r = await api("POST", "/api/patients", { name: `Outro ${run}`, phone: "11999990001", age: 31, cpf });
  check("CPF repetido devolve 409", r.status === 409, r.status);
  const sameCpf = randomCpf();
  const pair = await Promise.all([1, 2].map((n) => api("POST", "/api/patients", { name: `CPF Simultâneo ${n} ${run}`, phone: "11999990004", age: 30, cpf: sameCpf })));
  check("dois cadastros simultâneos com o mesmo CPF: um 201 e um 409, nunca 500", pair.map((res) => res.status).sort().join() === "201,409", pair.map((res) => res.status).join("/"));
  r = await api("POST", "/api/patients", { name: `Paciente ${run}`, phone: "11999990002", age: 40 });
  const homonym = r.data.patient;

  const before = (await api("GET", "/api/finance/summary?period=month")).data.totals?.receivedCents ?? 0;
  r = await api("POST", "/api/payments", { patient: `Paciente ${run}`, value: 10, method: "Pix", installments: "A vista" });
  check("pagamento só com nome é recusado", r.status === 400, r.status);
  for (const [label, extra] of [["valor negativo", { value: -50 }], ["status fora da lista", { status: "pago" }]]) {
    r = await api("POST", "/api/payments", { patientId: homonym.id, value: 10, method: "Pix", status: "Pago", installments: "A vista", ...extra });
    check(`pagamento com ${label} é recusado (400)`, r.status === 400, r.status);
  }
  r = await api("POST", "/api/payments", { patientId: homonym.id, value: 0, method: "Pix", status: "Pago", installments: "A vista" });
  check("pagamento de R$ 0 (orçamento de cortesia) é aceito", r.status === 201 && r.data.payment?.value === 0, r.status);
  r = await api("POST", "/api/payments", { patientId: homonym.id, value: 150.5, method: "Pix", status: "Pago", installments: "A vista" });
  check("pagamento guarda centavos (R$ 150,50)", r.status === 201 && r.data.payment?.value === 150.5, JSON.stringify(r.data.payment?.value));
  check("pagamento fica no paciente escolhido, não no homônimo", r.data.payment?.patientId === homonym.id);
  r = await api("GET", "/api/payments");
  check("lista de pagamentos devolve reais", r.data.payments?.some((payment) => payment.id && payment.value === 150.5));
  const listedPayment = r.data.payments?.find((payment) => payment.value === 150.5);
  const paymentsIn = async (query) => api("GET", `/api/payments?${query}`);
  const today = day(0);
  const [inToday, inPast, badPeriod] = await Promise.all([paymentsIn(`from=${today}&to=${today}`), paymentsIn("from=2000-01-01&to=2000-01-31"), paymentsIn("from=31/12/2000")]);
  check("lista de pagamentos filtra o período no servidor (hoje traz, 2000 não, data inválida 400)", inToday.data.payments?.some((payment) => payment.value === 150.5) && inToday.data.hasMore === false && inPast.status === 200 && inPast.data.payments?.length === 0 && badPeriod.status === 400, `${inToday.data.payments?.length}/${inPast.data.payments?.length}/${badPeriod.status}`);
  check("lista de pagamentos é enxuta e limitada a 200",listedPayment && !("clinicId" in listedPayment) && !("journeyId" in listedPayment) && listedPayment.patient?.name && r.data.payments.length <= 200, JSON.stringify(Object.keys(listedPayment ?? {})));
  const after = (await api("GET", "/api/finance/summary?period=month")).data.totals?.receivedCents ?? 0;
  check("resumo financeiro soma o pagamento em centavos", after - before === 15_050, `${before} → ${after}`);
  r = await api("GET", "/api/dashboard/bootstrap");
  check("dashboard traz total de atendimentos e valores em reais", typeof r.data.appointmentCount === "number" && r.data.payments?.some((payment) => payment.value === 150.5), r.status);
  // Paciente sem jornada recebendo registros ao mesmo tempo: uma só "Jornada 1".
  const fresh = (await api("POST", "/api/patients", { name: `Sem Jornada ${run}`, phone: "11999990003", age: 28 })).data.patient;
  const burst = await Promise.all([
    api("POST", "/api/payments", { patientId: fresh?.id, value: 5, method: "Pix", status: "Pago", installments: "A vista" }),
    api("POST", "/api/payments", { patientId: fresh?.id, value: 6, method: "Pix", status: "Pago", installments: "A vista" }),
    api("POST", "/api/quotes", { patientId: fresh?.id, items: "Avulso (1x)", total: 7 }),
  ]);
  const journeyCount = await prisma.patientJourney.count({ where: { patientId: fresh?.id ?? "" } });
  check("registros simultâneos de paciente sem jornada criam uma só jornada", burst.every((res) => res.status === 201) && journeyCount === 1, `${burst.map((res) => res.status).join("/")} jornadas=${journeyCount}`);
  return { patient, homonym };
}

async function quotesAndProcedures(patient) {
  let r = await api("POST", "/api/quotes", { patientId: patient.id, items: "Botox (1x)", total: 99.4, expires: "30/12/2030" });
  const quote = r.data.quote;
  check("orçamento guarda centavos (R$ 99,40)", quote?.total === 99.4, JSON.stringify(quote?.total));
  const list = await api("GET", "/api/quotes");
  const listed = list.data.quotes?.find((item) => item.id === quote?.id);
  const [quotesToday, quotesPast, quotesBad] = await Promise.all([api("GET", `/api/quotes?from=${day(0)}&to=${day(0)}`), api("GET", "/api/quotes?to=2000-01-31"), api("GET", "/api/quotes?to=2000-13-01")]);
  check("lista de orçamentos filtra o período no servidor (hoje traz, até 2000 não, data inválida 400)", quotesToday.data.quotes?.some((item) => item.id === quote?.id) && quotesToday.data.hasMore === false && quotesPast.data.quotes?.length === 0 && quotesBad.status === 400, `${quotesToday.data.quotes?.length}/${quotesPast.data.quotes?.length}/${quotesBad.status}`);
  check("lista de orçamentos é enxuta (sem details/notes) e limitada a 200",listed && listed.total === 99.4 && listed.patient?.name && !("details" in listed) && !("notes" in listed) && list.data.quotes.length <= 200, JSON.stringify(Object.keys(listed ?? {})));
  const [a, b] = await Promise.all([api("PATCH", `/api/quotes/${quote.id}`, { status: "Aprovado" }), api("PATCH", `/api/quotes/${quote.id}`, { status: "Aprovado" })]);
  r = await api("GET", `/api/patients/${patient.id}/history?tab=Procedimentos`);
  const fromQuote = r.data.patient?.procedureRecords?.filter((procedure) => procedure.quoteId === quote.id) ?? [];
  check("dois 'Aprovado' simultâneos criam um só procedimento", fromQuote.length === 1, `${a.status}/${b.status}, ${fromQuote.length}`);
  const procedureId = fromQuote[0]?.id;
  r = await api("PATCH", `/api/patients/${patient.id}/procedures/${procedureId}`, { photoType: "clinicId", photo: null });
  check("foto recusa photoType fora de before/after", r.status === 400, r.status);
  r = await api("GET", `/api/patients/${patient.id}/history?tab=Procedimentos`);
  check("procedimento continua no prontuário", r.data.patient?.procedureRecords?.some((procedure) => procedure.id === procedureId));
  return quote;
}

async function appointments(patient) {
  let r = await api("POST", "/api/appointments", { patientId: patient.id, procedure: "Retorno", professional: "Teste", time: "09:00", date: `${day(1)}T00:00:00` });
  const appointment = r.data.appointment;
  check("agendamento para amanhã é criado", r.status === 201, JSON.stringify(r.data).slice(0, 120));
  check("dia do agendamento gravado ao meio-dia de São Paulo", appointment?.date === `${day(1)}T15:00:00.000Z`, appointment?.date);
  const far = (await api("POST", "/api/appointments", { patientId: patient.id, procedure: "Retorno", professional: "Teste Distante", time: "09:00", date: day(100) })).data.appointment;
  const dashboard = (await api("GET", "/api/dashboard/bootstrap")).data;
  check("dashboard traz o agendamento de amanhã mas não o de daqui a 100 dias", Boolean(far) && dashboard.appointments?.some((item) => item.id === appointment?.id) && !dashboard.appointments?.some((item) => item.id === far?.id), `${far?.id} ${dashboard.appointments?.length}`);
  if (far) await api("DELETE", `/api/appointments/${far.id}`);
  r = await api("POST", "/api/appointments", { patient: `Paciente ${run}`, procedure: "Retorno", professional: "Teste", time: "10:00", date: day(1) });
  check("agendamento só com nome é recusado", r.status === 400, r.status);
  r = await api("GET", `/api/patients/${patient.id}/history?tab=Agendamentos`);
  check("histórico não marca falta antes da hora", r.data.patient?.appointments?.find((item) => item.id === appointment?.id)?.status === "Agendado");
  r = await api("PATCH", `/api/appointments/${appointment.id}`, { status: "Qualquer" });
  check("status de agendamento inválido é recusado", r.status === 400, r.status);
  r = await api("PATCH", `/api/appointments/${appointment.id}`, { time: "99:99" });
  check("horário inválido é recusado", r.status === 400, r.status);
  r = await api("PATCH", `/api/appointments/${appointment.id}`, { date: `${day(2)}T10:00:00-03:00`, time: "10:00" });
  check("remarcar mantém o dia escolhido", r.data.appointment?.date === `${day(2)}T15:00:00.000Z`, r.data.appointment?.date);
}

async function journeys(patient, quote) {
  let r = await api("GET", `/api/patients/${patient.id}/journeys`);
  const first = r.data.journeys?.[0];
  check("jornadas trazem marcações de progresso", first?.hasPaidQuote === true && first?.hasProcedure === true, JSON.stringify(first));
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  r = await api("POST", `/api/patients/${patient.id}/journeys`, { name: "Jornada 2", professionalId: professional?.id });
  const second = r.data.journey;
  r = await api("DELETE", `/api/patients/${patient.id}/journeys/${first.id}`);
  check("jornada com orçamento aprovado não pode ser excluída", r.status === 409, r.status);
  await api("PATCH", `/api/quotes/${quote.id}`, { status: "Pendente" });
  const evaluation = await api("PUT", `/api/patients/${patient.id}/evaluation`, { journeyId: first.id, photos: [], assessment: { chiefComplaint: "Queixa vinculada à jornada" }, status: "Rascunho" });
  const evaluationList = await api("GET", `/api/patients/${patient.id}/evaluation?list=1&journeyId=${first.id}`);
  check("avaliação de teste é vinculada à jornada", evaluation.status === 200 && evaluationList.data.evaluations?.length === 1, evaluation.status);
  r = await api("DELETE", `/api/patients/${patient.id}/journeys/${first.id}`);
  check("jornada sem orçamento aprovado é excluída", r.status === 200, r.status);
  r = await api("GET", `/api/patients/${patient.id}/evaluation?list=1&journeyId=${first.id}`);
  check("excluir jornada também remove sua avaliação", r.status === 200 && r.data.evaluations?.length === 0, JSON.stringify(r.data.evaluations));
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  r = await api("PUT", `/api/patients/${patient.id}/evaluation`, { photos: [{ name: "frente", imageUrl: png, width: 1, height: 1, annotations: [] }] });
  check("avaliação é salva", r.status === 200, r.status);
  r = await api("GET", `/api/patients/${patient.id}/journeys`);
  check("avaliação nova cai na jornada ativa", r.data.journeys?.length === 1 && r.data.journeys[0].id === second?.id && r.data.journeys[0].hasEvaluation, JSON.stringify(r.data.journeys));
}

// Exclusão de jornada em cascata: o papel não apaga pagamentos, documentos e fotos que não poderia apagar isoladamente.
async function journeyDeletePermissions() {
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const clinicId = (await prisma.clinicMembership.findFirst({ where: { user: { email: email.toLowerCase() }, clinic: { name: testClinicName } }, select: { clinicId: true } }))?.clinicId;
  const staffEmail = `e2e-jd-staff-${run}@example.com`, staffPassword = `E2e-${run}-Staff9!`;
  const proEmail = `e2e-jd-pro-${run}@example.com`, proPassword = `E2e-${run}-Pro99!`;
  const otherEmail = `e2e-jd-outra-${run}@example.com`, otherPassword = `E2e-${run}-Outra9!`, otherClinic = `E2E JornadaDel Externa ${run}`;
  const members = [];
  const mkPatient = async (label) => (await api("POST", "/api/patients", { name: `JD ${label} ${run}`, phone: "11999990077", age: 30, cpf: randomCpf() })).data.patient;
  const mkJourney = async (pid, label) => (await api("POST", `/api/patients/${pid}/journeys`, { name: `JD ${label} ${run}`, professionalId: professional?.id })).data.journey;
  const file = { mimeType: "application/pdf", sizeBytes: 3, sha256: "x", uploadedBy: "e2e", uploadedByName: "E2E" };
  const addPayment = (pid, jid) => prisma.payment.create({ data: { clinicId, patientId: pid, journeyId: jid, valueCents: 1000, method: "Pix", installments: "A vista" } });
  const addDocument = (pid, jid) => prisma.clinicalDocument.create({ data: { clinicId, patientId: pid, journeyId: jid, name: "Termo", originalName: "termo.pdf", signatureStatus: "ASSINADO", ...file, blob: { create: { data: Buffer.from("pdf") } } } });
  const addPhoto = (pid, jid) => prisma.clinicalPhoto.create({ data: { clinicId, patientId: pid, journeyId: jid, name: "Foto", width: 1, height: 1, ...file, mimeType: "image/png", blob: { create: { data: Buffer.from("png") } } } });
  const counts = async (pid, jid) => ({
    journey: await prisma.patientJourney.count({ where: { id: jid } }),
    payments: await prisma.payment.count({ where: { patientId: pid, journeyId: jid } }),
    documents: await prisma.clinicalDocument.count({ where: { patientId: pid, journeyId: jid } }),
    photos: await prisma.clinicalPhoto.count({ where: { patientId: pid, journeyId: jid } }),
    documentBlobs: await prisma.clinicalDocumentBlob.count({ where: { document: { patientId: pid } } }),
    photoBlobs: await prisma.clinicalPhotoBlob.count({ where: { photo: { patientId: pid } } }),
  });
  const del = (pid, jid) => api("DELETE", `/api/patients/${pid}/journeys/${jid}`);
  try {
    if (!clinicId) { check("clínica de teste encontrada para o gate de exclusão de jornada", false); return; }
    const sessions = {};
    for (const [role, memberEmail, memberPassword] of [["STAFF", staffEmail, staffPassword], ["PROFESSIONAL", proEmail, proPassword]]) {
      const r = await api("POST", "/api/team", { name: `E2E ${role} JD`, email: memberEmail, password: memberPassword, role });
      if (r.status === 201) members.push(r.data.member);
      sessions[role] = r.status === 201 ? await loginAs(memberEmail, memberPassword) : null;
      if (sessions[role]?.status !== 200) check(`usuário ${role} criado para o gate de exclusão de jornada`, false, `team ${r.status}`);
    }
    const asPro = (fn) => withSession(sessions.PROFESSIONAL.cookie, fn);
    const patient = await mkPatient("A");
    const other = await mkPatient("B");

    if (sessions.PROFESSIONAL?.status === 200) {
      // Só clínica/agenda: o profissional exclui.
      const jClinical = await mkJourney(patient.id, "clinica");
      await api("PUT", `/api/patients/${patient.id}/evaluation`, { journeyId: jClinical.id, photos: [], assessment: { chiefComplaint: "Q" }, status: "Rascunho" });
      let r = await asPro(() => del(patient.id, jClinical.id));
      check("jornada excluída: PROFESSIONAL exclui jornada só clínica (200)", r.status === 200 && (await counts(patient.id, jClinical.id)).journey === 0, `${r.status} ${JSON.stringify(r.data)}`);
      r = await asPro(() => del(patient.id, jClinical.id));
      check("jornada excluída: repetir a exclusão devolve 404", r.status === 404, r.status);

      // Com pagamento: 403 e nada apagado (inclui registros clínicos da jornada).
      const jPay = await mkJourney(patient.id, "pagamento");
      await api("PUT", `/api/patients/${patient.id}/evaluation`, { journeyId: jPay.id, photos: [], assessment: { chiefComplaint: "Q" }, status: "Rascunho" });
      await addPayment(patient.id, jPay.id);
      r = await asPro(() => del(patient.id, jPay.id));
      const evalCount = await prisma.evaluation.count({ where: { patientId: patient.id, journeyId: jPay.id } });
      const c1 = await counts(patient.id, jPay.id);
      check("jornada excluída: PROFESSIONAL com pagamento recebe 403 e nada é apagado", r.status === 403 && /pagamentos/.test(r.data.message) && c1.journey === 1 && c1.payments === 1 && evalCount === 1, `${r.status} ${JSON.stringify(c1)} eval ${evalCount}`);

      // Com documento assinado: 403, nada apagado.
      const jDoc = await mkJourney(patient.id, "documento");
      await addDocument(patient.id, jDoc.id);
      r = await asPro(() => del(patient.id, jDoc.id));
      const c2 = await counts(patient.id, jDoc.id);
      check("jornada excluída: PROFESSIONAL com documento recebe 403 e nada é apagado", r.status === 403 && c2.journey === 1 && c2.documents === 1 && c2.documentBlobs === 1, `${r.status} ${JSON.stringify(c2)}`);

      // Documento ligado só por encontro (encounterLinks) também conta.
      const jEnc = await mkJourney(patient.id, "encontro");
      const evalR = await api("PUT", `/api/patients/${patient.id}/evaluation`, { journeyId: jEnc.id, photos: [], assessment: { chiefComplaint: "Q" }, status: "Rascunho" });
      const encEval = await prisma.evaluation.findFirst({ where: { patientId: patient.id, journeyId: jEnc.id }, select: { id: true } });
      const encPhoto = await prisma.clinicalPhoto.create({ data: { clinicId, patientId: patient.id, encounterType: "evaluation", encounterId: encEval?.id ?? "x", name: "Foto enc", width: 1, height: 1, ...file, mimeType: "image/png", blob: { create: { data: Buffer.from("png") } } } });
      r = await asPro(() => del(patient.id, jEnc.id));
      check("jornada excluída: PROFESSIONAL com foto ligada só pelo encontro recebe 403 e nada é apagado", evalR.status === 200 && r.status === 403 && await prisma.clinicalPhoto.count({ where: { id: encPhoto.id } }) === 1 && await prisma.patientJourney.count({ where: { id: jEnc.id } }) === 1, `${evalR.status} ${r.status}`);

      // Com foto: 403.
      const jPhoto = await mkJourney(patient.id, "foto");
      await addPhoto(patient.id, jPhoto.id);
      r = await asPro(() => del(patient.id, jPhoto.id));
      const c3 = await counts(patient.id, jPhoto.id);
      check("jornada excluída: PROFESSIONAL com foto clínica recebe 403 e nada é apagado", r.status === 403 && c3.journey === 1 && c3.photos === 1 && c3.photoBlobs >= 1, `${r.status} ${JSON.stringify(c3)}`);

      // Jornada de outro paciente: 404.
      r = await asPro(() => del(other.id, jPay.id));
      check("jornada excluída: jornada de outro paciente devolve 404 e continua", r.status === 404 && (await counts(patient.id, jPay.id)).journey === 1, r.status);

      // ADMIN exclui tudo.
      r = await del(patient.id, jPay.id);
      check("jornada excluída: ADMIN exclui jornada com pagamento (200) e o pagamento some", r.status === 200 && (await counts(patient.id, jPay.id)).payments === 0, r.status);
      r = await del(patient.id, jDoc.id);
      check("jornada excluída: ADMIN exclui jornada com documento assinado e bytes", r.status === 200 && (await prisma.clinicalDocument.count({ where: { patientId: patient.id, journeyId: jDoc.id } })) === 0, r.status);
      r = await del(patient.id, jEnc.id);
      check("jornada excluída: ADMIN exclui jornada com foto ligada pelo encontro", r.status === 200 && await prisma.clinicalPhoto.count({ where: { id: encPhoto.id } }) === 0, r.status);
      const jAll = await mkJourney(patient.id, "tudo");
      await addPayment(patient.id, jAll.id); await addDocument(patient.id, jAll.id); await addPhoto(patient.id, jAll.id);
      r = await del(patient.id, jAll.id);
      const c4 = await counts(patient.id, jAll.id);
      check("jornada excluída: ADMIN exclui pagamentos, documentos, fotos e bytes juntos", r.status === 200 && c4.journey === 0 && c4.payments === 0 && c4.documents === 0 && c4.photos === 0, `${r.status} ${JSON.stringify(c4)}`);
      r = await del(patient.id, jPhoto.id);
      check("jornada excluída: ADMIN exclui jornada com foto clínica", r.status === 200 && (await counts(patient.id, jPhoto.id)).photos === 0, r.status);
    }

    if (sessions.STAFF?.status === 200) {
      const jStaff = await mkJourney(patient.id, "staff");
      const r = await withSession(sessions.STAFF.cookie, () => del(patient.id, jStaff.id));
      check("jornada excluída: STAFF recebe 403 e a jornada continua", r.status === 403 && await prisma.patientJourney.count({ where: { id: jStaff.id } }) === 1, r.status);
    }

    // Outra clínica: 404 e a jornada continua.
    const jOther = await mkJourney(patient.id, "outra-clinica");
    let r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990022", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const outsider = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (outsider?.status === 200) {
      r = await withSession(outsider.cookie, () => del(patient.id, jOther.id));
      check("jornada excluída: outra clínica recebe 404 e a jornada continua", r.status === 404 && await prisma.patientJourney.count({ where: { id: jOther.id } }) === 1, r.status);
    } else check("segunda clínica criada para o gate de exclusão de jornada", false, `registro ${r.status}`);
  } finally {
    for (const member of members) await api("DELETE", "/api/team", { membershipId: member.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [otherEmail, staffEmail, proEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [otherEmail, staffEmail, proEmail] } } });
  }
}

// Lacunas da exclusão de jornada: efeitos colaterais, arquivados, corrida, Bearer, trial, ids malformados e auditoria.
async function journeyDeleteGaps() {
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const clinicId = (await prisma.clinicMembership.findFirst({ where: { user: { email: email.toLowerCase() }, clinic: { name: testClinicName } }, select: { clinicId: true } }))?.clinicId;
  const proEmail = `e2e-jdg-pro-${run}@example.com`, proPassword = `E2e-${run}-Pro99!`;
  const trialEmail = `e2e-jdg-trial-${run}@example.com`, trialPassword = `E2e-${run}-Trial9!`, trialClinic = `E2E JornadaDel Trial ${run}`;
  const members = [];
  const file = { mimeType: "application/pdf", sizeBytes: 3, sha256: "x", uploadedBy: "e2e", uploadedByName: "E2E" };
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const mkPatient = async (label) => (await api("POST", "/api/patients", { name: `JDG ${label} ${run}`, phone: "11999990078", age: 30, cpf: randomCpf() })).data.patient;
  const mkJourney = async (pid, label) => (await api("POST", `/api/patients/${pid}/journeys`, { name: `JDG ${label} ${run}`, professionalId: professional?.id })).data.journey;
  const del = (pid, jid) => api("DELETE", `/api/patients/${pid}/journeys/${jid}`);
  const addPayment = (pid, jid) => prisma.payment.create({ data: { clinicId, patientId: pid, journeyId: jid, valueCents: 1000, method: "Pix", installments: "A vista" } });
  const addDocument = (pid, jid, extra = {}) => prisma.clinicalDocument.create({ data: { clinicId, patientId: pid, journeyId: jid, name: "Doc", originalName: "doc.pdf", ...file, blob: { create: { data: Buffer.from("pdf") } }, ...extra } });
  const addPhoto = (pid, jid, extra = {}) => prisma.clinicalPhoto.create({ data: { clinicId, patientId: pid, journeyId: jid, name: "Foto", width: 1, height: 1, ...file, mimeType: "image/png", blob: { create: { data: Buffer.from("png") } }, ...extra } });
  const exists = async (jid) => (await prisma.patientJourney.count({ where: { id: jid } })) === 1;
  const audits = (pid) => prisma.clinicalFileAudit.count({ where: { clinicId, patientId: pid, action: "DELETE" } });
  const raw = (token, method, path) => fetch(`${baseUrl}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: "manual" }).then(async (response) => ({ status: response.status, data: await response.json().catch(() => null) }));
  try {
    if (!clinicId) { check("jornada excluída (lacunas): clínica de teste encontrada", false); return; }
    const created = await api("POST", "/api/team", { name: "E2E PRO JDG", email: proEmail, password: proPassword, role: "PROFESSIONAL" });
    if (created.status === 201) members.push(created.data.member);
    const pro = created.status === 201 ? await loginAs(proEmail, proPassword) : null;
    if (pro?.status !== 200) { check("jornada excluída (lacunas): PROFESSIONAL criado", false, `team ${created.status}`); return; }
    const asPro = (fn) => withSession(pro.cookie, fn);
    const adminCookie = cookie;
    // Chamadas simultâneas com cookie explícito (withSession troca o cookie global e não serve para requisições em paralelo).
    const withCookie = (ck, method, path, body) => fetch(`${baseUrl}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), cookie: ck }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" }).then(async (response) => ({ status: response.status, data: await response.json().catch(() => null) }));
    const patient = await mkPatient("A");
    const other = await mkPatient("B");

    // --- PROFESSIONAL com agenda, orçamento, avaliação com foto, sessão, pendência e estoque: 200 sem tocar no que é de fora ---
    const product = await prisma.product.create({ data: { clinicId, name: `JDG Produto ${run}`, kind: "material", unit: "un", costCents: 100, supplier: "F", minStock: 0 } });
    const lot = await prisma.stockLot.create({ data: { clinicId, productId: product.id, code: `JDG${run}`, expiresOn: new Date(Date.now() + 200 * 86_400_000) } });
    await api("POST", "/api/procedures", { name: `JDG Proc ${run}`, category: "Facial", price: 100, durationMinutes: 10, margin: 30 });
    const proc = (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === `JDG Proc ${run}`);
    const jFull = await mkJourney(patient.id, "completa");
    const jKeep = await mkJourney(patient.id, "mantida");
    const evPayload = (journeyId, name) => ({ journeyId, photos: [{ name, imageUrl: png, width: 1, height: 1, annotations: [] }], assessment: fullAssessment, status: "Concluída" });
    const ev = (await api("PUT", `/api/patients/${patient.id}/evaluation`, evPayload(jFull.id, "f"))).data.evaluation;
    const evKeep = (await api("PUT", `/api/patients/${patient.id}/evaluation`, evPayload(jKeep.id, "k"))).data.evaluation;
    const quote = (await api("POST", "/api/quotes", { patientId: patient.id, journeyId: jFull.id, evaluationId: ev?.id, details: [{ procedureId: proc?.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" })).data.quote;
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${quote?.id}`, { status, evaluationId: ev?.id });
    const session = (await api("POST", `/api/patients/${patient.id}/procedure-sessions`, { journeyId: jFull.id, quoteId: quote?.id, procedureId: proc?.id })).data.session;
    await prisma.quote.update({ where: { id: quote.id }, data: { status: "Enviado" } });
    const mkAppt = (pid, jid, hour) => prisma.appointment.create({ data: { clinicId, patientId: pid, journeyId: jid, date: new Date(), time: hour, procedure: "P", professional: "T", status: "Atendido" } });
    const apptFull = await mkAppt(patient.id, jFull.id, "09:00");
    const apptKeep = await mkAppt(patient.id, jKeep.id, "10:00");
    const apptOther = await mkAppt(other.id, null, "11:00");
    const mkPending = (appointmentId, patientId, procedureSessionId) => prisma.pendingStockOutput.create({ data: { clinicId, productId: product.id, appointmentId, procedureSessionId, patientId, quantity: 1, attendanceKind: "appointment", attendanceName: "P", attendanceDate: new Date() } });
    const pendFull = await mkPending(apptFull.id, patient.id, session?.id);
    const pendKeep = await mkPending(apptKeep.id, patient.id);
    const pendOther = await mkPending(apptOther.id, other.id);
    await prisma.stockMovement.create({ data: { clinicId, productId: product.id, lotId: lot.id, type: "entry", quantity: 5 } });
    const movement = await prisma.stockMovement.create({ data: { clinicId, productId: product.id, lotId: lot.id, type: "attendance", quantity: -1, appointmentId: apptFull.id, patientId: patient.id } });
    const balance = async () => (await prisma.stockMovement.aggregate({ where: { lotId: lot.id }, _sum: { quantity: true } }))._sum.quantity;
    const payKeep = await addPayment(patient.id, jKeep.id);
    const docKeep = await addDocument(patient.id, jKeep.id);
    const balanceBefore = await balance();
    const auditsBefore = await audits(patient.id);
    let r = await asPro(() => del(patient.id, jFull.id));
    check("jornada excluída (lacunas): PROFESSIONAL apaga agenda, orçamento, avaliação e sessão (200)", r.status === 200 && Boolean(session?.id) && !await exists(jFull.id) && await prisma.appointment.count({ where: { id: apptFull.id } }) === 0 && await prisma.quote.count({ where: { id: quote.id } }) === 0 && await prisma.evaluation.count({ where: { id: ev.id } }) === 0 && await prisma.patientProcedureSession.count({ where: { journeyId: jFull.id } }) === 0, `${r.status} sessão=${session?.id}`);
    console.log(`NOTA (comportamento real): PROFESSIONAL exclui jornada com EvaluationPhoto (foto da avaliação, dado clínico) e a lista JSON de fotos da sessão sem 403 e sem ClinicalFileAudit; EvaluationPhoto restantes da avaliação apagada=${await prisma.evaluationPhoto.count({ where: { evaluationId: ev.id } })}.`);
    check("jornada excluída (lacunas): pendência de saída da jornada some; a de outra jornada e a de outro paciente continuam", await prisma.pendingStockOutput.count({ where: { id: pendFull.id } }) === 0 && await prisma.pendingStockOutput.count({ where: { id: { in: [pendKeep.id, pendOther.id] } } }) === 2);
    check("jornada excluída (lacunas): saldo do lote não muda e a movimentação fica sem vínculo com o atendimento", await balance() === balanceBefore && (await prisma.stockMovement.findUnique({ where: { id: movement.id } }))?.appointmentId === null, `${balanceBefore} -> ${await balance()}`);
    check("jornada excluída (lacunas): outra jornada do mesmo paciente (avaliação com foto, atendimento, pagamento, documento) e o outro paciente ficam intactos", await exists(jKeep.id) && await prisma.evaluation.count({ where: { id: evKeep.id } }) === 1 && await prisma.evaluationPhoto.count({ where: { evaluationId: evKeep.id } }) === 1 && await prisma.appointment.count({ where: { id: { in: [apptKeep.id, apptOther.id] } } }) === 2 && await prisma.payment.count({ where: { id: payKeep.id, journeyId: jKeep.id } }) === 1 && await prisma.clinicalDocument.count({ where: { id: docKeep.id } }) === 1 && await prisma.patient.count({ where: { id: { in: [patient.id, other.id] } } }) === 2);
    check("jornada excluída (lacunas): 200 do PROFESSIONAL não cria auditoria de arquivo", await audits(patient.id) === auditsBefore);

    // --- Pagamento só de OUTRA jornada do mesmo paciente não bloqueia nem é apagado ---
    const jNoPay = await mkJourney(patient.id, "sem-pagamento");
    r = await asPro(() => del(patient.id, jNoPay.id));
    check("jornada excluída (lacunas): pagamento de outra jornada do paciente não bloqueia (200) e continua", r.status === 200 && await prisma.payment.count({ where: { id: payKeep.id } }) === 1, r.status);

    // --- Arquivados e termo assinado: contam como vínculo ---
    const cases = [
      ["documento arquivado", (pid, jid) => addDocument(pid, jid, { archivedAt: new Date(), archivedBy: "e2e", archiveReason: "teste" }), "clinicalDocument"],
      ["foto arquivada", (pid, jid) => addPhoto(pid, jid, { archivedAt: new Date(), archivedBy: "e2e" }), "clinicalPhoto"],
      ["termo de consentimento assinado", (pid, jid) => addDocument(pid, jid, { category: "TERMO_CONSENTIMENTO", signatureStatus: "ASSINADO" }), "clinicalDocument"],
    ];
    for (const [label, make, model] of cases) {
      const j = await mkJourney(patient.id, label);
      const row = await make(patient.id, j.id);
      const a0 = await audits(patient.id);
      r = await asPro(() => del(patient.id, j.id));
      check(`jornada excluída (lacunas): PROFESSIONAL com ${label} recebe 403, nada apagado e sem auditoria`, r.status === 403 && await exists(j.id) && await prisma[model].count({ where: { id: row.id } }) === 1 && await audits(patient.id) === a0, `${r.status}`);
      r = await del(patient.id, j.id);
      const blobs = await prisma.clinicalDocumentBlob.count({ where: { documentId: row.id } }) + await prisma.clinicalPhotoBlob.count({ where: { photoId: row.id } });
      check(`jornada excluída (lacunas): ADMIN exclui jornada com ${label}; bytes somem e a auditoria DELETE é criada`, r.status === 200 && await prisma[model].count({ where: { id: row.id } }) === 0 && blobs === 0 && await audits(patient.id) === a0 + 1 && await prisma.clinicalFileAudit.count({ where: { fileId: row.id, action: "DELETE" } }) === 1, `${r.status} blobs=${blobs}`);
    }

    // --- Jornada arquivada ---
    const jArch = await mkJourney(patient.id, "arquivada");
    await prisma.patientJourney.update({ where: { id: jArch.id }, data: { archivedAt: new Date(), status: "Cancelado" } });
    await addPayment(patient.id, jArch.id);
    r = await asPro(() => del(patient.id, jArch.id));
    check("jornada excluída (lacunas): jornada arquivada com pagamento também dá 403 ao PROFESSIONAL", r.status === 403 && await exists(jArch.id), r.status);
    r = await del(patient.id, jArch.id);
    check("jornada excluída (lacunas): ADMIN exclui jornada arquivada", r.status === 200 && !await exists(jArch.id), r.status);

    // --- Corrida: dois DELETE iguais ---
    for (const label of ["ADMIN", "PROFESSIONAL"]) {
      const j = await mkJourney(patient.id, `dupla-${label}`);
      await api("PUT", `/api/patients/${patient.id}/evaluation`, { journeyId: j.id, photos: [], assessment: { chiefComplaint: "Q" }, status: "Rascunho" });
      const ck = label === "ADMIN" ? adminCookie : pro.cookie;
      const pair = await Promise.all([withCookie(ck, "DELETE", `/api/patients/${patient.id}/journeys/${j.id}`), withCookie(ck, "DELETE", `/api/patients/${patient.id}/journeys/${j.id}`)]);
      check(`jornada excluída (lacunas): dois DELETE simultâneos (${label}) dão 200 e 404, sem 500`, pair.map((item) => item.status).sort().join() === "200,404" && !await exists(j.id), pair.map((item) => item.status).join());
    }

    // --- Corrida: PROFESSIONAL apaga enquanto outra requisição cria pagamento / documento ---
    const outcomes = [];
    for (let round = 0; round < 24; round += 1) {
      const j = await mkJourney(patient.id, `corrida-${round}`);
      const kind = round % 2 === 0 ? "payment" : "document";
      const create = kind === "payment" ? () => withCookie(adminCookie, "POST", "/api/payments", { patientId: patient.id, journeyId: j.id, value: 10, method: "Pix", status: "Pago", installments: "A vista" }) : () => addDocument(patient.id, j.id).then((row) => ({ status: 201, row }));
      const wait = Math.floor(round / 2) * 3; // varre o instante da criação em relação ao DELETE (já em andamento)
      const [d, c] = await Promise.all([withCookie(pro.cookie, "DELETE", `/api/patients/${patient.id}/journeys/${j.id}`), new Promise((resolve) => setTimeout(resolve, wait)).then(create)]);
      const made = c.status === 201;
      const lost = d.status === 200 && made && (kind === "payment" ? await prisma.payment.count({ where: { id: c.data?.payment?.id } }) === 0 : await prisma.clinicalDocument.count({ where: { id: c.row.id } }) === 0);
      const dangling = kind === "document" && made && d.status === 200 && await prisma.clinicalDocument.count({ where: { journeyId: j.id } }) === 1;
      outcomes.push(`${kind}:del${d.status}/criar${c.status}${lost ? " PERDIDO" : ""}${dangling ? " documento-com-jornada-inexistente" : ""}${d.status >= 500 ? " 5xx" : ""}${c.status >= 500 ? " criacao-5xx" : ""}`);
      await prisma.clinicalDocument.deleteMany({ where: { journeyId: j.id } });
      if (await exists(j.id)) await del(patient.id, j.id);
    }
    console.log(`NOTA corrida: ${outcomes.join(" | ")}`);
    check("jornada excluída (lacunas): corrida com criação de pagamento/documento nunca apaga o registro novo nem devolve 5xx", outcomes.every((item) => !/PERDIDO| 5xx/.test(item)), outcomes.join(" | "));
    // Limitação conhecida (sem perda de dado): ClinicalDocument.journeyId não tem FK, então um documento criado no meio da exclusão pode ficar apontando para a jornada removida.
    console.log(`NOTA documento órfão de jornada na corrida: ${outcomes.some((item) => /jornada-inexistente/.test(item)) ? "ocorreu" : "não ocorreu"}`);
    // Limitação conhecida, fora desta correção: POST /api/payments sem tratamento de FK pode dar 5xx/404 se a jornada some no meio (rota de pagamentos).
    console.log(`NOTA POST /api/payments na corrida: ${outcomes.some((item) => /criacao-5xx/.test(item)) ? "5xx observado" : "sem 5xx"}`);

    // --- Ids malformados, outro paciente e inexistentes ---
    const probes = [[patient.id, "inexistente"], [patient.id, "a".repeat(300)], [patient.id, "'; DROP TABLE x;--"], ["inexistente", jKeep.id], [other.id, jKeep.id], [patient.id, "..%2F..%2Fx"]];
    const statuses = [];
    for (const [pid, jid] of probes) statuses.push((await asPro(() => api("DELETE", `/api/patients/${pid}/journeys/${jid}`))).status);
    check("jornada excluída (lacunas): ids malformados, de outro paciente ou inexistentes dão 404 (nunca 500) e a jornada continua", statuses.every((status) => status === 404) && await exists(jKeep.id), statuses.join());

    r = await asPro(() => api("DELETE", `/api/patients/${patient.id}/journeys/%00`));
    check("jornada excluída (lacunas): id com byte nulo (%00) dá 404, não 500", r.status === 404 && await exists(jKeep.id), r.status);

    // --- Sem sessão e Bearer ---
    r = await withSession("", () => del(patient.id, jKeep.id));
    check("jornada excluída (lacunas): sem sessão devolve 401 e a jornada continua", r.status === 401 && await exists(jKeep.id), r.status);
    const bearerToken = (await fetch(`${baseUrl}/api/mobile/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: proEmail, password: `${proPassword}-nova` }) }).then((response) => response.json().catch(() => null)))?.token;
    if (bearerToken) {
      const jB = await mkJourney(patient.id, "bearer");
      await addPayment(patient.id, jB.id);
      let b = await raw(bearerToken, "DELETE", `/api/patients/${patient.id}/journeys/${jB.id}`);
      check("jornada excluída (lacunas): Bearer PROFESSIONAL com pagamento recebe 403 e nada é apagado", b.status === 403 && await exists(jB.id) && await prisma.payment.count({ where: { journeyId: jB.id } }) === 1, b.status);
      await prisma.payment.deleteMany({ where: { journeyId: jB.id } });
      b = await raw(bearerToken, "DELETE", `/api/patients/${patient.id}/journeys/${jB.id}`);
      check("jornada excluída (lacunas): Bearer PROFESSIONAL exclui jornada sem pagamento (200)", b.status === 200 && !await exists(jB.id), b.status);
    } else check("jornada excluída (lacunas): login mobile do PROFESSIONAL", false);

    // --- PATCH segue funcionando ---
    const jPatch = await mkJourney(patient.id, "patch");
    r = await asPro(() => api("PATCH", `/api/patients/${patient.id}/journeys/${jPatch.id}`, { status: "Cancelado" }));
    const archived = await prisma.patientJourney.findUnique({ where: { id: jPatch.id }, select: { status: true, archivedAt: true } });
    check("jornada excluída (lacunas): PATCH Cancelado continua arquivando", r.status === 200 && archived?.status === "Cancelado" && archived.archivedAt !== null, r.status);
    r = await asPro(() => api("PATCH", `/api/patients/${patient.id}/journeys/${jPatch.id}`, { status: "Em andamento" }));
    check("jornada excluída (lacunas): PATCH restaura jornada arquivada", r.status === 200 && r.data.restored === true, `${r.status}`);

    // --- Trial vencido ---
    const reg = await withSession("", () => api("POST", "/api/auth/register", { clinicName: trialClinic, name: "E2E Trial JDG", phone: "11999990079", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: trialEmail, password: trialPassword }));
    if (reg.status === 201) {
      const tClinic = (await prisma.clinicMembership.findFirst({ where: { user: { email: trialEmail } }, select: { clinicId: true } })).clinicId;
      const tPatient = await prisma.patient.create({ data: { clinicId: tClinic, name: `Trial JDG ${run}`, phone: "11999990080", age: 30 } });
      const tJourney = await prisma.patientJourney.create({ data: { clinicId: tClinic, patientId: tPatient.id, name: "J" } });
      await prisma.clinic.update({ where: { id: tClinic }, data: { trialEndsAt: new Date(Date.now() - 86_400_000) } });
      const tSession = await loginAs(trialEmail, trialPassword);
      r = await withSession(tSession.cookie, () => del(tPatient.id, tJourney.id));
      check("jornada excluída (lacunas): trial vencido devolve 401 e a jornada continua", r.status === 401 && await exists(tJourney.id), `${tSession.status}/${r.status}`);
      await prisma.patient.deleteMany({ where: { clinicId: tClinic } });
    } else check("jornada excluída (lacunas): clínica de trial vencido criada", false, `registro ${reg.status}`);
  } finally {
    for (const member of members) await api("DELETE", "/api/team", { membershipId: member.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [proEmail, trialEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: trialClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [proEmail, trialEmail] } } });
  }
}

async function settings() {
  let r = await api("GET", "/api/clinic/cost-settings");
  const current = r.data.settings;
  check("configurações da clínica carregam", r.status === 200 && typeof current?.professionalOpeningTime === "string", r.status);
  const tolerance = current.appointmentToleranceMinutes === 20 ? 25 : 20;
  r = await api("PATCH", "/api/clinic/cost-settings", { ...current, appointmentToleranceMinutes: tolerance });
  check("configurações gravam e devolvem o valor salvo", r.status === 200 && r.data.settings?.appointmentToleranceMinutes === tolerance, JSON.stringify(r.data).slice(0, 160));
}

async function stock(patient) {
  let r = await api("POST", "/api/products", { name: `Material ${run}`, kind: "material", unit: "frasco", costCents: 1000, supplier: "Fornecedor", minStock: 0 });
  const product = r.data.product;
  check("material é criado", r.status === 201, r.status);
  check("item criado guarda o tipo", product?.kind === "material", product?.kind);
  r = await api("POST", "/api/products", { name: `Sem tipo ${run}`, unit: "unidade", costCents: 100, supplier: "Fornecedor" });
  check("item sem tipo é recusado", r.status === 400, r.status);
  r = await api("POST", "/api/products", { name: `Tipo errado ${run}`, kind: "Produto", unit: "unidade", costCents: 100, supplier: "Fornecedor" });
  check("tipo inválido é recusado", r.status === 400, r.status);
  r = await api("POST", "/api/purchases", { supplier: "Fornecedor", purchasedOn: day(0), paymentMethod: "Pix", installments: 1, items: [{ productId: product.id, lotCode: `L${run}`, expiresOn: day(300), quantity: 2, unitPriceCents: 5000 }] });
  const purchaseId = r.data.purchase?.id;
  check("compra é registrada", r.status === 201, r.status);
  r = await api("GET", "/api/expenses?period=month");
  check("compra gera despesa na categoria Estoque", r.data.expenses?.some((expense) => expense.category === "Estoque"), JSON.stringify(r.data.expenses?.map((expense) => expense.category)));
  const balance = async () => (await api("GET", `/api/products/${product.id}`)).data.product?.lots?.reduce((sum, lot) => sum + lot.balance, 0);
  check("compra soma ao saldo", (await balance()) === 2, await balance());
  let pair = await Promise.all([api("PATCH", `/api/purchases/${purchaseId}`, { action: "cancel" }), api("PATCH", `/api/purchases/${purchaseId}`, { action: "cancel" })]);
  check("cancelamento duplo simultâneo: só um passa", pair.map((item) => item.status).sort().join() === "200,409", pair.map((item) => item.status).join());
  check("saldo depois de cancelar é 0", (await balance()) === 0, await balance());
  pair = await Promise.all([api("PATCH", `/api/purchases/${purchaseId}`, { action: "restore" }), api("PATCH", `/api/purchases/${purchaseId}`, { action: "restore" })]);
  check("restauração dupla simultânea: só uma passa", pair.map((item) => item.status).sort().join() === "200,409", pair.map((item) => item.status).join());
  check("saldo depois de restaurar é 2", (await balance()) === 2, await balance());
  r = await api("PATCH", `/api/products/${product.id}`, { kind: "produto" });
  check("tipo pode ser trocado mesmo com movimentações", r.status === 200 && r.data.product?.kind === "produto", `${r.status} ${r.data.product?.kind}`);
  r = await api("GET", "/api/products");
  check("lista devolve o tipo e não a categoria", r.data.products?.some((item) => item.id === product.id && item.kind === "produto" && !("category" in item)), JSON.stringify(r.data.products?.[0] ?? {}));
  r = await api("PATCH", `/api/products/${product.id}`, { kind: "outro" });
  check("troca para tipo inválido é recusada", r.status === 400, r.status);

  // Tipo nos avisos, na conferência de materiais e nas pendências.
  r = await api("POST", "/api/products", { name: `Faltando ${run}`, kind: "produto", unit: "unidade", costCents: 500, supplier: "Fornecedor", minStock: 10 });
  const low = r.data.product;
  r = await api("GET", "/api/stock/alerts");
  const lowAlert = r.data.alerts?.find((alert) => alert.kind === "below_minimum" && alert.productId === low?.id);
  check("aviso de abaixo do mínimo traz productKind", lowAlert?.productKind === "produto", JSON.stringify(lowAlert));

  r = await api("POST", "/api/appointments", { patientId: patient.id, procedure: "Retorno estoque", professional: "Teste", time: "11:00", date: `${day(1)}T00:00:00` });
  const attendance = r.data.appointment;
  r = await api("PATCH", `/api/appointments/${attendance?.id}`, { status: "Atendido" });
  check("atendimento marcado como atendido", r.status === 200, r.status);
  r = await api("GET", `/api/appointments/${attendance?.id}/materials`);
  const byId = Object.fromEntries((r.data.materials ?? []).map((item) => [item.id, item.kind]));
  check("conferência de materiais devolve o tipo de cada item", r.status === 200 && byId[product.id] === "produto" && byId[low?.id] === "produto", JSON.stringify(byId));
  r = await api("POST", `/api/appointments/${attendance?.id}/materials`, { items: [{ productId: low.id, quantity: 3 }] });
  check("conferência sem saldo gera pendência", r.status === 200 && r.data.pending?.length === 1, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  r = await api("GET", "/api/stock/pending");
  const output = r.data.outputs?.find((item) => item.product?.id === low.id);
  check("pendência de saída traz product.kind", output?.product?.kind === "produto", JSON.stringify(output?.product));
}

async function loginLockout() {
  const statuses = [];
  for (let attempt = 0; attempt < 10; attempt += 1) statuses.push((await api("POST", "/api/auth/login", { login: email, password: "senha-errada" })).status);
  check("10 senhas erradas devolvem 401", statuses.every((status) => status === 401), statuses.join(","));
  const locked = (await api("POST", "/api/auth/login", { login: email, password })).status;
  check("depois de 10 erros a conta bloqueia, mesmo com a senha certa", locked === 429, locked);
  // Desbloqueia só a conta de teste, para a próxima execução.
  await prisma.user.update({ where: { email }, data: { failedLogins: 0, lockedUntil: null } });
  await login();
  check("senha certa entra depois do desbloqueio", Boolean(cookie));
}

// Telas: os valores aparecem formatados e o pagamento registrado pela tela vai para o paciente escolhido.
// Abre o navegador já logado na conta de teste. pageErrors junta os erros de JavaScript da página.
async function withPage(fn) {
  const instance = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
  try {
    const context = await instance.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
    await context.addCookies([{ name: "harmonize_session", value: cookie.split("=")[1], url: baseUrl }]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(30_000);
    await fn(page, pageErrors);
  } finally {
    await instance.close();
  }
}

async function browser(homonym) {
  await withPage(async (page, pageErrors) => {
    await page.goto(`${baseUrl}/procedimentos`);
    await page.getByRole("button", { name: "Novo procedimento" }).first().click();
    const procedureDialog = page.getByRole("dialog", { name: "Novo procedimento" });
    await procedureDialog.waitFor({ state: "visible" });
    const entryAnimations = await page.locator(".modal-content").evaluate((element) => ({
      content: getComputedStyle(element).animationName,
      panel: getComputedStyle(element.querySelector(".modal-panel")).animationName,
    }));
    await procedureDialog.getByRole("button", { name: "Fechar" }).click();
    await page.waitForFunction(() => document.querySelector(".modal-content")?.getAttribute("data-state") === "closed");
    const exitAnimations = await page.locator(".modal-content").evaluate((element) => ({
      content: getComputedStyle(element).animationName,
      panel: getComputedStyle(element.querySelector(".modal-panel")).animationName,
    }));
    check("modal de procedimento anima entrada e saída", entryAnimations.content === "hp-modal-stage-in" && entryAnimations.panel === "hp-modal-panel-in" && exitAnimations.content === "hp-modal-stage-out" && exitAnimations.panel === "hp-modal-panel-out", JSON.stringify({ entryAnimations, exitAnimations }));
    await page.locator(".modal-content").waitFor({ state: "detached" });
    check("modal de procedimento permanece até o fim da animação de saída", true);

    await page.goto(`${baseUrl}/pagamentos`);
    await page.getByRole("cell", { name: "R$ 150,50" }).first().waitFor();
    check("tela de Pagamentos mostra R$ 150,50", true);
    const periodRequest = page.waitForRequest((request) => request.url().includes("/api/payments?from=2000-01-01&to=2000-01-31"));
    await page.getByLabel("Data inicial").fill("2000-01-01");
    await page.getByLabel("Data final").fill("2000-01-31");
    await periodRequest;
    await page.getByRole("cell", { name: "R$ 150,50" }).first().waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Limpar datas" }).click();
    await page.getByRole("cell", { name: "R$ 150,50" }).first().waitFor();
    check("filtro de datas da tela de Pagamentos busca o período no servidor e volta ao limpar", true);
    await page.getByRole("button", { name: "Registrar pagamento" }).first().click();
    // Busca de paciente: o homônimo é o que não tem CPF.
    await page.locator(`input[name="patientSearch"]`).fill(homonym.name);
    await page.getByRole("button").filter({ hasText: homonym.name }).filter({ hasText: "CPF não informado" }).first().click();
    await page.locator(`input[name="value"]`).pressSequentially("1234");
    check("campo de valor formata R$ 12,34", (await page.locator(`input[name="value"]`).inputValue()).replace(/\s/g, " ") === "R$ 12,34", await page.locator(`input[name="value"]`).inputValue());
    await page.locator(`form button[type="submit"]`).click();
    await page.getByRole("cell", { name: "R$ 12,34" }).first().waitFor();
    const saved = (await api("GET", "/api/payments")).data.payments?.find((payment) => payment.value === 12.34);
    check("pagamento pela tela grava 12.34 no paciente escolhido", saved?.patientId === homonym.id, JSON.stringify(saved && { value: saved.value, patientId: saved.patientId }));

    // Orçamento próprio: o da parte "orcamentos" pode ter sido apagado pela parte "jornadas" (exclusão da jornada).
    await api("POST", "/api/quotes", { patientId: homonym.id, items: "Botox (1x)", total: 99.4, expires: "30/12/2030" });
    await page.goto(`${baseUrl}/orcamentos`);
    await page.getByRole("cell", { name: "R$ 99,40" }).first().waitFor();
    check("tela de Orçamentos mostra R$ 99,40", true);

    // Estoque: abre em Materiais; o produto só aparece em Produtos; a compra agrupa os itens.
    const material = (await api("POST", "/api/products", { name: `Material tela ${run}`, kind: "material", unit: "frasco", costCents: 100, supplier: "Fornecedor" })).data.product;
    const produto = (await api("POST", "/api/products", { name: `Produto tela ${run}`, kind: "produto", unit: "unidade", costCents: 100, supplier: "Fornecedor" })).data.product;
    await page.goto(`${baseUrl}/estoque`);
    await page.getByText(material.name).first().waitFor();
    check("Estoque abre na aba Materiais e mostra o material", await page.getByRole("button", { name: "Novo material" }).isVisible());
    check("aba Materiais não mostra o produto", (await page.getByText(produto.name).count()) === 0);
    await page.getByRole("button", { name: "Produtos", exact: true }).click();
    await page.getByText(produto.name).first().waitFor();
    check("aba Produtos mostra o produto, tem o botão Novo produto e não mostra o material", (await page.getByText(material.name).count()) === 0 && await page.getByRole("button", { name: "Novo produto" }).isVisible());
    // Troca de tipo pela tela: o material sai de Materiais e passa a aparecer em Produtos.
    const trocado = (await api("POST", "/api/products", { name: `Troca de tipo ${run}`, kind: "material", unit: "frasco", costCents: 100, supplier: "Fornecedor" })).data.product;
    await page.goto(`${baseUrl}/estoque`);
    await page.getByRole("button", { name: "Materiais", exact: true }).click();
    await page.getByText(trocado.name).first().waitFor();
    await page.getByRole("row").filter({ hasText: trocado.name }).getByRole("button", { name: "Abrir" }).click();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page.locator('select[name="kind"]').selectOption("produto");
    await page.getByRole("button", { name: /^Salvar / }).click();
    await page.locator('select[name="kind"]').waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Produtos", exact: true }).click();
    await page.getByText(trocado.name).first().waitFor();
    await page.getByRole("button", { name: "Materiais", exact: true }).click();
    const naLista = await page.getByRole("row").filter({ hasText: trocado.name }).count();
    const tipoGravado = (await api("GET", `/api/products/${trocado.id}`)).data.product?.kind;
    check("trocar o tipo pela tela move o item de Materiais para Produtos", naLista === 0 && tipoGravado === "produto", `linhas em Materiais: ${naLista}, tipo: ${tipoGravado}`);
    check("Estoque não tem mais as abas Compras e Pendências", (await page.getByRole("main").getByRole("button", { name: /^(Compras|Pendências)$/ }).count()) === 0);
    // Compras e Pendências ficam numa seção própria do menu.
    await page.getByRole("navigation").getByRole("button", { name: "Compras" }).first().click();
    await page.waitForURL(`${baseUrl}/compras`);
    await page.getByRole("main").getByRole("button", { name: "Pendências", exact: true }).click();
    await page.getByLabel("Tipo de pendência").waitFor();
    check("menu Compras abre a seção com a aba Pendências", true);
    await page.getByRole("main").getByRole("button", { name: "Compras", exact: true }).click();
    await page.getByRole("button", { name: "Nova compra" }).first().click();
    const itemSelect = page.locator("select").filter({ has: page.locator("option", { hasText: "Selecione um item" }) }).first();
    await itemSelect.locator(`optgroup[label="Materiais"] option`, { hasText: material.name }).waitFor({ state: "attached" });
    check("seleção de item na compra agrupa em Materiais e Produtos", (await itemSelect.locator(`optgroup[label="Produtos"] option`, { hasText: produto.name }).count()) === 1);
    // Aviso de pendência abre Compras direto na aba Pendências, mesmo já estando em Compras.
    const attendance = (await api("POST", "/api/appointments", { patientId: homonym.id, procedure: "Pendência tela", professional: "Teste", time: "15:00", date: `${day(1)}T00:00:00` })).data.appointment;
    await api("PATCH", `/api/appointments/${attendance.id}`, { status: "Atendido" });
    await api("POST", `/api/appointments/${attendance.id}/materials`, { items: [{ productId: material.id, quantity: 1 }] });
    await page.goto(`${baseUrl}/compras`);
    await page.getByRole("button", { name: "Nova compra" }).first().waitFor();
    await page.getByRole("button", { name: "Notificações" }).click();
    // Singular ou plural: com outras partes rodando antes, pode haver mais de uma saída pendente.
    await page.getByRole("button", { name: /saídas? de estoque pendentes?/ }).click();
    await page.getByLabel("Tipo de pendência").waitFor();
    check("aviso de pendência abre Compras na aba Pendências", page.url() === `${baseUrl}/compras`, page.url());

    // ⚠ no título e no menu de cada seção, só com os avisos dela; passar o mouse mostra a lista.
    const baixo = (await api("POST", "/api/products", { name: `Abaixo tela ${run}`, kind: "material", unit: "frasco", costCents: 100, supplier: "Fornecedor", minStock: 5 })).data.product;
    await page.goto(`${baseUrl}/compras`);
    const titleWarning = page.getByRole("main").getByRole("button", { name: /^\d+ avisos?$/ });
    await titleWarning.hover();
    const comprasTip = page.getByRole("main").getByRole("tooltip");
    await comprasTip.getByText(/saídas? de estoque pendentes?/).waitFor();
    check("⚠ de Compras mostra só as pendências", (await comprasTip.getByText(baixo.name).count()) === 0);
    await page.goto(`${baseUrl}/estoque`);
    await titleWarning.hover();
    const estoqueTip = page.getByRole("main").getByRole("tooltip");
    await estoqueTip.getByText(`${baixo.name} abaixo do mínimo`, { exact: false }).waitFor();
    check("⚠ do Estoque mostra o item abaixo do mínimo e não as pendências", (await estoqueTip.getByText(/pendente/).count()) === 0);
    const menu = page.getByRole("navigation");
    check("menu mostra ⚠ em Estoque e em Compras", await menu.getByRole("button", { name: /Estoque/ }).first().getByLabel(/avisos?$/).isVisible() && await menu.getByRole("button", { name: /Compras/ }).first().getByLabel(/avisos?$/).isVisible());

    for (const section of ["dashboard", "agenda", "clientes", "estoque", "compras", "financeiro", "configuracoes"]) {
      await page.goto(`${baseUrl}/${section}`, { waitUntil: "networkidle" });
    }
    check("telas principais abrem sem erro de JavaScript", pageErrors.length === 0, pageErrors.join(" | "));
  });
}

// --- Prontuário, fase 1: anamnese versionada e lista de atendimentos ---

// Roda `fn` com outra sessão (cookie) e restaura a sessão principal depois.
async function withSession(sessionCookie, fn) {
  const saved = cookie;
  cookie = sessionCookie;
  try { return await fn(); } finally { cookie = saved; }
}

async function loginAs(loginName, secret) {
  return withSession("", async () => {
    const response = await api("POST", "/api/auth/login", { login: loginName, password: secret });
    // Colaborador novo entra com sessão de primeiro acesso: troca a senha para obter a sessão completa.
    if (response.status === 200 && response.data.passwordChangeRequired) {
      const changed = await api("POST", "/api/auth/change-password", { password: `${secret}-nova` });
      return { status: changed.status, cookie, data: changed.data };
    }
    return { status: response.status, cookie, data: response.data };
  });
}

// Avaliação: campos obrigatórios ao concluir (API) e dados da anamnese que alimentam o pré-preenchimento (tela).
async function evaluationRequired() {
  const created = await api("POST", "/api/patients", { name: `E2E Avaliação ${run}`, phone: "11999990011", age: 35, cpf: randomCpf() });
  const P = created.data.patient ?? created.data;
  const url = `/api/patients/${P.id}/evaluation`;
  const conclude = (assessment, extra = {}) => api("PUT", url, { photos: [], assessment, status: "Concluída", ...extra });
  const draft = await api("PUT", url, { photos: [], assessment: { chiefComplaint: "Só a queixa" } });
  check("avaliação: rascunho incompleto continua podendo ser salvo", draft.status === 200 && draft.data.evaluation?.status === "Rascunho", `${draft.status} ${JSON.stringify(draft.data).slice(0, 120)}`);
  const draftId = draft.data.evaluation?.id;
  const empty = await conclude({});
  check("avaliação: concluir sem nada devolve 400 pedindo a queixa", empty.status === 400 && /queixa principal/.test(empty.data.message), `${empty.status} ${empty.data.message}`);
  for (const [field, text] of [["patientGoal", "objetivo"], ["allergies", "alergias"], ["pregnancyStatus", "gestante"], ["anticoagulantUse", "anticoagulante"], ["autoimmuneDiseases", "autoimunes"], ["previousProcedures", "procedimentos anteriores"], ["clinicalNotes", "observações clínicas"]]) {
    const r = await conclude({ ...fullAssessment, [field]: field === "allergies" ? "" : "   " });
    check(`avaliação: concluir sem ${field} devolve 400 (${text})`, r.status === 400 && r.data.message.includes(text), `${r.status} ${r.data.message}`);
  }
  check("avaliação: nada foi concluído pelas tentativas inválidas", (await prisma.evaluation.count({ where: { patientId: P.id, status: "Concluída" } })) === 0);
  let r = await conclude({ ...fullAssessment }, { evaluationId: draftId });
  check("avaliação: concluir completa (sobre o rascunho) funciona", r.status === 200 && r.data.evaluation?.status === "Concluída", `${r.status} ${r.data.message}`);
  const legacy = await api("PUT", url, { photos: [], assessment: { ...fullAssessment, allergies: "Dipirona", previousProcedures: "Botox em 2022" }, status: "Concluída" });
  check("avaliação: texto legado nos campos Sim/Não vale como preenchido", legacy.status === 200, `${legacy.status} ${legacy.data.message}`);
  const partial = await api("PUT", url, { photos: [], assessment: { clinicalNotes: "Atualizada" }, status: "Concluída", evaluationId: draftId });
  check("avaliação: concluir parcial usa os campos já gravados na avaliação", partial.status === 200, `${partial.status} ${partial.data.message}`);
  const blank = await api("PUT", url, { photos: [], assessment: { patientGoal: "" }, status: "Concluída", evaluationId: draftId });
  check("avaliação: esvaziar campo obrigatório ao concluir devolve 400", blank.status === 400, blank.status);
  const stored = await prisma.evaluation.findUnique({ where: { id: draftId }, select: { patientGoal: true, status: true } });
  check("avaliação: tentativa inválida não gravou nada", stored?.patientGoal === "Obj" && stored.status === "Concluída", JSON.stringify(stored));
  const old = await prisma.evaluation.create({ data: { patientId: P.id, clinicId: (await prisma.patient.findUnique({ where: { id: P.id }, select: { clinicId: true } })).clinicId, professional: "Teste", chiefComplaint: "Antiga", status: "Concluída" } });
  const read = await api("GET", `${url}?evaluationId=${old.id}`);
  check("avaliação: avaliação antiga com campos vazios continua legível", read.status === 200 && read.data.evaluation?.chiefComplaint === "Antiga" && read.data.evaluation.allergies === "", `${read.status}`);
  // Avaliação concluída antiga: salvar foto/marcação com os campos que já eram vazios passa; esvaziar um preenchido não.
  const oldPhoto = [{ name: "frente", imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", width: 1, height: 1, category: "Frontal", annotations: [{ id: "a1", type: "line" }] }];
  const emptyAssessment = { chiefComplaint: "Antiga", patientGoal: "", allergies: "", pregnancyStatus: "", anticoagulantUse: "", autoimmuneDiseases: "", previousProcedures: "", clinicalNotes: "" };
  r = await api("PUT", url, { evaluationId: old.id, photos: oldPhoto, assessment: emptyAssessment, status: "Concluída" });
  check("avaliação: concluída antiga com campos vazios aceita foto e marcação (200)", r.status === 200 && r.data.evaluation?.photoCount === 1, `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { evaluationId: old.id, photos: oldPhoto, assessment: { ...emptyAssessment, chiefComplaint: "" }, status: "Concluída" });
  check("avaliação: concluída antiga não deixa esvaziar um campo que estava preenchido (400)", r.status === 400 && /queixa principal/.test(r.data.message), `${r.status} ${r.data.message}`);
  check("avaliação: a queixa da concluída antiga continua gravada", (await prisma.evaluation.findUnique({ where: { id: old.id }, select: { chiefComplaint: true } }))?.chiefComplaint === "Antiga");
  const oldDraft = await prisma.evaluation.create({ data: { patientId: P.id, clinicId: old.clinicId, professional: "Teste", chiefComplaint: "Rascunho antigo", status: "Rascunho" } });
  r = await api("PUT", url, { evaluationId: oldDraft.id, photos: [], assessment: { chiefComplaint: "Rascunho antigo" }, status: "Concluída" });
  check("avaliação: concluir a partir de rascunho continua exigindo os 8 campos (400)", r.status === 400 && /objetivo do paciente/.test(r.data.message), `${r.status} ${r.data.message}`);

  // Dados da anamnese que o formulário usa para pré-preencher (GET existente, escopado ao paciente).
  const draftAn = (await api("POST", `/api/patients/${P.id}/anamnesis`, { from: "empty" })).data.draft;
  const content = JSON.parse(JSON.stringify(draftAn.content));
  content.complaint = { chiefComplaint: "Manchas", treatmentGoal: "Uniformizar" };
  content.health.items.pregnancy.value = "no";
  content.health.items.autoimmune.value = "not_informed";
  for (const item of Object.values(content.allergies.items)) item.value = "no";
  const saved = await api("PUT", `/api/patients/${P.id}/anamnesis`, { draftId: draftAn.id, content, expectedUpdatedAt: draftAn.updatedAt });
  const overview = (await api("GET", `/api/patients/${P.id}/anamnesis`)).data;
  check("avaliação: anamnese em rascunho chega ao GET para o pré-preenchimento", saved.status === 200 && overview.draft?.content.complaint.chiefComplaint === "Manchas" && overview.draft.content.health.items.autoimmune.value === "not_informed", JSON.stringify(overview).slice(0, 150));
  r = await api("POST", `/api/patients/${P.id}/anamnesis/${draftAn.id}`, { action: "complete", expectedUpdatedAt: saved.data.updatedAt });
  check("avaliação: anamnese concluída para o pré-preenchimento", r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);

  // Tela: pré-preenchimento a partir da anamnese e validação obrigatória (queixa, objetivo, 5 selects, observações).
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const journey = (await api("POST", `/api/patients/${P.id}/journeys`, { name: `Tratamento avaliação ${run}`, professionalId: professional?.id })).data.journey;
  const journeyWithDraft = (await api("POST", `/api/patients/${P.id}/journeys`, { name: `Tratamento rascunho ${run}`, professionalId: professional?.id })).data.journey;
  await api("PUT", url, { journeyId: journeyWithDraft.id, photos: [], assessment: { chiefComplaint: "Escrita pelo profissional", allergies: "Sim" } });
  await withPage(async (page, pageErrors) => {
    const field = (name) => page.locator(`#assessment-field-${name}`);
    const values = async () => Object.fromEntries(await Promise.all(["chiefComplaint", "patientGoal", "allergies", "pregnancyStatus", "anticoagulantUse", "autoimmuneDiseases", "previousProcedures", "clinicalNotes"].map(async (name) => [name, await field(name).inputValue()])));
    await page.goto(`${baseUrl}/clientes?patient=${P.id}&journey=${journey.id}`);
    await field("chiefComplaint").waitFor();
    await page.waitForFunction(() => document.querySelector("#assessment-field-patientGoal")?.value === "Uniformizar");
    const filled = await values();
    check("avaliação (tela): campos vazios vêm preenchidos pela anamnese; null/não informado ficam vazios", filled.chiefComplaint === "Manchas" && filled.patientGoal === "Uniformizar" && filled.allergies === "Não" && filled.pregnancyStatus === "Não" && filled.anticoagulantUse === "" && filled.autoimmuneDiseases === "" && filled.previousProcedures === "" && filled.clinicalNotes === "", JSON.stringify(filled));
    check("avaliação (tela): campos obrigatórios têm asterisco e a opção vazia não diz Não", (await page.locator("#evaluation-assessment-card span.text-destructive").count()) === 8 && (await field("anticoagulantUse").locator("option").allTextContents()).join("|").startsWith("Selecione|Não|Sim"), await field("anticoagulantUse").locator("option").allTextContents());
    // Fluxo em duas etapas: a clínica avança para a facial sem validar; a conclusão (e a validação) está em "Concluir e ir ao orçamento".
    await page.getByRole("button", { name: "Continuar para avaliação facial" }).click();
    await page.getByRole("button", { name: "Concluir e ir ao orçamento" }).click();
    await page.locator("#assessment-error-clinicalNotes").waitFor();
    const errors = await page.locator("#evaluation-assessment-card [role=alert]").evaluateAll((nodes) => nodes.map((node) => node.id));
    check("avaliação (tela): só os campos vazios mostram erro, com borda vermelha", errors.join() === "assessment-error-anticoagulantUse,assessment-error-autoimmuneDiseases,assessment-error-previousProcedures,assessment-error-clinicalNotes" && (await field("clinicalNotes").getAttribute("aria-invalid")) === "true" && (await field("clinicalNotes").evaluate((node) => getComputedStyle(node).borderColor)) === "rgb(217, 45, 32)", errors.join());
    await page.waitForFunction(() => document.activeElement?.id === "assessment-field-anticoagulantUse", null, { timeout: 5000 }).catch(() => {}); // o foco vem depois da volta à etapa clínica
    check("avaliação (tela): foco no primeiro campo inválido", await page.evaluate(() => document.activeElement?.id) === "assessment-field-anticoagulantUse");
    check("avaliação (tela): nada foi concluído com campos faltando", (await prisma.evaluation.count({ where: { patientId: P.id, journeyId: journey.id, status: "Concluída" } })) === 0);
    await field("anticoagulantUse").selectOption("Não");
    check("avaliação (tela): preencher o campo limpa o erro", (await page.locator("#assessment-error-anticoagulantUse").count()) === 0 && (await page.locator("#assessment-error-clinicalNotes").count()) === 1);
    await field("autoimmuneDiseases").selectOption("Sim");
    await field("previousProcedures").selectOption("Não");
    await field("clinicalNotes").fill("Observação clínica");
    // Fluxo em duas etapas: a clínica avança para a facial sem validar; a conclusão (e a validação) está em "Concluir e ir ao orçamento".
    await page.getByRole("button", { name: "Continuar para avaliação facial" }).click();
    await page.getByRole("button", { name: "Concluir e ir ao orçamento" }).click();
    // O campo some já ao ir para a etapa facial; espera a conclusão gravada.
    for (let i = 0; i < 40 && (await prisma.evaluation.count({ where: { patientId: P.id, journeyId: journey.id, status: "Concluída" } })) === 0; i++) await page.waitForTimeout(250);
    const concluded = await prisma.evaluation.findFirst({ where: { patientId: P.id, journeyId: journey.id }, select: { status: true, allergies: true, autoimmuneDiseases: true, clinicalNotes: true } });
    check("avaliação (tela): completa avança e conclui", concluded?.status === "Concluída" && concluded.allergies === "Não" && concluded.autoimmuneDiseases === "Sim" && concluded.clinicalNotes === "Observação clínica", JSON.stringify(concluded));

    await page.goto(`${baseUrl}/clientes?patient=${P.id}&journey=${journeyWithDraft.id}`);
    await field("chiefComplaint").waitFor();
    await page.waitForFunction(() => document.querySelector("#assessment-field-patientGoal")?.value === "Uniformizar");
    const merged = await values();
    check("avaliação (tela): rascunho aberto só completa o que está vazio e não sobrescreve o escrito", merged.chiefComplaint === "Escrita pelo profissional" && merged.allergies === "Sim" && merged.patientGoal === "Uniformizar" && merged.pregnancyStatus === "Não", JSON.stringify(merged));
    const untouched = await prisma.evaluation.findFirst({ where: { patientId: P.id, journeyId: journeyWithDraft.id }, select: { chiefComplaint: true, patientGoal: true, pregnancyStatus: true } });
    check("avaliação (tela): abrir o rascunho não regravou nada sozinho", untouched?.chiefComplaint === "Escrita pelo profissional" && untouched.patientGoal === "" && untouched.pregnancyStatus === "", JSON.stringify(untouched));
    check("avaliação (tela): sem erro de JavaScript", pageErrors.length === 0, pageErrors.join(" | "));
  });
  return { patient: P };
}

// Lacunas da exigência de campos ao concluir: campo a campo, tipos, avaliação antiga, jornadas, isolamento e STAFF.
async function evaluationRequiredGaps() {
  const created = await api("POST", "/api/patients", { name: `E2E Aval Lacunas ${run}`, phone: "11999990012", age: 35, cpf: randomCpf() });
  const P = created.data.patient ?? created.data;
  const created2 = await api("POST", "/api/patients", { name: `E2E Aval Outro ${run}`, phone: "11999990013", age: 36, cpf: randomCpf() });
  const Q = created2.data.patient ?? created2.data;
  const url = `/api/patients/${P.id}/evaluation`;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const photo = { name: "frente", imageUrl: png, width: 1, height: 1, category: "Frontal", annotations: [] };
  const clinicId = (await prisma.patient.findUnique({ where: { id: P.id }, select: { clinicId: true } })).clinicId;
  const fields = Object.keys(fullAssessment);
  const countAll = () => prisma.evaluation.count({ where: { patientId: P.id } });

  // Cada campo ausente ao concluir uma avaliação nova: 400 e nada gravado.
  for (const field of fields) {
    const rest = { ...fullAssessment };
    delete rest[field];
    const r = await api("PUT", url, { photos: [photo], assessment: rest, status: "Concluída" });
    check(`avaliação (lacunas): concluir sem enviar ${field} devolve 400`, r.status === 400, `${r.status} ${r.data.message}`);
  }
  for (const value of ["   ", "\n\t ", ""]) {
    const r = await api("PUT", url, { photos: [], assessment: { ...fullAssessment, clinicalNotes: value }, status: "Concluída" });
    check(`avaliação (lacunas): observações só com espaços/quebras (${JSON.stringify(value)}) devolve 400`, r.status === 400, r.status);
  }
  let r = await api("PUT", url, { photos: [photo], status: "Concluída" });
  check("avaliação (lacunas): concluir sem o objeto assessment devolve 400", r.status === 400, r.status);
  check("avaliação (lacunas): tentativas inválidas não criaram avaliação nem foto", (await countAll()) === 0 && (await prisma.evaluationPhoto.count({ where: { evaluation: { patientId: P.id } } })) === 0);

  // Tipos e tamanhos inválidos.
  for (const [label, value] of [["número", 5], ["array", ["Não"]], ["null", null], ["objeto", { a: 1 }], ["booleano", true]]) {
    const concluded = await api("PUT", url, { photos: [], assessment: { ...fullAssessment, allergies: value }, status: "Concluída" });
    const asDraft = await api("PUT", url, { photos: [], assessment: { allergies: value } });
    check(`avaliação (lacunas): campo com tipo ${label} é recusado ao concluir e em rascunho (sem 500)`, concluded.status === 400 && asDraft.status === 400, `${concluded.status}/${asDraft.status}`);
  }
  r = await api("PUT", url, { photos: [], assessment: { ...fullAssessment, clinicalNotes: "x".repeat(5001) }, status: "Concluída" });
  check("avaliação (lacunas): texto de 5001 caracteres devolve 400", r.status === 400, r.status);
  r = await api("PUT", url, { photos: [], assessment: { ...fullAssessment, clinicalNotes: "x".repeat(5000) }, status: "Concluída" });
  check("avaliação (lacunas): texto de exatamente 5000 caracteres é aceito", r.status === 200, r.status);
  r = await api("PUT", url, { photos: [], assessment: { ...fullAssessment, clinicalNotes: `${" ".repeat(4000)}ok${" ".repeat(900)}` }, status: "Concluída" });
  check("avaliação (lacunas): texto com espaços nas pontas vale e é aparado", r.status === 200 && (await prisma.evaluation.findUnique({ where: { id: r.data.evaluation.id }, select: { clinicalNotes: true } })).clinicalNotes === "ok", r.status);
  r = await api("PUT", url, { photos: [], assessment: fullAssessment, status: "concluída" });
  check("avaliação (lacunas): status com grafia errada devolve 400", r.status === 400, r.status);
  r = await api("PUT", url, { photos: [], assessment: fullAssessment, status: null });
  check("avaliação (lacunas): status null é recusado (400) sem quebrar", r.status === 400, r.status);
  r = await api("PUT", url, { photos: [], assessment: { ...fullAssessment, status: "Concluída", clinicId: "outra" } });
  check("avaliação (lacunas): campos extras no assessment são ignorados", r.status === 200 && r.data.evaluation.status === "Rascunho", `${r.status} ${r.data.evaluation?.status}`);

  // Mesclagem com o já gravado: rascunho com 7 campos + o último enviado ao concluir.
  const seven = { ...fullAssessment };
  delete seven.clinicalNotes;
  const d = await api("PUT", url, { photos: [], assessment: seven });
  const dId = d.data.evaluation.id;
  r = await api("PUT", url, { evaluationId: dId, photos: [], assessment: {}, status: "Concluída" });
  check("avaliação (lacunas): concluir rascunho faltando só um campo, sem enviá-lo, devolve 400", r.status === 400 && /observações/.test(r.data.message), `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { evaluationId: dId, photos: [], status: "Concluída" });
  check("avaliação (lacunas): idem sem objeto assessment devolve 400", r.status === 400, r.status);
  check("avaliação (lacunas): continua rascunho após as recusas", (await prisma.evaluation.findUnique({ where: { id: dId }, select: { status: true } })).status === "Rascunho");
  r = await api("PUT", url, { evaluationId: dId, photos: [], assessment: { clinicalNotes: "   " }, status: "Concluída" });
  check("avaliação (lacunas): enviar o campo faltante só com espaços não vale", r.status === 400, r.status);
  r = await api("PUT", url, { evaluationId: dId, photos: [], assessment: { clinicalNotes: "Final" }, status: "Concluída" });
  check("avaliação (lacunas): enviar só o campo faltante conclui usando os 7 gravados", r.status === 200 && r.data.evaluation.status === "Concluída", `${r.status} ${r.data.message}`);
  const dRow = await prisma.evaluation.findUnique({ where: { id: dId } });
  check("avaliação (lacunas): os 7 campos gravados foram preservados", Object.keys(seven).every((key) => dRow[key] === seven[key]) && dRow.clinicalNotes === "Final", JSON.stringify(dRow).slice(0, 200));
  r = await api("PUT", url, { evaluationId: dId, photos: [], assessment: { chiefComplaint: "  " }, status: "Concluída" });
  check("avaliação (lacunas): reenviar concluída esvaziando um campo devolve 400 e mantém o gravado", r.status === 400 && (await prisma.evaluation.findUnique({ where: { id: dId }, select: { chiefComplaint: true } })).chiefComplaint === "Queixa", r.status);

  // Avaliação ANTIGA concluída com campos vazios: salvar fotos/anotações/ordem sem enviar status não pode ser bloqueado.
  const old = await prisma.evaluation.create({ data: { patientId: P.id, clinicId, professional: "Teste", chiefComplaint: "Antiga", status: "Concluída" } });
  const two = [{ ...photo, id: `e2e-a-${run}`, name: "a", sortOrder: 0 }, { ...photo, id: `e2e-b-${run}`, name: "b", sortOrder: 1 }];
  r = await api("PUT", url, { evaluationId: old.id, photos: two });
  check("avaliação (lacunas): antiga concluída com campos vazios aceita fotos sem enviar status", r.status === 200 && r.data.evaluation.status === "Concluída" && r.data.evaluation.photoCount === 2, `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { evaluationId: old.id, photos: [{ ...two[1], sortOrder: 0 }, { ...two[0], sortOrder: 1, annotations: [{ id: "x", type: "arrow" }] }] });
  const oldPhotos = (await api("GET", `${url}?evaluationId=${old.id}`)).data.evaluation;
  check("avaliação (lacunas): antiga: reordenar e anotar funciona e mantém status e campos", r.status === 200 && oldPhotos.photos[0].name === "b" && oldPhotos.photos[1].annotations.length === 1 && oldPhotos.status === "Concluída" && oldPhotos.chiefComplaint === "Antiga" && oldPhotos.allergies === "", `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { evaluationId: old.id, photos: [], assessment: { chiefComplaint: "Antiga editada" } });
  check("avaliação (lacunas): antiga: editar um campo sem status funciona", r.status === 200 && (await prisma.evaluation.findUnique({ where: { id: old.id }, select: { status: true } })).status === "Concluída", `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { evaluationId: old.id, photos: two, assessment: { chiefComplaint: "Antiga editada" }, status: "Concluída" });
  check("avaliação (lacunas): antiga reenviada com status Concluída e vazios que já eram vazios é aceita (é o que o editor de fotos envia ao salvar)", r.status === 200 && r.data.evaluation.photoCount === 2, `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { evaluationId: old.id, photos: two, assessment: { chiefComplaint: "  " }, status: "Concluída" });
  check("avaliação (lacunas): antiga reenviada esvaziando campo que estava preenchido devolve 400 e não grava", r.status === 400 && (await prisma.evaluation.findUnique({ where: { id: old.id }, select: { chiefComplaint: true } })).chiefComplaint === "Antiga editada", `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { evaluationId: old.id, photos: two, assessment: { allergies: "Sim" }, status: "Concluída" });
  check("avaliação (lacunas): antiga: preencher um campo vazio e manter os outros vazios é aceito", r.status === 200 && (await prisma.evaluation.findUnique({ where: { id: old.id }, select: { allergies: true } })).allergies === "Sim", r.status);
  r = await api("PUT", url, { evaluationId: old.id, photos: two, assessment: { allergies: "" }, status: "Concluída" });
  check("avaliação (lacunas): antiga: depois de preenchido, esvaziar o campo devolve 400", r.status === 400, r.status);
  r = await api("PUT", url, { evaluationId: old.id, photos: two, assessment: { ...fullAssessment }, status: "Concluída" });
  check("avaliação (lacunas): antiga preenchida por completo e reenviada conclui", r.status === 200, `${r.status} ${r.data.message}`);
  const old2 = await prisma.evaluation.create({ data: { patientId: P.id, clinicId, professional: "Teste", chiefComplaint: "Antiga 2", status: "Concluída" } });
  r = await api("PUT", url, { evaluationId: old2.id, photos: [], assessment: { chiefComplaint: "Antiga 2" }, status: "Rascunho" });
  check("avaliação (lacunas): reabrir antiga concluída como Rascunho e salvar não exige nada", r.status === 200 && r.data.evaluation.status === "Rascunho", `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { evaluationId: old2.id, photos: [], status: "Concluída" });
  check("avaliação (lacunas): reaberta, voltar a Concluída com campos vazios devolve 400", r.status === 400, r.status);

  // Rascunho sem campos nem foto.
  r = await api("PUT", url, { photos: [] });
  check("avaliação (lacunas): rascunho sem assessment nem status é salvo", r.status === 200 && r.data.evaluation.status === "Rascunho", `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { photos: [], assessment: { chiefComplaint: "  ", allergies: "" }, status: "Rascunho" });
  check("avaliação (lacunas): rascunho explícito com campos vazios é salvo", r.status === 200, r.status);

  // Jornada.
  const prof = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const j1 = (await api("POST", `/api/patients/${P.id}/journeys`, { name: `Aval J1 ${run}`, professionalId: prof?.id })).data.journey;
  const j2 = (await api("POST", `/api/patients/${P.id}/journeys`, { name: `Aval J2 ${run}`, professionalId: prof?.id })).data.journey;
  r = await api("PUT", url, { journeyId: j1.id, photos: [], assessment: { ...fullAssessment, clinicalNotes: "" }, status: "Concluída" });
  check("avaliação (lacunas): por jornada, concluir incompleta devolve 400 sem criar", r.status === 400 && (await prisma.evaluation.count({ where: { journeyId: j1.id } })) === 0, `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { journeyId: j1.id, photos: [], assessment: fullAssessment, status: "Concluída" });
  const evJ1 = r.data.evaluation;
  check("avaliação (lacunas): por jornada, completa conclui e fica na jornada", r.status === 200 && (await prisma.evaluation.findUnique({ where: { id: evJ1.id }, select: { journeyId: true } })).journeyId === j1.id, `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { evaluationId: evJ1.id, journeyId: j2.id, photos: [], assessment: fullAssessment, status: "Concluída" });
  check("avaliação (lacunas): avaliação de outra jornada devolve 400", r.status === 400, r.status);
  r = await api("PUT", url, { journeyId: "inexistente", photos: [], assessment: fullAssessment, status: "Concluída" });
  check("avaliação (lacunas): jornada inexistente devolve 404", r.status === 404, r.status);
  r = await api("PUT", url, { evaluationId: "inexistente", photos: [], assessment: fullAssessment, status: "Concluída" });
  check("avaliação (lacunas): avaliação inexistente devolve 404", r.status === 404, r.status);
  const evQ = await api("PUT", `/api/patients/${Q.id}/evaluation`, { photos: [], assessment: fullAssessment, status: "Concluída" });
  r = await api("PUT", url, { evaluationId: evQ.data.evaluation.id, photos: [], assessment: { chiefComplaint: "Invasão" }, status: "Rascunho" });
  check("avaliação (lacunas): avaliação de outro paciente (mesma clínica) devolve 404 e não muda", r.status === 404 && (await prisma.evaluation.findUnique({ where: { id: evQ.data.evaluation.id }, select: { chiefComplaint: true } })).chiefComplaint === "Queixa", r.status);

  // Clique duplo ao concluir o mesmo rascunho.
  const dd = (await api("PUT", url, { photos: [], assessment: seven })).data.evaluation.id;
  const both = await Promise.all([1, 2].map(() => api("PUT", url, { evaluationId: dd, photos: [photo], assessment: { clinicalNotes: "Dupla" }, status: "Concluída" })));
  check("avaliação (lacunas): clique duplo ao concluir o mesmo rascunho dá 200/200 e uma foto só", both.every((x) => x.status === 200) && (await prisma.evaluationPhoto.count({ where: { evaluationId: dd } })) === 1, both.map((x) => x.status).join("/"));

  // Outra clínica, STAFF e sem sessão.
  const otherEmail = `e2e-aval-outra-${run}@example.com`;
  const otherPassword = `E2e-${run}-Outra9!`;
  const otherClinic = `E2E Avaliação Externa ${run}`;
  const staffEmail = `e2e-aval-staff-${run}@example.com`;
  const staffPassword = `E2e-${run}-Staff9!`;
  let team = null;
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990020", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const before = await prisma.evaluation.findUnique({ where: { id: dId }, select: { updatedAt: true, clinicalNotes: true } });
      const [byPatient, byEval] = await withSession(other.cookie, () => Promise.all([
        api("PUT", url, { photos: [], assessment: fullAssessment, status: "Concluída" }),
        api("PUT", url, { evaluationId: dId, photos: [], assessment: { clinicalNotes: "Invasão" }, status: "Concluída" }),
      ]));
      const after = await prisma.evaluation.findUnique({ where: { id: dId }, select: { updatedAt: true, clinicalNotes: true } });
      check("avaliação (lacunas): outra clínica recebe 404 (paciente e avaliação) e nada muda", byPatient.status === 404 && byEval.status === 404 && after.clinicalNotes === before.clinicalNotes && +after.updatedAt === +before.updatedAt, `${byPatient.status}/${byEval.status}`);
    } else check("segunda clínica criada para testar a avaliação", false, `registro ${r.status} login ${other?.status}`);

    r = await api("POST", "/api/team", { name: "E2E Atendente Aval", email: staffEmail, password: staffPassword, role: "STAFF", cpf: randomCpf(), address: "Rua Teste, 1", country: "Brasil", state: "SP", city: "São Paulo" });
    team = r.status === 201 ? r.data.member : null;
    const staff = team ? await loginAs(staffEmail, staffPassword) : null;
    if (staff?.status === 200) {
      const countBefore = await countAll();
      const s = await withSession(staff.cookie, async () => [
        await api("PUT", url, { photos: [], assessment: fullAssessment, status: "Concluída" }),
        await api("PUT", url, { evaluationId: dId, photos: [], assessment: { clinicalNotes: "Staff" } }),
        await api("PUT", url, { photos: [] }),
      ]);
      check("avaliação (lacunas): STAFF recebe 403 em qualquer PUT e nada é gravado", s.every((x) => x.status === 403) && (await countAll()) === countBefore && (await prisma.evaluation.findUnique({ where: { id: dId }, select: { clinicalNotes: true } })).clinicalNotes === "Final", s.map((x) => x.status).join("/"));
    } else check("usuário STAFF criado para testar a avaliação", false, `team ${r.status} login ${staff?.status}`);
  } finally {
    if (team) await api("DELETE", "/api/team", { membershipId: team.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [otherEmail, staffEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [otherEmail, staffEmail] } } });
  }
  r = await withSession("", () => api("PUT", url, { photos: [], assessment: fullAssessment, status: "Concluída" }));
  check("avaliação (lacunas): sem sessão devolve 401", r.status === 401, r.status);
}

async function anamnesis() {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const newPatient = async (label) => {
    const created = await api("POST", "/api/patients", { name: `E2E ${label} ${run}`, phone: "11999990010", age: 35, cpf: randomCpf() });
    if (created.status !== 201) throw new Error(`Paciente "${label}" não criado (${created.status})`);
    return created.data.patient ?? created.data;
  };
  const base = (patient) => `/api/patients/${patient.id}`;
  const overview = async (patient) => (await api("GET", `${base(patient)}/anamnesis`)).data;
  const answer = (value, detail = "") => ({ value, detail });
  const sortedStatuses = (list) => list.map((item) => item.status).sort((a, b) => a - b).join(",");
  const statusMap = (object) => JSON.stringify(Object.fromEntries(Object.entries(object).map(([key, item]) => [key, item.status])));

  const A = await newPatient("Anamnese A");
  const B = await newPatient("Anamnese B");
  const C = await newPatient("Anamnese C");
  const D = await newPatient("Sem dados");

  // 401 sem sessão, em todas as rotas novas.
  const noSession = await withSession("", async () => ({
    get: await api("GET", `${base(A)}/anamnesis`),
    post: await api("POST", `${base(A)}/anamnesis`, { from: "empty" }),
    put: await api("PUT", `${base(A)}/anamnesis`, { draftId: "x", content: {}, expectedUpdatedAt: "x" }),
    del: await api("DELETE", `${base(A)}/anamnesis?draftId=x&expectedUpdatedAt=x`),
    versionGet: await api("GET", `${base(A)}/anamnesis/x`),
    versionPost: await api("POST", `${base(A)}/anamnesis/x`, { action: "complete" }),
    encounters: await api("GET", `${base(A)}/encounters`),
  }));
  check("anamnese e atendimentos sem sessão devolvem 401 em todas as rotas", Object.values(noSession).every((item) => item.status === 401), statusMap(noSession));

  // Estado inicial e entradas inválidas (antes de existir qualquer rascunho).
  let o = await overview(A);
  check("anamnese vazia: sem versões, ausente e sem rascunho", o.restricted === false && o.exists === false && o.state === "AUSENTE" && o.versions?.length === 0 && o.draft === null && o.current === null, JSON.stringify(o).slice(0, 200));
  let r = await api("POST", `${base(A)}/anamnesis`, { from: "qualquer" });
  check("origem inválida da anamnese é recusada", r.status === 400, r.status);
  r = await api("POST", `${base(A)}/anamnesis`, { from: "current" });
  check("nova versão sem anamnese concluída é recusada", r.status === 409, r.status);
  r = await api("POST", `${base(A)}/anamnesis`, { from: "evaluation" });
  check("importar da avaliação sem avaliação devolve 404", r.status === 404, r.status);
  r = await api("POST", `${base(A)}/anamnesis`, { from: "evaluation", evaluationId: "inexistente" });
  check("avaliação inexistente devolve 404", r.status === 404, r.status);
  check("nada foi criado pelas tentativas inválidas", (await overview(A)).versions.length === 0);

  // Avaliações com dados de anamnese: uma da A (a mais recente com dados) e uma da B.
  const evalPhotos = [{ name: "frente", imageUrl: png, width: 1, height: 1, category: "Frontal", annotations: [] }];
  const evalA = await api("PUT", `${base(A)}/evaluation`, { photos: evalPhotos, assessment: { ...fullAssessment, chiefComplaint: "Rugas na testa", patientGoal: "Suavizar", allergies: "Dipirona", contraindications: "Uso de isotretinoína" }, status: "Concluída" });
  const evalB = await api("PUT", `${base(B)}/evaluation`, { photos: evalPhotos, assessment: { chiefComplaint: "Queixa da B" } });
  check("avaliações de teste são salvas", evalA.status === 200 && evalB.status === 200, `${evalA.status}/${evalB.status}`);
  const evaluationAId = evalA.data.evaluation?.id;
  const evaluationBId = evalB.data.evaluation?.id;
  check("avaliações de teste devolvem id", Boolean(evaluationAId && evaluationBId), JSON.stringify(evalA.data).slice(0, 150));
  r = await api("POST", `${base(A)}/anamnesis`, { from: "evaluation", evaluationId: evaluationBId });
  check("avaliação de outro paciente não pode ser importada (404)", r.status === 404, r.status);

  // Corrida: três pedidos simultâneos para o paciente C devolvem o mesmo rascunho.
  const race = await Promise.all([1, 2, 3].map(() => api("POST", `${base(C)}/anamnesis`, { from: "empty" })));
  const raceIds = new Set(race.map((item) => item.data.draft?.id));
  check("criação simultânea de rascunho gera um só rascunho", race.every((item) => [200, 201].includes(item.status)) && raceIds.size === 1 && (await overview(C)).versions.length === 1, race.map((item) => item.status).join(","));

  // Rascunho da A a partir da avaliação mais recente com dados.
  r = await api("POST", `${base(A)}/anamnesis`, { from: "evaluation" });
  const draft = r.data.draft;
  check("rascunho a partir da avaliação é criado (201)", r.status === 201 && r.data.created === true && draft?.version === 1 && draft.status === "RASCUNHO" && draft.origin === "evaluation", `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  check("rascunho traz o texto da avaliação", draft?.content.complaint.chiefComplaint === "Rugas na testa" && draft.content.allergies.notes === "Dipirona" && draft.content.contraindications.notes === "Uso de isotretinoína");
  const allAnswers = [...Object.values(draft.content.health.items), ...Object.values(draft.content.allergies.items)];
  check("texto livre da avaliação não vira Sim/Não (tudo continua null)", allAnswers.every((item) => item.value === null) && draft.content.medications.usesMedication === null && draft.content.previousProcedures.hadPrevious === null);
  check("campo não respondido não gera alerta de Sim/Não", !draft.alerts.some((alert) => /^(health|allergy)-(?!notes)/.test(alert.id)), JSON.stringify(draft.alerts.map((alert) => alert.id)));
  r = await api("POST", `${base(A)}/anamnesis`, { from: "empty" });
  check("segundo pedido devolve o mesmo rascunho (created false)", r.data.draft?.id === draft.id && r.data.created === false, `${r.status} ${r.data.created}`);
  o = await overview(A);
  check("visão geral: só rascunho", o.state === "SOMENTE_RASCUNHO" && o.draft?.id === draft.id && o.exists === false && o.versions.length === 1);

  // Autosave.
  const content = structuredClone(draft.content);
  content.health.items.hypertension = answer("yes", "controlada");
  content.health.items.diabetes = answer("no");
  content.health.items.chronicDiseases = answer("");
  content.health.items.cardiac = answer("talvez");
  content.allergies.items.latex = answer("yes", "luvas");
  content.medications.usesMedication = "yes";
  content.medications.items = [{ id: "m1", name: "Losartana", purpose: "Pressão", dose: "50 mg", notes: "" }, { id: "m2", name: "", purpose: "", dose: "", notes: "" }];
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content });
  check("autosave sem expectedUpdatedAt é recusado (400)", r.status === 400, r.status);
  r = await api("PUT", `${base(A)}/anamnesis`, { content, expectedUpdatedAt: draft.updatedAt });
  check("autosave sem draftId é recusado (400)", r.status === 400, r.status);
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: "inexistente", content, expectedUpdatedAt: draft.updatedAt });
  check("autosave de rascunho inexistente devolve 404", r.status === 404, r.status);
  const draftB = (await api("POST", `${base(B)}/anamnesis`, { from: "empty" })).data.draft;
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draftB.id, content, expectedUpdatedAt: draftB.updatedAt });
  check("autosave com rascunho de outro paciente devolve 404", r.status === 404, r.status);
  const staleRevision = draft.updatedAt;
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content, expectedUpdatedAt: draft.updatedAt });
  check("autosave grava e devolve nova revisão", r.status === 200 && r.data.updatedAt && r.data.updatedAt !== staleRevision, `${r.status} ${JSON.stringify(r.data)}`);
  let revision = r.data.updatedAt;
  r = await api("GET", `${base(A)}/anamnesis/${draft.id}`);
  const saved = r.data.version?.content;
  check("conteúdo gravado: Sim, Não e detalhe exatos", saved?.health.items.hypertension.value === "yes" && saved.health.items.hypertension.detail === "controlada" && saved.health.items.diabetes.value === "no" && saved.allergies.items.latex.value === "yes", JSON.stringify(saved?.health.items.hypertension));
  check("vazio e valor inválido são salvos como null, nunca como Não", saved?.health.items.chronicDiseases.value === null && saved.health.items.cardiac.value === null && saved.health.items.keloid.value === null && saved.allergies.items.foods.value === null);
  check("autosave não perde a linha de medicamento preenchida", saved?.medications.items.some((row) => row.name === "Losartana"));
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content: { ...content, complaint: { chiefComplaint: "SOBRESCRITA", treatmentGoal: "" } }, expectedUpdatedAt: staleRevision });
  check("autosave com revisão defasada devolve 409 stale", r.status === 409 && r.data.code === "stale", `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  check("revisão defasada não grava nada", (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.content.complaint.chiefComplaint === "Rugas na testa");
  const pair = await Promise.all([1, 2].map((n) => api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content: { ...content, complaint: { chiefComplaint: `Aba ${n}`, treatmentGoal: "" } }, expectedUpdatedAt: revision })));
  check("dois autosaves simultâneos com a mesma revisão: só um grava", sortedStatuses(pair) === "200,409", pair.map((item) => item.status).join(","));
  revision = (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.updatedAt;
  const big = { ...content, procedureSpecific: { texto: "a".repeat(130_000) } };
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content: big, expectedUpdatedAt: revision });
  check("autosave acima de 120 KB devolve 413", r.status === 413, r.status);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "complete", expectedUpdatedAt: revision, content: big });
  check("concluir acima de 120 KB devolve 413", r.status === 413, r.status);
  const clipped = structuredClone(content);
  clipped.complaint.chiefComplaint = "x".repeat(5000);
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content: clipped, expectedUpdatedAt: revision });
  check("texto longo é cortado em 2000 caracteres", r.status === 200 && (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.content.complaint.chiefComplaint.length === 2000, r.status);
  revision = r.data.updatedAt;
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content, expectedUpdatedAt: revision });
  revision = r.data.updatedAt;

  // Conclusão.
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "complete", note: "ok" });
  check("concluir sem expectedUpdatedAt é recusado (400)", r.status === 400, r.status);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "complete", expectedUpdatedAt: staleRevision });
  check("concluir com revisão defasada devolve 409 stale", r.status === 409 && r.data.code === "stale", `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "apagar" });
  check("ação desconhecida é recusada (400)", r.status === 400, r.status);
  const emptyC = race[0].data.draft;
  r = await api("POST", `${base(C)}/anamnesis/${emptyC.id}`, { action: "complete", expectedUpdatedAt: emptyC.updatedAt });
  check("concluir rascunho vazio é recusado (400)", r.status === 400, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
  const done = await Promise.all([1, 2].map(() => api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "complete", expectedUpdatedAt: revision })));
  check("conclusão dupla simultânea: uma conclui, a outra recebe 409", sortedStatuses(done) === "200,409", done.map((item) => item.status).join(","));
  const v1 = (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version;
  check("versão concluída: status, autor e data", v1.status === "CONCLUIDA" && v1.completedBy === accountName && Boolean(v1.completedAt), `${v1.status} ${v1.completedBy}`);
  check("conclusão descarta a linha de medicamento vazia", v1.content.medications.items.length === 1 && v1.content.medications.items[0].name === "Losartana");
  check("auditoria registra criação e conclusão", ["draft-created", "completed"].every((action) => v1.audit.some((entry) => entry.action === action && entry.by === accountName)), JSON.stringify(v1.audit.map((entry) => entry.action)));
  check("alertas só para Sim, com nível e sem apto/inapto", v1.alerts.some((alert) => alert.id === "allergy-latex" && alert.level === "important") && v1.alerts.some((alert) => alert.id === "health-hypertension") && !v1.alerts.some((alert) => alert.id === "health-diabetes") && !/\binapto|\bapto\b|liberad/i.test(JSON.stringify(v1.alerts)), JSON.stringify(v1.alerts.map((alert) => alert.id)));

  // Imutabilidade.
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: draft.id, content: { ...content, complaint: { chiefComplaint: "ALTERADA", treatmentGoal: "" } }, expectedUpdatedAt: v1.updatedAt });
  check("versão concluída não aceita autosave (409)", r.status === 409, r.status);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "complete", expectedUpdatedAt: v1.updatedAt });
  check("concluir de novo uma versão concluída devolve 409", r.status === 409, r.status);
  r = await api("DELETE", `${base(A)}/anamnesis?draftId=${draft.id}&expectedUpdatedAt=${encodeURIComponent(v1.updatedAt)}`);
  check("versão concluída não pode ser apagada", r.status === 404, r.status);
  const v1Again = (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version;
  check("versão concluída permanece intacta", v1Again.content.complaint.chiefComplaint !== "ALTERADA" && v1Again.updatedAt === v1.updatedAt && v1Again.status === "CONCLUIDA");
  r = await api("POST", `${base(A)}/anamnesis`, { from: "empty" });
  check("com versão concluída e sem rascunho, from empty cria rascunho v2 sem tocar a v1", r.status === 201 && r.data.draft.version === 2, `${r.status} ${r.data.draft?.version}`);
  const strayDraft = r.data.draft;
  r = await api("DELETE", `${base(A)}/anamnesis?draftId=${strayDraft.id}&expectedUpdatedAt=${encodeURIComponent(strayDraft.updatedAt)}`);
  check("rascunho vazio extra é descartado", r.status === 200, r.status);

  // Revisão.
  o = await overview(A);
  check("visão geral após concluir: revisada, versão atual e alertas", o.state === "REVISADA" && o.exists === true && o.current?.id === draft.id && o.alerts.some((alert) => alert.id === "allergy-latex"), `${o.state}`);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "confirm-review", note: "Conferido com a paciente" });
  check("confirmar revisão registra autor e data", r.status === 200 && r.data.version.reviewConfirmedBy === accountName && Boolean(r.data.version.reviewConfirmedAt) && r.data.version.status === "CONCLUIDA", `${r.status}`);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "" });
  check("pedir revisão sem motivo é recusado (400)", r.status === 400, r.status);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "Paciente engravidou" });
  check("pedir revisão marca pendente com motivo e autor", r.status === 200 && r.data.version.status === "PENDENTE_REVISAO" && r.data.version.reviewReason === "Paciente engravidou" && r.data.version.reviewRequestedBy === accountName, `${r.status}`);
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "de novo" });
  check("pedir revisão duas vezes devolve 409", r.status === 409, r.status);
  o = await overview(A);
  check("visão geral: revisão pendente manual", o.state === "REVISAO_PENDENTE" && o.reason === "manual", `${o.state}`);
  const audit = (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.audit.map((entry) => entry.action);
  check("auditoria guarda revisão confirmada e solicitada", audit.includes("review-confirmed") && audit.includes("review-requested"), audit.join(","));
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "confirm-review", note: "ok" });
  check("confirmar revisão devolve a versão a concluída", r.status === 200 && r.data.version.status === "CONCLUIDA", `${r.status}`);

  // Nova versão.
  r = await api("POST", `${base(A)}/anamnesis`, { from: "current" });
  const v2draft = r.data.draft;
  check("nova versão: rascunho v2 copiado da v1", r.status === 201 && v2draft.version === 2 && v2draft.basedOnVersion === 1 && v2draft.origin === "current-version" && v2draft.content.health.items.hypertension.value === "yes" && v2draft.content.health.items.cardiac.value === null, `${r.status}`);
  check("nova versão não altera a concluída", (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.status === "CONCLUIDA");
  r = await api("POST", `${base(A)}/anamnesis/${v2draft.id}`, { action: "request-review", note: "x" });
  check("só a versão atual pode ser revisada (rascunho recusado)", r.status === 409, r.status);
  o = await overview(A);
  check("visão geral com rascunho e versão atual", o.versions.length === 2 && o.current.id === draft.id && o.draft.id === v2draft.id && o.state === "REVISADA");
  const content2 = structuredClone(v2draft.content);
  content2.health.items.hypertension = answer("no");
  content2.health.items.pregnancy = answer("yes", "12 semanas");
  r = await api("PUT", `${base(A)}/anamnesis`, { draftId: v2draft.id, content: content2, expectedUpdatedAt: v2draft.updatedAt });
  r = await api("POST", `${base(A)}/anamnesis/${v2draft.id}`, { action: "complete", expectedUpdatedAt: r.data.updatedAt, note: "atualizada" });
  check("v2 concluída", r.status === 200 && r.data.version.status === "CONCLUIDA" && r.data.version.version === 2, `${r.status}`);
  o = await overview(A);
  check("histórico traz as duas versões e a v2 como atual", o.versions.map((item) => item.version).join(",") === "2,1" && o.current.id === v2draft.id && o.draft === null && o.alerts.some((alert) => alert.id === "health-pregnancy" && alert.level === "important") && !o.alerts.some((alert) => alert.id === "health-hypertension"), JSON.stringify(o.versions.map((item) => `${item.version}:${item.status}`)));
  const v1Final = (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version;
  check("v1 segue imutável depois da v2", v1Final.content.health.items.hypertension.value === "yes" && v1Final.status === "CONCLUIDA");
  r = await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "antiga" });
  check("versão superada não pode ser revisada (409)", r.status === 409, r.status);

  // Descarte de rascunho.
  const v3 = (await api("POST", `${base(A)}/anamnesis`, { from: "current" })).data.draft;
  const delBase = `${base(A)}/anamnesis?draftId=${v3.id}`;
  r = await api("DELETE", delBase);
  check("descartar sem expectedUpdatedAt é recusado (400)", r.status === 400, r.status);
  r = await api("DELETE", `${base(A)}/anamnesis?expectedUpdatedAt=${encodeURIComponent(v3.updatedAt)}`);
  check("descartar sem draftId é recusado (400)", r.status === 400, r.status);
  r = await api("DELETE", `${delBase}&expectedUpdatedAt=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`);
  check("descartar com revisão defasada devolve 409 stale e mantém o rascunho", r.status === 409 && r.data.code === "stale" && (await api("GET", `${base(A)}/anamnesis/${v3.id}`)).status === 200, `${r.status}`);
  r = await api("DELETE", `${delBase}&expectedUpdatedAt=${encodeURIComponent(v3.updatedAt)}`);
  check("descartar rascunho com a revisão certa", r.status === 200, r.status);
  check("rascunho descartado some e as versões concluídas ficam", (await api("GET", `${base(A)}/anamnesis/${v3.id}`)).status === 404 && (await overview(A)).versions.length === 2);

  // Isolamento: outro paciente da mesma clínica.
  r = await api("GET", `${base(B)}/anamnesis/${draft.id}`);
  check("versão de outro paciente da mesma clínica: GET 404", r.status === 404, r.status);
  r = await api("POST", `${base(B)}/anamnesis/${draft.id}`, { action: "request-review", note: "x" });
  check("versão de outro paciente da mesma clínica: POST 404", r.status === 404, r.status);
  check("a versão do outro paciente não mudou", (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.status === "CONCLUIDA");
  o = await overview(B);
  check("visão geral da B não mistura versões da A", o.versions.length === 1 && o.versions[0].id === draftB.id);

  // Outra clínica e STAFF. Tudo que for criado fora da conta de teste é removido no finally.
  const otherEmail = `e2e-outra-${run}@example.com`;
  const otherPassword = `E2e-${run}-Outra9!`;
  const otherClinic = `E2E Clínica Externa ${run}`;
  let team = null;
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990020", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const probe = await withSession(other.cookie, async () => {
        const created = await api("POST", "/api/patients", { name: `E2E Externo ${run}`, phone: "11999990021", age: 40, cpf: randomCpf() });
        return {
          foreign: created.data.patient ?? created.data,
          overview: await api("GET", `${base(A)}/anamnesis`),
          create: await api("POST", `${base(A)}/anamnesis`, { from: "empty" }),
          put: await api("PUT", `${base(A)}/anamnesis`, { draftId: v2draft.id, content: {}, expectedUpdatedAt: v2draft.updatedAt }),
          del: await api("DELETE", `${base(A)}/anamnesis?draftId=${draftB.id}&expectedUpdatedAt=${encodeURIComponent(draftB.updatedAt)}`),
          versionGet: await api("GET", `${base(A)}/anamnesis/${draft.id}`),
          versionPost: await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "x" }),
          encounters: await api("GET", `${base(A)}/encounters`),
        };
      });
      const { foreign, ...calls } = probe;
      check("paciente de outra clínica: todas as rotas devolvem 404", Object.values(calls).every((item) => item.status === 404), statusMap(calls));
      const viaOwnPatient = await withSession(other.cookie, () => api("GET", `${base(foreign)}/anamnesis/${draft.id}`));
      check("versão da minha clínica lida por paciente da outra clínica devolve 404", viaOwnPatient.status === 404, viaOwnPatient.status);
      check("tentativas da outra clínica não alteraram a anamnese", (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.status === "CONCLUIDA" && (await api("GET", `${base(B)}/anamnesis/${draftB.id}`)).status === 200);
    } else {
      check("segunda clínica criada para testar isolamento", false, `registro ${r.status} login ${other?.status}`);
    }

    const staffEmail = `e2e-staff-${run}@example.com`;
    const staffPassword = `E2e-${run}-Staff9!`;
    r = await api("POST", "/api/team", { name: "E2E Atendente", email: staffEmail, password: staffPassword, role: "STAFF" });
    team = r.status === 201 ? r.data.member : null;
    const staff = team ? await loginAs(staffEmail, staffPassword) : null;
    if (staff?.status === 200) {
      const s = await withSession(staff.cookie, async () => ({
        overview: await api("GET", `${base(A)}/anamnesis`),
        overviewNone: await api("GET", `${base(C)}/anamnesis`),
        version: await api("GET", `${base(A)}/anamnesis/${draft.id}`),
        create: await api("POST", `${base(D)}/anamnesis`, { from: "empty" }),
        put: await api("PUT", `${base(B)}/anamnesis`, { draftId: draftB.id, content: {}, expectedUpdatedAt: draftB.updatedAt }),
        del: await api("DELETE", `${base(B)}/anamnesis?draftId=${draftB.id}&expectedUpdatedAt=${encodeURIComponent(draftB.updatedAt)}`),
        action: await api("POST", `${base(A)}/anamnesis/${draft.id}`, { action: "request-review", note: "x" }),
        encounters: await api("GET", `${base(A)}/encounters`),
      }));
      check("STAFF: visão geral devolve só restricted e exists", JSON.stringify(Object.keys(s.overview.data).sort()) === JSON.stringify(["exists", "restricted"]) && s.overview.data.restricted === true && s.overview.data.exists === true && s.overviewNone.data.exists === false, JSON.stringify(s.overview.data).slice(0, 150));
      check("STAFF não recebe conteúdo clínico nem alertas", !/Losartana|Rugas|hypertension|latex/.test(JSON.stringify(s.overview.data)));
      check("STAFF não lê versão, não escreve e não vê atendimentos (403)", [s.version, s.create, s.put, s.del, s.action, s.encounters].every((item) => item.status === 403), statusMap(s));
      check("STAFF não alterou nada", (await overview(D)).versions.length === 0 && (await api("GET", `${base(B)}/anamnesis/${draftB.id}`)).status === 200 && (await api("GET", `${base(A)}/anamnesis/${draft.id}`)).data.version.status === "CONCLUIDA");
    } else {
      check("usuário STAFF criado para testar permissões", false, `team ${r.status} login ${staff?.status}`);
    }
  } finally {
    // A clínica de teste precisa voltar a ter só a conta de teste, senão resetTestClinic recusa a limpeza.
    if (team) await api("DELETE", "/api/team", { membershipId: team.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: otherEmail } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: otherEmail } });
  }

  // Lista de atendimentos.
  r = await api("GET", `${base(D)}/encounters`);
  check("atendimentos sem dados: lista vazia, sem retorno, sem corte", r.status === 200 && Array.isArray(r.data.items) && r.data.items.length === 0 && r.data.nextReturn === null && r.data.truncated === false, `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  const returnAppointment = await api("POST", "/api/appointments", { patientId: A.id, procedure: "Retorno", professional: "Teste", time: "14:30", date: `${day(3)}T00:00:00` });
  const photoEval = await api("PUT", `${base(A)}/evaluation`, { photos: [{ name: "frente", imageUrl: png, width: 1, height: 1, category: "Frontal", annotations: [] }], assessment: { chiefComplaint: "Com foto" } });
  check("retorno e avaliação com foto criados", returnAppointment.status === 201 && photoEval.status === 200, `${returnAppointment.status}/${photoEval.status}`);
  r = await api("GET", `${base(A)}/encounters`);
  const text = JSON.stringify(r.data);
  const items = r.data.items ?? [];
  check("atendimentos da A: avaliações listadas, só da A", r.status === 200 && items.length >= 1 && items.every((item) => item.type === "evaluation") && items.some((item) => item.id === evaluationAId) && !items.some((item) => item.id === evaluationBId), `${r.status} ${items.length}`);
  check("atendimentos: contagem de fotos sem imagem na resposta", items.some((item) => item.photoCount === 1) && !text.includes("data:image") && !text.includes("base64") && !text.includes("imageUrl"), text.length);
  check("atendimentos: próximo retorno agendado", r.data.nextReturn?.procedure === "Retorno" && r.data.nextReturn.time === "14:30", JSON.stringify(r.data.nextReturn));
  check("atendimentos: do mais recente ao mais antigo", items.every((item, index) => index === 0 || new Date(items[index - 1].occurredAt) >= new Date(item.occurredAt)));
  const encountersB = await api("GET", `${base(B)}/encounters`);
  check("atendimentos da B não trazem retorno nem dados da A", encountersB.data.nextReturn === null && encountersB.data.items.length === 1 && encountersB.data.items[0].id === evaluationBId, JSON.stringify(encountersB.data.items?.map((item) => item.id)));
}

// --- Prontuário: documentos clínicos e fotos ---
async function clinicalFiles() {
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const png = Buffer.from(pngB64, "base64");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
  const dataUrl = `data:image/png;base64,${pngB64}`;
  const form = (buffer, name, type, fields = {}) => {
    const body = new FormData();
    body.set("file", new Blob([buffer], { type }), name);
    for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
    return body;
  };
  // Chamada que aceita FormData e pode devolver bytes e cabeçalhos; usa a sessão atual (`cookie`).
  const call = async (method, path, body, { raw = false } = {}) => {
    const json = body && !(body instanceof FormData);
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: json ? JSON.stringify(body) : body, redirect: "manual" });
    if (raw) return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
    return { status: response.status, data };
  };
  const created = await api("POST", "/api/patients", { name: `E2E Arquivos ${run}`, phone: "11999990030", age: 33, cpf: randomCpf() });
  if (created.status !== 201) throw new Error(`Paciente de arquivos não criado (${created.status})`);
  const P = (created.data.patient ?? created.data).id;
  const docs = `/api/patients/${P}/documents`;
  const photosPath = `/api/patients/${P}/photos`;
  const ref = (value) => encodeURIComponent(value);
  const statuses = (object) => JSON.stringify(Object.fromEntries(Object.entries(object).map(([key, item]) => [key, item.status])));
  const safeHeaders = (h) => h.get("cache-control") === "private, no-store" && h.get("x-content-type-options") === "nosniff" && /cookie/i.test(h.get("vary") ?? "");

  // 401 sem sessão.
  const anon = await withSession("", async () => ({
    list: await call("GET", docs), post: await call("POST", docs, form(pdf, "a.pdf", "application/pdf", { category: "TERMOS" })),
    patch: await call("PATCH", `${docs}/x`, { name: "x" }), del: await call("DELETE", `${docs}/x`, { confirm: true }), file: await call("GET", `${docs}/x/file`, null, { raw: true }),
    photos: await call("GET", photosPath), photoPost: await call("POST", photosPath, form(png, "a.png", "image/png", { width: 1, height: 1 })),
    photo: await call("GET", `${photosPath}/gallery%3Ax`), image: await call("GET", `${photosPath}/gallery%3Ax/image`, null, { raw: true }),
  }));
  check("documentos e fotos sem sessão devolvem 401 em todas as rotas", Object.values(anon).every((item) => item.status === 401), statuses(anon));

  // Upload válido e recusas.
  let r = await call("POST", docs, form(pdf, "Termo de consentimento.pdf", "application/pdf", { category: "TERMOS", signatureStatus: "ASSINADO" }));
  const termo = r.data.item;
  check("upload de PDF em TERMOS", r.status === 201 && termo?.name === "Termo de consentimento" && termo.category === "TERMOS" && termo.signatureStatus === "ASSINADO" && termo.mimeType === "application/pdf", `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  r = await call("POST", docs, form(pdf, "Laudo facial.pdf", "application/pdf", { category: "EXAMES" }));
  const laudo = r.data.item;
  r = await call("POST", docs, form(png, "Receita.png", "image/png", { category: "RECEITAS" }));
  const receita = r.data.item;
  check("upload de imagem pequena como documento", r.status === 201 && receita?.mimeType === "image/png", r.status);
  r = await call("POST", docs, form(exe, "virus.pdf", "application/pdf", { category: "TERMOS" }));
  check("executável renomeado para .pdf é recusado (415)", r.status === 415, r.status);
  r = await call("POST", docs, form(pdf, "a.pdf", "image/png", { category: "TERMOS" }));
  check("MIME incoerente com o conteúdo é recusado (415)", r.status === 415, r.status);
  r = await call("POST", docs, form(Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024)]), "grande.pdf", "application/pdf", { category: "TERMOS" }));
  check("arquivo maior que 4 MB devolve 413", r.status === 413, r.status);
  {
    const probe = new Response(form(pdf, "c.pdf", "application/pdf", { category: "TERMOS" }));
    const contentType = probe.headers.get("content-type");
    const raw = Buffer.from(await probe.arrayBuffer());
    const stream = new ReadableStream({ start(c) { c.enqueue(raw); c.close(); } });
    const res = await fetch(`${baseUrl}${docs}`, { method: "POST", headers: { cookie, "content-type": contentType }, body: stream, duplex: "half" }).catch(() => ({ status: 0 }));
    check("sem Content-Length (chunked) devolve 413", res.status === 413, res.status);
  }
  r = await call("POST", docs, form(pdf, "a.pdf", "application/pdf", { category: "HACK" }));
  check("categoria inválida é recusada (400)", r.status === 400, r.status);
  r = await call("POST", docs, form(pdf, "a.pdf", "application/pdf", {}));
  check("upload sem categoria é recusado (400)", r.status === 400, r.status);
  r = await call("POST", docs, form(pdf, "../../etc/passwd.pdf", "application/pdf", { category: "TERMOS" }));
  check("nome com ../ é sanitizado", r.status === 201 && r.data.item.name === "passwd", JSON.stringify(r.data.item?.name));
  r = await call("POST", docs, form(pdf, "a.pdf", "application/pdf", { category: "TERMOS", journeyId: "inexistente" }));
  check("vínculo a tratamento inexistente é recusado (400)", r.status === 400, r.status);

  // Listagem paginada com contagens.
  r = await call("GET", docs);
  check("lista: total e contagens por categoria", r.status === 200 && r.data.total === 4 && r.data.counts.all === 4 && r.data.counts.TERMOS === 2 && r.data.counts.EXAMES === 1 && r.data.counts.RECEITAS === 1, JSON.stringify(r.data.counts));
  check("lista sem conteúdo binário", !JSON.stringify(r.data).includes("JVBER") && !("data" in (r.data.items?.[0] ?? {})));
  r = await call("GET", `${docs}?page=2&pageSize=9`);
  check("paginação no servidor: página 2 (tamanho 9) vazia, total 4", r.status === 200 && r.data.items.length === 0 && r.data.total === 4 && r.data.page === 2 && r.data.pageSize === 9, JSON.stringify([r.data.items?.length, r.data.total, r.data.page]));
  r = await call("GET", `${docs}?pageSize=3`);
  check("tamanho de página inválido volta para 9", r.status === 200 && r.data.pageSize === 9 && r.data.items.length === 4, JSON.stringify([r.data.pageSize, r.data.items?.length]));
  r = await call("GET", `${docs}?q=laudo`);
  check("busca por nome", r.data.total === 1 && r.data.items[0].id === laudo.id, r.data.total);

  // Download e visualização.
  r = await call("GET", `${docs}/${termo.id}/file?download=1`, null, { raw: true });
  check("download do documento: bytes iguais, attachment e cabeçalhos seguros", r.status === 200 && r.buffer.equals(pdf) && /attachment/.test(r.headers.get("content-disposition") ?? "") && safeHeaders(r.headers), `${r.status} ${r.headers.get("cache-control")}`);
  r = await call("GET", `${docs}/${laudo.id}/file`, null, { raw: true });
  check("visualização do documento: cabeçalhos seguros e sem attachment", r.status === 200 && r.buffer.equals(pdf) && safeHeaders(r.headers) && !/attachment/.test(r.headers.get("content-disposition") ?? ""), `${r.status} ${r.headers.get("content-disposition")}`);
  r = await call("GET", `${docs}/${receita.id}/file?thumb=1`, null, { raw: true });
  check("miniatura de imagem: 200, image/png, sem cache", r.status === 200 && r.headers.get("content-type") === "image/png" && safeHeaders(r.headers), `${r.status} ${r.headers.get("content-type")}`);

  // PATCH.
  r = await call("PATCH", `${docs}/${termo.id}`, { name: "Termo renomeado" });
  check("renomear documento", r.status === 200 && r.data.item.name === "Termo renomeado", r.status);
  r = await call("PATCH", `${docs}/${termo.id}`, { category: "DECLARACOES", signatureStatus: "PENDENTE" });
  check("recategorizar e mudar assinatura", r.status === 200 && r.data.item.category === "DECLARACOES" && r.data.item.signatureStatus === "PENDENTE", JSON.stringify(r.data.item));
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const journey = await api("POST", `/api/patients/${P}/journeys`, { name: `Tratamento arquivos ${run}`, professionalId: professional?.id });
  const journeyId = journey.data.journey?.id;
  check("tratamento criado para vincular documentos", journey.status < 300 && Boolean(journeyId), `${journey.status} ${JSON.stringify(journey.data).slice(0, 150)}`);
  r = await call("PATCH", `${docs}/${receita.id}`, { journeyId });
  check("vincular documento a tratamento", r.status === 200 && r.data.item.journeyId === journeyId, r.status);
  r = await call("GET", `${docs}?journeyId=${journeyId}`);
  check("filtro por tratamento vinculado", r.data.total === 1 && r.data.items[0].id === receita.id, r.data.total);
  r = await call("PATCH", `${docs}/${laudo.id}`, { archived: true, reason: "duplicado" });
  check("arquivar documento", r.status === 200 && r.data.item.archived === true, r.status);
  r = await call("GET", docs);
  check("arquivado some da lista padrão", r.data.total === 3 && !r.data.items.some((item) => item.id === laudo.id), r.data.total);
  r = await call("PATCH", `${docs}/${laudo.id}`, { name: "x" });
  check("documento arquivado não é editável (409)", r.status === 409, r.status);
  r = await call("PATCH", `${docs}/${laudo.id}`, { archived: false });
  check("desarquivar documento", r.status === 200 && r.data.item.archived === false, r.status);

  // Fotos: índice, upload e galeria.
  const evaluation = await api("PUT", `/api/patients/${P}/evaluation`, { photos: [{ name: "Aval frontal", imageUrl: dataUrl, width: 1, height: 1, category: "Frontal", annotations: [] }], assessment: { chiefComplaint: "Manchas" } });
  check("avaliação com foto criada", evaluation.status === 200, evaluation.status);
  r = await call("GET", photosPath);
  const text = JSON.stringify(r.data);
  const evalPhoto = (r.data.photos ?? []).find((photo) => photo.id.startsWith("evaluation:"));
  check("índice de fotos reúne a avaliação, sem base64", r.status === 200 && Boolean(evalPhoto) && !text.includes("base64") && !text.includes("iVBOR"), `${r.status} ${text.length}`);
  r = await call("POST", photosPath, form(png, "Frontal 1.png", "image/png", { width: 1, height: 1, phase: "ANTES", category: "Frontal" }));
  const galleryId = r.data.id;
  check("upload de foto nova", r.status === 201 && Boolean(galleryId), `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  r = await call("POST", photosPath, form(pdf, "doc.pdf", "application/pdf", { width: 1, height: 1 }));
  check("PDF não entra como foto (415)", r.status === 415, r.status);
  r = await call("POST", photosPath, form(png, "f.png", "image/png", { width: 99999, height: 1 }));
  check("dimensões inválidas da foto (400)", r.status === 400, r.status);
  r = await call("GET", photosPath);
  check("foto nova aparece no índice", r.data.photos.some((photo) => photo.id === `gallery:${galleryId}`));
  r = await call("GET", `${photosPath}/${ref(`gallery:${galleryId}`)}/image`, null, { raw: true });
  check("imagem da galeria: bytes iguais e cabeçalhos seguros", r.status === 200 && r.buffer.equals(png) && r.headers.get("content-type") === "image/png" && safeHeaders(r.headers), `${r.status} ${r.headers.get("cache-control")}`);
  r = await call("GET", `${photosPath}/${ref(evalPhoto?.id ?? "evaluation:x")}/image`, null, { raw: true });
  check("imagem da avaliação servida por referência", r.status === 200 && r.buffer.equals(png), r.status);
  r = await call("GET", `${photosPath}/session%3A%E0%A4%A/image`, null, { raw: true });
  check("referência malformada devolve 400 (imagem)", r.status === 400, r.status);
  r = await call("GET", `${photosPath}/session%3A%E0%A4%A`);
  check("referência malformada devolve 400 (detalhe)", r.status === 400, r.status);
  r = await call("PATCH", `${photosPath}/${ref(`gallery:${galleryId}`)}`, { name: "Frontal renomeada", category: "Sorriso", phase: "DEPOIS", journeyId });
  check("PATCH de foto da galeria", r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  r = await call("PATCH", `${photosPath}/${ref(evalPhoto?.id ?? "evaluation:x")}`, { name: "x" });
  check("foto de avaliação não é editável pela galeria (400)", r.status === 400, r.status);

  // Itens de sistema: anamnese concluída.
  const draft = (await api("POST", `/api/patients/${P}/anamnesis`, { from: "empty" })).data.draft;
  draft.content.complaint.chiefComplaint = "Manchas";
  await api("PUT", `/api/patients/${P}/anamnesis`, { draftId: draft.id, content: draft.content, expectedUpdatedAt: draft.updatedAt });
  const current = (await api("GET", `/api/patients/${P}/anamnesis`)).data;
  await api("POST", `/api/patients/${P}/anamnesis/${draft.id}`, { action: "complete", expectedUpdatedAt: (current.draft ?? draft).updatedAt });
  r = await call("GET", docs);
  const system = r.data.items.filter((item) => item.system);
  check("anamnese concluída aparece em Documentos para o ADMIN (somente leitura)", system.some((item) => item.kind === "anamnesis" && item.name === "Anamnese (v1)"), JSON.stringify(system).slice(0, 200));
  check("nenhum ClinicalDocument criado para itens de sistema", await prisma.clinicalDocument.count({ where: { patientId: P, name: { contains: "Anamnese" } } }) === 0);

  // Outra clínica e STAFF (removidos no finally).
  const otherEmail = `e2e-arq-outra-${run}@example.com`;
  const otherPassword = `E2e-${run}-Outra9!`;
  const otherClinic = `E2E Arquivos Externa ${run}`;
  const staffEmail = `e2e-arq-staff-${run}@example.com`;
  const staffPassword = `E2e-${run}-Staff9!`;
  let team = null;
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990020", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const o = await withSession(other.cookie, async () => ({
        list: await call("GET", docs), upload: await call("POST", docs, form(pdf, "a.pdf", "application/pdf", { category: "TERMOS" })),
        file: await call("GET", `${docs}/${termo.id}/file`, null, { raw: true }), patch: await call("PATCH", `${docs}/${termo.id}`, { name: "invasor" }),
        del: await call("DELETE", `${docs}/${termo.id}`, { confirm: true }),
        photos: await call("GET", photosPath), photoPost: await call("POST", photosPath, form(png, "a.png", "image/png", { width: 1, height: 1 })),
        image: await call("GET", `${photosPath}/${ref(`gallery:${galleryId}`)}/image`, null, { raw: true }),
        evalImage: await call("GET", `${photosPath}/${ref(evalPhoto?.id ?? "evaluation:x")}/image`, null, { raw: true }),
        photoPatch: await call("PATCH", `${photosPath}/${ref(`gallery:${galleryId}`)}`, { name: "x" }),
        photoDel: await call("DELETE", `${photosPath}/${ref(`gallery:${galleryId}`)}`, { confirm: true }),
      }));
      check("outra clínica recebe 404 em documentos e fotos", Object.values(o).every((item) => item.status === 404), statuses(o));
    } else {
      check("segunda clínica criada para testar isolamento de arquivos", false, `registro ${r.status} login ${other?.status}`);
    }

    r = await api("POST", "/api/team", { name: "E2E Atendente Arquivos", email: staffEmail, password: staffPassword, role: "STAFF" });
    team = r.status === 201 ? r.data.member : null;
    const staff = team ? await loginAs(staffEmail, staffPassword) : null;
    if (staff?.status === 200) {
      await withSession(staff.cookie, async () => {
        r = await call("POST", docs, form(pdf, "x.pdf", "application/pdf", { category: "EXAMES" }));
        check("STAFF não envia EXAMES (403)", r.status === 403, r.status);
        r = await call("POST", docs, form(pdf, "x.pdf", "application/pdf", { category: "OUTROS" }));
        check("STAFF não envia OUTROS (403)", r.status === 403, r.status);
        r = await call("POST", docs, form(pdf, "Orientações pós.pdf", "application/pdf", { category: "ORIENTACOES" }));
        const orient = r.data.item;
        check("STAFF envia ORIENTACOES", r.status === 201 && orient?.category === "ORIENTACOES", r.status);
        r = await call("POST", docs, form(png, "Declaração.png", "image/png", { category: "DECLARACOES" }));
        check("STAFF envia DECLARACOES", r.status === 201, r.status);
        r = await call("GET", docs);
        check("STAFF lista só categorias administrativas, sem EXAMES/RECEITAS e sem itens de sistema", r.status === 200 && r.data.items.length > 0 && r.data.items.every((item) => ["TERMOS", "DECLARACOES", "ORIENTACOES"].includes(item.category) && !item.system) && r.data.counts.EXAMES === undefined && r.data.counts.RECEITAS === undefined, JSON.stringify(r.data.counts));
        r = await call("GET", `${docs}?category=EXAMES`);
        check("STAFF com ?category=EXAMES não amplia o acesso", r.status === 200 && r.data.total === 0 && r.data.items.length === 0, `${r.status} ${r.data.total}`);
        r = await call("GET", `${docs}/${laudo.id}/file`, null, { raw: true });
        check("STAFF recebe 404 em arquivo de categoria oculta", r.status === 404, r.status);
        r = await call("PATCH", `${docs}/${laudo.id}`, { name: "x" });
        check("STAFF recebe 404 ao editar categoria oculta", r.status === 404, r.status);
        r = await call("PATCH", `${docs}/${orient.id}`, { category: "EXAMES" });
        check("STAFF não recategoriza para EXAMES (403)", r.status === 403, r.status);
        r = await call("DELETE", `${docs}/${orient.id}`, { confirm: true });
        check("STAFF não exclui documento (403)", r.status === 403, r.status);
        r = await call("POST", docs, form(pdf, "v.pdf", "application/pdf", { category: "TERMOS", encounterType: "session", encounterId: "qualquer" }));
        check("STAFF tentando vínculo de atendimento recebe 400", r.status === 400, r.status);
        r = await call("GET", photosPath);
        check("STAFF não vê fotos (403)", r.status === 403, r.status);
        r = await call("POST", photosPath, form(png, "f.png", "image/png", { width: 1, height: 1 }));
        check("STAFF não envia foto (403)", r.status === 403, r.status);
        r = await call("GET", `${photosPath}/${ref(`gallery:${galleryId}`)}/image`, null, { raw: true });
        check("STAFF não lê imagem de foto (403)", r.status === 403, r.status);
        r = await call("PATCH", `${photosPath}/${ref("gallery:nao-existe")}`, { name: "x" });
        check("STAFF em PATCH de foto inexistente recebe 403, não 404", r.status === 403, r.status);
      });
    } else {
      check("usuário STAFF criado para testar permissões de arquivos", false, `team ${r.status} login ${staff?.status}`);
    }
  } finally {
    if (team) await api("DELETE", "/api/team", { membershipId: team.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [otherEmail, staffEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [otherEmail, staffEmail] } } });
  }

  // Exclusão: só ADMIN, com confirmação, deixando trilha mínima.
  r = await call("DELETE", `${docs}/${laudo.id}`, {});
  check("exclusão sem confirm:true é recusada (400)", r.status === 400, r.status);
  check("bytes existem antes de excluir", await prisma.clinicalDocumentBlob.count({ where: { documentId: laudo.id } }) === 1);
  r = await call("DELETE", `${docs}/${laudo.id}`, { confirm: true, reason: "teste" });
  check("ADMIN exclui documento definitivamente", r.status === 200, r.status);
  check("exclusão apaga metadados e bytes", await prisma.clinicalDocument.count({ where: { id: laudo.id } }) === 0 && await prisma.clinicalDocumentBlob.count({ where: { documentId: laudo.id } }) === 0);
  const trail = await prisma.clinicalFileAudit.findFirst({ where: { fileId: laudo.id, action: "DELETE" } });
  check("trilha mínima da exclusão permanece", trail?.fileName === "Laudo facial" && trail.category === "EXAMES" && trail.note === "teste", JSON.stringify(trail));
  r = await call("GET", `${docs}/${laudo.id}/file`, null, { raw: true });
  check("documento excluído não abre (404)", r.status === 404, r.status);
  r = await call("DELETE", `${photosPath}/${ref(`gallery:${galleryId}`)}`, { confirm: true, reason: "teste" });
  check("ADMIN exclui foto da galeria", r.status === 200, r.status);
  check("foto excluída sem bytes e com trilha", await prisma.clinicalPhoto.count({ where: { id: galleryId } }) === 0 && await prisma.clinicalPhotoBlob.count({ where: { photoId: galleryId } }) === 0 && await prisma.clinicalFileAudit.count({ where: { fileId: galleryId, action: "DELETE" } }) === 1);
}

// Gate do termo de consentimento (Fase A): Rascunho -> Em execução exige termo ASSINADO, ativo e da mesma jornada.
async function consentGate() {
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const dataUrl = `data:image/png;base64,${pngB64}`;
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const upload = async (path, name, fields = {}) => {
    const body = new FormData();
    body.set("file", new Blob([pdf], { type: "application/pdf" }), name);
    for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: cookie ? { cookie } : {}, body, redirect: "manual" });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
    return { status: response.status, data };
  };
  let r = await api("GET", "/api/quotes/options");
  let procedure = r.data.procedures?.[0];
  if (!procedure) {
    await api("POST", "/api/procedures", { name: `E2E Botox ${run}`, category: "Facial", price: 900, durationMinutes: 30, margin: 30 });
    procedure = (await api("GET", "/api/quotes/options")).data.procedures?.[0];
  }
  const P = (await api("POST", "/api/patients", { name: `E2E Termo ${run}`, phone: "11999990040", age: 35, cpf: randomCpf() })).data.patient.id;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const mkJourney = async (name) => (await api("POST", `/api/patients/${P}/journeys`, { name, professionalId: professional?.id })).data.journey;
  const J1 = await mkJourney(`E2E Termo A ${run}`);
  const J2 = await mkJourney(`E2E Termo B ${run}`);
  const mkSession = async (journey) => {
    const ev = (await api("PUT", `/api/patients/${P}/evaluation`, { journeyId: journey.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
    const q = await api("POST", "/api/quotes", { patientId: P, journeyId: journey.id, evaluationId: ev.id, details: [{ procedureId: procedure.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" });
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote.id}`, { status, evaluationId: ev.id });
    const s = await api("POST", `/api/patients/${P}/procedure-sessions`, { journeyId: journey.id, quoteId: q.data.quote.id, procedureId: procedure.id });
    return { id: s.data.session?.id, quoteId: q.data.quote.id, journeyId: journey.id, status: s.status };
  };
  const S1 = await mkSession(J1);
  const S2 = await mkSession(J2);
  check("sessões de teste do gate criadas", S1.status === 201 && S2.status === 201, `${S1.status}/${S2.status}`);
  const dup = await api("POST", `/api/patients/${P}/procedure-sessions`, { journeyId: S1.journeyId, quoteId: S1.quoteId });
  check("POST de sessão é idempotente: reaproveita o rascunho do orçamento (sessão única)", dup.status === 200 && dup.data.reused === true && dup.data.session?.id === S1.id, `${dup.status} ${dup.data?.session?.id}`);
  const sPath = (s) => `/api/patients/${P}/procedure-sessions/${s.id}`;
  // Agendamento "Procedimento - X" ativo na jornada J1: só muda quando o início é efetivado.
  const futureDay = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const apptRes = await api("POST", "/api/appointments", { patientId: P, journeyId: J1.id, procedure: `Procedimento - ${procedure.name}`, professional: "E2E Prof", date: futureDay, time: "10:00", notes: "" });
  const apptId = apptRes.data?.appointment?.id;
  const start = (s, extra = {}) => api("PATCH", sPath(s), { status: "Em execução", technique: "E2E técnica", treatedAreas: "E2E região", photos: [{ id: `ph-${run}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 }], ...extra });
  const summary = async (s) => (await api("GET", `/api/patients/${P}/procedure-sessions?journeyId=${s.journeyId}&quoteId=${s.quoteId}`)).data;
  const docs = `/api/patients/${P}/documents`;
  const blocked = (res) => res.status === 409 && res.data?.code === "CONSENT_REQUIRED";

  // GET: contagens e nome da clínica.
  let g = await summary(S1);
  check("GET sessões sem termo: consent vazio com mensagem e clinicName", g.consent?.signed === false && g.consent.signedCount === 0 && g.consent.pendingCount === 0 && /termo de consentimento/i.test(g.consent.message) && g.clinicName === testClinicName, JSON.stringify([g.consent, g.clinicName]));
  r = await start(S1);
  check("iniciar sem termo => 409 CONSENT_REQUIRED", blocked(r), `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  r = await api("PATCH", sPath(S1), { technique: "Técnica X" });
  check("editar campos da sessão sem termo não é bloqueado", r.status === 200, r.status);
  r = await api("PATCH", sPath(S1), { status: "Concluída" });
  check("concluir sessão em rascunho segue recusada pela regra antiga, não pelo termo", r.status === 409 && r.data?.code !== "CONSENT_REQUIRED", `${r.status} ${r.data?.code}`);

  // Pendente não libera.
  r = await upload(docs, "Termo pendente.pdf", { category: "TERMOS", signatureStatus: "PENDENTE", journeyId: J1.id });
  const pend = r.data.item;
  check("upload de termo pendente na jornada", r.status === 201 && pend?.signatureStatus === "PENDENTE" && pend.journeyId === J1.id, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  g = await summary(S1);
  check("GET com termo pendente: signed=false, pendingCount=1, mensagem de pendente", g.consent?.signed === false && g.consent.pendingCount === 1 && g.consent.signedCount === 0 && /não assinado/.test(g.consent.message), JSON.stringify(g.consent));
  r = await start(S1);
  check("iniciar com termo pendente => 409 CONSENT_REQUIRED", blocked(r), `${r.status} ${r.data?.code}`);

  // Termo assinado em OUTRA jornada, sem jornada ou de outra categoria não libera.
  r = await upload(docs, "Termo outra jornada.pdf", { category: "TERMOS", signatureStatus: "ASSINADO", journeyId: J2.id });
  const other = r.data.item;
  await upload(docs, "Termo sem jornada.pdf", { category: "TERMOS", signatureStatus: "ASSINADO" });
  await upload(docs, "Laudo assinado.pdf", { category: "EXAMES", signatureStatus: "ASSINADO", journeyId: J1.id });
  g = await summary(S1);
  check("termo assinado de outra jornada, sem jornada ou de outra categoria não conta", g.consent?.signedCount === 0 && g.consent.pendingCount === 1, JSON.stringify(g.consent));
  r = await start(S1);
  check("iniciar com termo de outra jornada => 409", blocked(r), `${r.status} ${r.data?.code}`);

  // Assinado libera; arquivado volta a bloquear.
  r = await api("PATCH", `${docs}/${pend.id}`, { signatureStatus: "ASSINADO" });
  check("ADMIN marca o termo como assinado", r.status === 200 && r.data.item?.signatureStatus === "ASSINADO", r.status);
  g = await summary(S1);
  check("GET com termo assinado: signed=true, mensagem vazia", g.consent?.signed === true && g.consent.signedCount === 1 && g.consent.pendingCount === 0 && g.consent.message === "", JSON.stringify(g.consent));
  r = await api("PATCH", `${docs}/${pend.id}`, { archived: true, reason: "teste" });
  check("ADMIN arquiva o termo", r.status === 200, r.status);
  r = await start(S1);
  check("iniciar com termo arquivado => 409", blocked(r), `${r.status} ${r.data?.code}`);
  await api("PATCH", `${docs}/${pend.id}`, { archived: false });
  r = await start(S1, { technique: "" });
  check("iniciar sem técnica (obrigatória) => 400", r.status === 400, r.status);
  r = await start(S1, { treatedAreas: " " });
  check("iniciar sem região tratada (obrigatória) => 400", r.status === 400, r.status);
  const stillScheduled = (await summary(S1)).scheduledProcedure;
  check("início recusado (409/400) NÃO altera o agendamento do procedimento", apptRes.status === 201 && stillScheduled?.id === apptId && stillScheduled.date === futureDay && stillScheduled.time === "10:00", JSON.stringify([apptRes.status, stillScheduled]));
  r = await start(S1);
  check("iniciar com termo assinado => 200 Em execução", r.status === 200 && r.data.session?.status === "Em execução", `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  const nowSp = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date());
  const movedSummary = (await summary(S1)).scheduledProcedure;
  const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  check("iniciar com agendamento ativo move o horário para agora (hoje, hora atual)", movedSummary?.id === apptId && movedSummary.date === nowSp.slice(0, 10) && Math.abs(minutesOf(movedSummary.time) - minutesOf(nowSp.slice(11, 16))) <= 2, JSON.stringify([movedSummary, nowSp]));
  check("auditoria da sessão registra a alteração do agendamento", Boolean(r.data.session?.auditLog?.some((entry) => /Agendamento alterado/.test(entry.action))), JSON.stringify(r.data.session?.auditLog));
  const downgraded = await api("PATCH", `${docs}/${pend.id}`, { signatureStatus: "PENDENTE" });
  r = await api("PATCH", sPath(S1), { technique: "Técnica Z" });
  check("sessão já iniciada continua editável mesmo com o termo rebaixado", downgraded.status === 200 && r.status === 200, `${downgraded.status}/${r.status}`);
  await api("PATCH", `${docs}/${other.id}`, { archived: true, reason: "teste" });
  r = await start(S2);
  check("sessão da jornada B segue bloqueada (termo assinado da A não vale)", blocked(r), `${r.status} ${r.data?.code}`);
  await api("PATCH", `${docs}/${other.id}`, { archived: false });

  // Clique duplo.
  await api("PATCH", `${docs}/${other.id}`, { signatureStatus: "PENDENTE" });
  const [d1, d2] = await Promise.all([start(S2), start(S2)]);
  check("início duplo sem termo assinado: as duas recusadas", blocked(d1) && blocked(d2), `${d1.status}/${d2.status}`);
  await api("PATCH", `${docs}/${other.id}`, { signatureStatus: "ASSINADO" });
  const [e1, e2] = await Promise.all([start(S2), start(S2)]);
  const after = (await summary(S2)).sessions?.find((s) => s.id === S2.id);
  check("início duplo com termo assinado: sem 500 e sessão em execução", e1.status < 500 && e2.status < 500 && [e1, e2].some((x) => x.status === 200) && after?.status === "Em execução", `${e1.status}/${e2.status} ${after?.status}`);

  // Papéis: STAFF e PROFESSIONAL.
  const mk = async (roleName, tag) => {
    const login = `e2e-termo-${tag}-${run}@example.com`;
    const secret = `E2e-${run}-${tag}9!`;
    const created = await api("POST", "/api/team", { name: `E2E ${roleName} Termo`, email: login, password: secret, role: roleName });
    const session = created.status === 201 ? await loginAs(login, secret) : null;
    return { login, member: created.data.member, session, status: created.status };
  };
  const staff = await mk("STAFF", "staff");
  const prof = await mk("PROFESSIONAL", "prof");
  try {
    if (staff.session?.status === 200) {
      await withSession(staff.session.cookie, async () => {
        let s = await upload(docs, "Staff assinado.pdf", { category: "TERMOS", signatureStatus: "ASSINADO", journeyId: J1.id });
        check("STAFF não cria TERMOS já ASSINADO (403)", s.status === 403, s.status);
        s = await upload(docs, "Staff pendente.pdf", { category: "TERMOS", signatureStatus: "PENDENTE", journeyId: J1.id });
        const own = s.data.item;
        check("STAFF cria TERMOS pendente", s.status === 201, s.status);
        s = await api("PATCH", `${docs}/${own?.id}`, { signatureStatus: "ASSINADO" });
        check("STAFF não marca TERMOS como ASSINADO (403)", s.status === 403, s.status);
        s = await api("PATCH", `${docs}/${own?.id}`, { category: "DECLARACOES" });
        check("STAFF recategoriza termo pendente (a trava só protege assinados)", s.status === 200, s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { signatureStatus: "PENDENTE" });
        check("STAFF não rebaixa termo ASSINADO (403)", s.status === 403, s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { category: "DECLARACOES" });
        check("STAFF não recategoriza termo ASSINADO (403)", s.status === 403, s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { journeyId: J1.id });
        check("STAFF não muda jornada de termo ASSINADO (403)", s.status === 403, s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { journeyId: null });
        check("STAFF não remove jornada de termo ASSINADO (403)", s.status === 403, s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { name: `E2E Renomeado ${run}` });
        check("STAFF renomeia termo ASSINADO", s.status === 200 && s.data.item?.name === `E2E Renomeado ${run}` && s.data.item.signatureStatus === "ASSINADO", `${s.status} ${s.data.item?.name}`);
        const still = await prisma.clinicalDocument.findUnique({ where: { id: other.id }, select: { signatureStatus: true, category: true, journeyId: true } });
        check("termo ASSINADO manteve status, categoria e jornada após as tentativas do STAFF", still.signatureStatus === "ASSINADO" && still.category === "TERMOS" && still.journeyId === J2.id, JSON.stringify(still));
        s = await api("PATCH", sPath(S2), { technique: "x" });
        check("STAFF não altera sessão (403)", s.status === 403, s.status);
      });
    } else check("usuário STAFF do gate criado", false, `team ${staff.status} login ${staff.session?.status}`);
    if (prof.session?.status === 200) {
      await withSession(prof.session.cookie, async () => {
        let s = await upload(docs, "Prof assinado.pdf", { category: "TERMOS", signatureStatus: "ASSINADO", journeyId: J1.id });
        check("PROFESSIONAL cria TERMOS ASSINADO", s.status === 201 && s.data.item?.signatureStatus === "ASSINADO", s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { signatureStatus: "PENDENTE" });
        check("PROFESSIONAL rebaixa termo ASSINADO", s.status === 200 && s.data.item?.signatureStatus === "PENDENTE", s.status);
        s = await api("PATCH", `${docs}/${other.id}`, { signatureStatus: "ASSINADO", journeyId: J1.id });
        check("PROFESSIONAL reassina e muda a jornada do termo", s.status === 200 && s.data.item?.journeyId === J1.id, s.status);
      });
    } else check("usuário PROFESSIONAL do gate criado", false, `team ${prof.status} login ${prof.session?.status}`);
  } finally {
    for (const m of [staff, prof]) if (m.member) await api("DELETE", "/api/team", { membershipId: m.member.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [staff.login, prof.login] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [staff.login, prof.login] } } });
  }
}

async function sessionPerQuote() {
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const dataUrl = `data:image/png;base64,${pngB64}`;
  const nameA = `E2E Sessao A ${run}`;
  const nameB = `E2E Sessao B ${run}`;
  const nameC = `E2E Sessao C ${run}`;
  const mkProc = async (name, durationMinutes) => {
    await api("POST", "/api/procedures", { name, category: "Facial", price: 500, durationMinutes, margin: 30 });
    return (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === name);
  };
  const pa = await mkProc(nameA, 20);
  const pb = await mkProc(nameB, 45);
  const pc = await mkProc(nameC, 10);
  check("sessão única: procedimentos criados", pa && pb && pc, JSON.stringify([pa?.id, pb?.id, pc?.id]));
  if (!pa || !pb || !pc) return;
  const P = (await api("POST", "/api/patients", { name: `E2E Sessao Unica ${run}`, phone: "11999990050", age: 35, cpf: randomCpf() })).data.patient.id;
  const P2 = (await api("POST", "/api/patients", { name: `E2E Sessao Outro ${run}`, phone: "11999990051", age: 35, cpf: randomCpf() })).data.patient.id;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const J = (await api("POST", `/api/patients/${P}/journeys`, { name: `E2E Sessao J ${run}`, professionalId: professional?.id })).data.journey;
  const ev = (await api("PUT", `/api/patients/${P}/evaluation`, { journeyId: J.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
  const mkQuote = async (details, approve) => {
    const q = await api("POST", "/api/quotes", { patientId: P, journeyId: J.id, evaluationId: ev.id, details, paymentMethod: "Pix", installments: 1, notes: "" });
    if (approve) for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote.id}`, { status, evaluationId: ev.id });
    return q.data.quote?.id;
  };
  const Q = await mkQuote([{ procedureId: pa.id, quantity: 2, discountCents: 0 }, { procedureId: pb.id, quantity: 1, discountCents: 0 }], true);
  const Qother = await mkQuote([{ procedureId: pc.id, quantity: 1, discountCents: 0 }], true);
  const Qdraft = await mkQuote([{ procedureId: pa.id, quantity: 1, discountCents: 0 }], false);
  const url = `/api/patients/${P}/procedure-sessions`;
  const count = (quoteId) => prisma.patientProcedureSession.count({ where: { patientId: P, quoteId } });

  let r = await api("POST", url, { journeyId: J.id, quoteId: Qdraft });
  check("sessão única: orçamento não aprovado é recusado (409) e nada é gravado", r.status === 409 && await count(Qdraft) === 0, `${r.status} ${await count(Qdraft)}`);
  r = await api("POST", url, { journeyId: J.id });
  check("sessão única: sem quoteId => 400", r.status === 400, r.status);
  r = await api("POST", url, { journeyId: J.id, quoteId: "inexistente" });
  check("sessão única: orçamento inexistente => 404", r.status === 404, r.status);
  r = await api("POST", "/api/patients/inexistente/procedure-sessions", { journeyId: J.id, quoteId: Q });
  check("sessão única: paciente inexistente/de outra clínica => 404 sem vazar dados", r.status === 404 && !JSON.stringify(r.data).includes(nameA), `${r.status}`);
  r = await api("POST", `/api/patients/${P2}/procedure-sessions`, { journeyId: J.id, quoteId: Q });
  check("sessão única: orçamento de outro paciente => 404 e nada gravado", r.status === 404 && await prisma.patientProcedureSession.count({ where: { patientId: P2 } }) === 0, r.status);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q, procedureId: pc.id });
  check("sessão única: procedureId fora do orçamento => 400 e nada gravado", r.status === 400 && await count(Q) === 0, `${r.status} ${await count(Q)}`);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q, performedAt: "não é data" });
  check("sessão única: data inválida => 400", r.status === 400 && await count(Q) === 0, r.status);

  const [d1, d2] = await Promise.all([api("POST", url, { journeyId: J.id, quoteId: Q }), api("POST", url, { journeyId: J.id, quoteId: Q })]);
  const codes = [d1.status, d2.status].sort();
  check("sessão única: POST duplo simultâneo => 201 + 200, mesmo id, 1 sessão no banco", codes[0] === 200 && codes[1] === 201 && d1.data.session?.id === d2.data.session?.id && await count(Q) === 1, `${d1.status}/${d2.status} n=${await count(Q)}`);
  const created = [d1, d2].find((x) => x.status === 201);
  if (!created) return;
  const S = created.data.session;
  const combined = `${nameA} + ${nameB}`;
  check("sessão única: nome combinado, minutos somados (20x2+45=85), status Rascunho", S.procedureName === combined && S.estimatedMinutes === 85 && S.status === "Rascunho", JSON.stringify([S.procedureName, S.estimatedMinutes, S.status]));
  check("sessão única: reused:true só no POST que reaproveitou", [d1, d2].find((x) => x.status === 200)?.data.reused === true && created.data.reused === false);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q });
  check("sessão única: novo POST devolve 200, reused:true e o mesmo id", r.status === 200 && r.data.reused === true && r.data.session?.id === S.id, `${r.status} ${r.data.session?.id}`);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q, procedureId: pb.id });
  check("sessão única: procedureId do orçamento é aceito e reaproveita a sessão", r.status === 200 && r.data.session?.id === S.id && await count(Q) === 1, `${r.status} n=${await count(Q)}`);
  const parents = await prisma.patientProcedure.count({ where: { quoteId: Q } });
  check("sessão única: um único registro de procedimento por orçamento", parents === 1, parents);
  const list = (await api("GET", `${url}?journeyId=${J.id}&quoteId=${Q}`)).data;
  check("sessão única: GET devolve exatamente 1 sessão com nome combinado", list.sessions?.length === 1 && list.sessions[0].procedureName === combined, JSON.stringify(list.sessions?.map((x) => x.procedureName)));

  const sPath = `${url}/${S.id}`;
  r = await api("PATCH", sPath, { procedureName: "Nome arbitrário qualquer" });
  check("sessão única: PATCH com nome arbitrário => 400", r.status === 400, r.status);
  r = await api("PATCH", sPath, { procedureName: nameC });
  check("sessão única: PATCH com procedimento de outro orçamento => 400", r.status === 400, r.status);
  r = await api("PATCH", sPath, { procedureName: nameA });
  check("sessão única: PATCH com um item do orçamento => 200", r.status === 200 && r.data.session?.procedureName === nameA, `${r.status} ${r.data.session?.procedureName}`);
  r = await api("PATCH", sPath, { procedureName: combined });
  check("sessão única: PATCH com o nome combinado => 200", r.status === 200 && r.data.session?.procedureName === combined, `${r.status} ${r.data.session?.procedureName}`);
  r = await api("PATCH", sPath, { procedureName: "x".repeat(200) });
  check("sessão única: PATCH com nome de 200 caracteres => 400", r.status === 400, r.status);

  const start = (extra = {}) => api("PATCH", sPath, { status: "Em execução", technique: "E2E técnica", treatedAreas: "E2E região", photos: [{ id: `ph-${run}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 }], ...extra });
  r = await start();
  check("sessão única: iniciar sem termo assinado => 409 CONSENT_REQUIRED", r.status === 409 && r.data?.code === "CONSENT_REQUIRED", `${r.status} ${r.data?.code}`);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const form = new FormData();
  form.set("file", new Blob([pdf], { type: "application/pdf" }), "Termo sessao.pdf");
  form.set("category", "TERMOS"); form.set("signatureStatus", "ASSINADO"); form.set("journeyId", J.id);
  const up = await fetch(`${baseUrl}/api/patients/${P}/documents`, { method: "POST", headers: { cookie }, body: form });
  check("sessão única: termo assinado enviado", up.status === 201, up.status);
  r = await start({ technique: "" });
  check("sessão única: iniciar sem técnica => 400", r.status === 400, r.status);
  r = await start({ treatedAreas: "" });
  check("sessão única: iniciar sem região => 400", r.status === 400, r.status);
  r = await start({ photos: [] });
  check("sessão única: iniciar sem foto de antes => 400", r.status === 400, r.status);
  r = await start();
  check("sessão única: iniciar completo com termo => 200 Em execução", r.status === 200 && r.data.session?.status === "Em execução", `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q });
  check("sessão única: POST com sessão em execução reaproveita (200, mesmo id)", r.status === 200 && r.data.session?.id === S.id && await count(Q) === 1, `${r.status} n=${await count(Q)}`);

  await prisma.patientProcedureSession.update({ where: { id: S.id }, data: { status: "Concluída" } });
  const [n1, n2] = await Promise.all([api("POST", url, { journeyId: J.id, quoteId: Q }), api("POST", url, { journeyId: J.id, quoteId: Q })]);
  const newer = [n1, n2].find((x) => x.status === 201);
  check("sessão única: com a anterior concluída, POST duplo cria só 1 nova (201+200)", [n1.status, n2.status].sort().join() === "200,201" && newer?.data.session.id !== S.id && n1.data.session?.id === n2.data.session?.id && await count(Q) === 2, `${n1.status}/${n2.status} n=${await count(Q)}`);
  check("sessão única: a nova também traz nome combinado e 85 minutos", newer?.data.session.procedureName === combined && newer.data.session.estimatedMinutes === 85, JSON.stringify([newer?.data.session.procedureName, newer?.data.session.estimatedMinutes]));
  r = await api("POST", url, { journeyId: J.id, quoteId: Qother });
  check("sessão única: outro orçamento aprovado tem a própria sessão (nome simples, 10 min)", r.status === 201 && r.data.session?.procedureName === nameC && r.data.session.estimatedMinutes === 10 && r.data.session.id !== S.id, `${r.status} ${r.data.session?.procedureName} ${r.data.session?.estimatedMinutes}`);
}

// Mudar o status de um orçamento com sessão nunca apaga a sessão (o procedimento pai some em cascata com ela).
async function quoteStatusKeepsSessions() {
  const name = `E2E Status Orc ${run}`;
  const created = await api("POST", "/api/procedures", { name, category: "Facial", price: 300, durationMinutes: 15, margin: 30 });
  const proc = (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === name);
  if (!proc) { check("status do orçamento: procedimento de teste criado", false, `${created.status} ${JSON.stringify(created.data).slice(0, 150)}`); return; }
  const P = (await api("POST", "/api/patients", { name: `E2E Status Orc ${run}`, phone: "11999990060", age: 35, cpf: randomCpf() })).data.patient?.id;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const J = (await api("POST", `/api/patients/${P}/journeys`, { name: `E2E Status J ${run}`, professionalId: professional?.id })).data.journey;
  const ev = (await api("PUT", `/api/patients/${P}/evaluation`, { journeyId: J?.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
  const Q = (await api("POST", "/api/quotes", { patientId: P, journeyId: J?.id, evaluationId: ev?.id, details: [{ procedureId: proc?.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" })).data.quote?.id;
  for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${Q}`, { status, evaluationId: ev?.id });
  const S = (await api("POST", `/api/patients/${P}/procedure-sessions`, { journeyId: J?.id, quoteId: Q })).data.session?.id;
  const sessions = () => prisma.patientProcedureSession.count({ where: { id: S ?? "" } });
  check("status do orçamento: sessão criada no orçamento aprovado", Boolean(S) && await sessions() === 1, JSON.stringify({ proc: proc?.id, journey: J?.id, ev: ev?.id, Q, S }));
  let r = await api("PATCH", `/api/quotes/${Q}`, { status: "Pago", evaluationId: ev?.id });
  check("status do orçamento: pagar depois de criar a sessão mantém a sessão", r.status === 200 && await sessions() === 1, `${r.status} n=${await sessions()}`);
  for (const status of ["Enviado", "Pendente", "Cancelado"]) {
    r = await api("PATCH", `/api/quotes/${Q}`, { status });
    const stored = (await prisma.quote.findUnique({ where: { id: Q ?? "" }, select: { status: true } }))?.status;
    check(`status do orçamento: com sessão, voltar para ${status} é recusado (409) e nada muda`, r.status === 409 && stored === "Pago" && await sessions() === 1, `${r.status} ${stored} n=${await sessions()}`);
  }
  r = await api("PATCH", `/api/quotes/${Q}`, { status: "Aprovado" });
  check("status do orçamento: com sessão, alternar entre Pago e Aprovado continua permitido", r.status === 200 && await sessions() === 1, `${r.status} n=${await sessions()}`);

  // Orçamento sem avaliação e sem sessão: desfazer a aprovação continua removendo o procedimento gerado.
  const plain = (await api("POST", "/api/quotes", { patientId: P, journeyId: J?.id, items: "Avulso (1x)", total: 50 })).data.quote?.id;
  await api("PATCH", `/api/quotes/${plain}`, { status: "Aprovado" });
  const generated = () => prisma.patientProcedure.count({ where: { quoteId: plain ?? "" } });
  const afterApprove = await generated();
  await api("PATCH", `/api/quotes/${plain}`, { status: "Pendente" });
  check("status do orçamento: sem sessão, desfazer a aprovação remove o procedimento gerado", afterApprove === 1 && await generated() === 0, `${afterApprove} → ${await generated()}`);
}

async function scheduledProcedure() {
  const name = `E2E Agendado ${run}`;
  await api("POST", "/api/procedures", { name, category: "Facial", price: 300, durationMinutes: 30, margin: 30 });
  const proc = (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === name);
  check("agenda do procedimento: procedimento criado", Boolean(proc), proc?.id);
  if (!proc) return;
  const P = (await api("POST", "/api/patients", { name: `E2E Agenda Proc ${run}`, phone: "11999990060", age: 35, cpf: randomCpf() })).data.patient.id;
  const P2 = (await api("POST", "/api/patients", { name: `E2E Agenda Outro ${run}`, phone: "11999990061", age: 35, cpf: randomCpf() })).data.patient.id;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const mkJourney = async (patientId, label) => {
    const j = (await api("POST", `/api/patients/${patientId}/journeys`, { name: `E2E ${label} ${run}`, professionalId: professional?.id })).data.journey;
    const ev = (await api("PUT", `/api/patients/${patientId}/evaluation`, { journeyId: j.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
    const q = await api("POST", "/api/quotes", { patientId, journeyId: j.id, evaluationId: ev.id, details: [{ procedureId: proc.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" });
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote.id}`, { status, evaluationId: ev.id });
    return { id: j.id, quoteId: q.data.quote.id };
  };
  const J1 = await mkJourney(P, "Agenda J1");
  const J2 = await mkJourney(P, "Agenda J2");
  const JO = await mkJourney(P2, "Agenda Outro");
  const sessUrl = `/api/patients/${P}/procedure-sessions`;
  const getSessions = (j = J1) => api("GET", `${sessUrl}?journeyId=${j.id}&quoteId=${j.quoteId}`);
  const procName = `Procedimento - ${name}`;
  const returnName = `Retorno - ${name}`;
  const body = (extra = {}) => ({ patientId: P, journeyId: J1.id, procedure: procName, professional: `Prof ${P}`, time: "10:00", date: day(2), ...extra });
  const activeCount = (journeyId, procedure) => prisma.appointment.count({ where: { patientId: P, journeyId, procedure, status: { in: ["Agendado", "Em atendimento"] } } });

  let r = await getSessions();
  check("agenda do procedimento: sem agendamento => scheduledProcedure null", r.status === 200 && r.data.scheduledProcedure === null, `${r.status} ${JSON.stringify(r.data.scheduledProcedure)}`);
  const sess = (await api("POST", sessUrl, { journeyId: J1.id, quoteId: J1.quoteId })).data.session;

  r = await api("POST", "/api/appointments", body({ date: day(-1) }));
  check("agenda do procedimento: data passada => 400", r.status === 400, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", body({ time: "99:99" }));
  check("agenda do procedimento: horário inválido => 400", r.status === 400, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", body({ time: "03:00" }));
  check("agenda do procedimento: horário fora do expediente => 400", r.status === 400, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", body({ date: "não é data" }));
  check("agenda do procedimento: data inválida => 400", r.status === 400, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", body({ journeyId: JO.id }));
  check("agenda do procedimento: jornada de outro paciente => 404 e nada gravado", r.status === 404 && await prisma.appointment.count({ where: { journeyId: JO.id } }) === 0, `${r.status}`);
  r = await api("POST", "/api/appointments", body({ patientId: "inexistente" }));
  check("agenda do procedimento: paciente inexistente/de outra clínica => 404", r.status === 404, r.status);
  check("agenda do procedimento: recusas não gravaram nada", await prisma.appointment.count({ where: { patientId: P } }) === 0);

  const [a, b] = await Promise.all([api("POST", "/api/appointments", body()), api("POST", "/api/appointments", body())]);
  const created = [a, b].find((x) => x.status === 201);
  check("agenda do procedimento: POST duplo simultâneo => 1x 201 e 1x 409, 1 agendamento no banco", [a.status, b.status].sort().join() === "201,409" && await activeCount(J1.id, procName) === 1, `${a.status}/${b.status} n=${await activeCount(J1.id, procName)}`);
  if (!created) return;
  const first = created.data.appointment;
  // Se a corrida criou duplicata (bug reportado acima), cancela a sobra para os próximos passos continuarem isolados.
  for (const extra of [a, b].filter((x) => x.status === 201 && x !== created)) await api("PATCH", `/api/appointments/${extra.data.appointment.id}`, { status: "Cancelado" });
  check("agenda do procedimento: criado como Agendado, dia gravado", first.status === "Agendado" && first.date === `${day(2)}T15:00:00.000Z` && first.journeyId === J1.id, JSON.stringify([first.status, first.date]));
  r = await api("POST", "/api/appointments", body({ time: "14:00", date: day(3) }));
  check("agenda do procedimento: mesmo procedimento/jornada ainda Agendado => 409 mesmo em outro horário", r.status === 409, r.status);

  r = await api("POST", "/api/appointments", body({ procedure: returnName, time: "11:00" }));
  check("agenda do procedimento: 'Retorno - nome' é independente (201)", r.status === 201, `${r.status} ${r.data.message}`);
  const ret1 = r.data.appointment;
  r = await api("POST", "/api/appointments", body({ procedure: returnName, time: "12:00" }));
  check("agenda do procedimento: segundo 'Retorno - nome' continua permitido (201)", r.status === 201, r.status);
  r = await api("POST", "/api/appointments", body({ journeyId: J2.id, time: "13:00" }));
  check("agenda do procedimento: mesmo nome em outra jornada do mesmo paciente => 201", r.status === 201, `${r.status} ${r.data.message}`);
  const otherJourneyAppt = r.data.appointment;
  r = await api("POST", "/api/appointments", { patientId: P2, journeyId: JO.id, procedure: procName, professional: `Prof ${P2}`, time: "10:00", date: day(2) });
  check("agenda do procedimento: mesmo nome em outro paciente => 201", r.status === 201, `${r.status} ${r.data.message}`);
  const otherPatientAppt = r.data.appointment;

  r = await getSessions();
  const sp = r.data.scheduledProcedure;
  check("agenda do procedimento: GET devolve scheduledProcedure com os campos esperados", r.status === 200 && sp?.id === first.id && sp.date === day(2) && sp.time === "10:00" && sp.procedure === procName && sp.professional === `Prof ${P}` && sp.status === "Agendado" && !("notes" in sp), JSON.stringify(sp));
  check("agenda do procedimento: só 6 campos (sem notes, sem paciente)", sp && Object.keys(sp).sort().join() === "date,id,procedure,professional,status,time", Object.keys(sp ?? {}).join());
  check("agenda do procedimento: não devolve retorno nem agendamento de outra jornada/paciente", ![ret1.id, otherJourneyAppt.id, otherPatientAppt.id].includes(sp?.id) && !JSON.stringify(r.data).includes(otherPatientAppt.id) && !JSON.stringify(r.data).includes(otherJourneyAppt.id));
  const s1 = r.data.sessions?.find((x) => x.id === sess?.id);
  check("agenda do procedimento: sessão continua Rascunho (não iniciou)", s1?.status === "Rascunho" && r.data.sessions.length === 1, `${s1?.status} n=${r.data.sessions?.length}`);
  r = await api("GET", `${sessUrl}?journeyId=${J2.id}&quoteId=${J2.quoteId}`);
  check("agenda do procedimento: GET da outra jornada traz só o agendamento dela", r.data.scheduledProcedure?.id === otherJourneyAppt.id, r.data.scheduledProcedure?.id);
  r = await api("GET", `/api/patients/${P2}/procedure-sessions?journeyId=${J1.id}&quoteId=${J1.quoteId}`);
  check("agenda do procedimento: GET com jornada de outro paciente => 404 sem vazar", r.status === 404 && !JSON.stringify(r.data).includes(first.id), r.status);
  r = await api("GET", `/api/patients/inexistente/procedure-sessions?journeyId=${J1.id}&quoteId=${J1.quoteId}`);
  check("agenda do procedimento: GET paciente inexistente/de outra clínica => 404", r.status === 404, r.status);

  r = await api("PATCH", `/api/appointments/${first.id}`, { status: "Cancelado" });
  check("agenda do procedimento: cancelar o agendamento", r.status === 200 && r.data.appointment?.status === "Cancelado", `${r.status}`);
  r = await getSessions();
  check("agenda do procedimento: após cancelar, scheduledProcedure volta a null", r.data.scheduledProcedure === null, JSON.stringify(r.data.scheduledProcedure));
  r = await api("POST", "/api/appointments", body({ time: "15:00" }));
  check("agenda do procedimento: após cancelar, novo agendamento => 201", r.status === 201, `${r.status} ${r.data.message}`);
  r = await getSessions();
  check("agenda do procedimento: GET devolve o novo agendamento (não o cancelado)", r.data.scheduledProcedure?.time === "15:00" && r.data.scheduledProcedure?.id !== first.id, JSON.stringify(r.data.scheduledProcedure));
  check("agenda do procedimento: sessão segue Rascunho", (await prisma.patientProcedureSession.findUnique({ where: { id: sess.id }, select: { status: true } }))?.status === "Rascunho");

  // Duplicata também vale para o nome puro e a variante prefixada; Retorno/Avaliação ficam de fora.
  r = await api("POST", "/api/appointments", body({ procedure: name, time: "16:00" }));
  check("agenda do procedimento: nome puro com 'Procedimento - X' ativo => 409", r.status === 409, r.status);
  r = await api("POST", "/api/appointments", body({ procedure: `Avaliação ${name}`, time: "16:00" }));
  check("agenda do procedimento: 'Avaliação…' não é tratada como duplicata (201)", r.status === 201, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", { patientId: P2, journeyId: JO.id, procedure: name, professional: `Prof ${P2}`, time: "11:00", date: day(2) });
  check("agenda do procedimento: nome puro vs prefixada já ativa em outra jornada/paciente => 409", r.status === 409, r.status);
  const J3 = await mkJourney(P, "Agenda J3");
  r = await api("POST", "/api/appointments", body({ journeyId: J3.id, procedure: name }));
  check("agenda do procedimento: nome puro na jornada nova => 201", r.status === 201, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", body({ journeyId: J3.id }));
  check("agenda do procedimento: 'Procedimento - X' com nome puro ativo => 409", r.status === 409, r.status);
  const J4 = await mkJourney(P, "Agenda J4");
  const [c1, c2] = await Promise.all([api("POST", "/api/appointments", body({ journeyId: J4.id, procedure: name, time: "08:00" })), api("POST", "/api/appointments", body({ journeyId: J4.id, time: "08:00" }))]);
  check("agenda do procedimento: nome puro e prefixado simultâneos => 1x 201 e 1x 409", [c1.status, c2.status].sort().join() === "201,409", `${c1.status}/${c2.status}`);

  // PATCH de procedure
  const retId = ret1.id;
  r = await api("PATCH", `/api/appointments/${retId}`, { procedure: procName });
  check("agenda do procedimento: PATCH procedure para nome já ativo na jornada => 409 e nada muda", r.status === 409 && (await prisma.appointment.findUnique({ where: { id: retId }, select: { procedure: true } })).procedure === returnName, r.status);
  r = await api("PATCH", `/api/appointments/${retId}`, { procedure: name });
  check("agenda do procedimento: PATCH para nome puro de procedimento ativo => 409", r.status === 409, r.status);
  const activeId = (await getSessions()).data.scheduledProcedure?.id;
  r = await api("PATCH", `/api/appointments/${activeId}`, { procedure: procName, notes: "ok" });
  check("agenda do procedimento: PATCH mantendo o próprio nome (exclui o próprio id) => 200", r.status === 200, `${r.status} ${r.data.message}`);
  r = await api("PATCH", `/api/appointments/${retId}`, { procedure: `Procedimento - ${name} livre` });
  check("agenda do procedimento: PATCH para nome sem duplicata => 200", r.status === 200 && r.data.appointment?.procedure === `Procedimento - ${name} livre`, `${r.status} ${r.data.message}`);

  // notes > 500
  const longNotes = "n".repeat(501);
  r = await api("POST", "/api/appointments", body({ journeyId: undefined, procedure: returnName, time: "17:00", notes: longNotes }));
  check("agenda do procedimento: POST com notes de 501 caracteres => 400", r.status === 400, r.status);
  r = await api("PATCH", `/api/appointments/${activeId}`, { notes: longNotes });
  check("agenda do procedimento: PATCH com notes de 501 caracteres => 400", r.status === 400, r.status);
  r = await api("PATCH", `/api/appointments/${activeId}`, { notes: "n".repeat(500) });
  check("agenda do procedimento: PATCH com notes de 500 caracteres => 200", r.status === 200, r.status);

  // procedureNames da jornada
  const combined = `Procedimento - ${name} + ${name} B`;
  const J5 = await mkJourney(P, "Agenda J5");
  await api("POST", "/api/appointments", body({ journeyId: J5.id, procedure: combined, time: "09:00", date: day(4) }));
  r = await api("GET", `/api/patients/${P}/journeys`);
  const names = r.data.journeys?.flatMap((j) => j.procedureNames) ?? [];
  const names5 = r.data.journeys?.find((j) => j.id === J5.id)?.procedureNames ?? [];
  check("agenda do procedimento: journeys.procedureNames sem prefixo 'Procedimento - '", names.length > 0 && !names.some((n) => n.startsWith("Procedimento - ")), JSON.stringify(names.filter((n) => n.startsWith("Procedimento - "))));
  check("agenda do procedimento: nome combinado vira itens sem duplicata", !names5.some((n) => n.includes(" + ")) && names5.length === new Set(names5).size && names5.includes(name) && names5.includes(`${name} B`), JSON.stringify(names5));

  // Jornada padrão (sem journeyId no corpo)
  const P5 = (await api("POST", "/api/patients", { name: `E2E Agenda Padrao ${run}`, phone: "11999990062", age: 35, cpf: randomCpf() })).data.patient.id;
  const noJ = (extra = {}) => ({ patientId: P5, procedure: procName, professional: `Prof ${P5}`, time: "10:00", date: day(2), ...extra });
  r = await api("POST", "/api/appointments", noJ());
  check("agenda do procedimento: POST sem journeyId cria na jornada padrão (201)", r.status === 201, `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/appointments", noJ({ time: "11:00" }));
  check("agenda do procedimento: POST sem journeyId duplicando na jornada padrão => 409", r.status === 409, r.status);
  const [d1, d2] = await Promise.all([api("POST", "/api/appointments", noJ({ procedure: returnName, time: "13:00" })), api("POST", "/api/appointments", noJ({ procedure: returnName, time: "14:00" }))]);
  check("agenda do procedimento: Retorno sem journeyId não sofre trava de duplicata", d1.status === 201 && d2.status === 201, `${d1.status}/${d2.status}`);

  // Reabrir / renomear encerrado
  r = await api("PATCH", `/api/appointments/${first.id}`, { status: "Agendado" });
  check("agenda do procedimento: reabrir Cancelado->Agendado com outro ativo do mesmo procedimento => 409", r.status === 409, `${r.status}`);
  check("agenda do procedimento: reabertura recusada não alterou o status", (await prisma.appointment.findUnique({ where: { id: first.id }, select: { status: true } })).status === "Cancelado");
  r = await api("PATCH", `/api/appointments/${first.id}`, { procedure: name });
  check("agenda do procedimento: renomear agendamento Cancelado para nome ativo NÃO dá 409 (200)", r.status === 200 && r.data.appointment?.status === "Cancelado", `${r.status} ${r.data.message}`);

  // PATCH simultâneo
  const J6 = await mkJourney(P, "Agenda J6");
  const rA = (await api("POST", "/api/appointments", body({ journeyId: J6.id, procedure: returnName, time: "09:00" }))).data.appointment;
  const rB = (await api("POST", "/api/appointments", body({ journeyId: J6.id, procedure: returnName, time: "14:00" }))).data.appointment;
  const target = `Procedimento - ${name} simultaneo`;
  const [e1, e2] = await Promise.all([api("PATCH", `/api/appointments/${rA.id}`, { procedure: target }), api("PATCH", `/api/appointments/${rB.id}`, { procedure: target })]);
  check("agenda do procedimento: dois PATCH simultâneos para o mesmo nome => 200 + 409", [e1.status, e2.status].sort().join() === "200,409" && await activeCount(J6.id, target) === 1, `${e1.status}/${e2.status} n=${await activeCount(J6.id, target)}`);

  // Tipos errados
  for (const [label, extra] of [["procedure numérico", { procedure: 123 }], ["time numérico", { time: 900 }], ["notes objeto", { notes: { a: 1 } }]]) {
    r = await api("POST", "/api/appointments", body({ journeyId: J6.id, time: "13:00", ...extra }));
    check(`agenda do procedimento: POST com ${label} => 400 'Dados do agendamento inválidos.'`, r.status === 400 && r.data.message === "Dados do agendamento inválidos.", `${r.status} ${r.data.message}`);
  }
  for (const [label, extra] of [["procedure numérico", { procedure: 123 }], ["time numérico", { time: 900 }], ["notes objeto", { notes: { a: 1 } }]]) {
    r = await api("PATCH", `/api/appointments/${activeId}`, extra);
    check(`agenda do procedimento: PATCH com ${label} => 400 'Dados do agendamento inválidos.'`, r.status === 400 && r.data.message === "Dados do agendamento inválidos.", `${r.status} ${r.data.message}`);
  }
}

async function startMovesAppointment() {
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const name = `E2E Inicio ${run}`;
  await api("POST", "/api/procedures", { name, category: "Facial", price: 300, durationMinutes: 30, margin: 30 });
  const proc = (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === name);
  check("início move agendamento: procedimento criado", Boolean(proc), proc?.id);
  if (!proc) return;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const mkPatient = async (label, phone) => (await api("POST", "/api/patients", { name: `E2E Inicio ${label} ${run}`, phone, age: 35, cpf: randomCpf() })).data.patient.id;
  const P = await mkPatient("A", "11999990070");
  const P2 = await mkPatient("B", "11999990071");
  const upload = async (patientId, journeyId, signatureStatus) => {
    const form = new FormData();
    form.set("file", new Blob([pdf], { type: "application/pdf" }), "Termo.pdf");
    form.set("category", "TERMOS"); form.set("signatureStatus", signatureStatus); form.set("journeyId", journeyId);
    return fetch(`${baseUrl}/api/patients/${patientId}/documents`, { method: "POST", headers: { cookie }, body: form });
  };
  const mk = async (patientId, label, { signed = true } = {}) => {
    const j = (await api("POST", `/api/patients/${patientId}/journeys`, { name: `E2E ${label} ${run}`, professionalId: professional?.id })).data.journey;
    const ev = (await api("PUT", `/api/patients/${patientId}/evaluation`, { journeyId: j.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
    const q = await api("POST", "/api/quotes", { patientId, journeyId: j.id, evaluationId: ev.id, details: [{ procedureId: proc.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" });
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote.id}`, { status, evaluationId: ev.id });
    const s = (await api("POST", `/api/patients/${patientId}/procedure-sessions`, { journeyId: j.id, quoteId: q.data.quote.id, procedureId: proc.id })).data.session;
    if (signed) await upload(patientId, j.id, "ASSINADO");
    return { patientId, journeyId: j.id, quoteId: q.data.quote.id, sessionId: s?.id };
  };
  const procName = `Procedimento - ${name}`;
  const otherName = `Procedimento - ${name} Outro`;
  let apptDayOffset = 7; // cada agendamento vai para um dia próprio: a regra de conflito (mesmo paciente/profissional) não deve mascarar o cenário testado
  const mkAppt = async (J, extra = {}) => (await api("POST", "/api/appointments", { patientId: J.patientId, journeyId: J.journeyId, procedure: procName, professional: `Prof ${J.patientId}`, date: day(apptDayOffset++), time: "10:00", notes: "", ...extra })).data.appointment;
  const start = (J, extra = {}) => api("PATCH", `/api/patients/${J.patientId}/procedure-sessions/${J.sessionId}`, { status: "Em execução", technique: "E2E técnica", treatedAreas: "E2E região", professional: "E2E Prof", photos: [{ id: `ph-${run}-${Math.random()}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 }], ...extra });
  const row = (id) => prisma.appointment.findUnique({ where: { id }, select: { date: true, time: true, status: true } });
  const snap = async (id) => JSON.stringify(await row(id));
  const nowSp = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date());
  const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const auditMoves = (s) => (s?.auditLog ?? []).filter((e) => /Agendamento alterado para o início/.test(e.action)).length;

  // Recusas não mexem no agendamento.
  const A = await mk(P, "Inicio A", { signed: false });
  const apptA = await mkAppt(A);
  const retA = await mkAppt(A, { procedure: `Retorno - ${name}`, time: "11:00" });
  const J2 = await mk(P, "Inicio A2");
  const apptJ2 = await mkAppt(J2, { time: "12:00" });
  const JO = await mk(P2, "Inicio Outro");
  const apptO = await mkAppt(JO, { time: "13:00" });
  check("início move agendamento: agendamentos de preparo criados", [apptA, retA, apptJ2, apptO].every(Boolean), JSON.stringify([apptA?.id, retA?.id, apptJ2?.id, apptO?.id]));
  if (![apptA, retA, apptJ2, apptO].every(Boolean)) return;
  const before = { a: await snap(apptA.id), ret: await snap(retA.id), j2: await snap(apptJ2.id), o: await snap(apptO.id) };
  let r = await start(A);
  check("início sem termo (ausente) => 409 CONSENT_REQUIRED, mensagem de termo ausente e agendamento intacto", r.status === 409 && r.data?.code === "CONSENT_REQUIRED" && /anexe o termo de consentimento assinado/.test(r.data.message) && await snap(apptA.id) === before.a, `${r.status} ${r.data?.code} ${r.data?.message}`);
  await upload(P, A.journeyId, "PENDENTE");
  r = await start(A);
  check("início com termo só pendente => 409 e mensagem de termo pendente (não a de ausente)", r.status === 409 && r.data?.code === "CONSENT_REQUIRED" && /não assinado/.test(r.data.message) && !/anexe o termo/.test(r.data.message) && await snap(apptA.id) === before.a, `${r.status} ${r.data?.message}`);
  await upload(P, A.journeyId, "ASSINADO");
  r = await start(A, { technique: "" });
  const r2 = await start(A, { treatedAreas: "  " });
  const r3 = await start(A, { photos: [] });
  const r4 = await start(A, { photos: [{ id: "x", phase: "Imediatamente após", imageUrl: dataUrl, name: "d", width: 1, height: 1 }] });
  check("início sem técnica / sem região / sem foto de antes => 400 e agendamento intacto", [r.status, r2.status, r3.status, r4.status].every((s) => s === 400) && await snap(apptA.id) === before.a, `${r.status}/${r2.status}/${r3.status}/${r4.status}`);

  // Início duplo concorrente: um só move.
  const [d1, d2] = await Promise.all([start(A), start(A)]);
  const moved = [d1, d2].filter((x) => x.data?.appointment?.id === apptA.id);
  const rowA = await row(apptA.id);
  const clock = nowSp();
  const dayStr = rowA.date.toISOString().slice(0, 10);
  check("início duplo: sem 500 e exatamente uma resposta traz o agendamento movido", d1.status < 500 && d2.status < 500 && moved.length === 1, `${d1.status}/${d2.status} moved=${moved.length}`);
  const winner = moved[0];
  check("início: resposta traz appointment {id,date,time} de hoje e hora atual (±2 min)", winner?.status === 200 && winner.data.appointment.date === clock.slice(0, 10) && Math.abs(mins(winner.data.appointment.time) - mins(clock.slice(11, 16))) <= 2, JSON.stringify([winner?.data?.appointment, clock]));
  check("início: banco do agendamento = hoje e hora atual, ainda Agendado", dayStr === clock.slice(0, 10) && rowA.time === winner?.data?.appointment?.time && rowA.status === "Agendado", JSON.stringify([rowA, clock]));
  const sessList = (await api("GET", `/api/patients/${P}/procedure-sessions?journeyId=${A.journeyId}&quoteId=${A.quoteId}`)).data;
  check("início: scheduledProcedure reflete a nova data/hora", sessList.scheduledProcedure?.id === apptA.id && sessList.scheduledProcedure.date === clock.slice(0, 10) && sessList.scheduledProcedure.time === rowA.time, JSON.stringify(sessList.scheduledProcedure));
  const todayKey = clock.slice(0, 10);
  const boot = (await api("GET", `/api/agenda?from=${todayKey}&to=${todayKey}`)).data.appointments?.find((a) => a.id === apptA.id);
  check("início: agenda do dia (GET /api/agenda?from&to) mostra o agendamento de hoje na hora atual", boot && String(boot.date).slice(0, 10) === clock.slice(0, 10) && boot.time === rowA.time, JSON.stringify(boot));
  check("início: auditLog tem 'Agendamento alterado para o início' uma única vez", auditMoves(winner?.data?.session) === 1 && sessList.sessions?.find((s) => s.id === A.sessionId)?.status === "Em execução", `${auditMoves(winner?.data?.session)}`);
  check("início: Retorno, outra jornada e outro paciente NÃO foram tocados", await snap(retA.id) === before.ret && await snap(apptJ2.id) === before.j2 && await snap(apptO.id) === before.o, "");

  // Já movido não move de novo.
  const future = new Date(`${day(9)}T15:00:00.000Z`);
  await prisma.appointment.update({ where: { id: apptA.id }, data: { date: future, time: "09:00" } });
  r = await api("PATCH", `/api/patients/${P}/procedure-sessions/${A.sessionId}`, { status: "Em execução", observations: "E2E obs", scheduledAppointmentId: apptA.id });
  const afterRe = await row(apptA.id);
  check("PATCH em sessão já em execução não move o agendamento de novo (mesmo com scheduledAppointmentId)", r.status === 200 && (r.data.appointment ?? null) === null && afterRe.time === "09:00" && afterRe.date.toISOString() === future.toISOString() && auditMoves(r.data.session) === 1, `${r.status} ${JSON.stringify(r.data.appointment)} ${JSON.stringify(afterRe)}`);

  // Sem agendamento.
  const N = await mk(P, "Inicio N");
  r = await start(N);
  check("início sem agendamento => 200 e appointment null", r.status === 200 && r.data.session?.status === "Em execução" && r.data.appointment === null && auditMoves(r.data.session) === 0, `${r.status} ${JSON.stringify(r.data.appointment)}`);

  // Cancelado, Em atendimento, só Retorno.
  const C = await mk(P, "Inicio C");
  const apptC = await mkAppt(C);
  await api("PATCH", `/api/appointments/${apptC.id}`, { status: "Cancelado" });
  const E = await mk(P, "Inicio E");
  const apptE = await mkAppt(E);
  await prisma.appointment.update({ where: { id: apptE.id }, data: { status: "Em atendimento" } });
  const R = await mk(P, "Inicio R");
  const apptR = await mkAppt(R, { procedure: `Retorno - ${name}` });
  const sn = { c: await snap(apptC.id), e: await snap(apptE.id), r: await snap(apptR.id) };
  const rc = await start(C), re = await start(E), rr = await start(R);
  check("início não move agendamento Cancelado, Em atendimento nem só-Retorno", [rc, re, rr].every((x) => x.status === 200 && x.data.appointment === null) && await snap(apptC.id) === sn.c && await snap(apptE.id) === sn.e && await snap(apptR.id) === sn.r, `${rc.status}/${re.status}/${rr.status}`);

  // scheduledAppointmentId: ids fora do escopo não movem nada; o início segue.
  const bad = [];
  const mkBadCase = async (label, makeId) => {
    const J = await mk(P, `Inicio Id ${label}`);
    const decoy = await mkAppt(J, { procedure: otherName, time: "14:00" });
    const id = await makeId(J);
    const decoyBefore = await snap(decoy.id);
    const idBefore = id && await row(id) ? await snap(id) : null;
    const res = await start(J, { scheduledAppointmentId: id });
    const ok = res.status === 200 && res.data.session?.status === "Em execução" && res.data.appointment === null && await snap(decoy.id) === decoyBefore && (idBefore === null || await snap(id) === idBefore);
    if (!ok) bad.push(`${label}: ${res.status} ${JSON.stringify(res.data.appointment)}`);
  };
  await mkBadCase("outro paciente", async () => apptO.id);
  await mkBadCase("outra jornada", async () => apptJ2.id);
  await mkBadCase("inexistente", async () => "inexistente-xyz");
  await mkBadCase("retorno da própria jornada", async (J) => (await mkAppt(J, { procedure: `Retorno - ${name}`, time: "15:00" })).id);
  await mkBadCase("cancelado da própria jornada", async (J) => { const a = await mkAppt(J, { procedure: `Procedimento - ${name} Cancelado`, time: "16:00" }); await api("PATCH", `/api/appointments/${a.id}`, { status: "Cancelado" }); return a.id; });
  check("scheduledAppointmentId de outro paciente/jornada/inexistente/retorno/cancelado: nada move e o início segue", bad.length === 0 && await snap(apptO.id) === before.o && await snap(apptJ2.id) === before.j2, bad.join(" | "));

  // scheduledAppointmentId válido move exatamente esse (mesmo com nome diferente do da sessão).
  const V = await mk(P, "Inicio Id valido");
  const vSame = await mkAppt(V, { time: "10:30" });
  const vOther = await mkAppt(V, { procedure: otherName, time: "11:30" });
  const vSameBefore = await snap(vSame.id);
  r = await start(V, { scheduledAppointmentId: vOther.id });
  const clockV = nowSp();
  const vRow = await row(vOther.id);
  check("scheduledAppointmentId válido move exatamente esse agendamento e só ele", r.status === 200 && r.data.appointment?.id === vOther.id && vRow.time === r.data.appointment.time && vRow.date.toISOString().slice(0, 10) === clockV.slice(0, 10) && await snap(vSame.id) === vSameBefore, `${r.status} ${JSON.stringify(r.data.appointment)} ${JSON.stringify(vRow)}`);

  // Sem id: só o de nome exato da sessão; nomes diferentes não são movidos.
  const B = await mk(P, "Inicio Nome");
  const bOther = await mkAppt(B, { procedure: otherName, time: "08:30" });
  const bSame = await mkAppt(B, { time: "17:00" });
  const bOtherBefore = await snap(bOther.id);
  r = await start(B);
  check("sem id, 2 ativos de nomes diferentes: move só o da sessão (mesmo sendo o mais tarde)", r.status === 200 && r.data.appointment?.id === bSame.id && await snap(bOther.id) === bOtherBefore, `${r.status} ${JSON.stringify(r.data.appointment)}`);
  const Q = await mk(P, "Inicio Nome so outro");
  const qOther = await mkAppt(Q, { procedure: otherName, time: "08:30" });
  const qBefore = await snap(qOther.id);
  r = await start(Q);
  check("sem id, só agendamento com outro nome: nada move", r.status === 200 && r.data.appointment === null && await snap(qOther.id) === qBefore, `${r.status} ${JSON.stringify(r.data.appointment)}`);
}

// Apaga os dados de negócio da clínica de teste (mantém clínica, usuário e vínculo).
// Recusa se a clínica não for exatamente a de teste com um único membro: a conta de teste.
async function resetTestClinic() {
  const memberships = await prisma.clinicMembership.findMany({ where: { user: { email } }, select: { clinic: { select: { id: true, name: true, memberships: { select: { user: { select: { email: true } } } } } } } });
  const clinic = memberships[0]?.clinic;
  if (memberships.length !== 1 || clinic.name !== testClinicName || clinic.memberships.length !== 1 || clinic.memberships[0].user.email !== email) {
    throw new Error("A conta de teste não está sozinha na clínica de teste. Limpeza recusada.");
  }
  const clinicId = clinic.id;
  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { clinicId } }),
    prisma.pendingStockOutput.deleteMany({ where: { clinicId } }),
    prisma.expense.deleteMany({ where: { clinicId } }),
    prisma.purchase.deleteMany({ where: { clinicId } }),
    prisma.recurringExpense.deleteMany({ where: { clinicId } }),
    prisma.product.deleteMany({ where: { clinicId } }),
    prisma.procedure.deleteMany({ where: { clinicId } }),
    prisma.procedureImageAsset.deleteMany({ where: { clinicId } }),
    prisma.quote.deleteMany({ where: { clinicId } }),
    prisma.payment.deleteMany({ where: { clinicId } }),
    prisma.patientAnamnesis.deleteMany({ where: { clinicId } }),
    prisma.clinicalDocument.deleteMany({ where: { clinicId } }),
    prisma.clinicalPhoto.deleteMany({ where: { clinicId } }),
    prisma.clinicalFileAudit.deleteMany({ where: { clinicId } }),
    prisma.patient.deleteMany({ where: { clinicId } }),
  ]);
}

// Catálogo de procedimentos: habilitar do catálogo, personalizados (com/sem imagem), upload, imagens por id, conflitos e permissões.
async function procedureCatalog() {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const fake = Buffer.from("isto é texto disfarçado de imagem");
  const form = (buffer, name, type) => {
    const body = new FormData();
    body.set("file", new Blob([buffer], { type }), name);
    return body;
  };
  const call = async (method, path, body, { raw = false } = {}) => {
    const json = body && !(body instanceof FormData);
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: json ? JSON.stringify(body) : body, redirect: "manual" });
    if (raw) return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
    return { status: response.status, data };
  };
  const base = { price: 800, durationMinutes: 40, margin: 35 };

  // Sem sessão.
  const anon = await withSession("", async () => [await call("GET", "/api/procedure-catalog"), await call("POST", "/api/procedures/images", form(png, "a.png", "image/png")), await call("GET", "/api/procedures/images/x", null, { raw: true })]);
  check("catálogo e imagens sem sessão devolvem 401", anon.every((item) => item.status === 401), anon.map((item) => item.status).join(","));

  // Catálogo.
  let r = await call("GET", "/api/procedure-catalog");
  const items = r.data.items ?? [];
  check("lista o catálogo com 30 itens, imagem estática e nada habilitado", r.status === 200 && r.data.total === 30 && items.length === 30 && items.every((item) => item.id && item.slug && item.name && /^\/images\/procedimentos\/.+\.webp$/.test(item.imageUrl) && item.enabled === false && item.procedureId === null), `${r.status} ${JSON.stringify(items[0])}`);
  r = await call("GET", "/api/procedure-catalog?q=HARMONIZAÇÃO");
  check("busca ignora acento e caixa", r.status === 200 && r.data.items.some((item) => item.slug === "harmonizacao-facial") && r.data.total < 30, `${r.status} ${r.data.total}`);
  r = await call("GET", "/api/procedure-catalog?limit=5&offset=5");
  check("paginação do catálogo", r.status === 200 && r.data.items.length === 5 && r.data.total === 30, `${r.status} ${r.data.items?.length}`);
  const botox = items.find((item) => item.slug === "botox");
  const lip = items.find((item) => item.slug === "preenchimento-labial");

  // Habilitar do catálogo.
  r = await call("POST", "/api/procedures", { catalogItemId: botox.id, ...base });
  const fromCatalog = r.data.procedure;
  check("habilita item do catálogo sem enviar category", r.status === 201 && fromCatalog.name === botox.name && fromCatalog.catalogItemId === botox.id && fromCatalog.image?.kind === "catalog" && fromCatalog.image.url === botox.imageUrl && fromCatalog.price === 800 && fromCatalog.category === "", `${r.status} ${JSON.stringify(r.data)}`.slice(0, 300));
  r = await call("POST", "/api/procedures", { catalogItemId: botox.id, ...base });
  check("habilitar o mesmo item do catálogo de novo devolve 409", r.status === 409, `${r.status} ${JSON.stringify(r.data)}`);
  r = await call("GET", "/api/procedure-catalog?q=botox");
  check("catálogo marca o item como habilitado com o id do procedimento", r.data.items?.find((item) => item.id === botox.id)?.enabled === true && r.data.items.find((item) => item.id === botox.id).procedureId === fromCatalog.id, JSON.stringify(r.data.items?.[0]));
  r = await call("POST", "/api/procedures", { catalogItemId: "inexistente", ...base });
  check("item de catálogo inexistente devolve 404", r.status === 404, r.status);
  r = await call("POST", "/api/procedures", { ...base });
  check("sem catalogItemId nem custom devolve 400", r.status === 400, r.status);
  r = await call("POST", "/api/procedures", { catalogItemId: lip.id, price: "", durationMinutes: 30, margin: 20 });
  check("preço vazio devolve 400", r.status === 400, r.status);

  // Renomear não quebra a imagem (por id) e o nome da clínica é independente do catálogo.
  r = await call("PATCH", `/api/procedures/${fromCatalog.id}`, { name: `Toxina da casa ${run}` });
  check("renomear procedimento de catálogo mantém a imagem do catálogo", r.status === 200 && r.data.procedure.name === `Toxina da casa ${run}` && r.data.procedure.image.url === botox.imageUrl && r.data.procedure.catalogItemId === botox.id, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);

  // Personalizado sem imagem e sem category.
  const customName = `E2E Personalizado ${run}`;
  r = await call("POST", "/api/procedures", { custom: true, name: customName, ...base });
  const custom = r.data.procedure;
  check("personalizado sem imagem e sem category: image none", r.status === 201 && custom.catalogItemId === null && custom.image?.kind === "none" && custom.image.url === null && custom.category === "", `${r.status} ${JSON.stringify(r.data)}`.slice(0, 300));
  r = await call("POST", "/api/procedures", { custom: true, name: customName, ...base });
  check("nome duplicado na criação devolve 409", r.status === 409, r.status);
  r = await call("POST", "/api/procedures", { custom: true, name: "  ", ...base });
  check("personalizado sem nome devolve 400", r.status === 400, r.status);
  r = await call("POST", "/api/procedures", { custom: true, name: `E2E Com categoria ${run}`, category: "Facial", ...base });
  check("category legada continua aceita", r.status === 201 && r.data.procedure.category === "Facial", `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);

  // Personalizado com imagem da biblioteca.
  r = await call("POST", "/api/procedures", { custom: true, name: `E2E Biblioteca ${run}`, catalogImageId: lip.id, ...base });
  check("personalizado com imagem da biblioteca", r.status === 201 && r.data.procedure.image.kind === "catalog" && r.data.procedure.image.url === lip.imageUrl && r.data.procedure.catalogItemId === null, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  r = await call("GET", "/api/procedure-catalog?q=labial");
  check("usar só a imagem da biblioteca não habilita o item", r.data.items?.find((item) => item.id === lip.id)?.enabled === false);

  // Upload válido (PNG/JPEG/WebP) e inválido.
  const uploads = {};
  for (const [label, buffer, type] of [["PNG", png, "image/png"], ["JPEG", jpg, "image/jpeg"], ["WebP", webp, "image/webp"]]) {
    r = await call("POST", "/api/procedures/images", form(buffer, `a.${label}`, type));
    uploads[label] = r.data;
    check(`upload de ${label} válido devolve id e url`, r.status === 201 && r.data.id && r.data.url === `/api/procedures/images/${r.data.id}`, `${r.status} ${JSON.stringify(r.data)}`);
  }
  r = await call("GET", uploads.PNG.url, null, { raw: true });
  check("imagem enviada é servida com tipo, nosniff e cache privado", r.status === 200 && r.headers.get("content-type") === "image/png" && r.headers.get("x-content-type-options") === "nosniff" && /private/.test(r.headers.get("cache-control") ?? "") && r.buffer.equals(png), `${r.status} ${r.headers.get("content-type")} ${r.headers.get("cache-control")}`);
  const asset = await prisma.procedureImageAsset.findUnique({ where: { id: uploads.PNG.id }, select: { clinicId: true, mimeType: true, sizeBytes: true, sha256: true, blob: { select: { assetId: true } } } });
  check("imagem fica na clínica com hash e bytes em tabela própria", asset?.mimeType === "image/png" && asset.sizeBytes === png.length && asset.sha256.length === 64 && asset.blob?.assetId === uploads.PNG.id && Boolean(asset.clinicId));
  for (const [label, buffer, type, expected] of [["SVG", svg, "image/svg+xml", [400, 415]], ["texto disfarçado de PNG", fake, "image/png", [400, 415]], ["texto sem tipo", fake, "", [400, 415]], ["PNG declarado como JPEG", png, "image/jpeg", [400, 415]], ["maior que 4 MB", Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]), "image/png", [413]]]) {
    r = await call("POST", "/api/procedures/images", form(buffer, "x.bin", type));
    check(`upload inválido recusado: ${label}`, expected.includes(r.status), r.status);
  }
  r = await call("POST", "/api/procedures/images", { file: "x" });
  check("upload sem multipart é recusado", r.status >= 400 && r.status < 500, r.status);

  // Personalizado com upload; troca e remoção de imagem.
  r = await call("POST", "/api/procedures", { custom: true, name: `E2E Upload ${run}`, imageAssetId: uploads.PNG.id, ...base });
  const withUpload = r.data.procedure;
  check("personalizado com imagem enviada", r.status === 201 && withUpload.image.kind === "custom" && withUpload.image.url === uploads.PNG.url, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  r = await call("POST", "/api/procedures", { custom: true, name: `E2E Imagem inexistente ${run}`, imageAssetId: "naoexiste", ...base });
  check("imageAssetId inexistente (ou de outra clínica) devolve 400", r.status === 400, r.status);
  r = await call("POST", "/api/procedures", { custom: true, name: `E2E Duas imagens ${run}`, imageAssetId: uploads.PNG.id, catalogImageId: lip.id, ...base });
  check("imagem enviada e da biblioteca juntas devolve 400", r.status === 400, r.status);
  r = await call("PATCH", `/api/procedures/${withUpload.id}`, { imageAssetId: uploads.JPEG.id });
  check("PATCH troca a imagem enviada", r.status === 200 && r.data.procedure.image.url === uploads.JPEG.url, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  check("imagem anterior sem uso é descartada", await prisma.procedureImageAsset.count({ where: { id: uploads.PNG.id } }) === 0);
  r = await call("PATCH", `/api/procedures/${withUpload.id}`, { imageAssetId: null, catalogImageId: null });
  check("PATCH remove a imagem (placeholder)", r.status === 200 && r.data.procedure.image.kind === "none", `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  r = await call("PATCH", `/api/procedures/${withUpload.id}`, { imageAssetId: "naoexiste" });
  check("PATCH com imagem inexistente devolve 400", r.status === 400, r.status);
  r = await call("PATCH", `/api/procedures/${fromCatalog.id}`, { imageAssetId: uploads.WebP.id });
  check("catálogo habilitado pode ganhar imagem própria", r.status === 200 && r.data.procedure.image.kind === "custom", `${r.status}`);
  r = await call("PATCH", `/api/procedures/${fromCatalog.id}`, { imageAssetId: null, catalogImageId: null });
  check("remover imagem própria volta à imagem do catálogo", r.status === 200 && r.data.procedure.image.url === botox.imageUrl, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  // Reenvia uma imagem para os testes de permissão e de outra clínica abaixo (a JPEG ainda é usada? não: foi trocada por remoção).
  r = await call("POST", "/api/procedures/images", form(jpg, "b.jpg", "image/jpeg"));
  const shared = r.data;

  // Remoção de imagem enviada: em uso → 409; órfã → 200 e some; órfãs antigas são descartadas no próximo upload.
  r = await call("POST", "/api/procedures/images", form(png, "u.png", "image/png"));
  const inUse = r.data;
  r = await call("POST", "/api/procedures", { custom: true, name: `E2E Imagem em uso ${run}`, imageAssetId: inUse.id, ...base });
  const holder = r.data.procedure;
  r = await call("DELETE", `/api/procedures/images/${inUse.id}`);
  check("DELETE de imagem em uso devolve 409 e mantém a imagem", r.status === 409 && await prisma.procedureImageAsset.count({ where: { id: inUse.id } }) === 1, r.status);
  r = await call("POST", "/api/procedures/images", form(png, "o.png", "image/png"));
  const orphan = r.data;
  r = await call("DELETE", `/api/procedures/images/${orphan.id}`);
  check("DELETE de imagem órfã devolve 200 e apaga metadados e bytes", r.status === 200 && await prisma.procedureImageAsset.count({ where: { id: orphan.id } }) === 0 && await prisma.procedureImageBlob.count({ where: { assetId: orphan.id } }) === 0, r.status);
  r = await call("GET", orphan.url, null, { raw: true });
  check("imagem apagada devolve 404", r.status === 404, r.status);
  r = await call("DELETE", "/api/procedures/images/naoexiste");
  check("DELETE de imagem inexistente devolve 404", r.status === 404, r.status);
  const clinicOfAsset = (await prisma.procedureImageAsset.findUnique({ where: { id: inUse.id }, select: { clinicId: true } })).clinicId;
  const stale = await prisma.procedureImageAsset.create({ data: { clinicId: clinicOfAsset, mimeType: "image/png", sizeBytes: png.length, sha256: "0".repeat(64), uploadedBy: "e2e", createdAt: new Date(Date.now() - 48 * 3600_000), blob: { create: { data: png } } }, select: { id: true } });
  const fresh = await prisma.procedureImageAsset.create({ data: { clinicId: clinicOfAsset, mimeType: "image/png", sizeBytes: png.length, sha256: "1".repeat(64), uploadedBy: "e2e", blob: { create: { data: png } } }, select: { id: true } });
  r = await call("POST", "/api/procedures/images", form(png, "p.png", "image/png"));
  const purgeProbe = r.data;
  check("upload descarta órfã com mais de 24 h, mantém a recente e a em uso", await prisma.procedureImageAsset.count({ where: { id: stale.id } }) === 0 && await prisma.procedureImageAsset.count({ where: { id: { in: [fresh.id, inUse.id] } } }) === 2, r.status);
  await call("DELETE", `/api/procedures/images/${purgeProbe.id}`);
  await call("DELETE", `/api/procedures/images/${fresh.id}`);
  r = await call("PATCH", `/api/procedures/${holder.id}`, { imageAssetId: null, catalogImageId: null });
  check("trocar a imagem de um procedimento descarta a enviada sem uso", r.status === 200 && await prisma.procedureImageAsset.count({ where: { id: inUse.id } }) === 0, r.status);

  // PATCH: conflitos e validação; category não é exigida.
  r = await call("PATCH", `/api/procedures/${custom.id}`, { name: `Toxina da casa ${run}` });
  check("PATCH com nome duplicado devolve 409", r.status === 409, `${r.status} ${JSON.stringify(r.data)}`);
  r = await call("PATCH", `/api/procedures/${custom.id}`, { name: "   " });
  check("PATCH com nome vazio devolve 400", r.status === 400, r.status);
  r = await call("PATCH", `/api/procedures/${custom.id}`, { price: 1234 });
  check("PATCH sem name nem category altera só o preço", r.status === 200 && r.data.procedure.price === 1234 && r.data.procedure.name === customName, `${r.status}`);
  r = await call("PATCH", "/api/procedures/naoexiste", { price: 1 });
  check("PATCH de procedimento inexistente devolve 404", r.status === 404, r.status);

  // Lista, agenda e orçamentos devolvem image sem base64.
  r = await call("GET", "/api/procedures");
  check("lista de procedimentos traz image por procedimento, sem base64", r.status === 200 && r.data.procedures.length >= 4 && r.data.procedures.every((item) => ["custom", "catalog", "none"].includes(item.image?.kind) && !JSON.stringify(item).includes("base64")), `${r.status}`);
  r = await call("GET", "/api/agenda/bootstrap");
  check("agenda/bootstrap devolve image nos procedimentos", r.status === 200 && r.data.procedures.length >= 4 && r.data.procedures.every((item) => item.image && !("imageAssetId" in item)), `${r.status} ${JSON.stringify(r.data.procedures?.[0])}`);
  r = await call("GET", "/api/quotes/options");
  check("quotes/options devolve image nos procedimentos", r.status === 200 && r.data.procedures.length >= 4 && r.data.procedures.every((item) => item.image && !("catalogItem" in item)), `${r.status}`);

  // Outra clínica, STAFF e PROFESSIONAL (removidos no finally).
  const otherEmail = `e2e-cat-outra-${run}@example.com`, otherPassword = `E2e-${run}-Outra9!`, otherClinic = `E2E Catalogo Externa ${run}`;
  const staffEmail = `e2e-cat-staff-${run}@example.com`, staffPassword = `E2e-${run}-Staff9!`;
  const proEmail = `e2e-cat-pro-${run}@example.com`, proPassword = `E2e-${run}-Pro99!`;
  const members = [];
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990021", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const o = await withSession(other.cookie, async () => ({
        image: await call("GET", shared.url, null, { raw: true }),
        patch: await call("PATCH", `/api/procedures/${custom.id}`, { price: 1 }),
        useImage: await call("POST", "/api/procedures", { custom: true, name: `Invasor ${run}`, imageAssetId: shared.id, ...base }),
        catalog: await call("GET", "/api/procedure-catalog?q=botox"),
        list: await call("GET", "/api/procedures"),
        del: await call("DELETE", shared.url),
      }));
      check("outra clínica não apaga imagem alheia (404) e a imagem continua", o.del.status === 404 && await prisma.procedureImageAsset.count({ where: { id: shared.id } }) === 1, o.del.status);
      check("imagem enviada por uma clínica dá 404 para outra", o.image.status === 404, o.image.status);
      check("outra clínica não altera procedimento nem usa imagem alheia", o.patch.status === 404 && o.useImage.status === 400, `${o.patch.status} ${o.useImage.status}`);
      check("outra clínica vê o catálogo sem habilitações e a lista própria vazia", o.catalog.data.items?.every((item) => item.enabled === false) && o.list.data.procedures?.length === 0, `${o.catalog.status} ${o.list.status}`);
    } else {
      check("segunda clínica criada para testar isolamento do catálogo", false, `registro ${r.status} login ${other?.status}`);
    }

    for (const [role, memberEmail, memberPassword] of [["STAFF", staffEmail, staffPassword], ["PROFESSIONAL", proEmail, proPassword]]) {
      r = await api("POST", "/api/team", { name: `E2E ${role} Catalogo`, email: memberEmail, password: memberPassword, role });
      if (r.status === 201) members.push(r.data.member);
      const session = r.status === 201 ? await loginAs(memberEmail, memberPassword) : null;
      if (session?.status !== 200) { check(`usuário ${role} criado para testar permissões do catálogo`, false, `team ${r.status} login ${session?.status}`); continue; }
      await withSession(session.cookie, async () => {
        r = await call("POST", "/api/procedures", { catalogItemId: lip.id, ...base });
        check(`${role} não habilita procedimento (403)`, r.status === 403, r.status);
        r = await call("POST", "/api/procedures", { custom: true, name: `Nao ${role} ${run}`, ...base });
        check(`${role} não cria personalizado (403)`, r.status === 403, r.status);
        r = await call("POST", "/api/procedures/images", form(png, "a.png", "image/png"));
        check(`${role} não envia imagem (403)`, r.status === 403, r.status);
        r = await call("PATCH", `/api/procedures/${custom.id}`, { price: 1 });
        check(`${role} não edita procedimento (403)`, r.status === 403, r.status);
        r = await call("DELETE", shared.url);
        check(`${role} não apaga imagem (403)`, r.status === 403 && await prisma.procedureImageAsset.count({ where: { id: shared.id } }) === 1, r.status);
        r = await call("GET", shared.url, null, { raw: true });
        check(`${role} da mesma clínica vê a imagem enviada`, r.status === 200 && r.headers.get("content-type") === "image/jpeg", r.status);
        r = await call("GET", "/api/procedure-catalog");
        check(`${role} lê o catálogo`, r.status === 200 && r.data.items.length === 30, r.status);
        r = await call("GET", "/api/agenda/bootstrap");
        check(`${role} recebe image na agenda`, r.status === 200 && r.data.procedures.every((item) => item.image), r.status);
      });
    }
  } finally {
    for (const member of members) await api("DELETE", "/api/team", { membershipId: member.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [otherEmail, staffEmail, proEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [otherEmail, staffEmail, proEmail] } } });
  }
}

// Catálogo de procedimentos, lacunas: compatibilidade, valores limite, corridas, imagens, permissões, outra clínica, ficha técnica e integração.
async function procedureCatalogGaps() {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]);
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const mega = 4 * 1024 * 1024;
  const padTo = (head, size) => Buffer.concat([head, Buffer.alloc(size - head.length)]);
  const form = (buffer, name, type) => { const body = new FormData(); body.set("file", new Blob([buffer], { type }), name); return body; };
  const call = async (method, path, body, { raw = false } = {}) => {
    const isText = typeof body === "string";
    const json = body !== undefined && body !== null && !(body instanceof FormData) && !isText;
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(json || isText ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined || body === null ? undefined : json ? JSON.stringify(body) : body, redirect: "manual" });
    if (raw) return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
    return { status: response.status, data };
  };
  const base = { price: 800, durationMinutes: 40, margin: 35 };
  let counter = 0;
  const uniq = (label = "Proc") => `E2E ${label} ${run} ${++counter}`;
  const mkCustom = (extra = {}) => call("POST", "/api/procedures", { custom: true, name: uniq(), ...base, ...extra });
  const listed = async (id) => (await call("GET", "/api/procedures")).data.procedures?.find((item) => item.id === id);
  const count = (where) => prisma.procedure.count({ where });
  const clinicId = (await prisma.clinicMembership.findFirst({ where: { user: { email } }, select: { clinicId: true } })).clinicId;
  const catalog = (await call("GET", "/api/procedure-catalog")).data.items ?? [];
  const free = catalog.filter((item) => !item.enabled);
  const sheetOf = (procedure) => (procedure?.technicalSheet ?? []).map((item) => `${item.productId}:${item.quantity}`).sort().join();
  let r;
  let results;

  // Compatibilidade: cliente antigo (sem catalogItemId nem custom) e dados legados.
  const legacyName = uniq("Legado");
  r = await call("POST", "/api/procedures", { name: legacyName, category: "Facial", price: 300, durationMinutes: 30, margin: 30 });
  check("compat: procedimento legado {name, category} ainda cria (personalizado, sem imagem)", r.status === 201 && r.data.procedure.name === legacyName && r.data.procedure.category === "Facial" && r.data.procedure.catalogItemId === null && r.data.procedure.image.kind === "none", `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  r = await call("PATCH", `/api/procedures/${r.data.procedure.id}`, { name: legacyName, category: "Corporal", price: 310 });
  check("compat: PATCH legado {name, category, price} com o mesmo nome não dá 409", r.status === 200 && r.data.procedure.category === "Corporal" && r.data.procedure.price === 310, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  r = await call("POST", "/api/procedures", { custom: true, name: uniq("SemCategoria"), ...base });
  check("compat: category ausente grava vazio", r.status === 201 && r.data.procedure.category === "", `${r.status}`);
  r = await call("POST", "/api/procedures", { custom: true, name: uniq("Cat100"), ...base, category: "C".repeat(100) });
  check("compat: category longa é cortada em 60", r.status === 201 && r.data.procedure.category.length === 60, `${r.status} ${r.data.procedure?.category?.length}`);

  // Renomear procedimento do catálogo: imagem por id continua em lista, orçamentos e agenda.
  const renItem = free[0];
  r = await call("POST", "/api/procedures", { catalogItemId: renItem.id, ...base });
  const renamed = r.data.procedure;
  const newName = uniq("Renomeado");
  r = await call("PATCH", `/api/procedures/${renamed.id}`, { name: newName });
  const inList = await listed(renamed.id);
  const inQuotes = (await call("GET", "/api/quotes/options")).data.procedures?.find((item) => item.id === renamed.id);
  const inAgenda = (await call("GET", "/api/agenda/bootstrap")).data.procedures?.find((item) => item.name === newName);
  check("renomeado do catálogo mantém image.kind=catalog em lista, quotes/options e agenda", r.status === 200 && [inList, inQuotes, inAgenda].every((item) => item?.image?.kind === "catalog" && item.image.url === renItem.imageUrl), JSON.stringify([inList?.image, inQuotes?.image, inAgenda?.image]));
  check("renomeado continua marcado como habilitado no catálogo (mesmo id)", (await call("GET", `/api/procedure-catalog?q=${encodeURIComponent(renItem.name)}`)).data.items?.find((item) => item.id === renItem.id)?.procedureId === renamed.id);
  r = await call("PATCH", `/api/procedures/${renamed.id}`, { name: renItem.name });
  check("voltar ao nome original do catálogo é permitido e mantém a imagem", r.status === 200 && r.data.procedure.image.kind === "catalog", `${r.status}`);
  r = await call("POST", "/api/procedures", { custom: true, name: renItem.name, ...base });
  check("personalizado com nome igual ao de um item do catálogo habilitado devolve 409", r.status === 409, r.status);
  r = await call("POST", "/api/procedures", { catalogItemId: free[1].id, ...base });
  const second = r.data.procedure;
  r = await call("PATCH", `/api/procedures/${second.id}`, { name: renItem.name });
  check("renomear outro procedimento para o nome de um existente devolve 409", r.status === 409, r.status);

  // Valores: preço com centavos, limites, texto e tipos estranhos (POST).
  for (const [sent, stored] of [[150.5, 150.5], [150.4, 150.4], ["99.9", 99.9], ["349,90", 349.9], [1.999, 2], [0, 0], [-5, 0], [100000000, 100000000]]) {
    r = await mkCustom({ price: sent });
    check(`preço ${JSON.stringify(sent)} é gravado com centavos (${stored}), nunca negativo`, r.status === 201 && r.data.procedure.price === stored, `${r.status} ${r.data.procedure?.price}`);
  }
  for (const sent of ["abc", {}, "NaN", "Infinity", "", null, undefined, " ", [], true, "0x10", "1e3", [5]]) {
    r = await mkCustom({ price: sent });
    check(`preço inválido ${JSON.stringify(sent) ?? "ausente"} devolve 400`, r.status === 400, r.status);
  }
  for (const sent of [1e30, 3e9, 2147483648, 100000001]) {
    r = await mkCustom({ price: sent });
    check(`preço acima do teto de R$ 100.000.000 (${sent}) devolve 400`, r.status === 400, r.status);
  }
  r = await mkCustom({ durationMinutes: 0 });
  check("duração 0 vira 1 minuto", r.status === 201 && r.data.procedure.durationMinutes === 1, `${r.status} ${r.data.procedure?.durationMinutes}`);
  r = await mkCustom({ durationMinutes: -10 });
  check("duração negativa vira 1 minuto", r.status === 201 && r.data.procedure.durationMinutes === 1, `${r.status} ${r.data.procedure?.durationMinutes}`);
  r = await mkCustom({ durationMinutes: 30.5 });
  check("duração decimal devolve 400", r.status === 400, r.status);
  r = await mkCustom({ durationMinutes: "45" });
  check("duração em texto numérico é aceita", r.status === 201 && r.data.procedure.durationMinutes === 45, `${r.status}`);
  r = await mkCustom({ durationMinutes: 1440 });
  check("duração de 1440 minutos é aceita", r.status === 201, r.status);
  for (const sent of [1e10, 2147483648, 1441, " ", true, [], "0x10"]) {
    r = await mkCustom({ durationMinutes: sent });
    check(`duração inválida/acima de 1440 (${JSON.stringify(sent)}) devolve 400`, r.status === 400, r.status);
  }
  // Margem foi removida: cliente antigo que ainda a envia (qualquer valor) não leva 400, e a resposta não a devolve.
  for (const sent of [-5, 150, 33.3, "x", {}]) {
    r = await mkCustom({ margin: sent });
    check(`margem legada ${JSON.stringify(sent)} é ignorada (201, sem margin na resposta)`, r.status === 201 && !("margin" in r.data.procedure), `${r.status}`);
  }

  // Nomes.
  r = await call("POST", "/api/procedures", { custom: true, name: "A".repeat(121), ...base });
  check("nome com 121 caracteres devolve 400", r.status === 400, r.status);
  const longName = `${"L".repeat(110)}${run}`.padEnd(120, "x").slice(0, 120);
  r = await call("POST", "/api/procedures", { custom: true, name: longName, ...base });
  check("nome com exatamente 120 caracteres é aceito", longName.length === 120 && r.status === 201 && r.data.procedure.name === longName, r.status);
  for (const sent of ["   ", "\t\n ", 12345, ["a"], { a: 1 }, null]) {
    r = await call("POST", "/api/procedures", { custom: true, name: sent, ...base });
    check(`nome inválido ${JSON.stringify(sent)} devolve 400`, r.status === 400, r.status);
  }
  const htmlName = `<img src=x onerror=alert(1)> ${run}`;
  r = await call("POST", "/api/procedures", { custom: true, name: htmlName, ...base });
  check("nome com HTML é guardado como texto literal (a tela escapa)", r.status === 201 && r.data.procedure.name === htmlName, `${r.status} ${r.data.procedure?.name}`);
  r = await call("POST", "/api/procedures", { custom: true, name: `Muitos    espaços\t\ne tabs ${run}`, ...base });
  check("espaços e quebras internas do nome colapsam em um espaço", r.status === 201 && r.data.procedure.name === `Muitos espaços e tabs ${run}`, `${r.status} ${r.data.procedure?.name}`);
  for (const [label, sent] of [["NUL", "a\u0000b"], ["substituto solitário", "a\ud800b"]]) {
    r = await call("POST", "/api/procedures", { custom: true, name: `${sent} ${run}`, ...base });
    check(`nome com ${label} devolve 4xx, não 500`, r.status >= 400 && r.status < 500, r.status);
  }
  r = await call("POST", "/api/procedures", { custom: true, name: `Bell\u0007 ${run}`, ...base });
  check("nome com caractere de controle (BEL) devolve 400", r.status === 400, r.status);

  // Corpos e ids estranhos.
  for (const [label, raw] of [["array", "[]"], ["JSON inválido", "{oops"], ["null", "null"], ["texto", '"x"']]) {
    r = await call("POST", "/api/procedures", raw);
    check(`POST com corpo ${label} devolve 400`, r.status === 400, r.status);
  }
  for (const [label, sent] of [["número", 123], ["SQL", "'; DROP TABLE \"Procedure\";--"], ["caminho", "../../etc/passwd"], ["objeto", { $ne: null }], ["inexistente", `cat_inexistente_${run}`]]) {
    r = await call("POST", "/api/procedures", { catalogItemId: sent, ...base });
    check(`catalogItemId ${label} sem nome devolve 400 ou 404`, [400, 404].includes(r.status), r.status);
  }
  r = await call("POST", "/api/procedures", { catalogItemId: "a".repeat(101), ...base });
  check("catalogItemId com 101 caracteres sem nome devolve 400", r.status === 400, r.status);
  for (const path of ["/api/procedures/%27%20OR%201=1", `/api/procedures/${"a".repeat(3000)}`, "/api/procedures/%00"]) {
    r = await call("PATCH", path, { price: 1 });
    check(`PATCH com id estranho (${path.slice(0, 30)}) devolve 404`, r.status === 404, r.status);
  }
  r = await call("GET", "/api/procedures/images/..%2F..%2Fetc");
  check("GET de imagem com id de caminho devolve 404", r.status === 404, r.status);
  r = await call("DELETE", "/api/procedures/images/%00");
  check("DELETE de imagem com id NUL devolve 4xx, não 500", r.status >= 400 && r.status < 500, r.status);
  r = await call("DELETE", `/api/procedures/images/${"a".repeat(3000)}`);
  check("DELETE de imagem com id enorme devolve 404", r.status === 404, r.status);

  // Catálogo: item inativo, desativado depois de habilitado, paginação e busca estranha.
  const tempActive = `e2e_ativo_${run}`, tempInactive = `e2e_inativo_${run}`;
  const tempIds = [tempActive, tempInactive];
  const tempData = (id, active) => ({ id, slug: id.replace(/_/g, "-"), name: `E2E Item ${id}`, imageFile: `/images/procedimentos/${id.replace(/_/g, "-")}.webp`, imageAlt: "e2e", sortOrder: 9999, active });
  try {
    await prisma.procedureCatalogItem.createMany({ data: [tempData(tempActive, true), tempData(tempInactive, false)] });
    r = await call("POST", "/api/procedures", { catalogItemId: tempInactive, ...base });
    check("item inativo do catálogo não pode ser habilitado (404)", r.status === 404, r.status);
    r = await mkCustom({ catalogImageId: tempInactive });
    check("imagem de biblioteca inativa é recusada na criação (400)", r.status === 400, r.status);
    const anyProc = (await mkCustom()).data.procedure;
    r = await call("PATCH", `/api/procedures/${anyProc.id}`, { catalogImageId: tempInactive });
    check("imagem de biblioteca inativa é recusada no PATCH (400)", r.status === 400, r.status);
    r = await call("GET", `/api/procedure-catalog?q=${tempInactive}`);
    check("item inativo não aparece na lista do catálogo", r.status === 200 && r.data.items.length === 0, `${r.status} ${r.data.items?.length}`);
    r = await call("POST", "/api/procedures", { catalogItemId: tempActive, ...base });
    const tempProc = r.data.procedure;
    check("item ativo temporário habilita com a imagem dele", r.status === 201 && tempProc.image.url === tempData(tempActive, true).imageFile, `${r.status}`);
    await prisma.procedureCatalogItem.update({ where: { id: tempActive }, data: { active: false } });
    const afterOff = await listed(tempProc.id);
    check("procedimento cujo item do catálogo foi desativado continua listado e com imagem", afterOff?.image?.kind === "catalog", JSON.stringify(afterOff?.image));
    r = await call("PATCH", `/api/procedures/${tempProc.id}`, { price: 777 });
    check("procedimento de item desativado continua editável", r.status === 200 && r.data.procedure.price === 777, r.status);
  } finally {
    await prisma.procedure.deleteMany({ where: { clinicId, OR: [{ catalogItemId: { in: tempIds } }, { imageCatalogItemId: { in: tempIds } }] } });
    await prisma.procedureCatalogItem.deleteMany({ where: { id: { in: tempIds } } });
  }
  for (const [query, label] of [["limit=-1&offset=-3", "limit/offset negativos"], ["limit=abc&offset=xyz", "limit/offset em texto"], ["limit=0", "limit zero"], ["limit=100000", "limit enorme"], [`q=${"a".repeat(1000)}`, "busca com 1000 caracteres"], ["q=%00", "busca com NUL"], ["q=%25%5C", "busca com % e barra"]]) {
    r = await call("GET", `/api/procedure-catalog?${query}`);
    check(`catálogo com ${label} responde 200 sem 500`, r.status === 200 && Array.isArray(r.data.items) && r.data.items.length <= 100, `${r.status}`);
  }

  // PATCH: valores.
  const target = (await mkCustom()).data.procedure;
  r = await call("PATCH", `/api/procedures/${target.id}`, { price: 150.5 });
  check("PATCH preço 150.5 grava 150.5", r.status === 200 && r.data.procedure.price === 150.5, `${r.status} ${r.data.procedure?.price}`);
  r = await call("PATCH", `/api/procedures/${target.id}`, { price: "349,90" });
  check("PATCH preço \"349,90\" (vírgula pt-BR) grava 349.9", r.status === 200 && r.data.procedure.price === 349.9, `${r.status} ${r.data.procedure?.price}`);
  r = await call("PATCH", `/api/procedures/${target.id}`, { price: -1 });
  check("PATCH preço negativo grava 0", r.status === 200 && r.data.procedure.price === 0, `${r.status} ${r.data.procedure?.price}`);
  await call("PATCH", `/api/procedures/${target.id}`, { price: 500, durationMinutes: 45 });
  for (const [label, body] of [["preço em texto", { price: "abc" }], ["duração decimal", { durationMinutes: 30.5 }], ["preço null", { price: null }], ["preço vazio", { price: "" }], ["preço booleano", { price: true }], ["duração lista", { durationMinutes: [] }], ["categoria numérica", { category: 5 }]]) {
    r = await call("PATCH", `/api/procedures/${target.id}`, body);
    const after = await listed(target.id);
    check(`PATCH ${label} devolve 400 e nada muda (500/45)`, r.status === 400 && after.price === 500 && after.durationMinutes === 45, `${r.status} ${JSON.stringify([after.price, after.durationMinutes])}`);
  }
  r = await call("PATCH", `/api/procedures/${target.id}`, {});
  check("PATCH com corpo vazio devolve 200 e não muda nada", r.status === 200 && r.data.procedure.price === 500 && r.data.procedure.durationMinutes === 45, r.status);
  r = await call("PATCH", `/api/procedures/${target.id}`, { durationMinutes: 0 });
  check("PATCH duração 0 vira 1", r.status === 200 && r.data.procedure.durationMinutes === 1, `${r.status}`);
  r = await call("PATCH", `/api/procedures/${target.id}`, { margin: 150 });
  check("PATCH com margem legada é ignorado (200, preço intacto, sem margin na resposta)", r.status === 200 && r.data.procedure.price === 500 && !("margin" in r.data.procedure), `${r.status}`);
  for (const sent of [1e30, 3e9]) {
    r = await call("PATCH", `/api/procedures/${target.id}`, { price: sent });
    check(`PATCH preço acima do limite do banco (${sent}) devolve 4xx, não 500`, r.status >= 400 && r.status < 500, r.status);
  }
  r = await call("PATCH", `/api/procedures/${target.id}`, { durationMinutes: 1e10 });
  check("PATCH duração acima do limite do banco devolve 4xx, não 500", r.status >= 400 && r.status < 500, r.status);
  for (const [label, body] of [["nome null", { name: null }], ["nome numérico", { name: 123 }], ["nome 121 caracteres", { name: "Z".repeat(121) }], ["nome NUL", { name: "a\u0000b" }]]) {
    r = await call("PATCH", `/api/procedures/${target.id}`, body);
    check(`PATCH ${label} devolve 400`, r.status === 400, r.status);
  }
  for (const [label, body] of [["imageAssetId numérico", { imageAssetId: 5 }], ["imageAssetId vazio", { imageAssetId: "" }], ["imageAssetId com 101 caracteres", { imageAssetId: "a".repeat(101) }]]) {
    r = await call("PATCH", `/api/procedures/${target.id}`, body);
    check(`PATCH ${label} devolve 400`, r.status === 400, r.status);
  }
  check("recusas de PATCH não alteraram o nome", (await listed(target.id))?.name === target.name);

  // Corridas.
  const raceItem = free[2];
  results = await Promise.all([1, 2, 3, 4].map(() => call("POST", "/api/procedures", { catalogItemId: raceItem.id, ...base })));
  check("4 POST simultâneos do mesmo catalogItemId: 1x 201 e 3x 409, um só no banco", results.map((x) => x.status).sort().join() === "201,409,409,409" && await count({ clinicId, catalogItemId: raceItem.id }) === 1, results.map((x) => x.status).join());
  const raceName = uniq("Corrida");
  results = await Promise.all([1, 2, 3, 4].map(() => call("POST", "/api/procedures", { custom: true, name: raceName, ...base })));
  check("4 POST simultâneos do mesmo nome: 1x 201 e 3x 409, um só no banco", results.map((x) => x.status).sort().join() === "201,409,409,409" && await count({ clinicId, name: raceName }) === 1, results.map((x) => x.status).join());
  const pa = (await mkCustom()).data.procedure, pb = (await mkCustom()).data.procedure;
  const clash = uniq("Alvo");
  results = await Promise.all([call("PATCH", `/api/procedures/${pa.id}`, { name: clash }), call("PATCH", `/api/procedures/${pb.id}`, { name: clash })]);
  check("2 PATCH simultâneos para o mesmo nome: 200 e 409, um só com o nome", results.map((x) => x.status).sort().join() === "200,409" && await count({ clinicId, name: clash }) === 1, results.map((x) => x.status).join());
  results = await Promise.all([call("PATCH", `/api/procedures/${pa.id}`, { price: 111 }), call("PATCH", `/api/procedures/${pa.id}`, { price: 222 })]);
  check("2 PATCH simultâneos de preço: ambos 200 e o valor final é um dos dois", results.every((x) => x.status === 200) && [111, 222].includes((await listed(pa.id)).price), results.map((x) => x.status).join());
  results = await Promise.all([1, 2].map(() => call("POST", "/api/procedures/images", form(png, "d.png", "image/png"))));
  check("2 uploads simultâneos: ambos 201 com ids diferentes", results.every((x) => x.status === 201) && results[0].data.id !== results[1].data.id, results.map((x) => x.status).join());
  const dup = results[0].data.id;
  results = await Promise.all([1, 2, 3].map(() => call("DELETE", `/api/procedures/images/${dup}`)));
  check("3 DELETE simultâneos da mesma imagem órfã: 1x 200 e 2x 404", results.map((x) => x.status).sort().join() === "200,404,404", results.map((x) => x.status).join());
  await call("DELETE", `/api/procedures/images/${(await call("POST", "/api/procedures/images", form(png, "d.png", "image/png"))).data.id}`);
  // Apagar a imagem enquanto um procedimento passa a usá-la: sem 500 e sem procedimento apontando para imagem que sumiu.
  const raceOutcomes = [];
  for (let i = 0; i < 20; i++) {
    const asset = (await call("POST", "/api/procedures/images", form(png, "r.png", "image/png"))).data;
    const [del, create] = await Promise.all([call("DELETE", `/api/procedures/images/${asset.id}`), mkCustom({ imageAssetId: asset.id })]);
    const stillThere = await prisma.procedureImageAsset.count({ where: { id: asset.id } });
    const image = create.status === 201 ? await call("GET", asset.url, null, { raw: true }) : null;
    const consistent = del.status < 500 && create.status < 500 && (create.status !== 201 ? create.status === 400 && del.status === 200 : image.status === 200 && stillThere === 1 && del.status === 409);
    raceOutcomes.push(`${del.status}/${create.status}${image ? `/img${image.status}` : ""}${consistent ? "" : " X"}`);
  }
  check("DELETE da imagem em paralelo com a criação que a usa: sem 500 e sem imagem quebrada", raceOutcomes.every((item) => !item.endsWith(" X")), raceOutcomes.join(" "));

  // Imagens: tamanhos, tipos e conteúdo.
  const sized = [];
  for (const [label, head, type] of [["PNG", png, "image/png"], ["JPEG", jpg, "image/jpeg"], ["WebP", webp, "image/webp"]]) {
    r = await call("POST", "/api/procedures/images", form(padTo(head, mega), `g.${label}`, type));
    if (r.data?.id) sized.push(r.data.id);
    check(`${label} com exatamente 4 MB é aceito`, r.status === 201, r.status);
  }
  r = await call("POST", "/api/procedures/images", form(padTo(png, mega + 1), "g.png", "image/png"));
  check("PNG com 4 MB + 1 byte devolve 413", r.status === 413, r.status);
  r = await call("POST", "/api/procedures/images", form(padTo(webp, mega + 1), "g.webp", "image/webp"));
  check("WebP com 4 MB + 1 byte devolve 413", r.status === 413, r.status);
  r = await call("POST", "/api/procedures/images", form(Buffer.alloc(0), "vazio.png", "image/png"));
  check("arquivo vazio devolve 400", r.status === 400, r.status);
  const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]);
  const wave = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(16)]);
  for (const [label, buffer, name, type] of [
    ["GIF", gif, "a.gif", "image/gif"], ["GIF disfarçado de PNG", gif, "a.png", "image/png"], ["HTML disfarçado de PNG", Buffer.from("<html><script>alert(1)</script></html>"), "a.png", "image/png"],
    ["SVG disfarçado de PNG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "a.png", "image/png"], ["RIFF que não é WebP", wave, "a.webp", "image/webp"], ["PNG declarado JPEG", png, "a.jpg", "image/jpeg"],
    ["PDF", Buffer.from("%PDF-1.4\n%%EOF\n"), "a.pdf", "application/pdf"],
  ]) {
    r = await call("POST", "/api/procedures/images", form(buffer, name, type));
    check(`upload recusado: ${label}`, r.status === 415 || r.status === 400, r.status);
  }
  r = await call("POST", "/api/procedures/images", form(png, "imagem.exe", "image/png"));
  const oddExt = r.data;
  check("extensão enganosa (.exe com bytes de PNG) é aceita pelo conteúdo", r.status === 201, r.status);
  r = await call("GET", oddExt.url, null, { raw: true });
  check("imagem com extensão enganosa é servida como image/png", r.status === 200 && r.headers.get("content-type") === "image/png", `${r.status} ${r.headers.get("content-type")}`);
  r = await call("POST", "/api/procedures/images", form(Buffer.concat([png, Buffer.from("<script>alert(1)</script>")]), "poli.png", "image/png"));
  const poly = r.data;
  const polyGet = await call("GET", poly.url, null, { raw: true });
  check("PNG com HTML anexado é servido como PNG, nosniff, CSP restrita e inline", r.status === 201 && polyGet.headers.get("content-type") === "image/png" && polyGet.headers.get("x-content-type-options") === "nosniff" && polyGet.headers.get("content-security-policy") === "default-src 'none'" && polyGet.headers.get("content-disposition") === "inline", `${r.status} ${polyGet.headers.get("content-type")} ${polyGet.headers.get("content-security-policy")}`);
  const withOther = new FormData(); withOther.set("outro", new Blob([png], { type: "image/png" }), "a.png");
  r = await call("POST", "/api/procedures/images", withOther);
  check("multipart sem o campo file devolve 400", r.status === 400, r.status);
  const asText = new FormData(); asText.set("file", "texto");
  r = await call("POST", "/api/procedures/images", asText);
  check("campo file como texto (não arquivo) devolve 400", r.status === 400, r.status);
  r = await call("POST", "/api/procedures/images", { file: "x" });
  check("upload com JSON devolve 400", r.status === 400, r.status);
  const dims = form(png, "dim.png", "image/png"); dims.set("width", "99999"); dims.set("height", "abc");
  r = await call("POST", "/api/procedures/images", dims);
  const dimRow = r.status === 201 ? await prisma.procedureImageAsset.findUnique({ where: { id: r.data.id }, select: { width: true, height: true } }) : null;
  check("largura/altura inválidas são ignoradas (null) sem recusar o upload", r.status === 201 && dimRow?.width === null && dimRow?.height === null, `${r.status} ${JSON.stringify(dimRow)}`);
  const strayPng = (await call("POST", "/api/procedures/images", form(png, "x.png", "image/png"))).data;
  const strayJpg = (await call("POST", "/api/procedures/images", form(jpg, "x.jpg", "image/jpeg"))).data;
  const strayWebp = (await call("POST", "/api/procedures/images", form(webp, "x.webp", "image/webp"))).data;
  const served = await Promise.all([strayPng, strayJpg, strayWebp].map((item) => call("GET", item.url, null, { raw: true })));
  check("PNG, JPEG e WebP enviados voltam byte a byte com o tipo certo", served[0].buffer.equals(png) && served[0].headers.get("content-type") === "image/png" && served[1].buffer.equals(jpg) && served[1].headers.get("content-type") === "image/jpeg" && served[2].buffer.equals(webp) && served[2].headers.get("content-type") === "image/webp", served.map((x) => `${x.status}:${x.headers.get("content-type")}`).join(" "));

  // Imagem compartilhada por dois procedimentos da mesma clínica.
  const shared = (await call("POST", "/api/procedures/images", form(png, "s.png", "image/png"))).data;
  const holders = [(await mkCustom({ imageAssetId: shared.id })).data.procedure, (await mkCustom({ imageAssetId: shared.id })).data.procedure];
  check("dois procedimentos da mesma clínica usam a mesma imagem", holders.every((item) => item?.image?.url === shared.url));
  r = await call("DELETE", `/api/procedures/images/${shared.id}`);
  check("DELETE de imagem usada por 2 procedimentos devolve 409", r.status === 409 && await prisma.procedureImageAsset.count({ where: { id: shared.id } }) === 1, r.status);
  r = await call("PATCH", `/api/procedures/${holders[0].id}`, { imageAssetId: null, catalogImageId: null });
  check("tirar a imagem de um dos dois não apaga a imagem do outro", r.status === 200 && (await call("GET", shared.url, null, { raw: true })).status === 200 && (await listed(holders[1].id)).image.url === shared.url, r.status);
  r = await call("DELETE", `/api/procedures/images/${shared.id}`);
  check("DELETE continua 409 enquanto resta 1 procedimento usando", r.status === 409, r.status);
  r = await call("PATCH", `/api/procedures/${holders[1].id}`, { imageAssetId: null, catalogImageId: null });
  check("tirar a imagem do último procedimento descarta a imagem", r.status === 200 && (await call("GET", shared.url, null, { raw: true })).status === 404, r.status);

  // Isolamento entre clínicas, ficha técnica, permissões e integração.
  const otherEmail = `e2e-cat2-outra-${run}@example.com`, otherPassword = `E2e-${run}-Outra9!`, otherClinic = `E2E Catalogo Externa2 ${run}`;
  const staffEmail = `e2e-cat2-staff-${run}@example.com`, staffPassword = `E2e-${run}-Staff9!`;
  const proEmail = `e2e-cat2-pro-${run}@example.com`, proPassword = `E2e-${run}-Pro99!`;
  const members = [];
  const material = (await api("POST", "/api/products", { name: `Material Cat ${run}`, kind: "material", unit: "frasco", costCents: 1000, supplier: "Fornecedor", minStock: 0 })).data.product;
  const material2 = (await api("POST", "/api/products", { name: `Material Cat2 ${run}`, kind: "material", unit: "frasco", costCents: 1000, supplier: "Fornecedor", minStock: 0 })).data.product;
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo2", phone: "11999990022", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const foreign = await withSession(other.cookie, async () => ({
        image: (await call("POST", "/api/procedures/images", form(png, "f.png", "image/png"))).data,
        product: (await api("POST", "/api/products", { name: `Material Externo ${run}`, kind: "material", unit: "frasco", costCents: 1000, supplier: "F", minStock: 0 })).data.product,
        enableSame: await call("POST", "/api/procedures", { catalogItemId: raceItem.id, ...base }),
        sameName: await call("POST", "/api/procedures", { custom: true, name: raceName, ...base }),
      }));
      check("outra clínica habilita o mesmo item do catálogo e usa o mesmo nome (únicos só por clínica)", foreign.enableSame.status === 201 && foreign.sameName.status === 201, `${foreign.enableSame.status}/${foreign.sameName.status}`);
      const mine = (await mkCustom()).data.procedure;
      r = await call("POST", "/api/procedures", { custom: true, name: uniq("Roubo"), imageAssetId: foreign.image.id, ...base });
      check("usar imagem de outra clínica na criação devolve 400", r.status === 400, r.status);
      r = await call("PATCH", `/api/procedures/${mine.id}`, { imageAssetId: foreign.image.id });
      check("usar imagem de outra clínica no PATCH devolve 400 e nada muda", r.status === 400 && (await listed(mine.id)).image.kind === "none", r.status);
      r = await call("GET", foreign.image.url, null, { raw: true });
      check("GET da imagem de outra clínica devolve 404", r.status === 404, r.status);
      r = await call("DELETE", foreign.image.url);
      check("DELETE da imagem de outra clínica devolve 404", r.status === 404, r.status);
      r = await call("POST", "/api/procedures", { custom: true, name: uniq("FichaAlheia"), technicalSheet: [{ productId: foreign.product.id, quantity: 1 }], ...base });
      check("ficha técnica com material de outra clínica devolve 400", r.status === 400, `${r.status} ${JSON.stringify(r.data)}`);
      r = await call("PATCH", `/api/procedures/${mine.id}`, { technicalSheet: [{ productId: foreign.product.id, quantity: 1 }] });
      check("PATCH de ficha técnica com material de outra clínica devolve 400", r.status === 400, r.status);
      const foreignIds = await withSession(other.cookie, async () => (await call("GET", "/api/procedures")).data.procedures.map((item) => item.id));
      check("a clínica externa não enxerga os procedimentos da clínica de teste", !foreignIds.includes(mine.id) && foreignIds.length === 2, foreignIds.length);
    } else {
      check("segunda clínica criada para testar isolamento (lacunas do catálogo)", false, `registro ${r.status} login ${other?.status}`);
    }

    // Ficha técnica: personalizado e catálogo.
    r = await mkCustom({ technicalSheet: [{ productId: material.id, quantity: 2 }] });
    const sheetCustom = r.data.procedure;
    check("ficha técnica salva na criação do personalizado", r.status === 201 && sheetOf(sheetCustom) === `${material.id}:2` && sheetCustom.technicalSheet[0].name === material.name, `${r.status} ${sheetOf(sheetCustom)}`);
    r = await call("POST", "/api/procedures", { catalogItemId: free[3].id, technicalSheet: [{ productId: material.id, quantity: 1 }], ...base });
    const sheetCatalog = r.data.procedure;
    check("ficha técnica salva na criação do item do catálogo", r.status === 201 && sheetOf(sheetCatalog) === `${material.id}:1`, `${r.status} ${sheetOf(sheetCatalog)}`);
    for (const [label, procedure] of [["personalizado", sheetCustom], ["catálogo", sheetCatalog]]) {
      r = await call("PATCH", `/api/procedures/${procedure.id}`, { technicalSheet: [{ productId: material2.id, quantity: 3 }] });
      check(`ficha técnica atualizada no ${label} substitui a anterior`, r.status === 200 && sheetOf(r.data.procedure) === `${material2.id}:3` && r.data.procedure.materialsNeedReview === false, `${r.status} ${sheetOf(r.data.procedure)}`);
      r = await call("PATCH", `/api/procedures/${procedure.id}`, { price: 901, name: uniq("SemTocarFicha") });
      check(`PATCH sem technicalSheet no ${label} mantém a ficha`, r.status === 200 && sheetOf(r.data.procedure) === `${material2.id}:3`, `${r.status} ${sheetOf(r.data.procedure)}`);
      r = await call("PATCH", `/api/procedures/${procedure.id}`, { technicalSheet: [{ productId: material.id, quantity: 1 }, { productId: material.id, quantity: 2 }] });
      check(`ficha com material repetido no ${label} devolve 400 e mantém a anterior`, r.status === 400 && sheetOf(await listed(procedure.id)) === `${material2.id}:3`, r.status);
      for (const quantity of [0, -1, "abc", null]) {
        r = await call("PATCH", `/api/procedures/${procedure.id}`, { technicalSheet: [{ productId: material.id, quantity }] });
        check(`ficha com quantidade ${JSON.stringify(quantity)} no ${label} devolve 400`, r.status === 400, r.status);
      }
      r = await call("PATCH", `/api/procedures/${procedure.id}`, { technicalSheet: [{ productId: "naoexiste", quantity: 1 }] });
      check(`ficha com material inexistente no ${label} devolve 400`, r.status === 400, r.status);
      results = await Promise.all([call("PATCH", `/api/procedures/${procedure.id}`, { technicalSheet: [{ productId: material.id, quantity: 1 }] }), call("PATCH", `/api/procedures/${procedure.id}`, { technicalSheet: [{ productId: material2.id, quantity: 1 }, { productId: material.id, quantity: 2 }] })]);
      const finalSheet = sheetOf(await listed(procedure.id));
      check(`2 PATCH simultâneos de ficha no ${label}: sem 500 e ficha final igual a uma das duas`, results.every((x) => x.status < 500) && [`${material.id}:1`, [`${material2.id}:1`, `${material.id}:2`].sort().join()].includes(finalSheet), `${results.map((x) => x.status).join()} ${finalSheet}`);
      r = await call("PATCH", `/api/procedures/${procedure.id}`, { technicalSheet: [] });
      check(`ficha vazia limpa a ficha do ${label}`, r.status === 200 && r.data.procedure.technicalSheet.length === 0, `${r.status}`);
    }
    await call("PATCH", `/api/procedures/${sheetCustom.id}`, { price: 901 });

    // Permissões: sem sessão, STAFF e PROFESSIONAL.
    const anon = await withSession("", async () => [
      await call("POST", "/api/procedures", { custom: true, name: uniq("Anon"), ...base }), await call("PATCH", `/api/procedures/${sheetCustom.id}`, { price: 1 }),
      await call("GET", "/api/procedures"), await call("DELETE", "/api/procedures/images/qualquer"), await call("GET", "/api/quotes/options"), await call("GET", "/api/agenda/bootstrap"),
    ]);
    check("sem sessão: POST/PATCH/GET de procedimentos, DELETE de imagem, quotes/options e agenda devolvem 401", anon.every((item) => item.status === 401), anon.map((item) => item.status).join());
    const kept = (await call("POST", "/api/procedures/images", form(png, "k.png", "image/png"))).data;
    for (const [role, memberEmail, memberPassword] of [["STAFF", staffEmail, staffPassword], ["PROFESSIONAL", proEmail, proPassword]]) {
      r = await api("POST", "/api/team", { name: `E2E ${role} Catalogo2`, email: memberEmail, password: memberPassword, role });
      if (r.status === 201) members.push(r.data.member);
      const session = r.status === 201 ? await loginAs(memberEmail, memberPassword) : null;
      if (session?.status !== 200) { check(`usuário ${role} criado para as lacunas de permissão`, false, `team ${r.status} login ${session?.status}`); continue; }
      await withSession(session.cookie, async () => {
        const attempts = [
          ["habilitar do catálogo", () => call("POST", "/api/procedures", { catalogItemId: free[4].id, ...base })],
          ["criar personalizado", () => call("POST", "/api/procedures", { custom: true, name: uniq(`Nao ${role}`), ...base })],
          ["criar com corpo inválido", () => call("POST", "/api/procedures", "{oops")],
          ["editar preço", () => call("PATCH", `/api/procedures/${sheetCustom.id}`, { price: 1 })],
          ["editar com corpo inválido", () => call("PATCH", `/api/procedures/${sheetCustom.id}`, "null")],
          ["editar ficha técnica", () => call("PATCH", `/api/procedures/${sheetCustom.id}`, { technicalSheet: [] })],
          ["editar procedimento inexistente", () => call("PATCH", "/api/procedures/naoexiste", { price: 1 })],
          ["enviar imagem", () => call("POST", "/api/procedures/images", form(png, "n.png", "image/png"))],
          ["apagar imagem órfã", () => call("DELETE", kept.url)],
          ["apagar imagem inexistente", () => call("DELETE", "/api/procedures/images/naoexiste")],
          ["listar procedimentos do cadastro", () => call("GET", "/api/procedures")],
        ];
        for (const [label, fn] of attempts) { const response = await fn(); check(`${role}: ${label} devolve 403`, response.status === 403, `${label} ${response.status}`); }
        check(`${role}: nada foi alterado pelas tentativas`, await prisma.procedureImageAsset.count({ where: { id: kept.id } }) === 1 && !(await prisma.procedure.findFirst({ where: { clinicId, name: { startsWith: `E2E Nao ${role}` } } })) && (await prisma.procedure.findUnique({ where: { id: sheetCustom.id }, select: { price: true } })).price === 901, role);
        r = await call("GET", kept.url, null, { raw: true });
        check(`${role}: lê a imagem enviada (200)`, r.status === 200 && r.buffer.equals(png), r.status);
        r = await call("GET", "/api/procedure-catalog?limit=3");
        check(`${role}: lê o catálogo paginado (200)`, r.status === 200 && r.data.items.length === 3 && r.data.total >= 30, r.status);
        r = await call("GET", "/api/quotes/options");
        check(`${role}: quotes/options traz image em todos os procedimentos`, r.status === 200 && r.data.procedures.length > 0 && r.data.procedures.every((item) => item.image && ["custom", "catalog", "none"].includes(item.image.kind)), r.status);
      });
    }
    await call("DELETE", kept.url);
    for (const id of [...sized, strayPng.id, strayJpg.id, strayWebp.id, oddExt.id, poly.id]) await call("DELETE", `/api/procedures/images/${id}`);

    // Integração: orçamento, sessão, agendamento e início usando catálogo, personalizado e renomeado.
    const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
    const renamedBeforeQuote = (await call("POST", "/api/procedures", { catalogItemId: free[6].id, ...base })).data.procedure;
    const renamedProc = (await call("PATCH", `/api/procedures/${renamedBeforeQuote.id}`, { name: uniq("RenomeadoInt"), price: 1200 })).data.procedure;
    const integrationProcs = [
      ["catálogo", (await call("POST", "/api/procedures", { catalogItemId: free[5].id, ...base })).data.procedure],
      ["personalizado", (await mkCustom({ price: "349,90" })).data.procedure],
      ["renomeado", renamedProc],
    ];
    for (const [label, proc] of integrationProcs) {
      const patientId = (await api("POST", "/api/patients", { name: `E2E Cat Int ${label} ${run}`, phone: "11999990081", age: 35, cpf: randomCpf() })).data.patient?.id;
      const journey = (await api("POST", `/api/patients/${patientId}/journeys`, { name: `E2E Cat ${label} ${run}`, professionalId: professional?.id })).data.journey;
      const evaluation = (await api("PUT", `/api/patients/${patientId}/evaluation`, { journeyId: journey.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
      const quote = await api("POST", "/api/quotes", { patientId, journeyId: journey.id, evaluationId: evaluation.id, details: [{ procedureId: proc.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" });
      check(`integração (${label}): orçamento criado com o nome e o valor do procedimento`, quote.status === 201 && String(quote.data.quote.items).includes(proc.name) && quote.data.quote.total === proc.price, `${quote.status} ${quote.data.quote?.items} ${quote.data.quote?.total} vs ${proc.price}`);
      if (label === "personalizado") {
        const triple = await api("POST", "/api/quotes", { patientId, journeyId: journey.id, evaluationId: evaluation.id, details: [{ procedureId: proc.id, quantity: 3, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "", status: "Rascunho" });
        check("centavos: 349,90 x3 = 1049,70 no orçamento", triple.status === 201 && triple.data.quote.total === 1049.7, `${triple.status} ${triple.data.quote?.total}`);
      }
      for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${quote.data.quote.id}`, { status, evaluationId: evaluation.id });
      const session = (await api("POST", `/api/patients/${patientId}/procedure-sessions`, { journeyId: journey.id, quoteId: quote.data.quote.id, procedureId: proc.id })).data.session;
      check(`integração (${label}): sessão criada com o nome do procedimento`, session?.procedureName === proc.name, session?.procedureName);
      const appointment = await api("POST", "/api/appointments", { patientId, journeyId: journey.id, procedure: `Procedimento - ${proc.name}`, professional: `Prof ${patientId}`, date: day(5), time: "10:00" });
      check(`integração (${label}): agendamento criado`, appointment.status === 201, `${appointment.status} ${JSON.stringify(appointment.data).slice(0, 120)}`);
      const upload = new FormData();
      upload.set("file", new Blob([pdf], { type: "application/pdf" }), "Termo.pdf"); upload.set("category", "TERMOS"); upload.set("signatureStatus", "ASSINADO"); upload.set("journeyId", journey.id);
      await fetch(`${baseUrl}/api/patients/${patientId}/documents`, { method: "POST", headers: { cookie }, body: upload });
      const started = await api("PATCH", `/api/patients/${patientId}/procedure-sessions/${session.id}`, { status: "Em execução", technique: "E2E técnica", treatedAreas: "E2E região", professional: "E2E Prof", photos: [{ id: `ph-${run}-${label}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 }] });
      check(`integração (${label}): início da sessão move o agendamento para hoje`, started.status === 200 && started.data.appointment?.id === appointment.data.appointment?.id && started.data.appointment.date === day(0), `${started.status} ${JSON.stringify(started.data.appointment ?? started.data).slice(0, 160)}`);
      const quoteOption = (await api("GET", "/api/quotes/options")).data.procedures.find((item) => item.id === proc.id);
      check(`integração (${label}): quotes/options traz o procedimento com a imagem esperada`, quoteOption?.image?.kind === (label === "personalizado" ? "none" : "catalog"), JSON.stringify(quoteOption?.image));
      const afterRename = await api("PATCH", `/api/procedures/${proc.id}`, { name: uniq("DepoisDoInicio") });
      const sessionNow = (await api("GET", `/api/patients/${patientId}/procedure-sessions?journeyId=${journey.id}&quoteId=${quote.data.quote.id}`)).data.sessions?.find((item) => item.id === session.id);
      check(`integração (${label}): renomear depois do início não altera a sessão em andamento`, afterRename.status === 200 && sessionNow?.procedureName === proc.name && sessionNow.status === "Em execução", `${afterRename.status} ${sessionNow?.procedureName} ${sessionNow?.status}`);
    }
  } finally {
    for (const member of members) await api("DELETE", "/api/team", { membershipId: member.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [otherEmail, staffEmail, proEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [otherEmail, staffEmail, proEmail] } } });
  }
}

// Paginação e carregamento sob demanda: lista de clientes paginada no servidor, busca limitada para seletores e agenda por período.
async function paginationSuite() {
  const tag = `Pg${run}`;
  const mk = (name, phone, extra = {}) => api("POST", "/api/patients", { name, phone, age: 30, cpf: randomCpf(), ...extra });
  const baseline = (await api("GET", "/api/patients?pageSize=1")).data.summary;
  const N = baseline.total + 30;
  const baseInativa = baseline.byStatus?.Inativa ?? 0, baseAtiva = baseline.byStatus?.Ativa ?? 0;
  const created = [];
  for (let i = 1; i <= 24; i += 1) created.push((await mk(`${tag} Paciente ${String(i).padStart(2, "0")}`, `119880${String(1000 + i)}`)).data.patient);
  const special = {
    jose: (await mk(`${tag} José Álvaro`, "11988002001")).data.patient,
    angela: (await mk(`${tag} Ângela`, "11988002002")).data.patient,
    conceicao: (await mk(`${tag} Conceição`, "11988002003")).data.patient,
    off: (await mk(`${tag} 50% Off`, "11988002004")).data.patient,
    inativoA: (await mk(`${tag} Inativo A`, "11988002005", { status: "Inativa" })).data.patient,
    inativoB: (await mk(`${tag} Inativo B`, "11988002006", { status: "Inativa" })).data.patient,
  };
  const all = [...created, ...Object.values(special)];
  check("paginação: 30 pacientes criados para o roteiro", all.length === 30 && all.every(Boolean), `${all.filter(Boolean).length}`);
  const list = (query = "") => api("GET", `/api/patients${query ? `?${query}` : ""}`);
  const ids = (r) => (r.data.patients ?? []).map((item) => item.id);
  const names = (r) => (r.data.patients ?? []).map((item) => item.name);

  // Padrão e formato.
  let r = await list();
  check("lista sem parâmetros: página 1, 20 por página, total e resumo corretos", r.status === 200 && r.data.patients.length === 20 && JSON.stringify(r.data.pagination) === JSON.stringify({ page: 1, pageSize: 20, total: N, pageCount: Math.ceil(N / 20) }) && r.data.summary.total === N, `${r.status} ${JSON.stringify(r.data.pagination)} ${JSON.stringify(r.data.summary)}`);
  const item = r.data.patients[0];
  check("lista: item enxuto (sem relações), com etapa atual", item && !("procedureRecords" in item) && !("updatedAt" in item) && ["evaluation", "quote", "procedure", "return"].includes(item.currentStage) && ["id", "name", "cpf", "phone", "age", "status", "lastVisit", "nextReturn", "totalValue", "createdAt"].every((key) => key in item), JSON.stringify(item));

  // Páginas consecutivas: sem duplicar nem perder, na mesma ordem de uma lista única.
  const single = await list("page=1&pageSize=100");
  const walked = [];
  const sizes = [];
  const pages10 = Math.ceil(N / 10);
  for (let page = 1; page <= pages10 + 1; page += 1) { const p = await list(`page=${page}&pageSize=10`); walked.push(...ids(p)); sizes.push(p.data.patients.length); }
  const expectedSizes = [...Array.from({ length: pages10 }, (_, i) => (i < pages10 - 1 ? 10 : N - 10 * (pages10 - 1))), 0];
  check("paginação: pageSize=10 percorre todos os itens sem duplicar nem perder, na ordem da lista única", JSON.stringify(sizes) === JSON.stringify(expectedSizes) && new Set(walked).size === N && JSON.stringify(walked) === JSON.stringify(ids(single)), `${sizes} ${new Set(walked).size}`);
  check("paginação: todos os pacientes criados aparecem exatamente uma vez", all.every((patient) => walked.filter((id) => id === patient.id).length === 1), "");
  const sortedNames = names(single);
  check("ordenação por nome é estável (nomes iguais desempatam por id, repetir devolve a mesma ordem)", JSON.stringify(ids(await list("page=1&pageSize=100"))) === JSON.stringify(ids(single)) && sortedNames.indexOf(`${tag} Paciente 01`) < sortedNames.indexOf(`${tag} Paciente 02`), "");

  // Limites e valores inválidos viram valores seguros (200, nunca 400/500).
  const safe = [["page=0", 1, 20], ["page=-3", 1, 20], ["page=abc", 1, 20], ["page=2.5", 1, 20], ["pageSize=0", 1, 20], ["pageSize=-5", 1, 20], ["pageSize=abc", 1, 20], ["pageSize=1000", 1, 100], ["pageSize=101", 1, 100], ["pageSize=100", 1, 100], ["page=99999999999999999999", 1, 20], ["sort=zzz", 1, 20], ["q=%27%3B%20DROP%20TABLE%20%22Patient%22%3B--", 1, 20]];
  const outcomes = [];
  for (const [query] of safe) { const x = await list(query); outcomes.push([query, x.status, x.data.pagination?.page, x.data.pagination?.pageSize]); }
  check("parâmetros inválidos ou extremos: 200 com valores seguros (pageSize máx. 100)", outcomes.every(([, status, page, pageSize], index) => status === 200 && page === safe[index][1] && pageSize === safe[index][2]), JSON.stringify(outcomes.filter(([, status, page, pageSize], index) => !(status === 200 && page === safe[index][1] && pageSize === safe[index][2]))));
  check("a clínica ainda tem todos os pacientes depois da busca com SQL malicioso", (await list("pageSize=100")).data.pagination.total === N, "");
  r = await list("page=999&pageSize=10");
  check("página além do fim: lista vazia com total e pageCount corretos", r.status === 200 && r.data.patients.length === 0 && r.data.pagination.total === N && r.data.pagination.pageCount === Math.ceil(N / 10) && r.data.pagination.page === 999, JSON.stringify(r.data.pagination));
  r = await list("page=100000&pageSize=100");
  check("página máxima aceita sem erro", r.status === 200 && r.data.patients.length === 0, r.status);

  // Busca: nome, telefone, status; sem acento e sem diferenciar caixa.
  const found = async (q, extra = "") => ids(await list(`q=${encodeURIComponent(q)}&pageSize=100${extra}`));
  check("busca por nome (parte, caixa diferente)", (await found(`${tag} paciente 07`)).join() === created[6].id && (await found(`${tag.toUpperCase()} PACIENTE 07`)).join() === created[6].id, "");
  check("busca sem acento encontra nome com acento (jose -> José, angela -> Ângela, conceicao -> Conceição)", (await found(`${tag} jose alvaro`)).join() === special.jose.id && (await found("ANGELA")).includes(special.angela.id) && (await found("conceicao")).includes(special.conceicao.id), "");
  check("busca com acento encontra o mesmo (Álvaro, Conceição)", (await found("Álvaro")).includes(special.jose.id) && (await found("CONCEIÇÃO")).includes(special.conceicao.id), "");
  check("busca por telefone", (await found("1198801005")).join() === created[4].id && (await found("119880100")).length === 9, "");
  check("busca por status ('inativa' encontra os dois cadastrados como Inativa)", (await found("inativa")).sort().join() === [special.inativoA.id, special.inativoB.id].sort().join(), "");
  check("busca em nome + telefone na mesma consulta (campos concatenados como na tela antiga)", (await found(`Paciente 03 119880`)).join() === created[2].id, "");
  check("coringas do LIKE na busca são literais (% só acha '50% Off', _ não acha nada)", (await found("%")).join() === special.off.id && (await found("_")).length === 0 && (await found("50% off")).join() === special.off.id, "");
  check("busca sem resultado: lista vazia com total 0 (resumo da clínica continua o mesmo)", await (async () => { const x = await list("q=naoexistexyz"); return x.status === 200 && x.data.patients.length === 0 && x.data.pagination.total === 0 && x.data.pagination.pageCount === 0 && x.data.summary.total === N; })(), "");
  r = await list(`q=${encodeURIComponent(tag)}&pageSize=10&page=3`);
  check("busca + paginação: total da busca = 30, 3ª página com 10 itens", r.data.pagination.total === 30 && r.data.patients.length === 10 && r.data.pagination.pageCount === 3, JSON.stringify(r.data.pagination));
  const searchWalk = [];
  for (let page = 1; page <= 3; page += 1) searchWalk.push(...ids(await list(`q=${encodeURIComponent(tag)}&pageSize=10&page=${page}`)));
  const mineSet = new Set(all.map((patient) => patient.id));
  check("busca paginada devolve a mesma ordem da lista única, sem duplicar", JSON.stringify(searchWalk) === JSON.stringify(ids(single).filter((id) => mineSet.has(id))), "");

  // Filtro de status, ordenação por cadastro e resumo.
  r = await list("status=Inativa&pageSize=100");
  check("filtro status=Inativa: 2 pacientes meus, total confere", r.data.pagination.total === 2 + baseInativa && r.data.patients.every((p) => p.status === "Inativa"), JSON.stringify(r.data.pagination));
  r = await list(`status=Inativa&q=${encodeURIComponent("Inativo A")}`);
  check("filtro de status combina com a busca", r.data.pagination.total === 1 && r.data.patients[0].id === special.inativoA.id, JSON.stringify(r.data.pagination));
  const recent = [];
  for (let page = 1; page <= 6; page += 1) recent.push(...ids(await list(`sort=recent&page=${page}&pageSize=5`)));
  check("sort=recent: mais novo primeiro, 30 itens sem duplicar em páginas de 5", recent[0] === special.inativoB.id && new Set(recent).size === 30 && recent.length === 30, `${recent.length} ${new Set(recent).size}`);
  r = await list("pageSize=10&page=2&q=Paciente");
  check("resumo (summary) conta a clínica toda, independente de página e busca", r.data.summary.total === N && r.data.summary.byStatus.Ativa === 28 + baseAtiva && (r.data.summary.byStatus.Inativa ?? 0) === 2 + baseInativa, JSON.stringify(r.data.summary));

  // Busca limitada para seletores (agendamento, orçamento, pagamento).
  r = await api("GET", `/api/patients/lookup?q=${encodeURIComponent(tag)}`);
  check("lookup: padrão de 8 resultados, só id/name/cpf", r.status === 200 && r.data.patients.length === 8 && r.data.patients.every((p) => Object.keys(p).sort().join() === "cpf,id,name"), `${r.status} ${r.data.patients?.length}`);
  r = await api("GET", `/api/patients/lookup?q=${encodeURIComponent(tag)}&limit=500`);
  check("lookup: limit acima do máximo vira 20", r.data.patients.length === 20, r.data.patients?.length);
  r = await api("GET", `/api/patients/lookup?q=${encodeURIComponent(tag)}&limit=3`);
  check("lookup: limit=3 devolve 3", r.data.patients.length === 3, r.data.patients?.length);
  r = await api("GET", "/api/patients/lookup?q=alvaro");
  check("lookup: nome sem acento", r.data.patients.some((p) => p.id === special.jose.id), JSON.stringify(r.data.patients));
  r = await api("GET", `/api/patients/lookup?q=${encodeURIComponent(created[3].cpf ?? "")}`);
  check("lookup: busca por CPF", r.data.patients.length === 1 && r.data.patients[0].id === created[3].id, JSON.stringify(r.data.patients));
  r = await api("GET", "/api/patients/lookup");
  const oneLetter = await api("GET", "/api/patients/lookup?q=P");
  const twoLetters = await api("GET", "/api/patients/lookup?q=Pg");
  check("lookup sem termo ou com 1 caractere devolve lista vazia; com 2 caracteres pesquisa", r.status === 200 && r.data.patients.length === 0 && oneLetter.status === 200 && oneLetter.data.patients.length === 0 && twoLetters.data.patients.length > 0, `${oneLetter.data.patients?.length}/${twoLetters.data.patients?.length}`);
  r = await api("GET", "/api/patients/lookup?q=0%25");
  check("lookup: coringa % é literal", r.data.patients.length === 1 && r.data.patients[0].id === special.off.id, JSON.stringify(r.data.patients));

  // Um paciente (abrir perfil fora da página) e opções sem lista de pacientes.
  r = await api("GET", `/api/patients/${special.angela.id}`);
  check("GET /api/patients/{id} devolve o paciente no formato da lista", r.status === 200 && r.data.patient.id === special.angela.id && r.data.patient.currentStage && !("procedureRecords" in r.data.patient), `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  r = await api("GET", "/api/patients/inexistente-xyz");
  check("GET /api/patients/{id} inexistente => 404", r.status === 404, r.status);
  r = await api("GET", "/api/quotes/options");
  check("quotes/options não carrega mais a lista de pacientes", r.status === 200 && !("patients" in r.data) && Array.isArray(r.data.procedures), `${r.status} ${Object.keys(r.data)}`);
  r = await api("GET", "/api/agenda/bootstrap");
  check("agenda/bootstrap só traz dados estáticos (sem agendamentos nem pacientes)", r.status === 200 && !("appointments" in r.data) && !("patients" in r.data) && Array.isArray(r.data.procedures) && Array.isArray(r.data.members) && r.data.settings?.openingTime, `${r.status} ${Object.keys(r.data)}`);

  // Agenda por período.
  const clinicId = (await prisma.patient.findUnique({ where: { id: all[0].id }, select: { clinicId: true } })).clinicId;
  const instant = (d) => new Date(`${d}T12:00:00-03:00`);
  const seed = (patient, d, time, extra = {}) => prisma.appointment.create({ data: { clinicId, patientId: patient.id, date: instant(d), time, procedure: "Retorno", professional: `Prof Pg ${run}`, status: "Agendado", notes: "reservado", ...extra } });
  const a = {
    dec31: await seed(all[0], "2030-12-31", "10:00"),
    jan01: await seed(all[1], "2031-01-01", "09:00"),
    jan31: await seed(all[2], "2031-01-31", "08:00"),
    feb01: await seed(all[3], "2031-02-01", "08:00"),
    feb10legacy: await seed(all[4], "2031-02-10", "14:00", { date: new Date("2031-02-10T00:00:00.000Z") }),
    feb28late: await seed(all[5], "2031-02-28", "23:30"),
    feb28early: await seed(all[6], "2031-02-28", "00:00"),
    mar01: await seed(all[7], "2031-03-01", "00:00"),
    mar01b: await seed(all[8], "2031-03-01", "09:30"),
  };
  const period = (from, to) => api("GET", `/api/agenda?from=${from}&to=${to}`);
  const pids = (x) => (x.data.appointments ?? []).map((item) => item.id);
  const want = (...keys) => keys.map((key) => a[key].id);
  r = await period("2031-02-01", "2031-02-28");
  check("agenda mês (fev/2031): inclui primeiro e último dia, o do banco à meia-noite UTC e 23:30; exclui 31/01 e 01/03", r.status === 200 && JSON.stringify(pids(r)) === JSON.stringify(want("feb01", "feb10legacy", "feb28early", "feb28late")) && r.data.total === 4, `${r.status} ${pids(r).length}`);
  r = await period("2031-03-01", "2031-03-31");
  check("agenda mês (mar/2031): só os de março, ordenados por horário", JSON.stringify(pids(r)) === JSON.stringify(want("mar01", "mar01b")), `${pids(r).length}`);
  r = await period("2031-01-31", "2031-01-31");
  check("agenda dia: só o dia pedido", JSON.stringify(pids(r)) === JSON.stringify(want("jan31")), `${pids(r).length}`);
  r = await period("2030-12-29", "2031-01-04");
  check("agenda semana na virada do ano: 31/12 e 01/01 juntos, sem 31/01", JSON.stringify(pids(r)) === JSON.stringify(want("dec31", "jan01")), `${pids(r).length}`);
  r = await period("2031-02-27", "2031-03-01");
  check("agenda na virada de mês: 28/02 (00:00 e 23:30) e 01/03 entram", JSON.stringify(pids(r)) === JSON.stringify(want("feb28early", "feb28late", "mar01", "mar01b")), `${pids(r).length}`);
  r = await period("2031-02-02", "2031-02-09");
  check("agenda sem atendimentos no período: lista vazia", r.status === 200 && r.data.appointments.length === 0 && r.data.total === 0, `${r.status}`);
  r = await period("2031-02-28", "2031-02-28");
  const row = r.data.appointments?.[0];
  check("agenda: item enxuto {id,patientId,date,time,procedure,professional,status,patient:{name}}, sem observações", row && Object.keys(row).sort().join() === "date,id,patient,patientId,procedure,professional,status,time" && Object.keys(row.patient).join() === "name" && String(row.date).slice(0, 10) === "2031-02-28", JSON.stringify(row));
  const bad = [[null, null], ["2031-02-01", null], [null, "2031-02-01"], ["2031-02-30", "2031-03-01"], ["2031-13-01", "2031-13-02"], ["20310201", "20310202"], ["2031-02-10", "2031-02-01"], ["2031-01-01", "2031-12-31"], ["abc", "def"]];
  const badStatuses = [];
  for (const [from, to] of bad) badStatuses.push((await api("GET", `/api/agenda?${[from && `from=${from}`, to && `to=${to}`].filter(Boolean).join("&")}`)).status);
  check("agenda: parâmetros ausentes, inválidos, invertidos ou período > 93 dias => 400", badStatuses.every((status) => status === 400), badStatuses.join());
  check("agenda: período de exatamente 93 dias é aceito", (await period("2031-01-01", "2031-04-03")).status === 200 && (await period("2031-01-01", "2031-04-04")).status === 400, "");

  // Vencidos: "Agendado" cujo fim já passou, em qualquer período (alimenta o "Faltou" automático da Agenda).
  const old = await seed(all[10], "2020-03-10", "09:00");
  const oldInService = await seed(all[11], "2020-03-10", "10:00", { status: "Em atendimento" });
  const oldDone = await seed(all[12], "2020-03-10", "11:00", { status: "Atendido" });
  const oldCancelled = await seed(all[13], "2020-03-10", "12:00", { status: "Cancelado" });
  const clock = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date());
  const todayKey = clock.slice(0, 10);
  const nowMinutes = Number(clock.slice(11, 13)) * 60 + Number(clock.slice(14, 16));
  const future = await seed(all[14], day(5), "09:00");
  const ongoing = nowMinutes >= 60 ? await seed(all[15], todayKey, `${String(Math.floor((nowMinutes - 30) / 60)).padStart(2, "0")}:${String((nowMinutes - 30) % 60).padStart(2, "0")}`) : null;
  const finished = nowMinutes >= 150 ? await seed(all[16], todayKey, `${String(Math.floor((nowMinutes - 120) / 60)).padStart(2, "0")}:${String((nowMinutes - 120) % 60).padStart(2, "0")}`) : null;
  r = await api("GET", "/api/agenda/overdue");
  const overdueIds = (r.data.appointments ?? []).map((item) => item.id);
  check("overdue: Agendado vencido num período que a tela não carregou aparece, com campos enxutos", r.status === 200 && overdueIds.includes(old.id) && Object.keys(r.data.appointments[0]).sort().join() === "date,id,patient,patientId,procedure,professional,status,time", `${r.status} ${overdueIds.length}`);
  check("overdue: nunca traz Em atendimento, Atendido, Cancelado nem futuro", ![oldInService, oldDone, oldCancelled, future].some((item) => overdueIds.includes(item.id)) && r.data.appointments.every((item) => item.status === "Agendado"), "");
  check("overdue: hoje só entra depois do fim real (início + duração): em andamento fora, encerrado dentro", (!ongoing || !overdueIds.includes(ongoing.id)) && (!finished || overdueIds.includes(finished.id)), `${ongoing ? overdueIds.includes(ongoing.id) : "-"} ${finished ? overdueIds.includes(finished.id) : "-"}`);
  await prisma.appointment.createMany({ data: Array.from({ length: 205 }, (_, index) => ({ clinicId, patientId: all[17].id, date: instant("2019-05-01"), time: `${String(Math.floor(index / 12) + 6).padStart(2, "0")}:${String((index % 12) * 5).padStart(2, "0")}`, procedure: "Retorno", professional: `Prof Antigo ${run}`, status: "Agendado", notes: "" })) });
  r = await api("GET", "/api/agenda/overdue");
  const times = (r.data.appointments ?? []).map((item) => `${String(item.date).slice(0, 10)} ${item.time}`);
  check("overdue: no máximo 200, dos mais antigos para os mais novos", r.status === 200 && r.data.appointments.length === 200 && JSON.stringify(times) === JSON.stringify([...times].sort()) && String(r.data.appointments[0].date).startsWith("2019-05-01"), `${r.data.appointments?.length} ${times[0]}`);

  // Fluxo real: criar, alterar e excluir pela API aparece no período certo.
  const target = day(3);
  const createdAppt = await api("POST", "/api/appointments", { patientId: all[9].id, procedure: "Retorno", professional: `Prof Fluxo ${run}`, time: "15:00", date: target });
  const inDay = async () => pids(await period(target, target));
  check("agenda: agendamento criado pela API aparece no período do dia e não no dia seguinte", createdAppt.status === 201 && (await inDay()).includes(createdAppt.data.appointment.id) && !pids(await period(day(4), day(4))).includes(createdAppt.data.appointment.id), `${createdAppt.status}`);
  await api("PATCH", `/api/appointments/${createdAppt.data.appointment.id}`, { status: "Cancelado" });
  check("agenda: status alterado aparece na consulta seguinte", (await period(target, target)).data.appointments.find((x) => x.id === createdAppt.data.appointment.id)?.status === "Cancelado", "");
  await api("DELETE", `/api/appointments/${createdAppt.data.appointment.id}`);
  check("agenda: agendamento excluído some do período", !(await inDay()).includes(createdAppt.data.appointment.id), "");

  // Outra clínica, STAFF e PROFESSIONAL, sem sessão.
  const otherEmail = `e2e-pg-outra-${run}@example.com`, otherPassword = `E2e-${run}-Outra9!`, otherClinic = `E2E Paginacao Externa ${run}`;
  const staffEmail = `e2e-pg-staff-${run}@example.com`, staffPassword = `E2e-${run}-Staff9!`;
  const proEmail = `e2e-pg-pro-${run}@example.com`, proPassword = `E2e-${run}-Pro99!`;
  const members = [];
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990020", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const probe = await withSession(other.cookie, async () => {
        const mine = (await api("POST", "/api/patients", { name: `${tag} Externo`, phone: "11977770000", age: 40, cpf: randomCpf() })).data.patient;
        const otherClinicId = (await prisma.patient.findUnique({ where: { id: mine.id }, select: { clinicId: true } })).clinicId;
        await prisma.appointment.create({ data: { clinicId: otherClinicId, patientId: mine.id, date: instant("2031-02-10"), time: "11:00", procedure: "Retorno", professional: "Externo", status: "Agendado", notes: "" } });
        return {
          mine,
          list: await api("GET", `/api/patients?q=${encodeURIComponent(tag)}&pageSize=100`),
          lookup: await api("GET", `/api/patients/lookup?q=${encodeURIComponent(special.jose.name)}`),
          single: await api("GET", `/api/patients/${special.jose.id}`),
          agenda: await api("GET", "/api/agenda?from=2031-02-01&to=2031-02-28"),
        };
      });
      check("outra clínica: lista só traz os próprios pacientes (1) e o resumo não soma os meus", probe.list.status === 200 && probe.list.data.pagination.total === 1 && probe.list.data.patients[0].id === probe.mine.id && probe.list.data.summary.total === 1, JSON.stringify(probe.list.data.pagination));
      check("outra clínica: lookup não encontra paciente da minha clínica; GET por id => 404", probe.lookup.data.patients.length === 0 && probe.single.status === 404, `${probe.lookup.data.patients?.length} ${probe.single.status}`);
      check("outra clínica: agenda do período só mostra o agendamento dela", probe.agenda.status === 200 && probe.agenda.data.appointments.length === 1 && probe.agenda.data.appointments[0].professional === "Externo", JSON.stringify(probe.agenda.data.appointments?.map((x) => x.professional)));
      const mineAgain = await period("2031-02-01", "2031-02-28");
      const mineList = await list(`q=${encodeURIComponent(tag)}&pageSize=100`);
      const otherOverdue = await withSession(other.cookie, () => api("GET", "/api/agenda/overdue"));
      check("overdue: outra clínica não enxerga os vencidos da minha (e não vaza os dela para mim)", otherOverdue.status === 200 && otherOverdue.data.appointments.length === 0, JSON.stringify(otherOverdue.data).slice(0, 100));
      check("minha clínica não vê agendamento nem paciente da outra", mineAgain.data.appointments.every((x) => x.professional !== "Externo") && !mineList.data.patients.some((p) => p.id === probe.mine.id) && mineList.data.pagination.total === 30, `${mineList.data.pagination.total}`);
    } else check("paginação: outra clínica criada", false, `register ${r.status}`);

    for (const [role, memberEmail, memberPassword] of [["STAFF", staffEmail, staffPassword], ["PROFESSIONAL", proEmail, proPassword]]) {
      const made = await api("POST", "/api/team", { name: `E2E ${role} Pg`, email: memberEmail, password: memberPassword, role });
      if (made.status === 201) members.push(made.data.member);
      const session = made.status === 201 ? await loginAs(memberEmail, memberPassword) : null;
      if (session?.status !== 200) { check(`paginação: usuário ${role} criado`, false, `team ${made.status} login ${session?.status}`); continue; }
      const out = await withSession(session.cookie, async () => ({
        list: await api("GET", "/api/patients?pageSize=10"),
        search: await api("GET", `/api/patients?q=${encodeURIComponent("ângela")}`),
        lookup: await api("GET", "/api/patients/lookup?q=jose"),
        agenda: await api("GET", "/api/agenda?from=2031-02-01&to=2031-02-28"),
        boot: await api("GET", "/api/agenda/bootstrap"),
        overdue: await api("GET", "/api/agenda/overdue"),
      }));
      check(`${role}: lê lista paginada, busca, lookup, agenda por período e bootstrap (200)`, out.list.status === 200 && out.list.data.pagination.total === N && out.search.data.patients.length === 1 && out.lookup.status === 200 && out.agenda.status === 200 && out.agenda.data.appointments.length === 4 && out.boot.status === 200 && out.overdue.status === 200, `${out.list.status}/${out.search.status}/${out.lookup.status}/${out.agenda.status}/${out.boot.status}`);
    }

    const anon = await withSession("", async () => [await api("GET", "/api/patients"), await api("GET", "/api/patients/lookup?q=a"), await api("GET", `/api/patients/${all[0].id}`), await api("GET", "/api/agenda?from=2031-02-01&to=2031-02-28"), await api("GET", "/api/agenda/overdue")]);
    check("sem sessão: lista, lookup, paciente, agenda por período e overdue devolvem 401", anon.every((x) => x.status === 401), anon.map((x) => x.status).join());
  } finally {
    for (const member of members) await api("DELETE", "/api/team", { membershipId: member.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [otherEmail, staffEmail, proEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [otherEmail, staffEmail, proEmail] } } });
  }
}

// Lacunas da paginação, numa clínica externa nova (vazia), para não depender dos pacientes das outras partes:
// 0/1/2/exatos pacientes, empates de nome e de createdAt, mutações entre páginas, busca hostil, resumo, agenda nos extremos,
// permissões por papel e desempenho com 200 pacientes.
async function paginationGaps() {
  const tag = `Pgx${run}`;
  const gapEmail = `e2e-pgx-${run}@example.com`, gapPassword = `E2e-${run}-Gap99!`, gapClinic = `E2E Paginacao Lacunas ${run}`;
  const staffEmail = `e2e-pgx-staff-${run}@example.com`, staffPassword = `E2e-${run}-Stf99!`;
  const proEmail = `e2e-pgx-pro-${run}@example.com`, proPassword = `E2e-${run}-Pro99!`;
  const members = [];
  const reg = await withSession("", () => api("POST", "/api/auth/register", { clinicName: gapClinic, name: "E2E Lacunas", phone: "11999990030", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: gapEmail, password: gapPassword }));
  const gap = reg.status === 201 ? await loginAs(gapEmail, gapPassword) : null;
  if (gap?.status !== 200) { check("paginação (lacunas): clínica de apoio criada", false, `register ${reg.status}`); return; }
  try {
    await withSession(gap.cookie, async () => {
      const clinicId = (await prisma.clinic.findFirst({ where: { name: gapClinic }, select: { id: true } })).id;
      const list = (query = "") => api("GET", `/api/patients${query ? `?${query}` : ""}`);
      const ids = (x) => (x.data.patients ?? []).map((item) => item.id);
      const bulk = (count, name, extra = {}) => prisma.patient.createMany({ data: Array.from({ length: count }, (_, i) => ({ clinicId, name: typeof name === "function" ? name(i) : name, phone: `1197${String(1000000 + i).slice(-7)}`, age: 30, ...extra })) });
      const walk = async (query, pageSize) => {
        const seen = [];
        for (let page = 1; page <= 200; page += 1) { const x = await list(`${query}${query ? "&" : ""}page=${page}&pageSize=${pageSize}`); if (!x.data.patients?.length) break; seen.push(...ids(x)); }
        return seen;
      };

      // Clínica vazia.
      let r = await list();
      check("clínica vazia: lista [], página 1, total 0, pageCount 0, resumo zerado", r.status === 200 && r.data.patients.length === 0 && JSON.stringify(r.data.pagination) === JSON.stringify({ page: 1, pageSize: 20, total: 0, pageCount: 0 }) && r.data.summary.total === 0 && Object.keys(r.data.summary.byStatus).length === 0, JSON.stringify(r.data));
      check("clínica vazia: page=5, sort=recent, status e q não quebram", (await Promise.all(["page=5", "sort=recent", "status=Ativa", "q=abc", "pageSize=100&page=2"].map((query) => list(query)))).every((x) => x.status === 200 && x.data.patients.length === 0 && x.data.pagination.total === 0), "");
      r = await api("GET", "/api/patients/lookup?q=a");
      check("clínica vazia: lookup devolve lista vazia", r.status === 200 && r.data.patients.length === 0, JSON.stringify(r.data));
      r = await api("GET", "/api/agenda?from=2031-02-01&to=2031-02-28");
      check("clínica vazia: agenda do período vazia e bootstrap sem agendamentos nem pacientes", r.status === 200 && r.data.total === 0 && (await api("GET", "/api/agenda/bootstrap")).status === 200, `${r.status}`);

      // 1 e 2 pacientes.
      const one = (await api("POST", "/api/patients", { name: `${tag} Unico`, phone: "11988880001", age: 30 })).data.patient;
      r = await list();
      check("1 paciente: total 1, pageCount 1, resumo 1", r.data.patients.length === 1 && r.data.pagination.total === 1 && r.data.pagination.pageCount === 1 && r.data.summary.total === 1 && r.data.summary.byStatus.Ativa === 1, JSON.stringify(r.data.pagination));
      await api("POST", "/api/patients", { name: `${tag} Segundo`, phone: "11988880002", age: 31 });
      r = await list("pageSize=1&page=2");
      check("2 pacientes com pageSize=1: pageCount 2 e a página 2 traz o último por nome (Unico depois de Segundo)", r.data.pagination.pageCount === 2 && r.data.patients.length === 1 && r.data.patients[0].id === one.id && r.data.summary.total === 2, JSON.stringify(r.data.pagination));
      await prisma.patient.deleteMany({ where: { clinicId } });

      // Tamanhos exatos: pageSize, pageSize+1, 100 e 101.
      await bulk(10, (i) => `${tag} Exato ${String(i).padStart(3, "0")}`);
      r = await list("pageSize=10");
      check("exatamente pageSize (10): 1 página, 10 itens", r.data.patients.length === 10 && r.data.pagination.pageCount === 1 && r.data.pagination.total === 10, JSON.stringify(r.data.pagination));
      await bulk(1, `${tag} Exato 010`);
      const [p1, p2, p3] = [await list("pageSize=10&page=1"), await list("pageSize=10&page=2"), await list("pageSize=10&page=3")];
      check("pageSize+1 (11 com 10): 2 páginas, 10 + 1 + 0, sem repetir", p1.data.pagination.pageCount === 2 && p1.data.patients.length === 10 && p2.data.patients.length === 1 && p3.data.patients.length === 0 && new Set([...ids(p1), ...ids(p2)]).size === 11, `${p1.data.patients.length}/${p2.data.patients.length}/${p3.data.patients.length}`);
      await prisma.patient.deleteMany({ where: { clinicId } });
      await bulk(100, (i) => `${tag} Cem ${String(i).padStart(3, "0")}`);
      r = await list("pageSize=100");
      check("exatamente 100 com pageSize=100: 1 página de 100", r.data.patients.length === 100 && r.data.pagination.pageCount === 1, JSON.stringify(r.data.pagination));
      await bulk(1, `${tag} Cem 100`);
      const [h1, h2] = [await list("pageSize=100&page=1"), await list("pageSize=100&page=2")];
      const h3 = await list("pageSize=1000&page=2");
      check("101 pacientes: pageSize=100 devolve 100 + 1; pageSize=1000 vira 100 (mesma página 2)", h1.data.patients.length === 100 && h2.data.patients.length === 1 && h1.data.pagination.pageCount === 2 && JSON.stringify(ids(h3)) === JSON.stringify(ids(h2)) && h3.data.pagination.pageSize === 100, `${h1.data.patients.length}/${h2.data.patients.length}`);
      await prisma.patient.deleteMany({ where: { clinicId } });

      // 200 pacientes com empates: 60 com o mesmo nome e todos com o mesmo createdAt (um único INSERT).
      await bulk(60, `${tag} Homonimo`);
      await bulk(140, (i) => `${tag} Lote ${String(i % 70).padStart(2, "0")}`);
      const all = (await prisma.patient.findMany({ where: { clinicId }, select: { id: true, createdAt: true } }));
      const sameCreatedAt = new Set(all.map((p) => p.createdAt.getTime())).size;
      check("preparo: 200 pacientes, com empates de nome (60 homônimos, 70 pares) e createdAt em poucos instantes", all.length === 200 && sameCreatedAt <= 2, `${all.length} createdAt distintos=${sameCreatedAt}`);
      const universe = new Set(all.map((p) => p.id));
      for (const sort of ["name", "recent"]) {
        const reference = await walk(`sort=${sort}`, 100);
        const outcomes = [];
        for (const size of [7, 10, 13, 50]) { const seen = await walk(`sort=${sort}`, size); outcomes.push(`${size}:${seen.length}/${new Set(seen).size}/${JSON.stringify(seen) === JSON.stringify(reference)}`); }
        check(`200 pacientes, sort=${sort} com empates: pageSize 7/10/13/50/100 percorrem exatamente o conjunto (sem duplicar nem perder) na mesma ordem`, reference.length === 200 && new Set(reference).size === 200 && reference.every((id) => universe.has(id)) && outcomes.every((x) => x.endsWith("true") && x.split(":")[1].startsWith("200/200")), outcomes.join(" "));
      }
      const homonymWalk = await walk(`q=${encodeURIComponent("homonimo")}`, 7);
      check("busca com 60 homônimos paginada de 7 em 7: 60 distintos, total 60", homonymWalk.length === 60 && new Set(homonymWalk).size === 60 && (await list(`q=homonimo&pageSize=7`)).data.pagination.total === 60, `${homonymWalk.length}`);

      // Desempenho e concorrência.
      await prisma.patient.updateMany({ where: { clinicId, name: { contains: "Lote 05" } }, data: { name: `${tag} Conceição Lote` } });
      const t0 = performance.now();
      const accent = await list(`q=${encodeURIComponent("conceicao")}&pageSize=100`);
      const accentMs = Math.round(performance.now() - t0);
      const t1 = performance.now();
      const fullWalk = await walk("", 20);
      const walkMs = Math.round(performance.now() - t1);
      check(`200 pacientes: busca com acento acha os renomeados (${accentMs} ms) e percorrer 10 páginas leva ${walkMs} ms`, accent.status === 200 && accent.data.pagination.total === (await prisma.patient.count({ where: { clinicId, name: { contains: "Conceição" } } })) && accent.data.pagination.total > 0 && fullWalk.length === 200 && accentMs < 3000 && walkMs < 15000, `acento=${accentMs}ms total=${accent.data.pagination?.total}; 10 páginas=${walkMs}ms`);
      const t2 = performance.now();
      const parallel = await Promise.all([list("pageSize=50"), list(`q=${encodeURIComponent("conceição")}`), list("sort=recent&page=2&pageSize=20"), api("GET", "/api/patients/lookup?q=lote"), list("status=Ativa&pageSize=100&page=2")]);
      check(`5 consultas simultâneas (lista, busca, recentes, lookup, status) sem erro 5xx (${Math.round(performance.now() - t2)} ms)`, parallel.every((x) => x.status === 200), parallel.map((x) => x.status).join());

      // Mutação entre páginas: criar e excluir mudam total/resumo e a ordem continua sem duplicar dentro de uma página.
      const before = await list("pageSize=10&page=1");
      const created = (await api("POST", "/api/patients", { name: `${tag} AAA Novo`, phone: "11988889999", age: 33 })).data.patient;
      const after1 = await list("pageSize=10&page=1");
      const after2 = await list("pageSize=10&page=2");
      check("criar paciente entre páginas: total e resumo sobem em 1, o novo (nome menor) abre a página 1 e o 10º vai para a página 2 (sem perder ninguém)", after1.data.pagination.total === 201 && after1.data.summary.total === 201 && after1.data.patients[0].id === created.id && after2.data.patients[0].id === before.data.patients[9].id, `${after1.data.pagination.total} ${after1.data.patients[0]?.name}`);
      await prisma.patient.update({ where: { id: created.id }, data: { status: "Arquivada" } });
      r = await list("pageSize=10");
      check("resumo muda ao arquivar: byStatus.Arquivada = 1 e total continua 201; lista por status=Arquivada devolve só ele", r.data.summary.byStatus.Arquivada === 1 && r.data.summary.byStatus.Ativa === 200 && r.data.summary.total === 201 && JSON.stringify(ids(await list("status=Arquivada"))) === JSON.stringify([created.id]), JSON.stringify(r.data.summary));
      await prisma.patient.delete({ where: { id: created.id } });
      r = await list("pageSize=10&q=aaa%20novo");
      check("excluir paciente: resumo volta a 200 e o paciente some da busca e do GET por id", (await list("pageSize=10")).data.summary.total === 200 && r.data.pagination.total === 0 && (await api("GET", `/api/patients/${created.id}`)).status === 404, "");

      // Busca hostil: o SQL cru não pode ser injetado nem quebrar; total e lista batem.
      await prisma.patient.createMany({ data: [
        { clinicId, name: `${tag} Barra\\Invertida`, phone: "11977000001", age: 30 },
        { clinicId, name: `${tag} Aspas'Simples "Duplas"`, phone: "11977000002", age: 30 },
        { clinicId, name: `${tag} Sublinha_Nome 100%`, phone: "11977000003", age: 30 },
        { clinicId, name: `${tag} Ponto;Virgula -- <script>`, phone: "11977000004", age: 30 },
        { clinicId, name: `${tag} Emoji 😀 Zoë`, phone: "11977000005", age: 30 },
      ] });
      const hostile = [["\\", "Barra\\Invertida"], ["'", "Aspas'Simples"], ['"Duplas"', "Aspas'Simples"], ["_Nome", "Sublinha_Nome"], ["100%", "Sublinha_Nome"], [";", "Ponto;Virgula"], ["--", "Ponto;Virgula"], ["<script>", "Ponto;Virgula"], ["😀", "Emoji"], ["zoe", "Emoji"]];
      const hostileResults = [];
      for (const [q, expected] of hostile) { const x = await list(`q=${encodeURIComponent(q)}&pageSize=100`); hostileResults.push([q, x.status, x.data.pagination?.total, (x.data.patients ?? []).some((p) => p.name.includes(expected)), x.data.patients?.length === x.data.pagination?.total]); }
      check("busca com \\ ' \" _ % ; -- <script> emoji acha o paciente certo e total = tamanho da lista", hostileResults.every(([, status, , found, consistent]) => status === 200 && found && consistent), JSON.stringify(hostileResults.filter(([, status, , found, consistent]) => !(status === 200 && found && consistent))));
      const payloads = ["' OR '1'='1", "'; DROP TABLE \"Patient\"; --", "%' OR 1=1 --", "\\' OR 1=1", "${1+1}", "a'||(select 1)||'"];
      const injected = await Promise.all(payloads.map((q) => list(`q=${encodeURIComponent(q)}&pageSize=100`)));
      check("payloads de injeção não devolvem pacientes, não dão 5xx e a tabela continua intacta", injected.every((x) => x.status === 200 && x.data.pagination.total === 0 && x.data.patients.length === 0) && (await prisma.patient.count({ where: { clinicId } })) === 205, injected.map((x) => `${x.status}/${x.data.pagination?.total}`).join(" "));
      const wide = [["only spaces", "q=%20%20%20%20"], ["q muito longa (1500)", `q=${"a".repeat(1500)}`], ["q repetido", `q=${encodeURIComponent(tag)}&q=zzz`], ["status injetado", `status=${encodeURIComponent("Ativa' OR '1'='1")}`], ["status longo", `status=${"x".repeat(500)}`], ["sort injetado", "sort=name;DROP"], ["page array", "page=1&page=2&pageSize=5&pageSize=7"], ["page=1.5", "page=1.5"], ["page=1e2", "page=1e2&pageSize=1e1"], ["page= 2", "page=%202"], ["pageSize=0x10", "pageSize=0x10"]];
      const wideResults = [];
      for (const [label, query] of wide) { const x = await list(query); wideResults.push([label, x.status, x.data.pagination?.page, x.data.pagination?.pageSize, x.data.pagination?.total]); }
      check("parâmetros estranhos (espaços, 1500 letras, repetidos, status/sort injetados, 1e2, 0x10) => 200", wideResults.every((x) => x[1] === 200), JSON.stringify(wideResults));
      check("só espaços na busca = sem busca; q repetido usa o primeiro; status inexistente = 0; q longa trunca sem erro", wideResults[0][4] === 205 && wideResults[2][4] === 205 && wideResults[3][4] === 0 && wideResults[1][4] === 0, JSON.stringify(wideResults.map((x) => x[4])));
      const nul = [await list("q=a%00b"), await api("GET", "/api/patients/lookup?q=a%00b"), await api("GET", "/api/patients/abc%00def"), await list("status=a%00b")];
      check("byte nulo (%00) em q, lookup, id e status não gera erro 500", nul.every((x) => x.status < 500), nul.map((x) => x.status).join());
      check("GET /api/patients/{id}: id de 5000 caracteres e com ../ => 404", (await api("GET", `/api/patients/${"a".repeat(5000)}`)).status === 404 && (await api("GET", "/api/patients/..%2F..%2Fx")).status === 404 && (await api("GET", `/api/patients/${one.id}`)).status === 404, "");

      // Unicode: NFC e NFD na busca e no cadastro.
      const nfdName = `${tag} José Nfd`, nfcName = `${tag} José Nfc`;
      await prisma.patient.createMany({ data: [{ clinicId, name: nfdName, phone: "11977000010", age: 30 }, { clinicId, name: nfcName, phone: "11977000011", age: 30 }] });
      const nfdFound = async (q) => (await list(`q=${encodeURIComponent(q)}&pageSize=100`)).data.patients.map((p) => p.name.normalize("NFC"));
      check("busca por 'jose nfc'/'José NFC'/forma NFD acha o cadastrado em NFC", (await nfdFound("jose nfc")).length === 1 && (await nfdFound("José nfc")).length === 1 && (await nfdFound("José nfc")).length === 1, "");
      check("busca encontra paciente cadastrado com nome em NFD (acento decomposto, ex.: colado do macOS)", (await nfdFound("jose nfd")).length === 1 && (await nfdFound("José nfd")).length === 1, `jose nfd=${(await nfdFound("jose nfd")).length}; José(NFC) nfd=${(await nfdFound("José nfd")).length}`);

      // Telefone com e sem máscara.
      await prisma.patient.create({ data: { clinicId, name: `${tag} Mascara`, phone: "(11) 98800-4321", age: 30, cpf: "52998224725" } });
      const phoneOnes = [];
      for (const q of ["(11) 98800-4321", "98800-4321", "98800", "(11)"]) phoneOnes.push((await list(`q=${encodeURIComponent(q)}`)).data.pagination.total >= 1);
      check("telefone com máscara é achado digitando a máscara ou um pedaço dela", phoneOnes.every(Boolean), phoneOnes.join());
      await prisma.patient.create({ data: { clinicId, name: `${tag} Cpf Formatado`, phone: "11977000020", age: 30, cpf: "111.444.777-35" } });
      const lookupCpf = async (q) => (await api("GET", `/api/patients/lookup?q=${encodeURIComponent(q)}`)).data.patients.length;
      check("lookup acha o CPF exatamente como foi cadastrado (só dígitos e formatado)", (await lookupCpf("52998224725")) === 1 && (await lookupCpf("111.444.777-35")) === 1, "");
      check("lookup acha o CPF formatado digitando só os dígitos (e vice-versa)", (await lookupCpf("11144477735")) === 1 && (await lookupCpf("529.982.247-25")) === 1, `dígitos->formatado=${await lookupCpf("11144477735")} formatado->dígitos=${await lookupCpf("529.982.247-25")}`);

      // Lookup: limites, campos e termos curtos.
      const limits = [];
      for (const limit of ["0", "-1", "21", "abc", "1.5", "", "3&limit=9"]) limits.push([limit, (await api("GET", `/api/patients/lookup?q=${encodeURIComponent(tag)}&limit=${limit}`)).data.patients?.length]);
      check("lookup: limit 0/-1/abc/1.5/vazio => 8, 21 => 20, 3&limit=9 => 3 (primeiro valor; 1.5 e 0 não viram 1)", JSON.stringify(limits) === JSON.stringify([["0", 8], ["-1", 8], ["21", 20], ["abc", 8], ["1.5", 8], ["", 8], ["3&limit=9", 3]]), JSON.stringify(limits));
      r = await api("GET", `/api/patients/lookup?q=${encodeURIComponent(tag)}&limit=20`);
      check("lookup: só id, name e cpf em cada item (nenhum campo clínico, telefone ou status)", r.data.patients.length === 20 && r.data.patients.every((p) => Object.keys(p).sort().join() === "cpf,id,name"), JSON.stringify(Object.keys(r.data.patients[0] ?? {})));
      check("lookup: uma letra devolve vazio (mínimo 2 caracteres), 2 letras pesquisam, só espaços e vazio devolvem lista vazia, q enorme não quebra", (await api("GET", "/api/patients/lookup?q=l")).data.patients.length === 0 && (await api("GET", "/api/patients/lookup?q=lo")).data.patients.length === 8 && (await api("GET", "/api/patients/lookup?q=%20%20")).data.patients.length === 0 && (await api("GET", `/api/patients/lookup?q=${"z".repeat(3000)}`)).status === 200, "");

      // Agenda: extremos, domingo, viradas, bissexto, status, ordenação, outro paciente.
      const patient = (await api("POST", "/api/patients", { name: `${tag} Agenda`, phone: "11977111111", age: 30 })).data.patient;
      const noon = (d) => new Date(`${d}T12:00:00-03:00`);
      const slot = (key, d, time, extra = {}) => prisma.appointment.create({ data: { clinicId, patientId: patient.id, date: noon(d), time, procedure: "Retorno", professional: `Prof ${key}`, status: "Agendado", notes: "", ...extra } });
      const s = {
        fromStart: await slot("fromStart", "2032-02-27", "00:00"),
        fromEnd: await slot("fromEnd", "2032-02-27", "23:30"),
        leap: await slot("leap", "2032-02-29", "10:00"),
        sunday: await slot("sunday", "2032-02-29", "09:00", { status: "Atendido" }),
        toStart: await slot("toStart", "2032-03-02", "00:00", { status: "Cancelado" }),
        toEnd: await slot("toEnd", "2032-03-02", "23:30", { status: "Em atendimento" }),
        beforeFrom: await slot("beforeFrom", "2032-02-26", "23:30"),
        afterTo: await slot("afterTo", "2032-03-03", "00:00"),
        yearEnd: await slot("yearEnd", "2032-12-31", "23:30"),
        yearStart: await slot("yearStart", "2033-01-01", "00:00"),
        tieB: await slot("tieB", "2032-05-10", "10:00"),
        tieA: await slot("tieA", "2032-05-10", "10:00"),
        early: await slot("early", "2032-05-10", "08:00"),
        midnightLegacy: await slot("midnightLegacy", "2032-06-15", "13:00", { date: new Date("2032-06-15T00:00:00.000Z") }),
      };
      const rows = async (from, to) => (await api("GET", `/api/agenda?from=${from}&to=${to}`)).data.appointments ?? [];
      const keyOf = (row) => Object.entries(s).find(([, v]) => v.id === row.id)?.[0];
      let got = await rows("2032-02-27", "2032-03-02");
      check("agenda: 00:00 e 23:30 do primeiro e do último dia entram; dia anterior e posterior ficam de fora", got.map(keyOf).sort().join() === ["fromStart", "fromEnd", "leap", "sunday", "toStart", "toEnd"].sort().join(), got.map(keyOf).join());
      check("agenda: ordenada por data, hora e id (09:00 antes de 10:00 no dia 29/02 bissexto) e cancelado/atendido/em atendimento aparecem com o status", JSON.stringify(got.map(keyOf)) === JSON.stringify(["fromStart", "fromEnd", "sunday", "leap", "toStart", "toEnd"]) && got.find((x) => keyOf(x) === "toStart").status === "Cancelado" && got.find((x) => keyOf(x) === "sunday").status === "Atendido" && got.find((x) => keyOf(x) === "toEnd").status === "Em atendimento", JSON.stringify(got.map(keyOf)));
      got = await rows("2032-05-10", "2032-05-10");
      const tied = [s.tieA.id, s.tieB.id].sort();
      check("agenda: mesmo dia e hora desempatam por id; 08:00 vem primeiro", JSON.stringify(got.map((x) => x.id)) === JSON.stringify([s.early.id, ...tied]), got.map(keyOf).join());
      check("agenda: domingo 29/02/2032 (bissexto) pedido sozinho devolve os 2 atendimentos dele, e 29/02/2031 inexistente => 400", (await rows("2032-02-29", "2032-02-29")).length === 2 && (await api("GET", "/api/agenda?from=2031-02-29&to=2031-02-29")).status === 400, "");
      check("agenda: virada de ano 31/12 23:30 e 01/01 00:00 caem cada um no seu período", JSON.stringify((await rows("2032-12-01", "2032-12-31")).map(keyOf)) === JSON.stringify(["yearEnd"]) && JSON.stringify((await rows("2033-01-01", "2033-01-31")).map(keyOf)) === JSON.stringify(["yearStart"]) && JSON.stringify((await rows("2032-12-31", "2033-01-01")).map(keyOf)) === JSON.stringify(["yearEnd", "yearStart"]), "");
      check("agenda: linha legada à meia-noite UTC aparece no dia dela e em nenhum vizinho", JSON.stringify((await rows("2032-06-15", "2032-06-15")).map(keyOf)) === JSON.stringify(["midnightLegacy"]) && (await rows("2032-06-14", "2032-06-14")).length === 0 && (await rows("2032-06-16", "2032-06-16")).length === 0, "");
      check("agenda: 93 dias aceito e 94 recusado também atravessando fevereiro bissexto", (await api("GET", "/api/agenda?from=2032-01-15&to=2032-04-16")).status === 200 && (await api("GET", "/api/agenda?from=2032-01-15&to=2032-04-17")).status === 400, "");
      const edge = [await api("GET", "/api/agenda?from=2032-2-3&to=2032-02-05"), await api("GET", "/api/agenda?from=2032-13-01&to=2032-13-02"), await api("GET", "/api/agenda?from=2032-02-30&to=2032-03-01"), await api("GET", "/api/agenda?from=2032-02-05&to=2032-02-04"), await api("GET", "/api/agenda?from=2032-02-05T00:00:00Z&to=2032-02-06"), await api("GET", "/api/agenda?from=&to="), await api("GET", "/api/agenda")];
      check("agenda: 2032-2-3, mês 13, 30/02, invertido, com hora, vazio e ausente => 400", edge.every((x) => x.status === 400 && typeof x.data.message === "string"), edge.map((x) => x.status).join());
      const farFuture = await api("GET", "/api/agenda?from=9999-12-30&to=9999-12-31");
      check("agenda: ano 9999 (fora de 1970 a 2100) => 400, nunca 5xx", farFuture.status === 400, `${farFuture.status}`);
      check("agenda: item enxuto e sem observações/materiais mesmo com notas no banco", await (async () => { await prisma.appointment.update({ where: { id: s.leap.id }, data: { notes: "nota clínica secreta", materialsCheck: "ok" } }); const x = (await rows("2032-02-29", "2032-02-29")).find((row) => row.id === s.leap.id); return x && !JSON.stringify(x).includes("secreta") && Object.keys(x).sort().join() === "date,id,patient,patientId,procedure,professional,status,time"; })(), "");

      // Agendamento criado pela API no último dia do período e à meia-noite.
      const apiDay = day(20);
      const viaApi = await api("POST", "/api/appointments", { patientId: patient.id, procedure: "Retorno", professional: `Prof Api ${run}`, time: "23:30", date: apiDay });
      check("agendamento 23:30 criado pela API aparece no período que termina nesse dia e não no que termina na véspera", viaApi.status === 201 ? (await rows(day(10), apiDay)).some((x) => x.id === viaApi.data.appointment.id) && !(await rows(day(10), day(19))).some((x) => x.id === viaApi.data.appointment.id) : true, `POST ${viaApi.status}`);

      // Papéis na clínica de apoio: comparar o que ADMIN, PROFESSIONAL e STAFF veem hoje.
      const adminList = await list("pageSize=100&q=lote");
      const adminLookup = await api("GET", "/api/patients/lookup?q=lote&limit=20");
      const adminAgenda = await api("GET", "/api/agenda?from=2032-02-27&to=2032-03-02");
      const adminBootstrap = await api("GET", "/api/agenda/bootstrap");
      const options = await api("GET", "/api/quotes/options");
      for (const [role, memberEmail, memberPassword] of [["STAFF", staffEmail, staffPassword], ["PROFESSIONAL", proEmail, proPassword]]) {
        const made = await api("POST", "/api/team", { name: `E2E ${role} Pgx`, email: memberEmail, password: memberPassword, role });
        if (made.status === 201) members.push(made.data.member);
        const session = made.status === 201 ? await loginAs(memberEmail, memberPassword) : null;
        if (session?.status !== 200) { check(`paginação (lacunas): usuário ${role} criado`, false, `team ${made.status}`); continue; }
        const seen = await withSession(session.cookie, async () => ({
          list: await list("pageSize=100&q=lote"), lookup: await api("GET", "/api/patients/lookup?q=lote&limit=20"),
          agenda: await api("GET", "/api/agenda?from=2032-02-27&to=2032-03-02"), boot: await api("GET", "/api/agenda/bootstrap"),
          one: await api("GET", `/api/patients/${ids(adminList)[0]}`), options: await api("GET", "/api/quotes/options"),
        }));
        check(`${role}: vê o mesmo que o ADMIN na lista, lookup, agenda, bootstrap, paciente e opções de orçamento (mesmos ids e mesmos campos)`,
          JSON.stringify(ids(seen.list)) === JSON.stringify(ids(adminList)) && JSON.stringify(Object.keys(seen.list.data.patients[0]).sort()) === JSON.stringify(Object.keys(adminList.data.patients[0]).sort())
          && JSON.stringify(seen.lookup.data.patients) === JSON.stringify(adminLookup.data.patients) && JSON.stringify(seen.agenda.data.appointments) === JSON.stringify(adminAgenda.data.appointments)
          && seen.boot.status === 200 && JSON.stringify(Object.keys(seen.boot.data).sort()) === JSON.stringify(Object.keys(adminBootstrap.data).sort())
          && seen.one.status === 200 && seen.options.status === 200 && !("patients" in seen.options.data) && Object.keys(seen.options.data).sort().join() === Object.keys(options.data).sort().join(),
          [seen.list, seen.lookup, seen.agenda, seen.boot, seen.one, seen.options].map((x) => x.status).join());
        check(`${role}: nenhum campo clínico (avaliação, fotos, notas) na lista, no lookup, no paciente e na agenda`, ![seen.list, seen.lookup, seen.agenda, seen.one].some((x) => /photo|evaluation|anamnes|observation|notes|materials/i.test(JSON.stringify(x.data, (key, value) => (key === "currentStage" ? undefined : value)))), "");
      }
    });
  } finally {
    for (const member of members) await withSession(gap.cookie, () => api("DELETE", "/api/team", { membershipId: member.id }));
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [gapEmail, staffEmail, proEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: gapClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [gapEmail, staffEmail, proEmail] } } });
  }
}

// GET /api/patients/active-procedures: sessões "Em execução" da clínica logada (ADMIN/PROFESSIONAL; STAFF não).
async function activeProcedures() {
  const url = "/api/patients/active-procedures";
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const dataUrl = `data:image/png;base64,${pngB64}`;
  const staffEmail = `e2e-ap-staff-${run}@example.com`, staffPassword = `E2e-${run}-Staff9!`;
  const proEmail = `e2e-ap-pro-${run}@example.com`, proPassword = `E2e-${run}-Pro99!`;
  const otherEmail = `e2e-ap-outra-${run}@example.com`, otherPassword = `E2e-${run}-Outra9!`, otherClinic = `E2E ProcAtivos Externa ${run}`;
  const members = [];
  // Cria paciente, jornada, avaliação, orçamento aprovado e sessão (Rascunho) pelas rotas, na sessão atual.
  const mkSession = async (label) => {
    const procName = `E2E AP Proc ${label} ${run}`;
    await api("POST", "/api/procedures", { name: procName, category: "Facial", price: 500, durationMinutes: 30, margin: 30 });
    const proc = (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === procName);
    const patient = (await api("POST", "/api/patients", { name: `E2E AP Paciente ${label} ${run}`, phone: "11999990060", age: 33, cpf: randomCpf() })).data.patient;
    const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
    const journey = (await api("POST", `/api/patients/${patient.id}/journeys`, { name: `E2E AP Jornada ${label} ${run}`, professionalId: professional?.id })).data.journey;
    const ev = (await api("PUT", `/api/patients/${patient.id}/evaluation`, { journeyId: journey.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
    const q = await api("POST", "/api/quotes", { patientId: patient.id, journeyId: journey.id, evaluationId: ev.id, details: [{ procedureId: proc.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" });
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote.id}`, { status, evaluationId: ev.id });
    const s = await api("POST", `/api/patients/${patient.id}/procedure-sessions`, { journeyId: journey.id, quoteId: q.data.quote.id });
    return { patient, journey, procName, session: s.data.session };
  };
  try {
    let r = await withSession("", () => api("GET", url));
    check("procedimentos ativos: sem sessão => 401", r.status === 401, r.status);

    r = await api("GET", url);
    check("procedimentos ativos: clínica sem sessões em execução => lista vazia", r.status === 200 && Array.isArray(r.data.sessions) && r.data.sessions.length === 0, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);

    // Três sessões na clínica de teste: A iniciada pela rota, B continua rascunho, C inicia e depois conclui.
    const A = await mkSession("A"), B = await mkSession("B"), C = await mkSession("C");
    check("procedimentos ativos: sessões criadas", A.session?.id && B.session?.id && C.session?.id, JSON.stringify([A.session?.id, B.session?.id, C.session?.id]));
    if (!A.session || !B.session || !C.session) return;
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")], { type: "application/pdf" }), "Termo ap.pdf");
    form.set("category", "TERMOS"); form.set("signatureStatus", "ASSINADO"); form.set("journeyId", A.journey.id);
    const up = await fetch(`${baseUrl}/api/patients/${A.patient.id}/documents`, { method: "POST", headers: { cookie }, body: form });
    check("procedimentos ativos: termo assinado enviado", up.status === 201, up.status);
    r = await api("PATCH", `/api/patients/${A.patient.id}/procedure-sessions/${A.session.id}`, { status: "Em execução", technique: "E2E técnica", treatedAreas: "E2E região", photos: [{ id: `ph-${run}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 }] });
    check("procedimentos ativos: sessão A iniciada pela rota", r.status === 200 && r.data.session?.status === "Em execução", `${r.status}`);
    await prisma.patientProcedureSession.update({ where: { id: C.session.id }, data: { status: "Em execução" } });

    const listIds = (res) => (res.data.sessions ?? []).map((x) => x.id);
    r = await api("GET", url);
    check("procedimentos ativos: ADMIN vê A e C em execução e não vê o rascunho B", r.status === 200 && listIds(r).includes(A.session.id) && listIds(r).includes(C.session.id) && !listIds(r).includes(B.session.id) && r.data.sessions.length === 2, `${r.status} ${JSON.stringify(listIds(r))}`);
    const itemA = r.data.sessions?.find((x) => x.id === A.session.id);
    check("procedimentos ativos: valores de A (paciente, jornada, procedimento)", itemA?.patientId === A.patient.id && itemA.journeyId === A.journey.id && itemA.procedureName === A.procName && itemA.patientName === A.patient.name && itemA.journeyName === A.journey.name, JSON.stringify(itemA));
    const allowed = ["id", "patientId", "journeyId", "procedureName", "patientName", "journeyName"].sort().join();
    check("procedimentos ativos: só os 6 campos enxutos (sem fotos, materiais, histórico)", r.data.sessions.every((x) => Object.keys(x).sort().join() === allowed) && Object.keys(r.data).join() === "sessions" && !JSON.stringify(r.data).includes("data:image") && !JSON.stringify(r.data).includes("auditLog"), JSON.stringify(Object.keys(itemA ?? {})));

    await prisma.patientProcedureSession.update({ where: { id: C.session.id }, data: { status: "Concluída" } });
    r = await api("GET", url);
    check("procedimentos ativos: sessão concluída some da lista", r.status === 200 && listIds(r).join() === A.session.id, JSON.stringify(listIds(r)));

    const sessions = {};
    for (const [role, memberEmail, memberPassword] of [["STAFF", staffEmail, staffPassword], ["PROFESSIONAL", proEmail, proPassword]]) {
      const t = await api("POST", "/api/team", { name: `E2E ${role} AP`, email: memberEmail, password: memberPassword, role, cpf: randomCpf(), address: "Rua E2E 1", country: "Brasil", state: "SP", city: "São Paulo" });
      if (t.status === 201) members.push(t.data.member);
      sessions[role] = t.status === 201 ? await loginAs(memberEmail, memberPassword) : null;
      if (sessions[role]?.status !== 200) check(`procedimentos ativos: usuário ${role} criado`, false, `team ${t.status}`);
    }
    if (sessions.STAFF?.status === 200) {
      r = await withSession(sessions.STAFF.cookie, () => api("GET", url));
      check("procedimentos ativos: STAFF => 403 sem dados", r.status === 403 && !JSON.stringify(r.data).includes(A.patient.name), `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    }
    if (sessions.PROFESSIONAL?.status === 200) {
      r = await withSession(sessions.PROFESSIONAL.cookie, () => api("GET", url));
      check("procedimentos ativos: PROFESSIONAL vê a sessão em execução", r.status === 200 && listIds(r).join() === A.session.id, `${r.status} ${JSON.stringify(listIds(r))}`);
    }

    // Outra clínica: a sessão dela nunca aparece aqui, e a nossa não aparece lá.
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990022", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status !== 200) { check("procedimentos ativos: clínica externa criada", false, `register ${r.status}`); return; }
    const X = await withSession(other.cookie, async () => {
      const made = await mkSession("X");
      if (made.session) await prisma.patientProcedureSession.update({ where: { id: made.session.id }, data: { status: "Em execução" } });
      return { made, mine: await api("GET", url) };
    });
    check("procedimentos ativos: clínica externa vê só a própria sessão", X.mine.status === 200 && listIds(X.mine).join() === X.made.session?.id, `${X.mine.status} ${JSON.stringify(listIds(X.mine))}`);
    r = await api("GET", url);
    check("procedimentos ativos: sessão da outra clínica não aparece na clínica de teste", r.status === 200 && !listIds(r).includes(X.made.session?.id) && !JSON.stringify(r.data).includes(`E2E AP Paciente X ${run}`), JSON.stringify(listIds(r)));
  } finally {
    for (const member of members) await api("DELETE", "/api/team", { membershipId: member.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [otherEmail, staffEmail, proEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [otherEmail, staffEmail, proEmail] } } });
  }
}

// Avaliação facial: observações faciais (facialNotes) e legenda das marcações nas fotos, em /api/patients/[id]/evaluation.
async function facialEvaluation() {
  const mk = async (label) => (await api("POST", "/api/patients", { name: `E2E Facial ${label} ${run}`, phone: "11999990031", age: 33, cpf: randomCpf() })).data.patient;
  const P = await mk("A");
  const Q = await mk("B");
  const url = `/api/patients/${P.id}/evaluation`;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const photoWith = (annotations) => ({ name: "frente", imageUrl: png, width: 1, height: 1, category: "Frontal", annotations });
  const detail = async (id) => (await api("GET", `${url}?evaluationId=${id}`)).data.evaluation;
  const summary = async (id) => (await api("GET", `${url}?summary=1&evaluationId=${id}`)).data.evaluation;
  const facialOf = async (id) => (await prisma.evaluation.findUnique({ where: { id }, select: { facialNotes: true } }))?.facialNotes;

  // Caminho feliz: grava (com trim) e volta no detalhe e no resumo.
  let r = await api("PUT", url, { photos: [], assessment: { ...fullAssessment, facialNotes: "  Assimetria leve do sorriso  " } });
  const id = r.data.evaluation?.id;
  check("facial: PUT com facialNotes cria a avaliação (200)", r.status === 200 && Boolean(id), `${r.status} ${r.data.message}`);
  const d = await detail(id);
  const s = await summary(id);
  check("facial: facialNotes volta com trim no GET detalhe e no summary", d?.facialNotes === "Assimetria leve do sorriso" && s?.facialNotes === "Assimetria leve do sorriso", `${JSON.stringify(d?.facialNotes)} / ${JSON.stringify(s?.facialNotes)}`);

  // Sem o campo (app mobile): preserva.
  r = await api("PUT", url, { evaluationId: id, photos: [], assessment: { clinicalNotes: "Obs 2" } });
  check("facial: PUT sem facialNotes (app mobile) preserva o valor", r.status === 200 && (await facialOf(id)) === "Assimetria leve do sorriso" && (await detail(id)).clinicalNotes === "Obs 2", `${r.status}`);
  r = await api("PUT", url, { evaluationId: id, photos: [] });
  check("facial: PUT sem assessment também preserva", r.status === 200 && (await facialOf(id)) === "Assimetria leve do sorriso", r.status);

  // Esvaziar explicitamente: texto em branco é gravado e volta como string vazia.
  r = await api("PUT", url, { evaluationId: id, photos: [], assessment: { facialNotes: "   " } });
  check("facial: facialNotes em branco esvazia e o GET devolve string vazia", r.status === 200 && (await detail(id)).facialNotes === "" && (await summary(id)).facialNotes === "", r.status);
  const rawNull = await prisma.evaluation.create({ data: { patientId: P.id, clinicId: (await prisma.patient.findUnique({ where: { id: P.id }, select: { clinicId: true } })).clinicId, professional: "Teste", status: "Rascunho" } });
  check("facial: avaliação antiga com facialNotes nulo devolve string vazia no detalhe e no summary", rawNull.facialNotes === null && (await detail(rawNull.id)).facialNotes === "" && (await summary(rawNull.id)).facialNotes === "", `${rawNull.facialNotes}`);

  // Limites e tipos.
  r = await api("PUT", url, { evaluationId: id, photos: [], assessment: { facialNotes: "a".repeat(500) } });
  check("facial: 500 caracteres é aceito", r.status === 200 && (await facialOf(id))?.length === 500, r.status);
  r = await api("PUT", url, { evaluationId: id, photos: [], assessment: { facialNotes: `  ${"b".repeat(500)}  ` } });
  check("facial: 500 caracteres mais espaços nas pontas é aceito (limite após trim)", r.status === 200 && (await facialOf(id)) === "b".repeat(500), r.status);
  for (const [label, value] of [["501 caracteres", "c".repeat(501)], ["número", 42], ["null", null], ["objeto", { a: 1 }], ["lista", ["x"]], ["booleano", true]]) {
    r = await api("PUT", url, { evaluationId: id, photos: [], assessment: { facialNotes: value } });
    check(`facial: facialNotes com ${label} devolve 400 e não grava`, r.status === 400 && (await facialOf(id)) === "b".repeat(500), `${r.status} ${r.data.message}`);
  }
  const countBefore = await prisma.evaluation.count({ where: { patientId: P.id } });
  r = await api("PUT", url, { photos: [], assessment: { facialNotes: "d".repeat(501) } });
  check("facial: 501 caracteres em avaliação nova devolve 400 e não cria nada", r.status === 400 && (await prisma.evaluation.count({ where: { patientId: P.id } })) === countBefore, r.status);

  // Legenda das marcações.
  const okAnnotations = [{ id: "a1", type: "line", label: "Sulco nasogeniano" }, { id: "a2", type: "line" }, { id: "a3", type: "line", label: "x".repeat(60) }];
  r = await api("PUT", url, { evaluationId: id, photos: [photoWith(okAnnotations)] });
  const saved = (await detail(id)).photos?.[0]?.annotations ?? [];
  check("facial: legenda válida, de 60 caracteres e marcação antiga sem label (200) voltam no GET", r.status === 200 && saved.length === 3 && saved[0].label === "Sulco nasogeniano" && !("label" in saved[1]) && saved[2].label === "x".repeat(60), `${r.status} ${JSON.stringify(saved).slice(0, 150)}`);
  for (const [label, value] of [["61 caracteres", "y".repeat(61)], ["número", 7], ["null", null], ["objeto", { t: 1 }]]) {
    r = await api("PUT", url, { evaluationId: id, photos: [photoWith([{ id: "a1", type: "line", label: "ok" }, { id: "a9", type: "line", label: value }])] });
    const now = (await detail(id)).photos?.[0]?.annotations ?? [];
    check(`facial: label com ${label} devolve 400 e as marcações gravadas não mudam`, r.status === 400 && now.length === 3 && now[0].label === "Sulco nasogeniano", `${r.status} ${r.data.message}`);
  }
  r = await api("PUT", url, { photos: [photoWith([{ id: "z", type: "line", label: "z".repeat(61) }])] });
  check("facial: label inválido em avaliação nova não cria avaliação (400)", r.status === 400 && (await prisma.evaluation.count({ where: { patientId: P.id } })) === countBefore, r.status);

  // Outro paciente da mesma clínica.
  const evQ = (await api("PUT", `/api/patients/${Q.id}/evaluation`, { photos: [], assessment: { ...fullAssessment, facialNotes: "Segredo do paciente B" } })).data.evaluation;
  r = await api("PUT", url, { evaluationId: evQ.id, photos: [], assessment: { facialNotes: "Invasão" } });
  check("facial: evaluationId de OUTRO paciente devolve 404, sem vazar facialNotes, e não altera", r.status === 404 && !JSON.stringify(r.data).includes("Segredo") && (await facialOf(evQ.id)) === "Segredo do paciente B", `${r.status} ${JSON.stringify(r.data)}`);
  const cross = await Promise.all([api("GET", `${url}?evaluationId=${evQ.id}`), api("GET", `${url}?summary=1&evaluationId=${evQ.id}`)]);
  check("facial: GET detalhe e summary com evaluationId de outro paciente não vazam facialNotes", cross.every((x) => x.status === 200 && x.data.evaluation === null && !JSON.stringify(x.data).includes("Segredo")), cross.map((x) => `${x.status}:${JSON.stringify(x.data).slice(0, 60)}`).join(" | "));

  // Concluída: reconcluir esvaziando medicalHistory/contraindications e autosave com status.
  r = await api("PUT", url, { evaluationId: id, photos: [], assessment: { ...fullAssessment, medicalHistory: "Hipertensão", contraindications: "Nenhuma", facialNotes: "Final" }, status: "Concluída" });
  check("facial: concluir avaliação completa (200)", r.status === 200 && r.data.evaluation.status === "Concluída", `${r.status} ${r.data.message}`);
  r = await api("PUT", url, { evaluationId: id, photos: [], assessment: { medicalHistory: "", contraindications: "" }, status: "Concluída" });
  const afterEmpty = await prisma.evaluation.findUnique({ where: { id }, select: { status: true, medicalHistory: true, contraindications: true, facialNotes: true } });
  check("facial: reconcluir esvaziando medicalHistory/contraindications (opcionais) devolve 200 e segue Concluída", r.status === 200 && afterEmpty.status === "Concluída" && afterEmpty.medicalHistory === "" && afterEmpty.contraindications === "" && afterEmpty.facialNotes === "Final", `${r.status} ${r.data.message} ${JSON.stringify(afterEmpty)}`);
  r = await api("PUT", url, { evaluationId: id, photos: [], assessment: { clinicalNotes: "Autosave", facialNotes: "Final 2" }, status: "Concluída" });
  check("facial: autosave com status Concluída mantém Concluída e grava facialNotes", r.status === 200 && r.data.evaluation.status === "Concluída" && (await facialOf(id)) === "Final 2", `${r.status} ${r.data.message}`);
  for (const field of ["chiefComplaint", "patientGoal", "allergies", "pregnancyStatus", "anticoagulantUse", "autoimmuneDiseases", "previousProcedures", "clinicalNotes"]) {
    const before = await prisma.evaluation.findUnique({ where: { id }, select: { [field]: true } });
    r = await api("PUT", url, { evaluationId: id, photos: [], assessment: { [field]: "  ", facialNotes: "Não deve gravar" }, status: "Concluída" });
    const after = await prisma.evaluation.findUnique({ where: { id }, select: { [field]: true, facialNotes: true, status: true } });
    check(`facial: Concluída com ${field} vazio devolve 400 e preserva o valor antigo (inclusive facialNotes)`, r.status === 400 && after[field] === before[field] && after.facialNotes === "Final 2" && after.status === "Concluída", `${r.status} ${r.data.message}`);
  }

  // Clique duplo: mesma gravação duas vezes ao mesmo tempo.
  const dbl = await Promise.all([1, 2].map(() => api("PUT", url, { evaluationId: id, photos: [photoWith([{ id: "d1", type: "line", label: "Dupla" }])], assessment: { facialNotes: "Dupla" } })));
  check("facial: clique duplo dá 200/200, uma foto só e facialNotes gravado", dbl.every((x) => x.status === 200) && (await prisma.evaluationPhoto.count({ where: { evaluationId: id } })) === 1 && (await facialOf(id)) === "Dupla", dbl.map((x) => x.status).join("/"));

  // STAFF: 403 no detalhe e no summary, sem facialNotes; PUT também 403.
  const staffEmail = `e2e-facial-staff-${run}@example.com`;
  const staffPassword = `E2e-${run}-Staff9!`;
  let team = null;
  try {
    r = await api("POST", "/api/team", { name: "E2E Atendente Facial", email: staffEmail, password: staffPassword, role: "STAFF", cpf: randomCpf(), address: "Rua Teste, 1", country: "Brasil", state: "SP", city: "São Paulo" });
    team = r.status === 201 ? r.data.member : null;
    const staff = team ? await loginAs(staffEmail, staffPassword) : null;
    if (staff?.status === 200) {
      const res = await withSession(staff.cookie, async () => [
        await api("GET", `${url}?summary=1&evaluationId=${id}`),
        await api("GET", `${url}?evaluationId=${id}`),
        await api("PUT", url, { evaluationId: id, photos: [], assessment: { facialNotes: "Staff" } }),
      ]);
      check("facial: STAFF recebe 403 no summary, no detalhe e no PUT, sem facialNotes na resposta", res.every((x) => x.status === 403 && !JSON.stringify(x.data).includes("facialNotes") && !JSON.stringify(x.data).includes("Dupla")) && (await facialOf(id)) === "Dupla", res.map((x) => x.status).join("/"));
    } else check("usuário STAFF criado para testar a avaliação facial", false, `team ${r.status} ${JSON.stringify(r.data).slice(0, 100)} login ${staff?.status}`);
  } finally {
    if (team) await api("DELETE", "/api/team", { membershipId: team.id });
    await prisma.user.deleteMany({ where: { email: staffEmail } });
  }

  // Outra clínica: 404 e nada vaza.
  const otherEmail = `e2e-facial-outra-${run}@example.com`;
  const otherPassword = `E2e-${run}-Outra9!`;
  const otherClinic = `E2E Facial Externa ${run}`;
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo Facial", phone: "11999990032", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const res = await withSession(other.cookie, async () => [
        await api("GET", `${url}?summary=1&evaluationId=${id}`),
        await api("GET", `${url}?evaluationId=${id}`),
        await api("PUT", url, { evaluationId: id, photos: [], assessment: { facialNotes: "Invasão externa" } }),
      ]);
      check("facial: outra clínica recebe 404 (paciente inexistente para ela), sem facialNotes, e nada muda", res.every((x) => x.status === 404 && !JSON.stringify(x.data).includes("Dupla")) && (await facialOf(id)) === "Dupla" && (await prisma.evaluation.count({ where: { facialNotes: { startsWith: "Invasão externa" } } })) === 0, res.map((x) => x.status).join("/"));
    } else check("segunda clínica criada para testar a avaliação facial", false, `registro ${r.status} login ${other?.status}`);
  } finally {
    await prisma.clinicMembership.deleteMany({ where: { user: { email: otherEmail } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: otherEmail } });
  }
  r = await withSession("", () => api("GET", `${url}?summary=1&evaluationId=${id}`));
  check("facial: sem sessão devolve 401 no summary", r.status === 401, r.status);
}

// Partes do roteiro, na ordem em que rodam. `needs` lista as partes que criam os dados que esta usa.
// Conflitos de agenda: o mesmo profissional ou paciente não tem dois atendimentos sobrepostos (criar, remarcar, reativar, concorrência).
async function scheduleConflicts() {
  const D = day(10);
  const mk = async (label, n) => (await api("POST", "/api/patients", { name: `E2E Conflito ${label} ${run}`, phone: `1199999${String(7000 + n)}`, age: 30, cpf: randomCpf() })).data.patient;
  const [Pa, Pb, Pc] = [await mk("A", 1), await mk("B", 2), await mk("C", 3)];
  const X = `Prof X ${run}`, Y = `Prof Y ${run}`;
  const post = (patient, professional, time, extra = {}) => api("POST", "/api/appointments", { patientId: patient.id, procedure: "Retorno", professional, time, date: D, ...extra });
  const stateOf = async (id) => prisma.appointment.findUnique({ where: { id }, select: { time: true, status: true } });

  let r = await post(Pa, X, "10:00");
  const A = r.data.appointment;
  check("conflitos: primeiro agendamento (X, 10:00–11:00) é criado", r.status === 201, `${r.status} ${r.data.message}`);
  if (!A) return;
  r = await post(Pb, X, "10:30");
  check("conflitos: sobreposição parcial do mesmo profissional => 409 sem expor o outro paciente", r.status === 409 && /já possui um atendimento neste horário/.test(r.data.message) && !r.data.message.includes("E2E Conflito"), `${r.status} ${r.data.message}`);
  r = await post(Pb, X, "10:00");
  check("conflitos: mesma faixa e mesmo profissional (caixa/espaços diferentes) => 409", (await post(Pb, `  ${X.toUpperCase()} `, "10:15")).status === 409 && r.status === 409, r.status);
  r = await post(Pa, Y, "10:30");
  check("conflitos: mesmo paciente com outro profissional => 409 com mensagem do paciente", r.status === 409 && /O paciente já tem outro agendamento neste horário/.test(r.data.message), `${r.status} ${r.data.message}`);
  const B = (await post(Pb, X, "11:00"));
  const C = (await post(Pb, X, "09:00"));
  check("conflitos: horários adjacentes (termina 10:00 / começa 11:00) => 201", B.status === 201 && C.status === 201, `${B.status}/${C.status} ${B.data.message ?? ""} ${C.data.message ?? ""}`);
  r = await post(Pb, Y, "10:00");
  check("conflitos: outro profissional e outro paciente no mesmo horário => 201", r.status === 201, `${r.status} ${r.data.message}`);

  // Remarcação.
  const bId = B.data.appointment?.id;
  r = await api("PATCH", `/api/appointments/${bId}`, { time: "10:30" });
  check("conflitos: remarcar para faixa ocupada => 409 e o horário antigo continua", r.status === 409 && (await stateOf(bId)).time === "11:00", `${r.status} ${r.data.message}`);
  r = await api("PATCH", `/api/appointments/${bId}`, { time: "14:00" });
  check("conflitos: remarcar para faixa livre => 200", r.status === 200 && r.data.appointment?.time === "14:00", `${r.status} ${r.data.message}`);
  r = await api("PATCH", `/api/appointments/${bId}`, { professional: Y, time: "10:30" });
  check("conflitos: remarcar trocando de profissional para faixa ocupada => 409", r.status === 409, `${r.status} ${r.data.message}`);
  r = await api("PATCH", `/api/appointments/${A.id}`, { time: "10:15" });
  check("conflitos: remarcar sem colidir com o próprio agendamento => 200", r.status === 200, `${r.status} ${r.data.message}`);
  await api("PATCH", `/api/appointments/${A.id}`, { time: "10:00" });
  r = await api("PATCH", `/api/appointments/${A.id}`, { notes: "só observação" });
  check("conflitos: alterar só a observação não revalida a faixa", r.status === 200, r.status);

  // Cancelar libera; reativar volta a ocupar.
  r = await api("PATCH", `/api/appointments/${A.id}`, { status: "Cancelado" });
  check("conflitos: cancelar o agendamento", r.status === 200, r.status);
  const E = await post(Pc, X, "10:00");
  check("conflitos: faixa de agendamento cancelado fica livre", E.status === 201, `${E.status} ${E.data.message}`);
  r = await api("PATCH", `/api/appointments/${A.id}`, { status: "Agendado" });
  check("conflitos: reativar agendamento cancelado em faixa ocupada => 409 e continua cancelado", r.status === 409 && (await stateOf(A.id)).status === "Cancelado", `${r.status} ${r.data.message}`);
  await api("PATCH", `/api/appointments/${E.data.appointment?.id}`, { status: "Faltou" });
  r = await api("PATCH", `/api/appointments/${A.id}`, { status: "Agendado" });
  check("conflitos: faltou também libera a faixa (reativar passa)", r.status === 200, `${r.status} ${r.data.message}`);

  // Em atendimento e Atendido continuam ocupando a faixa; profissional só com espaços é recusado.
  const Z = `Prof Z ${run}`;
  const F = (await post(Pc, Z, "12:00")).data.appointment;
  await api("PATCH", `/api/appointments/${F.id}`, { status: "Em atendimento" });
  r = await post(Pb, Z, "12:30");
  check("conflitos: agendamento Em atendimento ocupa a faixa => 409", r.status === 409, `${r.status} ${r.data.message}`);
  await api("PATCH", `/api/appointments/${F.id}`, { status: "Atendido" });
  r = await post(Pb, Z, "12:30");
  check("conflitos: agendamento Atendido ocupa a faixa => 409", r.status === 409, `${r.status} ${r.data.message}`);
  r = await post(Pb, "   ", "13:00");
  check("conflitos: profissional só com espaços => 400", r.status === 400, `${r.status} ${r.data.message}`);
  r = await api("PATCH", `/api/appointments/${F.id}`, { professional: "   " });
  check("conflitos: PATCH com profissional só com espaços => 400", r.status === 400, r.status);

  // "Procedimento - X" usa a duração real de X (120 min), não 60.
  const longName = `E2E Longo ${run}`;
  await api("POST", "/api/procedures", { name: longName, category: "Facial", price: 300, durationMinutes: 120, margin: 30 });
  const W = `Prof W ${run}`;
  r = await post(Pb, W, "14:00", { procedure: `Procedimento - ${longName}`, date: day(11) });
  check("conflitos: 'Procedimento - X' de 120 min é criado", r.status === 201, `${r.status} ${r.data.message}`);
  r = await post(Pc, W, "15:30", { date: day(11) });
  check("conflitos: faixa real de 120 min bloqueia 15:30 => 409", r.status === 409 && /14:00–16:00/.test(r.data.message), `${r.status} ${r.data.message}`);
  r = await post(Pc, W, "16:00", { date: day(11) });
  check("conflitos: logo após a faixa de 120 min => 201", r.status === 201, `${r.status} ${r.data.message}`);

  // Concorrência: duas requisições na mesma faixa.
  let bad = 0, detail = "";
  const same = [];
  for (let i = 0; i < 20; i += 1) {
    const d = day(20 + i);
    const [p, q] = await Promise.all([post(Pb, `Conc ${run}`, "10:00", { date: d }), post(Pc, `Conc ${run}`, "10:00", { date: d })]);
    const got = [p.status, q.status].sort().join();
    if (got !== "201,409") { bad += 1; detail = `${got} ${p.data.message ?? ""}`; }
    same.push(await prisma.appointment.count({ where: { professional: `Conc ${run}`, date: { gte: new Date(`${d}T00:00:00-03:00`), lt: new Date(`${d}T23:59:59-03:00`) } } }));
  }
  check("conflitos: 20x 2 POST simultâneos (mesmo profissional) => sempre 1x 201 e 1x 409, 1 registro", bad === 0 && same.every((n) => n === 1), `${bad} falhas ${detail} contagens ${same.join()}`);
  bad = 0; detail = "";
  const samePatient = [];
  for (let i = 0; i < 20; i += 1) {
    const d = day(45 + i);
    const [p, q] = await Promise.all([post(Pa, `Conc1 ${run}`, "15:00", { date: d }), post(Pa, `Conc2 ${run}`, "15:00", { date: d })]);
    const got = [p.status, q.status].sort().join();
    if (got !== "201,409") { bad += 1; detail = got; }
    samePatient.push(await prisma.appointment.count({ where: { patientId: Pa.id, date: { gte: new Date(`${d}T00:00:00-03:00`), lt: new Date(`${d}T23:59:59-03:00`) } } }));
  }
  check("conflitos: 20x 2 POST simultâneos (mesmo paciente) => sempre 1x 201 e 1x 409, 1 registro", bad === 0 && samePatient.every((n) => n === 1), `${bad} falhas ${detail} contagens ${samePatient.join()}`);
  // Três requisições cruzadas (profissional + paciente) não podem travar nem gerar sobreposição.
  bad = 0; detail = "";
  const crossed = [];
  for (let i = 0; i < 10; i += 1) {
    const d = day(70 + i);
    const res = await Promise.all([post(Pa, `Cruz ${run}`, "16:00", { date: d }), post(Pb, `Cruz ${run}`, "16:00", { date: d }), post(Pa, `Cruz2 ${run}`, "16:00", { date: d })]);
    if (res.some((item) => ![201, 409].includes(item.status))) { bad += 1; detail = res.map((item) => item.status).join(); }
    const wins = res.map((item) => item.status === 201);
    crossed.push(wins[0] ? wins.filter(Boolean).length === 1 : wins[1] && wins[2]);
  }
  check("conflitos: 10x 3 POST cruzados (profissional/paciente) => sem 500/deadlock e resultado consistente", bad === 0 && crossed.every(Boolean), `${bad} falhas ${detail} ${crossed.join()}`);

  // Clínicas diferentes não interferem.
  const otherEmail = `e2e-conf-outra-${run}@example.com`, otherPassword = `E2e-${run}-Outra9!`, otherClinic = `E2E Conflito Externa ${run}`;
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo3", phone: "11999990023", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const result = await withSession(other.cookie, async () => {
        const patient = (await api("POST", "/api/patients", { name: `E2E Conflito Ext ${run}`, phone: "11999997100", age: 30, cpf: randomCpf() })).data.patient;
        return api("POST", "/api/appointments", { patientId: patient.id, procedure: "Retorno", professional: X, time: "10:00", date: D });
      });
      check("conflitos: outra clínica agenda o mesmo profissional/horário sem conflito", result.status === 201, `${result.status} ${result.data.message}`);
    } else {
      check("conflitos: segunda clínica criada para o teste de isolamento", false, `registro ${r.status} login ${other?.status}`);
    }
  } finally {
    await prisma.clinicMembership.deleteMany({ where: { user: { email: otherEmail } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: otherEmail } });
  }
}

// Lacunas da regra de conflito: variações de profissional, geometria das faixas, duração por procedimento, status, remarcações,
// concorrência (POST x POST x PATCH), isolamento entre clínicas, papéis e fluxos que criam/movem agendamento.
async function scheduleConflictGaps() {
  let off = 100;
  const nd = () => day(off++);
  let seq = 0;
  const mkP = async (label) => (await api("POST", "/api/patients", { name: `E2E ConfG ${label} ${run}`, phone: `119${Math.floor(10000000 + Math.random() * 89999999)}`, age: 30, cpf: randomCpf() })).data.patient;
  const fresh = () => mkP(`P${seq++}`);
  const pool = []; for (let i = 0; i < 5; i += 1) pool.push(await fresh());
  const clinicId = (await prisma.patient.findUnique({ where: { id: pool[0].id }, select: { clinicId: true } })).clinicId;
  const instant = (d) => new Date(`${d}T12:00:00-03:00`);
  const seed = (patient, d, time, procedure, professional, status = "Agendado") => prisma.appointment.create({ data: { clinicId, patientId: patient.id, date: instant(d), time, procedure, professional, status, notes: "" } });
  const post = (patient, professional, time, d, procedure = "Retorno", extra = {}) => api("POST", "/api/appointments", { patientId: patient.id, procedure, professional, time, date: d, ...extra });
  const patch = (id, body) => api("PATCH", `/api/appointments/${id}`, body);
  const rowOf = (id) => prisma.appointment.findUnique({ where: { id }, select: { date: true, time: true, status: true, professional: true, procedure: true } });
  const msg = (r) => `${r.status} ${r.data?.message ?? ""}`;
  const P90 = `E2E Conf90 ${run}`, P30 = `E2E Conf30 ${run}`;
  const p90 = await api("POST", "/api/procedures", { custom: true, name: P90, category: "Facial", price: 100, durationMinutes: 90, margin: 30 });
  const p30 = await api("POST", "/api/procedures", { custom: true, name: P30, category: "Facial", price: 100, durationMinutes: 30, margin: 30 });
  check("lacunas: procedimentos de 90 e 30 min criados", p90.status === 201 && p30.status === 201, `${p90.status}/${p30.status} ${p90.data?.message ?? ""} ${p30.data?.message ?? ""}`);
  if (p90.status !== 201 || p30.status !== 201) return;

  // (a) Variações do nome do profissional.
  {
    const d = nd(), pro = `Dra. Ana Lúcia ${run}`;
    const a = await fresh();
    check("lacunas(a): base com acento criada", (await post(a, pro, "10:00", d)).status === 201);
    const got = [];
    for (const variant of [`dra. ana lúcia ${run}`, `  Dra.   Ana   Lúcia  ${run}  `, `DRA. ANA LÚCIA ${run}`]) got.push((await post(await fresh(), variant, "10:30", d)).status);
    check("lacunas(a): caixa, espaços extras (internos e nas pontas) e maiúsculas acentuadas => 409", got.every((s) => s === 409), got.join());
    const noAccent = await post(await fresh(), `Dra. Ana Lucia ${run}`, "10:30", d);
    const nfd = await post(await fresh(), `Dra. Ana Lúcia ${run}`, "10:15", d);
    check("lacunas(a): OBSERVAÇÃO sem acento / NFD (sem 500)", noAccent.status < 500 && nfd.status < 500, `sem acento ${noAccent.status}; NFD ${nfd.status} (201 = tratado como outro profissional)`);
    const e1 = await post(await fresh(), "", "10:30", d);
    const e2 = await post(await fresh(), null, "10:30", d);
    check("lacunas(a): profissional vazio ou null => 400", e1.status === 400 && e2.status === 400, `${e1.status}/${e2.status}`);
    const w1 = await post(await fresh(), "   ", "10:30", d);
    const w2 = await post(await fresh(), "   ", "10:30", d);
    check("lacunas(a): profissional só com espaços => 400", w1.status === 400 && w2.status === 400, `${w1.status}/${w2.status}`);
    // Grafias diferentes entre o que está gravado e o candidato (inclui legado sem trim): a comparação precisa ser normalizada nos dois sentidos.
    const spelled = [
      ["interno duplo gravado via API", `Maria  Silva ${run}`, `Maria Silva ${run}`, false],
      ["interno duplo no candidato", `Maria Silva2 ${run}`, `Maria  Silva2 ${run}`, false],
      ["legado com espaços nas pontas e internos", `  Maria  Silva3 ${run} `, `Maria Silva3 ${run}`, true],
      ["legado MAIÚSCULO acentuado", `MARIA ÁLVARES ${run}`, `maria álvares ${run}`, true],
      ["legado minúsculo acentuado", `maria álvares2 ${run}`, `MARIA ÁLVARES2 ${run}`, true],
      ["legado com tab/espaço duplo", `Maria\t Silva4 ${run}`, `Maria Silva4 ${run}`, true],
      ["acento no meio, duplo gravado via API", `Ana  Lúcia ${run}`, `ana lúcia ${run}`, false],
      ["acento no meio, duplo no candidato", `Ana Lúcia2 ${run}`, `ANA  LÚCIA2 ${run}`, false],
      ["acento no meio, legado com pontas", ` Ana  Lúcia3 ${run} `, `Ana Lúcia3 ${run}`, true],
      ["inicia com Á, legado", `Álvaro  Souza ${run}`, `álvaro souza ${run}`, true],
      ["inicia com Á, via API", `ÁLVARO Souza2 ${run}`, `Álvaro  Souza2 ${run}`, false],
      ["inicia com É, legado", `Élida  Reis ${run}`, `ÉLIDA REIS ${run}`, true],
      ["inicia com É, via API", `élida Reis2 ${run}`, `Élida  Reis2 ${run}`, false],
      ["só não-ASCII, via API", "Ção  Üé", "ção üé", false],
      ["só não-ASCII, legado", " Ção  Öí ", "Ção Öí", true],
      ["só não-ASCII, mesma grafia", "Ão", "Ão", false],
    ];
    for (const [label, stored, candidate, legacy] of spelled) {
      const dd = nd(), holder = await fresh();
      if (legacy) await seed(holder, dd, "10:00", "Retorno", stored); else await post(holder, stored, "10:00", dd);
      const rr = await post(await fresh(), candidate, "10:30", dd);
      check(`lacunas(a): gravado "${stored.replace(run, "")}" x candidato "${candidate.replace(run, "")}" (${label}) => 409`, rr.status === 409, msg(rr));
    }
    const wp = await post(a, "   ", "10:30", d);
    check("lacunas(a): paciente com agendamento ocupado + profissional só com espaços => 400 (profissional é obrigatório)", wp.status === 400, msg(wp));
  }

  // (b) Geometria das faixas (cada caso em um dia próprio: base + candidato).
  const geo = async (baseProc, baseTime, time, proc, expected, why) => {
    const d = nd(), pro = `Geo ${seq++} ${run}`;
    const base = await post(await fresh(), pro, baseTime, d, baseProc);
    const cand = await post(await fresh(), pro, time, d, proc);
    check(`lacunas(b): ${why} => ${expected}`, base.status === 201 && cand.status === expected, `base ${baseTime} ${baseProc}: ${base.status}; candidato ${time} ${proc}: ${msg(cand)}`);
  };
  await geo("Retorno", "10:00", "10:30", "Retorno", 409, "início dentro (10:30 em 10:00–11:00)");
  await geo("Retorno", "10:00", "09:30", "Retorno", 409, "fim dentro (09:30–10:30)");
  await geo("Retorno", "10:00", "10:00", "Retorno", 409, "faixa idêntica");
  await geo("Retorno", "10:00", "10:15", P30, 409, "contida (30 min dentro de 60)");
  await geo("Retorno", "10:00", "09:45", P90, 409, "contendo (90 min cobre 60 min)");
  await geo("Retorno", "10:00", "11:00", "Retorno", 201, "adjacente depois (fim == início)");
  await geo("Retorno", "10:00", "09:00", "Retorno", 201, "adjacente antes");
  await geo("Retorno", "10:00", "11:01", "Retorno", 201, "1 minuto de folga depois");
  await geo("Retorno", "10:00", "09:29", P30, 201, "1 minuto de folga antes (09:29–09:59)");
  await geo("Retorno", "10:00", "10:59", "Retorno", 409, "sobrepõe por 1 minuto no fim");
  await geo("Retorno", "10:00", "09:01", "Retorno", 409, "sobrepõe por 1 minuto no início");
  await geo(P90, "10:00", "11:00", "Retorno", 409, "base de 90 min: 11:00 ainda ocupado (fallback 60 deixaria livre)");
  await geo(P90, "10:00", "11:29", "Retorno", 409, "base de 90 min: 11:29 ocupado");
  await geo(P90, "10:00", "11:30", "Retorno", 201, "base de 90 min: 11:30 livre");
  await geo("Retorno", "12:00", "10:31", P90, 409, "candidato de 90 min terminando 12:01");
  await geo("Retorno", "12:00", "10:30", P90, 201, "candidato de 90 min terminando 12:00 (adjacente)");
  await geo(`Sem cadastro ${run}`, "15:00", "15:59", "Retorno", 409, "nome desconhecido usa 60 min: 15:59 ocupado");
  await geo(`Sem cadastro ${run}`, "15:00", "16:00", "Retorno", 201, "nome desconhecido usa 60 min: 16:00 livre");
  {
    const d1 = nd(), d2 = nd(), pro = `Geo dia ${run}`;
    const base = await post(await fresh(), pro, "10:00", d1);
    const other = await post(await fresh(), pro, "10:00", d2);
    check("lacunas(b): mesmo horário e profissional em dias diferentes => 201", base.status === 201 && other.status === 201, msg(other));
  }
  {
    // "Procedimento - X" e "Retorno - X" usam a duração cadastrada de X (90 min), não o fallback de 60.
    const d = nd(), pro = `Geo prefixo ${run}`;
    const base = await post(await fresh(), pro, "10:00", d, `Procedimento - ${P90}`);
    const inside = await post(await fresh(), pro, "11:15", d, "Retorno");
    const after = await post(await fresh(), pro, "11:30", d, "Retorno");
    check("lacunas(b): 'Procedimento - X' de 90 min ocupa 90 min (11:15 => 409, 11:30 => 201)", base.status === 201 && inside.status === 409 && after.status === 201, `${base.status}/${inside.status}/${after.status}`);
    const d2 = nd(), pro2 = `Geo prefixo2 ${run}`;
    const b2 = await post(await fresh(), pro2, "10:00", d2, `Retorno - ${P90}`);
    const i2 = await post(await fresh(), pro2, "11:15", d2, "Retorno");
    check("lacunas(b): 'Retorno - X' de 90 min também ocupa 90 min (11:15 => 409)", b2.status === 201 && i2.status === 409, `${b2.status}/${i2.status}`);
  }

  // Faixas que atravessam a meia-noite e 23:30+60 (só existem como dado legado: a API de criação respeita o expediente).
  {
    const M = day(off), M1 = day(off + 1); off += 2;
    const pro = `Meia ${run}`, pro2 = `Meia2 ${run}`;
    const s = await fresh(), q = await fresh(), t = await fresh(), rr = await fresh();
    await seed(s, M, "23:30", "Retorno", pro);
    const Q = (await post(q, pro, "09:00", M1)).data.appointment;
    let r = await patch(Q?.id, { time: "00:15" });
    check("lacunas(b): 23:30+60 atravessa a meia-noite: remarcar para 00:15 do dia seguinte => 409", r.status === 409 && (await rowOf(Q.id)).time === "09:00", msg(r));
    r = await patch(Q.id, { time: "00:30" });
    check("lacunas(b): remarcar para 00:30 (adjacente ao fim 00:30) => 200", r.status === 200, msg(r));
    r = await patch(Q.id, { time: "00:29" });
    check("lacunas(b): remarcar para 00:29 (1 minuto dentro) => 409", r.status === 409, msg(r));
    await seed(t, M1, "00:00", "Retorno", pro2);
    const R = (await post(rr, pro2, "09:00", M)).data.appointment;
    r = await patch(R.id, { time: "23:30" });
    check("lacunas(b): 23:30 de hoje (até 00:30) contra 00:00 de amanhã => 409", r.status === 409, msg(r));
    r = await patch(R.id, { time: "23:00" });
    check("lacunas(b): 23:00 (até 00:00) contra 00:00 de amanhã => 200 (adjacente)", r.status === 200, msg(r));
    const pro3 = `Meia3 ${run}`, u = await fresh(), v = await fresh();
    await seed(u, M, "23:30", "Retorno", pro3);
    const V = (await post(v, pro3, "09:00", M)).data.appointment;
    const codes = [(await patch(V.id, { time: "23:45" })).status, (await patch(V.id, { time: "23:00" })).status, (await patch(V.id, { time: "22:30" })).status];
    check("lacunas(b): contra 23:30–00:30: 23:45 => 409, 23:00 => 409, 22:30 => 200", codes.join() === "409,409,200", codes.join());
  }

  // (c) Status que ocupam ou liberam a faixa.
  for (const status of ["Cancelado", "Faltou", "Atendido", "Finalizado", "Em atendimento", "Agendado"]) {
    const d = nd(), pro = `Stat ${status} ${run}`, occupant = await fresh();
    await seed(occupant, d, "10:00", "Retorno", pro, status);
    const byPro = await post(await fresh(), pro, "10:30", d);
    const byPatient = await post(occupant, `Outro ${status} ${run}`, "10:30", d);
    const frees = status === "Cancelado" || status === "Faltou";
    check(`lacunas(c): ${status} ${frees ? "libera" : "ocupa"} a faixa (por profissional e por paciente)`, frees ? byPro.status === 201 && byPatient.status === 201 : byPro.status === 409 && byPatient.status === 409, `prof ${byPro.status}, paciente ${byPatient.status}`);
  }
  {
    const d = nd(), pro = `Trans ${run}`;
    const a = (await post(await fresh(), pro, "10:00", d)).data.appointment;
    await patch(a.id, { status: "Cancelado" });
    const b = (await post(await fresh(), pro, "10:00", d)).data.appointment;
    const st = async (id) => (await rowOf(id)).status;
    const codes = [(await patch(a.id, { status: "Agendado" })).status, (await patch(a.id, { status: "Em atendimento" })).status, (await patch(a.id, { status: "Atendido" })).status];
    check("lacunas(c): Cancelado -> Agendado/Em atendimento/Atendido em faixa ocupada => 409 e continua Cancelado", codes.join() === "409,409,409" && await st(a.id) === "Cancelado", `${codes.join()} ${await st(a.id)}`);
    let r = await patch(a.id, { status: "Faltou" });
    check("lacunas(c): Cancelado -> Faltou (nenhum ocupa) => 200", r.status === 200 && await st(a.id) === "Faltou", msg(r));
    r = await patch(a.id, { status: "Agendado" });
    check("lacunas(c): Faltou -> Agendado em faixa ocupada => 409", r.status === 409 && await st(a.id) === "Faltou", msg(r));
    r = await patch(a.id, { status: "Agendado", time: "15:00" });
    check("lacunas(c): Faltou -> Agendado já remarcando para faixa livre => 200 e horário gravado", r.status === 200 && (await rowOf(a.id)).time === "15:00", msg(r));
    await patch(a.id, { status: "Cancelado" });
    r = await patch(a.id, { status: "Agendado", time: "10:30" });
    check("lacunas(c): Cancelado -> Agendado remarcando para faixa ocupada => 409 e horário antigo", r.status === 409 && (await rowOf(a.id)).time === "15:00", msg(r));
    await patch(b.id, { status: "Cancelado" });
    r = await patch(a.id, { status: "Agendado" });
    check("lacunas(c): Cancelado -> Agendado em faixa livre => 200", r.status === 200 && await st(a.id) === "Agendado", msg(r));
  }

  // (d) Remarcação.
  {
    const d = nd(), d2 = nd(), pro = `Remarca ${run}`;
    await post(await fresh(), pro, "10:00", d);
    const B = (await post(await fresh(), pro, "14:00", d)).data.appointment;
    let r = await patch(B.id, { time: "10:30" });
    let row = await rowOf(B.id);
    check("lacunas(d): remarcar para faixa ocupada => 409, horário e dia antigos, sem citar paciente", r.status === 409 && row.time === "14:00" && row.date.toISOString() === instant(d).toISOString() && !JSON.stringify(r.data).includes("E2E ConfG"), msg(r));
    r = await patch(B.id, { date: d2 });
    check("lacunas(d): remarcar só o dia para um dia livre => 200", r.status === 200 && (await rowOf(B.id)).date.toISOString() === instant(d2).toISOString(), msg(r));
    r = await patch(B.id, { date: d, time: "10:00" });
    check("lacunas(d): remarcar dia+hora para a faixa ocupada de outro dia => 409 e fica no dia antigo", r.status === 409 && (await rowOf(B.id)).date.toISOString() === instant(d2).toISOString(), msg(r));
    r = await patch(B.id, { date: d, time: "11:00" });
    check("lacunas(d): remarcar dia+hora para faixa adjacente => 200", r.status === 200, msg(r));
    r = await patch(B.id, { time: "10:59" });
    check("lacunas(d): remarcar para 10:59 (1 min dentro) => 409", r.status === 409, msg(r));

    const pro2 = `Remarca2 ${run}`, pro3 = `Remarca3 ${run}`;
    const C = (await post(await fresh(), pro2, "10:00", d)).data.appointment;
    r = await patch(C.id, { professional: pro });
    check("lacunas(d): trocar só o profissional para um ocupado => 409 e profissional antigo", r.status === 409 && (await rowOf(C.id)).professional === pro2, msg(r));
    r = await patch(C.id, { professional: pro.toUpperCase() });
    check("lacunas(d): trocar para o ocupado com outra caixa => 409", r.status === 409, msg(r));
    r = await patch(C.id, { professional: pro3 });
    check("lacunas(d): trocar o profissional para um livre => 200", r.status === 200 && (await rowOf(C.id)).professional === pro3, msg(r));
    r = await patch(C.id, { professional: "   " });
    check("lacunas(d): profissional só com espaços no PATCH => 400 e profissional mantido", r.status === 400 && (await rowOf(C.id)).professional === pro3, msg(r));
    r = await patch(C.id, { professional: pro3.toUpperCase() });
    check("lacunas(d): mudar só a caixa do próprio profissional => 200", r.status === 200, msg(r));

    const pro4 = `Remarca4 ${run}`;
    const D = (await post(await fresh(), pro4, "10:00", d)).data.appointment;
    const E = (await post(await fresh(), pro4, "11:15", d)).data.appointment;
    r = await patch(D.id, { procedure: P90 });
    check("lacunas(d): trocar o procedimento para um de 90 min que invade o seguinte => 409 e procedimento antigo", r.status === 409 && (await rowOf(D.id)).procedure === "Retorno", msg(r));
    r = await patch(D.id, { procedure: P30 });
    check("lacunas(d): trocar para um procedimento mais curto => 200", r.status === 200 && (await rowOf(D.id)).procedure === P30, msg(r));
    r = await patch(E.id, { procedure: P90 });
    check("lacunas(d): estender o seguinte para 90 min sem invadir ninguém => 200", r.status === 200, msg(r));

    // Paciente com dois agendamentos.
    const pat = await fresh();
    await post(pat, `PacA ${run}`, "10:00", d2);
    const X2 = (await post(pat, `PacB ${run}`, "15:00", d2)).data.appointment;
    r = await patch(X2.id, { time: "10:30" });
    check("lacunas(d): remarcar para cima do outro agendamento do mesmo paciente => 409 (mensagem do paciente)", r.status === 409 && /O paciente já tem outro agendamento/.test(r.data.message) && (await rowOf(X2.id)).time === "15:00", msg(r));

    // Legado sobreposto não bloqueia o que não muda a faixa.
    const pro5 = `Legado ${run}`, l1 = await fresh(), l2 = await fresh();
    const L1 = await seed(l1, d, "10:00", "Retorno", pro5), L2 = await seed(l2, d, "10:30", "Retorno", pro5);
    const res = [];
    res.push((await patch(L2.id, { notes: "obs" })).status);
    res.push((await patch(L2.id, { time: "10:30", date: d })).status);
    res.push((await patch(L2.id, { status: "Em atendimento" })).status);
    res.push((await patch(L1.id, { status: "Atendido" })).status);
    res.push((await patch(L1.id, { professional: pro5.toUpperCase() })).status);
    res.push((await patch(L2.id, { status: "Cancelado" })).status);
    check("lacunas(d): com legado sobreposto, observação/mesmo horário/status/caixa/cancelar => todos 200", res.every((s) => s === 200), res.join());

    // Entradas inválidas continuam sendo recusadas (sem 500).
    const inv = [
      (await patch(B.id, { time: "25:00" })).status, (await patch(B.id, { date: "2030-02-30" })).status, (await patch(B.id, { date: day(-3) })).status,
      (await patch(B.id, {})).status, (await patch(B.id, { time: 1030 })).status, (await patch("nao-existe", { time: "10:00" })).status,
    ];
    check("lacunas(d): PATCH inválido => 400,400,400,400,400,404", inv.join() === "400,400,400,400,400,404", inv.join());
  }

  // (e) Concorrência.
  const reps = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
  const countAt = (where, d, time) => prisma.appointment.count({ where: { ...where, clinicId, date: instant(d), time, status: { in: ["Agendado", "Em atendimento", "Atendido", "Finalizado"] } } });
  {
    let bad = 0, detail = "";
    const counts = [];
    for (let i = 0; i < 20; i += 1) {
      const d = nd(), pro = `C5 ${i} ${run}`;
      const variants = [pro, pro.toUpperCase(), ` ${pro} `, pro.toLowerCase(), pro];
      const res = await Promise.all(pool.map((p, k) => post(p, variants[k], "10:00", d)));
      const c201 = res.filter((x) => x.status === 201).length, c409 = res.filter((x) => x.status === 409).length;
      if (c201 !== 1 || c409 !== 4) { bad += 1; detail = res.map((x) => x.status).join(); }
      counts.push(await prisma.appointment.count({ where: { clinicId, patientId: { in: pool.map((p) => p.id) }, date: instant(d) } }));
    }
    check("lacunas(e): 20x 5 POST simultâneos (mesmo profissional, só caixa/espaços nas pontas) => 1x 201 e 4x 409", bad === 0 && counts.every((n) => n === 1), `${bad} falhas ${detail} contagens ${counts.join()}`);
  }
  {
    let bad = 0, detail = "";
    const counts = [];
    for (let i = 0; i < 20; i += 1) {
      const d = nd(), pro = `C5i ${i} ${run}`;
      const variants = [pro, pro.replace(" ", "  "), pro.replace(" ", "	"), ` ${pro}`, pro.toUpperCase()];
      const res = await Promise.all(pool.map((p, k) => post(p, variants[k], "10:00", d)));
      const c201 = res.filter((x) => x.status === 201).length, c409 = res.filter((x) => x.status === 409).length;
      if (c201 !== 1 || c409 !== 4) { bad += 1; detail = res.map((x) => x.status).join(); }
      counts.push(await prisma.appointment.count({ where: { clinicId, patientId: { in: pool.map((p) => p.id) }, date: instant(d) } }));
    }
    check("lacunas(e): 20x 5 POST simultâneos (mesmo profissional, espaços internos diferentes) => 1x 201 e 4x 409", bad === 0 && counts.every((n) => n === 1), `${bad} falhas ${detail} contagens ${counts.join()}`);
  }
  {
    let bad = 0, detail = "";
    for (let i = 0; i < 20; i += 1) {
      const d = nd();
      const res = await Promise.all(reps(5, (k) => post(pool[0], `C5p ${i} ${k} ${run}`, "10:00", d)));
      const c201 = res.filter((x) => x.status === 201).length, c409 = res.filter((x) => x.status === 409).length;
      if (c201 !== 1 || c409 !== 4) { bad += 1; detail = res.map((x) => `${x.status} ${x.data?.message ?? ""}`).join(" | "); }
    }
    check("lacunas(e): 20x 5 POST simultâneos (mesmo paciente, 5 profissionais) => 1x 201 e 4x 409", bad === 0, `${bad} falhas ${detail}`);
  }
  {
    let bad = 0, detail = "";
    for (let i = 0; i < 3; i += 1) {
      const d = nd(), pro = `Burst ${i} ${run}`;
      const patients = await Promise.all(reps(10, () => fresh()));
      const res = await Promise.all(patients.map((p) => post(p, pro, "10:00", d)));
      if (res.filter((x) => x.status === 201).length !== 1 || res.some((x) => ![201, 409].includes(x.status))) { bad += 1; detail = res.map((x) => x.status).join(); }
    }
    check("lacunas(e): 3x 10 POST simultâneos na mesma faixa => 1x 201, resto 409, 0x 500", bad === 0, `${bad} falhas ${detail}`);
  }
  {
    let bad = 0, detail = "";
    for (let i = 0; i < 15; i += 1) {
      const d = nd(), pro = `PxP ${i} ${run}`;
      const Q = (await post(pool[0], pro, "15:00", d)).data.appointment;
      const [a, b] = await Promise.all([post(pool[1], pro, "10:00", d), patch(Q.id, { time: "10:00" })]);
      const ok = (a.status === 201 && b.status === 409) || (a.status === 409 && b.status === 200);
      const n = await countAt({ professional: pro }, d, "10:00");
      if (!ok || n !== 1) { bad += 1; detail = `${a.status}/${b.status} n=${n}`; }
    }
    check("lacunas(e): 15x POST x PATCH simultâneos na mesma faixa => só um vence, 0x 500", bad === 0, `${bad} falhas ${detail}`);
  }
  {
    let bad = 0, detail = "";
    for (let i = 0; i < 15; i += 1) {
      const d = nd(), pro = `PxPa ${i} ${run}`;
      const Q1 = (await post(pool[0], pro, "14:00", d)).data.appointment;
      const Q2 = (await post(pool[1], pro, "16:00", d)).data.appointment;
      const [a, b] = await Promise.all([patch(Q1.id, { time: "10:00" }), patch(Q2.id, { time: "10:00" })]);
      const n = await countAt({ professional: pro }, d, "10:00");
      if ([a.status, b.status].sort().join() !== "200,409" || n !== 1) { bad += 1; detail = `${a.status}/${b.status} n=${n}`; }
    }
    check("lacunas(e): 15x dois PATCH simultâneos para a mesma faixa => 1x 200 e 1x 409", bad === 0, `${bad} falhas ${detail}`);
  }
  {
    let bad = 0, detail = "";
    const [PA, PB] = pool;
    for (let i = 0; i < 20; i += 1) {
      const d = nd(), XA = `CruzA ${i} ${run}`, XB = `CruzB ${i} ${run}`;
      const reqs = [[PB, XA], [PA, XB], [PA, XA], [PB, XB]];
      const res = await Promise.all(reqs.map(([p, x]) => post(p, x, "10:00", d)));
      const okSet = reqs.filter((_, k) => res[k].status === 201);
      const conflicts = (a, b) => a[0].id === b[0].id || a[1] === b[1];
      const independent = okSet.every((a, ia) => okSet.every((b, ib) => ia === ib || !conflicts(a, b)));
      const maximal = reqs.every((q, k) => res[k].status === 201 || okSet.some((o) => conflicts(q, o)));
      if (res.some((x) => ![201, 409].includes(x.status)) || !independent || !maximal || okSet.length === 0) { bad += 1; detail = res.map((x) => x.status).join(); }
    }
    check("lacunas(e): 20x travas cruzadas (prof A+pac B x prof B+pac A + 2 mistas) => sem 500/deadlock, sem sobreposição e sem 409 indevido", bad === 0, `${bad} falhas ${detail}`);
  }
  {
    let bad = 0, detail = "";
    for (let i = 0; i < 10; i += 1) {
      const d = nd(), pro = `Reat ${i} ${run}`;
      const A = (await post(pool[0], pro, "10:00", d)).data.appointment;
      await patch(A.id, { status: "Cancelado" });
      const B = (await post(pool[1], pro, "10:00", d)).data.appointment;
      await patch(B.id, { status: "Cancelado" });
      const [a, b] = await Promise.all([patch(A.id, { status: "Agendado" }), patch(B.id, { status: "Agendado" })]);
      const n = await countAt({ professional: pro }, d, "10:00");
      if ([a.status, b.status].sort().join() !== "200,409" || n !== 1) { bad += 1; detail = `${a.status}/${b.status} n=${n}`; }
    }
    check("lacunas(e): 10x reativação simultânea de dois cancelados para a mesma faixa => 1x 200 e 1x 409", bad === 0, `${bad} falhas ${detail}`);
  }
  {
    let bad = 0, detail = "";
    for (let i = 0; i < 10; i += 1) {
      const d = nd(), pro = `CxP ${i} ${run}`;
      const A = (await post(pool[0], pro, "10:00", d)).data.appointment;
      const [c, p] = await Promise.all([patch(A.id, { status: "Cancelado" }), post(pool[1], pro, "10:00", d)]);
      const n = await countAt({ professional: pro }, d, "10:00");
      if (c.status !== 200 || ![201, 409].includes(p.status) || n !== (p.status === 201 ? 1 : 0)) { bad += 1; detail = `${c.status}/${p.status} n=${n}`; }
    }
    check("lacunas(e): 10x cancelar x POST na mesma faixa => sem 500 e sem dois ocupando", bad === 0, `${bad} falhas ${detail}`);
  }

  // (f) Outras clínicas e vazamento de dados no 409.
  {
    const d = nd(), pro = `Seg ${run}`;
    const occupant = await fresh();
    const first = await post(occupant, pro, "10:00", d, `Segredo ${run}`);
    const byPro = await post(await fresh(), pro, "10:30", d);
    const Z = (await post(await fresh(), pro, "15:00", d)).data.appointment;
    const viaPatch = await patch(Z.id, { time: "10:30" });
    const text = JSON.stringify([byPro.data, viaPatch.data]);
    check("lacunas(f): 409 por profissional (POST e PATCH) não cita paciente, procedimento nem id do outro paciente", first.status === 201 && byPro.status === 409 && viaPatch.status === 409 && !text.includes("E2E ConfG") && !text.includes("Segredo") && !text.includes(occupant.id), text);
    const otherEmail = `e2e-confg-outra-${run}@example.com`, otherPassword = `E2e-${run}-Outra9!`, otherClinic = `E2E ConfG Externa ${run}`;
    try {
      const r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo G", phone: "11999990044", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
      const other = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
      if (other?.status === 200) {
        const theirs = await withSession(other.cookie, async () => {
          const patient = (await api("POST", "/api/patients", { name: `E2E ConfG Ext ${run}`, phone: "11999997201", age: 30, cpf: randomCpf() })).data.patient;
          const a = await post(patient, pro, "10:00", d);
          const b = await post(patient, pro, "10:30", d);
          const foreign = await patch(Z.id, { time: "13:00" });
          return { a, b, foreign };
        });
        check("lacunas(f): outra clínica reserva o mesmo profissional/horário (201) e o próprio paciente dela ainda conflita (409)", theirs.a.status === 201 && theirs.b.status === 409, `${theirs.a.status}/${theirs.b.status}`);
        check("lacunas(f): outra clínica não remarca agendamento desta (404) e ele fica intacto", theirs.foreign.status === 404 && (await rowOf(Z.id)).time === "15:00", theirs.foreign.status);
        const mine = await post(await fresh(), `Seg2 ${run}`, "10:00", d);
        check("lacunas(f): o agendamento da outra clínica não bloqueia esta (profissional livre)", mine.status === 201, msg(mine));
      } else {
        check("lacunas(f): segunda clínica criada", false, `registro ${r.status} login ${other?.status}`);
      }
    } finally {
      await prisma.clinicMembership.deleteMany({ where: { user: { email: otherEmail } } });
      await prisma.clinic.deleteMany({ where: { name: otherClinic } });
      await prisma.user.deleteMany({ where: { email: otherEmail } });
    }
  }

  // (g) Retorno, "Procedimento - X" e início de sessão movendo o agendamento.
  {
    const d = nd(), pro = `Fluxos ${run}`;
    const first = await post(await fresh(), pro, "10:00", d, `Procedimento - ${P90}`);
    const ret = await post(await fresh(), pro, "10:30", d, `Retorno - ${P90}`);
    const proc = await post(await fresh(), pro, "10:15", d, `Procedimento - ${P30}`);
    const free = await post(await fresh(), pro, "11:30", d, `Retorno - ${P90}`);
    check("lacunas(g): 'Procedimento - X' e 'Retorno - X' também conflitam por profissional (409) e livre passa (201)", first.status === 201 && ret.status === 409 && proc.status === 409 && free.status === 201, `${first.status}/${ret.status}/${proc.status}/${free.status}`);
  }
  {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const procName = `E2E ConfG Sessao ${run}`;
    await api("POST", "/api/procedures", { name: procName, category: "Facial", price: 300, durationMinutes: 30, margin: 30 });
    const proc = (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === procName);
    const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
    const pat = await fresh(), occ = await fresh();
    const j = (await api("POST", `/api/patients/${pat.id}/journeys`, { name: `E2E ConfG J ${run}`, professionalId: professional?.id })).data.journey;
    const ev = (await api("PUT", `/api/patients/${pat.id}/evaluation`, { journeyId: j?.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
    const q = await api("POST", "/api/quotes", { patientId: pat.id, journeyId: j?.id, evaluationId: ev?.id, details: [{ procedureId: proc?.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" });
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote?.id}`, { status, evaluationId: ev?.id });
    const s = (await api("POST", `/api/patients/${pat.id}/procedure-sessions`, { journeyId: j?.id, quoteId: q.data.quote?.id, procedureId: proc?.id })).data.session;
    const form = new FormData();
    form.set("file", new Blob([pdf], { type: "application/pdf" }), "Termo.pdf");
    form.set("category", "TERMOS"); form.set("signatureStatus", "ASSINADO"); form.set("journeyId", j?.id ?? "");
    await fetch(`${baseUrl}/api/patients/${pat.id}/documents`, { method: "POST", headers: { cookie }, body: form });
    const pro = `Sessao ${run}`;
    const appt = (await post(pat, pro, "10:00", nd(), `Procedimento - ${procName}`, { journeyId: j?.id })).data.appointment;
    const nowClock = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date());
    await seed(occ, nowClock.slice(0, 10), nowClock.slice(11, 16), "Retorno", pro);
    const started = await api("PATCH", `/api/patients/${pat.id}/procedure-sessions/${s?.id}`, { status: "Em execução", technique: "E2E técnica", treatedAreas: "E2E região", professional: "E2E Prof", photos: [{ id: `ph-${run}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 }] });
    const moved = appt ? await rowOf(appt.id) : null;
    check("lacunas(g): iniciar a sessão move o agendamento para agora mesmo com outro do mesmo profissional no horário (não bloqueia)", started.status === 200 && started.data.appointment?.id === appt?.id && moved?.date.toISOString().slice(0, 10) === nowClock.slice(0, 10) && moved.time === nowClock.slice(11, 16), `${started.status} ${started.data?.message ?? ""} ${JSON.stringify(moved)}`);
    const after = appt ? [(await patch(appt.id, { notes: "depois do início" })).status, (await patch(appt.id, { status: "Em atendimento" })).status] : [];
    check("lacunas(g): depois do início sobreposto, observação e status continuam funcionando (200)", after.join() === "200,200", after.join());
  }

  // (h) STAFF e PROFESSIONAL.
  {
    const members = [];
    const staffEmail = `e2e-confg-staff-${run}@example.com`, staffPassword = `E2e-${run}-Staff9!`;
    const proEmail = `e2e-confg-pro-${run}@example.com`, proPassword = `E2e-${run}-Pro99!`;
    try {
      for (const [role, memberEmail, memberPassword] of [["STAFF", staffEmail, staffPassword], ["PROFESSIONAL", proEmail, proPassword]]) {
        const created = await api("POST", "/api/team", { name: `E2E ${role} ConfG`, email: memberEmail, password: memberPassword, role });
        if (created.status === 201) members.push(created.data.member);
        const session = created.status === 201 ? await loginAs(memberEmail, memberPassword) : null;
        if (session?.status !== 200) { check(`lacunas(h): usuário ${role} criado`, false, `team ${created.status} login ${session?.status}`); continue; }
        const d = nd(), pro = `Papel ${role} ${run}`;
        const base = await post(await fresh(), pro, "10:00", d);
        const mineP = await fresh();
        const out = await withSession(session.cookie, async () => {
          const o = {};
          o.dup = await post(mineP, pro, "10:30", d);
          o.free = await post(mineP, pro, "12:00", d);
          const id = o.free.data.appointment?.id;
          o.mv = await patch(id, { time: "10:30" });
          o.mvFree = await patch(id, { time: "13:00" });
          o.cancel = await patch(id, { status: "Cancelado" });
          await post(await mkP(`H${seq++}`), pro, "13:00", d);
          o.react = await patch(id, { status: "Agendado" });
          return o;
        });
        check(`lacunas(h): ${role} criando em faixa ocupada => 409 (igual ao ADMIN), em faixa livre => 201`, base.status === 201 && out.dup.status === 409 && /já possui um atendimento/.test(out.dup.data?.message ?? "") && out.free.status === 201, `${out.dup.status} ${out.free.status}`);
        check(`lacunas(h): ${role} remarcando para ocupada => 409, para livre => 200`, out.mv.status === 409 && out.mvFree.status === 200, `${out.mv.status}/${out.mvFree.status}`);
        check(`lacunas(h): ${role} cancela (200) e reativar em faixa ocupada => 409`, out.cancel.status === 200 && out.react.status === 409, `${out.cancel.status}/${out.react.status}`);
      }
    } finally {
      for (const member of members) await api("DELETE", "/api/team", { membershipId: member.id });
      await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [staffEmail, proEmail] } } } });
      await prisma.user.deleteMany({ where: { email: { in: [staffEmail, proEmail] } } });
    }
  }
}

// Materiais da sessão preenchidos pela ficha técnica dos procedimentos do orçamento (semeadura única no servidor).
async function sessionMaterials() {
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const dataUrl = `data:image/png;base64,${pngB64}`;
  const mkProduct = async (name, kind, unit) => (await api("POST", "/api/products", { name: `${name} ${run}`, kind, unit, costCents: 100, supplier: "Fornecedor", minStock: 0 })).data.product;
  const toxin = await mkProduct("E2E Toxina", "produto", "ml");
  const syringe = await mkProduct("E2E Seringa", "material", "unidade");
  const gauze = await mkProduct("E2E Gaze", "material", "unidade");
  const noStock = await mkProduct("E2E SemSaldo", "material", "unidade");
  const archived = await mkProduct("E2E Arquivado", "material", "unidade");
  check("materiais da sessão: produtos criados", toxin && syringe && gauze && noStock && archived);
  if (!(toxin && syringe && gauze && noStock && archived)) return;
  const lotRow = (productId, code, expires, quantity) => ({ productId, lotCode: `${code}${run}`, expiresOn: day(expires), quantity, unitPriceCents: 100 });
  const purchase = await api("POST", "/api/purchases", { supplier: "Fornecedor", purchasedOn: day(0), paymentMethod: "Pix", installments: 1, items: [
    lotRow(toxin.id, "TA", 30, 3), lotRow(toxin.id, "TB", 200, 10), lotRow(syringe.id, "SC", 20, 5), lotRow(syringe.id, "SD", 100, 20), lotRow(gauze.id, "GE", 60, 50),
  ] });
  check("materiais da sessão: compra com 2 lotes por produto registrada", purchase.status === 201, purchase.status);

  const nameP1 = `E2E Mat Proc 1 ${run}`;
  const nameP2 = `E2E Mat Proc 2 ${run}`;
  const nameP3 = `E2E Mat Vazio ${run}`;
  const mkProc = async (name, technicalSheet) => {
    await api("POST", "/api/procedures", { name, category: "Facial", price: 500, durationMinutes: 30, margin: 30, technicalSheet });
    return (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === name);
  };
  const p1 = await mkProc(nameP1, [{ productId: toxin.id, quantity: 1.5 }, { productId: syringe.id, quantity: 2 }, { productId: archived.id, quantity: 1 }, { productId: noStock.id, quantity: 1 }]);
  const p2 = await mkProc(nameP2, [{ productId: toxin.id, quantity: 1 }, { productId: syringe.id, quantity: 1 }]);
  const p3 = await mkProc(nameP3, []);
  check("materiais da sessão: procedimentos com ficha criados", p1 && p2 && p3);
  if (!(p1 && p2 && p3)) return;
  await prisma.product.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });

  const P = (await api("POST", "/api/patients", { name: `E2E Mat Sessao ${run}`, phone: "11999990060", age: 35, cpf: randomCpf() })).data.patient.id;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const J = (await api("POST", `/api/patients/${P}/journeys`, { name: `E2E Mat J ${run}`, professionalId: professional?.id })).data.journey;
  const ev = (await api("PUT", `/api/patients/${P}/evaluation`, { journeyId: J.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
  const mkQuote = async (details) => {
    const q = await api("POST", "/api/quotes", { patientId: P, journeyId: J.id, evaluationId: ev.id, details, paymentMethod: "Pix", installments: 1, notes: "" });
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${q.data.quote.id}`, { status, evaluationId: ev.id });
    return q.data.quote?.id;
  };
  const twoItems = [{ procedureId: p1.id, quantity: 2, discountCents: 0 }, { procedureId: p2.id, quantity: 1, discountCents: 0 }];
  const url = `/api/patients/${P}/procedure-sessions`;
  const byProduct = (materials) => Object.fromEntries((materials ?? []).map((item) => [item.productId, item]));
  const lots = (item) => (item?.allocations ?? []).map((allocation) => `${allocation.code?.replace(run, "")}:${allocation.quantity}`).join(",");
  const dbSession = (id) => prisma.patientProcedureSession.findUnique({ where: { id }, select: { materials: true, materialsSeededAt: true, status: true } });

  // 1) Criação semeia: ficha x quantidade do item, soma de produto repetido, FEFO, arquivado fora, sem saldo => sem lote.
  const Q = await mkQuote(twoItems);
  let r = await api("POST", url, { journeyId: J.id, quoteId: Q });
  const S = r.data.session;
  let m = byProduct(S?.materials);
  check("materiais da sessão: POST cria e semeia (201)", r.status === 201 && S?.materials?.length === 3 && Boolean(S.materialsSeededAt), `${r.status} ${S?.materials?.length}`);
  check("materiais da sessão: ml decimal e soma entre procedimentos (1,5x2+1 = 4 ml)", m[toxin.id]?.quantity === 4 && m[toxin.id]?.unit === "ml", m[toxin.id]?.quantity);
  check("materiais da sessão: unidade somada (2x2+1 = 5)", m[syringe.id]?.quantity === 5, m[syringe.id]?.quantity);
  check("materiais da sessão: lotes por validade (FEFO) cruzando lotes", lots(m[toxin.id]) === "TA:3,TB:1" && lots(m[syringe.id]) === "SC:5", `${lots(m[toxin.id])} | ${lots(m[syringe.id])}`);
  check("materiais da sessão: produto sem saldo entra com a quantidade e sem lote", m[noStock.id]?.quantity === 2 && m[noStock.id]?.allocations.length === 0, JSON.stringify(m[noStock.id]));
  check("materiais da sessão: produto arquivado na ficha não entra", !m[archived.id]);
  check("materiais da sessão: semeadura não baixa estoque", await prisma.stockMovement.count({ where: { productId: { in: [toxin.id, syringe.id] }, type: "attendance" } }) === 0);
  const seededAt = (await dbSession(S.id))?.materialsSeededAt?.toISOString();

  // 2) Reuso e GET não duplicam nem mudam.
  const snapshot = JSON.stringify(S.materials);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q });
  check("materiais da sessão: segundo POST (reuso) não muda os materiais", r.status === 200 && JSON.stringify(r.data.session.materials) === snapshot, r.status);
  const got = (await api("GET", `${url}?journeyId=${J.id}&quoteId=${Q}`)).data;
  check("materiais da sessão: GET devolve os mesmos materiais, o marcador e o tipo dos produtos", JSON.stringify(got.sessions?.[0]?.materials) === snapshot && Boolean(got.sessions?.[0]?.materialsSeededAt) && got.materials?.every((item) => item.kind), JSON.stringify(got.sessions?.map((s) => s.materials?.length)));
  check("materiais da sessão: orçamento continua com uma única sessão", await prisma.patientProcedureSession.count({ where: { quoteId: Q } }) === 1);

  // 3) Profissional ajusta: aumenta, remove e adiciona produto.
  const gauzeLot = got.materials.find((item) => item.id === gauze.id)?.lots?.[0];
  const sPath = `${url}/${S.id}`;
  const lotSD = await prisma.stockLot.findFirst({ where: { productId: syringe.id, code: `SD${run}` } });
  const edited = [
    { productId: syringe.id, quantity: 6, allocations: [{ lotId: m[syringe.id].allocations[0].lotId, quantity: 5 }, { lotId: lotSD.id, quantity: 1 }] },
    { productId: noStock.id, quantity: 2, allocations: [] },
    { productId: gauze.id, quantity: 1, allocations: [{ lotId: gauzeLot?.id, quantity: 1 }] },
  ];
  r = await api("PATCH", sPath, { materials: edited });
  const saved = byProduct(r.data.session?.materials);
  check("materiais da sessão: PATCH aumenta, remove e adiciona produto", r.status === 200 && Object.keys(saved).length === 3 && !saved[toxin.id] && saved[syringe.id]?.quantity === 6 && lots(saved[syringe.id]) === "SC:5,SD:1" && saved[gauze.id]?.quantity === 1, `${r.status} ${JSON.stringify(Object.keys(saved))}`);
  const afterEdit = (await api("GET", `${url}?journeyId=${J.id}&quoteId=${Q}`)).data.sessions[0];
  check("materiais da sessão: edição persiste no GET e mantém o marcador", byProduct(afterEdit.materials)[syringe.id]?.quantity === 6 && (await dbSession(S.id)).materialsSeededAt?.toISOString() === seededAt);
  check("materiais da sessão: PATCH não baixa estoque", await prisma.stockMovement.count({ where: { productId: syringe.id, type: "attendance" } }) === 0);

  // 4) Remover tudo não reaplica a ficha.
  r = await api("PATCH", sPath, { materials: [] });
  check("materiais da sessão: remover tudo => 200 e vazio", r.status === 200 && r.data.session?.materials?.length === 0, r.status);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q });
  const reload = (await api("GET", `${url}?journeyId=${J.id}&quoteId=${Q}`)).data.sessions[0];
  check("materiais da sessão: depois de remover tudo e reabrir continua vazio (não reaplica)", r.status === 200 && r.data.session.materials.length === 0 && reload.materials.length === 0 && (await dbSession(S.id)).materials === "[]" && (await dbSession(S.id)).materialsSeededAt?.toISOString() === seededAt, `${r.status} ${r.data.session?.materials?.length}`);

  // 5) Concorrência: 5 POST simultâneos => 1 sessão semeada uma vez.
  const Q2 = await mkQuote(twoItems);
  const burst = await Promise.all(Array.from({ length: 5 }, () => api("POST", url, { journeyId: J.id, quoteId: Q2 })));
  const ids = new Set(burst.map((x) => x.data.session?.id));
  const first = burst.find((x) => x.status === 201)?.data.session;
  check("materiais da sessão: 5 POST simultâneos => 1x201 + 4x200, mesma sessão", burst.filter((x) => x.status === 201).length === 1 && burst.filter((x) => x.status === 200).length === 4 && ids.size === 1 && await prisma.patientProcedureSession.count({ where: { quoteId: Q2 } }) === 1, burst.map((x) => x.status).join());
  check("materiais da sessão: todos devolvem os mesmos 3 materiais (semeados uma vez, sem duplicar)", first?.materials?.length === 3 && burst.every((x) => JSON.stringify(x.data.session.materials) === JSON.stringify(first.materials)) && JSON.parse((await dbSession(first.id)).materials).length === 3);
  if (!first) return;

  // 6) Orçamento legado (sem details.items): resolve por nome e "(Nx)".
  const Q5 = await mkQuote(twoItems);
  await prisma.quote.update({ where: { id: Q5 }, data: { details: "{}", items: `${nameP1} (2x), ${nameP2}` } });
  r = await api("POST", url, { journeyId: J.id, quoteId: Q5 });
  m = byProduct(r.data.session?.materials);
  check("materiais da sessão: orçamento legado resolve por nome e quantidade", r.status === 201 && m[toxin.id]?.quantity === 4 && m[syringe.id]?.quantity === 5 && !m[archived.id], `${r.status} ${JSON.stringify(Object.values(m).map((x) => x.quantity))}`);

  // 7) Ficha vazia: sem erro e sem materiais.
  const Q6 = await mkQuote([{ procedureId: p3.id, quantity: 1, discountCents: 0 }]);
  r = await api("POST", url, { journeyId: J.id, quoteId: Q6 });
  check("materiais da sessão: ficha vazia => sessão criada com materiais vazios", r.status === 201 && r.data.session.materials.length === 0, `${r.status}`);

  // 8) Rascunho legado vazio (marcador nulo) é semeado uma vez; em execução vazia nunca.
  const Q3 = await mkQuote([{ procedureId: p2.id, quantity: 1, discountCents: 0 }]);
  const legacy = (await api("POST", url, { journeyId: J.id, quoteId: Q3 })).data.session;
  await prisma.patientProcedureSession.update({ where: { id: legacy.id }, data: { materials: "[]", materialsSeededAt: null } });
  r = await api("POST", url, { journeyId: J.id, quoteId: Q3 });
  m = byProduct(r.data.session?.materials);
  check("materiais da sessão: rascunho legado vazio é semeado ao reabrir (200)", r.status === 200 && m[toxin.id]?.quantity === 1 && m[syringe.id]?.quantity === 1 && Boolean(r.data.session.materialsSeededAt), `${r.status} ${Object.keys(m).length}`);
  const once = (await dbSession(legacy.id)).materialsSeededAt?.toISOString();
  await api("POST", url, { journeyId: J.id, quoteId: Q3 });
  check("materiais da sessão: reabrir de novo não reaplica", (await dbSession(legacy.id)).materialsSeededAt?.toISOString() === once);
  const Q4 = await mkQuote([{ procedureId: p2.id, quantity: 1, discountCents: 0 }]);
  const running = (await api("POST", url, { journeyId: J.id, quoteId: Q4 })).data.session;
  await prisma.patientProcedureSession.update({ where: { id: running.id }, data: { status: "Em execução", materials: "[]", materialsSeededAt: null } });
  r = await api("POST", url, { journeyId: J.id, quoteId: Q4 });
  const runningDb = await dbSession(running.id);
  check("materiais da sessão: sessão em execução vazia NÃO é semeada", r.status === 200 && r.data.session.materials.length === 0 && runningDb.materials === "[]" && runningDb.materialsSeededAt === null && runningDb.status === "Em execução", `${r.status} ${runningDb.materials}`);

  // 9) Outra clínica não enxerga nem altera.
  const otherEmail = `e2e-mat-outra-${run}@example.com`;
  const otherPassword = `E2e-${run}-Outra9!`;
  const otherClinic = `E2E Mat Externa ${run}`;
  try {
    const reg = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990020", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = reg.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const before = JSON.stringify(await dbSession(first.id));
      const probes = await withSession(other.cookie, async () => ({
        post: await api("POST", url, { journeyId: J.id, quoteId: Q2 }),
        get: await api("GET", `${url}?journeyId=${J.id}&quoteId=${Q2}`),
        patch: await api("PATCH", `${url}/${first.id}`, { materials: [] }),
      }));
      check("materiais da sessão: outra clínica recebe 404 em POST/GET/PATCH sem vazar dados", Object.values(probes).every((x) => x.status === 404 && !JSON.stringify(x.data).includes(nameP1)), Object.values(probes).map((x) => x.status).join());
      check("materiais da sessão: tentativas da outra clínica não alteraram a sessão", JSON.stringify(await dbSession(first.id)) === before);
    } else {
      check("materiais da sessão: clínica externa criada para o teste", false, `${reg.status} ${other?.status}`);
    }
  } finally {
    await prisma.clinicMembership.deleteMany({ where: { user: { email: otherEmail } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: otherEmail } });
  }

  // 10) Finalizar: baixa por lote nas quantidades do body; o que falta vira saída pendente.
  const sessionPath = `${url}/${first.id}`;
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const form = new FormData();
  form.set("file", new Blob([pdf], { type: "application/pdf" }), "Termo mat.pdf");
  form.set("category", "TERMOS"); form.set("signatureStatus", "ASSINADO"); form.set("journeyId", J.id);
  const up = await fetch(`${baseUrl}/api/patients/${P}/documents`, { method: "POST", headers: { cookie }, body: form });
  check("materiais da sessão: termo assinado enviado", up.status === 201, up.status);
  const seeded = byProduct(first.materials);
  const body = {
    technique: "E2E técnica", treatedAreas: "E2E região",
    materials: [
      { productId: toxin.id, quantity: 4, allocations: seeded[toxin.id].allocations.map(({ lotId, quantity }) => ({ lotId, quantity })) },
      { productId: syringe.id, quantity: 7, allocations: seeded[syringe.id].allocations.map(({ lotId, quantity }) => ({ lotId, quantity })) },
      { productId: noStock.id, quantity: 2, allocations: [] },
    ],
  };
  const before = { id: `mph-${run}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 };
  const afterPhoto = { id: `mpa-${run}`, phase: "Imediatamente após", imageUrl: dataUrl, name: "depois", width: 1, height: 1 };
  r = await api("PATCH", sessionPath, { ...body, status: "Em execução", photos: [before] });
  check("materiais da sessão: iniciar com os materiais semeados => 200", r.status === 200 && r.data.session?.status === "Em execução", `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  r = await api("PATCH", sessionPath, { ...body, status: "Concluída", photos: [before, afterPhoto] });
  check("materiais da sessão: finalizar => 200 com saída pendente", r.status === 200 && r.data.pending?.length === 2, `${r.status} ${JSON.stringify(r.data.pending ?? r.data).slice(0, 160)}`);
  const movements = await prisma.stockMovement.findMany({ where: { procedureSessionId: first.id }, select: { quantity: true, lot: { select: { code: true } } } });
  const moved = movements.map((x) => `${x.lot.code.replace(run, "")}:${x.quantity}`).sort().join(",");
  check("materiais da sessão: baixa por lote nas quantidades do body (TA 3, TB 1, SC 5)", moved === "SC:-5,TA:-3,TB:-1", moved);
  const pendings = await prisma.pendingStockOutput.findMany({ where: { procedureSessionId: first.id }, select: { productId: true, quantity: true } });
  const pendingMap = Object.fromEntries(pendings.map((x) => [x.productId, x.quantity]));
  check("materiais da sessão: faltas viram saída pendente (seringa 2, sem saldo 2)", pendings.length === 2 && pendingMap[syringe.id] === 2 && pendingMap[noStock.id] === 2, JSON.stringify(pendingMap));
  const next = await api("POST", url, { journeyId: J.id, quoteId: Q2 });
  check("materiais da sessão: sessão concluída não é alterada; Nova sessão semeia só a nova", next.status === 201 && next.data.session.id !== first.id && next.data.session.materials.length === 3 && JSON.parse((await dbSession(first.id)).materials).length === 3, `${next.status}`);
}

// Lacunas da semeadura de materiais: cálculo (decimais, limites, linhas repetidas), lotes/FEFO, corridas, finalização, papéis e isolamento.
async function sessionMaterialsGaps() {
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const dataUrl = `data:image/png;base64,${pngB64}`;
  const tag = "MG";
  const mkProduct = async (name, kind, unit) => (await api("POST", "/api/products", { name: `${name} ${tag}${run}`, kind, unit, costCents: 100, supplier: "Fornecedor", minStock: 0 })).data.product;
  const buy = (rows) => api("POST", "/api/purchases", { supplier: "Fornecedor", purchasedOn: day(0), paymentMethod: "Pix", installments: 1, items: rows.map(([productId, code, expires, quantity]) => ({ productId, lotCode: `${code}${run}`, expiresOn: day(expires), quantity, unitPriceCents: 100 })) });
  const mkProc = async (name, rows) => {
    await api("POST", "/api/procedures", { name, category: "Facial", price: 500, durationMinutes: 30, margin: 30, technicalSheet: [] });
    const procedure = (await api("GET", "/api/quotes/options")).data.procedures?.find((item) => item.name === name);
    for (const [productId, quantity] of rows) await prisma.procedureMaterial.create({ data: { procedureId: procedure.id, productId, quantity } });
    return procedure;
  };
  const P = (await api("POST", "/api/patients", { name: `E2E Mat Lacunas ${run}`, phone: "11999990061", age: 35, cpf: randomCpf() })).data.patient.id;
  const P2 = (await api("POST", "/api/patients", { name: `E2E Mat Outro Pac ${run}`, phone: "11999990062", age: 35, cpf: randomCpf() })).data.patient.id;
  const professional = (await api("GET", "/api/team/professionals")).data.professionals?.[0];
  const mkJourney = async (patientId, label) => {
    const j = (await api("POST", `/api/patients/${patientId}/journeys`, { name: `E2E Mat ${label} ${run}`, professionalId: professional?.id })).data.journey;
    const e = (await api("PUT", `/api/patients/${patientId}/evaluation`, { journeyId: j.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
    return { j, e };
  };
  const { j: J, e: ev } = await mkJourney(P, "J");
  const { j: J3, e: ev3 } = await mkJourney(P, "SemTermo");
  const { j: J2 } = await mkJourney(P2, "Outro");
  // items: [{procedure, quantity?, extra?}] gravados direto em details.items (inclui casos que a tela não gera).
  const mkQuote = async (items, { journey = J, evaluation = ev, patient = P, legacy = null } = {}) => {
    const q = await api("POST", "/api/quotes", { patientId: patient, journeyId: journey.id, evaluationId: evaluation.id, details: [{ procedureId: items[0].procedure.id, quantity: 1, discountCents: 0 }], paymentMethod: "Pix", installments: 1, notes: "" });
    const id = q.data.quote?.id;
    for (const status of ["Enviado", "Aprovado"]) await api("PATCH", `/api/quotes/${id}`, { status, evaluationId: evaluation.id });
    const row = await prisma.quote.findUnique({ where: { id }, select: { details: true } });
    const details = JSON.parse(row.details);
    details.items = items.map((item) => ({ procedureId: item.procedure.id, name: item.procedure.name, ...("quantity" in item ? { quantity: item.quantity } : {}), ...(item.extra ?? {}) }));
    await prisma.quote.update({ where: { id }, data: { details: JSON.stringify(details), ...(legacy ? { items: legacy } : {}) } });
    return id;
  };
  const url = (patient = P) => `/api/patients/${patient}/procedure-sessions`;
  const open = (quoteId, journey = J, patient = P) => api("POST", url(patient), { journeyId: journey.id, quoteId });
  const byProduct = (materials) => Object.fromEntries((materials ?? []).map((item) => [item.productId, item]));
  const lotsOf = (item) => (item?.allocations ?? []).map((allocation) => `${allocation.code?.replace(run, "")}:${allocation.quantity}`).join(",");
  const dbSession = (id) => prisma.patientProcedureSession.findUnique({ where: { id }, select: { materials: true, materialsSeededAt: true, status: true, procedureName: true } });
  const legacyDraft = (id, extra = {}) => prisma.patientProcedureSession.update({ where: { id }, data: { materials: "[]", materialsSeededAt: null, ...extra } });
  const qtyOf = (res, productId) => byProduct(res.data.session?.materials)[productId]?.quantity;
  const asBody = (materials) => materials.map(({ productId, quantity }) => ({ productId, quantity, allocations: [] }));

  const mlA = await mkProduct("Toxina A", "produto", "ml");
  const mlB = await mkProduct("Toxina B", "produto", "ml");
  const mlC = await mkProduct("Toxina C", "produto", "ml");
  const unitHalf = await mkProduct("Unidade Meia", "material", "unidade");
  const unitBig = await mkProduct("Unidade Grande", "material", "unidade");
  const lotted = await mkProduct("Lotes", "material", "unidade");
  const exact = await mkProduct("Saldo Exato", "material", "unidade");
  if (!(mlA && mlB && mlC && unitHalf && unitBig && lotted && exact)) { check("lacunas materiais: produtos criados", false); return; }

  // (a) Cálculo
  const pDec = await mkProc(`E2E MG Decimais ${run}`, [[mlA.id, 0.333], [mlB.id, 0.5], [mlC.id, 0.1], [unitHalf.id, 0.5], [unitBig.id, 6000]]);
  let r = await open(await mkQuote([{ procedure: pDec, quantity: 3, extra: { discountCents: 5000 } }]));
  let m = byProduct(r.data.session?.materials);
  check("lacunas materiais: 0,333 ml x 3 = 0,999 (3 casas) e item com desconto não muda a conta", r.status === 201 && m[mlA.id]?.quantity === 0.999, m[mlA.id]?.quantity);
  check("lacunas materiais: 0,5 ml x 3 = 1,5 e 0,1 ml x 3 = 0,3 (sem ruído de ponto flutuante)", m[mlB.id]?.quantity === 1.5 && m[mlC.id]?.quantity === 0.3, `${m[mlB.id]?.quantity} ${m[mlC.id]?.quantity}`);
  check("lacunas materiais: unidade inteira 0,5 x 3 = 1,5 arredonda para cima (2)", m[unitHalf.id]?.quantity === 2, m[unitHalf.id]?.quantity);
  check("lacunas materiais: quantidade enorme (6000 x 3) fica limitada a 10000 e a PATCH aceita", m[unitBig.id]?.quantity === 10000 && (await api("PATCH", `${url()}/${r.data.session.id}`, { materials: asBody(r.data.session.materials) })).status === 200);
  const pSimple = await mkProc(`E2E MG Simples ${run}`, [[mlB.id, 0.5], [unitHalf.id, 1]]);
  r = await open(await mkQuote([{ procedure: pSimple, quantity: 1 }, { procedure: pSimple, quantity: 2 }]));
  check("lacunas materiais: mesmo procedimento em duas linhas soma as quantidades (1+2 = 3x)", qtyOf(r, mlB.id) === 1.5 && qtyOf(r, unitHalf.id) === 3, `${qtyOf(r, mlB.id)} ${qtyOf(r, unitHalf.id)}`);
  const odd = [["zero", { quantity: 0 }, 0.5], ["ausente", {}, 0.5], ["fracionada 2,7", { quantity: 2.7 }, 1], ["negativa", { quantity: -3 }, 0.5], ["texto", { quantity: "2" }, 0.5]];
  for (const [label, item, expected] of odd) {
    const res = await open(await mkQuote([{ procedure: pSimple, ...item }]));
    check(`lacunas materiais: quantidade ${label} no orçamento => ${expected} ml (mínimo 1x, fração para baixo)`, res.status === 201 && qtyOf(res, mlB.id) === expected, `${res.status} ${qtyOf(res, mlB.id)}`);
  }
  const ghost = { id: "procedimento-que-nao-existe", name: "Fantasma" };
  r = await open(await mkQuote([{ procedure: pSimple, quantity: 1 }, { procedure: ghost, quantity: 1 }]));
  check("lacunas materiais: procedimento removido do catálogo no orçamento não impede a sessão", r.status === 201 && qtyOf(r, mlB.id) === 0.5, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  const qLegacy = await mkQuote([{ procedure: pSimple, quantity: 1 }], { legacy: `${pSimple.name} (4x), Item Que Nao Existe (2x)` });
  await prisma.quote.update({ where: { id: qLegacy }, data: { details: "{}" } });
  r = await open(qLegacy);
  check("lacunas materiais: orçamento legado '(4x)' + item desconhecido => 4x só do conhecido", r.status === 201 && qtyOf(r, mlB.id) === 2 && qtyOf(r, unitHalf.id) === 4, `${r.status} ${qtyOf(r, mlB.id)}`);
  const pNoSheet = await mkProc(`E2E MG SemFicha ${run}`, []);
  r = await open(await mkQuote([{ procedure: pNoSheet, quantity: 2 }, { procedure: pSimple, quantity: 1 }]));
  check("lacunas materiais: procedimento sem ficha ao lado de outro com ficha só traz o da ficha", r.status === 201 && r.data.session.materials.length === 2, r.data.session?.materials?.length);

  // Limite de 40 itens
  const many = [];
  for (let start = 0; start < 41; start += 10) many.push(...await Promise.all(Array.from({ length: Math.min(10, 41 - start) }, (_, i) => mkProduct(`Muitos ${String(start + i).padStart(2, "0")}`, "material", "unidade"))));
  const pMany = await mkProc(`E2E MG Muitos ${run}`, many.map((product) => [product.id, 1]));
  r = await open(await mkQuote([{ procedure: pMany, quantity: 1 }]));
  const manyMaterials = r.data.session?.materials ?? [];
  check("lacunas materiais: ficha com 41 produtos semeia no máximo 40 (ordem por nome)", r.status === 201 && manyMaterials.length === 40 && !manyMaterials.some((item) => item.productId === many[40].id), `${r.status} ${manyMaterials.length}`);
  check("lacunas materiais: os 40 semeados passam na PATCH (limite de itens)", (await api("PATCH", `${url()}/${r.data.session.id}`, { materials: asBody(manyMaterials) })).status === 200);

  // (b) Lotes / FEFO
  await buy([[lotted.id, "LA", 10, 2], [lotted.id, "LB", 5, 1], [lotted.id, "LC", 40, 10], [lotted.id, "LX", 20, 100], [exact.id, "EA", 7, 3]]);
  await prisma.stockLot.updateMany({ where: { productId: lotted.id, code: `LX${run}` }, data: { expiresOn: new Date(`${day(-3)}T00:00:00Z`) } });
  const pL6 = await mkProc(`E2E MG L6 ${run}`, [[lotted.id, 6]]);
  const pL13 = await mkProc(`E2E MG L13 ${run}`, [[lotted.id, 13]]);
  const pL14 = await mkProc(`E2E MG L14 ${run}`, [[lotted.id, 14]]);
  const pEx = await mkProc(`E2E MG Exato ${run}`, [[exact.id, 3]]);
  r = await open(await mkQuote([{ procedure: pL6, quantity: 1 }]));
  const s6 = r.data.session;
  check("lacunas materiais: 3 lotes + 1 vencido => FEFO ignora o vencido (LB:1,LA:2,LC:3)", lotsOf(byProduct(s6.materials)[lotted.id]) === "LB:1,LA:2,LC:3", lotsOf(byProduct(s6.materials)[lotted.id]));
  check("lacunas materiais: availableAtSave reflete o saldo de cada lote", byProduct(s6.materials)[lotted.id].allocations.map((a) => a.availableAtSave).join() === "1,2,10");
  r = await open(await mkQuote([{ procedure: pL13, quantity: 1 }]));
  const s13 = r.data.session;
  check("lacunas materiais: pedido igual ao saldo total (13) usa os 3 lotes sem sobra", lotsOf(byProduct(s13.materials)[lotted.id]) === "LB:1,LA:2,LC:10", lotsOf(byProduct(s13.materials)[lotted.id]));
  r = await open(await mkQuote([{ procedure: pL14, quantity: 1 }]));
  const item14 = byProduct(r.data.session.materials)[lotted.id];
  check("lacunas materiais: pedido acima do saldo (14) mantém 14 e aloca só 13", item14?.quantity === 14 && lotsOf(item14) === "LB:1,LA:2,LC:10", `${item14?.quantity} ${lotsOf(item14)}`);
  r = await open(await mkQuote([{ procedure: pEx, quantity: 1 }]));
  check("lacunas materiais: saldo exato em um único lote (3 de 3)", lotsOf(byProduct(r.data.session.materials)[exact.id]) === "EA:3", lotsOf(byProduct(r.data.session.materials)[exact.id]));

  // Ficha mudada / produto arquivado / excluído depois da semeadura
  const snap6 = JSON.stringify(s6.materials);
  await prisma.procedureMaterial.updateMany({ where: { procedureId: pL6.id }, data: { quantity: 99 } });
  await prisma.product.update({ where: { id: lotted.id }, data: { archivedAt: new Date() } });
  r = await open(s6.quoteId);
  const got6 = (await api("GET", `${url()}?journeyId=${J.id}&quoteId=${s6.quoteId}`)).data;
  check("lacunas materiais: ficha alterada e produto arquivado depois não mudam a sessão já semeada (POST/GET)", r.status === 200 && JSON.stringify(r.data.session.materials) === snap6 && JSON.stringify(got6.sessions?.[0]?.materials) === snap6, r.status);
  await prisma.product.update({ where: { id: lotted.id }, data: { archivedAt: null } });
  await prisma.procedureMaterial.updateMany({ where: { procedureId: pL6.id }, data: { quantity: 6 } });
  const gone = await mkProduct("Excluido", "material", "unidade");
  const pGone = await mkProc(`E2E MG Excluido ${run}`, [[gone.id, 1], [mlB.id, 1]]);
  r = await open(await mkQuote([{ procedure: pGone, quantity: 1 }]));
  const sGone = r.data.session;
  await prisma.product.delete({ where: { id: gone.id } });
  const gotGone = await api("GET", `${url()}?journeyId=${J.id}&quoteId=${sGone.quoteId}`);
  check("lacunas materiais: produto excluído depois: GET e POST seguem 200 com a sessão", gotGone.status === 200 && (await open(sGone.quoteId)).status === 200, gotGone.status);
  const resend = await api("PATCH", `${url()}/${sGone.id}`, { materials: asBody(sGone.materials) });
  const resendWithout = await api("PATCH", `${url()}/${sGone.id}`, { materials: asBody(sGone.materials.filter((x) => x.productId !== gone.id)) });
  check("lacunas materiais: PATCH reenviando o produto excluído é recusada (400) e sem ele passa (200)", resend.status === 400 && resendWithout.status === 200, `${resend.status} ${resendWithout.status}`);

  // (c) Idempotência / concorrência
  for (const n of [2, 10]) {
    const q = await mkQuote([{ procedure: pSimple, quantity: 2 }]);
    const burst = await Promise.all(Array.from({ length: n }, () => open(q)));
    const sessions = await prisma.patientProcedureSession.findMany({ where: { quoteId: q }, select: { materials: true } });
    const same = new Set(burst.map((x) => JSON.stringify(x.data.session?.materials))).size === 1;
    check(`lacunas materiais: ${n} POST simultâneos => 1 sessão, materiais uma vez`, burst.filter((x) => x.status === 201).length === 1 && burst.every((x) => [200, 201].includes(x.status)) && sessions.length === 1 && JSON.parse(sessions[0].materials).length === 2 && same, `${burst.map((x) => x.status).join()} sessões=${sessions.length}`);
  }
  const qLeg = await mkQuote([{ procedure: pSimple, quantity: 1 }]);
  const legacy = (await open(qLeg)).data.session;
  await legacyDraft(legacy.id);
  const viaGet = (await api("GET", `${url()}?journeyId=${J.id}&quoteId=${qLeg}`)).data.sessions?.[0];
  check("lacunas materiais: GET repetido não semeia rascunho legado", viaGet?.materials.length === 0 && (await dbSession(legacy.id)).materialsSeededAt === null);
  const qRen = await mkQuote([{ procedure: pSimple, quantity: 1 }, { procedure: pDec, quantity: 1 }]);
  const ren = (await open(qRen)).data.session;
  await legacyDraft(ren.id, { procedureName: pSimple.name });
  r = await open(qRen);
  check("lacunas materiais: rascunho legado com nome por item é renomeado e semeado", r.status === 200 && r.data.session.procedureName === ren.procedureName && r.data.session.materials.length > 0 && Boolean(r.data.session.materialsSeededAt), `${r.status} ${r.data.session?.procedureName} ${r.data.session?.materials?.length}`);
  // Rascunho legado (marcador nulo) com itens, que o profissional esvazia pela PATCH: reabrir não deve semear de novo.
  const qRem = await mkQuote([{ procedure: pSimple, quantity: 1 }]);
  const rem = (await open(qRem)).data.session;
  await prisma.patientProcedureSession.update({ where: { id: rem.id }, data: { materialsSeededAt: null } });
  await api("PATCH", `${url()}/${rem.id}`, { materials: [] });
  r = await open(qRem);
  check("lacunas materiais: rascunho legado esvaziado pelo profissional não volta a ser semeado ao reabrir", r.data.session?.materials.length === 0, `materiais após reabrir: ${r.data.session?.materials?.length}`);
  // POST x PATCH simultâneos em rascunho legado: a edição do profissional nunca é sobrescrita
  for (let i = 0; i < 6; i++) {
    const q = await mkQuote([{ procedure: pSimple, quantity: 1 }]);
    const s = (await open(q)).data.session;
    await legacyDraft(s.id);
    const edit = [{ productId: unitHalf.id, quantity: 7, allocations: [] }];
    const [post, patch] = await Promise.all([open(q), api("PATCH", `${url()}/${s.id}`, { materials: edit })]);
    const final = JSON.parse((await dbSession(s.id)).materials);
    check(`lacunas materiais: corrida POST x PATCH #${i + 1} em rascunho legado: PATCH 200 => lista final é a do profissional`, [200, 409].includes(patch.status) && (patch.status !== 200 || (final.length === 1 && final[0].productId === unitHalf.id && final[0].quantity === 7)), `${post.status}/${patch.status} final=${final.length}`);
  }
  for (let i = 0; i < 3; i++) {
    const q = await mkQuote([{ procedure: pSimple, quantity: 1 }]);
    const s = (await open(q)).data.session;
    const [post, patch] = await Promise.all([open(q), api("PATCH", `${url()}/${s.id}`, { materials: [{ productId: mlB.id, quantity: 5, allocations: [] }] })]);
    const final = JSON.parse((await dbSession(s.id)).materials);
    check(`lacunas materiais: corrida reuso x PATCH #${i + 1} em sessão semeada preserva a edição`, post.status === 200 && patch.status === 200 && final.length === 1 && final[0].quantity === 5, `${post.status}/${patch.status} ${final.length}`);
  }

  // (d) Finalização
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const form = new FormData();
  form.set("file", new Blob([pdf], { type: "application/pdf" }), "Termo mat lacunas.pdf");
  form.set("category", "TERMOS"); form.set("signatureStatus", "ASSINADO"); form.set("journeyId", J.id);
  check("lacunas materiais: termo assinado enviado", (await fetch(`${baseUrl}/api/patients/${P}/documents`, { method: "POST", headers: { cookie }, body: form })).status === 201);
  const before = { id: `mgb-${run}`, phase: "Antes", imageUrl: dataUrl, name: "antes", width: 1, height: 1 };
  const after = { id: `mga-${run}`, phase: "Imediatamente após", imageUrl: dataUrl, name: "depois", width: 1, height: 1 };
  const clinical = { technique: "E2E técnica", treatedAreas: "E2E região" };
  const strip = (materials) => materials.map(({ productId, quantity, allocations }) => ({ productId, quantity, ...(allocations ? { allocations: allocations.map(({ lotId, quantity: q }) => ({ lotId, quantity: q })) } : {}) }));
  const start = (sessionId, materials) => api("PATCH", `${url()}/${sessionId}`, { ...clinical, materials, status: "Em execução", photos: [before] });
  const finish = (sessionId, materials) => api("PATCH", `${url()}/${sessionId}`, { ...clinical, materials, status: "Concluída", photos: [before, after] });
  const moves = async (sessionId) => (await prisma.stockMovement.findMany({ where: { procedureSessionId: sessionId }, select: { quantity: true, lot: { select: { code: true } } } })).map((x) => `${x.lot.code.replace(run, "")}:${x.quantity}`).sort().join(",");
  const lotBalance = async (productId, code) => { const lot = await prisma.stockLot.findFirst({ where: { productId, code: `${code}${run}` } }); const sum = await prisma.stockMovement.aggregate({ where: { lotId: lot.id }, _sum: { quantity: true } }); return sum._sum.quantity; };

  // baixa conforme o body (lote escolhido pelo profissional), não conforme a semeadura
  const lotLC = await prisma.stockLot.findFirst({ where: { productId: lotted.id, code: `LC${run}` } });
  const chosen = [{ productId: lotted.id, quantity: 13, allocations: [{ lotId: lotLC.id, quantity: 10 }, { lotId: byProduct(s13.materials)[lotted.id].allocations[1].lotId, quantity: 2 }] }];
  r = await start(s13.id, chosen);
  check("lacunas materiais: iniciar com lotes escolhidos pelo profissional => 200", r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
  r = await finish(s13.id, chosen);
  check("lacunas materiais: baixa segue o body (LC 10 + LA 2, faltou 1 => pendente), não a semeadura", r.status === 200 && (await moves(s13.id)) === "LA:-2,LC:-10" && r.data.pending?.[0]?.quantity === 1, `${r.status} ${await moves(s13.id)} ${JSON.stringify(r.data.pending)}`);
  check("lacunas materiais: saldo do lote LC caiu 10 e LB ficou intacto", (await lotBalance(lotted.id, "LC")) === 0 && (await lotBalance(lotted.id, "LB")) === 1);

  // dois rascunhos semeados com o mesmo lote: o segundo a finalizar encontra o lote gasto (LA/LC já consumidos)
  r = await open(await mkQuote([{ procedure: pL6, quantity: 1 }]));
  const secondDraft = r.data.session;
  const seededLots = lotsOf(byProduct(secondDraft.materials)[lotted.id]);
  const thirdDraft = (await open(await mkQuote([{ procedure: pL6, quantity: 1 }]))).data.session;
  await start(thirdDraft.id, strip(thirdDraft.materials));
  r = await finish(thirdDraft.id, strip(thirdDraft.materials));
  check("lacunas materiais: terceira sessão semeada com o mesmo lote finaliza primeiro (200) e consome o lote", r.status === 200 && (await lotBalance(lotted.id, "LB")) === 0, `${r.status} ${await moves(thirdDraft.id)}`);
  await start(secondDraft.id, strip(secondDraft.materials));
  const stale = await finish(secondDraft.id, strip(secondDraft.materials));
  const staleDb = await dbSession(secondDraft.id);
  check("lacunas materiais: sessão semeada com lote que outra sessão gastou depois => finalização 409 sem baixa parcial e sessão continua Em execução", stale.status === 409 && (await moves(secondDraft.id)) === "" && staleDb.status === "Em execução", `semeada com ${seededLots}; finalizar devolveu ${stale.status} ${JSON.stringify(stale.data).slice(0, 120)}`);
  const fresh = (await api("GET", `${url()}?journeyId=${J.id}&quoteId=${secondDraft.quoteId}`)).data.materials.find((x) => x.id === lotted.id);
  const resolved = await finish(secondDraft.id, [{ productId: lotted.id, quantity: 6, allocations: fresh.lots.slice(0, 1).map((lot) => ({ lotId: lot.id, quantity: Math.min(lot.balance, 6) })) }]);
  check("lacunas materiais: profissional reajusta os lotes pelo saldo atual e finaliza (200)", resolved.status === 200, `${resolved.status} ${JSON.stringify(resolved.data).slice(0, 120)}`);

  // allocations: [] explícito => tudo pendente, sem baixa (mesmo havendo saldo)
  const pEmpty = await mkProc(`E2E MG Vazio2 ${run}`, [[exact.id, 3]]);
  r = await open(await mkQuote([{ procedure: pEmpty, quantity: 1 }]));
  const sEmpty = r.data.session;
  const emptyBody = [{ productId: exact.id, quantity: 3, allocations: [] }];
  await start(sEmpty.id, emptyBody);
  r = await finish(sEmpty.id, emptyBody);
  check("lacunas materiais: allocations [] com saldo disponível => 200, tudo pendente e nenhuma baixa", r.status === 200 && r.data.pending?.[0]?.quantity === 3 && (await moves(sEmpty.id)) === "", `${r.status} ${JSON.stringify(r.data.pending)}`);
  // item sem a chave allocations => FEFO automático na finalização
  r = await open(await mkQuote([{ procedure: pEx, quantity: 1 }]));
  const sAuto = r.data.session;
  const autoBody = [{ productId: exact.id, quantity: 3 }];
  await start(sAuto.id, autoBody);
  r = await finish(sAuto.id, autoBody);
  check("lacunas materiais: item sem allocations => FEFO automático (EA 3) sem pendência", r.status === 200 && (await moves(sAuto.id)) === "EA:-3" && !r.data.pending?.length, `${r.status} ${await moves(sAuto.id)}`);
  // produto semeado sem saldo e que ganha estoque depois: a lista da sessão segue com allocations vazias
  const late = await mkProduct("Chegou Depois", "material", "unidade");
  const pLate = await mkProc(`E2E MG Depois ${run}`, [[late.id, 2]]);
  r = await open(await mkQuote([{ procedure: pLate, quantity: 1 }]));
  const sLate = r.data.session;
  await buy([[late.id, "LT", 30, 10]]);
  const lateBody = strip(sLate.materials);
  await start(sLate.id, lateBody);
  r = await finish(sLate.id, lateBody);
  const lateMoves = await moves(sLate.id);
  check("lacunas materiais: item semeado sem lote que depois recebe estoque e é finalizado como veio (allocations []): comportamento atual = tudo pendente, sem baixa do lote novo", r.status === 200 && lateMoves === "" && r.data.pending?.[0]?.quantity === 2, `${r.status} pendente=${JSON.stringify(r.data.pending)} baixas=${lateMoves || "nenhuma"}`);

  // consentimento e campos obrigatórios intactos
  const pCons = await mkProc(`E2E MG Termo ${run}`, [[mlB.id, 1]]);
  const sCons = (await open(await mkQuote([{ procedure: pCons, quantity: 1 }], { journey: J3, evaluation: ev3 }), J3)).data.session;
  r = await start(sCons.id, strip(sCons.materials));
  check("lacunas materiais: iniciar sem termo assinado segue bloqueado (409 com código)", r.status === 409 && Boolean(r.data.code), `${r.status} ${r.data.code}`);
  const sNoTech = (await open(await mkQuote([{ procedure: pCons, quantity: 1 }]))).data.session;
  await start(sNoTech.id, strip(sNoTech.materials));
  r = await api("PATCH", `${url()}/${sNoTech.id}`, { materials: strip(sNoTech.materials), status: "Concluída", photos: [before, after] });
  check("lacunas materiais: finalizar sem técnica/região segue recusado (400) e sem baixa", r.status === 400 && (await moves(sNoTech.id)) === "", r.status);
  r = await api("PATCH", `${url()}/${sNoTech.id}`, { ...clinical, materials: strip(sNoTech.materials), status: "Concluída", photos: [before] });
  check("lacunas materiais: finalizar sem foto de depois segue recusado (400)", r.status === 400, r.status);

  // (e) Papéis, ids estranhos e outra clínica
  const members = [];
  const probeOnQuote = await mkQuote([{ procedure: pSimple, quantity: 1 }]);
  const probeSession = (await open(probeOnQuote)).data.session;
  try {
    for (const [role, login] of [["STAFF", `e2e-mg-staff-${run}@example.com`], ["PROFESSIONAL", `e2e-mg-prof-${run}@example.com`]]) {
      const secret = `E2e-${run}-${role}9!`;
      const created = await api("POST", "/api/team", { name: `E2E ${role} MG`, email: login, password: secret, role });
      if (created.status === 201) members.push(created.data.member);
      const session = created.status === 201 ? await loginAs(login, secret) : null;
      if (session?.status !== 200) { check(`lacunas materiais: usuário ${role} criado`, false, `${created.status} ${session?.status}`); continue; }
      await withSession(session.cookie, async () => {
        const probe = { post: await open(probeOnQuote), get: await api("GET", `${url()}?journeyId=${J.id}&quoteId=${probeOnQuote}`), patch: await api("PATCH", `${url()}/${probeSession.id}`, { materials: [{ productId: mlB.id, quantity: 9, allocations: [] }] }) };
        if (role === "STAFF") {
          check("lacunas materiais: STAFF recebe 403 em POST/GET/PATCH", Object.values(probe).every((x) => x.status === 403), Object.values(probe).map((x) => x.status).join());
        } else {
          check("lacunas materiais: PROFESSIONAL abre (200), lê e edita os materiais", probe.post.status === 200 && probe.get.status === 200 && probe.patch.status === 200 && byProduct(probe.patch.data.session?.materials)[mlB.id]?.quantity === 9, Object.values(probe).map((x) => x.status).join());
          const created2 = await open(await mkQuote([{ procedure: pSimple, quantity: 1 }]));
          check("lacunas materiais: PROFESSIONAL cria sessão nova já semeada (201)", created2.status === 201 && created2.data.session.materials.length === 2, `${created2.status}`);
        }
      });
    }
  } finally {
    for (const member of members) await api("DELETE", "/api/team", { membershipId: member.id });
  }
  const unauth = await withSession("", async () => ({ post: await open(probeOnQuote), get: await api("GET", `${url()}?journeyId=${J.id}&quoteId=${probeOnQuote}`), patch: await api("PATCH", `${url()}/${probeSession.id}`, { materials: [] }) }));
  check("lacunas materiais: sem sessão => 401 em POST/GET/PATCH", Object.values(unauth).every((x) => x.status === 401), Object.values(unauth).map((x) => x.status).join());
  const stranger = { post: await open(probeOnQuote, J, P2), get: await api("GET", `${url(P2)}?journeyId=${J.id}&quoteId=${probeOnQuote}`), patch: await api("PATCH", `${url(P2)}/${probeSession.id}`, { materials: [] }), postJ2: await open(probeOnQuote, J2, P), bogus: await open("id-inexistente"), bogusPatch: await api("PATCH", `${url()}/id-inexistente`, { materials: [] }) };
  check("lacunas materiais: ids de outro paciente/jornada/inexistentes => 404", Object.values(stranger).every((x) => x.status === 404), Object.entries(stranger).map(([k, x]) => `${k}=${x.status}`).join());
  const probeAfterStranger = await dbSession(probeSession.id);
  check("lacunas materiais: tentativas com ids estranhos não alteraram a sessão", JSON.parse(probeAfterStranger.materials).length > 0 && probeAfterStranger.status === "Rascunho");

  const otherEmail = `e2e-mg-outra-${run}@example.com`;
  const otherPassword = `E2e-${run}-Outra9!`;
  const otherClinic = `E2E MG Externa ${run}`;
  try {
    const reg = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990021", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const other = reg.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    if (other?.status === 200) {
      const foreign = await withSession(other.cookie, async () => {
        const product = (await api("POST", "/api/products", { name: `Externo ${run}`, kind: "material", unit: "unidade", costCents: 100, supplier: "F", minStock: 0 })).data.product;
        await api("POST", "/api/purchases", { supplier: "F", purchasedOn: day(0), paymentMethod: "Pix", installments: 1, items: [{ productId: product.id, lotCode: `EXT${run}`, expiresOn: day(30), quantity: 5, unitPriceCents: 100 }] });
        return { product, lot: await prisma.stockLot.findFirst({ where: { productId: product.id } }) };
      });
      const sessionBefore = JSON.stringify(await dbSession(probeSession.id));
      const withForeignProduct = await api("PATCH", `${url()}/${probeSession.id}`, { materials: [{ productId: foreign.product.id, quantity: 1, allocations: [] }] });
      const withForeignLot = await api("PATCH", `${url()}/${probeSession.id}`, { materials: [{ productId: mlB.id, quantity: 1, allocations: [{ lotId: foreign.lot.id, quantity: 1 }] }] });
      check("lacunas materiais: produto ou lote de outra clínica na PATCH => 400 e nada gravado", withForeignProduct.status === 400 && withForeignLot.status === 400 && JSON.stringify(await dbSession(probeSession.id)) === sessionBefore, `${withForeignProduct.status} ${withForeignLot.status}`);
      const foreignView = await withSession(other.cookie, () => api("GET", `${url()}?journeyId=${J.id}&quoteId=${probeOnQuote}`));
      check("lacunas materiais: clínica externa não vê esta sessão no GET (404, sem nomes de produtos)", foreignView.status === 404 && !JSON.stringify(foreignView.data).includes("Toxina"), foreignView.status);
    } else {
      check("lacunas materiais: clínica externa criada para o teste", false, `${reg.status} ${other?.status}`);
    }
  } finally {
    await prisma.clinicMembership.deleteMany({ where: { user: { email: otherEmail } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: otherEmail } });
  }
}

// --- Pendências de estoque: conferência, saída pendente e conclusão (API e tela) ---

async function pendingStock(patient) {
  const lots = async (productId) => Object.fromEntries(((await api("GET", `/api/products/${productId}`)).data.product?.lots ?? []).map((lot) => [lot.code, lot.balance]));
  const pendingList = async () => (await api("GET", "/api/stock/pending")).data;
  const tag = `P${run}`;

  let r = await api("POST", "/api/products", { name: `Pend ${tag}`, kind: "produto", unit: "unidade", costCents: 100, supplier: "F" });
  const prod = r.data.product;
  r = await api("POST", "/api/products", { name: `Outro ${tag}`, kind: "material", unit: "frasco", costCents: 100, supplier: "F" });
  const other = r.data.product;

  // Atendido => entra em "conferências pendentes".
  const appt = (await api("POST", "/api/appointments", { patientId: patient.id, procedure: "Pendência e2e", professional: "Teste", time: "09:00", date: `${day(1)}T00:00:00` })).data.appointment;
  await api("PATCH", `/api/appointments/${appt.id}`, { status: "Atendido" });
  let p = await pendingList();
  check("pendências: atendido aparece em conferências pendentes com nome do paciente", p.checks?.some((c) => c.id === appt.id && c.patientName === patient.name), JSON.stringify(p.checks?.slice(0, 2)));

  // Conferência sem saldo => saída pendente; sai das conferências.
  r = await api("POST", `/api/appointments/${appt.id}/materials`, { items: [{ productId: prod.id, quantity: 3 }] });
  check("pendências: conferência sem saldo gera 1 saída pendente", r.status === 200 && r.data.pending?.length === 1, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  r = await api("POST", `/api/appointments/${appt.id}/materials`, { items: [{ productId: prod.id, quantity: 3 }] });
  check("pendências: conferir de novo => 409 (sem duplicar pendência)", r.status === 409, r.status);
  p = await pendingList();
  const out = p.outputs?.find((o) => o.product.id === prod.id);
  check("pendências: conferência sai da lista de conferências", !p.checks?.some((c) => c.id === appt.id));
  check("pendências: saída pendente com quantidade 3, paciente e sem lotes", out?.quantity === 3 && out.patientName === patient.name && out.lots.length === 0 && out.attendanceKind, JSON.stringify(out));

  r = await api("POST", `/api/stock/pending/${out.id}`, {});
  check("pendências: concluir sem saldo => 400 saldo insuficiente", r.status === 400 && /Saldo insuficiente/.test(r.data.message), `${r.status} ${r.data.message}`);
  check("pendências: continua pendente após falha", (await pendingList()).outputs?.some((o) => o.id === out.id));

  // Lote A (2, vence depois), B (5, vence antes), V vencido (10) e um lote de outro produto.
  r = await api("POST", "/api/purchases", { supplier: "F", purchasedOn: day(0), paymentMethod: "Pix", installments: 1, items: [
    { productId: prod.id, lotCode: `A${tag}`, expiresOn: day(300), quantity: 2, unitPriceCents: 100 },
    { productId: prod.id, lotCode: `B${tag}`, expiresOn: day(100), quantity: 5, unitPriceCents: 100 },
    { productId: prod.id, lotCode: `V${tag}`, expiresOn: day(-5), quantity: 10, unitPriceCents: 100 },
    { productId: other.id, lotCode: `O${tag}`, expiresOn: day(200), quantity: 10, unitPriceCents: 100 },
  ] });
  check("pendências: compra registrada", r.status === 201, `${r.status} ${r.data.message ?? ""}`);
  p = await pendingList();
  const out2 = p.outputs?.find((o) => o.id === out.id);
  check("pendências: lista mostra só lotes não vencidos, por validade, com saldo", out2?.lots.map((l) => `${l.code}:${l.balance}`).join() === `B${tag}:5,A${tag}:2`, JSON.stringify(out2?.lots));
  const lotA = out2.lots.find((l) => l.code === `A${tag}`);
  const lotO = (await api("GET", `/api/products/${other.id}`)).data.product.lots[0];
  const lotV = (await api("GET", `/api/products/${prod.id}`)).data.product.lots.find((l) => l.code === `V${tag}`);

  r = await api("POST", `/api/stock/pending/${out.id}`, { lotId: lotA.id });
  check("pendências: lote escolhido com saldo menor que o pedido => 400 e nada baixado", r.status === 400 && (await lots(prod.id))[`A${tag}`] === 2, `${r.status} ${r.data.message}`);
  r = await api("POST", `/api/stock/pending/${out.id}`, { lotId: lotO.id });
  check("pendências: lote de outro produto => 400 lote inválido", r.status === 400 && /lote válido/.test(r.data.message), `${r.status} ${r.data.message}`);
  r = await api("POST", `/api/stock/pending/${out.id}`, { lotId: lotV?.id });
  check("pendências: lote vencido => 400 lote inválido", r.status === 400 && /lote válido/.test(r.data.message), `${r.status} ${r.data.message}`);
  check("pendências: continua pendente após recusas", (await pendingList()).outputs?.some((o) => o.id === out.id));

  // STAFF e PROFESSIONAL: 403 no GET e no POST.
  const members = [];
  try {
    for (const role of ["STAFF", "PROFESSIONAL"]) {
      const login = `e2e-pend-${role.toLowerCase()}-${run}@example.com`, secret = `E2e-${run}-Pend9!`;
      const created = await api("POST", "/api/team", { name: `E2E ${role} Pend`, email: login, password: secret, role });
      if (created.status === 201) members.push(created.data.member);
      const s = created.status === 201 ? await loginAs(login, secret) : null;
      const res = s?.status === 200 ? await withSession(s.cookie, async () => [await api("GET", "/api/stock/pending"), await api("POST", `/api/stock/pending/${out.id}`, {})]) : [];
      check(`pendências: ${role} recebe 403 no GET e no POST`, res.length === 2 && res.every((x) => x.status === 403), res.map((x) => x.status).join() || `team ${created.status} login ${s?.status}`);
    }
  } finally {
    // A clínica de teste precisa voltar a ter só a conta de teste, senão resetTestClinic recusa a limpeza.
    for (const m of members) await api("DELETE", "/api/team", { membershipId: m.id });
  }
  r = await withSession("", () => api("POST", `/api/stock/pending/${out.id}`, {}));
  check("pendências: sem sessão => 401", r.status === 401, r.status);

  // Outra clínica: não vê e não conclui.
  const otherEmail = `e2e-pend-outra-${run}@example.com`, otherPassword = `E2e-${run}-Outra9!`, otherClinic = `E2E Pend Externa ${run}`;
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990020", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const ext = r.status === 201 ? await loginAs(otherEmail, otherPassword) : null;
    const res = ext?.status === 200 ? await withSession(ext.cookie, async () => [await api("GET", "/api/stock/pending"), await api("POST", `/api/stock/pending/${out.id}`, {})]) : null;
    check("pendências: outra clínica não vê a pendência e concluir => 400", res && !JSON.stringify(res[0].data).includes(prod.name) && res[1].status === 400, res ? `${res[0].status} ${res[1].status}` : `registro ${r.status}`);
    check("pendências: tentativa externa não concluiu nem baixou", (await pendingList()).outputs?.some((o) => o.id === out.id) && (await lots(prod.id))[`B${tag}`] === 5);
  } finally {
    await prisma.clinicMembership.deleteMany({ where: { user: { email: otherEmail } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: otherEmail } });
  }

  // Concluir duas vezes ao mesmo tempo, sem lote (FEFO): só uma passa e baixa uma vez do lote B.
  const pair = await Promise.all([api("POST", `/api/stock/pending/${out.id}`, {}), api("POST", `/api/stock/pending/${out.id}`, {})]);
  check("pendências: conclusão dupla simultânea => 200 + 400", pair.map((x) => x.status).sort().join() === "200,400", pair.map((x) => x.status).join());
  const after = await lots(prod.id);
  check("pendências: FEFO baixou 3 do lote B (vence antes), A intacto", after[`B${tag}`] === 2 && after[`A${tag}`] === 2, JSON.stringify(after));
  check("pendências: saída concluída some da lista", !(await pendingList()).outputs?.some((o) => o.id === out.id));
  const moves = await prisma.stockMovement.findMany({ where: { productId: prod.id, quantity: { lt: 0 } }, select: { quantity: true, appointmentId: true, patientId: true, notes: true } });
  check("pendências: movimento ligado ao atendimento e ao paciente", moves.length === 1 && moves[0].quantity === -3 && moves[0].appointmentId === appt.id && moves[0].patientId === patient.id && moves[0].notes === "Saída pendente concluída", JSON.stringify(moves));
  r = await api("POST", `/api/stock/pending/${out.id}`, {});
  check("pendências: concluir de novo => 400 já concluída", r.status === 400 && /já concluída/.test(r.data.message), `${r.status} ${r.data.message}`);
  r = await api("POST", "/api/stock/pending/inexistente", {});
  check("pendências: id inexistente => 400", r.status === 400, r.status);

  // Saldo parcial: a conferência baixa o que há (B 2 + A 2) e só a falta (5) fica pendente, com aviso.
  const appt2 = (await api("POST", "/api/appointments", { patientId: patient.id, procedure: "Pendência e2e 2", professional: "Teste", time: "10:00", date: `${day(1)}T00:00:00` })).data.appointment;
  await api("PATCH", `/api/appointments/${appt2.id}`, { status: "Atendido" });
  r = await api("POST", `/api/appointments/${appt2.id}/materials`, { items: [{ productId: prod.id, quantity: 9 }] });
  const partial = await lots(prod.id);
  check("pendências: conferência com saldo parcial baixa o que há e só a falta fica pendente", r.data.pending?.[0]?.quantity === 5 && partial[`A${tag}`] === 0 && partial[`B${tag}`] === 0, JSON.stringify([r.data.pending, partial]));
  const alerts = (await api("GET", "/api/stock/alerts")).data.alerts ?? [];
  check("pendências: aviso de saída pendente aparece", alerts.some((a) => a.kind === "pending" && /saídas? de estoque pendentes?/.test(a.message)), JSON.stringify(alerts.map((a) => a.kind)));

  // Tela: Compras > Pendências mostra a saída, filtra, escolhe o lote e conclui.
  await api("POST", "/api/purchases", { supplier: "F", purchasedOn: day(0), paymentMethod: "Pix", installments: 1, items: [{ productId: prod.id, lotCode: `C${tag}`, expiresOn: day(400), quantity: 20, unitPriceCents: 100 }] });
  const lotC = (await api("GET", `/api/products/${prod.id}`)).data.product.lots.find((l) => l.code === `C${tag}`);
  await withPage(async (page, pageErrors) => {
    await page.goto(`${baseUrl}/compras`);
    await page.getByRole("main").getByRole("button", { name: "Pendências", exact: true }).click();
    const rows = page.locator("div.flex-col").filter({ hasText: `Pend ${tag}` }).filter({ has: page.getByRole("button", { name: "Concluir saída" }) });
    await rows.first().waitFor();
    check("pendências (tela): saída pendente aparece em Compras > Pendências", true);
    await page.getByLabel("Tipo de pendência").selectOption("checks");
    check("pendências (tela): filtro de conferências esconde as saídas", (await page.getByRole("button", { name: "Concluir saída" }).count()) === 0);
    await page.getByLabel("Tipo de pendência").selectOption("all");
    await rows.first().getByLabel("Lote").selectOption(lotC.id);
    await rows.first().getByRole("button", { name: "Concluir saída" }).click();
    await page.getByText(`Saída de Pend ${tag} concluída.`).waitFor();
    await rows.first().waitFor({ state: "detached" });
    const balances = await lots(prod.id);
    check("pendências (tela): concluir baixa 5 do lote escolhido (C) e a saída some da lista", balances[`C${tag}`] === 15 && balances[`V${tag}`] === 10, JSON.stringify(balances));
    check("pendências (tela): sem erro de JavaScript", pageErrors.length === 0, pageErrors.join(" | "));
  });
}

// CPF mascarado para STAFF: listas, lookup, detalhe, PATCH, POST e orçamentos. ADMIN vê completo e pode limpar.
async function patientCpfMask() {
  const staffEmail = `e2e-staff-cpf-${run}@example.com`;
  const staffPassword = `E2e-${run}-Staff9!`;
  const cpf = randomCpf();
  const masked = `***.***.***-${cpf.slice(-2)}`;
  const nameKey = `Mascara ${run}`;
  let team = null;
  let r = await api("POST", "/api/patients", { name: nameKey, phone: "11999990077", age: 33, cpf });
  const target = r.data.patient;
  check("CPF (máscara): ADMIN cadastra e recebe o CPF completo", r.status === 201 && target?.cpf === cpf, `${r.status} ${target?.cpf}`);
  r = await api("GET", `/api/patients?q=${encodeURIComponent(nameKey)}`);
  check("CPF (máscara): ADMIN vê CPF completo na lista", r.data.patients?.find((p) => p.id === target.id)?.cpf === cpf);
  r = await api("GET", `/api/patients/lookup?q=${cpf.slice(0, 5)}`);
  check("CPF (máscara): ADMIN busca CPF parcial (5 dígitos) no lookup e vê completo", r.data.patients?.find((p) => p.id === target.id)?.cpf === cpf, JSON.stringify(r.data).slice(0, 120));
  try {
    r = await api("POST", "/api/team", { name: "E2E Atendente CPF", email: staffEmail, password: staffPassword, role: "STAFF" });
    team = r.status === 201 ? r.data.member : null;
    const staff = team ? await loginAs(staffEmail, staffPassword) : null;
    if (staff?.status !== 200) { check("usuário STAFF criado para testar o CPF mascarado", false, `team ${r.status} login ${staff?.status}`); return; }
    const has = (value) => JSON.stringify(value).includes(cpf);
    const s = await withSession(staff.cookie, async () => {
      const out = {};
      out.list = await api("GET", `/api/patients?q=${encodeURIComponent(nameKey)}`);
      out.plain = await api("GET", "/api/patients");
      out.one = await api("GET", `/api/patients/${target.id}`);
      out.partial = await api("GET", `/api/patients/lookup?q=${cpf.slice(0, 5)}`);
      out.tenDigits = await api("GET", `/api/patients/lookup?q=${cpf.slice(0, 10)}`);
      out.formatted = await api("GET", `/api/patients/lookup?q=${encodeURIComponent(`${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`)}`);
      out.exact = await api("GET", `/api/patients/lookup?q=${cpf}`);
      out.byName = await api("GET", `/api/patients/lookup?q=${encodeURIComponent(nameKey)}`);
      out.quotes = await api("GET", "/api/quotes");
      out.maskedPost = await api("POST", "/api/patients", { name: `Mascarado ${run}`, phone: "11999990078", age: 30, cpf: "***.***.***-12" });
      out.patchAbsent = await api("PATCH", `/api/patients/${target.id}`, { name: `${nameKey} B`, phone: "11999990077", age: 34 });
      out.patchMasked = await api("PATCH", `/api/patients/${target.id}`, { name: `${nameKey} C`, phone: "11999990077", age: 35, cpf: masked });
      out.patchEmpty = await api("PATCH", `/api/patients/${target.id}`, { name: `${nameKey} D`, phone: "11999990077", age: 36, cpf: "" });
      return out;
    });
    const row = (res) => res.data.patients?.find((p) => p.id === target.id);
    check("CPF (máscara): STAFF recebe só os 2 últimos dígitos na lista paginada e na lista simples", row(s.list)?.cpf === masked && !has(s.list.data) && !has(s.plain.data), row(s.list)?.cpf);
    check("CPF (máscara): STAFF recebe CPF mascarado no detalhe do paciente", s.one.status === 200 && s.one.data.patient?.cpf === masked && !has(s.one.data), s.one.data.patient?.cpf);
    check("CPF (máscara): STAFF com trecho de CPF (5 e 10 dígitos) não encontra o paciente", !row(s.partial) && !row(s.tenDigits) && s.partial.status === 200 && s.tenDigits.status === 200, `${s.partial.data.patients?.length}/${s.tenDigits.data.patients?.length}`);
    check("CPF (máscara): STAFF com os 11 dígitos exatos encontra o paciente, mascarado", row(s.exact)?.cpf === masked && !has(s.exact.data), JSON.stringify(s.exact.data).slice(0, 120));
    check("CPF (máscara): STAFF com CPF formatado completo encontra o paciente", row(s.formatted)?.cpf === masked, JSON.stringify(s.formatted.data).slice(0, 120));
    check("CPF (máscara): STAFF busca por nome e vê mascarado", row(s.byName)?.cpf === masked && !has(s.byName.data));
    check("CPF (máscara): lista de orçamentos do STAFF não vaza o CPF", s.quotes.status === 200 && !has(s.quotes.data), s.quotes.status);
    check("CPF (máscara): POST com asteriscos no CPF é recusado (400)", s.maskedPost.status === 400, s.maskedPost.status);
    check("CPF (máscara): PATCH do STAFF sem cpf, com cpf mascarado ou vazio responde 200 e devolve mascarado", [s.patchAbsent, s.patchMasked, s.patchEmpty].every((x) => x.status === 200 && x.data.patient?.cpf === masked), [s.patchAbsent, s.patchMasked, s.patchEmpty].map((x) => `${x.status}:${x.data.patient?.cpf}`).join(" "));
    const stored = await prisma.patient.findUnique({ where: { id: target.id }, select: { cpf: true, name: true, age: true } });
    check("CPF (máscara): no banco o CPF original foi mantido após os PATCH do STAFF, mas nome/idade mudaram", stored.cpf === cpf && stored.name === `${nameKey} D` && stored.age === 36, JSON.stringify(stored));
    const fresh = randomCpf();
    const staffNew = await withSession(staff.cookie, () => api("PATCH", `/api/patients/${target.id}`, { name: `${nameKey} D`, phone: "11999990077", age: 36, cpf: fresh }));
    check("CPF (máscara): STAFF consegue informar um CPF completo novo (e vê mascarado)", staffNew.status === 200 && staffNew.data.patient?.cpf === `***.***.***-${fresh.slice(-2)}` && (await prisma.patient.findUnique({ where: { id: target.id }, select: { cpf: true } })).cpf === fresh, `${staffNew.status} ${staffNew.data.patient?.cpf}`);
    r = await api("PATCH", `/api/patients/${target.id}`, { name: `${nameKey} D`, phone: "11999990077", age: 36, cpf });
    check("CPF (máscara): ADMIN volta ao CPF original e vê completo", r.status === 200 && r.data.patient?.cpf === cpf, `${r.status} ${r.data.patient?.cpf}`);
    r = await api("PATCH", `/api/patients/${target.id}`, { name: `${nameKey} D`, phone: "11999990077", age: 36, cpf: masked });
    check("CPF (máscara): ADMIN enviando CPF mascarado não grava o valor mascarado", r.status === 200 && (await prisma.patient.findUnique({ where: { id: target.id }, select: { cpf: true } })).cpf === cpf, r.status);
    r = await api("PATCH", `/api/patients/${target.id}`, { name: `${nameKey} D`, phone: "11999990077", age: 36 });
    check("CPF (máscara): ADMIN sem cpf no PATCH mantém o CPF", r.status === 200 && r.data.patient?.cpf === cpf);
    r = await api("PATCH", `/api/patients/${target.id}`, { name: `${nameKey} D`, phone: "11999990077", age: 36, cpf: "" });
    check("CPF (máscara): ADMIN com cpf vazio limpa o CPF", r.status === 200 && r.data.patient?.cpf == null && (await prisma.patient.findUnique({ where: { id: target.id }, select: { cpf: true } })).cpf === null, `${r.status} ${r.data.patient?.cpf}`);
  } finally {
    if (team) await api("DELETE", "/api/team", { membershipId: team.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: staffEmail } } });
    await prisma.user.deleteMany({ where: { email: staffEmail } });
  }
}

// Preço com centavos no catálogo e no orçamento (Procedure.price é Float): ida e volta, vírgula pt-BR, multiplicação, desconto.
async function quoteCents() {
  const patient = (await api("POST", "/api/patients", { name: `Centavos ${run}`, phone: "11999990066", age: 29 })).data.patient;
  const mk = (name, price) => api("POST", "/api/procedures", { custom: true, name: `E2E Cent ${name} ${run}`, category: "Teste", price, durationMinutes: 30, margin: 30 });
  let r = await mk("a", "349,90");
  const a = r.data.procedure;
  check("centavos: procedimento \"349,90\" grava 349.9 e volta igual na listagem", r.status === 201 && a?.price === 349.9 && (await api("GET", "/api/procedures")).data.procedures?.find((p) => p.id === a.id)?.price === 349.9, `${r.status} ${a?.price}`);
  r = await mk("b", "1.234,50");
  const b = r.data.procedure;
  check("centavos: \"1.234,50\" grava 1234.5", r.status === 201 && b?.price === 1234.5, `${r.status} ${b?.price}`);
  r = await mk("c", 200);
  const c = r.data.procedure;
  check("centavos: preço inteiro (200) segue inteiro", r.status === 201 && c?.price === 200 && (await prisma.procedure.findUnique({ where: { id: c.id }, select: { price: true } })).price === 200, `${r.status} ${c?.price}`);
  r = await api("PATCH", `/api/procedures/${c.id}`, { price: 0.1 });
  check("centavos: PATCH 0.1 grava 0.1", r.status === 200 && r.data.procedure.price === 0.1, `${r.status} ${r.data.procedure?.price}`);
  for (const bad of ["Infinity", "abc", 1e12, "1e3", "12,3,4"]) {
    const bad2 = await mk("x", bad);
    check(`centavos: preço ${JSON.stringify(bad)} é recusado (400)`, bad2.status === 400, bad2.status);
  }
  r = await mk("neg", -5);
  check("centavos: preço negativo vira 0", r.status === 201 && r.data.procedure?.price === 0, `${r.status} ${r.data.procedure?.price}`);

  const journey = (await api("POST", `/api/patients/${patient.id}/journeys`, { name: `Jornada cent ${run}`, professionalId: (await api("GET", "/api/team/professionals")).data.professionals?.[0]?.id })).data.journey;
  const evaluation = (await api("PUT", `/api/patients/${patient.id}/evaluation`, { journeyId: journey.id, photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
  const quoteBody = (details) => ({ patientId: patient.id, journeyId: journey.id, evaluationId: evaluation.id, details, paymentMethod: "Pix", installments: 1, notes: "", status: "Rascunho" });
  r = await api("POST", "/api/quotes", quoteBody([{ procedureId: a.id, quantity: 3, discountCents: 0 }]));
  check("centavos: orçamento 349,90 x 3 = 1049,70", r.status === 201 && r.data.quote?.total === 1049.7, `${r.status} ${r.data.quote?.total}`);
  const firstId = r.data.quote?.id;
  const dbFirst = await prisma.quote.findUnique({ where: { id: firstId }, select: { totalCents: true } });
  check("centavos: totalCents no banco é 104970", dbFirst?.totalCents === 104970, dbFirst?.totalCents);
  r = await api("POST", "/api/quotes", quoteBody([{ procedureId: a.id, quantity: 3, discountCents: 1000 }, { procedureId: b.id, quantity: 1, discountCents: 50 }]));
  check("centavos: desconto em centavos (349,90x3 - 10,00 + 1234,50 - 0,50 = 2273,70)", r.status === 201 && r.data.quote?.total === 2273.7, `${r.status} ${r.data.quote?.total}`);
  const quoteId = r.data.quote?.id;
  r = await api("GET", `/api/quotes?patientId=${patient.id}`);
  check("centavos: listagem de orçamentos devolve o mesmo total", r.data.quotes?.find((item) => item.id === quoteId)?.total === 2273.7, r.status);
  r = await api("POST", "/api/quotes", quoteBody([{ procedureId: a.id, quantity: 1, discountCents: 34991 }]));
  check("centavos: desconto maior que o subtotal em 1 centavo é recusado", r.status === 400, r.status);
  r = await api("POST", "/api/quotes", quoteBody([{ procedureId: (await mk("int", 200)).data.procedure.id, quantity: 2, discountCents: 0 }]));
  check("centavos: procedimento de preço inteiro antigo segue 200 x 2 = 400", r.status === 201 && r.data.quote?.total === 400, `${r.status} ${r.data.quote?.total}`);
}

// App mobile: login por token, Bearer nas rotas existentes, envio de uma foto à avaliação (append-only) e miniaturas.
async function mobilePhotos() {
  const sharp = (await import("sharp")).default;
  const jpg = (width, height) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 90 } } }).jpeg().toBuffer();
  const png = (width, height) => sharp({ create: { width, height, channels: 3, background: { r: 20, g: 120, b: 90 } } }).png().toBuffer();
  const mobileLogin = async (loginName, secret) => {
    const response = await fetch(`${baseUrl}/api/mobile/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: loginName, password: secret }) });
    return { status: response.status, data: await response.json().catch(() => null), setCookie: response.headers.getSetCookie() };
  };
  const call = (token, method, path, { form, json } = {}) => fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) }, body: form ?? (json ? JSON.stringify(json) : undefined) });
  const callJson = async (...args) => { const response = await call(...args); return { status: response.status, data: await response.json().catch(() => null) }; };
  const makeForm = (buffer, fields = {}, { type = "image/jpeg", filename = "foto.jpg" } = {}) => {
    const form = new FormData();
    form.set("file", new Blob([buffer], { type }), filename);
    for (const [key, value] of Object.entries({ width: "400", height: "300", ...fields })) if (value !== undefined) form.set(key, String(value));
    return form;
  };
  const upload = (token, patientId, buffer, fields = {}, options = {}) => callJson(token, "POST", `/api/patients/${patientId}/evaluation/photos`, { form: makeForm(buffer, fields, options) });
  const evalCount = (patientId) => prisma.evaluation.count({ where: { patientId } });
  const small = await jpg(400, 300);
  const decoded = (id) => prisma.evaluationPhoto.findUnique({ where: { id }, select: { width: true, height: true } });

  // --- Login do app ---
  const good = await mobileLogin(email, password);
  const token = good.data?.token;
  const expires = Date.parse(good.data?.expiresAt);
  check("mobile: login 200 devolve token, expiresAt (~3 dias), usuário e clínica, sem Set-Cookie", good.status === 200 && typeof token === "string" && expires > Date.now() + 2.9 * 86_400_000 && expires < Date.now() + 3.1 * 86_400_000 && good.data.user?.email === email && good.data.user?.role === "ADMIN" && good.data.user?.clinic?.name === testClinicName && "trialEndsAt" in good.data.user.clinic && good.setCookie.length === 0, `${good.status} ${JSON.stringify(good.data).slice(0, 120)}`);
  let r = await mobileLogin(email, "senha-errada");
  check("mobile: senha errada devolve 401 com a mensagem da web e sem token", r.status === 401 && r.data.message === "Usuário ou senha inválidos." && !r.data.token, r.status);
  const ghost = await mobileLogin(`ninguem-${run}@example.com`, "qualquer-senha");
  check("mobile: usuário inexistente devolve a mesma resposta 401 da senha errada", ghost.status === 401 && ghost.data.message === "Usuário ou senha inválidos.", ghost.status);
  r = await mobileLogin("", "");
  check("mobile: corpo sem usuário/senha devolve 400", r.status === 400, r.status);
  const webLogin = await withSession("", () => api("POST", "/api/auth/login", { login: email, password }));
  check("web: a resposta do login continua sem token no corpo", webLogin.status === 200 && !("token" in webLogin.data) && !JSON.stringify(webLogin.data).includes(token), JSON.stringify(Object.keys(webLogin.data)));

  // --- Bearer x cookie nas rotas existentes ---
  r = await callJson(token, "GET", "/api/auth/me");
  check("Bearer: GET /api/auth/me devolve o usuário", r.status === 200 && r.data.user?.email === email, r.status);
  check("Bearer: sem credencial e token adulterado/malformado recebem 401", (await callJson(null, "GET", "/api/auth/me")).status === 401 && (await callJson(`${token}x`, "GET", "/api/auth/me")).status === 401 && (await callJson("abc", "GET", "/api/auth/me")).status === 401);
  // Cookie válido tem prioridade; cookie inválido cai para o Bearer; sessão de troca de senha nunca vale.
  const withHeaders = async (headers) => { const response = await fetch(`${baseUrl}/api/auth/me`, { headers }); return response.status; };
  const mixed = [await withHeaders({ cookie: "harmonize_session=lixo", Authorization: `Bearer ${token}` }), await withHeaders({ cookie, Authorization: "Bearer lixo" }), await withHeaders({ cookie: "harmonize_session=lixo", Authorization: "Bearer lixo" })];
  check("cookie+Bearer: cookie inválido usa o Bearer válido (200), cookie válido ignora Bearer ruim (200), ambos inválidos 401", mixed.join("/") === "200/200/401", mixed.join("/"));
  const cookieMe = await api("GET", "/api/auth/me");
  check("cookie continua funcionando em /api/auth/me", cookieMe.status === 200 && cookieMe.data.user?.id === r.data.user?.id, cookieMe.status);

  const patient = (await api("POST", "/api/patients", { name: `Foto App ${run}`, phone: "11999990101", age: 33 })).data.patient;
  r = await callJson(token, "GET", `/api/patients/lookup?q=${encodeURIComponent(`Foto App ${run}`)}`);
  check("Bearer: GET /api/patients/lookup?q= encontra o paciente", r.status === 200 && JSON.stringify(r.data).includes(patient.id), `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);

  // --- Envio: validações antes de existir qualquer avaliação ---
  const url = `/api/patients/${patient.id}/evaluation/photos`;
  r = await upload(null, patient.id, small);
  check("upload: sem token devolve 401", r.status === 401, r.status);
  r = await upload(token, patient.id, Buffer.from("isto não é imagem"), {}, { type: "text/plain", filename: "a.txt" });
  const rPdf = await upload(token, patient.id, Buffer.from("%PDF-1.4 teste"), {}, { type: "application/pdf", filename: "a.pdf" });
  const rMismatch = await upload(token, patient.id, await png(40, 40), {}, { type: "image/jpeg" });
  check("upload: texto, PDF e MIME divergente do conteúdo devolvem 415", [r, rPdf, rMismatch].every((x) => x.status === 415), [r, rPdf, rMismatch].map((x) => x.status).join("/"));
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4 * 1024 * 1024 + 10)]);
  r = await upload(token, patient.id, big);
  check("upload: arquivo acima de 4 MB devolve 413", r.status === 413, r.status);
  const bad = [["categoria", { category: "Costas" }], ["largura 0", { width: "0" }], ["altura 8001", { height: "8001" }], ["5000x5001 > 25 MP", { width: "5000", height: "5001" }], ["largura decimal", { width: "12.5" }], ["sem largura", { width: undefined }]];
  const badResults = [];
  for (const [label, fields] of bad) badResults.push([label, (await upload(token, patient.id, small, fields)).status]);
  check("upload: categoria e dimensões inválidas devolvem 400", badResults.every(([, status]) => status === 400), JSON.stringify(badResults));
  const noFile = new FormData(); noFile.set("width", "10"); noFile.set("height", "10");
  check("upload: sem arquivo devolve 400", (await callJson(token, "POST", url, { form: noFile })).status === 400);
  check("upload: nada foi criado pelas recusas", (await evalCount(patient.id)) === 0);
  const wrongSize = await upload(token, patient.id, small, { width: "4000", height: "3000" });
  check("upload: dimensões declaradas muito diferentes das reais devolvem 400", wrongSize.status === 400 && /não correspondem/.test(wrongSize.data.message) && (await evalCount(patient.id)) === 0, JSON.stringify(wrongSize.data));
  r = await upload(token, patient.id, small, { journeyId: "naoexiste" });
  check("upload: tratamento inexistente devolve 404", r.status === 404 && (await evalCount(patient.id)) === 0, r.status);
  r = await upload(token, patient.id, small, { evaluationId: "naoexiste" });
  check("upload: avaliação inexistente devolve 404", r.status === 404 && (await evalCount(patient.id)) === 0, r.status);

  // --- Envio: cria rascunho, reaproveita, não apaga as outras ---
  const first = await upload(token, patient.id, small, { category: "Frontal", name: "frontal.jpg" });
  const evId = first.data.evaluation?.id;
  check("upload: primeira foto cria avaliação Rascunho (201) com a resposta do contrato", first.status === 201 && first.data.evaluation?.status === "Rascunho" && first.data.evaluation.photoCount === 1 && first.data.evaluation.created === true && first.data.photo?.sortOrder === 0 && first.data.photo.category === "Frontal" && first.data.photo.name === "frontal" && first.data.photo.width === 400 && first.data.photo.height === 300, `${first.status} ${JSON.stringify(first.data)}`);
  const dbEval = await prisma.evaluation.findUnique({ where: { id: evId }, select: { status: true, clinicId: true, journeyId: true, professional: true } });
  check("upload: avaliação criada na clínica, com jornada e profissional", dbEval?.status === "Rascunho" && dbEval.clinicId === good.data.user.clinic.id && Boolean(dbEval.journeyId) && dbEval.professional === good.data.user.name, JSON.stringify(dbEval));
  const dbPhoto = await prisma.evaluationPhoto.findUnique({ where: { id: first.data.photo.id } });
  check("upload: foto gravada como data URL com annotations []", dbPhoto?.imageUrl.startsWith("data:image/jpeg;base64,") && dbPhoto.annotations === "[]" && dbPhoto.evaluationId === evId);
  const near = await upload(token, patient.id, small, { width: "410", height: "305" });
  const swapped = await upload(token, patient.id, small, { width: "300", height: "400" });
  const nearDb = await decoded(near.data.photo?.id);
  const swappedDb = await decoded(swapped.data.photo?.id);
  check("upload: dimensões levemente diferentes ou com lados trocados (EXIF) são aceitas e o servidor grava as reais dos bytes", near.status === 201 && swapped.status === 201 && nearDb.width === 400 && nearDb.height === 300 && swappedDb.width === 400 && swappedDb.height === 300 && near.data.photo.width === 400, `${near.status}/${swapped.status} ${JSON.stringify(nearDb)}`);
  await prisma.evaluationPhoto.deleteMany({ where: { id: { in: [near.data.photo.id, swapped.data.photo.id] } } });
  const second = await upload(token, patient.id, await png(300, 400), { category: "Perfil direito", width: "300", height: "400" }, { type: "image/png", filename: "p.png" });
  check("upload: segunda foto reaproveita o rascunho (created=false, sortOrder 1, photoCount 2)", second.status === 201 && second.data.evaluation.id === evId && second.data.evaluation.created === false && second.data.photo.sortOrder === 1 && second.data.evaluation.photoCount === 2, JSON.stringify(second.data));
  const viaCookie = await (async () => { const response = await fetch(`${baseUrl}${url}`, { method: "POST", headers: { cookie }, body: makeForm(small, { evaluationId: evId }) }); return { status: response.status, data: await response.json() }; })();
  check("upload: o mesmo endpoint aceita cookie e evaluationId explícito (Rascunho)", viaCookie.status === 201 && viaCookie.data.evaluation.id === evId && viaCookie.data.photo.sortOrder === 2 && viaCookie.data.photo.category === "Outra", JSON.stringify(viaCookie.data));
  check("upload: as fotos anteriores continuam com o mesmo id e há uma só avaliação", (await prisma.evaluationPhoto.count({ where: { id: { in: [first.data.photo.id, second.data.photo.id] }, evaluationId: evId } })) === 2 && (await evalCount(patient.id)) === 1);
  const audit = await prisma.clinicalFileAudit.count({ where: { clinicId: good.data.user.clinic.id, patientId: patient.id, action: "UPLOAD", fileId: { in: [first.data.photo.id, second.data.photo.id, viaCookie.data.photo.id].map((id) => `evaluation:${id}`) } } });
  check("upload: cada foto gera um registro de auditoria UPLOAD", audit === 3, audit);

  // --- Leitura pelo sistema web e pelo app ---
  r = await api("GET", `/api/patients/${patient.id}/evaluation?evaluationId=${evId}`);
  check("GET da avaliação (web) mostra as 3 fotos do app em ordem", r.status === 200 && r.data.evaluation?.photos?.map((p) => p.sortOrder).join(",") === "0,1,2" && r.data.evaluation.photos[0].id === first.data.photo.id && r.data.evaluation.photos[0].annotations.length === 0, r.status);
  r = await callJson(token, "GET", `/api/patients/${patient.id}/photos`);
  const gallery = r.data?.photos ?? [];
  check("Bearer: GET /photos lista as fotos da avaliação (sem base64)", r.status === 200 && gallery.some((p) => p.id === `evaluation:${first.data.photo.id}` && p.category === "Frontal") && !JSON.stringify(r.data).includes("base64"), `${r.status} ${gallery.length}`);
  const imageUrl = `/api/patients/${patient.id}/photos/${encodeURIComponent(`evaluation:${first.data.photo.id}`)}/image`;
  const full = await call(token, "GET", imageUrl);
  const fullBytes = Buffer.from(await full.arrayBuffer());
  check("Bearer: GET .../image devolve o original sem mudança (no-store)", full.status === 200 && full.headers.get("content-type") === "image/jpeg" && fullBytes.equals(small) && /no-store/.test(full.headers.get("cache-control") ?? ""), `${full.status} ${full.headers.get("cache-control")}`);
  check("image sem token devolve 401", (await call(null, "GET", imageUrl)).status === 401);
  const bigPhoto = await upload(token, patient.id, await jpg(1600, 1200), { width: "1600", height: "1200" });
  const bigUrl = `/api/patients/${patient.id}/photos/${encodeURIComponent(`evaluation:${bigPhoto.data.photo?.id}`)}/image`;
  const thumb = await call(token, "GET", `${bigUrl}?size=thumb`);
  const thumbBytes = Buffer.from(await thumb.arrayBuffer());
  const meta = await sharp(thumbBytes).metadata();
  check("miniatura: JPEG 480x360 (lado maior <= 480), Cache-Control private, no-store", thumb.status === 200 && thumb.headers.get("content-type") === "image/jpeg" && meta.format === "jpeg" && meta.width === 480 && meta.height === 360 && thumb.headers.get("cache-control") === "private, no-store", `${thumb.status} ${meta.width}x${meta.height} ${thumb.headers.get("cache-control")}`);
  const smallThumb = await sharp(Buffer.from(await (await call(token, "GET", `${imageUrl}?size=thumb`)).arrayBuffer())).metadata();
  check("miniatura: imagem pequena não é ampliada", smallThumb.width === 400 && smallThumb.height === 300, `${smallThumb.width}x${smallThumb.height}`);
  check("miniatura: size inválido devolve 400 e sem token 401", (await call(token, "GET", `${imageUrl}?size=huge`)).status === 400 && (await call(null, "GET", `${imageUrl}?size=thumb`)).status === 401);
  const viewAudit = await prisma.clinicalFileAudit.count({ where: { patientId: patient.id, action: "VIEW", fileId: `evaluation:${first.data.photo.id}` } });
  check("miniatura e original continuam auditados como VIEW (uma vez na janela)", viewAudit === 1, viewAudit);

  // --- Avaliação concluída nunca é reaberta ---
  const closedPatient = (await api("POST", "/api/patients", { name: `Foto Concluída ${run}`, phone: "11999990102", age: 40 })).data.patient;
  const closed = (await api("PUT", `/api/patients/${closedPatient.id}/evaluation`, { photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
  r = await upload(token, closedPatient.id, small, { evaluationId: closed.id });
  const closedRow = await prisma.evaluation.findUnique({ where: { id: closed.id }, select: { status: true, _count: { select: { photos: true } } } });
  check("upload: avaliação Concluída pedida por id devolve 409 e permanece Concluída sem fotos", r.status === 409 && /já concluída/.test(r.data.message) && closedRow.status === "Concluída" && closedRow._count.photos === 0, `${r.status} ${r.data.message}`);
  r = await upload(token, closedPatient.id, small);
  check("upload: sem evaluationId e sem rascunho cria nova avaliação, sem tocar a concluída", r.status === 201 && r.data.evaluation.created === true && r.data.evaluation.id !== closed.id && (await prisma.evaluation.findUnique({ where: { id: closed.id }, select: { status: true } })).status === "Concluída", JSON.stringify(r.data.evaluation));
  r = await upload(token, closedPatient.id, small);
  check("upload: com concluída e rascunho novo, usa o rascunho", r.status === 201 && r.data.evaluation.created === false && r.data.evaluation.photoCount === 2, JSON.stringify(r.data.evaluation));

  // --- Limite de 20 fotos ---
  const fullPatient = (await api("POST", "/api/patients", { name: `Foto Cheia ${run}`, phone: "11999990103", age: 41 })).data.patient;
  const tiny = `data:image/jpeg;base64,${small.toString("base64")}`;
  const nineteen = Array.from({ length: 19 }, (_, index) => ({ name: `f${index}`, imageUrl: tiny, width: 400, height: 300, category: "Outra", sortOrder: index }));
  const draft19 = (await api("PUT", `/api/patients/${fullPatient.id}/evaluation`, { photos: nineteen })).data.evaluation;
  const twentieth = await upload(token, fullPatient.id, small);
  const twentyFirst = await upload(token, fullPatient.id, small);
  check("upload: a foto 20 entra (sortOrder 19) e a 21 devolve 409 sem gravar", twentieth.status === 201 && twentieth.data.photo.sortOrder === 19 && twentyFirst.status === 409 && (await prisma.evaluationPhoto.count({ where: { evaluationId: draft19.id } })) === 20, `${twentieth.status}/${twentyFirst.status}`);

  // --- Concorrência: paciente novo (sem jornada), 5 envios simultâneos ---
  const racePatient = (await api("POST", "/api/patients", { name: `Foto Corrida ${run}`, phone: "11999990104", age: 29 })).data.patient;
  const race = await Promise.all(Array.from({ length: 5 }, (_, index) => upload(token, racePatient.id, small, { name: `r${index}` })));
  const raceEvals = await prisma.evaluation.findMany({ where: { patientId: racePatient.id }, select: { id: true, photos: { select: { sortOrder: true } } } });
  const orders = raceEvals.flatMap((evaluation) => evaluation.photos.map((photo) => photo.sortOrder)).sort();
  check("concorrência: 5 envios simultâneos = 5x 201, 1 avaliação, 1 jornada, sortOrder 0..4 distintos, 1 created=true", race.every((x) => x.status === 201) && raceEvals.length === 1 && orders.join(",") === "0,1,2,3,4" && race.filter((x) => x.data.evaluation.created).length === 1 && (await prisma.patientJourney.count({ where: { patientId: racePatient.id } })) === 1, `${race.map((x) => x.status).join("/")} aval=${raceEvals.length} ordens=${orders.join(",")}`);

  // --- Outras clínicas, papéis e limites de login ---
  const otherEmail = `e2e-fotos-outra-${run}@example.com`;
  const otherPassword = `E2e-${run}-Outra9!`;
  const otherClinic = `E2E Fotos Externa ${run}`;
  const staffEmail = `e2e-fotos-staff-${run}@example.com`;
  const staffPassword = `E2e-${run}-Staff9!`;
  const proEmail = `e2e-fotos-pro-${run}@example.com`;
  const proPassword = `E2e-${run}-Pro9!`;
  let staffTeam = null;
  let proTeam = null;
  try {
    r = await withSession("", () => api("POST", "/api/auth/register", { clinicName: otherClinic, name: "E2E Externo", phone: "11999990120", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: otherEmail, password: otherPassword }));
    const otherToken = r.status === 201 ? (await mobileLogin(otherEmail, otherPassword)).data?.token : null;
    if (otherToken) {
      const before = await prisma.evaluationPhoto.count({ where: { evaluation: { patientId: patient.id } } });
      const crossPatient = await upload(otherToken, patient.id, small);
      const crossEval = await upload(otherToken, patient.id, small, { evaluationId: evId });
      const crossImage = await call(otherToken, "GET", `${imageUrl}?size=thumb`);
      check("isolamento: outra clínica recebe 404 no upload (paciente e avaliação) e na imagem, e nada é gravado", crossPatient.status === 404 && crossEval.status === 404 && crossImage.status === 404 && (await prisma.evaluationPhoto.count({ where: { evaluation: { patientId: patient.id } } })) === before, `${crossPatient.status}/${crossEval.status}/${crossImage.status}`);
    } else check("segunda clínica criada para testar o app", false, `registro ${r.status}`);

    r = await api("POST", "/api/team", { name: "E2E Atendente App", email: staffEmail, password: staffPassword, role: "STAFF" });
    staffTeam = r.status === 201 ? r.data.member : null;
    r = await api("POST", "/api/team", { name: "E2E Profissional App", email: proEmail, password: proPassword, role: "PROFESSIONAL" });
    proTeam = r.status === 201 ? r.data.member : null;
    if (staffTeam && proTeam) {
      const first403 = await mobileLogin(staffEmail, staffPassword);
      check("mobile: colaborador no primeiro acesso recebe 403 passwordChangeRequired, sem token nem cookie", first403.status === 403 && first403.data.passwordChangeRequired === true && !first403.data.token && first403.setCookie.length === 0, JSON.stringify(first403.data));
      // O token de troca de senha (cookie da web no primeiro acesso) não vale como Bearer.
      const savedCookie = cookie; cookie = "";
      const changeLogin = await api("POST", "/api/auth/login", { login: proEmail, password: proPassword });
      const changeToken = cookie.split("=")[1]; cookie = savedCookie;
      check("Bearer: sessão de primeiro acesso (passwordChangeOnly) não autentica rotas", changeLogin.data.passwordChangeRequired === true && (await callJson(changeToken, "GET", "/api/auth/me")).status === 401);
      const staff = await loginAs(staffEmail, staffPassword);
      await loginAs(proEmail, proPassword);
      const staffMobile = await mobileLogin(staffEmail, `${staffPassword}-nova`);
      check("mobile: STAFF recebe 403 'O app é para a equipe clínica.' sem token", staffMobile.status === 403 && staffMobile.data.message === "O app é para a equipe clínica." && !staffMobile.data.token, JSON.stringify(staffMobile.data));
      const proMobile = await mobileLogin(proEmail, `${proPassword}-nova`);
      check("mobile: PROFESSIONAL entra e envia foto", proMobile.status === 200 && proMobile.data.user.role === "PROFESSIONAL" && (await upload(proMobile.data.token, patient.id, small)).status === 201, proMobile.status);
      const beforeStaff = await prisma.evaluationPhoto.count({ where: { evaluation: { patientId: patient.id } } });
      const staffUpload = await withSession(staff.cookie, async () => (await fetch(`${baseUrl}${url}`, { method: "POST", headers: { cookie }, body: makeForm(small) })).status);
      check("upload: STAFF (sessão web) recebe 403 e nada é gravado", staffUpload === 403 && (await prisma.evaluationPhoto.count({ where: { evaluation: { patientId: patient.id } } })) === beforeStaff, staffUpload);
      const wrong = [];
      for (let attempt = 0; attempt < 10; attempt += 1) wrong.push((await mobileLogin(staffEmail, "errada")).status);
      const locked = await mobileLogin(staffEmail, `${staffPassword}-nova`);
      check("mobile: 10 falhas devolvem 401 e a 11ª (mesmo com a senha certa) 429", wrong.every((status) => status === 401) && locked.status === 429 && !locked.data.token, `${wrong.join(",")} → ${locked.status}`);
    } else check("usuários STAFF/PROFESSIONAL criados para testar o app", false, `team ${r.status}`);
  } finally {
    for (const member of [staffTeam, proTeam]) if (member) await api("DELETE", "/api/team", { membershipId: member.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [otherEmail, staffEmail, proEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: otherClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [otherEmail, staffEmail, proEmail] } } });
  }
}

// App mobile, lacunas: login (bordas, bloqueio, papéis), Bearer x cookie, validações do envio, concorrência, escolha da avaliação, trial, miniaturas.
async function mobilePhotosGaps() {
  const sharp = (await import("sharp")).default;
  const { SignJWT } = await import("jose");
  const { hash } = await import("bcryptjs");
  const jpg = (width, height, extra) => { const s = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 90 } } }); return (extra ? s.jpeg().withMetadata(extra) : s.jpeg()).toBuffer(); };
  const mobileLogin = async (loginName, secret, rawBody) => {
    const response = await fetch(`${baseUrl}/api/mobile/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: rawBody ?? JSON.stringify({ login: loginName, password: secret }) });
    return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
  };
  const raw = async (headers, method, path, body) => { const response = await fetch(`${baseUrl}${path}`, { method, headers, body, redirect: "manual" }); const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 120); } return { status: response.status, data, headers: response.headers }; };
  const bearer = (token) => ({ Authorization: `Bearer ${token}` });
  const makeForm = (buffer, fields = {}, { type = "image/jpeg", filename = "foto.jpg", fileField = "file" } = {}) => {
    const form = new FormData();
    form.set(fileField, new Blob([buffer], { type }), filename);
    for (const [key, value] of Object.entries({ width: "400", height: "300", ...fields })) if (value !== undefined) form.set(key, String(value));
    return form;
  };
  const up = (token, patientId, buffer, fields, options) => raw(bearer(token), "POST", `/api/patients/${patientId}/evaluation/photos`, makeForm(buffer, fields, options));
  const newPatient = async (label, n) => (await api("POST", "/api/patients", { name: `${label} ${run}`, phone: `1199999${String(n).padStart(4, "0")}`, age: 30 })).data.patient;
  const imgUrl = (patientId, photoId, query = "") => `/api/patients/${patientId}/photos/${encodeURIComponent(`evaluation:${photoId}`)}/image${query}`;
  const small = await jpg(400, 300);
  const ownerToken = (await mobileLogin(email, password)).data.token;
  const adminId = (await api("GET", "/api/auth/me")).data.user.id;
  const clinicId = (await prisma.clinicMembership.findFirst({ where: { userId: adminId }, select: { clinicId: true } })).clinicId;

  const proEmail = `e2e-gap-pro-${run}@example.com`, proPass = `E2e-${run}-GapPro9!`;
  const staffEmail = `e2e-gap-staff-${run}@example.com`, staffPass = `E2e-${run}-GapStaff9!`;
  const noClinicEmail = `e2e-gap-semclinica-${run}@example.com`;
  const trialEmail = `e2e-gap-trial-${run}@example.com`, trialPass = `E2e-${run}-Trial9!`, trialClinic = `E2E Gap Trial ${run}`;
  let proTeam = null, staffTeam = null;
  try {
    // ===== Login do app =====
    let r = await mobileLogin("", "", "isto não é json");
    const rArr = await mobileLogin("", "", "[]");
    const rNum = await mobileLogin("", "", JSON.stringify({ login: 123, password: 456 }));
    const rNoPass = await mobileLogin("", "", JSON.stringify({ login: email }));
    const rNoUser = await mobileLogin("", "", JSON.stringify({ password: "x" }));
    check("login mobile: corpo não-JSON, array, tipos errados e campo faltando devolvem 400", [r, rArr, rNum, rNoPass, rNoUser].every((x) => x.status === 400 && !x.data.token), [r, rArr, rNum, rNoPass, rNoUser].map((x) => x.status).join("/"));
    r = await mobileLogin(`  ${email.toUpperCase()}  `, password);
    check("login mobile: e-mail com MAIÚSCULAS e espaços nas pontas entra e devolve o e-mail normalizado", r.status === 200 && r.data.user.email === email, r.status);
    check("login mobile: senha com espaço nas pontas NÃO é aparada (401)", (await mobileLogin(email, ` ${password} `)).status === 401);
    const unknown = await mobileLogin(`nao-existe-${run}@example.com`, "qualquer");
    const wrongKnown = await mobileLogin(email, "senha-errada-x");
    check("login mobile: usuário inexistente e senha errada têm a mesma resposta (401, mesma mensagem, no-store)", unknown.status === 401 && wrongKnown.status === 401 && unknown.data.message === wrongKnown.data.message && /no-store/.test(unknown.headers.get("cache-control") ?? ""), `${unknown.status}/${wrongKnown.status}`);
    check("login mobile: sucesso traz Cache-Control no-store; GET na rota devolve 405", /no-store/.test(r.headers.get("cache-control") ?? "") && (await raw({}, "GET", "/api/mobile/auth/login")).status === 405);
    r = await api("POST", "/api/team", { name: "E2E Gap Pro", email: proEmail, password: proPass, role: "PROFESSIONAL" }); proTeam = r.status === 201 ? r.data.member : null;
    r = await api("POST", "/api/team", { name: "E2E Gap Staff", email: staffEmail, password: staffPass, role: "STAFF" }); staffTeam = r.status === 201 ? r.data.member : null;
    if (!proTeam || !staffTeam) { check("equipe de teste criada", false, r.status); return; }
    const firstPro = await mobileLogin(proEmail, proPass);
    const firstProWrong = await mobileLogin(proEmail, "errada");
    check("login mobile: PROFESSIONAL no primeiro acesso, senha certa = 403 passwordChangeRequired sem token; senha errada = 401", firstPro.status === 403 && firstPro.data.passwordChangeRequired === true && !firstPro.data.token && firstProWrong.status === 401, `${firstPro.status}/${firstProWrong.status}`);
    await loginAs(proEmail, proPass); await loginAs(staffEmail, staffPass);
    const proNew = `${proPass}-nova`, staffNew = `${staffPass}-nova`;
    const staffWrong = await mobileLogin(staffEmail, "errada");
    const staffRight = await mobileLogin(staffEmail, staffNew);
    check("login mobile: STAFF com senha errada = 401 igual a qualquer usuário (não revela o papel); só com senha certa = 403", staffWrong.status === 401 && staffWrong.data.message === unknown.data.message && staffRight.status === 403 && !staffRight.data.token, `${staffWrong.status}/${staffRight.status}`);
    await prisma.user.create({ data: { name: "Sem Clínica", email: noClinicEmail, passwordHash: await hash("SemClinica#1", 10), role: "ADMIN", emailVerifiedAt: new Date() } });
    const nc = await mobileLogin(noClinicEmail, "SemClinica#1");
    check("login mobile: usuário sem clínica = 403 sem token; senha errada dele = 401", nc.status === 403 && !nc.data.token && (await mobileLogin(noClinicEmail, "x")).status === 401, nc.status);

    // ===== Bearer x cookie =====
    const proToken = (await mobileLogin(proEmail, proNew)).data.token;
    const authSecret = process.env.AUTH_SECRET ?? "";
    const nowS = Math.floor(Date.now() / 1000);
    const forge = (secret, payload, exp) => new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt(nowS - 7200).setExpirationTime(exp).sign(new TextEncoder().encode(secret));
    const expired = authSecret.length >= 32 ? await forge(authSecret, { userId: adminId }, nowS - 3600) : null;
    const otherSecret = await forge("outro-segredo-qualquer-com-mais-de-32-bytes!!", { userId: adminId }, nowS + 3600);
    const noUserId = authSecret.length >= 32 ? await forge(authSecret, { foo: 1 }, nowS + 3600) : null;
    const ghostUser = authSecret.length >= 32 ? await forge(authSecret, { userId: "usuario-inexistente" }, nowS + 3600) : null;
    const noneAlg = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ userId: adminId })).toString("base64url")}.`;
    const meWith = (headers) => raw(headers, "GET", "/api/auth/me");
    const rejected = [];
    for (const [label, token] of [["expirado", expired], ["outro segredo", otherSecret], ["sem userId", noUserId], ["userId inexistente", ghostUser], ["alg none", noneAlg], ["token de 5000 chars", "a".repeat(5000)]]) if (token) rejected.push([label, (await meWith(bearer(token))).status]);
    check(`Bearer: tokens ruins devolvem 401 (${authSecret.length >= 32 ? "AUTH_SECRET disponível" : "SEM AUTH_SECRET no ambiente do teste: expirado não testado"})`, rejected.length >= 3 && rejected.every(([, status]) => status === 401), JSON.stringify(rejected));
    const hdr = [["bearer minúsculo", { Authorization: `bearer ${ownerToken}` }, 200], ["BEARER maiúsculo", { Authorization: `BEARER ${ownerToken}` }, 200], ["Bearer vazio", { Authorization: "Bearer " }, 401], ["só Bearer", { Authorization: "Bearer" }, 401], ["header vazio", { Authorization: "" }, 401], ["esquema Basic", { Authorization: `Basic ${ownerToken}` }, 401], ["dois espaços", { Authorization: `Bearer  ${ownerToken}` }, 401], ["token + lixo", { Authorization: `Bearer ${ownerToken} x` }, 401], ["sem esquema", { Authorization: ownerToken }, 401]];
    const hdrOut = [];
    for (const [label, headers, want] of hdr) hdrOut.push([label, (await meWith(headers)).status, want]);
    check("Bearer: esquema não diferencia caixa; vazio, sem esquema, Basic e formatos estranhos = 401", hdrOut.every(([, got, want]) => got === want), JSON.stringify(hdrOut.filter(([, got, want]) => got !== want)));
    const both = await meWith({ ...bearer(ownerToken), cookie });
    const conflict = await meWith({ ...bearer(proToken), cookie });
    const staleCookie = await meWith({ ...bearer(ownerToken), cookie: "harmonize_session=lixo" });
    check("Bearer x cookie: ambos do mesmo usuário = 200; em conflito o COOKIE vence (admin, não o profissional)", both.status === 200 && conflict.status === 200 && conflict.data.user.id === adminId, `${both.status}/${conflict.status} ${conflict.data.user?.email}`);
    const expiredCookie = expired ? await meWith({ ...bearer(ownerToken), cookie: `harmonize_session=${expired}` }) : { status: 200 };
    const badBoth = await meWith({ ...bearer("lixo"), cookie: "harmonize_session=lixo" });
    check("Bearer x cookie: cookie inválido ou expirado cai para o Bearer válido (200); os dois inválidos = 401", staleCookie.status === 200 && expiredCookie.status === 200 && badBoth.status === 401, `${staleCookie.status}/${expiredCookie.status}/${badBoth.status}`);
    const gapPatient = await newPatient("Gap Bearer", 1);
    const pid = gapPatient.id;
    const one = await up(ownerToken, pid, small, { category: "Frontal" });
    const eId = one.data.evaluation.id;
    const routes = [["GET", "/api/auth/me"], ["GET", "/api/patients/lookup?q=Gap%20Bearer"], ["GET", "/api/patients"], ["GET", `/api/patients/${pid}`], ["GET", `/api/patients/${pid}/photos`], ["GET", `/api/patients/${pid}/evaluation`], ["GET", `/api/patients/${pid}/evaluation?evaluationId=${eId}`], ["GET", imgUrl(pid, one.data.photo.id)]];
    const withB = [], without = [];
    for (const [m, p] of routes) { withB.push((await raw(bearer(ownerToken), m, p)).status); without.push((await raw({}, m, p)).status); }
    check("Bearer: me, lookup, lista de pacientes, paciente, photos, evaluation (lista e id) e image = 200; sem credencial = 401", withB.every((s) => s === 200) && without.every((s) => s === 401), `${withB.join(",")} | ${without.join(",")}`);
    check("Bearer: token de PROFESSIONAL lê as fotos da clínica (200)", (await raw(bearer(proToken), "GET", `/api/patients/${pid}/photos`)).status === 200);
    const staffCookie = (await loginAs(staffEmail, staffNew)).cookie;
    const staffReads = await withSession(staffCookie, async () => [(await api("GET", `/api/patients/${pid}/photos`)).status, (await api("GET", `/api/patients/${pid}/evaluation`)).status]);
    check("STAFF (cookie) segue sem ver fotos/avaliação (403) mesmo com fotos do app", staffReads.every((s) => s === 403), staffReads.join(","));

    // ===== Envio: formatos, tamanhos, tipos =====
    const pTypes = await newPatient("Gap Tipos", 2);
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const webp = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 200 } } }).webp().toBuffer();
    const ok3 = [await up(ownerToken, pTypes.id, small, { category: "Sorriso" }), await up(ownerToken, pTypes.id, png, { width: 64, height: 64 }, { type: "image/png", filename: "a.png" }), await up(ownerToken, pTypes.id, webp, { width: 64, height: 64 }, { type: "image/webp", filename: "a.webp" })];
    const prefixes = (await prisma.evaluationPhoto.findMany({ where: { id: { in: ok3.map((x) => x.data.photo?.id).filter(Boolean) } }, orderBy: { sortOrder: "asc" }, select: { imageUrl: true } })).map((x) => x.imageUrl.slice(0, 22));
    check("upload: JPEG, PNG e WebP válidos = 201 e a data URL guarda o MIME real", ok3.every((x) => x.status === 201) && prefixes[0]?.startsWith("data:image/jpeg;") && prefixes[1]?.startsWith("data:image/png;") && prefixes[2]?.startsWith("data:image/webp;"), `${ok3.map((x) => x.status)} ${prefixes.join("|")}`);
    const noType = await up(ownerToken, pTypes.id, small, {}, { type: "", filename: "sem-tipo" });
    const octet = await up(ownerToken, pTypes.id, small, {}, { type: "application/octet-stream", filename: "x.bin" });
    check("upload: MIME declarado vazio ou application/octet-stream é aceito se o CONTEÚDO é imagem (201)", noType.status === 201 && octet.status === 201, `${noType.status}/${octet.status}`);
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = Buffer.from("<!doctype html><script>alert(1)</script>");
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]);
    const bad415 = [["PDF .jpg/image/jpeg", pdf, "image/jpeg", "a.jpg"], ["PDF application/pdf", pdf, "application/pdf", "a.pdf"], ["SVG .jpg", svg, "image/jpeg", "a.jpg"], ["SVG image/svg+xml", svg, "image/svg+xml", "a.svg"], ["HTML .jpg", html, "image/jpeg", "a.jpg"], ["GIF", gif, "image/gif", "a.gif"], ["PNG dizendo webp", png, "image/webp", "a.webp"]];
    const out415 = [];
    for (const [label, buf, type, filename] of bad415) out415.push([label, (await up(ownerToken, pTypes.id, buf, {}, { type, filename })).status]);
    check("upload: PDF, SVG, HTML, GIF e MIME divergente = 415", out415.every(([, s]) => s === 415), JSON.stringify(out415));
    const empty = await up(ownerToken, pTypes.id, Buffer.alloc(0));
    check("upload: arquivo vazio = 400", empty.status === 400, `${empty.status} ${empty.data.message}`);
    const countTypes = await prisma.evaluationPhoto.count({ where: { evaluation: { patientId: pTypes.id } } });
    check("upload: recusas não gravaram nada (só as 5 fotos válidas)", countTypes === 5, countTypes);
    const exact = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4 * 1024 * 1024 - 3)]);
    const over = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4 * 1024 * 1024 - 2)]);
    const pBig = await newPatient("Gap 4MB", 3);
    const rExact = await up(ownerToken, pBig.id, exact);
    const rOver = await up(ownerToken, pBig.id, over);
    check("upload: exatamente 4 MB = 201 e 4 MB + 1 byte = 413", rExact.status === 201 && rOver.status === 413 && (await prisma.evaluationPhoto.count({ where: { evaluation: { patientId: pBig.id } } })) === 1, `${rExact.status}/${rOver.status}`);
    const garbageThumb = await fetch(`${baseUrl}${imgUrl(pBig.id, rExact.data.photo?.id, "?size=thumb")}`, { headers: bearer(ownerToken) });
    const garbageBytes = Buffer.from(await garbageThumb.arrayBuffer());
    check("miniatura: imagem corrompida (4 MB de zeros com cabeçalho JPEG) não dá 500; devolve o original", garbageThumb.status === 200 && garbageBytes.length === exact.length, `${garbageThumb.status} ${garbageBytes.length} ${garbageThumb.headers.get("content-type")}`);
    const pBroken = await newPatient("Gap Quebrada", 4);
    const brokenEval = await prisma.evaluation.create({ data: { patientId: pBroken.id, clinicId, professional: "x", status: "Rascunho" } });
    const brokenPhotos = [];
    for (const [label, url] of [["base64 lixo", "data:image/jpeg;base64,AAAA"], ["sem vírgula", "data:image/jpeg;base64"], ["texto", "nao-e-data-url"], ["vazia", ""]]) brokenPhotos.push([label, await prisma.evaluationPhoto.create({ data: { evaluationId: brokenEval.id, name: label, imageUrl: url, width: 10, height: 10, category: "Outra", sortOrder: brokenPhotos.length, annotations: "[]" } })]);
    const brokenOut = [];
    for (const [label, row] of brokenPhotos) brokenOut.push([label, (await raw(bearer(ownerToken), "GET", imgUrl(pBroken.id, row.id, "?size=thumb"))).status]);
    check("miniatura: foto corrompida no banco nunca devolve 5xx", brokenOut.every(([, s]) => s < 500), JSON.stringify(brokenOut));

    // ===== Envio: campos =====
    const pFields = await newPatient("Gap Campos", 5);
    const notMultipart = await raw({ ...bearer(ownerToken), "Content-Type": "application/json" }, "POST", `/api/patients/${pFields.id}/evaluation/photos`, JSON.stringify({ width: 10, height: 10 }));
    const chunked = await fetch(`${baseUrl}/api/patients/${pFields.id}/evaluation/photos`, { method: "POST", headers: bearer(ownerToken), body: new Response(makeForm(small)).body, duplex: "half" }).catch(() => ({ status: "erro" }));
    check("upload: corpo JSON = 400; multipart sem Content-Length (chunked) = 413", notMultipart.status === 400 && (chunked.status === 413 || chunked.status === "erro"), `${notMultipart.status}/${chunked.status}`);
    const wrongField = await up(ownerToken, pFields.id, small, {}, { fileField: "photo" });
    const stringFile = new FormData(); stringFile.set("file", "texto"); stringFile.set("width", "10"); stringFile.set("height", "10");
    const noHeight = await up(ownerToken, pFields.id, small, { height: undefined });
    const noBoth = await up(ownerToken, pFields.id, small, { width: undefined, height: undefined });
    check("upload: campo do arquivo com outro nome, arquivo como texto, sem height, sem width/height = 400", wrongField.status === 400 && (await raw(bearer(ownerToken), "POST", `/api/patients/${pFields.id}/evaluation/photos`, stringFile)).status === 400 && noHeight.status === 400 && noBoth.status === 400, `${wrongField.status}/${noHeight.status}/${noBoth.status}`);
    const dimBad = [["width 0", { width: "0" }], ["width -5", { width: "-5" }], ["height -1", { height: "-1" }], ["width 9000", { width: "9000" }], ["8001", { width: "8001" }], ["8000x8000", { width: "8000", height: "8000" }], ["5000x5001", { width: "5000", height: "5001" }], ["1e3", { width: "1e3" }], ["0x10", { width: "0x10" }], ["texto", { width: "abc" }], ["vazio", { width: "" }], ["123456", { width: "123456" }], ["+400", { width: "+400" }], ["400.0", { width: "400.0" }]];
    const dimOut = [];
    for (const [label, f] of dimBad) dimOut.push([label, (await up(ownerToken, pFields.id, small, f)).status]);
    check("upload: dimensões inválidas (0, negativo, >8000, produto >25 MP, 1e3, hex, texto, vazio, 6 dígitos, +, decimal) = 400", dimOut.every(([, s]) => s === 400), JSON.stringify(dimOut.filter(([, s]) => s !== 400)));
    const big25 = await jpg(5000, 5000), wide = await jpg(8000, 3125), onePx = await jpg(1, 1);
    const dimOk = [await up(ownerToken, pFields.id, big25, { width: "5000", height: "5000" }), await up(ownerToken, pFields.id, wide, { width: "8000", height: "3125" }), await up(ownerToken, pFields.id, small, { width: " 400 ", height: "00300" }), await up(ownerToken, pFields.id, onePx, { width: "1", height: "1" })];
    check("upload: bordas válidas com imagem real (5000x5000 = 25 MP, 8000x3125, espaços/zeros à esquerda, 1x1) = 201", dimOk.every((x) => x.status === 201), dimOk.map((x) => x.status).join(","));
    const mismatch = await up(ownerToken, pFields.id, small, { width: "5000", height: "5000" });
    const near = await up(ownerToken, pFields.id, small, { width: "410", height: "305" });
    const swapped = await up(ownerToken, pFields.id, small, { width: "300", height: "400" });
    const far = await up(ownerToken, pFields.id, small, { width: "500", height: "300" });
    const dbDims = await prisma.evaluationPhoto.findMany({ where: { id: { in: [near.data.photo?.id, swapped.data.photo?.id].filter(Boolean) } }, select: { id: true, width: true, height: true } });
    check("upload: dimensão declarada x real — 5000x5000 p/ JPEG 400x300 = 400; 410x305 (dentro de 10%) e 300x400 (lados trocados) = 201 gravando as REAIS 400x300; 500x300 = 400", mismatch.status === 400 && near.status === 201 && swapped.status === 201 && far.status === 400 && dbDims.length === 2 && dbDims.every((z) => z.width === 400 && z.height === 300) && near.data.photo.width === 400, `${mismatch.status}/${near.status}/${swapped.status}/${far.status} ${JSON.stringify(dbDims)}`);
    const huge = await up(ownerToken, pFields.id, await jpg(9000, 100), { width: "9000", height: "100" });
    const hugeLie = await up(ownerToken, pFields.id, await jpg(9000, 100), { width: "400", height: "300" });
    check("upload: imagem real com lado > 8000 = 400, declarando certo ou mentindo", huge.status === 400 && hugeLie.status === 400, `${huge.status}/${hugeLie.status}`);
    const catOut = [];
    for (const [label, f, want] of [["sem category", {}, "Outra"], ["category vazia", { category: "" }, "Outra"], ["category com espaços", { category: " Frontal " }, "Frontal"], ["Perfil esquerdo", { category: "Perfil esquerdo" }, "Perfil esquerdo"]]) { const x = await up(ownerToken, pFields.id, small, f); catOut.push([label, x.status, x.data.photo?.category === want]); }
    const catBad = [await up(ownerToken, pFields.id, small, { category: "frontal" }), await up(ownerToken, pFields.id, small, { category: "Costas" }), await up(ownerToken, pFields.id, small, { category: "Frontal; DROP" })];
    check("upload: category ausente/vazia assume \"Outra\" (201), espaços são aparados, valor desconhecido ou de outra caixa = 400", catOut.every(([, s, ok]) => s === 201 && ok) && catBad.every((x) => x.status === 400), JSON.stringify(catOut) + catBad.map((x) => x.status));
    const longName = await up(ownerToken, pFields.id, small, { name: "A".repeat(1000) });
    const pathName = await up(ownerToken, pFields.id, small, { name: "../../etc/passwd.jpg" });
    const xssName = await up(ownerToken, pFields.id, small, { name: "<img src=x onerror=alert(1)>.png" });
    const fallbackName = await up(ownerToken, pFields.id, small, {}, { filename: "Minha Foto 1.JPG" });
    check("upload: name longo é cortado em 160, caminho vira só o arquivo, <>:\"|?* são removidos, sem name usa o nome do arquivo sem extensão", longName.status === 201 && longName.data.photo.name.length === 160 && pathName.data.photo?.name === "passwd" && !/[<>]/.test(xssName.data.photo?.name ?? "<") && fallbackName.data.photo?.name === "Minha Foto 1", `${longName.data.photo?.name.length} ${pathName.data.photo?.name} ${xssName.data.photo?.name} ${fallbackName.data.photo?.name}`);
    const evalsFields = await prisma.evaluation.count({ where: { patientId: pFields.id } });
    const orders = (await prisma.evaluationPhoto.findMany({ where: { evaluation: { patientId: pFields.id } }, select: { sortOrder: true } })).map((z) => z.sortOrder).sort((a, b) => a - b);
    check("upload: toda a sequência acima ficou em 1 avaliação com sortOrder contíguo 0..n-1", evalsFields === 1 && orders.every((value, index) => value === index), `${evalsFields} ${orders.join(",")}`);

    // ===== Envio: avaliação alvo =====
    const pT = await newPatient("Gap Alvo", 6);
    const pOther = await newPatient("Gap Alvo Outro", 7);
    const otherEval = (await up(ownerToken, pOther.id, small)).data.evaluation;
    const crossPatient = await up(ownerToken, pT.id, small, { evaluationId: otherEval.id });
    check("upload: evaluationId de OUTRO paciente da mesma clínica = 404 e nada gravado", crossPatient.status === 404 && (await prisma.evaluationPhoto.count({ where: { evaluation: { patientId: pT.id } } })) === 0, crossPatient.status);
    const otherJourney = await prisma.patientJourney.findFirst({ where: { patientId: pOther.id } });
    const jOther = await up(ownerToken, pT.id, small, { journeyId: otherJourney.id });
    check("upload: journeyId de outro paciente = 404 e nenhuma avaliação criada", jOther.status === 404 && (await prisma.evaluation.count({ where: { patientId: pT.id } })) === 0, `${jOther.status} jornadas=${await prisma.patientJourney.count({ where: { patientId: pT.id } })}`);
    const d1 = (await api("PUT", `/api/patients/${pT.id}/evaluation`, { photos: [] })).data.evaluation;
    const d2 = (await api("PUT", `/api/patients/${pT.id}/evaluation`, { photos: [] })).data.evaluation;
    let x = await up(ownerToken, pT.id, small);
    check("upload: sem evaluationId e com 2 rascunhos, usa o MAIS RECENTE (updatedAt)", x.status === 201 && x.data.evaluation.id === d2.id, `${x.data.evaluation?.id === d2.id ? "d2" : x.data.evaluation?.id === d1.id ? "d1" : "?"}`);
    x = await up(ownerToken, pT.id, small, { evaluationId: d1.id });
    check("upload: evaluationId do rascunho ANTIGO é respeitado (foto vai para ele)", x.status === 201 && x.data.evaluation.id === d1.id && x.data.evaluation.photoCount === 1, JSON.stringify(x.data.evaluation));
    x = await up(ownerToken, pT.id, small);
    console.log(`NOTA: depois de enviar para o rascunho antigo ele vira o "mais recente" (updatedAt tocado): o envio seguinte sem evaluationId foi para ${x.data.evaluation.id === d1.id ? "d1 (o antigo)" : "d2"}.`);
    const pC = await newPatient("Gap Concluida", 8);
    const draftOld = (await api("PUT", `/api/patients/${pC.id}/evaluation`, { photos: [] })).data.evaluation;
    const doneNew = (await api("PUT", `/api/patients/${pC.id}/evaluation`, { photos: [], assessment: fullAssessment, status: "Concluída" })).data.evaluation;
    x = await up(ownerToken, pC.id, small);
    check("upload: última avaliação Concluída + rascunho mais antigo => usa o rascunho, nunca a concluída", x.status === 201 && x.data.evaluation.id === draftOld.id && (await prisma.evaluationPhoto.count({ where: { evaluationId: doneNew.id } })) === 0, JSON.stringify(x.data.evaluation));
    const pD = await newPatient("Gap SoConcluida", 9);
    await api("PUT", `/api/patients/${pD.id}/evaluation`, { photos: [], assessment: fullAssessment, status: "Concluída" });
    const journeysBefore = await prisma.patientJourney.count({ where: { patientId: pD.id } });
    x = await up(ownerToken, pD.id, small);
    const journeysAfter = await prisma.patientJourney.count({ where: { patientId: pD.id } });
    const newEval = await prisma.evaluation.findUnique({ where: { id: x.data.evaluation.id }, select: { journeyId: true } });
    const oldEval = await prisma.evaluation.findFirst({ where: { patientId: pD.id, status: "Concluída" }, select: { journeyId: true } });
    check("upload: só há concluída => cria rascunho NOVO na MESMA jornada, sem jornada duplicada", x.status === 201 && x.data.evaluation.created && journeysBefore === 1 && journeysAfter === 1 && newEval.journeyId === oldEval.journeyId, `jornadas ${journeysBefore}->${journeysAfter}`);
    const pJ = await newPatient("Gap Jornadas", 10);
    const profId = (await api("GET", "/api/team/professionals")).data.professionals?.[0]?.id;
    const j1 = (await api("POST", `/api/patients/${pJ.id}/journeys`, { name: `J1 ${run}`, professionalId: profId })).data.journey;
    const j2 = (await api("POST", `/api/patients/${pJ.id}/journeys`, { name: `J2 ${run}`, professionalId: profId })).data.journey;
    const inJ2 = await up(ownerToken, pJ.id, small, { journeyId: j2.id });
    const noJ = await up(ownerToken, pJ.id, small);
    const evJ = async (id) => (await prisma.evaluation.findUnique({ where: { id }, select: { journeyId: true } })).journeyId;
    check("upload: journeyId escolhe a jornada; sem journeyId vai para a ativa mais antiga; jornadas não duplicam", inJ2.status === 201 && (await evJ(inJ2.data.evaluation.id)) === j2.id && noJ.status === 201 && (await evJ(noJ.data.evaluation.id)) === j1.id && noJ.data.evaluation.id !== inJ2.data.evaluation.id && (await prisma.patientJourney.count({ where: { patientId: pJ.id } })) === 2, `${inJ2.status}/${noJ.status}`);
    const mism = await up(ownerToken, pJ.id, small, { evaluationId: inJ2.data.evaluation.id, journeyId: j1.id });
    check("upload: evaluationId + journeyId de outra jornada = 400", mism.status === 400, mism.status);
    await prisma.patientJourney.update({ where: { id: j2.id }, data: { archivedAt: new Date() } });
    check("upload: journeyId de jornada arquivada = 404", (await up(ownerToken, pJ.id, small, { journeyId: j2.id })).status === 404);

    // ===== Limite de 20 e remoção =====
    const p20 = await newPatient("Gap Vinte", 11);
    const tiny = `data:image/jpeg;base64,${small.toString("base64")}`;
    const mk = (n) => Array.from({ length: n }, (_, index) => ({ name: `f${index}`, imageUrl: tiny, width: 400, height: 300, category: "Outra", sortOrder: index }));
    const ev20 = (await api("PUT", `/api/patients/${p20.id}/evaluation`, { photos: mk(19) })).data.evaluation;
    const race20 = await Promise.all(Array.from({ length: 4 }, () => up(ownerToken, p20.id, small)));
    const st20 = race20.map((y) => y.status).sort();
    const rows20 = await prisma.evaluationPhoto.findMany({ where: { evaluationId: ev20.id }, select: { id: true, sortOrder: true }, orderBy: { sortOrder: "asc" } });
    check("limite: 4 envios simultâneos com 19 fotos => exatamente 1x 201 e 3x 409; total 20, sortOrder único", st20.join(",") === "201,409,409,409" && rows20.length === 20 && new Set(rows20.map((z) => z.sortOrder)).size === 20, `${st20} total=${rows20.length}`);
    const current = (await api("GET", `/api/patients/${p20.id}/evaluation?evaluationId=${ev20.id}`)).data.evaluation;
    const keep = current.photos.filter((photo) => photo.id !== rows20[5].id).map((photo) => ({ id: photo.id, name: photo.name, imageUrl: photo.imageUrl, width: photo.width, height: photo.height, category: photo.category, sortOrder: photo.sortOrder, annotations: photo.annotations }));
    const put19 = await api("PUT", `/api/patients/${p20.id}/evaluation`, { evaluationId: ev20.id, photos: keep });
    const again = await up(ownerToken, p20.id, small);
    const again2 = await up(ownerToken, p20.id, small);
    check("limite: remover 1 (PUT 19) volta a aceitar 1 envio (sortOrder = máximo + 1) e o seguinte é 409", put19.status === 200 && again.status === 201 && again.data.photo.sortOrder === 20 && again2.status === 409, `${put19.status}/${again.status} so=${again.data.photo?.sortOrder}/${again2.status}`);

    // ===== Concorrência =====
    const pRace = await newPatient("Gap Corrida", 12);
    const first = await up(ownerToken, pRace.id, small);
    const race10 = await Promise.all(Array.from({ length: 10 }, (_, i) => up(ownerToken, pRace.id, small, { name: `c${i}` })));
    const ord10 = (await prisma.evaluationPhoto.findMany({ where: { evaluation: { patientId: pRace.id } }, select: { sortOrder: true } })).map((z) => z.sortOrder).sort((a, b) => a - b);
    check("concorrência: 10 envios com rascunho existente = 10x 201, 1 avaliação, sortOrder 0..10 únicos, nenhum created", race10.every((y) => y.status === 201 && !y.data.evaluation.created) && (await prisma.evaluation.count({ where: { patientId: pRace.id } })) === 1 && ord10.join(",") === Array.from({ length: 11 }, (_, i) => i).join(","), `${race10.map((y) => y.status)} ${ord10}`);
    const pRace2 = await newPatient("Gap Corrida2", 13);
    const race10n = await Promise.all(Array.from({ length: 10 }, (_, i) => up(ownerToken, pRace2.id, small, { name: `n${i}` })));
    const ord10n = (await prisma.evaluationPhoto.findMany({ where: { evaluation: { patientId: pRace2.id } }, select: { sortOrder: true } })).map((z) => z.sortOrder).sort((a, b) => a - b);
    check("concorrência: 10 envios SEM rascunho/jornada = 10x 201, 1 avaliação, 1 jornada, 1 created, sortOrder 0..9", race10n.every((y) => y.status === 201) && race10n.filter((y) => y.data.evaluation.created).length === 1 && (await prisma.evaluation.count({ where: { patientId: pRace2.id } })) === 1 && (await prisma.patientJourney.count({ where: { patientId: pRace2.id } })) === 1 && ord10n.join(",") === "0,1,2,3,4,5,6,7,8,9", `${race10n.map((y) => y.status)} ${ord10n}`);
    const pa = await newPatient("Gap ParA", 14), pb = await newPatient("Gap ParB", 15);
    const par = await Promise.all([...Array.from({ length: 5 }, () => up(ownerToken, pa.id, small)), ...Array.from({ length: 5 }, () => up(ownerToken, pb.id, small))]);
    const evA = await prisma.evaluation.findMany({ where: { patientId: pa.id }, select: { id: true, _count: { select: { photos: true } } } });
    const evB = await prisma.evaluation.findMany({ where: { patientId: pb.id }, select: { id: true, _count: { select: { photos: true } } } });
    check("concorrência: 2 pacientes em paralelo (5+5) = 10x 201, cada um com 1 avaliação e 5 fotos, sem mistura", par.every((y) => y.status === 201) && evA.length === 1 && evB.length === 1 && evA[0]._count.photos === 5 && evB[0]._count.photos === 5 && evA[0].id !== evB[0].id, `${par.map((y) => y.status)}`);
    const raceId = await Promise.all(Array.from({ length: 6 }, () => up(ownerToken, pRace.id, small, { evaluationId: first.data.evaluation.id })));
    check("concorrência: 6 envios com evaluationId explícito sobre 11 fotos => 6x 201 e sortOrder único (17 fotos)", raceId.every((y) => y.status === 201) && new Set((await prisma.evaluationPhoto.findMany({ where: { evaluationId: first.data.evaluation.id }, select: { sortOrder: true } })).map((z) => z.sortOrder)).size === 17);

    // ===== Leitura e auditoria =====
    const idx = await raw(bearer(ownerToken), "GET", `/api/patients/${pRace.id}/photos`);
    const entry = (idx.data.photos ?? []).find((z) => z.id === `evaluation:${first.data.photo.id}`);
    check("photos index: foto do app aparece com source \"evaluation\", sem base64", idx.status === 200 && entry?.source === "evaluation" && !JSON.stringify(idx.data).includes("base64"), `${idx.status} ${JSON.stringify(entry)?.slice(0, 160)}`);
    const upAudit = await prisma.clinicalFileAudit.findFirst({ where: { patientId: pRace.id, action: "UPLOAD", fileId: `evaluation:${first.data.photo.id}` } });
    check("auditoria UPLOAD: clínica, paciente, ator (id/nome), categoria e nome preenchidos", upAudit?.clinicId === clinicId && upAudit.actorId === adminId && upAudit.actorName === accountName && upAudit.fileKind === "PHOTO" && upAudit.category === "Outra" && upAudit.fileName.length > 0, JSON.stringify(upAudit));
    const proId = (await prisma.user.findUnique({ where: { email: proEmail }, select: { id: true } })).id;
    const v1 = await fetch(`${baseUrl}${imgUrl(pRace.id, first.data.photo.id, "?size=thumb")}`, { headers: bearer(proToken) });
    await v1.arrayBuffer();
    const viewAudit = await prisma.clinicalFileAudit.findFirst({ where: { patientId: pRace.id, action: "VIEW", fileId: `evaluation:${first.data.photo.id}` } });
    check("auditoria VIEW pela miniatura com Bearer: ator = quem usou o token (PROFESSIONAL)", v1.status === 200 && viewAudit?.actorId === proId && viewAudit.clinicId === clinicId, JSON.stringify(viewAudit));
    const dl = await fetch(`${baseUrl}${imgUrl(pRace.id, first.data.photo.id, "?size=thumb&download=1")}`, { headers: bearer(ownerToken) });
    const dlBytes = Buffer.from(await dl.arrayBuffer());
    const dlAudit = await prisma.clinicalFileAudit.count({ where: { patientId: pRace.id, action: "DOWNLOAD", fileId: `evaluation:${first.data.photo.id}` } });
    check("miniatura: size=thumb&download=1 baixa o ORIGINAL (attachment) e audita DOWNLOAD", dl.status === 200 && dlBytes.equals(small) && /attachment/.test(dl.headers.get("content-disposition") ?? "") && dlAudit === 1, `${dl.status} ${dlBytes.length} ${dlAudit}`);

    // ===== Miniaturas =====
    const pTh = await newPatient("Gap Thumb", 16);
    const thumbOf = async (buffer, type, filename, w = 400, h = 300) => {
      const created = await up(ownerToken, pTh.id, buffer, { width: w, height: h }, { type, filename });
      const response = await fetch(`${baseUrl}${imgUrl(pTh.id, created.data.photo.id, "?size=thumb")}`, { headers: bearer(ownerToken) });
      const bytes = Buffer.from(await response.arrayBuffer());
      return { response, bytes, meta: await sharp(bytes).metadata().catch(() => ({})), id: created.data.photo.id };
    };
    const rgba = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer(), left: 300, top: 200 }]).png().toBuffer();
    const t1 = await thumbOf(rgba, "image/png", "t.png", 800, 600);
    const corner = await sharp(t1.bytes).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer();
    check("miniatura: PNG 800x600 com transparência => JPEG 480x360", t1.response.status === 200 && t1.meta.format === "jpeg" && t1.meta.width === 480 && t1.meta.height === 360, `${t1.meta.format} ${t1.meta.width}x${t1.meta.height}`);
    console.log(`NOTA: miniatura de PNG transparente é JPEG (sem alfa); pixel do canto (era transparente) = rgb(${[...corner].join(",")}).`);
    const t2 = await thumbOf(await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp().toBuffer(), "image/webp", "t.webp", 1000, 500);
    const t3 = await thumbOf(await jpg(600, 1200), "image/jpeg", "t.jpg", 600, 1200);
    const t4 = await thumbOf(await jpg(480, 480), "image/jpeg", "t.jpg", 480, 480);
    const t5 = await thumbOf(await jpg(481, 100), "image/jpeg", "t.jpg", 481, 100);
    const t6 = await thumbOf(await jpg(800, 400, { orientation: 6 }), "image/jpeg", "t.jpg", 800, 400);
    const dims = (t) => `${t.meta.width}x${t.meta.height}`;
    check("miniatura: WebP 1000x500 = 480x240; retrato 600x1200 = 240x480; 480x480 fica igual; 481x100 = 480x100; EXIF orientation respeitado (800x400 rot.6 = 240x480)", t2.response.status === 200 && t2.meta.format === "jpeg" && dims(t2) === "480x240" && dims(t3) === "240x480" && dims(t4) === "480x480" && dims(t5) === "480x100" && dims(t6) === "240x480", [t2, t3, t4, t5, t6].map(dims).join(" "));
    const hd = t1.response.headers;
    check("miniatura: cabeçalhos (Content-Length = corpo, private no-store, Vary com Authorization, nosniff)", Number(hd.get("content-length")) === t1.bytes.length && hd.get("cache-control") === "private, no-store" && /Authorization/i.test(hd.get("vary") ?? "") && hd.get("x-content-type-options") === "nosniff", `${hd.get("content-length")}/${t1.bytes.length} ${hd.get("cache-control")} ${hd.get("vary")}`);
    const sizes = [];
    for (const q of ["?size=THUMB", "?size=", "?size=thumb%20", "?size=full", "?size=0"]) sizes.push([q, (await raw(bearer(ownerToken), "GET", imgUrl(pTh.id, t1.id, q))).status]);
    check("miniatura: size diferente de \"thumb\" (THUMB, vazio, espaço, full, 0) = 400", sizes.every(([, s]) => s === 400), JSON.stringify(sizes));
    const viaCookie = await fetch(`${baseUrl}${imgUrl(pTh.id, t1.id, "?size=thumb")}`, { headers: { cookie } });
    check("miniatura: cookie da web também recebe a miniatura (JPEG pequeno)", viaCookie.status === 200 && viaCookie.headers.get("content-type") === "image/jpeg" && (await viaCookie.arrayBuffer()).byteLength === t1.bytes.length);
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png({ compressionLevel: 9 }).toBuffer();
    const bombViaApi = await up(ownerToken, pTh.id, bomb, { width: "7000", height: "7000" });
    check("upload: PNG real de 49 MP (7000x7000, declarado certo) = 400 (acima de 25 MP)", bombViaApi.status === 400, bombViaApi.status);
    // Se algo acima de 40 MP chegar ao banco por outro caminho, a miniatura não pode dar 5xx.
    const bombEval = await prisma.evaluation.create({ data: { patientId: pTh.id, clinicId, professional: "x", status: "Concluída" } });
    const bombRow = await prisma.evaluationPhoto.create({ data: { evaluationId: bombEval.id, name: "bomba", imageUrl: `data:image/png;base64,${bomb.toString("base64")}`, width: 10, height: 10, category: "Outra", sortOrder: 0, annotations: "[]" } });
    const tb = await fetch(`${baseUrl}${imgUrl(pTh.id, bombRow.id, "?size=thumb")}`, { headers: bearer(ownerToken) });
    const tbBytes = Buffer.from(await tb.arrayBuffer());
    console.log(`NOTA: PNG 7000x7000 (49 MP, ${bomb.length} bytes) no banco: miniatura => ${tb.status} ${tb.headers.get("content-type")} ${tbBytes.length} bytes (${tbBytes.length === bomb.length ? "devolveu o ORIGINAL" : "reduzida"}).`);
    check("miniatura: imagem acima de 40 MP no banco não derruba (nunca 5xx)", tb.status < 500, tb.status);

    // ===== PUT do editor web com fotos do app =====
    const pE = await newPatient("Gap Editor", 17);
    const a1 = await up(ownerToken, pE.id, small, { category: "Frontal" });
    const a2 = await up(ownerToken, pE.id, small, { category: "Sorriso" });
    const ed = a1.data.evaluation.id;
    const snapshot = (await api("GET", `/api/patients/${pE.id}/evaluation?evaluationId=${ed}`)).data.evaluation;
    const asEditor = (photos) => photos.map((photo, index) => ({ id: photo.id, name: photo.name, imageUrl: photo.imageUrl, width: photo.width, height: photo.height, category: photo.category, sortOrder: index, annotations: [{ type: "arrow" }] }));
    const putSame = await api("PUT", `/api/patients/${pE.id}/evaluation`, { evaluationId: ed, photos: asEditor(snapshot.photos), assessment: { chiefComplaint: "Queixa web" } });
    const afterPut = await prisma.evaluationPhoto.findMany({ where: { evaluationId: ed }, orderBy: { sortOrder: "asc" }, select: { id: true, annotations: true } });
    check("editor web: PUT com as fotos do app (ids mantidos) = 200, fotos e ids preservados, anotações gravadas, imagem ainda servida", putSame.status === 200 && afterPut.map((z) => z.id).join() === `${a1.data.photo.id},${a2.data.photo.id}` && afterPut[0].annotations.includes("arrow") && (await raw(bearer(ownerToken), "GET", imgUrl(pE.id, a1.data.photo.id))).status === 200, `${putSame.status} ${afterPut.length}`);
    const a3 = await up(ownerToken, pE.id, small, { category: "Outra" });
    const putStale = await api("PUT", `/api/patients/${pE.id}/evaluation`, { evaluationId: ed, photos: asEditor(snapshot.photos) });
    const lost = (await prisma.evaluationPhoto.count({ where: { id: a3.data.photo.id } })) === 0;
    console.log(`NOTA (descarte conhecido): editor com GET antigo + upload do app + PUT/autosave do editor => foto do app ${lost ? "DESCARTADA" : "preservada"} (PUT ${putStale.status}).`);
    check("editor web: PUT com GET desatualizado devolve 200 (foto do app enviada depois é descartada: limitação documentada)", putStale.status === 200 && lost === true, `${putStale.status} perdida=${lost}`);
    const afterStaleUp = await up(ownerToken, pE.id, small);
    check("depois do PUT do editor o app continua enviando para a mesma avaliação (sortOrder = máximo + 1)", afterStaleUp.status === 201 && afterStaleUp.data.evaluation.id === ed && afterStaleUp.data.photo.sortOrder === 2, `${afterStaleUp.status} ${afterStaleUp.data.photo?.sortOrder}`);

    // ===== Trial vencido e outra clínica =====
    const reg = await withSession("", () => api("POST", "/api/auth/register", { clinicName: trialClinic, name: "E2E Trial", phone: "11999990130", profession: "Esteta", practiceArea: "Estética", hasSecretary: "Não", email: trialEmail, password: trialPass }));
    if (reg.status === 201) {
      const tClinic = (await prisma.clinicMembership.findFirst({ where: { user: { email: trialEmail } }, select: { clinicId: true } })).clinicId;
      const tPatient = await prisma.patient.create({ data: { clinicId: tClinic, name: `Trial Pac ${run}`, phone: "11999990131", age: 30 } });
      await prisma.clinic.update({ where: { id: tClinic }, data: { trialEndsAt: new Date(Date.now() - 86_400_000) } });
      const tLogin = await mobileLogin(trialEmail, trialPass);
      const tTok = tLogin.data?.token;
      const tUp = await up(tTok, tPatient.id, small);
      const tGet = await raw(bearer(tTok), "GET", "/api/patients");
      const tPhotos = await raw(bearer(tTok), "GET", `/api/patients/${tPatient.id}/photos`);
      check("trial vencido: login mobile entra (200), envio de foto = 401 sem gravar, leituras (pacientes, photos) = 200", tLogin.status === 200 && tUp.status === 401 && tGet.status === 200 && tPhotos.status === 200 && (await prisma.evaluation.count({ where: { patientId: tPatient.id } })) === 0, `${tLogin.status}/${tUp.status}/${tGet.status}/${tPhotos.status}`);
      const crossRead = await raw(bearer(tTok), "GET", `/api/patients/${pRace.id}/photos`);
      const crossThumb = await raw(bearer(tTok), "GET", imgUrl(pRace.id, first.data.photo.id, "?size=thumb"));
      check("isolamento: token de outra clínica não lê fotos/miniatura (404) nem vê pacientes da clínica de teste na lista", crossRead.status === 404 && crossThumb.status === 404 && !JSON.stringify(tGet.data).includes(pRace.id), `${crossRead.status}/${crossThumb.status}`);
      await prisma.patient.deleteMany({ where: { clinicId: tClinic } });
    } else check("clínica de trial vencido criada", false, `registro ${reg.status}`);

    // ===== Bloqueio de login (por último: usa o PROFESSIONAL de teste) =====
    const wrong = [];
    for (let i = 0; i < 10; i += 1) wrong.push((await mobileLogin(proEmail, "errada")).status);
    const lockedRight = await mobileLogin(proEmail, proNew);
    const lockedWrong = await mobileLogin(proEmail, "errada");
    const lockedWeb = await withSession("", () => api("POST", "/api/auth/login", { login: proEmail, password: proNew }));
    check("bloqueio: 10 falhas = 401; depois 429 com senha certa, com errada e na web; token antigo continua válido", wrong.every((s) => s === 401) && lockedRight.status === 429 && lockedWrong.status === 429 && lockedWeb.status === 429 && (await raw(bearer(proToken), "GET", "/api/auth/me")).status === 200, `${wrong.join("")} ${lockedRight.status}/${lockedWrong.status}/${lockedWeb.status}`);
    const lockedRow = await prisma.user.findUnique({ where: { email: proEmail }, select: { lockedUntil: true, failedLogins: true } });
    const minutes = (lockedRow.lockedUntil.getTime() - Date.now()) / 60_000;
    check("bloqueio: dura ~15 minutos e zera o contador", minutes > 13 && minutes <= 15 && lockedRow.failedLogins === 0, `${minutes.toFixed(1)} min`);
    await prisma.user.update({ where: { email: proEmail }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const unlocked = await mobileLogin(proEmail, proNew);
    check("bloqueio: expirado o prazo, a senha certa entra (200) e limpa o bloqueio", unlocked.status === 200 && (await prisma.user.findUnique({ where: { email: proEmail }, select: { lockedUntil: true } })).lockedUntil === null, unlocked.status);
    await mobileLogin(email, password); // um acerto antes: zera as 2 falhas deliberadas do começo desta suíte
    const nine = [];
    for (let i = 0; i < 9; i += 1) nine.push((await mobileLogin(email, "errada")).status);
    const okAfter9 = await mobileLogin(email, password);
    const next = await mobileLogin(email, "errada");
    const last = await mobileLogin(email, password);
    check("bloqueio: 9 falhas seguidas de um acerto zeram o contador (a falha seguinte dá 401, não 429)", okAfter9.status === 200 && next.status === 401 && last.status === 200, `${nine.join("")} ${okAfter9.status}/${next.status}/${last.status}`);
  } finally {
    for (const member of [staffTeam, proTeam]) if (member) await api("DELETE", "/api/team", { membershipId: member.id });
    await prisma.clinicMembership.deleteMany({ where: { user: { email: { in: [proEmail, staffEmail, trialEmail] } } } });
    await prisma.clinic.deleteMany({ where: { name: trialClinic } });
    await prisma.user.deleteMany({ where: { email: { in: [proEmail, staffEmail, noClinicEmail, trialEmail] } } });
    await prisma.user.update({ where: { email }, data: { failedLogins: 0, lockedUntil: null } });
  }
}

const suites = {
  pacientes: { needs: [], run: async (state) => { Object.assign(state, await patientsAndPayments()); await patientCpfMask(); } },
  orcamentos: { needs: ["pacientes"], run: async (state) => { state.quote = await quotesAndProcedures(state.patient); await quoteCents(); } },
  agenda: { needs: ["pacientes"], run: (state) => appointments(state.patient) },
  jornadas: { needs: ["orcamentos"], run: async (state) => { await journeys(state.patient, state.quote); await journeyDeletePermissions(); await journeyDeleteGaps(); } },
  configuracoes: { needs: [], run: () => settings() },
  estoque: { needs: ["pacientes"], run: (state) => stock(state.patient) },
  avaliacao: { needs: [], run: async () => { await evaluationRequired(); await evaluationRequiredGaps(); } },
  pendencias: { needs: ["pacientes"], run: (state) => pendingStock(state.patient) },
  anamnese: { needs: [], run: () => anamnesis() },
  documentos: { needs: [], run: () => clinicalFiles() },
  catalogo: { needs: [], run: async () => { await procedureCatalog(); await procedureCatalogGaps(); } },
  consentimento: { needs: [], run: () => consentGate() },
  sessao_unica: { needs: [], run: () => sessionPerQuote() },
  status_orcamento: { needs: [], run: () => quoteStatusKeepsSessions() },
  materiais_sessao: { needs: [], run: async () => { await sessionMaterials(); await sessionMaterialsGaps(); } },
  agendar_procedimento: { needs: [], run: () => scheduledProcedure() },
  inicio_move_agenda: { needs: [], run: () => startMovesAppointment() },
  paginacao: { needs: [], run: async () => { await paginationSuite(); await paginationGaps(); } },
  conflitos_agenda: { needs: [], run: async () => { await scheduleConflicts(); await scheduleConflictGaps(); } },
  telas: { needs: ["orcamentos"], run: (state) => browser(state.homonym) },
  login: { needs: [], run: () => loginLockout() },
  fotos: { needs: [], run: async () => { await mobilePhotos(); await mobilePhotosGaps(); } },
  procedimentos_ativos: { needs: [], run: () => activeProcedures() },
  avaliacao_facial: { needs: [], run: () => facialEvaluation() },
};

// Sem nomes, roda tudo. Com nomes, roda essas partes e as que elas precisam.
function selectSuites(names) {
  if (names.length === 0) return new Set(Object.keys(suites));
  const selected = new Set();
  const add = (name) => {
    if (!suites[name]) throw new Error(`Parte desconhecida: "${name}". Use: ${Object.keys(suites).join(", ")}.`);
    if (selected.has(name)) return;
    selected.add(name);
    suites[name].needs.forEach(add);
  };
  names.forEach(add);
  return selected;
}

async function main() {
  if (!email || !password) throw new Error("Defina TEST_ACCOUNT_EMAIL e TEST_ACCOUNT_PASSWORD no .env.");
  const selected = selectSuites(process.argv.slice(2));
  const alive = await fetch(`${baseUrl}/login`).catch(() => null);
  if (!alive?.ok) throw new Error(`Servidor fora do ar em ${baseUrl}. Rode npm run dev.`);
  await login();
  await resetTestClinic();

  const state = {};
  for (const [name, suite] of Object.entries(suites)) if (selected.has(name)) await suite.run(state);

  for (const result of results) console.log(`${result.ok ? "OK    " : "FALHOU"} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passaram (execução ${run}).`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  for (const result of results) console.log(`${result.ok ? "OK    " : "FALHOU"} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  console.error(`ERRO: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  if (email) await resetTestClinic().catch((error) => { console.error(`Limpeza da clínica de teste falhou: ${error.message}`); process.exitCode = 1; });
  await prisma.$disconnect();
});
