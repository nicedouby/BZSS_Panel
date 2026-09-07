import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const port = Number(process.env.PORT ?? 39080);
const options = {
  target: process.env.COMBAT_WS_URL ?? "ws://127.0.0.1:8899/ws/combat",
  token: process.env.BZSS_COMBAT_WS_TOKEN ?? "",
  client: process.env.COMBAT_WS_CLIENT ?? "bzss-protocol-test-client",
  autoAck: true,
  autoPong: true,
  reconnect: true,
  ackDelayMs: 0,
};
const state = { connected: false, authenticated: false, reconnects: 0, received: 0, acked: 0, errors: [], messages: [] };
let ws = null;
let reconnectTimer = null;

function remember(direction, value) {
  state.messages.unshift({ at: new Date().toISOString(), direction, value });
  state.messages.splice(500);
}

function send(value) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  const wire = typeof value === "string" ? value : JSON.stringify(value);
  ws.send(wire);
  remember("out", wire);
  return true;
}

function connect() {
  clearTimeout(reconnectTimer);
  if (typeof WebSocket !== "function") {
    state.errors.unshift("This test client requires Node.js 22+ with global WebSocket support.");
    return;
  }
  try { ws?.close(); } catch {}
  ws = new WebSocket(options.target);
  ws.addEventListener("open", () => {
    state.connected = true;
    state.authenticated = false;
    send({ t: "hello", v: 1, token: options.token, client: options.client });
  });
  ws.addEventListener("message", (event) => {
    state.received += 1;
    remember("in", String(event.data));
    let message;
    try { message = JSON.parse(String(event.data)); } catch { state.errors.unshift("Invalid server JSON"); return; }
    if (message.t === "welcome") state.authenticated = true;
    if (message.t === "ping" && options.autoPong) send({ t: "pong", v: 1, ts: Date.now() });
    if ((message.t === "cb" || message.t === "mf") && options.autoAck) {
      setTimeout(() => {
        if (send({ t: "ack", v: 1, pid: message.pid, mid: message.mid })) state.acked += 1;
      }, Math.max(0, Number(options.ackDelayMs) || 0));
    }
  });
  ws.addEventListener("error", () => state.errors.unshift("WebSocket connection error"));
  ws.addEventListener("close", (event) => {
    state.connected = false;
    state.authenticated = false;
    remember("system", `closed ${event.code} ${event.reason}`);
    if (options.reconnect) {
      state.reconnects += 1;
      reconnectTimer = setTimeout(connect, 1500);
    }
  });
}

async function readBody(req) {
  let value = "";
  for await (const chunk of req) value += chunk;
  return value ? JSON.parse(value) : {};
}

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/state") return json(res, 200, { options: { ...options, token: options.token ? "***" : "" }, state });
  if (url.pathname === "/api/options" && req.method === "POST") {
    Object.assign(options, await readBody(req));
    options.ackDelayMs = Math.max(0, Number(options.ackDelayMs) || 0);
    connect();
    return json(res, 200, { ok: true, options: { ...options, token: options.token ? "***" : "" } });
  }
  if (url.pathname === "/api/protocol-error" && req.method === "POST") {
    const body = await readBody(req);
    return json(res, send(body.raw ?? "{broken json") ? 200 : 409, { ok: state.connected });
  }
  if (url.pathname === "/api/reconnect" && req.method === "POST") { connect(); return json(res, 200, { ok: true }); }
  if (url.pathname === "/api/export") return json(res, 200, { exportedAt: new Date().toISOString(), options: { ...options, token: "***" }, state }, { "content-disposition": "attachment; filename=combat-ws-export.json" });
  const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[\w./-]+$/.test(relative) || relative.includes("..")) return json(res, 404, { error: "NotFound" });
  try {
    const file = await fs.readFile(path.join(root, relative));
    const type = relative.endsWith(".js") ? "text/javascript" : relative.endsWith(".css") ? "text/css" : "text/html";
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    res.end(file);
  } catch { json(res, 404, { error: "NotFound" }); }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Combat WS test client: http://127.0.0.1:${port}`);
  connect();
});
