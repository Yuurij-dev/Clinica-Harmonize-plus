import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRESENCE_TTL_MS, cycleThrottleAllows, parseEnvelope, prunePeers, scopeStillValid, shouldRunCycle, shouldRunSessions, tabScopeFromCacheScope, viewerMatchesScope,
} from "../src/lib/tab-leader-rules.ts";

const scope = "user-a:clinic-a";
const envelope = (message, overrides = {}) => ({ scope, from: "tab-2", message, ...overrides });

test("tab scope is the full cache scope, so different permissions never share lock or channel", () => {
  assert.equal(tabScopeFromCacheScope("user-a:clinic-a:{\"x\":1}"), "user-a:clinic-a:{\"x\":1}");
  assert.equal(tabScopeFromCacheScope("user-a:clinic-a"), "user-a:clinic-a");
  assert.equal(tabScopeFromCacheScope(null), null);
  assert.equal(tabScopeFromCacheScope("user-a"), null);
  const full = "user-a:clinic-a:{\"clinical\":true}";
  assert.equal(scopeStillValid(full, full), true);
  assert.equal(scopeStillValid(full, "user-a:clinic-a:{}"), false);
  assert.equal(scopeStillValid(full, "user-b:clinic-a:{\"clinical\":true}"), false);
  assert.equal(scopeStillValid(full, null), false);
});

test("API viewer must match the tab's user and clinic", () => {
  const cache = "user-a:clinic-a:{\"x\":1}";
  assert.equal(viewerMatchesScope({ userId: "user-a", clinicId: "clinic-a" }, cache), true);
  assert.equal(viewerMatchesScope({ userId: "user-a", clinicId: "clinic-a" }, "user-a:clinic-a"), true);
  assert.equal(viewerMatchesScope({ userId: "user-b", clinicId: "clinic-a" }, cache), false);
  assert.equal(viewerMatchesScope({ userId: "user-a", clinicId: "clinic-b" }, cache), false);
  assert.equal(viewerMatchesScope({ userId: "user-a", clinicId: "clinic-ab" }, "user-a:clinic-a:{}"), false);
  assert.equal(viewerMatchesScope(undefined, cache), false);
  assert.equal(viewerMatchesScope({ userId: "user-a", clinicId: "clinic-a" }, null), false);
});

test("messages from another scope, from itself or malformed are ignored", () => {
  assert.equal(parseEnvelope(envelope({ kind: "hello" }, { scope: "user-b:clinic-a" }), scope, "tab-1"), null);
  assert.equal(parseEnvelope(envelope({ kind: "hello" }, { from: "tab-1" }), scope, "tab-1"), null);
  assert.equal(parseEnvelope(null, scope, "tab-1"), null);
  assert.equal(parseEnvelope(envelope({ kind: "unknown" }), scope, "tab-1"), null);
  assert.equal(parseEnvelope(envelope({ kind: "presence", visible: "yes", sessionsEligible: true }), scope, "tab-1"), null);
  assert.equal(parseEnvelope(envelope({ kind: "sessions", sessions: [{ id: 1 }] }), scope, "tab-1"), null);
  assert.equal(parseEnvelope(envelope({ kind: "cycle", alerts: { appointments: "x" }, updated: [] }), scope, "tab-1"), null);
  assert.equal(parseEnvelope(envelope({ kind: "cycle", alerts: null, updated: [{ id: "a" }] }), scope, "tab-1"), null);
});

test("well-formed messages are accepted", () => {
  assert.deepEqual(parseEnvelope(envelope({ kind: "presence", visible: true, sessionsEligible: false, extra: 1 }), scope, "tab-1")?.message, { kind: "presence", visible: true, sessionsEligible: false });
  assert.deepEqual(parseEnvelope(envelope({ kind: "refresh", force: true }), scope, "tab-1")?.message, { kind: "refresh", force: true });
  const session = { id: "s", patientId: "p", journeyId: "j", procedureName: "x", patientName: "n", journeyName: "m" };
  assert.deepEqual(parseEnvelope(envelope({ kind: "sessions", sessions: [session] }), scope, "tab-1")?.message, { kind: "sessions", sessions: [session] });
  const updated = [{ id: "a", patientId: "p", date: "2026-10-15", status: "Faltou" }];
  assert.deepEqual(parseEnvelope(envelope({ kind: "cycle", alerts: { appointments: [] }, updated }), scope, "tab-1")?.message, { kind: "cycle", alerts: { appointments: [] }, updated });
});

test("the leader cycle runs when it or a fresh follower is visible, and heartbeats expire", () => {
  const now = 100_000;
  const hiddenPeer = { visible: false, sessionsEligible: false, at: now };
  const visiblePeer = { visible: true, sessionsEligible: false, at: now - 30_000 };
  assert.equal(shouldRunCycle({ visible: true }, [], now), true);
  assert.equal(shouldRunCycle({ visible: false }, [hiddenPeer], now), false);
  assert.equal(shouldRunCycle({ visible: false }, [hiddenPeer, visiblePeer], now), true);
  const expired = { ...visiblePeer, at: now - PRESENCE_TTL_MS - 1 };
  assert.equal(shouldRunCycle({ visible: false }, [expired], now), false);
  assert.equal(shouldRunCycle({ visible: false }, [{ ...visiblePeer, at: now - PRESENCE_TTL_MS }], now), true);
  const peers = new Map([["a", expired], ["b", visiblePeer]]);
  prunePeers(peers, now);
  assert.deepEqual([...peers.keys()], ["b"]);
});

test("active procedures need a visible desktop tab with permission", () => {
  const now = 10_000;
  assert.equal(shouldRunSessions({ visible: true, sessionsEligible: true }, [], now), true);
  assert.equal(shouldRunSessions({ visible: true, sessionsEligible: false }, [], now), false);
  assert.equal(shouldRunSessions({ visible: false, sessionsEligible: true }, [], now), false);
  assert.equal(shouldRunSessions({ visible: false, sessionsEligible: false }, [{ visible: true, sessionsEligible: true, at: now }], now), true);
  assert.equal(shouldRunSessions({ visible: false, sessionsEligible: false }, [{ visible: false, sessionsEligible: true, at: now }], now), false);
});

test("cycles are throttled to about 10 seconds unless forced", () => {
  assert.equal(cycleThrottleAllows(0, 5), true);
  assert.equal(cycleThrottleAllows(1_000, 10_999), false);
  assert.equal(cycleThrottleAllows(1_000, 11_000), true);
  assert.equal(cycleThrottleAllows(1_000, 2_000, true), true);
});
