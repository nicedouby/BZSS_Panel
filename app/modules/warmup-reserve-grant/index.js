import fs from "node:fs/promises";
import path from "node:path";

const MODULE_ID = "module.warmupReserveGrant";
const DEFAULT_STORE_FILE = "data/warmup-reserve-grant/store.json";
const DEFAULT_GRANTS_FILE = "data/warmup-reserve-grant/grants.jsonl";
const STORE_VERSION = 1;
const TICK_MS = 30_000;
const GRANT_RETRY_COOLDOWN_MS = 60_000;
const STEAM64_RE = /^7656119\d{10}$/;

export const DEFAULT_SETTINGS = {
  enabled: true,
  grantEveryMinutes: 120,
  grantDays: 1,
  reminderEveryMinutes: 5,
  maxEligiblePlayers: 50,
  requireWarmupMode: true,
  group: "BZSSVIP",
  countMode: "accumulate_eligible_online_time",
  timeWindows: [
    { enabled: true, start: "00:00", end: "23:59" },
  ],
  clearOfflineAfterHours: 24,
  maxRecentRecords: 500,
};

export function createWarmupReserveGrantModule({ core, modules, config, logger }) {
  const moduleLogger =
    logger ??
    core?.createLogger?.({
      moduleId: MODULE_ID,
      source: MODULE_ID,
      channel: "module",
    }) ??
    core?.logger ??
    console;

  const runtime = {
    settings: normalizeSettings(config?.get?.("modules.warmupReserveGrant", {}) ?? {}),
    store: createEmptyStore(),
    resolvedStoreFilePath: "",
    resolvedGrantsFilePath: "",
    timer: null,
    running: false,
    inTick: false,
    saveQueue: Promise.resolve(),
    lastTickAt: null,
    lastConditions: null,
    lastError: null,
    todayGrantCount: 0,
  };

  runtime.resolvedStoreFilePath = resolveConfigPath(runtime.settings.storeFilePath, DEFAULT_STORE_FILE);
  runtime.resolvedGrantsFilePath = resolveConfigPath(runtime.settings.grantsFilePath, DEFAULT_GRANTS_FILE);

  const api = {
    getState() {
      return buildState();
    },

    async updateSettings(patch = {}) {
      const nextSettings = normalizeSettings({
        ...runtime.settings,
        ...patch,
      });
      config?.set?.("modules.warmupReserveGrant", stripRuntimeOnlySettings(nextSettings));
      if (typeof config?.save === "function") await config.save();
      runtime.settings = nextSettings;
      runtime.resolvedStoreFilePath = resolveConfigPath(runtime.settings.storeFilePath, DEFAULT_STORE_FILE);
      runtime.resolvedGrantsFilePath = resolveConfigPath(runtime.settings.grantsFilePath, DEFAULT_GRANTS_FILE);
      runtime.store.settingsSnapshot = stripRuntimeOnlySettings(runtime.settings);
      await persistStore();
      restartTimer();
      return buildState({ message: "暖服赠送预留位设置已保存。" });
    },

    async clearRecords() {
      runtime.store.recentRecords = [];
      runtime.todayGrantCount = 0;
      await ensureDirectory(path.dirname(runtime.resolvedGrantsFilePath));
      await fs.writeFile(runtime.resolvedGrantsFilePath, "", "utf8");
      await persistStore();
      return buildState({ message: "暖服赠送历史记录已清空。" });
    },

    async clearProgress() {
      runtime.store.progress = {};
      await persistStore();
      return buildState({ message: "玩家暖服累计进度已清空。" });
    },

    async grantNow(input = {}, context = {}) {
      const steamId = normalizeSteamId(input.steamId ?? input.steamID ?? input.steam64);
      const existing = runtime.store.progress[steamId] ?? {};
      const name = String(input.name ?? existing.name ?? "").trim();
      const playerId = input.playerId ?? existing.playerId ?? null;
      const record = ensureProgressRecord({ steamId, name, playerId }, Date.now());
      const durationDays = input.durationDays ? Number(input.durationDays) : null;
      const result = await grantReserveSlot(record, {
        manual: true,
        actor: context.actor ?? null,
        conditions: getCurrentConditions(),
        durationDays,
      });
      await persistStore();
      return {
        ok: true,
        success: true,
        message: `已手动发放 ${result.grantedDays} 天预留位。`,
        grant: result,
        state: buildState(),
      };
    },

    async tickNow() {
      await tick();
      return buildState();
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "暖服赠送预留位",
      kind: "module",
      version: "1.0.0",
      description: "按玩家在线暖服累计时长自动续费预留位。",
    },
    apiName: "warmupReserveGrant",
    api,

    async init() {
      await loadStoreFromDisk({ repair: true });
    },

    async start() {
      runtime.running = true;
      restartTimer();
      moduleLogger?.info?.(`[WarmupReserveGrant] started. enabled=${Boolean(runtime.settings.enabled)} file=${runtime.resolvedStoreFilePath}`);
    },

    async stop() {
      runtime.running = false;
      if (runtime.timer) {
        clearInterval(runtime.timer);
        runtime.timer = null;
      }
      await persistStore();
      moduleLogger?.info?.("[WarmupReserveGrant] stopped.");
    },
  };

  function restartTimer() {
    if (runtime.timer) {
      clearInterval(runtime.timer);
      runtime.timer = null;
    }
    if (!runtime.running || !runtime.settings.enabled) return;
    runtime.timer = setInterval(() => {
      void tick().catch((error) => {
        runtime.lastError = error?.message ?? String(error);
        moduleLogger?.warn?.(`[WarmupReserveGrant] tick failed: ${runtime.lastError}`);
      });
    }, TICK_MS);
    runtime.timer.unref?.();
    void tick().catch((error) => {
      runtime.lastError = error?.message ?? String(error);
    });
  }

  async function loadStoreFromDisk({ repair = false } = {}) {
    runtime.settings = normalizeSettings(config?.get?.("modules.warmupReserveGrant", runtime.settings) ?? runtime.settings);
    runtime.resolvedStoreFilePath = resolveConfigPath(runtime.settings.storeFilePath, DEFAULT_STORE_FILE);
    runtime.resolvedGrantsFilePath = resolveConfigPath(runtime.settings.grantsFilePath, DEFAULT_GRANTS_FILE);
    await ensureStoreFile(runtime.resolvedStoreFilePath, { repair });
    const rawText = await fs.readFile(runtime.resolvedStoreFilePath, "utf8");
    runtime.store = normalizeStore(JSON.parse(rawText));
    runtime.store.settingsSnapshot = stripRuntimeOnlySettings(runtime.settings);
    runtime.todayGrantCount = countTodayGrants(runtime.store.recentRecords);
    await ensureDirectory(path.dirname(runtime.resolvedGrantsFilePath));
    return runtime.store;
  }

  async function tick() {
    if (runtime.inTick) return;
    runtime.inTick = true;
    const now = Date.now();
    try {
      const playersState = core?.runtimeState?.getPlayers?.() ?? {};
      const activePlayers = Array.isArray(playersState.active) ? playersState.active : [];
      const webStatus = core?.webStatus?.getSnapshot?.() ?? {};
      const playerCount = Number.isFinite(Number(webStatus.playerCount))
        ? Number(webStatus.playerCount)
        : activePlayers.length;
      const conditions = buildConditions({ webStatus, playerCount, settings: runtime.settings, now });
      runtime.lastConditions = conditions;
      runtime.lastTickAt = new Date(now).toISOString();

      const seenSteamIds = new Set();
      const deltaSeconds = Math.max(0, Math.round((now - resolveLastTickMs()) / 1000));
      const cappedDeltaSeconds = Math.min(deltaSeconds || 30, 120);

      for (const player of activePlayers) {
        const normalized = normalizePlayer(player);
        if (!normalized?.steamId) continue;
        seenSteamIds.add(normalized.steamId);
        const record = ensureProgressRecord(normalized, now);
        record.name = normalized.name || record.name;
        record.playerId = normalized.playerId ?? record.playerId ?? null;
        record.lastSeenAt = new Date(now).toISOString();

        if (conditions.eligible) {
          record.status = "active";
          record.eligibleSeconds = Math.max(0, Number(record.eligibleSeconds ?? 0)) + cappedDeltaSeconds;
          record.lastTickAt = new Date(now).toISOString();
          record.pauseReason = null;
          await maybeSendReminder(record, now);
          await maybeGrant(record, conditions, now);
        } else {
          record.status = "paused";
          record.lastTickAt = new Date(now).toISOString();
          maybeRecordPause(record, conditions.pauseReason, now);
        }
      }

      markOfflinePlayers(seenSteamIds, now);
      pruneOldOfflineProgress(now);
      runtime.store.lastTickMs = now;
      await persistStore();
      runtime.lastError = null;
    } finally {
      runtime.inTick = false;
    }
  }

  function resolveLastTickMs() {
    const value = Number(runtime.store.lastTickMs ?? 0);
    return Number.isFinite(value) && value > 0 ? value : Date.now() - TICK_MS;
  }

  async function maybeSendReminder(record, now) {
    const reminderSeconds = Math.max(60, Number(runtime.settings.reminderEveryMinutes) * 60);
    const lastReminderMs = Date.parse(record.lastReminderAt ?? "");
    if (Number.isFinite(lastReminderMs) && now - lastReminderMs < reminderSeconds * 1000) return;
    const thresholdSeconds = Math.max(60, Number(runtime.settings.grantEveryMinutes) * 60);
    const doneMinutes = Math.floor(Number(record.eligibleSeconds ?? 0) / 60);
    const remainingMinutes = Math.max(0, Math.ceil((thresholdSeconds - Number(record.eligibleSeconds ?? 0)) / 60));
    const message = `你已暖服 ${doneMinutes} 分钟，${remainingMinutes} 分钟后将为你激活一天预留位，感激参与暖服。`;
    const result = await warnPlayer(record, message, "warmup_reserve_grant_reminder");
    record.lastReminderAt = new Date(now).toISOString();
    appendRecentRecord({
      type: "reminder",
      steamId: record.steamId,
      name: record.name,
      playerId: record.playerId,
      eligibleSeconds: Math.floor(record.eligibleSeconds ?? 0),
      result: result?.ok === false ? "failed" : "success",
      createdAt: new Date(now).toISOString(),
    });
  }

  async function maybeGrant(record, conditions, now) {
    const thresholdSeconds = Math.max(60, Number(runtime.settings.grantEveryMinutes) * 60);
    if (Number(record.eligibleSeconds ?? 0) < thresholdSeconds) return;
    const lastFailureMs = Date.parse(record.lastGrantFailedAt ?? "");
    if (Number.isFinite(lastFailureMs) && now - lastFailureMs < GRANT_RETRY_COOLDOWN_MS) return;

    try {
      const grant = await grantReserveSlot(record, {
        manual: false,
        conditions,
      });
      record.eligibleSeconds = Math.max(0, Number(record.eligibleSeconds ?? 0) - thresholdSeconds);
      record.grantCount = Math.max(0, Number(record.grantCount ?? 0)) + 1;
      record.totalGrantedDays = Math.max(0, Number(record.totalGrantedDays ?? 0)) + Number(runtime.settings.grantDays);
      record.lastGrantedAt = grant.createdAt;
      record.lastGrantFailedAt = null;
      record.status = Number(record.eligibleSeconds) >= thresholdSeconds ? "active" : "granted";
      runtime.todayGrantCount += 1;
      await warnPlayer(
        record,
        `感谢参与暖服，你已累计暖服 ${runtime.settings.grantEveryMinutes} 分钟，系统已为你激活 ${runtime.settings.grantDays} 天预留位。`,
        "warmup_reserve_grant_success",
      );
    } catch (error) {
      record.lastGrantFailedAt = new Date(now).toISOString();
      runtime.lastError = error?.message ?? String(error);
      await appendAuditRecord({
        type: "grant_failed",
        steamId: record.steamId,
        name: record.name,
        playerId: record.playerId,
        eligibleSeconds: Math.floor(record.eligibleSeconds ?? 0),
        error: runtime.lastError,
        conditions: summarizeConditions(conditions),
        createdAt: new Date(now).toISOString(),
      });
    }
  }

  async function grantReserveSlot(record, { manual = false, actor = null, conditions = null, durationDays = null } = {}) {
    if (typeof modules?.reserveSlots?.upsertMember !== "function") {
      const error = new Error("reserveSlots.upsertMember is unavailable.");
      error.code = "ReserveSlotsUnavailable";
      throw error;
    }
    const grantedDays = Math.max(1, Number(durationDays ?? runtime.settings.grantDays) || 1);
    const resolvedName = await resolveGrantPlayerName(record);
    if (resolvedName) record.name = resolvedName;
    const result = await modules.reserveSlots.upsertMember({
      steamId: record.steamId,
      name: record.name,
      group: runtime.settings.group,
      durationDays: grantedDays,
      reason: manual
        ? `暖服手动赠送：管理员立即发放 ${grantedDays} 天`
        : `暖服自动赠送：累计暖服 ${runtime.settings.grantEveryMinutes} 分钟`,
    });
    const savedMember = result?.savedMember ?? result?.members?.find?.((item) => item?.steamId === record.steamId) ?? null;
    const createdAt = new Date().toISOString();
    const grantRecord = {
      type: "grant",
      steamId: record.steamId,
      name: record.name,
      playerId: record.playerId ?? null,
      grantedDays,
      eligibleSeconds: Math.max(0, Number(runtime.settings.grantEveryMinutes) * 60),
      expireAt: savedMember?.expireAt ?? null,
      manual,
      actor: normalizeActorName(actor),
      conditions: summarizeConditions(conditions ?? getCurrentConditions()),
      createdAt,
    };
    await appendAuditRecord(grantRecord);
    return grantRecord;
  }

  async function resolveGrantPlayerName(record) {
    const steamId = String(record?.steamId ?? "").trim();
    if (!steamId) return String(record?.name ?? "").trim();

    if (typeof modules?.playerDatabase?.listPlayersBySteamIDs === "function") {
      try {
        const rows = await modules.playerDatabase.listPlayersBySteamIDs([steamId]);
        const row = Array.isArray(rows) ? rows.find((item) => {
          const rowSteamId = String(item?.steam_id ?? item?.steamID ?? item?.steam64 ?? "").trim();
          return rowSteamId === steamId;
        }) : null;
        const dbName = String(row?.current_name ?? row?.currentName ?? row?.name ?? "").trim();
        if (dbName) return dbName;
      } catch (error) {
        moduleLogger?.warn?.(`[WarmupReserveGrant] failed to resolve player name from database: ${error?.message ?? error}`);
      }
    }

    const runtimePlayer = core?.runtimeState?.getPlayers?.()?.bySteamID?.[steamId] ?? null;
    const runtimeName = String(runtimePlayer?.name ?? "").trim();
    return runtimeName || String(record?.name ?? "").trim();
  }

  async function warnPlayer(record, message, reason) {
    const sender = modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn;
    if (typeof sender !== "function") return { ok: false, skipped: true };
    return sender.call(modules.adminWarn, {
      targetName: record.name,
      targetPlayerId: record.playerId,
      targetSteamId: record.steamId,
      message,
      reason,
      sourceModule: MODULE_ID,
      system: true,
    });
  }

  function ensureProgressRecord(player, now) {
    const steamId = normalizeSteamId(player.steamId);
    if (!runtime.store.progress[steamId]) {
      runtime.store.progress[steamId] = {
        steamId,
        name: player.name ?? "",
        playerId: player.playerId ?? null,
        eligibleSeconds: 0,
        lastSeenAt: new Date(now).toISOString(),
        lastTickAt: null,
        lastReminderAt: null,
        grantCount: 0,
        totalGrantedDays: 0,
        lastGrantedAt: null,
        status: "active",
      };
    }
    return runtime.store.progress[steamId];
  }

  function maybeRecordPause(record, pauseReason, now) {
    if (record.pauseReason === pauseReason) return;
    record.pauseReason = pauseReason;
    appendRecentRecord({
      type: "pause",
      steamId: record.steamId,
      name: record.name,
      playerId: record.playerId,
      pauseReason,
      eligibleSeconds: Math.floor(record.eligibleSeconds ?? 0),
      createdAt: new Date(now).toISOString(),
    });
  }

  function markOfflinePlayers(seenSteamIds, now) {
    for (const record of Object.values(runtime.store.progress)) {
      if (seenSteamIds.has(record.steamId)) continue;
      if (record.status !== "offline") {
        record.status = "offline";
        appendRecentRecord({
          type: "offline",
          steamId: record.steamId,
          name: record.name,
          playerId: record.playerId,
          eligibleSeconds: Math.floor(record.eligibleSeconds ?? 0),
          createdAt: new Date(now).toISOString(),
        });
      }
    }
  }

  function pruneOldOfflineProgress(now) {
    const ttlMs = Math.max(1, Number(runtime.settings.clearOfflineAfterHours) || 24) * 60 * 60 * 1000;
    for (const [steamId, record] of Object.entries(runtime.store.progress)) {
      if (record.status !== "offline") continue;
      const lastSeenMs = Date.parse(record.lastSeenAt ?? "");
      if (Number.isFinite(lastSeenMs) && now - lastSeenMs > ttlMs) {
        delete runtime.store.progress[steamId];
      }
    }
  }

  function getCurrentConditions() {
    const webStatus = core?.webStatus?.getSnapshot?.() ?? {};
    const activePlayers = core?.runtimeState?.getPlayers?.()?.active ?? [];
    const playerCount = Number.isFinite(Number(webStatus.playerCount)) ? Number(webStatus.playerCount) : activePlayers.length;
    return buildConditions({ webStatus, playerCount, settings: runtime.settings, now: Date.now() });
  }

  function buildState(extra = {}) {
    const progress = Object.values(runtime.store.progress)
      .sort((a, b) => Number(b.eligibleSeconds ?? 0) - Number(a.eligibleSeconds ?? 0));
    const conditions = runtime.lastConditions ?? getCurrentConditions();
    return {
      ok: true,
      config: stripRuntimeOnlySettings(runtime.settings),
      paths: {
        storeFilePath: runtime.resolvedStoreFilePath,
        grantsFilePath: runtime.resolvedGrantsFilePath,
      },
      status: {
        running: runtime.running,
        enabled: Boolean(runtime.settings.enabled),
        inTick: runtime.inTick,
        lastTickAt: runtime.lastTickAt,
        lastError: runtime.lastError,
        conditions,
        accumulatingCount: progress.filter((record) => record.status === "active").length,
        todayGrantCount: runtime.todayGrantCount,
      },
      progress,
      records: runtime.store.recentRecords,
      summary: {
        progressCount: progress.length,
        activeCount: progress.filter((record) => record.status === "active").length,
        pausedCount: progress.filter((record) => record.status === "paused").length,
        offlineCount: progress.filter((record) => record.status === "offline").length,
        grantCount: progress.reduce((sum, record) => sum + Number(record.grantCount ?? 0), 0),
        totalGrantedDays: progress.reduce((sum, record) => sum + Number(record.totalGrantedDays ?? 0), 0),
      },
      ...extra,
    };
  }

  async function appendAuditRecord(record) {
    appendRecentRecord(record);
    await ensureDirectory(path.dirname(runtime.resolvedGrantsFilePath));
    await fs.appendFile(runtime.resolvedGrantsFilePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  function appendRecentRecord(record) {
    runtime.store.recentRecords.unshift(record);
    const limit = Math.max(1, Number(runtime.settings.maxRecentRecords) || 500);
    runtime.store.recentRecords = runtime.store.recentRecords.slice(0, limit);
  }

  async function persistStore() {
    runtime.store.version = STORE_VERSION;
    runtime.store.settingsSnapshot = stripRuntimeOnlySettings(runtime.settings);
    runtime.store.updatedAt = new Date().toISOString();
    runtime.saveQueue = runtime.saveQueue.then(async () => {
      await ensureDirectory(path.dirname(runtime.resolvedStoreFilePath));
      const tmpPath = `${runtime.resolvedStoreFilePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmpPath, `${JSON.stringify(runtime.store, null, 2)}\n`, "utf8");
      await fs.rename(tmpPath, runtime.resolvedStoreFilePath);
    });
    return runtime.saveQueue;
  }
}

function buildConditions({ webStatus, playerCount, settings, now }) {
  const isWarmup = Boolean(webStatus?.isWarmup);
  const matchedTimeWindow = isWithinAnyTimeWindow(settings.timeWindows, new Date(now));
  const belowPlayerLimit = Number(playerCount) < Number(settings.maxEligiblePlayers);
  const warmupOk = !settings.requireWarmupMode || isWarmup;
  let pauseReason = null;
  if (!settings.enabled) pauseReason = "disabled";
  else if (!warmupOk) pauseReason = "not_warmup";
  else if (!belowPlayerLimit) pauseReason = "player_limit";
  else if (!matchedTimeWindow) pauseReason = "time_window";
  return {
    eligible: !pauseReason,
    isWarmup,
    playerCount,
    maxEligiblePlayers: Number(settings.maxEligiblePlayers),
    belowPlayerLimit,
    matchedTimeWindow,
    pauseReason,
    checkedAt: new Date(now).toISOString(),
  };
}

export function isWithinAnyTimeWindow(windows, date = new Date()) {
  const enabledWindows = (Array.isArray(windows) ? windows : [])
    .map((item) => normalizeTimeWindow(item))
    .filter((item) => item.enabled);
  if (!enabledWindows.length) return true;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return enabledWindows.some((window) => isMinuteWithinWindow(minutes, window));
}

export function isMinuteWithinWindow(nowMinutes, window) {
  const start = parseTimeToMinutes(window.start);
  const end = parseTimeToMinutes(window.end);
  if (start <= end) return nowMinutes >= start && nowMinutes <= end;
  return nowMinutes >= start || nowMinutes <= end;
}

function normalizeSettings(input = {}) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...input,
  };
  return {
    enabled: Boolean(settings.enabled),
    grantEveryMinutes: clampNumber(settings.grantEveryMinutes, 120, 1, 24 * 60),
    grantDays: clampNumber(settings.grantDays, 1, 1, 3650),
    reminderEveryMinutes: clampNumber(settings.reminderEveryMinutes, DEFAULT_SETTINGS.reminderEveryMinutes, 1, 24 * 60),
    maxEligiblePlayers: clampNumber(settings.maxEligiblePlayers, 50, 1, 200),
    requireWarmupMode: Boolean(settings.requireWarmupMode),
    group: String(settings.group ?? "BZSSVIP").trim() || "BZSSVIP",
    countMode: "accumulate_eligible_online_time",
    timeWindows: normalizeTimeWindows(settings.timeWindows),
    clearOfflineAfterHours: clampNumber(settings.clearOfflineAfterHours, 24, 1, 24 * 30),
    maxRecentRecords: clampNumber(settings.maxRecentRecords, 500, 10, 5000),
    storeFilePath: String(settings.storeFilePath ?? DEFAULT_STORE_FILE).trim() || DEFAULT_STORE_FILE,
    grantsFilePath: String(settings.grantsFilePath ?? DEFAULT_GRANTS_FILE).trim() || DEFAULT_GRANTS_FILE,
  };
}

function normalizeStore(input = {}) {
  const store = {
    ...createEmptyStore(),
    ...(input && typeof input === "object" ? input : {}),
  };
  const progress = {};
  for (const item of Object.values(store.progress ?? {})) {
    if (!item?.steamId || !STEAM64_RE.test(String(item.steamId))) continue;
    progress[item.steamId] = {
      steamId: item.steamId,
      name: String(item.name ?? ""),
      playerId: item.playerId ?? null,
      eligibleSeconds: Math.max(0, Number(item.eligibleSeconds ?? 0) || 0),
      lastSeenAt: item.lastSeenAt ?? null,
      lastTickAt: item.lastTickAt ?? null,
      lastReminderAt: item.lastReminderAt ?? null,
      grantCount: Math.max(0, Number(item.grantCount ?? 0) || 0),
      totalGrantedDays: Math.max(0, Number(item.totalGrantedDays ?? 0) || 0),
      lastGrantedAt: item.lastGrantedAt ?? null,
      lastGrantFailedAt: item.lastGrantFailedAt ?? null,
      status: normalizeStatus(item.status),
      pauseReason: item.pauseReason ?? null,
    };
  }
  store.progress = progress;
  store.recentRecords = Array.isArray(store.recentRecords) ? store.recentRecords.slice(0, 5000) : [];
  return store;
}

function createEmptyStore() {
  return {
    version: STORE_VERSION,
    settingsSnapshot: stripRuntimeOnlySettings(DEFAULT_SETTINGS),
    progress: {},
    recentRecords: [],
    lastTickMs: 0,
    updatedAt: null,
  };
}

function normalizePlayer(player) {
  const steamId = String(player?.steamId ?? player?.steamID ?? player?.steam64 ?? "").trim();
  if (!STEAM64_RE.test(steamId)) return null;
  return {
    steamId,
    name: String(player?.name ?? player?.playerName ?? "").trim(),
    playerId: player?.playerId ?? player?.playerID ?? player?.id ?? null,
  };
}

function normalizeSteamId(value) {
  const text = String(value ?? "").trim();
  if (!STEAM64_RE.test(text)) {
    const error = new Error("Steam64 must be a valid 17-digit SteamID64.");
    error.statusCode = 400;
    error.code = "InvalidSteam64";
    throw error;
  }
  return text;
}

function normalizeStatus(value) {
  const text = String(value ?? "").trim();
  if (["active", "paused", "granted", "offline"].includes(text)) return text;
  return "offline";
}

function normalizeTimeWindows(input) {
  const list = Array.isArray(input) ? input : DEFAULT_SETTINGS.timeWindows;
  const normalized = list.map((item) => normalizeTimeWindow(item)).filter(Boolean);
  return normalized.length ? normalized : DEFAULT_SETTINGS.timeWindows;
}

function normalizeTimeWindow(item = {}) {
  return {
    enabled: item?.enabled !== false,
    start: normalizeTimeText(item?.start, "00:00"),
    end: normalizeTimeText(item?.end, "23:59"),
  };
}

function normalizeTimeText(value, fallback) {
  let text = String(value ?? "").trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) {
    text = text.slice(0, 5);
  }
  return /^\d{2}:\d{2}$/.test(text) && parseTimeToMinutes(text) != null ? text : fallback;
}

function parseTimeToMinutes(text) {
  const match = String(text ?? "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function stripRuntimeOnlySettings(settings) {
  const {
    enabled,
    grantEveryMinutes,
    grantDays,
    reminderEveryMinutes,
    maxEligiblePlayers,
    requireWarmupMode,
    group,
    countMode,
    timeWindows,
    clearOfflineAfterHours,
    maxRecentRecords,
  } = settings;
  return {
    enabled,
    grantEveryMinutes,
    grantDays,
    reminderEveryMinutes,
    maxEligiblePlayers,
    requireWarmupMode,
    group,
    countMode,
    timeWindows,
    clearOfflineAfterHours,
    maxRecentRecords,
  };
}

function summarizeConditions(conditions) {
  return {
    isWarmup: Boolean(conditions?.isWarmup),
    playerCount: Number(conditions?.playerCount ?? 0),
    matchedTimeWindow: Boolean(conditions?.matchedTimeWindow),
  };
}

function normalizeActorName(actor) {
  if (!actor || typeof actor !== "object") return "system";
  return String(actor.username ?? actor.name ?? actor.id ?? "system").trim() || "system";
}

function countTodayGrants(records = []) {
  const today = new Date().toISOString().slice(0, 10);
  return records.filter((record) => record?.type === "grant" && String(record.createdAt ?? "").slice(0, 10) === today).length;
}

async function ensureStoreFile(filePath, { repair = false } = {}) {
  await ensureDirectory(path.dirname(filePath));
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.writeFile(filePath, `${JSON.stringify(createEmptyStore(), null, 2)}\n`, "utf8");
    return;
  }
  if (!repair) return;
  try {
    JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(createEmptyStore(), null, 2)}\n`, "utf8");
  }
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function resolveConfigPath(value, fallback) {
  const raw = String(value ?? fallback ?? "").trim() || fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
