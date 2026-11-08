import assert from "node:assert/strict";
import { test } from "node:test";
import { pickMembership } from "../src/lib/active-clinic-rules.ts";

const memberships = [{ clinic: { id: "a" } }, { clinic: { id: "b" } }, { clinic: { id: "c" } }];

test("activeClinicId null usa a primeira membership", () => {
  assert.equal(pickMembership(memberships, null), memberships[0]);
  assert.equal(pickMembership(memberships, undefined), memberships[0]);
});

test("activeClinicId sem membership correspondente cai na primeira", () => {
  assert.equal(pickMembership(memberships, "x"), memberships[0]);
});

test("activeClinicId valido escolhe aquela clinica", () => {
  assert.equal(pickMembership(memberships, "c"), memberships[2]);
});

test("sem memberships nao ha escolha", () => {
  assert.equal(pickMembership([], "a"), undefined);
});
