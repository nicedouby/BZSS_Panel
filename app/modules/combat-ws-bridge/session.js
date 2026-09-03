import crypto from "node:crypto";
import { COMBAT_WS_VERSION } from "./protocol.js";

function equalSecret(actual, expected) {
  const a = crypto.createHash("sha256").update(String(actual ?? "")).digest();
  const b = crypto.createHash("sha256").update(String(expected ?? "")).digest();
  return crypto.timingSafeEqual(a, b);
}

export class CombatWsSession {
  constructor({ transport, token, authTimeoutMs = 5000, heartbeatIntervalMs = 15000, heartbeatTimeoutMs = 45000, onAuthenticated, onAck, onClose }) {
    this.transport = transport;
    this.token = token;
    this.onAuthenticated = onAuthenticated;
    this.onAck = onAck;
    this.onClose = onClose;
    this.clientId = null;
    this.authenticated = false;
    this.closed = false;
    this.lastPongAt = Date.now();
    this.authTimer = setTimeout(() => this.close(4001, "Authentication timeout"), authTimeoutMs);
    this.heartbeat = setInterval(() => {
      if (!this.authenticated || this.closed) return;
      if (Date.now() - this.lastPongAt > heartbeatTimeoutMs) return this.close(4008, "Heartbeat timeout");
      this.send({ t: "ping", v: COMBAT_WS_VERSION, ts: Date.now() });
    }, heartbeatIntervalMs);
    transport.onMessage((message) => this.handle(message));
    transport.onClose(() => this.finish());
  }

  handle(raw) {
    let message;
    try { message = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return this.close(4002, "Invalid JSON"); }
    if (!this.authenticated) {
      if (message?.t !== "hello" || message?.v !== COMBAT_WS_VERSION || !String(message?.client ?? "").trim()) return this.close(4002, "Expected hello v1");
      if (!equalSecret(message.token, this.token)) return this.close(4003, "Authentication failed");
      clearTimeout(this.authTimer);
      this.clientId = String(message.client).trim().slice(0, 128);
      this.authenticated = true;
      this.lastPongAt = Date.now();
      this.send({ t: "welcome", v: COMBAT_WS_VERSION, client: this.clientId, ts: Date.now() });
      this.onAuthenticated?.(this);
      return;
    }
    if (message?.t === "pong" && message?.v === COMBAT_WS_VERSION) this.lastPongAt = Date.now();
    else if (message?.t === "ack" && message?.v === COMBAT_WS_VERSION) this.onAck?.(this, message);
    else if (message?.t === "ping") this.send({ t: "pong", v: COMBAT_WS_VERSION, ts: Date.now() });
    else this.send({ t: "error", v: COMBAT_WS_VERSION, code: "unsupported_message" });
  }

  send(value) {
    if (!this.closed) this.transport.sendText(JSON.stringify(value));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.authTimer);
    clearInterval(this.heartbeat);
    this.transport.close(code, reason);
    this.onClose?.(this);
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.authTimer);
    clearInterval(this.heartbeat);
    this.onClose?.(this);
  }
}
