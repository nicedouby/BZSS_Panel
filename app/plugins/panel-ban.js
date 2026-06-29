// -*- coding: utf-8 -*-

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const PLUGIN_ID = "panelBan";
const PAGE_ROUTE = "/plugins/panel-ban";
const DEFAULT_DATA_DIR = "./data/plugins/panel-ban";
const DEFAULT_DATA_FILE = "bans.json";
const DEFAULT_CACHE_MS = 5_000;
const DEFAULT_RETRY_COOLDOWN_MS = 30_000;
const MAX_RECENT_EVENTS = 50;
const MAX_RECENT_HITS = 20;
const STATUS_ACTIVE = "active";
const STATUS_DISABLED = "disabled";
const STATUS_EXPIRED = "expired";

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text || fallback;
}

function normalizeSteamID(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const digits = text.match(/^\d{17}$/)?.[0] ?? text.match(/\d{17}/)?.[0] ?? "";
  return digits;
}

function normalizeIdentityKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeStatus(value, fallback = STATUS_ACTIVE) {
  const text = normalizeText(value, fallback).toLowerCase();
  if (text === STATUS_DISABLED || text === STATUS_EXPIRED || text === STATUS_ACTIVE) return text;
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function toIsoDateTime(value) {
  if (value == null || value === "") return "";
  const text = String(value).trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function parseDurationPayload(input = {}) {
  const rawText = normalizeText(input.durationText);
  if (rawText) {
    const match = rawText.match(/^(\d+(?:\.\d+)?)\s*([smhdw])$/i);
    if (!match) return 0;
    const amount = Number(match[1] ?? 0);
    const unit = String(match[2] ?? "").toLowerCase();
    const unitMs = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 7 * 86_400_000,
    }[unit] ?? 0;
    return Math.max(0, Math.floor(amount * unitMs));
  }

  const amount = Number(input.durationValue ?? input.duration ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const unit = normalizeText(input.durationUnit, "days").toLowerCase();
  const unitMs = {
    minute: 60_000,
    minutes: 60_000,
    m: 60_000,
    hour: 3_600_000,
    hours: 3_600_000,
    h: 3_600_000,
    day: 86_400_000,
    days: 86_400_000,
    d: 86_400_000,
    week: 7 * 86_400_000,
    weeks: 7 * 86_400_000,
    w: 7 * 86_400_000,
  }[unit] ?? 86_400_000;
  return Math.max(0, Math.floor(amount * unitMs));
}

function resolveExpiresAt(input = {}, referenceMs = Date.now()) {
  const direct = toIsoDateTime(input.expiresAt ?? input.expireAt ?? input.until ?? "");
  if (direct) return direct;

  const durationMs = parseDurationPayload(input);
  if (durationMs > 0) {
    return new Date(referenceMs + durationMs).toISOString();
  }

  return "";
}

function isExpiredNow(entry, referenceMs = Date.now()) {
  if (!entry?.expiresAt) return false;
  const expiresAtMs = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= referenceMs;
}

function makeEntryIdentityText(entry) {
  return [entry.steamID, entry.eosID, entry.name].filter(Boolean).join(" / ");
}

function makeKickReason(entry) {
  const reason = normalizeText(entry.reason, "no reason provided");
  const expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : null;
  const expiresLabel = expiresAt && !Number.isNaN(expiresAt.getTime())
    ? expiresAt.toLocaleString()
    : "unknown";
  return `Panel Ban: ${reason}; expires at ${expiresLabel}`;
}

function buildEventDetail(detail = {}) {
  return {
    id: `${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)}`,
    at: nowIso(),
    kind: normalizeText(detail.kind, "info"),
    ...detail,
  };
}

function compareEntriesForView(left, right) {
  const statusWeight = (entry) => {
    if (entry.status === STATUS_ACTIVE) return 0;
    if (entry.status === STATUS_DISABLED) return 1;
    return 2;
  };

  const leftWeight = statusWeight(left);
  const rightWeight = statusWeight(right);
  if (leftWeight !== rightWeight) return leftWeight - rightWeight;

  const leftExpiry = Date.parse(left.expiresAt ?? "");
  const rightExpiry = Date.parse(right.expiresAt ?? "");
  if (Number.isFinite(leftExpiry) && Number.isFinite(rightExpiry) && leftExpiry !== rightExpiry) {
    return leftExpiry - rightExpiry;
  }

  const leftUpdated = Date.parse(left.updatedAt ?? "");
  const rightUpdated = Date.parse(right.updatedAt ?? "");
  if (Number.isFinite(leftUpdated) && Number.isFinite(rightUpdated) && leftUpdated !== rightUpdated) {
    return rightUpdated - leftUpdated;
  }

  return String(left.id ?? "").localeCompare(String(right.id ?? ""), "zh-CN");
}

function cloneEntry(entry, referenceMs = Date.now()) {
  const expiresAtMs = Date.parse(entry.expiresAt ?? "");
  const expiresInMs = Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - referenceMs) : 0;
  const effectiveExpired = isExpiredNow(entry, referenceMs);
  const effectiveStatus = entry.status === STATUS_DISABLED
    ? STATUS_DISABLED
    : effectiveExpired
      ? STATUS_EXPIRED
      : STATUS_ACTIVE;

  return {
    id: entry.id,
    steamID: entry.steamID,
    eosID: entry.eosID,
    name: entry.name,
    reason: entry.reason,
    expiresAt: entry.expiresAt,
    status: effectiveStatus,
    createdAt: entry.createdAt,
    createdBy: entry.createdBy,
    updatedAt: entry.updatedAt,
    hitCount: entry.hitCount,
    lastHitAt: entry.lastHitAt,
    lastHitPlayerName: entry.lastHitPlayerName,
    lastHitServerId: entry.lastHitServerId,
    lastHitMatchType: entry.lastHitMatchType,
    lastHitMatchValue: entry.lastHitMatchValue,
    identityText: makeEntryIdentityText(entry),
    isExpired: effectiveStatus === STATUS_EXPIRED,
    isDisabled: effectiveStatus === STATUS_DISABLED,
    isActive: effectiveStatus === STATUS_ACTIVE,
    expiresInMs,
    expiresInLabel: formatDuration(expiresInMs),
  };
}

function formatDuration(ms) {
  const value = Math.max(0, Math.floor(Number(ms) || 0));
  if (!value) return "0s";
  const second = 1_000;
  const minute = 60 * second;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (value < minute) return `${Math.max(1, Math.ceil(value / second))}s`;
  if (value < hour) return `${Math.ceil(value / minute)}m`;
  if (value < day) return `${Math.ceil(value / hour)}h`;
  return `${Math.ceil(value / day)}d`;
}

function normalizeStoredEntry(raw = {}) {
  const steamID = normalizeSteamID(raw.steamID ?? raw.steamId ?? raw.steam64ID ?? raw.steam64Id ?? "");
  const eosID = normalizeText(raw.eosID ?? raw.eosId ?? "");
  const name = normalizeText(raw.name ?? raw.playerName ?? "");
  const reason = normalizeText(raw.reason ?? raw.note ?? "");
  const expiresAt = toIsoDateTime(raw.expiresAt ?? raw.expireAt ?? raw.until ?? "");
  if (!expiresAt) return null;
  if (!steamID && !eosID && !name) return null;

  const createdAt = toIsoDateTime(raw.createdAt) || nowIso();
  const updatedAt = toIsoDateTime(raw.updatedAt) || createdAt;
  const status = normalizeStatus(raw.status, STATUS_ACTIVE);
  return {
    id: normalizeText(raw.id) || crypto.randomUUID(),
    steamID,
    eosID,
    name,
    reason,
    expiresAt,
    status,
    createdAt,
    createdBy: normalizeText(raw.createdBy),
    updatedAt,
    hitCount: Math.max(0, Math.floor(Number(raw.hitCount ?? 0) || 0)),
    lastHitAt: toIsoDateTime(raw.lastHitAt) || "",
    lastHitPlayerName: normalizeText(raw.lastHitPlayerName),
    lastHitServerId: normalizeText(raw.lastHitServerId),
    lastHitMatchType: normalizeText(raw.lastHitMatchType),
    lastHitMatchValue: normalizeText(raw.lastHitMatchValue),
  };
}

function normalizeIdentity(input = {}) {
  return {
    steamID: normalizeSteamID(input.steamID ?? input.steamId ?? input.steam64ID ?? input.steam64Id ?? ""),
    eosID: normalizeText(input.eosID ?? input.eosId ?? ""),
    name: normalizeText(input.name ?? input.playerName ?? ""),
  };
}

function buildIdentityKey(identity = {}) {
  const steamID = normalizeSteamID(identity.steamID ?? identity.steam64ID ?? identity.steamId ?? "");
  if (steamID) return `steam:${steamID}`;
  const eosID = normalizeText(identity.eosID ?? identity.eosId ?? "");
  if (eosID) return `eos:${normalizeIdentityKey(eosID)}`;
  const name = normalizeText(identity.name ?? identity.playerName ?? "");
  if (name) return `name:${normalizeIdentityKey(name)}`;
  return "";
}

function matchesEntry(entry, identity = {}) {
  const steamID = normalizeSteamID(identity.steamID ?? identity.steam64ID ?? identity.steamId ?? "");
  if (steamID && entry.steamID && normalizeIdentityKey(entry.steamID) === normalizeIdentityKey(steamID)) {
    return { matchType: "steamID", matchValue: entry.steamID };
  }

  const eosID = normalizeText(identity.eosID ?? identity.eosId ?? "");
  if (eosID && entry.eosID && normalizeIdentityKey(entry.eosID) === normalizeIdentityKey(eosID)) {
    return { matchType: "eosID", matchValue: entry.eosID };
  }

  const name = normalizeText(identity.name ?? identity.playerName ?? "");
  if (name && entry.name && normalizeIdentityKey(entry.name) === normalizeIdentityKey(name)) {
    return { matchType: "name", matchValue: entry.name };
  }

  return null;
}

function resolveTargetEntry(entries, identity = {}, referenceMs = Date.now()) {
  let best = null;

  for (const entry of entries) {
    const active = entry.status !== STATUS_DISABLED && !isExpiredNow(entry, referenceMs);
    if (!active) continue;

    const match = matchesEntry(entry, identity);
    if (!match) continue;

    const score = match.matchType === "steamID" ? 3 : match.matchType === "eosID" ? 2 : 1;
    if (
      !best
      || score > best.score
      || (score === best.score && Date.parse(entry.createdAt ?? "") > Date.parse(best.entry.createdAt ?? ""))
    ) {
      best = {
        score,
        entry,
        ...match,
      };
    }
  }

  return best;
}

function readRuntimeConfig(config) {
  const raw = config?.get?.(`plugins.${PLUGIN_ID}`, {}) ?? {};
  return {
    enabled: raw.enabled !== false,
    dataDir: normalizeText(raw.dataDir, DEFAULT_DATA_DIR),
    cacheMs: Math.max(0, Number(raw.cacheMs ?? DEFAULT_CACHE_MS) || DEFAULT_CACHE_MS),
    retryCooldownMs: Math.max(1_000, Number(raw.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS) || DEFAULT_RETRY_COOLDOWN_MS),
    matchNameFallback: raw.matchNameFallback !== false,
  };
}

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger ??
    core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "module",
    }) ??
    core?.logger ??
    console;

  const unsubscribers = [];
  const serial = {
    promise: Promise.resolve(),
  };
  const runtime = {
    loadedAt: 0,
    filePath: "",
    entries: [],
    actedKeys: new Set(),
    failureCooldowns: new Map(),
    recentHits: [],
    recentEvents: [],
    snapshotFingerprints: new Map(),
  };
  const state = {
    enabled: true,
    subscribed: true,
    dataDir: DEFAULT_DATA_DIR,
    filePath: "",
    cacheMs: DEFAULT_CACHE_MS,
    retryCooldownMs: DEFAULT_RETRY_COOLDOWN_MS,
    matchNameFallback: true,
    lastLoadedAt: "",
    lastScanAt: "",
    lastKickAt: "",
    lastError: "",
    kickAttempts: 0,
    kickSuccess: 0,
    kickFailed: 0,
    lastMatch: null,
  };

  function enqueue(task) {
    const next = serial.promise.then(task, task);
    serial.promise = next.catch(() => {});
    return next;
  }

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(`plugin.${PLUGIN_ID}`) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(`plugin.${PLUGIN_ID}`) !== false;
  }

  function isActive() {
    return Boolean(state.enabled) && isSubscribed();
  }

  function pushRecentEvent(kind, detail = {}) {
    runtime.recentEvents.unshift(buildEventDetail({ kind, ...detail }));
    if (runtime.recentEvents.length > MAX_RECENT_EVENTS) {
      runtime.recentEvents.length = MAX_RECENT_EVENTS;
    }
  }

  function ensureEntriesSorted() {
    runtime.entries.sort(compareEntriesForView);
  }

  function invalidateSnapshotFingerprints() {
    runtime.snapshotFingerprints.clear();
  }

  function updateSummary() {
    let active = 0;
    let disabled = 0;
    let expired = 0;

    for (const entry of runtime.entries) {
      const effectiveStatus = entry.status === STATUS_DISABLED
        ? STATUS_DISABLED
        : isExpiredNow(entry)
          ? STATUS_EXPIRED
          : STATUS_ACTIVE;
      if (effectiveStatus === STATUS_ACTIVE) active += 1;
      else if (effectiveStatus === STATUS_DISABLED) disabled += 1;
      else expired += 1;
    }

    state.activeEntries = active;
    state.disabledEntries = disabled;
    state.expiredEntries = expired;
    state.totalEntries = runtime.entries.length;
  }

  function refreshExpiredEntries(nowMs = Date.now(), persist = true) {
    let changed = false;

    for (const entry of runtime.entries) {
      if (entry.status === STATUS_DISABLED) continue;
      if (!isExpiredNow(entry, nowMs)) continue;
      if (entry.status !== STATUS_EXPIRED) {
        entry.status = STATUS_EXPIRED;
        entry.updatedAt = nowIso();
        changed = true;
        pushRecentEvent("entry_expired", {
          entryId: entry.id,
          name: entry.name,
          steamID: entry.steamID,
          eosID: entry.eosID,
          expiresAt: entry.expiresAt,
        });
      }
    }

    if (changed) {
      updateSummary();
      if (persist) {
        void saveStore("expiry").catch((error) => {
          state.lastError = error instanceof Error ? error.message : String(error);
          pluginLogger?.warn?.(`[PanelBan] failed to persist expiry updates: ${state.lastError}`);
        });
      }
    }

    return changed;
  }

  function snapshotEntry(entry) {
    return cloneEntry(entry);
  }

  function snapshotState() {
    refreshExpiredEntries(Date.now(), true);
    ensureEntriesSorted();
    updateSummary();

    return {
      enabled: state.enabled,
      subscribed: state.subscribed,
      dataDir: state.dataDir,
      filePath: state.filePath,
      cacheMs: state.cacheMs,
      retryCooldownMs: state.retryCooldownMs,
      matchNameFallback: state.matchNameFallback,
      lastLoadedAt: state.lastLoadedAt,
      lastScanAt: state.lastScanAt,
      lastKickAt: state.lastKickAt,
      lastError: state.lastError,
      kickAttempts: state.kickAttempts,
      kickSuccess: state.kickSuccess,
      kickFailed: state.kickFailed,
      totalEntries: state.totalEntries ?? runtime.entries.length,
      activeEntries: state.activeEntries ?? 0,
      disabledEntries: state.disabledEntries ?? 0,
      expiredEntries: state.expiredEntries ?? 0,
      lastMatch: state.lastMatch ? { ...state.lastMatch } : null,
      entries: runtime.entries.map((entry) => snapshotEntry(entry)),
      recentHits: runtime.recentHits.map((item) => ({ ...item })),
      recentEvents: runtime.recentEvents.map((item) => ({ ...item })),
    };
  }

  async function saveStore(reason = "manual") {
    if (!state.filePath) return snapshotState();

    const filePath = state.filePath;
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({
      version: 1,
      updatedAt: nowIso(),
      reason,
      entries: runtime.entries.map((entry) => ({ ...entry })),
    }, null, 2);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rm(filePath, { force: true }).catch(() => {});
    await fs.rename(tmpPath, filePath);
    state.lastLoadedAt = nowIso();
    state.lastError = "";
    return snapshotState();
  }

  async function loadStore(force = false) {
    const runtimeConfig = readRuntimeConfig(config);
    state.enabled = runtimeConfig.enabled;
    state.dataDir = runtimeConfig.dataDir;
    state.cacheMs = runtimeConfig.cacheMs;
    state.retryCooldownMs = runtimeConfig.retryCooldownMs;
    state.matchNameFallback = runtimeConfig.matchNameFallback;
    state.subscribed = isSubscribed();

    const resolvedDir = path.resolve(process.cwd(), state.dataDir);
    const filePath = path.join(resolvedDir, DEFAULT_DATA_FILE);
    state.filePath = filePath;
    runtime.filePath = filePath;

    if (!force && runtime.loadedAt && Date.now() - runtime.loadedAt < state.cacheMs) {
      return snapshotState();
    }

    let loadedEntries = [];
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : [];
      loadedEntries = entries.map((entry) => normalizeStoredEntry(entry)).filter(Boolean);
      state.lastError = "";
    } catch (error) {
      if (error?.code !== "ENOENT") {
        state.lastError = error instanceof Error ? error.message : String(error);
        pushRecentEvent("load_error", { error: state.lastError });
        pluginLogger?.warn?.(`[PanelBan] failed to load ban list: ${state.lastError}`);
      }
    }

    runtime.entries = loadedEntries;
    runtime.loadedAt = Date.now();
    invalidateSnapshotFingerprints();
    updateSummary();
    ensureEntriesSorted();
    refreshExpiredEntries(Date.now(), true);
    state.lastLoadedAt = nowIso();
    pushRecentEvent("loaded", {
      filePath,
      entries: runtime.entries.length,
    });
    return snapshotState();
  }

  function findEntryById(id) {
    const targetId = normalizeText(id);
    if (!targetId) return null;
    return runtime.entries.find((entry) => entry.id === targetId) ?? null;
  }

  function normalizeMutationPayload(input = {}) {
    const identity = normalizeIdentity(input);
    const expiresAt = resolveExpiresAt(input);
    if (!expiresAt) {
      const error = new Error("expiresAt is required.");
      error.code = "InvalidBanExpiry";
      error.statusCode = 400;
      throw error;
    }

    if (!identity.steamID && !identity.eosID && !identity.name) {
      const error = new Error("At least one identity field is required.");
      error.code = "InvalidBanIdentity";
      error.statusCode = 400;
      throw error;
    }

    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      const error = new Error("expiresAt is invalid.");
      error.code = "InvalidBanExpiry";
      error.statusCode = 400;
      throw error;
    }

    return {
      ...identity,
      reason: normalizeText(input.reason),
      expiresAt,
      status: normalizeStatus(input.status, STATUS_ACTIVE),
    };
  }

  async function createEntry(input = {}, actor = null) {
    const normalized = normalizeMutationPayload(input);
    const now = nowIso();
    const entry = {
      id: normalizeText(input.id) || crypto.randomUUID(),
      steamID: normalized.steamID,
      eosID: normalized.eosID,
      name: normalized.name,
      reason: normalized.reason,
      expiresAt: normalized.expiresAt,
      status: normalized.status,
      createdAt: now,
      createdBy: normalizeText(input.createdBy ?? actor?.username ?? actor?.name ?? input.operatorName ?? "system"),
      updatedAt: now,
      hitCount: 0,
      lastHitAt: "",
      lastHitPlayerName: "",
      lastHitServerId: "",
      lastHitMatchType: "",
      lastHitMatchValue: "",
    };

    if (entry.status !== STATUS_DISABLED && isExpiredNow(entry)) {
      entry.status = STATUS_EXPIRED;
    }

    runtime.entries.push(entry);
    invalidateSnapshotFingerprints();
    ensureEntriesSorted();
    updateSummary();
    await saveStore("create");
    pushRecentEvent("entry_created", {
      entryId: entry.id,
      name: entry.name,
      steamID: entry.steamID,
      eosID: entry.eosID,
      expiresAt: entry.expiresAt,
      status: entry.status,
    });
    return snapshotEntry(entry);
  }

  async function updateEntry(id, input = {}, actor = null) {
    const entry = findEntryById(id);
    if (!entry) {
      const error = new Error(`Ban entry not found: ${id}`);
      error.code = "BanEntryNotFound";
      error.statusCode = 404;
      throw error;
    }

    const nextIdentity = normalizeIdentity(input);
    const expiresAt = input.expiresAt || input.durationValue || input.durationText || input.duration ? resolveExpiresAt(input) : entry.expiresAt;
    const nextExpiresAt = toIsoDateTime(expiresAt);
    if (!nextExpiresAt) {
      const error = new Error("expiresAt is required.");
      error.code = "InvalidBanExpiry";
      error.statusCode = 400;
      throw error;
    }

    const nextReason = Object.prototype.hasOwnProperty.call(input, "reason")
      ? normalizeText(input.reason)
      : entry.reason;

    const nextStatus = Object.prototype.hasOwnProperty.call(input, "status")
      ? normalizeStatus(input.status, entry.status)
      : (entry.status === STATUS_DISABLED ? STATUS_DISABLED : entry.status);

    const nextCreatedBy = Object.prototype.hasOwnProperty.call(input, "createdBy")
      ? normalizeText(input.createdBy)
      : entry.createdBy;

    if (!nextIdentity.steamID && !nextIdentity.eosID && !nextIdentity.name && !entry.steamID && !entry.eosID && !entry.name) {
      const error = new Error("At least one identity field is required.");
      error.code = "InvalidBanIdentity";
      error.statusCode = 400;
      throw error;
    }

    entry.steamID = nextIdentity.steamID || entry.steamID;
    entry.eosID = nextIdentity.eosID || entry.eosID;
    entry.name = nextIdentity.name || entry.name;
    entry.reason = nextReason;
    entry.expiresAt = nextExpiresAt;
    entry.status = nextStatus;
    entry.createdBy = nextCreatedBy;
    entry.updatedAt = nowIso();

    if (entry.status !== STATUS_DISABLED && isExpiredNow(entry)) {
      entry.status = STATUS_EXPIRED;
    } else if (entry.status === STATUS_EXPIRED && !isExpiredNow(entry) && !Object.prototype.hasOwnProperty.call(input, "status")) {
      entry.status = STATUS_ACTIVE;
    }

    invalidateSnapshotFingerprints();
    ensureEntriesSorted();
    updateSummary();
    await saveStore("update");
    pushRecentEvent("entry_updated", {
      entryId: entry.id,
      name: entry.name,
      steamID: entry.steamID,
      eosID: entry.eosID,
      expiresAt: entry.expiresAt,
      status: entry.status,
    });
    return snapshotEntry(entry);
  }

  async function deleteEntry(id, actor = null) {
    const index = runtime.entries.findIndex((entry) => entry.id === normalizeText(id));
    if (index < 0) {
      const error = new Error(`Ban entry not found: ${id}`);
      error.code = "BanEntryNotFound";
      error.statusCode = 404;
      throw error;
    }

    const [removed] = runtime.entries.splice(index, 1);
    invalidateSnapshotFingerprints();
    updateSummary();
    await saveStore("delete");
    pushRecentEvent("entry_deleted", {
      entryId: removed.id,
      name: removed.name,
      steamID: removed.steamID,
      eosID: removed.eosID,
      expiresAt: removed.expiresAt,
      deletedBy: normalizeText(actor?.username ?? actor?.name ?? "system"),
    });
    return snapshotEntry(removed);
  }

  function releaseOfflinePlayers(players = []) {
    const onlineKeys = new Set();
    for (const player of Array.isArray(players) ? players : []) {
      const key = buildIdentityKey(player);
      if (key) onlineKeys.add(key);
    }

    for (const key of [...runtime.actedKeys]) {
      if (!onlineKeys.has(key)) runtime.actedKeys.delete(key);
    }

    const now = Date.now();
    for (const [key, expireAt] of runtime.failureCooldowns.entries()) {
      if (expireAt <= now || !onlineKeys.has(key)) {
        runtime.failureCooldowns.delete(key);
      }
    }
  }

  function rememberRecentHit(entry, player, match, serverId) {
    const event = buildEventDetail({
      kind: "kick_success",
      entryId: entry.id,
      entryName: entry.name,
      playerName: normalizeText(player?.name),
      steamID: normalizeText(player?.steamID ?? player?.steam64ID),
      eosID: normalizeText(player?.eosID),
      matchType: match.matchType,
      matchValue: match.matchValue,
      serverId,
      reason: entry.reason,
      expiresAt: entry.expiresAt,
    });
    runtime.recentHits.unshift(event);
    if (runtime.recentHits.length > MAX_RECENT_HITS) runtime.recentHits.length = MAX_RECENT_HITS;
    pushRecentEvent("match", event);
  }

  async function kickMatchedPlayer(serverId, player, match) {
    const squadManagement = modules?.squadManagement;
    const kickReason = makeKickReason(match.entry);
    if (
      typeof squadManagement?.requestKick !== "function"
      && typeof squadManagement?.kick !== "function"
      && typeof squadManagement?.executeAction !== "function"
    ) {
      state.lastError = "squadManagement kick API unavailable";
      pushRecentEvent("kick_unavailable", {
        serverId,
        playerName: normalizeText(player?.name),
        steamID: normalizeText(player?.steamID ?? player?.steam64ID),
        eosID: normalizeText(player?.eosID),
        entryId: match.entry.id,
        matchType: match.matchType,
      });
      pluginLogger?.warn?.("[PanelBan] squadManagement kick API unavailable.");
      return;
    }

    const request = {
      serverId,
      steamId: normalizeSteamID(player?.steamID ?? player?.steam64ID),
      eosId: normalizeText(player?.eosID),
      name: normalizeText(player?.name),
      reason: kickReason,
      source: `plugin.${PLUGIN_ID}`,
      system: true,
    };

    state.kickAttempts += 1;
    state.lastMatch = {
      playerName: request.name,
      steamID: request.steamId,
      eosID: request.eosId,
      entryId: match.entry.id,
      matchType: match.matchType,
      matchValue: match.matchValue,
      at: nowIso(),
      reason: match.entry.reason,
      expiresAt: match.entry.expiresAt,
    };
    pushRecentEvent("match", {
      serverId,
      playerName: request.name,
      steamID: request.steamId,
      eosID: request.eosId,
      entryId: match.entry.id,
      matchType: match.matchType,
      matchValue: match.matchValue,
    });

    const result = typeof squadManagement.requestKick === "function"
      ? await squadManagement.requestKick(request)
      : typeof squadManagement.kick === "function"
        ? await squadManagement.kick(request)
        : await squadManagement.executeAction({ ...request, type: "kick_player" });

    if (result?.ok) {
      const key = buildIdentityKey(player);
      if (key) runtime.actedKeys.add(key);
      state.kickSuccess += 1;
      state.lastKickAt = nowIso();
      state.lastError = "";
      match.entry.hitCount += 1;
      match.entry.lastHitAt = state.lastKickAt;
      match.entry.lastHitPlayerName = request.name;
      match.entry.lastHitServerId = serverId;
      match.entry.lastHitMatchType = match.matchType;
      match.entry.lastHitMatchValue = match.matchValue;
      match.entry.updatedAt = state.lastKickAt;
      await saveStore("hit");
      rememberRecentHit(match.entry, player, match, serverId);
      pluginLogger?.info?.(`[PanelBan] kicked ${request.name || request.steamId || request.eosId} by ${match.matchType} match.`);
      return;
    }

    const failureKey = buildIdentityKey(player);
    if (failureKey) {
      runtime.failureCooldowns.set(failureKey, Date.now() + state.retryCooldownMs);
    }
    state.kickFailed += 1;
    state.lastError = String(result?.error ?? result?.message ?? "kick failed");
    pushRecentEvent("kick_failed", {
      serverId,
      playerName: request.name,
      steamID: request.steamId,
      eosID: request.eosId,
      entryId: match.entry.id,
      matchType: match.matchType,
      error: state.lastError,
    });
    pluginLogger?.warn?.(`[PanelBan] failed to kick ${request.name || request.steamId || request.eosId}: ${state.lastError}`);
  }

  function snapshotFingerprint(serverId, players = []) {
    return [
      normalizeText(serverId),
      ...players.map((player) => buildIdentityKey(player)).filter(Boolean).sort(),
    ].join("|");
  }

  async function processPlayersSnapshot(event = {}) {
    if (!isActive()) return;

    const serverId = normalizeText(event?.serverId ?? core?.webStatus?.serverId ?? "");
    if (!serverId) return;

    const players = Array.isArray(event?.players)
      ? event.players
      : modules?.playerState?.getPlayerList?.(serverId) ?? [];

    const signature = snapshotFingerprint(serverId, players);
    if (runtime.snapshotFingerprints.get(serverId) === signature) {
      return;
    }
    runtime.snapshotFingerprints.set(serverId, signature);

    state.lastScanAt = nowIso();
    pushRecentEvent("scan", {
      serverId,
      playersScanned: players.length,
    });

    refreshExpiredEntries(Date.now(), true);
    releaseOfflinePlayers(players);
    ensureEntriesSorted();

    const matchedEntries = [];
    for (const player of players) {
      const key = buildIdentityKey(player);
      if (!key) continue;
      if (runtime.actedKeys.has(key)) continue;

      const cooldownUntil = Number(runtime.failureCooldowns.get(key) || 0) || 0;
      if (cooldownUntil > Date.now()) continue;

      const match = resolveTargetEntry(runtime.entries, player, Date.now());
      if (!match) continue;
      matchedEntries.push(match.entry.id);
      await kickMatchedPlayer(serverId, player, match);
    }

    state.lastScanEntries = matchedEntries;
  }

  function getEntries(filter = {}) {
    refreshExpiredEntries(Date.now(), true);
    ensureEntriesSorted();

    const statusFilter = normalizeText(filter.status, "all").toLowerCase();
    const search = normalizeText(filter.search).toLowerCase();
    const includeExpired = filter.includeExpired !== false;
    const now = Date.now();

    return runtime.entries
      .map((entry) => snapshotEntry(entry))
      .filter((entry) => {
        if (!includeExpired && entry.status === STATUS_EXPIRED) return false;
        if (statusFilter !== "all" && entry.status !== statusFilter) return false;
        if (!search) return true;
        const haystack = [
          entry.id,
          entry.steamID,
          entry.eosID,
          entry.name,
          entry.reason,
          entry.createdBy,
          entry.lastHitPlayerName,
          entry.lastHitServerId,
          entry.lastHitMatchType,
          entry.lastHitMatchValue,
        ].join(" ").toLowerCase();
        return haystack.includes(search);
      })
      .map((entry) => ({
        ...entry,
        expiresInLabel: formatDuration(Math.max(0, Date.parse(entry.expiresAt ?? "") - now)),
      }));
  }

  function resolveBanMatchByIdentity(identity = {}) {
    refreshExpiredEntries(Date.now(), true);
    const match = resolveTargetEntry(runtime.entries, identity, Date.now());
    if (!match) return null;
    return {
      matched: true,
      entry: snapshotEntry(match.entry),
      matchType: match.matchType,
      matchValue: match.matchValue,
      identityKey: buildIdentityKey(identity),
      visibleReason: makeKickReason(match.entry),
    };
  }

  const api = {
    getState() {
      state.subscribed = isSubscribed();
      return snapshotState();
    },

    listEntries(filter = {}) {
      return getEntries(filter);
    },

    async load() {
      return loadStore(true);
    },

    async reload() {
      const loaded = await loadStore(true);
      invalidateSnapshotFingerprints();
      await processPlayersSnapshot({
        serverId: core?.webStatus?.serverId ?? "",
        players: modules?.playerState?.getPlayerList?.(core?.webStatus?.serverId ?? "") ?? [],
      });
      return loaded;
    },

    async rescan(serverId = core?.webStatus?.serverId ?? "") {
      invalidateSnapshotFingerprints();
      await processPlayersSnapshot({
        serverId,
        players: modules?.playerState?.getPlayerList?.(serverId) ?? [],
      });
      return snapshotState();
    },

    async createEntry(input = {}) {
      return createEntry(input, input.actor ?? input.user ?? null);
    },

    async updateEntry(id, input = {}) {
      return updateEntry(id, input, input.actor ?? input.user ?? null);
    },

    async deleteEntry(id, input = {}) {
      return deleteEntry(id, input.actor ?? input.user ?? null);
    },

    getEntry(id) {
      const entry = findEntryById(id);
      return entry ? snapshotEntry(entry) : null;
    },

    findBanMatchByIdentity(identity = {}) {
      return resolveBanMatchByIdentity(identity);
    },
  };

  return {
    manifest: {
      id: `plugin.${PLUGIN_ID}`,
      name: "Panel Ban",
      kind: "plugin",
      version: "1.0.0",
      description: "管理全局面板封禁列表，按 Steam64 / EOS / 名称命中后在玩家进服时自动踢出，并记录到期时间与命中历史。",
      configSchema: [
        {
          key: `plugins.${PLUGIN_ID}.enabled`,
          type: "boolean",
          default: true,
          description: "是否启用面板封禁插件",
        },
        {
          key: `plugins.${PLUGIN_ID}.dataDir`,
          type: "string",
          default: DEFAULT_DATA_DIR,
          description: "封禁列表数据目录",
        },
        {
          key: `plugins.${PLUGIN_ID}.cacheMs`,
          type: "number",
          default: DEFAULT_CACHE_MS,
          description: "封禁列表缓存毫秒数",
        },
        {
          key: `plugins.${PLUGIN_ID}.retryCooldownMs`,
          type: "number",
          default: DEFAULT_RETRY_COOLDOWN_MS,
          description: "踢出失败后的重复尝试冷却毫秒数",
        },
        {
          key: `plugins.${PLUGIN_ID}.matchNameFallback`,
          type: "boolean",
          default: true,
          description: "是否允许名称作为回退命中条件",
        },
      ],
    },
    apiName: "panelBan",
    api,

    async init() {
      await loadStore(true);
    },

    async start() {
      await loadStore(true);

      if (!state.enabled) {
        pluginLogger?.info?.("[PanelBan] plugin disabled by config.");
        return;
      }

      core?.webRegistry?.registerPage?.({
        id: "web.panelBan",
        title: "面板封禁",
        group: "插件",
        route: PAGE_ROUTE,
        pageModule: "/pages/panel-ban.js",
        source: `plugin.${PLUGIN_ID}`,
        description: "维护全局面板封禁列表，并在玩家进服时自动检查与踢出。",
        required: false,
        enabled: true,
        order: 138,
        icon: "BAN",
      });

      if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent(
          "module.playerState",
          "playersSnapshotUpdated",
          (event) => enqueue(() => processPlayersSnapshot(event)),
        ));
      }

      if (typeof core?.eventBus?.onCoreEvent === "function") {
        unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", (event) => {
          void enqueue(() => processPlayersSnapshot(event));
        }));
      }

      await enqueue(() => processPlayersSnapshot({
        serverId: core?.webStatus?.serverId ?? "",
        players: modules?.playerState?.getPlayerList?.(core?.webStatus?.serverId ?? "") ?? [],
      }));

      pushRecentEvent("plugin_started", {
        serverId: core?.webStatus?.serverId ?? "",
      });
      pluginLogger?.info?.("[PanelBan] plugin started.");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      runtime.actedKeys.clear();
      runtime.failureCooldowns.clear();
      runtime.recentEvents.length = 0;
      runtime.recentHits.length = 0;
      runtime.snapshotFingerprints.clear();
      pluginLogger?.info?.("[PanelBan] plugin stopped.");
    },
  };
}
