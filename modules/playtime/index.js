// -*- coding: utf-8 -*-

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createSteamPlaytimeDatabase } from "../../core/steam-playtime-database.js";
import { SteamPlaytimeRepository } from "../../repositories/steam-playtime-repository.js";

const DEFAULT_APP_ID = 393380;
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_WAIT_MS = 15_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY_MS = 1200;
const DEFAULT_SCRIPT_TIMEOUT_MS = 12_000;
const DEFAULT_ONLINE_REFRESH_FRESHNESS_WINDOW_MINUTES = 120;
const DEFAULT_MANUAL_REFRESH_COOLDOWN_MINUTES = 30;
const DEFAULT_AUTO_REFRESH_ENABLED = true;
const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;
const DEFAULT_AUTO_REFRESH_COOLDOWN_MINUTES = 30;
const DEFAULT_AUTO_REFRESH_MISSING_ONLY = true;
const DEFAULT_AUTO_REFRESH_BATCH_SIZE = 8;
const MAX_JOB_HISTORY = 200;
const MAX_JOB_EVENTS = 100;

function now() {
  return Date.now();
}

function normalizeSteamID(value) {
  const raw = String(value || "").trim();
  const direct = raw.match(/^\d{5,20}$/)?.[0] || null;
  const extracted = direct || raw.match(/\d{5,20}/)?.[0] || null;
  if (!extracted) throw new Error("steamID must be a numeric Steam64 string.");
  return extracted;
}

function optionalSteamID(value) {
  try {
    return normalizeSteamID(value);
  } catch {
    return null;
  }
}

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function clampWaitMs(value, fallback) {
  const waitMs = Number(value);
  if (!Number.isFinite(waitMs)) return fallback;
  return Math.max(0, Math.min(Math.floor(waitMs), 30_000));
}

function buildLookupResult({ steamID, appId, gameName, gameSeconds, found }) {
  const seconds = Math.max(0, Math.floor(Number(gameSeconds) || 0));
  return {
    steamID,
    appId,
    gameName: gameName || "Squad",
    found: Boolean(found),
    gameSeconds: seconds,
    gameMinutes: Math.floor(seconds / 60),
    gameHours: Number((seconds / 3600).toFixed(2)),
    fetchedAt: now(),
  };
}

class SteamGameDurationService {
  constructor({
    apiKey,
    appId,
    maxConcurrent,
    requestTimeoutMs,
    defaultWaitMs,
    retryCount,
    retryDelayMs,
    usePythonScript,
    pythonBin,
    pythonScript,
    pythonConfigPath,
    scriptTimeoutMs,
    scriptFallbackToApi,
    onlineRefreshFreshnessWindowMinutes,
    manualRefreshCooldownMinutes,
    autoRefreshEnabled,
    autoRefreshIntervalMs,
    autoRefreshCooldownMinutes,
    autoRefreshMissingOnly,
    autoRefreshBatchSize,
    steamPlaytimeRepo,
    playerDatabase,
    logger,
  } = {}) {
    this.apiKey = String(apiKey || process.env.STEAM_API_KEY || "").trim();
    this.appId = Number(appId) || DEFAULT_APP_ID;
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || DEFAULT_MAX_CONCURRENT);
    this.requestTimeoutMs = Math.max(1000, Number(requestTimeoutMs) || DEFAULT_TIMEOUT_MS);
    this.defaultWaitMs = clampWaitMs(defaultWaitMs, DEFAULT_WAIT_MS);
    this.retryCount = Math.max(0, Math.min(Math.floor(Number(retryCount) || DEFAULT_RETRY_COUNT), 5));
    this.retryDelayMs = Math.max(100, Math.min(Math.floor(Number(retryDelayMs) || DEFAULT_RETRY_DELAY_MS), 10_000));
    this.usePythonScript = usePythonScript !== false;
    this.pythonBin = String(pythonBin || "python").trim() || "python";
    this.pythonScriptPath = path.resolve(process.cwd(), String(pythonScript || "./MicePanel/FetchGameDuration.py"));
    this.pythonConfigPath = path.resolve(process.cwd(), String(pythonConfigPath || "./MicePanel/config.json"));
    this.scriptTimeoutMs = Math.max(1000, Number(scriptTimeoutMs) || DEFAULT_SCRIPT_TIMEOUT_MS);
    this.scriptFallbackToApi = Boolean(scriptFallbackToApi);
    this.onlineRefreshFreshnessWindowMinutes = Math.max(0, Number(onlineRefreshFreshnessWindowMinutes) || DEFAULT_ONLINE_REFRESH_FRESHNESS_WINDOW_MINUTES);
    this.manualRefreshCooldownMinutes = Math.max(0, Number(manualRefreshCooldownMinutes) || DEFAULT_MANUAL_REFRESH_COOLDOWN_MINUTES);
    this.autoRefreshEnabled = autoRefreshEnabled == null ? DEFAULT_AUTO_REFRESH_ENABLED : Boolean(autoRefreshEnabled);
    this.autoRefreshIntervalMs = Math.max(1000, Number(autoRefreshIntervalMs) || DEFAULT_AUTO_REFRESH_INTERVAL_MS);
    this.autoRefreshCooldownMinutes = Math.max(0, Number(autoRefreshCooldownMinutes) || DEFAULT_AUTO_REFRESH_COOLDOWN_MINUTES);
    this.autoRefreshMissingOnly = autoRefreshMissingOnly == null ? DEFAULT_AUTO_REFRESH_MISSING_ONLY : Boolean(autoRefreshMissingOnly);
    this.autoRefreshBatchSize = Math.max(1, Number(autoRefreshBatchSize) || DEFAULT_AUTO_REFRESH_BATCH_SIZE);
    this.steamPlaytimeRepo = steamPlaytimeRepo || null;
    this.playerDatabase = playerDatabase || null;
    this.logger = logger || null;

