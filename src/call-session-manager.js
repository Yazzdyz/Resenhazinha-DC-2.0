export const CALL_PROTOCOL_VERSION = 2;

const SLOT_NAMES = ["voice", "screenOut", "screenIn", "cameraOut", "cameraIn"];

function closeQuietly(call) {
  try { call?.close?.(); } catch (_error) { /* a chamada já terminou */ }
}

function normalizedPeerId(value) {
  return String(value || "").trim().slice(0, 120);
}

function normalizedClientId(value) {
  return String(value || "").trim().slice(0, 120);
}

export function shouldInitiateVoiceCall(localPeerId, remotePeerId) {
  const local = normalizedPeerId(localPeerId);
  const remote = normalizedPeerId(remotePeerId);
  return Boolean(local && remote && local !== remote && local.localeCompare(remote) < 0);
}

function normalizedVoiceRevision(value) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
}

export function shouldApplyVoicePresenceSnapshot(localRevision, incomingRevision) {
  return normalizedVoiceRevision(incomingRevision) >= normalizedVoiceRevision(localRevision);
}

export function dedupeMembersByIdentity(members) {
  const result = [];
  const indexByIdentity = new Map();

  for (const member of Array.isArray(members) ? members : []) {
    if (!member || typeof member !== "object") continue;
    const peerId = normalizedPeerId(member.peerId);
    if (!peerId) continue;
    const clientId = normalizedClientId(member.clientId);
    const identity = clientId ? `client:${clientId}` : `peer:${peerId}`;
    const next = { ...member, peerId, clientId };
    const previousIndex = indexByIdentity.get(identity);

    if (previousIndex === undefined) {
      indexByIdentity.set(identity, result.length);
      result.push(next);
      continue;
    }

    const previous = result[previousIndex];
    const previousOffline = Boolean(previous.offlineSnapshot);
    const nextOffline = Boolean(next.offlineSnapshot);
    const shouldReplace = (previousOffline && !nextOffline)
      || (previousOffline === nextOffline && Number(next.sessionStartedAt || 0) >= Number(previous.sessionStartedAt || 0));
    if (shouldReplace) result[previousIndex] = next;
  }

  return result;
}

export class CallSessionManager {
  constructor({ setTimeoutFn = globalThis.setTimeout, clearTimeoutFn = globalThis.clearTimeout, makeId = () => crypto.randomUUID() } = {}) {
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.makeId = makeId;
    this.calls = Object.fromEntries(SLOT_NAMES.map((name) => [name, new Map()]));
    this.details = Object.fromEntries(SLOT_NAMES.map((name) => [name, new Map()]));
    this.retryTimers = new Map();
    this.retryAttempts = new Map();
    this.negotiationTimers = new Map();
    this.sessions = { voice: null, screen: null, camera: null };
  }

  map(kind) {
    const map = this.calls[kind];
    if (!map) throw new Error(`unknown-call-slot:${kind}`);
    return map;
  }

  beginSession(kind) {
    if (!(kind in this.sessions)) throw new Error(`unknown-media-session:${kind}`);
    this.endSession(kind);
    const sessionId = `${kind}-${this.makeId()}`;
    this.sessions[kind] = sessionId;
    return sessionId;
  }

  endSession(kind) {
    if (!(kind in this.sessions)) return;
    this.sessions[kind] = null;
    this.cancelRetries(kind);
  }

  sessionId(kind) {
    return this.sessions[kind] || null;
  }

  adopt(kind, peerId, call, detail = {}) {
    const id = normalizedPeerId(peerId);
    if (!id || !call) return false;
    const map = this.map(kind);
    const previous = map.get(id);
    if (previous === call) return true;
    map.set(id, call);
    this.details[kind].set(id, { ...detail });
    this.clearNegotiation(kind, id);
    if (previous) closeQuietly(previous);
    return true;
  }

  isCurrent(kind, peerId, call) {
    return this.map(kind).get(normalizedPeerId(peerId)) === call;
  }

  detail(kind, peerId, call = null) {
    const id = normalizedPeerId(peerId);
    if (call && !this.isCurrent(kind, id, call)) return null;
    return this.details[kind].get(id) || null;
  }

  release(kind, peerId, call, { close = false } = {}) {
    const id = normalizedPeerId(peerId);
    const map = this.map(kind);
    if (map.get(id) !== call) return false;
    map.delete(id);
    this.details[kind].delete(id);
    this.clearNegotiation(kind, id);
    if (close) closeQuietly(call);
    return true;
  }

  close(kind, peerId) {
    const id = normalizedPeerId(peerId);
    const call = this.map(kind).get(id);
    if (!call) return false;
    this.release(kind, id, call);
    closeQuietly(call);
    return true;
  }

  closePeer(peerId) {
    const id = normalizedPeerId(peerId);
    this.cancelRetries(null, id);
    for (const kind of SLOT_NAMES) this.close(kind, id);
  }

  closeAll() {
    this.cancelRetries();
    for (const kind of SLOT_NAMES) {
      for (const peerId of [...this.map(kind).keys()]) this.close(kind, peerId);
    }
  }

  retryKey(kind, peerId) {
    return `${kind}:${normalizedPeerId(peerId)}`;
  }

  retryScheduled(kind, peerId) {
    return this.retryTimers.has(this.retryKey(kind, peerId));
  }

  scheduleRetry(kind, peerId, delays, callback) {
    const id = normalizedPeerId(peerId);
    const key = this.retryKey(kind, id);
    if (!id || this.retryTimers.has(key) || !this.sessions[kind]) return false;
    const attempt = Number(this.retryAttempts.get(key) || 0);
    if (attempt >= delays.length) return false;
    const timer = this.setTimeoutFn(() => {
      this.retryTimers.delete(key);
      callback({ attempt: attempt + 1, peerId: id, sessionId: this.sessions[kind] });
    }, delays[attempt]);
    this.retryAttempts.set(key, attempt + 1);
    this.retryTimers.set(key, timer);
    return true;
  }

  markHealthy(kind, peerId) {
    const key = this.retryKey(kind, peerId);
    const timer = this.retryTimers.get(key);
    if (timer !== undefined) this.clearTimeoutFn(timer);
    this.retryTimers.delete(key);
    this.retryAttempts.delete(key);
  }

  cancelRetries(kind = null, peerId = null) {
    const prefix = kind ? `${kind}:` : "";
    const suffix = peerId ? `:${normalizedPeerId(peerId)}` : "";
    for (const [key, timer] of this.retryTimers) {
      if (prefix && !key.startsWith(prefix)) continue;
      if (suffix && !key.endsWith(suffix)) continue;
      this.clearTimeoutFn(timer);
      this.retryTimers.delete(key);
    }
    for (const key of [...this.retryAttempts.keys()]) {
      if (prefix && !key.startsWith(prefix)) continue;
      if (suffix && !key.endsWith(suffix)) continue;
      this.retryAttempts.delete(key);
    }
  }

  armNegotiation(kind, peerId, call, timeoutMs, onTimeout) {
    const id = normalizedPeerId(peerId);
    this.clearNegotiation(kind, id);
    const key = this.retryKey(kind, id);
    const timer = this.setTimeoutFn(() => {
      this.negotiationTimers.delete(key);
      if (this.isCurrent(kind, id, call)) onTimeout();
    }, timeoutMs);
    this.negotiationTimers.set(key, timer);
  }

  clearNegotiation(kind, peerId) {
    const key = this.retryKey(kind, peerId);
    const timer = this.negotiationTimers.get(key);
    if (timer !== undefined) this.clearTimeoutFn(timer);
    this.negotiationTimers.delete(key);
  }
}
