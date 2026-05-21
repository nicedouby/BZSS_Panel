// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const DATA_ROOT = path.resolve(process.cwd(), "data/server-info-statistics");
const SAMPLE_POLL_INTERVAL_MS = 1000;
const PERSIST_DEBOUNCE_MS = 1500;

export function createPlugin({ core, modules }) {
  const timers = [];
  const unsubscribers = [];
  const dayCache = new Map(); // key => day record
  const saveTimers = new Map(); // key => timeout
  const lastSignatureByServer = new Map();
  const lastRecordedDayByServer = new Map();
  let started = false;

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("plugin.serverInfoStatistics") !== false
      && core.pluginSubscriptions?.isSubscribed?.("plugin.serverInfoStatistics") !== false;
  }

  function getServerId() {
    return String(core.webStatus?.serverId ?? "BZSS_Main").trim() || "BZSS_Main";
  }

  function currentDateKey(date = new Date()) {
    const value = new Date(date);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function sanitizeSegment(value) {
    return String(value ?? "")
      .trim()
      .replace(/[/\\:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      || "default";
  }

  function getDayFilePath(serverId, dateKey) {
    return path.join(DATA_ROOT, sanitizeSegment(serverId), `${dateKey}.json`);
  }

  function createEmptyDay(serverId, dateKey) {
    return {
      serverId,
      date: dateKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      samples: [],
      summary: {
        sampleCount: 0,
        firstAt: null,
        lastAt: null,
        latest: null,
        playerCountMin: null,
        playerCountMax: null,
        playerCountAvg: null,
        queueCountMin: null,
        queueCountMax: null,
        queueCountAvg: null,
        tpsMin: null,
        tpsMax: null,
        tpsAvg: null,
      },
    };
  }

  function normalizeNumber(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeText(value) {
    const text = String(value ?? "").trim();
    return text || "";
  }

  function getMatchStateSnapshot() {
    return modules?.matchState?.getState?.()
      ?? modules?.matchState?.getOverview?.()?.matchState
      ?? null;
  }

  function getServerStatus() {
    const matchState = getMatchStateSnapshot();
    if (matchState?.serverStatus) {
      return {
        serverStatus: matchState.serverStatus,
        matchState,
      };
    }

    const overview = modules?.matchState?.getOverview?.() ?? null;
    const status = overview?.serverStatus ?? overview?.matchState?.serverStatus ?? null;
    return {
      serverStatus: status,
      matchState: overview?.matchState ?? matchState,
    };
  }

  function buildSample() {
    const { serverStatus, matchState } = getServerStatus();
    if (!serverStatus) return null;

    const now = new Date();
    const recordedAt = serverStatus.lastUpdatedAt || matchState?.updatedAt || now.toISOString();
    const sample = {
      at: normalizeTimestamp(recordedAt) || now.toISOString(),
      sourceAt: normalizeTimestamp(serverStatus.lastUpdatedAt) || normalizeTimestamp(matchState?.updatedAt) || null,
      serverId: getServerId(),
      playerCount: normalizeNumber(serverStatus.playerCount),
      queueCount: normalizeNumber(serverStatus.queueCount),
      tps: normalizeNumber(serverStatus.tps),
      tpsStatus: normalizeText(serverStatus.tpsStatus || "unknown") || "unknown",
      maxPlayers: normalizeNumber(serverStatus.maxPlayers),
      map: normalizeText(serverStatus.map),
      layer: normalizeText(serverStatus.layer),
      mode: normalizeText(serverStatus.mode),
      matchState: normalizeText(serverStatus.matchState || matchState?.match?.mode || ""),
    };

    return sample;
  }

  function sampleSignature(sample) {
    return [
      sample.serverId,
      sample.playerCount ?? "",
      sample.queueCount ?? "",
      sample.tps ?? "",
      sample.maxPlayers ?? "",
      sample.map,
      sample.layer,
      sample.mode,
      sample.matchState,
    ].join("|");
  }

  function hasUsefulValues(sample) {
    return [
      sample.playerCount,
      sample.queueCount,
      sample.tps,
      sample.maxPlayers,
      sample.map,
      sample.layer,
      sample.mode,
    ].some((value) => value != null && String(value).trim() !== "");
  }

  async function loadDay(serverId, dateKey) {
    const cacheKey = `${serverId}::${dateKey}`;
    const cached = dayCache.get(cacheKey);
    if (cached) return cached;

    const fallback = createEmptyDay(serverId, dateKey);
    try {
      const text = await fs.readFile(getDayFilePath(serverId, dateKey), "utf8");
      const parsed = JSON.parse(text);
      const loaded = normalizeDayRecord(parsed, serverId, dateKey, fallback);
      dayCache.set(cacheKey, loaded);
      return loaded;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        core.logger?.warn?.(`[ServerInfoStatistics] load day failed: ${error.message}`);
      }
      dayCache.set(cacheKey, fallback);
      return fallback;
    }
  }

  function normalizeDayRecord(parsed, serverId, dateKey, fallback) {
    const samples = Array.isArray(parsed?.samples) ? parsed.samples.map(normalizeSample).filter(Boolean) : [];
    const day = {
      ...fallback,
      serverId: normalizeText(parsed?.serverId) || serverId,
      date: normalizeText(parsed?.date) || dateKey,
      createdAt: normalizeTimestamp(parsed?.createdAt) || fallback.createdAt,
      updatedAt: normalizeTimestamp(parsed?.updatedAt) || fallback.updatedAt,
      samples,
    };
    day.summary = buildSummary(day.samples);
    return day;
  }

  function normalizeSample(sample) {
    if (!sample || typeof sample !== "object") return null;
    const normalized = {
      at: normalizeTimestamp(sample.at) || normalizeTimestamp(sample.sourceAt) || new Date().toISOString(),
      sourceAt: normalizeTimestamp(sample.sourceAt) || null,
      serverId: normalizeText(sample.serverId),
      playerCount: normalizeNumber(sample.playerCount),
      queueCount: normalizeNumber(sample.queueCount),
      tps: normalizeNumber(sample.tps),
      tpsStatus: normalizeText(sample.tpsStatus || "unknown") || "unknown",
      maxPlayers: normalizeNumber(sample.maxPlayers),
      map: normalizeText(sample.map),
      layer: normalizeText(sample.layer),
      mode: normalizeText(sample.mode),
      matchState: normalizeText(sample.matchState),
    };

    if (!normalized.serverId) normalized.serverId = getServerId();
    return normalized;
  }

  function normalizeTimestamp(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    const time = Date.parse(text);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }

  function buildSummary(samples) {
    const summary = {
      sampleCount: samples.length,
      firstAt: samples[0]?.at ?? null,
      lastAt: samples[samples.length - 1]?.at ?? null,
      latest: samples[samples.length - 1] ?? null,
      playerCountMin: null,
      playerCountMax: null,
      playerCountAvg: null,
      queueCountMin: null,
      queueCountMax: null,
      queueCountAvg: null,
      tpsMin: null,
      tpsMax: null,
      tpsAvg: null,
    };

    const playerValues = samples.map((sample) => sample.playerCount).filter((value) => Number.isFinite(value));
    const queueValues = samples.map((sample) => sample.queueCount).filter((value) => Number.isFinite(value));
    const tpsValues = samples.map((sample) => sample.tps).filter((value) => Number.isFinite(value));

    if (playerValues.length) {
      summary.playerCountMin = Math.min(...playerValues);
      summary.playerCountMax = Math.max(...playerValues);
      summary.playerCountAvg = roundMetric(playerValues.reduce((acc, value) => acc + value, 0) / playerValues.length);
    }
    if (queueValues.length) {
      summary.queueCountMin = Math.min(...queueValues);
      summary.queueCountMax = Math.max(...queueValues);
      summary.queueCountAvg = roundMetric(queueValues.reduce((acc, value) => acc + value, 0) / queueValues.length);
    }
    if (tpsValues.length) {
      summary.tpsMin = roundMetric(Math.min(...tpsValues));
      summary.tpsMax = roundMetric(Math.max(...tpsValues));
      summary.tpsAvg = roundMetric(tpsValues.reduce((acc, value) => acc + value, 0) / tpsValues.length);
    }

    return summary;
  }

  function roundMetric(value) {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  }

  async function persistDay(serverId, dateKey) {
    const day = await loadDay(serverId, dateKey);
    day.updatedAt = new Date().toISOString();
    day.summary = buildSummary(day.samples);

    const filePath = getDayFilePath(serverId, dateKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(day, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, filePath);
  }

  function queuePersist(serverId, dateKey) {
    const key = `${serverId}::${dateKey}`;
    const existing = saveTimers.get(key);
    if (existing) clearTimeout(existing);

    saveTimers.set(key, setTimeout(() => {
      saveTimers.delete(key);
      persistDay(serverId, dateKey).catch((error) => {
        core.logger?.warn?.(`[ServerInfoStatistics] persist failed: ${error.message}`);
      });
    }, PERSIST_DEBOUNCE_MS));
  }

  async function ensureLoadedForToday(serverId) {
    const today = currentDateKey();
    const day = await loadDay(serverId, today);
    const lastSample = day.samples[day.samples.length - 1] ?? null;
    if (lastSample) {
      lastSignatureByServer.set(serverId, sampleSignature(lastSample));
      lastRecordedDayByServer.set(serverId, today);
    }
    return day;
  }

  async function captureSnapshot({ force = false } = {}) {
    if (!isSubscribed()) return null;

    const sample = buildSample();
    if (!sample) return null;
    if (!force && !sample.sourceAt && !hasUsefulValues(sample)) return null;

    const dateKey = currentDateKey(sample.at);
    const day = await loadDay(sample.serverId, dateKey);
    const signature = sampleSignature(sample);
    const lastDay = lastRecordedDayByServer.get(sample.serverId);

    if (!force && day.samples.length > 0 && lastSignatureByServer.get(sample.serverId) === signature && lastDay === dateKey) {
      return null;
    }

    if (!day.samples.length && !hasUsefulValues(sample) && !force) {
      return null;
    }

    day.samples.push(sample);
    day.summary = buildSummary(day.samples);
    day.updatedAt = sample.at;
    lastSignatureByServer.set(sample.serverId, signature);
    lastRecordedDayByServer.set(sample.serverId, dateKey);
    queuePersist(sample.serverId, dateKey);
    return sample;
  }

  async function getAvailableDates(serverId = getServerId()) {
    const fromCache = [...dayCache.values()]
      .filter((day) => day.serverId === serverId && /^\d{4}-\d{2}-\d{2}$/u.test(day.date))
      .map((day) => day.date);
    const dir = path.join(DATA_ROOT, sanitizeSegment(serverId));
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return [...new Set([
        ...fromCache,
        ...entries
          .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/u.test(entry.name))
          .map((entry) => entry.name.replace(/\.json$/u, "")),
      ])]
        .sort();
    } catch (error) {
      if (error?.code !== "ENOENT") {
        core.logger?.warn?.(`[ServerInfoStatistics] scan dates failed: ${error.message}`);
      }
      return [...new Set(fromCache)].sort();
    }
  }

  async function getState({ serverId = getServerId(), date = "" } = {}) {
    const availableDates = await getAvailableDates(serverId);
    const today = currentDateKey();
    const requestedDate = normalizeDateKey(date);
    const resolvedDate = requestedDate
      || (availableDates.includes(today) ? today : availableDates.at(-1))
      || today;

    const day = await loadDay(serverId, resolvedDate);
    const summary = day.summary ?? buildSummary(day.samples);

    return {
      ok: true,
      plugin: "server-info-statistics",
      serverId,
      date: resolvedDate,
      availableDates,
      day,
      summary,
      latest: summary.latest ?? null,
      updatedAt: day.updatedAt,
      liveSnapshot: getLiveSnapshot(),
    };
  }

  function normalizeDateKey(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return "";
    return text;
  }

  function getLiveSnapshot() {
    const sample = buildSample();
    if (!sample) return null;
    return sample;
  }

  async function flushPending() {
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();

    const tasks = [];
    for (const [key, day] of dayCache.entries()) {
      tasks.push(persistDay(day.serverId, day.date));
      dayCache.set(key, day);
    }

    await Promise.allSettled(tasks);
  }

  return {
    manifest: {
      id: "plugin.serverInfoStatistics",
      name: "服务器信息统计",
      kind: "plugin",
      version: "1.0.0",
      description: "基于 ShowServerInfo / matchState 快照统计在线人数、排队人数和 TPS，并按天落盘保存历史曲线。",
    },
    apiName: "serverInfoStatistics",
    api: {
      getState,
      getAvailableDates,
      captureSnapshot: () => captureSnapshot({ force: true }),
      getLiveSnapshot,
    },

    async start() {
      if (started) return;
      started = true;

      await ensureLoadedForToday(getServerId());
      await captureSnapshot({ force: true });

      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "serverStatusUpdated", () => {
        return captureSnapshot({ force: false }).catch((error) => {
          core.logger?.warn?.(`[ServerInfoStatistics] capture on serverStatusUpdated failed: ${error.message}`);
        });
      }));

      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "updated", () => {
        return captureSnapshot({ force: false }).catch((error) => {
          core.logger?.warn?.(`[ServerInfoStatistics] capture on matchState update failed: ${error.message}`);
        });
      }));

      timers.push(setInterval(() => {
        captureSnapshot({ force: false }).catch((error) => {
          core.logger?.warn?.(`[ServerInfoStatistics] scheduled capture failed: ${error.message}`);
        });
      }, SAMPLE_POLL_INTERVAL_MS));

      core.logger?.info?.("[ServerInfoStatistics] Plugin started.");
    },

    async stop() {
      for (const timer of timers.splice(0)) clearInterval(timer);
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      await flushPending();
      core.logger?.info?.("[ServerInfoStatistics] Plugin stopped.");
    },
  };
}
