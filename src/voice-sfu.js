const REQUEST_TIMEOUT_MS = 12_000;
const DISCONNECT_GRACE_MS = 5_000;
const RECOVERY_DELAYS = [700, 1500, 3000, 5000];

function cleanId(value) {
  return String(value || "").trim().slice(0, 160);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForIceGathering(peer, timeoutMs = 4_000) {
  if (!peer || peer.iceGatheringState === "complete") return;
  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", changed);
      resolve();
    };
    const changed = () => {
      if (peer.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    peer.addEventListener("icegatheringstatechange", changed);
  });
}

function sessionDescription(value, type) {
  if (!value?.sdp) throw new Error("voice-sfu-sdp-missing");
  return { type, sdp: value.sdp };
}

function createPeerConnection() {
  return new RTCPeerConnection({
    bundlePolicy: "max-bundle",
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
  });
}

export function normalizeVoiceTargets(members, selfClientId) {
  const self = cleanId(selfClientId);
  const byClient = new Map();
  for (const member of Array.isArray(members) ? members : []) {
    const clientId = cleanId(member?.clientId);
    if (!clientId || clientId === self || !member?.inVoice || member?.offlineSnapshot) continue;
    byClient.set(clientId, {
      clientId,
      peerId: cleanId(member.peerId),
      name: String(member.name || "Amigo"),
    });
  }
  return [...byClient.values()].sort((a, b) => a.clientId.localeCompare(b.clientId));
}

export class VoiceSfuManager {
  constructor(options = {}) {
    this.send = options.send;
    this.getVoiceStream = options.getVoiceStream;
    this.getSelfClientId = options.getSelfClientId;
    this.getMembers = options.getMembers;
    this.onRemoteStream = options.onRemoteStream;
    this.onRemoteRemoved = options.onRemoteRemoved;
    this.onState = options.onState;
    this.onStats = options.onStats;

    this.configured = null;
    this.intentActive = false;
    this.active = false;
    this.generation = 0;
    this.state = "disconnected";
    this.producer = null;
    this.consumer = null;
    this.publisherSender = null;
    this.referencesByMid = new Map();
    this.remoteByClient = new Map();
    this.pending = new Map();
    this.syncChain = Promise.resolve();
    this.syncRequested = false;
    this.recoveryTimer = null;
    this.recoveryAttempt = 0;
    this.statsTimer = null;
    this.closed = false;
    this.lifecycleId = 0;
  }

  usesSfuPath() {
    return this.intentActive && this.configured !== false;
  }

  isActive() {
    return this.active;
  }

  transportState() {
    return this.state;
  }

  handleMessage(message) {
    const type = String(message?.type || "");
    if (type === "voice-sfu-response") {
      const requestId = cleanId(message.requestId);
      const pending = this.pending.get(requestId);
      if (!pending) return true;
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.data || {});
      else {
        const error = new Error(String(message.error?.message || "Falha no servidor de voz."));
        error.code = String(message.error?.code || "voice_sfu_error");
        error.retryable = Boolean(message.error?.retryable);
        pending.reject(error);
      }
      return true;
    }

    if (type === "voice-sfu-publications-changed") {
      if (this.intentActive && this.configured === true) {
        this.syncRequested = true;
        void this.syncParticipants(this.getMembers?.() || []);
      }
      return true;
    }

    if (type === "voice-sfu-reset") {
      if (this.intentActive && this.configured === true) this._scheduleRecovery("server-reset", true);
      return true;
    }

