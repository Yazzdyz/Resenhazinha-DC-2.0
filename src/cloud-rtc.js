const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        "turn:eu-0.turn.peerjs.com:3478",
        "turn:us-0.turn.peerjs.com:3478",
      ],
      username: "peerjs",
      credential: "peerjsp",
    },
  ],
  sdpSemantics: "unified-plan",
};

function cleanId(value) {
  return String(value || "").trim().slice(0, 160);
}

function keyFor(kind, clientId) {
  return `${kind}:${cleanId(clientId)}`;
}

function safeDescription(value) {
  if (!value || !["offer", "answer"].includes(value.type) || typeof value.sdp !== "string") return null;
  return { type: value.type, sdp: value.sdp };
}

function safeCandidate(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.candidate !== "string") return null;
  return {
    candidate: value.candidate,
    sdpMid: value.sdpMid ?? null,
    sdpMLineIndex: value.sdpMLineIndex ?? null,
    usernameFragment: value.usernameFragment ?? null,
  };
}

export function shouldInitiateCloudRtc(localClientId, remoteClientId) {
  const local = cleanId(localClientId);
  const remote = cleanId(remoteClientId);
  return Boolean(local && remote && local !== remote && local.localeCompare(remote) < 0);
}

export class CloudRtcManager {
  constructor(options = {}) {
    this.sendSignal = options.sendSignal;
    this.getVoiceStream = options.getVoiceStream;
    this.getScreenStream = options.getScreenStream;
    this.onVoiceStream = options.onVoiceStream;
    this.onScreenStream = options.onScreenStream;
    this.onState = options.onState;
    this.onNeedsReconcile = options.onNeedsReconcile;
    this.rtcConfig = options.rtcConfig || DEFAULT_RTC_CONFIG;
    this.entries = new Map();
    this.pendingCandidates = new Map();
  }

  entry(kind, clientId) {
    return this.entries.get(keyFor(kind, clientId)) || null;
  }

  list(kind) {
    return [...this.entries.values()].filter((entry) => entry.kind === kind);
  }

  _emitState(entry, extra = {}) {
    try {
      this.onState?.({
        kind: entry.kind,
        clientId: entry.clientId,
        peerId: entry.peerId,
        connectionId: entry.connectionId,
        connectionState: entry.pc.connectionState,
        iceConnectionState: entry.pc.iceConnectionState,
        iceGatheringState: entry.pc.iceGatheringState,
        signalingState: entry.pc.signalingState,
        ...extra,
      });
    } catch {}
  }

  _send(entry, data) {
    if (!entry?.clientId || typeof this.sendSignal !== "function") return;
    this.sendSignal({
      targetClientId: entry.clientId,
      targetPeerId: entry.peerId || "",
      kind: entry.kind,
      data: {
        ...data,
        connectionId: entry.connectionId,
      },
    });
  }

