export const CLOUD_SERVER_ORIGIN = "https://resenhazinha-server.guilhermekrull1227.workers.dev";
export const CLOUD_SERVER_WS = "wss://resenhazinha-server.guilhermekrull1227.workers.dev/ws";
export const CLOUD_OWNER_KEY_PREFIX = "resenhazinha:cloud-owner-key:";

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + step)));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  try {
    const binary = atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function stringifyWire(value) {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Uint8Array) return { __rz_b64: bytesToBase64(item) };
    if (item instanceof ArrayBuffer) return { __rz_b64: bytesToBase64(new Uint8Array(item)) };
    return item;
  });
}

function parseWire(value) {
  return JSON.parse(value, (_key, item) => {
    if (item && typeof item === "object" && typeof item.__rz_b64 === "string") {
      return base64ToBytes(item.__rz_b64);
    }
    return item;
  });
}

export class CloudConnection {
  constructor(url) {
    this.peer = "resenhazinha-cloud";
    this.open = false;
    this.closed = false;
    this.handlers = new Map();
    this.socket = new WebSocket(url);

    this.socket.addEventListener("open", () => {
      this.open = true;
      this.emit("open");
    });

    this.socket.addEventListener("message", (event) => {
      try {
        this.emit("data", parseWire(String(event.data || "")));
      } catch (error) {
        console.warn("[Resenhazinha Cloud] Pacote inválido.", error);
      }
    });

    this.socket.addEventListener("close", (event) => {
      this.open = false;
      this.closed = true;
      this.emit("close", event);
    });

    this.socket.addEventListener("error", (event) => this.emit("error", event));
  }

  on(event, handler) {
    const list = this.handlers.get(event) || [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event, value) {
    for (const handler of this.handlers.get(event) || []) {
      try {
        handler(value);
      } catch (error) {
        console.error(error);
      }
    }
  }

  send(payload) {
    if (!this.open || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("cloud-offline");
    }
    this.socket.send(stringifyWire(payload));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    try {
      this.socket.close(1000, "client-close");
    } catch {}
  }
}

export function createCloudOwnerKey() {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

export function sanitizeCloudOwnerKey(value) {
  const key = String(value || "").trim();
  return /^[a-z0-9-]{20,160}$/i.test(key) ? key : "";
}

export function buildCloudSocketUrl(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  return `${CLOUD_SERVER_WS}?${query.toString()}`;
}