    return type.startsWith("voice-sfu-");
  }

  async probe() {
    if (this.configured !== null) return this.configured;
    try {
      const result = await this._request("capabilities", {}, 1_800);
      this.configured = Boolean(result.configured && result.protocolVersion >= 1);
    } catch {
      this.configured = false;
    }
    this._emitState(this.configured ? "ready" : "fallback", { configured: this.configured });
    return this.configured;
  }

  async start() {
    this.intentActive = true;
    this.closed = false;
    const lifecycleId = ++this.lifecycleId;
    this._emitState("connecting");
    const configured = await this.probe();
    if (!this.intentActive) return false;
    if (!configured) {
      this._emitState("fallback", { configured: false });
      return false;
    }

    try {
      await this._openGeneration(lifecycleId);
      return this._isCurrentLifecycle(lifecycleId);
    } catch (error) {
      console.error("[Resenhazinha VoiceSFU] Falha ao iniciar.", error);
      if (this._fallBackOnConfigurationError(error)) return false;
      this._scheduleRecovery(error?.code || "start-failed", true);
      throw error;
    }
  }

  async _openGeneration(lifecycleId = this.lifecycleId) {
    if (!this._isCurrentLifecycle(lifecycleId)) return;
    this._closePeers();
    this.active = false;
    this.referencesByMid.clear();
    this._clearRemoteStreams();
    this._emitState(this.recoveryAttempt ? "recovering" : "connecting");

    let join;
    try {
      join = await this._request("join", {});
    } catch (error) {
      // O status "entrei na call" e o pedido do SFU viajam pelo mesmo WebSocket.
      // Em reconnects muito rápidos, damos uma chance curta para o status chegar
      // antes de recriar toda a mídia.
      if (error?.code !== "voice_sfu_not_in_voice" || !this._isCurrentLifecycle(lifecycleId)) throw error;
      await wait(140);
      if (!this._isCurrentLifecycle(lifecycleId)) return;
      join = await this._request("join", {});
    }
    if (!this._isCurrentLifecycle(lifecycleId)) return;
    this.generation = Number(join.generation) || 0;
    if (!this.generation) throw new Error("voice-sfu-generation-missing");

    this.producer = createPeerConnection();
    this.consumer = createPeerConnection();
    this._bindConnectionHealth(this.producer, "producer");
    this._bindConnectionHealth(this.consumer, "consumer");
    this.consumer.addEventListener("track", (event) => this._handleRemoteTrack(event));

    const stream = this.getVoiceStream?.();
    const track = stream?.getAudioTracks?.()[0];
    if (!track || track.readyState !== "live") throw new Error("voice-sfu-microphone-missing");

    const transceiver = this.producer.addTransceiver(track, { direction: "sendonly" });
    this.publisherSender = transceiver.sender;
    const offer = await this.producer.createOffer();
    await this.producer.setLocalDescription(offer);
    await waitForIceGathering(this.producer);
    if (!this._isCurrentLifecycle(lifecycleId)) return;
    if (transceiver.mid === null) throw new Error("voice-sfu-mid-missing");

    const published = await this._request("publish", {
      generation: this.generation,
      mid: transceiver.mid,
      sessionDescription: sessionDescription(this.producer.localDescription, "offer"),
    });
    if (!this._isCurrentLifecycle(lifecycleId)) return;
    await this.producer.setRemoteDescription(published.sessionDescription);
    if (!this._isCurrentLifecycle(lifecycleId)) return;

    this.active = true;
    this.recoveryAttempt = 0;
    this._emitState("connected", { generation: this.generation });
    this._startStats();
    await this.syncParticipants(this.getMembers?.() || [], true);
  }

  async syncParticipants(members, force = false) {
    if (!this.intentActive || this.configured !== true || !this.active || !this.consumer) return;
    const targets = normalizeVoiceTargets(members, this.getSelfClientId?.());
    const fingerprint = targets.map((item) => item.clientId).join("|");
    if (!force && !this.syncRequested && fingerprint === this.lastTargetFingerprint) return;
    this.syncRequested = false;
    this.lastTargetFingerprint = fingerprint;

    this.syncChain = this.syncChain
      .then(() => this._syncTargets(targets))
      .catch((error) => {
        console.warn("[Resenhazinha VoiceSFU] Falha ao sincronizar participantes.", error);
        if (this.intentActive) this._scheduleRecovery(error?.code || "sync-failed");
      });
    return this.syncChain;
  }

  async _syncTargets(targets) {
    if (!this.active || !this.consumer) return;
    const response = await this._request("subscribe", {
      generation: this.generation,
      desiredClientIds: targets.map((item) => item.clientId),
    });

    const nextByMid = new Map();
    const nextByClient = new Map();
    for (const item of Array.isArray(response.subscriptions) ? response.subscriptions : []) {
      const mid = cleanId(item.mid);
      const clientId = cleanId(item.clientId);
      if (!mid || !clientId) continue;
      const reference = {
        clientId,
        peerId: cleanId(item.peerId),
        name: String(item.name || "Amigo"),
        mid,
      };
      nextByMid.set(mid, reference);
      nextByClient.set(clientId, reference);
    }

    for (const [clientId, previous] of this.remoteByClient) {
      if (!nextByClient.has(clientId)) this.onRemoteRemoved?.(previous);
    }
    this.referencesByMid = nextByMid;
    this.remoteByClient = nextByClient;

    if (response.requiresImmediateRenegotiation) {
      if (response.sessionDescription?.type !== "offer") throw new Error("voice-sfu-offer-missing");
      await this.consumer.setRemoteDescription(response.sessionDescription);
      const answer = await this.consumer.createAnswer();
      await this.consumer.setLocalDescription(answer);
      await waitForIceGathering(this.consumer);
      await this._request("renegotiate", {
        generation: this.generation,
        mutationId: response.mutationId,
        sessionDescription: sessionDescription(this.consumer.localDescription, "answer"),
      });
    }
  }

  onControlReconnect() {
    if (!this.intentActive || this.configured !== true) return;
    this.lifecycleId += 1;
    this._cancelPending("voice_sfu_control_reconnected");
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.active = false;
    this._closePeers();
    this._clearRemoteStreams();
    this._scheduleRecovery("control-reconnect", true);
  }

  async replaceTrack(track) {
    if (!track || track.kind !== "audio") return false;
    if (this.publisherSender && this.intentActive && this.configured === true) {
      await this.publisherSender.replaceTrack(track);
      return true;
    }
    return false;
  }

  async stop(options = {}) {
    const notify = options.notify !== false;
    this.intentActive = false;
    this.active = false;
    this.closed = true;
    this.lifecycleId += 1;
    this._cancelPending("voice_sfu_stopped");
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.recoveryAttempt = 0;
    this._stopStats();
    this._closePeers();
    this._clearRemoteStreams();
    this.referencesByMid.clear();
    this.lastTargetFingerprint = "";
    this._emitState("disconnected");
    if (notify && this.configured === true) {
      try { await this._request("leave", {}, 5_000); } catch {}
    }
  }

  resetTransport() {
    this.configured = null;
    return this.stop({ notify: false });
  }

  _handleRemoteTrack(event) {
    if (!this.active) return;
    const mid = cleanId(event.transceiver?.mid);
    const reference = this.referencesByMid.get(mid);
    if (!reference) {
      console.warn("[Resenhazinha VoiceSFU] Track chegou sem referência.", mid);
      return;
    }
    const stream = new MediaStream([event.track]);
    event.track.addEventListener("ended", () => {
      if (this.remoteByClient.get(reference.clientId)?.mid === reference.mid) {
        this.remoteByClient.delete(reference.clientId);
        this.referencesByMid.delete(reference.mid);
        this.onRemoteRemoved?.(reference);
      }
    }, { once: true });
    this.onRemoteStream?.(reference, stream, event);
  }

  _bindConnectionHealth(peer, role) {
    let disconnectedTimer = null;
    peer.addEventListener("connectionstatechange", () => {
      if (this.closed || !this.intentActive) return;
      const connectionState = peer.connectionState;
      this._emitState(this.state, { role, connectionState });
      if (connectionState === "connected") {
        if (disconnectedTimer) clearTimeout(disconnectedTimer);
        disconnectedTimer = null;
        return;
      }
      if (connectionState === "failed") {
        this._scheduleRecovery(`${role}-failed`, true);
        return;
      }
      if (connectionState === "disconnected" && !disconnectedTimer) {
        disconnectedTimer = setTimeout(() => {
          disconnectedTimer = null;
          if (peer.connectionState === "disconnected") this._scheduleRecovery(`${role}-disconnected`);
        }, DISCONNECT_GRACE_MS);
      }
    });
  }

  _scheduleRecovery(reason, immediate = false) {
    if (!this.intentActive || this.configured !== true || this.recoveryTimer) return;
    this.active = false;
    this._emitState("recovering", { reason });
    const index = Math.min(this.recoveryAttempt, RECOVERY_DELAYS.length - 1);
    const delay = immediate ? 0 : RECOVERY_DELAYS[index];
    this.recoveryAttempt += 1;
    this.recoveryTimer = setTimeout(async () => {
      this.recoveryTimer = null;
      if (!this.intentActive) return;
      const lifecycleId = this.lifecycleId;
      try {
        await this._openGeneration(lifecycleId);
      } catch (error) {
        console.warn("[Resenhazinha VoiceSFU] Reconexão falhou.", error);
        if (this._fallBackOnConfigurationError(error)) return;
        this._scheduleRecovery(error?.code || "reconnect-failed");
      }
    }, delay);
  }

  _isCurrentLifecycle(lifecycleId) {
    return this.intentActive && lifecycleId === this.lifecycleId;
  }

  _fallBackOnConfigurationError(error) {
    if (!["voice_sfu_not_configured", "voice_sfu_credentials_invalid"].includes(String(error?.code || ""))) return false;
    this.configured = false;
    this.active = false;
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this._stopStats();
    this._closePeers();
    this._clearRemoteStreams();
    this._emitState("fallback", { configured: false, reason: error.code });
    return true;
  }

  _cancelPending(code = "voice_sfu_cancelled") {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      const error = new Error(code);
      error.code = code;
      error.retryable = true;
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }

  _closePeers() {
    this.publisherSender = null;
    for (const peer of [this.producer, this.consumer]) {
      try { peer?.close?.(); } catch {}
    }
    this.producer = null;
    this.consumer = null;
  }

  _clearRemoteStreams() {
    for (const reference of this.remoteByClient.values()) this.onRemoteRemoved?.(reference);
    this.remoteByClient.clear();
  }

  _startStats() {
    this._stopStats();
    const tick = async () => {
      if (!this.active) return;
      try {
        const result = { transport: "sfu", rttMs: null, jitterMs: null, packetsLost: 0, packetsReceived: 0, bytesSent: 0, bytesReceived: 0 };
        const reports = [];
        if (this.producer) reports.push(await this.producer.getStats());
        if (this.consumer) reports.push(await this.consumer.getStats());
        for (const stats of reports) {
          stats.forEach((report) => {
            if (report.type === "candidate-pair" && report.state === "succeeded" && (report.nominated || report.selected)) {
              if (Number.isFinite(report.currentRoundTripTime)) result.rttMs = Math.round(report.currentRoundTripTime * 1000);
            }
            if (report.type === "inbound-rtp" && report.kind === "audio") {
              result.packetsLost += Number(report.packetsLost) || 0;
              result.packetsReceived += Number(report.packetsReceived) || 0;
              result.bytesReceived += Number(report.bytesReceived) || 0;
              if (Number.isFinite(report.jitter)) result.jitterMs = Math.round(report.jitter * 1000);
            }
            if (report.type === "outbound-rtp" && report.kind === "audio") result.bytesSent += Number(report.bytesSent) || 0;
          });
        }
        this.onStats?.(result);
      } catch {}
    };
    void tick();
    this.statsTimer = setInterval(tick, 5_000);
  }

  _stopStats() {
    clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  _emitState(state, detail = {}) {
    if (state) this.state = state;
    try { this.onState?.({ state: this.state, configured: this.configured, generation: this.generation, ...detail }); } catch {}
  }

  _request(action, payload = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (typeof this.send !== "function") return Promise.reject(new Error("voice-sfu-transport-missing"));
    const requestId = `vsfu-${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        const error = new Error(`voice-sfu-timeout:${action}`);
        error.code = "voice_sfu_timeout";
        error.retryable = true;
        reject(error);
      }, timeoutMs);
      this.pending.set(requestId, { action, resolve, reject, timer });
      try {
        this.send({ type: `voice-sfu-${action}`, requestId, ...payload });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }
}
