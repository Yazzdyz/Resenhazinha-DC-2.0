import assert from "node:assert/strict";
import test from "node:test";
import {
  CallSessionManager,
  dedupeMembersByIdentity,
  shouldInitiateVoiceCall,
} from "../src/call-session-manager.js";

function fakeCall() {
  return { closed: 0, close() { this.closed += 1; } };
}

test("apenas um lado inicia a voz", () => {
  assert.equal(shouldInitiateVoiceCall("a", "b"), true);
  assert.equal(shouldInitiateVoiceCall("b", "a"), false);
  assert.equal(shouldInitiateVoiceCall("a", "a"), false);
});

test("deduplica a mesma instalação e prefere a sessão online mais nova", () => {
  const result = dedupeMembersByIdentity([
    { peerId: "old", clientId: "client-1", offlineSnapshot: false, sessionStartedAt: 10 },
    { peerId: "offline-client-1", clientId: "client-1", offlineSnapshot: true, sessionStartedAt: 20 },
    { peerId: "new", clientId: "client-1", offlineSnapshot: false, sessionStartedAt: 30 },
    { peerId: "other", clientId: "client-2", offlineSnapshot: false },
  ]);
  assert.deepEqual(result.map((member) => member.peerId), ["new", "other"]);
});

test("evento atrasado de uma call antiga não remove a nova", () => {
  const manager = new CallSessionManager({ makeId: () => "id" });
  const oldCall = fakeCall();
  const newCall = fakeCall();
  manager.adopt("voice", "peer", oldCall);
  manager.adopt("voice", "peer", newCall);
  assert.equal(oldCall.closed, 1);
  assert.equal(manager.release("voice", "peer", oldCall), false);
  assert.equal(manager.map("voice").get("peer"), newCall);
});

test("retry de mídia é limitado e cancelado ao ficar saudável", () => {
  const timers = [];
  const manager = new CallSessionManager({
    makeId: () => "id",
    setTimeoutFn: (callback) => { timers.push(callback); return timers.length; },
    clearTimeoutFn: () => undefined,
  });
  manager.beginSession("voice");
  let attempts = 0;
  const retry = () => manager.scheduleRetry("voice", "peer", [1, 2], () => { attempts += 1; retry(); });
  assert.equal(retry(), true);
  timers.shift()();
  timers.shift()();
  assert.equal(attempts, 2);
  assert.equal(retry(), false);
  manager.markHealthy("voice", "peer");
  assert.equal(retry(), true);
});

test("encerrar a sessão cancela retries pendentes", () => {
  const cleared = [];
  const manager = new CallSessionManager({
    makeId: () => "id",
    setTimeoutFn: () => 42,
    clearTimeoutFn: (timer) => cleared.push(timer),
  });
  manager.beginSession("screen");
  assert.equal(manager.scheduleRetry("screen", "peer", [100], () => assert.fail("retry cancelado não deve executar")), true);
  manager.endSession("screen");
  assert.deepEqual(cleared, [42]);
  assert.equal(manager.retryScheduled("screen", "peer"), false);
});

test("watchdog antigo não encerra a call substituta", () => {
  const timers = [];
  const manager = new CallSessionManager({
    makeId: () => "id",
    setTimeoutFn: (callback) => { timers.push(callback); return timers.length; },
    clearTimeoutFn: () => undefined,
  });
  const oldCall = fakeCall();
  const newCall = fakeCall();
  let expired = 0;
  manager.adopt("screenIn", "peer", oldCall);
  manager.armNegotiation("screenIn", "peer", oldCall, 100, () => { expired += 1; });
  manager.adopt("screenIn", "peer", newCall);
  timers.shift()();
  assert.equal(expired, 0);
  assert.equal(manager.map("screenIn").get("peer"), newCall);
});
