import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// Guarda estrutural dos limites comerciais: todo caminho que CRIA paciente, membro (vaga de profissional) ou convite
// precisa estar na lista abaixo e passar por reserveCapacity (trava por clínica + contagem na mesma transação).
// Se um arquivo novo passar a criar esses registros, o teste falha e obriga a decidir sobre o limite.

const srcRoot = join(process.cwd(), "src");
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name)) files.push(path);
  }
})(srcRoot);
const rel = (file) => relative(process.cwd(), file).replaceAll("\\", "/");
const source = (file) => readFileSync(file, "utf8");
const usersOf = (pattern) => files.filter((file) => pattern.test(source(file))).map(rel).sort();

test("paciente só é criado em POST /api/patients, dentro de reserveCapacity(patients)", () => {
  assert.deepEqual(usersOf(/\bpatient\.(create|createMany|upsert)\(/), ["src/app/api/patients/route.ts"]);
  const code = source(join(srcRoot, "app/api/patients/route.ts"));
  const reserve = code.indexOf('reserveCapacity(tx, user.clinicId, "patients")');
  const create = code.search(/tx\.patient\.create\(/);
  assert.ok(reserve > 0 && create > reserve, "reserveCapacity deve vir antes do create, na mesma transação");
  assert.ok(code.includes("$transaction"));
});

test("membro (vaga de profissional) só nasce em pontos conhecidos e protegidos", () => {
  assert.deepEqual(usersOf(/clinicMembership\.(create|createMany|upsert)\(|memberships: \{ create/), [
    "src/app/api/team/route.ts",          // cadastro direto: reserveCapacity na transação
    "src/lib/google-signup-db.ts",        // dono de clínica NOVA (cadastro com Google)
    "src/lib/invitations-repo.ts",        // aceite de convite: reserveProfessionalSlot em acceptInTx (3 caminhos)
    "src/lib/signup-account.ts",          // dono de clínica NOVA (cadastro por e-mail)
  ]);
  const team = source(join(srcRoot, "app/api/team/route.ts"));
  assert.ok(team.indexOf("reserveCapacity(transaction, user.clinicId, \"professionals\")") < team.indexOf("transaction.user.create("), "POST /api/team: vaga antes de criar o usuário");
  // mudança de cargo que aumenta o consumo: trava + reserva antes do update
  assert.ok(team.includes('lockPlanResource(transaction, user.clinicId, "professionals")'));
  assert.ok(team.indexOf("countsAsProfessional(newRole)") < team.indexOf("data: { role: newRole }"));
});

test("o aceite de convite checa a vaga ANTES de consumir o convite e em TODOS os caminhos (acceptInTx)", () => {
  const code = source(join(srcRoot, "lib/invitations.ts"));
  const accept = code.slice(code.indexOf("async function acceptInTx"));
  const reserve = accept.indexOf("reserveProfessionalSlot(");
  const consume = accept.indexOf("markAccepted(");
  assert.ok(reserve > 0 && consume > reserve, "reserveProfessionalSlot deve vir antes de markAccepted");
  // os três caminhos de aceite passam por acceptInTx (e só por ele criam o vínculo)
  assert.equal((code.match(/acceptInTx\(/g) ?? []).length, 4); // definição + acceptInvitation + registerByInvite + registerGoogleByInvite
  assert.equal((code.match(/createMembership\(/g) ?? []).length, 2); // declaração no tipo + uma única chamada, dentro de acceptInTx
  assert.ok(accept.indexOf("createMembership(") > consume);
});

test("convite (reserva de vaga) só é criado/reativado em createInvitation e resendInvitation, com reserveProfessionalSlot", () => {
  assert.deepEqual(usersOf(/clinicInvitation\.create\(/), ["src/lib/invitations-repo.ts"]);
  const code = source(join(srcRoot, "lib/invitations.ts"));
  const create = code.slice(code.indexOf("export async function createInvitation"), code.indexOf("export async function resendInvitation"));
  assert.ok(create.indexOf("reserveProfessionalSlot(") > 0 && create.indexOf("reserveProfessionalSlot(") < create.indexOf("tx.create("));
  const resend = code.slice(code.indexOf("export async function resendInvitation"), code.indexOf("export async function cancelInvitation"));
  assert.ok(resend.indexOf("reserveProfessionalSlot(") > 0 && resend.indexOf("reserveProfessionalSlot(") < resend.indexOf("tx.rotate("));
});

test("todas as rotas que recebem o resultado de convite/aceite devolvem PLAN_LIMIT como 403 (nunca 401/404/500)", () => {
  for (const route of [
    "app/api/invitations/route.ts",
    "app/api/invitations/[id]/resend/route.ts",
    "app/api/invitations/accept/route.ts",
    "app/api/auth/invite/register/route.ts",
    "app/api/auth/invite/google/complete/route.ts",
  ]) {
    const code = source(join(srcRoot, route));
    assert.ok(/plan/.test(code) && /403|result\.status/.test(code), `${route}: não trata o limite de plano`);
  }
});

test("a mesma chave de lock é usada por todos os caminhos (plan-usage é a única fonte)", () => {
  assert.deepEqual(usersOf(/pg_advisory_xact_lock\(hashtextextended\(\$\{planLockKey/), ["src/lib/plan-usage.ts"]);
  assert.deepEqual(usersOf(/reserveCapacity\(/).filter((file) => !file.startsWith("src/lib/plan-usage")), [
    "src/app/api/patients/route.ts", "src/app/api/team/route.ts", "src/lib/invitations-repo.ts",
  ]);
});