  _createEntry(kind, remote, { connectionId = crypto.randomUUID(), initiator = false } = {}) {
    const clientId = cleanId(remote?.clientId);
    if (!clientId) throw new Error("cloud-rtc-client-id-missing");

    const existing = this.entry(kind, clientId);
    if (existing) this.close(kind, clientId, { notify: false, reason: "replace" });

    const pc = new RTCPeerConnection(this.rtcConfig);
    const entry = {
      kind,
      clientId,
      peerId: cleanId(remote?.peerId),
      name: String(remote?.name || "Amigo"),
      connectionId: cleanId(connectionId) || crypto.randomUUID(),
      initiator: Boolean(initiator),
      pc,
      remoteDescriptionSet: false,
      closed: false,
      disconnectTimer: null,
      negotiationTimer: null,
      createdAt: Date.now(),
      screenSessionId: cleanId(remote?.screenSessionId),
      voiceSessionId: cleanId(remote?.voiceSessionId),
    };
    this.entries.set(keyFor(kind, clientId), entry);

    pc.onicecandidate = (event) => {
      if (entry.closed || !event.candidate) return;
      const candidate = event.candidate.toJSON?.() || {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        usernameFragment: event.candidate.usernameFragment,
      };
      this._send(entry, { type: "candidate", candidate });
    };

    pc.onconnectionstatechange = () => {
      this._emitState(entry);
      if (pc.connectionState === "connected") {
        clearTimeout(entry.disconnectTimer);
        clearTimeout(entry.negotiationTimer);
        entry.disconnectTimer = null;
        entry.negotiationTimer = null;
        return;
      }

      if (pc.connectionState === "disconnected") {
        clearTimeout(entry.disconnectTimer);
        entry.disconnectTimer = setTimeout(() => {
          if (entry.closed || entry.pc.connectionState !== "disconnected") return;
          this.close(kind, clientId, { notify: false, reason: "disconnected" });
          this.onNeedsReconcile?.(kind, clientId);
        }, 5000);
        return;
      }

      if (pc.connectionState === "failed") {
        this.close(kind, clientId, { notify: false, reason: "failed" });
        this.onNeedsReconcile?.(kind, clientId);
      }
    };

    pc.oniceconnectionstatechange = () => this._emitState(entry);

    pc.ontrack = (event) => {
      if (entry.closed) return;
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      if (kind === "voice") this.onVoiceStream?.(entry, stream, event);
      else if (kind === "screen") this.onScreenStream?.(entry, stream, event);
    };

    const queued = this.pendingCandidates.get(`${keyFor(kind, clientId)}:${entry.connectionId}`);
    if (queued?.length) entry.pendingCandidates = [...queued];
    else entry.pendingCandidates = [];
    this.pendingCandidates.delete(`${keyFor(kind, clientId)}:${entry.connectionId}`);

    this._emitState(entry, { phase: "created" });
    return entry;
  }

  _addLocalTracks(entry) {
    const stream = entry.kind === "voice" ? this.getVoiceStream?.() : this.getScreenStream?.();
    if (!stream) return;
    const existingTrackIds = new Set(entry.pc.getSenders().map((sender) => sender.track?.id).filter(Boolean));
    for (const track of stream.getTracks()) {
      if (existingTrackIds.has(track.id)) continue;
      entry.pc.addTrack(track, stream);
    }
  }

