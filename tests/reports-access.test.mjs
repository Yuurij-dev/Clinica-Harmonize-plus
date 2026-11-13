import assert from "node:assert/strict";
import { test } from "node:test";
import { appliedProfessional, isValidProfessionalParam, resolveReportAccess } from "../src/lib/reports-access.ts";
import { createDefaultRolePermissionMatrix } from "../src/lib/permissions.ts";

const user = (role, patch = {}) => ({ role, name: `Dr ${role}`, rolePermissions: createDefaultRolePermissionMatrix(), ...patch });
const grant = (role, ...keys) => { const m = createDefaultRolePermissionMatrix(); for (const k of keys) m[role][k] = true; return m; };

test("default: ADMIN sees everything and may choose the professional", () => {
  const access = resolveReportAccess(user("ADMIN"));
  assert.equal(access.allowed, true);
  assert.deepEqual(access.capabilities, { finance: true, quotes: true, stock: true });
  assert.equal(access.forcedProfessional, null);
  assert.equal(appliedProfessional(access, "  Ana "), "Ana");
  assert.equal(appliedProfessional(access, ""), null);
  assert.equal(appliedProfessional(access, undefined), null);
});

test("default: PROFESSIONAL and STAFF have no report access", () => {
  for (const role of ["PROFESSIONAL", "STAFF"]) {
    const access = resolveReportAccess(user(role));
    assert.equal(access.allowed, false);
    assert.deepEqual(access.capabilities, { finance: false, quotes: false, stock: false });
  }
});

test("PROFESSIONAL with reports:access is forced to own name and ignores the query", () => {
  const access = resolveReportAccess(user("PROFESSIONAL", { rolePermissions: grant("PROFESSIONAL", "reports:access") }));
  assert.equal(access.allowed, true);
  assert.equal(access.forcedProfessional, "Dr PROFESSIONAL");
  assert.equal(access.canChooseProfessional, false);
  assert.equal(appliedProfessional(access, "Outra Pessoa"), "Dr PROFESSIONAL");
  // quotes:access é padrão do PROFESSIONAL; finance e stock não.
  assert.deepEqual(access.capabilities, { finance: false, quotes: true, stock: false });
});

test("capabilities need their own permission on top of reports:access", () => {
  const noReports = resolveReportAccess(user("PROFESSIONAL", { rolePermissions: grant("PROFESSIONAL", "finance:access") }));
  assert.deepEqual(noReports.capabilities, { finance: false, quotes: false, stock: false });
  const adminNoFinance = createDefaultRolePermissionMatrix();
  adminNoFinance.ADMIN["finance:access"] = false;
  assert.equal(resolveReportAccess(user("ADMIN", { rolePermissions: adminNoFinance })).capabilities.finance, false);
  const stockAccess = resolveReportAccess(user("PROFESSIONAL", { rolePermissions: grant("PROFESSIONAL", "reports:access", "stock:access") }));
  assert.deepEqual(stockAccess.capabilities, { finance: false, quotes: true, stock: true });
});

test("forced PROFESSIONAL never gets finance, even with finance:access", () => {
  const access = resolveReportAccess(user("PROFESSIONAL", { rolePermissions: grant("PROFESSIONAL", "reports:access", "finance:access") }));
  assert.equal(access.capabilities.finance, false);
  // Quem não é PROFESSIONAL com finance:access continua vendo (STAFF com permissão concedida).
  assert.equal(resolveReportAccess(user("STAFF", { rolePermissions: grant("STAFF", "reports:access", "finance:access") })).capabilities.finance, true);
});

test("professional name uses the same normalization as the appointment write", () => {
  const forced = resolveReportAccess(user("PROFESSIONAL", { name: "  Dra.   Ana  Souza ", rolePermissions: grant("PROFESSIONAL", "reports:access") }));
  assert.equal(forced.forcedProfessional, "Dra. Ana Souza");
  assert.equal(appliedProfessional(resolveReportAccess(user("ADMIN")), "  Dra.   Bia "), "Dra. Bia");
});

test("professional query param rejects control characters and huge values", () => {
  assert.equal(isValidProfessionalParam(null), true);
  assert.equal(isValidProfessionalParam("Dra. Ana"), true);
  assert.equal(isValidProfessionalParam(String.fromCharCode(65, 0, 66)), false);
  assert.equal(isValidProfessionalParam("Ana" + String.fromCharCode(10) + "x"), false);
  assert.equal(isValidProfessionalParam("a".repeat(121)), false);
});

test("PROFESSIONAL sem nome utilizável falha fechado: não acessa nem vê tudo", () => {
  for (const name of ["", "   ", "\u0000"]) {
    const access = resolveReportAccess(user("PROFESSIONAL", { name, rolePermissions: grant("PROFESSIONAL", "reports:access", "finance:access", "quotes:access", "stock:access") }));
    assert.equal(access.allowed, false, JSON.stringify(name));
    assert.deepEqual(access.capabilities, { finance: false, quotes: false, stock: false });
    assert.equal(access.canChooseProfessional, false);
    assert.equal(appliedProfessional(access, "Outra pessoa"), null);
  }
});
