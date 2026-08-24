// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const PLUGIN_ID = "plugin.nzcd";
const DEFAULT_DATA_FILE = "data/nzcd/players.json";
const DEFAULT_MIN = 1;
const DEFAULT_MAX = 30;
const RECORD_TTL_MS = 12 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger = logger ?? core?.logger ?? console;
  const unsubscribers = [];
  let cleanupTimer = null;
  let writeQueue = Promise.resolve();
  let store = { version: 1, players: {} };
  let runtimeConfig = readConfig(config);

  const api = {
    getState() {
      cleanupExpiredRecords();
      return {
        ok: true,
        enabled: runtimeConfig.enabled,
        config: clone(runtimeConfig),
        players: Object.values(store.players).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      };
    },
    updateConfig(next = {}) {
      runtimeConfig = normalizeConfig({ ...runtimeConfig, ...next });
      return this.getState();
    },
    reloadConfig() {
      runtimeConfig = readConfig(config);
      return this.getState();
    },
  };

  async function start() {
    runtimeConfig = readConfig(config);
    await loadStore();
    cleanupExpiredRecords();
    cleanupTimer = setInterval(() => {
      if (cleanupExpiredRecords()) void persistStore();
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref?.();

    if (typeof modules?.chatManager?.on === "function") {
      unsubscribers.push(modules.chatManager.on("message", (event) => {
        void handleMessage(event);
      }));
    }
    pluginLogger?.info?.("[NZCD] started.");
  }

  async function stop() {
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
    for (const unsubscribe of unsubscribers.splice(0)) {
      try { unsubscribe?.(); } catch {}
    }
    await writeQueue.catch(() => {});
    pluginLogger?.info?.("[NZCD] stopped.");
  }

  async function handleMessage(event = {}) {
    const message = normalizeText(event.message);
    const isRefresh = /^sxnzcd$/i.test(message);
    if (!isRefresh && !/^nzcd$/i.test(message)) return;

    runtimeConfig = readConfig(config);
    if (!runtimeConfig.enabled || !isSubscribed()) return;

    const steamId = normalizeText(event.steamId ?? event.steamID);
    const eosId = normalizeText(event.eosId ?? event.eosID);
    const name = normalizeText(event.playerName ?? event.name);
    const key = resolvePlayerKey({ steamId, eosId, name });
    if (!key) return;

    cleanupExpiredRecords();
    const current = store.players[key];

    if (!isRefresh && current && isFresh(current)) {
      await broadcast(event, "[NZCD] " + (name || "玩家") + " 的牛子长度为 " + current.value + " cm。");
      return;
    }

    if (isRefresh) {
      const consumed = await consumeReserveDay(steamId, name);
      if (!consumed.ok) {
        await notify(event, consumed.message);
        return;
      }
    }

    const range = resolveRange(runtimeConfig, { steamId, eosId, name });
    const value = randomInteger(range.min, range.max);
    store.players[key] = {
      key, steamId, eosId, name, value, min: range.min, max: range.max,
      createdAt: current?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await persistStore();
    await broadcast(event, "[NZCD] " + (name || "玩家") + " 的牛子长度为 " + value + " cm。");
  }

  async function consumeReserveDay(steamId, name) {
    const reserve = modules?.reserveSlots;
    if (!reserve?.getState || !reserve?.upsertMember || !/^7656119\d{10}$/.test(steamId)) {
      return { ok: false, message: "无法识别玩家预留位，刷新牛子长度失败。" };
    }

    const state = await reserve.getState();
    const member = (state?.members ?? []).find((item) => String(item?.steamId ?? "").trim() === steamId);
    if (!member?.expireAt) return { ok: false, message: "你没有可消耗的预留位，无法刷新牛子长度。" };

    const expireAtMs = parseReserveDate(member.expireAt);
    if (!Number.isFinite(expireAtMs) || expireAtMs <= Date.now()) {
      return { ok: false, message: "你的预留位已过期，无法刷新牛子长度。" };
    }

    try {
      await reserve.upsertMember({
        steamId,
        name: name || member.name || "",
        group: member.group || "BZSSVIP",
        durationDays: -1,
        reason: "nzcd刷新牛子长度",
      });
      return { ok: true };
    } catch (error) {
      pluginLogger?.warn?.("[NZCD] reserve day consumption failed: " + (error?.message ?? error));
      return { ok: false, message: "预留位扣除失败，未刷新牛子长度。" };
    }
  }

  async function broadcast(event, message) {
    const fn = modules?.adminWarn?.broadcastMessage ?? modules?.adminWarn?.sendAdminBroadcast;
    if (typeof fn !== "function") return;
    await fn.call(modules.adminWarn, {
      sourceModule: PLUGIN_ID, reason: "nzcd", relatedEventId: event.id ?? event.eventId,
      message, system: true,
    });
  }

  async function notify(event, message) {
    const fn = modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn;
    if (typeof fn !== "function") return;
    await fn.call(modules.adminWarn, {
      sourceModule: PLUGIN_ID, reason: "nzcd_rejected",
      targetName: normalizeText(event.playerName ?? event.name) || "玩家",
      targetSteamId: normalizeText(event.steamId ?? event.steamID) || undefined,
      targetEosId: normalizeText(event.eosId ?? event.eosID) || undefined,
      message, system: true,
    });
  }

  function isSubscribed() {
    return core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  async function loadStore() {
    try {
      const raw = await fs.readFile(dataFilePath(), "utf8");
      const parsed = JSON.parse(raw);
      store = { version: 1, players: parsed?.players && typeof parsed.players === "object" ? parsed.players : {} };
    } catch (error) {
      if (error?.code !== "ENOENT") pluginLogger?.warn?.("[NZCD] load failed: " + error.message);
      store = { version: 1, players: {} };
    }
  }

  function persistStore() {
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      const filePath = dataFilePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(store, null, 2) + "\n", "utf8");
    });
    return writeQueue;
  }

  function cleanupExpiredRecords() {
    let changed = false;
    for (const [key, record] of Object.entries(store.players)) {
      if (!isFresh(record)) {
        delete store.players[key];
        changed = true;
      }
    }
    return changed;
  }

  function dataFilePath() {
    return path.resolve(process.cwd(), runtimeConfig.dataFile);
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "NZCD 娱乐插件",
      kind: "plugin",
      version: "1.0.0",
      category: "Entertainment",
      description: "响应 nzcd / sxnzcd，生成并广播玩家牛子长度；刷新时消耗一天预留位。",
      configSchema: [
        { key: "enabled", type: "boolean", default: true, description: "是否启用 NZCD" },
        { key: "defaultMin", type: "number", default: DEFAULT_MIN, description: "默认最小长度（厘米）" },
        { key: "defaultMax", type: "number", default: DEFAULT_MAX, description: "默认最大长度（厘米）" },
        { key: "ranges", type: "object", default: [], description: "玩家专属区间配置" },
        { key: "dataFile", type: "string", default: DEFAULT_DATA_FILE, description: "玩家记录文件" },
      ],
    },
    apiName: "nzcd",
    api,
    start,
    stop,
  };
}