  async _flushCandidates(entry) {
    if (!entry?.remoteDescriptionSet || entry.closed) return;
    const queue = entry.pendingCandidates.splice(0);
    for (const candidate of queue) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn("[CloudRTC] Falha ao aplicar ICE candidate.", entry.kind, entry.clientId, error);
      }
    }
  }

  async ensureOffer(kind, remote) {
    const clientId = cleanId(remote?.clientId);
    if (!clientId) return null;

    let entry = this.entry(kind, clientId);
    if (entry && ["new", "connecting", "connected"].includes(entry.pc.connectionState)) {
      entry.peerId = cleanId(remote?.peerId) || entry.peerId;
      entry.name = String(remote?.name || entry.name || "Amigo");
      return entry;
    }

    entry = this._createEntry(kind, remote, { initiator: true });
    this._addLocalTracks(entry);

    try {
      const offer = await entry.pc.createOffer();
      if (entry.closed) return null;
      await entry.pc.setLocalDescription(offer);
      this._send(entry, {
        type: "offer",
        description: entry.pc.localDescription?.toJSON?.() || {
          type: entry.pc.localDescription.type,
          sdp: entry.pc.localDescription.sdp,
        },
        voiceSessionId: cleanId(remote?.localVoiceSessionId),
        screenSessionId: cleanId(remote?.screenSessionId),
      });
      clearTimeout(entry.negotiationTimer);
      entry.negotiationTimer = setTimeout(() => {
        if (entry.closed || entry.pc.connectionState === "connected") return;
        this.close(kind, clientId, { notify: false, reason: "negotiation-timeout" });
        this.onNeedsReconcile?.(kind, clientId);
      }, 15_000);
      this._emitState(entry, { phase: "offer-sent" });
      return entry;
    } catch (error) {
      console.error("[CloudRTC] Falha ao criar oferta.", kind, clientId, error);
      this.close(kind, clientId, { notify: false, reason: "offer-error" });
      return null;
    }
  }

  async handleSignal(message) {
    const kind = String(message?.kind || "");
    if (!["voice", "screen"].includes(kind)) return false;

    const data = message?.data;
    const clientId = cleanId(message?.fromClientId);
    const peerId = cleanId(message?.fromPeerId);
    const connectionId = cleanId(data?.connectionId);
    if (!clientId || !connectionId || !data?.type) return true;

    if (data.type === "offer") {
      const description = safeDescription(data.description);
      if (!description || description.type !== "offer") return true;

      let entry = this.entry(kind, clientId);
      if (!entry || entry.connectionId !== connectionId) {
        entry = this._createEntry(kind, {
          clientId,
          peerId,
          voiceSessionId: data.voiceSessionId,
          screenSessionId: data.screenSessionId,
        }, { connectionId, initiator: false });
      } else {
        entry.peerId = peerId || entry.peerId;
      }

      this._addLocalTracks(entry);

      try {
        await entry.pc.setRemoteDescription(description);
        entry.remoteDescriptionSet = true;
        await this._flushCandidates(entry);
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        this._send(entry, {
          type: "answer",
          description: entry.pc.localDescription?.toJSON?.() || {
            type: entry.pc.localDescription.type,
            sdp: entry.pc.localDescription.sdp,
          },
        });
        this._emitState(entry, { phase: "answer-sent" });
      } catch (error) {
        console.error("[CloudRTC] Falha ao responder oferta.", kind, clientId, error);
        this.close(kind, clientId, { notify: false, reason: "answer-error" });
      }
      return true;
    }

    if (data.type === "answer") {
      const entry = this.entry(kind, clientId);
      const description = safeDescription(data.description);
      if (!entry || entry.connectionId !== connectionId || !description || description.type !== "answer") return true;

      try {
        await entry.pc.setRemoteDescription(description);
        entry.remoteDescriptionSet = true;
        await this._flushCandidates(entry);
        clearTimeout(entry.negotiationTimer);
        entry.negotiationTimer = null;
        this._emitState(entry, { phase: "answer-applied" });
      } catch (error) {
        console.error("[CloudRTC] Falha ao aplicar answer.", kind, clientId, error);
        this.close(kind, clientId, { notify: false, reason: "answer-apply-error" });
      }
      return true;
    }

    if (data.type === "candidate") {
      const candidate = safeCandidate(data.candidate);
      if (!candidate) return true;

      const entry = this.entry(kind, clientId);
      if (!entry || entry.connectionId !== connectionId) {
        const pendingKey = `${keyFor(kind, clientId)}:${connectionId}`;
        const queue = this.pendingCandidates.get(pendingKey) || [];
        queue.push(candidate);
        this.pendingCandidates.set(pendingKey, queue.slice(-64));
        return true;
      }

      if (!entry.remoteDescriptionSet) {
        entry.pendingCandidates.push(candidate);
        return true;
      }

      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn("[CloudRTC] ICE candidate rejeitado.", kind, clientId, error);
      }
      return true;
    }

    if (data.type === "close") {
      const entry = this.entry(kind, clientId);
      if (entry && entry.connectionId === connectionId) {
        this.close(kind, clientId, { notify: false, reason: "remote-close" });
      }
      return true;
    }

    return true;
  }

  close(kind, clientId, { notify = true, reason = "local-close" } = {}) {
    const key = keyFor(kind, clientId);
    const entry = this.entries.get(key);
    if (!entry) return;

    this.entries.delete(key);
    entry.closed = true;
    clearTimeout(entry.disconnectTimer);
    clearTimeout(entry.negotiationTimer);
    entry.disconnectTimer = null;
    entry.negotiationTimer = null;

    if (notify) {
      try {
        this._send(entry, { type: "close", reason });
      } catch {}
    }

    try { entry.pc.ontrack = null; } catch {}
    try { entry.pc.onicecandidate = null; } catch {}
    try { entry.pc.close(); } catch {}

    this._emitState(entry, { phase: "closed", reason });
  }

  closeMissing(kind, activeClientIds) {
    const active = new Set([...activeClientIds].map(cleanId));
    for (const entry of this.list(kind)) {
      if (!active.has(entry.clientId)) this.close(kind, entry.clientId, { notify: true, reason: "not-active" });
    }
  }

  closeAll(kind = null, { notify = true, reason = "close-all" } = {}) {
    for (const entry of [...this.entries.values()]) {
      if (kind && entry.kind !== kind) continue;
      this.close(entry.kind, entry.clientId, { notify, reason });
    }
  }
}
