// -*- coding: utf-8 -*-

import net from "node:net";
import { createDatabase } from "../../core/database.js";

const IP_API_FIELDS = "status,message,country,regionName,city,isp,org,as,timezone,lat,lon,proxy,hosting,query";

function now() {
  return Date.now();
}

function cleanIp(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.replace(/^\[(.*)\]$/, "$1");
}

function normalizeResult(ip, patch = {}) {
  return {
    ip,
    source: "unknown",
    provider: "none",
    country: "",
    region: "",
    city: "",
    isp: "",
    org: "",
    asn: "",
    timezone: "",
    latitude: null,
    longitude: null,
    isPrivate: false,
    isProxy: null,
    isHosting: null,
    updatedAt: 0,
    error: "",
    stale: false,
    ...patch,
  };
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (!version) return false;

  if (version === 4) {
    const octets = ip.split(".").map((part) => Number(part));
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [first, second] = octets;
    if (first === 10) return true;
    if (first === 127) return true;
    if (first === 169 && second === 254) return true;
    if (first === 192 && second === 168) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    return false;
  }

  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("::ffff:")) {
    const tail = lower.slice("::ffff:".length);
    if (net.isIP(tail) === 4) return isPrivateIp(tail);
  }

  const firstGroup = lower.split(":", 1)[0] ?? "";
  if (!firstGroup) return false;
  if (firstGroup === "fc" || firstGroup === "fd") return true;
  if (firstGroup.startsWith("fc") || firstGroup.startsWith("fd")) return true;
  if (firstGroup.startsWith("fe8") || firstGroup.startsWith("fe9") || firstGroup.startsWith("fea") || firstGroup.startsWith("feb")) {
    return true;
  }
  return false;
}

function isFresh(updatedAt, ttlMs) {
  return Number(updatedAt ?? 0) > 0 && (now() - Number(updatedAt ?? 0)) < ttlMs;
}

function parseStoredResult(row) {
  if (!row) return null;
  return normalizeResult(row.ip, {
    provider: row.provider ?? "none",
    source: row.source ?? "unknown",
    country: row.country ?? "",
    region: row.region ?? "",
    city: row.city ?? "",
    isp: row.isp ?? "",
    org: row.org ?? "",
    asn: row.asn ?? "",
    timezone: row.timezone ?? "",
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    isPrivate: Boolean(row.is_private),
    isProxy: row.is_proxy == null ? null : Boolean(row.is_proxy),
    isHosting: row.is_hosting == null ? null : Boolean(row.is_hosting),
    updatedAt: Number(row.updated_at ?? 0),
    error: "",
    stale: false,
  });
}

function toDbPayload(result) {
  return [
    result.ip,
    result.provider ?? "none",
    result.source ?? "unknown",
    result.country ?? "",
    result.region ?? "",
    result.city ?? "",
    result.isp ?? "",
    result.org ?? "",
    result.asn ?? "",
    result.timezone ?? "",
    result.latitude == null ? null : Number(result.latitude),
    result.longitude == null ? null : Number(result.longitude),
    result.isPrivate ? 1 : 0,
    result.isProxy == null ? null : result.isProxy ? 1 : 0,
    result.isHosting == null ? null : result.isHosting ? 1 : 0,
    Number(result.updatedAt ?? now()),
    JSON.stringify(result.rawJson ?? {}),
  ];
}

function fromManualEntry(ip, entry = {}) {
  const latitude = entry.latitude == null ? null : Number(entry.latitude);
  const longitude = entry.longitude == null ? null : Number(entry.longitude);
  return normalizeResult(ip, {
    source: "provider",
    provider: "manual",
    country: String(entry.country ?? ""),
    region: String(entry.region ?? ""),
    city: String(entry.city ?? ""),
    isp: String(entry.isp ?? ""),
    org: String(entry.org ?? ""),
    asn: String(entry.asn ?? ""),
    timezone: String(entry.timezone ?? ""),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    isPrivate: Boolean(entry.isPrivate),
    isProxy: entry.isProxy == null ? null : Boolean(entry.isProxy),
    isHosting: entry.isHosting == null ? null : Boolean(entry.isHosting),
    updatedAt: now(),
    rawJson: entry,
  });
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || `Request failed (${response.status})`);
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function lookupIpApi(ip, timeoutMs) {
  const url = `https://ip-api.com/json/${encodeURIComponent(ip)}?fields=${encodeURIComponent(IP_API_FIELDS)}`;
  const payload = await fetchJson(url, timeoutMs);
  if (payload?.status !== "success") {
    throw new Error(payload?.message || "ip-api lookup failed");
  }
  return normalizeResult(ip, {
    source: "provider",
    provider: "ip-api",
    country: String(payload.country ?? ""),
    region: String(payload.regionName ?? ""),
    city: String(payload.city ?? ""),
    isp: String(payload.isp ?? ""),
    org: String(payload.org ?? ""),
    asn: String(payload.as ?? ""),
    timezone: String(payload.timezone ?? ""),
    latitude: payload.lat == null ? null : Number(payload.lat),
    longitude: payload.lon == null ? null : Number(payload.lon),
    isPrivate: false,
    isProxy: payload.proxy == null ? null : Boolean(payload.proxy),
    isHosting: payload.hosting == null ? null : Boolean(payload.hosting),
    updatedAt: now(),
    rawJson: payload,
  });
}

