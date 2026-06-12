// -*- coding: utf-8 -*-

const SENSITIVE_KEY_PATTERN = /password|passwd|pwd|token|cookie|authorization|auth[_-]?header|session|secret|api[_-]?key|steam[_-]?api[_-]?key|rcon[_-]?password|rconpassword/i;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 200;
const MAX_DEPTH = 8;

export function sanitizeAuditValue(value, options = {}) {
  return sanitizeValue(value, 0, new WeakSet(), options);
}

export function sanitizeRconCommand(command) {
  const text = String(command ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  if (/password|token|apikey|api_key|authorization|cookie/i.test(text)) {
    return "[redacted-sensitive-command]";
  }

  const [name = "", ...args] = text.split(" ");
  if (!args.length) return clipString(name, 160);
  return clipString(`${name} ${args.map(maskLikelySecretArg).join(" ")}`, 240);
}

export function jsonStringifySafe(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify("[unserializable]");
  }
}

function sanitizeValue(value, depth, seen, options) {
  if (value == null) return value;
  if (typeof value === "string") return clipString(value, options.maxStringLength ?? MAX_STRING_LENGTH);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();

  if (depth >= (options.maxDepth ?? MAX_DEPTH)) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, options.maxArrayLength ?? MAX_ARRAY_LENGTH)
      .map((item) => sanitizeValue(item, depth + 1, seen, options));
  }

  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitizeValue(item, depth + 1, seen, options);
  }
  return output;
}

function maskLikelySecretArg(value) {
  const text = String(value ?? "");
  if (text.length >= 24 && /^[A-Za-z0-9+/=_-]+$/.test(text)) return "[redacted]";
  return text;
}

function clipString(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
