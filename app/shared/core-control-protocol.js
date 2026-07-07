// -*- coding: utf-8 -*-

export const DEFAULT_CORE_CONTROL_HOST = "127.0.0.1";
export const DEFAULT_CORE_CONTROL_PORT = 12866;
export const DEFAULT_REQUEST_TIMEOUT_MS = 3000;

export function normalizeCoreControlConfig(config = {}, env = process.env) {
  const tokenEnvName = String(config.tokenFromEnv ?? "BZSS_CORE_TOKEN").trim() || "BZSS_CORE_TOKEN";
  const token = String(env?.[tokenEnvName] ?? config.token ?? "").trim();
  return {
    enabled: config.enabled !== false,
    host: String(config.host ?? DEFAULT_CORE_CONTROL_HOST).trim() || DEFAULT_CORE_CONTROL_HOST,
    port: normalizePort(config.port, DEFAULT_CORE_CONTROL_PORT),
    token,
    tokenFromEnv: tokenEnvName,
    requestTimeoutMs: normalizePositiveInteger(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    snapshotCacheTtlMs: normalizePositiveInteger(config.snapshotCacheTtlMs, 500),
    tacticalSnapshotCacheTtlMs: normalizePositiveInteger(config.tacticalSnapshotCacheTtlMs, 150),
    consoleRecentCacheTtlMs: normalizePositiveInteger(config.consoleRecentCacheTtlMs, 300),
    streamReconnectMs: normalizePositiveInteger(config.streamReconnectMs, 1000),
  };
}

export function buildCoreControlBaseUrl(config = {}) {
  const normalized = normalizeCoreControlConfig(config);
  return `http://${normalized.host}:${normalized.port}`;
}

export function buildCoreControlHeaders(config = {}) {
  const normalized = normalizeCoreControlConfig(config);
  const headers = {
    Accept: "application/json",
  };
  if (normalized.token) {
    headers.Authorization = `Bearer ${normalized.token}`;
  }
  return headers;
}

export function parseRevisionQuery(value) {
  const text = String(value ?? "").trim();
  if (!text) return {};
  const result = {};
  for (const part of text.split(",")) {
    const [keyRaw, valueRaw] = String(part).split(":");
    const key = String(keyRaw ?? "").trim();
    const revision = Number(valueRaw ?? "");
    if (!key || !Number.isFinite(revision)) continue;
    result[key] = Math.max(0, Math.floor(revision));
  }
  return result;
}

export function formatRevisionQuery(revisions = {}) {
  return Object.entries(revisions)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([key, value]) => `${key}:${Math.max(0, Math.floor(Number(value)))}`)
    .join(",");
}

export function normalizePort(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return fallback;
  return Math.floor(parsed);
}

export function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function createJsonResponse(res, statusCode, payload, extraHeaders = {}) {
  const body = payload == null ? "" : JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  };
  res.writeHead(statusCode, headers);
  res.end(body);
}

export async function readJsonRequestBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let totalLength = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLength += buffer.length;
    if (totalLength > maxBytes) {
      const error = new Error("Request body too large.");
      error.statusCode = 413;
      error.code = "RequestBodyTooLarge";
      throw error;
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks, totalLength).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    error.code = "InvalidJson";
    throw error;
  }
}

export function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

