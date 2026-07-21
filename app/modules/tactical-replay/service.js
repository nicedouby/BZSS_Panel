// -*- coding: utf-8 -*-

import http from "node:http";
import { createTacticalReplayStore } from "./store.js";

const config = readProcessConfig();
const host = String(config.host ?? "127.0.0.1");
const port = Number(config.port ?? 12766);
const store = createTacticalReplayStore({
  ...config,
  logger: {
    info(message) { sendDiagnostic("info", message); },
    warn(message) { sendDiagnostic("warn", message); },
    error(message) { sendDiagnostic("error", message); },
  },
});

let stopping = false;
let operationChain = Promise.resolve();

await store.start();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, Number(error?.statusCode ?? 500), {
      error: error?.code ?? "ReplayServiceError",
      message: error?.message ?? String(error),
    });
  });
});

server.keepAliveTimeout = 5_000;
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, resolve);
});

process.send?.({ type: "ready", pid: process.pid, host, port, status: store.getStatus() });
sendDiagnostic("info", `Tactical replay service listening on http://${host}:${port}`);

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "sample-players") {
    enqueue(() => store.ingestPlayerSample(message.payload));
    return;
  }
  if (message.type === "sample-assets") {
    enqueue(() => store.ingestAssetSample(message.payload));
    return;
  }
  if (message.type === "shutdown") {
    void shutdown(message.reason ?? "parent-stop");
  }
});

process.on("disconnect", () => void shutdown("parent-disconnect"));
process.on("SIGTERM", () => void shutdown("sigterm"));
process.on("SIGINT", () => void shutdown("sigint"));

async function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "MethodNotAllowed", message: "Only GET is supported." });
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, pid: process.pid });
    return;
  }
  if (url.pathname === "/api/tactical-state/replay/status" || url.pathname === "/status") {
    sendJson(res, 200, { ok: true, status: store.getStatus(), process: { pid: process.pid, host, port } });
    return;
  }

  const normalizedPath = url.pathname.startsWith("/api/tactical-state")
    ? url.pathname.slice("/api/tactical-state".length)
    : url.pathname;
  if (normalizedPath !== "/replays" && !normalizedPath.startsWith("/replays/")) {
    sendJson(res, 404, { error: "ReplayRouteNotFound", message: "Unknown tactical replay service route." });
    return;
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length === 1) {
    const result = await store.listSessions({
      limit: parsePositiveInteger(url.searchParams.get("limit"), 100, 1000),
      includeLegacy: url.searchParams.get("includeLegacy") === "1",
    });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  const sessionId = decodePathSegment(segments[1]);
  if (segments.length === 2) {
    const session = await store.getSession(sessionId);
    if (!session) {
      sendJson(res, 404, { error: "ReplaySessionNotFound", message: "Replay session was not found." });
      return;
    }
    sendJson(res, 200, { ok: true, session });
    return;
  }

  if (segments.length === 3 && (segments[2] === "window" || segments[2] === "frames")) {
    const fromMs = parseNonNegativeNumber(url.searchParams.get("from"), 0);
    const requestedToMs = parseOptionalNonNegativeNumber(url.searchParams.get("to"));
    const durationMs = requestedToMs == null
      ? parsePositiveInteger(url.searchParams.get("duration"), 6_000, 15_000)
      : Math.max(500, Math.min(15_000, requestedToMs - fromMs));
    const result = await store.readWindow(sessionId, {
      fromMs,
      durationMs,
      contextMs: parseNonNegativeNumber(url.searchParams.get("contextMs"), 1_000),
      includeContext: url.searchParams.get("context") !== "0",
      limit: parsePositiveInteger(url.searchParams.get("limit"), 3_000, 10_000),
    });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  sendJson(res, 404, { error: "ReplayRouteNotFound", message: "Unknown tactical replay service route." });
}

function enqueue(task) {
  operationChain = operationChain.then(task, task).catch((error) => {
    sendDiagnostic("error", error?.stack ?? error?.message ?? String(error));
  });
  return operationChain;
}

async function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  try {
    await operationChain;
    await store.stop(reason);
    await new Promise((resolve) => server.close(resolve));
  } finally {
    process.exit(0);
  }
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent || res.writableEnded) return;
  const text = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "X-Tactical-Replay-Process": String(process.pid),
  });
  res.end(text);
}

function sendDiagnostic(level, message) {
  const payload = { type: "diagnostic", level, message: String(message ?? ""), at: new Date().toISOString() };
  if (process.connected) process.send?.(payload);
  else if (level === "error") console.error(payload.message);
  else console.log(payload.message);
}

function readProcessConfig() {
  try {
    return JSON.parse(String(process.env.BZSS_TACTICAL_REPLAY_CONFIG ?? "{}"));
  } catch {
    return {};
  }
}

function parsePositiveInteger(value, fallback, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(numeric)));
}

function parseNonNegativeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function parseOptionalNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function decodePathSegment(value) {
  try { return decodeURIComponent(String(value ?? "")); } catch { return String(value ?? ""); }
}