    this.jobs = new Map();
    this.jobOrder = [];
    this.lookupQueue = [];
    this.activeLookups = 0;
    this.inflightLookups = new Map();
    this.jobCounter = 0;
    this.backgroundAutoRefreshTimer = null;
    this.backgroundAutoRefreshRunning = false;
    this.backgroundAutoRefreshGetOnlinePlayers = null;
    this.backgroundAutoRefreshPlayerDatabase = null;
  }

  isConfigured() {
    if (this.apiKey) return true;
    return this.usePythonScript && fs.existsSync(this.pythonScriptPath) && fs.existsSync(this.pythonConfigPath);
  }

  getStatus() {
    let queuedJobs = 0;
    let runningJobs = 0;
    let completedJobs = 0;
    let failedJobs = 0;

    for (const job of this.jobs.values()) {
      if (job.status === "queued") queuedJobs += 1;
      else if (job.status === "running") runningJobs += 1;
      else if (job.status === "completed") completedJobs += 1;
      else if (job.status === "failed") failedJobs += 1;
    }

    return {
      configured: this.isConfigured(),
      appId: this.appId,
      maxConcurrent: this.maxConcurrent,
      requestTimeoutMs: this.requestTimeoutMs,
      defaultWaitMs: this.defaultWaitMs,
      retryCount: this.retryCount,
      retryDelayMs: this.retryDelayMs,
      usePythonScript: this.usePythonScript,
      pythonBin: this.pythonBin,
      pythonScriptPath: this.pythonScriptPath,
      pythonConfigPath: this.pythonConfigPath,
      scriptTimeoutMs: this.scriptTimeoutMs,
      scriptFallbackToApi: this.scriptFallbackToApi,
      onlineRefreshFreshnessWindowMinutes: this.onlineRefreshFreshnessWindowMinutes,
      manualRefreshCooldownMinutes: this.manualRefreshCooldownMinutes,
      autoRefreshEnabled: this.autoRefreshEnabled,
      autoRefreshIntervalMs: this.autoRefreshIntervalMs,
      autoRefreshCooldownMinutes: this.autoRefreshCooldownMinutes,
      autoRefreshMissingOnly: this.autoRefreshMissingOnly,
      autoRefreshBatchSize: this.autoRefreshBatchSize,
      activeLookups: this.activeLookups,
      queuedLookups: this.lookupQueue.length,
      queuedJobs,
      runningJobs,
      completedJobs,
      failedJobs,
    };
  }

  getJob(jobId) {
    const job = this.jobs.get(String(jobId || "").trim());
    return job ? this._publicJob(job) : null;
  }

  async waitForJob(jobId, waitMs = this.defaultWaitMs) {
    const job = this.jobs.get(String(jobId || "").trim());
    if (!job) return null;
    if (job.status === "completed" || job.status === "failed") return this._publicJob(job);

    const timeoutMs = clampWaitMs(waitMs, this.defaultWaitMs);
    if (timeoutMs <= 0) return this._publicJob(job);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        job.waiters.delete(handleDone);
        resolve(this._publicJob(job));
      }, timeoutMs);

      const handleDone = () => {
        clearTimeout(timer);
        resolve(this._publicJob(job));
      };

      job.waiters.add(handleDone);
    });
  }

  createLookupJob({ steamID, label = null, player = null } = {}) {
    const normalizedSteamID = normalizeSteamID(steamID);
    const job = this._createJob("steam-lookup", {
      steamID: normalizedSteamID,
      label: label || player?.name || player?.current_name || normalizedSteamID,
    });

    this._runJob(job, async () => {
      const lookup = await this.lookupSteamDuration(normalizedSteamID, {
        lastSeenName: player?.name || player?.current_name || label || null,
      });
      const updatedPlayer = await this._syncPlayerDuration({ player, steamID: normalizedSteamID, lookup });
      await this._logRefresh(job, "success", {
        playerId: updatedPlayer?.id || null,
        currentName: updatedPlayer?.current_name || player?.name || player?.current_name || label || null,
        steamID: normalizedSteamID,
        gameSeconds: lookup.gameSeconds,
      });
      return { lookup };
    });

    return this._publicJob(job);
  }

  createOnlineRefreshJob({
    players = [],
    playerDatabase = this.playerDatabase,
    force = false,
    cooldownMinutes = this.manualRefreshCooldownMinutes,
    missingOnly = false,
    source = "manual",
  } = {}) {
    const targets = collectPlayersWithSteamID(players);

    const job = this._createJob("online-refresh", {
      playerCount: targets.length,
      force: Boolean(force),
      cooldownMinutes: Math.max(0, Number(cooldownMinutes) || 0),
      missingOnly: Boolean(missingOnly),
      source,
    });

    this._initJobProgress(job, {
      phase: "scan",
      message: `扫描到 ${targets.length} 名在线玩家`,
      total: targets.length,
    });
    this._pushJobEvent(job, {
      phase: "scan",
      status: "success",
      message: `扫描到 ${targets.length} 名在线玩家`,
      total: targets.length,
    });

    this._runJob(job, async () => {
      const plan = await this._buildOnlineRefreshPlan(targets, {
        force,
        cooldownMinutes,
        missingOnly,
      });
      return await this._executeOnlineRefreshJob(job, {
        total: targets.length,
        selectedTargets: plan.selectedTargets,
        skippedItems: plan.skippedItems,
        playerDatabase,
      });
    });

    return this._publicJob(job);
  }

  async _buildOnlineRefreshPlan(players, {
    force = false,
    cooldownMinutes = this.manualRefreshCooldownMinutes,
    missingOnly = false,
  } = {}) {
    const rows = this.steamPlaytimeRepo?.getManyBySteamIDs
      ? await this.steamPlaytimeRepo.getManyBySteamIDs(players.map((player) => player.steamID))
      : new Map();
    const cooldownMs = Math.max(0, Number(cooldownMinutes) || 0) * 60_000;
    const nowTs = now();
    const selectedTargets = [];
    const skippedItems = [];

    for (const player of players) {
      const cached = rows.get(player.steamID);
      const fetchedAt = Number(cached?.fetched_at || 0) || 0;
      const ageMs = fetchedAt > 0 ? Math.max(0, nowTs - fetchedAt) : Number.POSITIVE_INFINITY;
      const hasCache = Boolean(cached);
      const isFresh = fetchedAt > 0 && cooldownMs > 0 && ageMs < cooldownMs;
      const shouldSkip = !force && (missingOnly ? hasCache : isFresh);

      if (shouldSkip) {
        const reason = missingOnly
          ? "玩家已有 Steam 时长缓存"
          : `最近 ${Math.max(0, Math.floor(Number(cooldownMinutes) || 0))} 分钟内已刷新`;
        const ageMinutes = Number.isFinite(ageMs) ? Math.floor(ageMs / 60_000) : null;
        skippedItems.push({
          steamID: player.steamID,
          playerName: player.name || null,
          fetchedAt: fetchedAt || null,
          ageMinutes,
          reason,
          event: {
            phase: "filter",
            status: "skipped",
            steamID: player.steamID,
            playerName: player.name || null,
            message: `${player.name || player.steamID} ${reason}`,
          },
        });
        continue;
      }

      selectedTargets.push({
        ...player,
        fetchedAt: fetchedAt || null,
        ageMs: Number.isFinite(ageMs) ? ageMs : null,
      });
    }

    return { selectedTargets, skippedItems };
  }

  async _executeOnlineRefreshJob(job, {
    total = 0,
    selectedTargets = [],
    skippedItems = [],
    playerDatabase = this.playerDatabase,
  } = {}) {
    const results = [];
    const failures = [];
    let processed = 0;
    let running = 0;

    this._setJobProgress(job, {
      phase: selectedTargets.length ? "filter" : "completed",
      message: selectedTargets.length
        ? `准备刷新 ${selectedTargets.length} 名玩家`
        : "没有需要刷新时长的在线玩家",
      total,
      selected: selectedTargets.length,
      skipped: skippedItems.length,
      queued: selectedTargets.length,
      running: 0,
      updated: 0,
      failed: 0,
      percent: this._calculateProgressPercent(total, skippedItems.length, 0),
    });

    for (const skipped of skippedItems) {
      this._pushJobEvent(job, skipped.event);
    }

    const settleOne = async (player) => {
      running += 1;
      this._setJobProgress(job, {
        phase: "lookup",
        message: `正在查询 ${player.name || player.steamID}`,
        queued: Math.max(0, selectedTargets.length - processed - running),
        running,
        percent: this._calculateProgressPercent(total, skippedItems.length, processed),
      });
      this._pushJobEvent(job, {
        phase: "lookup",
        status: "running",
        steamID: player.steamID,
        playerName: player.name || null,
        message: `开始查询 ${player.name || player.steamID}`,
      });

      try {
        const lookup = await this.lookupSteamDuration(player.steamID, {
          lastSeenName: player.name || null,
        });
        this._pushJobEvent(job, {
          phase: "steam",
          status: "success",
          steamID: player.steamID,
          playerName: player.name || null,
          message: `Steam 查询成功 ${lookup.gameHours}h`,
          gameSeconds: lookup.gameSeconds,
        });

        const updatedPlayer = await this._syncPlayerDuration({
          player,
          steamID: player.steamID,
          lookup,
          playerDatabase,
        });

        const value = {
          playerId: updatedPlayer?.id || null,
          currentName: updatedPlayer?.current_name || player.name || null,
          steamID: player.steamID,
          gameSeconds: lookup.gameSeconds,
          found: lookup.found,
        };

        this._pushJobEvent(job, {
          phase: "database",
          status: "success",
          steamID: player.steamID,
          playerName: value.currentName,
          playerId: value.playerId,
          message: "时长缓存和玩家档案已写入",
          gameSeconds: lookup.gameSeconds,
        });
        await this._logRefresh(job, "success", value);
        results.push(value);
        return value;
      } catch (error) {
        const failure = {
          steamID: player.steamID,
          playerName: player.name || null,
          error: error?.message || "lookup failed",
        };
        failures.push(failure);
        this._pushJobEvent(job, {
          phase: "failed",
          status: "failed",
          steamID: player.steamID,
          playerName: player.name || null,
          message: failure.error,
        });
        await this._logRefresh(job, "failed", failure, failure.error);
        return null;
      } finally {
        processed += 1;
        running = Math.max(0, running - 1);
        this._setJobProgress(job, {
          phase: processed >= selectedTargets.length ? "completed" : "lookup",
          message: processed >= selectedTargets.length
            ? "刷新完成"
            : `已处理 ${processed}/${selectedTargets.length}`,
          total,
          selected: selectedTargets.length,
          skipped: skippedItems.length,
          queued: Math.max(0, selectedTargets.length - processed - running),
          running,
          updated: results.length,
          failed: failures.length,
          percent: this._calculateProgressPercent(total, skippedItems.length, processed),
        });
      }
    };

    await Promise.all(selectedTargets.map((player) => settleOne(player)));

    return {
      total,
      selected: selectedTargets.length,
      updated: results.length,
      failed: failures.length,
      skipped: skippedItems.length,
      skippedItems: skippedItems.map((item) => ({
        steamID: item.steamID,
        playerName: item.playerName,
        reason: item.reason,
        fetchedAt: item.fetchedAt,
        ageMinutes: item.ageMinutes,
      })),
      results,
      failures,
    };
  }

  async lookupSteamDuration(steamID, persistOptions = {}) {
    if (!this.isConfigured()) throw new Error("Steam API key or Python lookup config is not configured.");

    const normalizedSteamID = normalizeSteamID(steamID);
    const cacheKey = `${normalizedSteamID}:${this.appId}`;
    const inflight = this.inflightLookups.get(cacheKey);
    if (inflight) return inflight;

    const pending = this._enqueueLookup(() => this._fetchSteamDuration(normalizedSteamID)).then(async (lookup) => {
      await this.steamPlaytimeRepo?.upsertFromLookup?.(normalizedSteamID, lookup, persistOptions);
      return lookup;
    });
    this.inflightLookups.set(cacheKey, pending);

    try {
      return await pending;
    } finally {
      this.inflightLookups.delete(cacheKey);
    }
  }

  async _syncPlayerDuration({ player, steamID, lookup, playerDatabase = this.playerDatabase } = {}) {
    if (!playerDatabase?.upsertFromPresence || !playerDatabase?.updateGameDuration) return null;

    const profile = await playerDatabase.upsertFromPresence({
      name: player?.name || player?.current_name || null,
      steamID,
      eosID: player?.eosID || player?.eos_id || null,
    });
    if (!profile?.id) return profile;
    return playerDatabase.updateGameDuration(profile.id, lookup.gameSeconds);
  }

  async _logRefresh(job, status, payload = {}, message = null) {
    await this.steamPlaytimeRepo?.addRefreshLog?.({
      jobId: job.id,
      jobType: job.type,
      steamID: payload.steamID,
      playerId: payload.playerId,
      playerName: payload.currentName || payload.playerName,
      status,
      message,
      gameSeconds: payload.gameSeconds,
    });
  }

  _initJobProgress(job, initial = {}) {
    job.progress = this._normalizeJobProgress({
      phase: "queued",
      message: "等待开始",
      total: 0,
      selected: 0,
      skipped: 0,
      queued: 0,
      running: 0,
      updated: 0,
      failed: 0,
      percent: 0,
      events: [],
      ...initial,
    });
    return job.progress;
  }

  _setJobProgress(job, patch = {}) {
    if (!job.progress) this._initJobProgress(job);
    job.progress = this._normalizeJobProgress({
      ...job.progress,
      ...patch,
    });
    return job.progress;
  }

  _pushJobEvent(job, event = {}) {
    if (!job.progress) this._initJobProgress(job);
    const entry = {
      at: now(),
      phase: "lookup",
      status: "success",
      message: "",
      ...event,
    };
    const nextEvents = [...(job.progress.events || []), entry].slice(-MAX_JOB_EVENTS);
    job.progress = this._normalizeJobProgress({
      ...job.progress,
      phase: entry.phase || job.progress.phase,
      message: entry.message || job.progress.message,
      events: nextEvents,
    });
    return entry;
  }

  _normalizeJobProgress(progress = {}) {
    const total = Math.max(0, Math.floor(Number(progress.total) || 0));
    const selected = Math.max(0, Math.floor(Number(progress.selected) || 0));
    const skipped = Math.max(0, Math.floor(Number(progress.skipped) || 0));
    const queued = Math.max(0, Math.floor(Number(progress.queued) || 0));
    const running = Math.max(0, Math.floor(Number(progress.running) || 0));
    const updated = Math.max(0, Math.floor(Number(progress.updated) || 0));
    const failed = Math.max(0, Math.floor(Number(progress.failed) || 0));
    const percent = Math.max(0, Math.min(100, Math.floor(Number(progress.percent) || 0)));
    const events = Array.isArray(progress.events)
      ? progress.events.map((event) => ({
        at: Number(event?.at || 0) || now(),
        phase: String(event?.phase || "lookup"),
        status: String(event?.status || "success"),
        steamID: event?.steamID || null,
        playerName: event?.playerName || null,
        playerId: event?.playerId == null ? null : event.playerId,
        message: String(event?.message || ""),
        gameSeconds: event?.gameSeconds == null ? null : Number(event.gameSeconds),
        reason: event?.reason || null,
        fetchedAt: event?.fetchedAt == null ? null : Number(event.fetchedAt),
        ageMinutes: event?.ageMinutes == null ? null : Number(event.ageMinutes),
      }))
      : [];

    return {
      phase: String(progress.phase || "queued"),
      message: String(progress.message || ""),
      total,
      selected,
      skipped,
      queued,
      running,
      updated,
      failed,
      percent,
      events,
    };
  }

  _calculateProgressPercent(total, skipped, processedSelected) {
    const totalCount = Math.max(0, Math.floor(Number(total) || 0));
    if (totalCount <= 0) return 100;
    const done = Math.min(totalCount, Math.max(0, Math.floor(Number(skipped) || 0)) + Math.max(0, Math.floor(Number(processedSelected) || 0)));
    return Math.max(0, Math.min(100, Math.floor((done / totalCount) * 100)));
  }

  async _buildBackgroundAutoRefreshPlan(players) {
    const rows = this.steamPlaytimeRepo?.getManyBySteamIDs
      ? await this.steamPlaytimeRepo.getManyBySteamIDs(players.map((player) => player.steamID))
      : new Map();
    const cooldownMs = Math.max(0, this.autoRefreshCooldownMinutes) * 60_000;
    const nowTs = now();
    const selectedTargets = [];
    const skippedItems = [];

    for (const player of players) {
      const cached = rows.get(player.steamID);
      const fetchedAt = Number(cached?.fetched_at || 0) || 0;
      const ageMs = fetchedAt > 0 ? Math.max(0, nowTs - fetchedAt) : Number.POSITIVE_INFINITY;
      const hasCache = Boolean(cached);
      const isFresh = fetchedAt > 0 && cooldownMs > 0 && ageMs < cooldownMs;
      const shouldRefresh = this.autoRefreshMissingOnly ? !hasCache : !isFresh;
      if (!shouldRefresh) {
        skippedItems.push({
          steamID: player.steamID,
          playerName: player.name || null,
          fetchedAt: fetchedAt || null,
          ageMinutes: Number.isFinite(ageMs) ? Math.floor(ageMs / 60_000) : null,
          reason: this.autoRefreshMissingOnly ? "已有 Steam 时长缓存" : `最近 ${this.autoRefreshCooldownMinutes} 分钟内已刷新`,
        });
        continue;
      }
      selectedTargets.push({
        ...player,
        fetchedAt: fetchedAt || null,
        ageMs: Number.isFinite(ageMs) ? ageMs : null,
      });
      if (selectedTargets.length >= this.autoRefreshBatchSize) break;
    }

    return { selectedTargets, skippedItems };
  }

  async startBackgroundAutoRefresh({
    getOnlinePlayers,
    playerDatabase = this.playerDatabase,
  } = {}) {
    this.backgroundAutoRefreshGetOnlinePlayers = getOnlinePlayers || this.backgroundAutoRefreshGetOnlinePlayers;
    this.backgroundAutoRefreshPlayerDatabase = playerDatabase || this.backgroundAutoRefreshPlayerDatabase || this.playerDatabase;

    if (this.backgroundAutoRefreshTimer) {
      clearInterval(this.backgroundAutoRefreshTimer);
      this.backgroundAutoRefreshTimer = null;
    }

    if (!this.autoRefreshEnabled || typeof this.backgroundAutoRefreshGetOnlinePlayers !== "function") {
      return;
    }

    const tick = () => this._runBackgroundAutoRefreshTick().catch((error) => {
      this.logger?.warn(`Background playtime refresh tick failed: ${error.message}`, {
        operation: "playtimeBackgroundRefresh",
      });
    });

    this.backgroundAutoRefreshTimer = setInterval(() => {
      tick();
    }, this.autoRefreshIntervalMs);

    void tick();
  }

  async stopBackgroundAutoRefresh() {
    if (this.backgroundAutoRefreshTimer) {
      clearInterval(this.backgroundAutoRefreshTimer);
      this.backgroundAutoRefreshTimer = null;
    }
    this.backgroundAutoRefreshRunning = false;
  }

  async _runBackgroundAutoRefreshTick() {
    if (!this.autoRefreshEnabled) return;
    if (this.backgroundAutoRefreshRunning) return;
    if (typeof this.backgroundAutoRefreshGetOnlinePlayers !== "function") return;

    this.backgroundAutoRefreshRunning = true;
    try {
      const players = collectPlayersWithSteamID(await this.backgroundAutoRefreshGetOnlinePlayers());
      if (!players.length) return;

      const { selectedTargets, skippedItems } = await this._buildBackgroundAutoRefreshPlan(players);
      if (!selectedTargets.length) return;

      const job = this._createJob("online-refresh-auto", {
        playerCount: players.length,
        force: false,
        source: "background",
        auto: true,
      });

      this._initJobProgress(job, {
        phase: "scan",
        message: `后台扫描到 ${players.length} 名在线玩家`,
        total: players.length,
      });
      this._pushJobEvent(job, {
        phase: "scan",
        status: "success",
        total: players.length,
        message: `后台扫描到 ${players.length} 名在线玩家`,
      });
      for (const skipped of skippedItems) {
        this._pushJobEvent(job, {
          phase: "filter",
          status: "skipped",
          steamID: skipped.steamID,
          playerName: skipped.playerName,
          message: `${skipped.playerName || skipped.steamID} ${skipped.reason}`,
        });
      }

      await this._runJob(job, async () => this._executeOnlineRefreshJob(job, {
        total: selectedTargets.length + skippedItems.length,
        selectedTargets,
        skippedItems,
        playerDatabase: this.backgroundAutoRefreshPlayerDatabase || this.playerDatabase,
      }));
    } finally {
      this.backgroundAutoRefreshRunning = false;
    }
  }

  async _fetchSteamDuration(steamID) {
    if (this.usePythonScript) {
      try {
        return await this._fetchSteamDurationViaPython(steamID);
      } catch (error) {
        if (!this.scriptFallbackToApi) throw error;
        this.logger?.warn(`Python Steam lookup failed, falling back to API: ${error.message}`, {
          operation: "steamLookup",
          data: { steamID },
        });
      }
    }

    if (!this.apiKey) throw new Error("Steam API key is not configured.");
    return this._fetchSteamDurationFromApi(steamID);
  }

  async _fetchSteamDurationViaPython(steamID) {
    if (!fs.existsSync(this.pythonScriptPath)) {
      throw new Error(`Python lookup script not found: ${this.pythonScriptPath}`);
    }

    const timeoutMs = this.scriptTimeoutMs;
    const timeoutSeconds = Math.max(1, Math.ceil(this.requestTimeoutMs / 1000));
    const args = [
      this.pythonScriptPath,
      steamID,
      "--config", this.pythonConfigPath,
      "--app-id", String(this.appId),
      "--timeout", String(timeoutSeconds),
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonBin, args, {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGTERM");
        } catch {}
        reject(new Error(`Python Steam lookup timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk?.toString?.() || "";
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk?.toString?.() || "";
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Failed to start python process: ${error.message}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const text = String(stdout || "").trim();
        const lastLine = text.split(/\r?\n/u).filter(Boolean).pop() || "";
        let payload = null;
        try {
          payload = JSON.parse(lastLine || "{}");
        } catch {
          payload = null;
        }

        if (!payload || typeof payload !== "object") {
          const stderrText = String(stderr || "").trim();
          reject(new Error(`Python lookup returned invalid output${stderrText ? `: ${stderrText}` : ""}`));
          return;
        }

        if (code !== 0 || payload.error) {
          reject(new Error(String(payload.error || `Python lookup failed with exit code ${code}`)));
          return;
        }

        resolve(buildLookupResult({
          steamID: normalizeSteamID(payload.steamID || steamID),
          appId: Number(payload.appId) || this.appId,
          gameName: String(payload.gameName || "Squad"),
          gameSeconds: Number(payload.gameSeconds || 0),
          found: Boolean(payload.found),
        }));
      });
    });
  }

  async _fetchSteamDurationFromApi(steamID) {
    const maxAttempts = this.retryCount + 1;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const payloadWithFilter = await this._requestOwnedGames(steamID, { withAppFilter: true });
        let games = Array.isArray(payloadWithFilter?.response?.games) ? payloadWithFilter.response.games : [];
        let match = games.find((game) => Number(game?.appid) === this.appId) || null;

        if (!match) {
          const payloadWithoutFilter = await this._requestOwnedGames(steamID, { withAppFilter: false });
          games = Array.isArray(payloadWithoutFilter?.response?.games) ? payloadWithoutFilter.response.games : [];
          match = games.find((game) => Number(game?.appid) === this.appId) || null;
        }

        return buildLookupResult({
          steamID,
          appId: this.appId,
          gameName: match?.name || "Squad",
          gameSeconds: Number(match?.playtime_forever || 0) * 60,
          found: Boolean(match),
        });
      } catch (error) {
        lastError = error;
        const canRetry = attempt < maxAttempts && this._isRetryableSteamError(error);
        if (!canRetry) break;
        await delay(this.retryDelayMs * attempt);
      }
    }

    throw lastError || new Error("Steam API request failed.");
  }

  _isRetryableSteamError(error) {
    if (!error) return false;
    if (error?.statusCode && [429, 500, 502, 503, 504].includes(Number(error.statusCode))) return true;
    const message = String(error?.message || "").toLowerCase();
    return message.includes("timed out") || message.includes("network") || message.includes("fetch failed");
  }

  async _requestOwnedGames(steamID, { withAppFilter } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const params = new URLSearchParams({
      key: this.apiKey,
      steamid: steamID,
      include_appinfo: "1",
      include_played_free_games: "1",
    });
    if (withAppFilter) params.append("appids_filter[0]", String(this.appId));

    try {
      const response = await fetch(
        `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?${params.toString()}`,
        {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        },
      );

      if (!response.ok) {
        const error = new Error(`Steam API request failed with status ${response.status}.`);
        error.statusCode = response.status;
        throw error;
      }

      return await response.json();
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`Steam API request timed out after ${this.requestTimeoutMs}ms.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  _createJob(type, input) {
    const id = `steam-${now()}-${++this.jobCounter}`;
    const job = {
      id,
      type,
      status: "queued",
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      input: input || {},
      result: null,
      error: null,
      progress: this._normalizeJobProgress({
        phase: "queued",
        message: "等待开始",
        total: 0,
        selected: 0,
        skipped: 0,
        queued: 0,
        running: 0,
        updated: 0,
        failed: 0,
        percent: 0,
        events: [],
      }),
      waiters: new Set(),
    };

    this.jobs.set(id, job);
    this.jobOrder.push(id);
    this._pruneJobs();
    return job;
  }

  async _runJob(job, runner) {
    job.status = "running";
    job.startedAt = now();
    this._notifyJobWaiters(job);
    this.logger?.info(`Steam playtime job started: ${job.type}`, {
      operation: "playtimeJobStart",
      data: { jobId: job.id, input: job.input },
    });

    try {
      job.result = await runner();
      job.status = "completed";
      job.finishedAt = now();
      this.logger?.info(`Steam playtime job completed: ${job.type}`, {
        operation: "playtimeJobComplete",
        data: { jobId: job.id, result: summarizeJobResult(job.result) },
      });
    } catch (error) {
      job.error = { message: error?.message || "Unknown error" };
      job.status = "failed";
      job.finishedAt = now();
      await this.steamPlaytimeRepo?.addRefreshLog?.({
        jobId: job.id,
        jobType: job.type,
        status: "failed",
        message: job.error.message,
      });
      this.logger?.warn(`Steam playtime job failed: ${job.type} ${job.error.message}`, {
        operation: "playtimeJobFailed",
        data: { jobId: job.id },
      });
    } finally {
      this._notifyJobWaiters(job);
    }
  }

  _publicJob(job) {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      input: job.input,
      result: job.result,
      error: job.error,
      progress: this._normalizeJobProgress(job.progress || {}),
    };
  }

  _notifyJobWaiters(job) {
    for (const waiter of [...job.waiters]) {
      job.waiters.delete(waiter);
      try {
        waiter();
      } catch {}
    }
  }

  _pruneJobs() {
    while (this.jobOrder.length > MAX_JOB_HISTORY) {
      const oldestId = this.jobOrder.shift();
      if (!oldestId) break;
      const job = this.jobs.get(oldestId);
      if (!job) continue;
      if (job.status === "queued" || job.status === "running") {
        this.jobOrder.push(oldestId);
        break;
      }
      this.jobs.delete(oldestId);
    }
  }

  _enqueueLookup(task) {
    return new Promise((resolve, reject) => {
      this.lookupQueue.push({ task, resolve, reject });
      this._pumpLookupQueue();
    });
  }

  _pumpLookupQueue() {
    while (this.activeLookups < this.maxConcurrent && this.lookupQueue.length) {
      const next = this.lookupQueue.shift();
      this.activeLookups += 1;
      Promise.resolve()
        .then(() => next.task())
        .then((value) => next.resolve(value))
        .catch((error) => next.reject(error))
        .finally(() => {
          this.activeLookups = Math.max(0, this.activeLookups - 1);
          this._pumpLookupQueue();
        });
    }
  }
}

export function createPlaytimeModule({ core, modules, config, logger }) {
  let db = null;
  let repo = null;
  let service = null;

  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.playtime",
    source: "module.playtime",
    channel: "module",
  });

  async function getOnlinePlayers(serverId = core.webStatus.serverId) {
    const players = modules.playerState?.getOnlinePlayers(serverId) ?? [];
    return players.map((player) => ({
      name: player?.name || null,
      steamID: optionalSteamID(player?.steamID || player?.steam64 || player?.SteamID),
      eosID: cleanText(player?.eosID || player?.eos || player?.EOSID),
    })).filter((player) => player.steamID);
  }

  const api = {
    getStatus() {
      return {
        ...(service?.getStatus?.() ?? { configured: false }),
        databaseReady: Boolean(db),
      };
    },

    getJob(jobId) {
      return service?.getJob(jobId) ?? null;
    },

    async waitForJob(jobId, waitMs) {
      return service?.waitForJob(jobId, waitMs) ?? null;
    },

    async lookupSteamID(steamID, options = {}) {
      const lookup = await service.lookupSteamDuration(steamID, {
        lastSeenName: options.lastSeenName || null,
      });
      return lookup;
    },

    createLookupJob(payload = {}) {
      return service.createLookupJob(payload);
    },

    async refreshPlayer(payload = {}) {
      const steamID = normalizeSteamID(payload.steamID);
      const job = service.createLookupJob({
        steamID,
        label: payload.label || payload.name || steamID,
        player: {
          name: payload.name || payload.currentName || null,
          steamID,
          eosID: payload.eosID || null,
        },
      });
      return job;
    },

    async refreshOnline({ serverId = core.webStatus.serverId, force = false } = {}) {
      const players = await getOnlinePlayers(serverId);
      return service.createOnlineRefreshJob({
        players,
        playerDatabase: modules.playerDatabase,
        force: Boolean(force),
        cooldownMinutes: service.manualRefreshCooldownMinutes,
        missingOnly: false,
        source: "manual",
      });
    },

    async getBySteamID(steamID) {
      return repo.getBySteamID(steamID);
    },

    async listRecentLogs(options = {}) {
      return repo.listRecentLogs(options);
    },

    async enrichPlayers(players = []) {
      const ids = players.map((player) => optionalSteamID(player?.steamID || player?.steam64 || player?.SteamID)).filter(Boolean);
      const playtimes = await repo.getManyBySteamIDs(ids);
      return players.map((player) => {
        const steamID = optionalSteamID(player?.steamID || player?.steam64 || player?.SteamID);
        const playtime = steamID ? playtimes.get(steamID) : null;
        if (!playtime) return player;
        const gameSeconds = Number(playtime.game_seconds || 0);
        return {
          ...player,
          gameSeconds,
          gameHours: Number((gameSeconds / 3600).toFixed(2)),
          steamPlaytime: {
            steamID: playtime.steam_id,
            appId: Number(playtime.app_id || DEFAULT_APP_ID),
            gameName: playtime.game_name || "Squad",
            gameSeconds,
            gameHours: Number((gameSeconds / 3600).toFixed(2)),
            fetchedAt: Number(playtime.fetched_at || 0) || null,
            lastSeenName: playtime.last_seen_name || null,
          },
        };
      });
    },
  };

  return {
    manifest: {
      id: "module.playtime",
      name: "Playtime Module",
      kind: "module",
      version: "0.2.0",
      description: "Steam Squad playtime lookup module. Queries Steam playtime, stores snapshots in a dedicated SQLite database, and exposes refresh APIs for online players and individual player windows.",
    },
    apiName: "playtime",
    api,

    async init() {
      const moduleConfig = config.get("modules.playtime", {});
      const steamConfig = resolveSteamConfig(config, moduleConfig);
      const dbConfig = {
        ...(config.get("steamPlaytimeDatabase", {}) ?? {}),
        ...(moduleConfig.database ?? {}),
      };

      db = await createSteamPlaytimeDatabase(dbConfig);
      repo = new SteamPlaytimeRepository(db);
      service = new SteamGameDurationService({
        ...steamConfig,
        steamPlaytimeRepo: repo,
        playerDatabase: modules.playerDatabase,
        logger: moduleLogger,
      });

      await service.startBackgroundAutoRefresh({
        getOnlinePlayers,
        playerDatabase: modules.playerDatabase,
      });

      moduleLogger?.info("Steam playtime module initialized.", {
        operation: "init",
        data: {
          configured: service.isConfigured(),
          appId: service.appId,
          pythonScriptPath: service.pythonScriptPath,
          pythonConfigPath: service.pythonConfigPath,
        },
      });
    },

    async stop() {
      await service?.stopBackgroundAutoRefresh?.();
      await db?.close();
    },
  };
}