async function lookupIpInfo(ip, timeoutMs, token = "") {
  const url = token
    ? `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`
    : `https://ipinfo.io/${encodeURIComponent(ip)}/json`;
  const payload = await fetchJson(url, timeoutMs);
  const [latitude, longitude] = String(payload.loc ?? "").split(",").map((part) => Number(part));
  return normalizeResult(ip, {
    source: "provider",
    provider: "ipinfo",
    country: String(payload.country ?? ""),
    region: String(payload.region ?? ""),
    city: String(payload.city ?? ""),
    isp: String(payload.org ?? ""),
    org: String(payload.org ?? ""),
    asn: String(payload.asn ?? payload.org ?? ""),
    timezone: String(payload.timezone ?? ""),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    isPrivate: Boolean(payload.bogon),
    isProxy: null,
    isHosting: null,
    updatedAt: now(),
    rawJson: payload,
  });
}

export function createIpLookupModule({ config, logger }) {
  const moduleLogger = logger ?? config?.logger ?? console;
  let db = null;
  let cacheTtlMs = 7 * 24 * 60 * 60 * 1000;
  let requestTimeoutMs = 3000;
  let provider = "none";

  function readProviderConfig() {
    provider = String(config.get("ipLookup.provider", "none") ?? "none").trim().toLowerCase() || "none";
    const cacheTtlHours = Number(config.get("ipLookup.cacheTtlHours", 168));
    const timeoutMs = Number(config.get("ipLookup.requestTimeoutMs", 3000));
    cacheTtlMs = Math.max(1, Number.isFinite(cacheTtlHours) ? cacheTtlHours : 168) * 60 * 60 * 1000;
    requestTimeoutMs = Math.max(500, Number.isFinite(timeoutMs) ? timeoutMs : 3000);
  }

  async function ensureDb() {
    if (db) return db;
    db = await createDatabase(config.get("database", config.get("modules.playerDatabase.database", {})));
    return db;
  }

  async function getCachedRow(ip) {
    const database = await ensureDb();
    return database.get("SELECT * FROM ip_lookup_cache WHERE ip = ?", ip);
  }

  async function upsertCache(result) {
    const database = await ensureDb();
    await database.run(
      `INSERT INTO ip_lookup_cache (
         ip, provider, source, country, region, city, isp, org, asn, timezone,
         latitude, longitude, is_private, is_proxy, is_hosting, updated_at, raw_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET
         provider = excluded.provider,
         source = excluded.source,
         country = excluded.country,
         region = excluded.region,
         city = excluded.city,
         isp = excluded.isp,
         org = excluded.org,
         asn = excluded.asn,
         timezone = excluded.timezone,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         is_private = excluded.is_private,
         is_proxy = excluded.is_proxy,
         is_hosting = excluded.is_hosting,
         updated_at = excluded.updated_at,
         raw_json = excluded.raw_json`,
      ...toDbPayload(result),
    );
  }

  async function lookupViaProvider(ip) {
    const manualEntries = config.get("ipLookup.manualEntries", {}) ?? {};
    if (provider === "manual") {
      const manualEntry = manualEntries?.[ip];
      if (manualEntry) return fromManualEntry(ip, manualEntry);
      throw new Error("Manual provider has no entry for this IP.");
    }

    if (provider === "local-mmdb") {
      throw new Error("Local MMDB provider is not configured.");
    }

    if (provider === "ip-api") {
      return lookupIpApi(ip, requestTimeoutMs);
    }

    if (provider === "ipinfo") {
      return lookupIpInfo(ip, requestTimeoutMs, String(config.get("ipLookup.ipinfoToken", "") ?? ""));
    }

    throw new Error(`Unsupported IP lookup provider: ${provider}`);
  }

  async function lookupSingle(ipInput) {
    const ip = cleanIp(ipInput);
    if (!ip) {
      return normalizeResult(String(ipInput ?? ""), {
        source: "invalid",
        provider: "none",
        error: "Empty IP value.",
      });
    }

    const version = net.isIP(ip);
    if (!version) {
      return normalizeResult(ip, {
        source: "invalid",
        provider: "none",
        error: "Invalid IP address.",
      });
    }

    if (isPrivateIp(ip)) {
      const result = normalizeResult(ip, {
        source: "private",
        provider: "none",
        isPrivate: true,
        country: "",
        region: "",
        city: "",
        isp: "",
        org: "",
        asn: "",
        timezone: "",
        latitude: null,
        longitude: null,
        updatedAt: now(),
        rawJson: {},
      });
      await upsertCache(result);
      return result;
    }

    const cachedRow = await getCachedRow(ip);
    const cached = parseStoredResult(cachedRow);
    if (cached && isFresh(cached.updatedAt, cacheTtlMs)) {
      return normalizeResult(ip, { ...cached, source: "cache", stale: false });
    }

    if (provider === "none") {
      const result = cached
        ? normalizeResult(ip, { ...cached, source: cachedRow ? "cache_stale" : "unknown", stale: Boolean(cachedRow && !isFresh(cached.updatedAt, cacheTtlMs)) })
        : normalizeResult(ip, {
            source: "unknown",
            provider: "none",
            error: "IP lookup provider is disabled.",
          });
      if (!cached) {
        await upsertCache(result);
      }
      return result;
    }

    try {
      const providerResult = await lookupViaProvider(ip);
      await upsertCache(providerResult);
      return providerResult;
    } catch (error) {
      moduleLogger?.warn?.("IP lookup provider failed; falling back to cache if available.", {
        operation: "lookupIp",
        data: { ip, provider, error: error?.message ?? String(error) },
      });
      if (cached) {
        return normalizeResult(ip, {
          ...cached,
          source: "cache_stale",
          stale: true,
          error: error?.message ?? "Provider lookup failed.",
        });
      }
      return normalizeResult(ip, {
        source: "unknown",
        provider,
        error: error?.message ?? "Provider lookup failed.",
      });
    }
  }

  async function lookupMany(ips = []) {
    const items = {};
    const uniqueIps = [...new Set((Array.isArray(ips) ? ips : []).map((value) => cleanIp(value)).filter(Boolean))];
    for (const ip of uniqueIps) {
      items[ip] = await lookupSingle(ip);
    }
    return items;
  }

  async function getCached(ipInput) {
    const ip = cleanIp(ipInput);
    if (!ip) return null;
    const cached = parseStoredResult(await getCachedRow(ip));
    if (!cached) return null;
    return normalizeResult(ip, {
      ...cached,
      source: isFresh(cached.updatedAt, cacheTtlMs) ? "cache" : "cache_stale",
      stale: !isFresh(cached.updatedAt, cacheTtlMs),
    });
  }

  async function clearExpiredCache() {
    const database = await ensureDb();
    const cutoff = now() - cacheTtlMs;
    const result = await database.run("DELETE FROM ip_lookup_cache WHERE updated_at > 0 AND updated_at < ?", cutoff);
    return Number(result?.changes ?? 0);
  }

  readProviderConfig();

  return {
    manifest: {
      id: "module.ipLookup",
      name: "IP Lookup Module",
      kind: "module",
      version: "0.1.0",
      description: "轻量 IP 解析与缓存模块。基于本地缓存和可配置 provider 返回 IP 地理与网络归属信息。",
    },
    apiName: "ipLookup",
    api: {
      lookupIp: lookupSingle,
      lookupMany,
      getCached,
      clearExpiredCache,
    },

    async init() {
      await ensureDb();
    },

    async start() {
      await clearExpiredCache();
      moduleLogger?.info?.("IP lookup module ready.", {
        operation: "start",
        data: { provider, cacheTtlMs, requestTimeoutMs },
      });
    },

    async stop() {
      if (db?.close) {
        await db.close();
      }
      db = null;
    },
  };
}