function readConfig(config) {
  return normalizeConfig(config?.get?.("plugins." + PLUGIN_ID, {}) ?? {});
}

function normalizeConfig(value = {}) {
  let defaultMin = toInteger(value.defaultMin, DEFAULT_MIN);
  let defaultMax = toInteger(value.defaultMax, DEFAULT_MAX);
  defaultMin = Math.max(0, Math.min(defaultMin, 10000));
  defaultMax = Math.max(0, Math.min(defaultMax, 10000));
  if (defaultMax < defaultMin) [defaultMin, defaultMax] = [defaultMax, defaultMin];

  const ranges = Array.isArray(value.ranges)
    ? value.ranges.map((item) => ({
        playerKey: normalizeText(item?.playerKey ?? item?.steamId ?? item?.steamID),
        min: Math.max(0, Math.min(toInteger(item?.min, defaultMin), 10000)),
        max: Math.max(0, Math.min(toInteger(item?.max, defaultMax), 10000)),
        enabled: item?.enabled !== false,
      })).filter((item) => item.playerKey)
    : [];

  for (const range of ranges) {
    if (range.max < range.min) [range.min, range.max] = [range.max, range.min];
  }

  return {
    enabled: value.enabled !== false,
    defaultMin, defaultMax, ranges,
    dataFile: normalizeText(value.dataFile) || DEFAULT_DATA_FILE,
  };
}

function resolveRange(config, identity) {
  const keys = [identity.steamId, identity.eosId, identity.name]
    .map((value) => normalizeText(value).toLowerCase()).filter(Boolean);
  return (config.ranges ?? []).find((item) => item.enabled !== false && keys.includes(String(item.playerKey).toLowerCase()))
    ?? { min: config.defaultMin, max: config.defaultMax };
}

function resolvePlayerKey(identity) {
  const value = normalizeText(identity.steamId) || normalizeText(identity.eosId) || normalizeText(identity.name);
  return value ? value.toLowerCase() : "";
}

function isFresh(record) {
  const updated = Date.parse(record?.updatedAt ?? "");
  return Number.isFinite(updated) && Date.now() - updated < RECORD_TTL_MS;
}

function parseReserveDate(value) {
  const timestamp = Date.parse(String(value ?? "").trim().replace(" ", "T"));
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function randomInteger(min, max) {
  const lower = Math.ceil(Number(min) || 0);
  const upper = Math.floor(Number(max) || 0);
  if (upper <= lower) return lower;
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export default { createPlugin };