function resolveSteamConfig(config, moduleConfig = {}) {
  const legacyConfigPath = path.resolve(
    process.cwd(),
    moduleConfig.legacyConfigPath || moduleConfig.steam?.legacyConfigPath || "./MicePanel/config.json",
  );
  const legacy = readLegacySteamConfig(legacyConfigPath);
  const explicit = config.get("steam", {});
  const local = moduleConfig.steam ?? {};
  const merged = {
    ...legacy.steam,
    ...explicit,
    ...local,
  };

  if (legacy.configPath) {
    const legacyDir = path.dirname(legacy.configPath);
    if (!merged.pythonScript || merged.pythonScript === "FetchGameDuration.py") {
      merged.pythonScript = path.join(legacyDir, "FetchGameDuration.py");
    }
    if (!merged.pythonConfigPath || merged.pythonConfigPath === "config.json") {
      merged.pythonConfigPath = legacy.configPath;
    }
  }

  return merged;
}

function readLegacySteamConfig(configPath) {
  try {
    if (!fs.existsSync(configPath)) return { steam: null, configPath: null };
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      steam: raw?.steam && typeof raw.steam === "object" ? raw.steam : null,
      configPath,
    };
  } catch {
    return { steam: null, configPath: null };
  }
}

function collectPlayersWithSteamID(players = []) {
  const result = [];
  const seen = new Set();
  for (const player of players) {
    const steamID = optionalSteamID(player?.steamID || player?.steam64 || player?.SteamID || player?.steam_id);
    if (!steamID || seen.has(steamID)) continue;
    seen.add(steamID);
    result.push({
      ...player,
      steamID,
      eosID: cleanText(player?.eosID || player?.eos_id || player?.EOSID),
      name: cleanText(player?.name || player?.current_name),
    });
  }
  return result;
}

function summarizeJobResult(result) {
  if (!result || typeof result !== "object") return result;
  return {
    total: result.total,
    selected: result.selected,
    updated: result.updated,
    failed: result.failed,
    skipped: result.skipped,
    lookup: result.lookup ? {
      steamID: result.lookup.steamID,
      gameHours: result.lookup.gameHours,
      found: result.lookup.found,
    } : undefined,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
