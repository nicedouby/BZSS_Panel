// -*- coding: utf-8 -*-

import { LogClock } from "./log-clock.js";

/**
 * Core: WebStatus
 *
 * 顶部状态栏的全局状态源。
 *
 * 所有页面顶部都显示这里的数据。
 */
export class WebStatus {
  constructor({ config }) {
    this.config = config;
    this.serverId = config.get("server.id", "BZSS_Main");
    this.serverName = config.get("server.name", "BZSS Main Server");
    const warmupEnabled = config.get("warmup.enabled", false) === true;

    const logClockFallbackSeconds = Number(config.get("logClock.fallbackSeconds", 600));
    this.logClock = new LogClock({
      fallbackSeconds: Number.isFinite(logClockFallbackSeconds) ? logClockFallbackSeconds : 600,
    });
    this.serverTickRateConfig = {
      expected: Number(config.get("serverTickRate.expected", 30)),
      warningBelow: Number(config.get("serverTickRate.warningBelow", 28)),
      criticalBelow: Number(config.get("serverTickRate.criticalBelow", 20)),
      staleAfterSeconds: Number(config.get("serverTickRate.staleAfterSeconds", 10)),
    };
    this.playerIdentityDisplayConfig = {
      showIpInList: config.get("playerIdentityDisplay.showIpInList", true) !== false,
      showIpInDetail: config.get("playerIdentityDisplay.showIpInDetail", true) !== false,
      showIpGeo: config.get("playerIdentityDisplay.showIpGeo", true) !== false,
    };

    this.state = {
      serverId: this.serverId,
      serverName: this.serverName,

      jsStarted: true,
      pythonLogParser: "unknown",
      udpReceiver: "unknown",
      rcon: "disabled",

      currentLayer: "Unknown",
      nextLayer: "",
      matchState: "Unknown",
      playerCount: 0,
      team1Count: 0,
      team2Count: 0,
      squadCount: 0,
      queueCount: 0,
      tps: null,
      tpsStatus: "unknown",
      lastTpsUpdateTime: null,

      rconQueue: 0,
      recentErrors: 0,
      logTime: null,
      isWarmup: warmupEnabled,
      warmupUpdatedAt: null,
      warmupUpdatedBy: null,

      updatedAt: new Date().toISOString(),
    };
  }

  set(key, value) {
    this.state[key] = value;
    this.state.updatedAt = new Date().toISOString();
  }

  patch(patch) {
    Object.assign(this.state, patch);
    this.state.updatedAt = new Date().toISOString();
  }

  applyServerTickRateUpdate(update) {
    this.patch({
      tps: Number.isFinite(update?.tps) ? Number(update.tps) : null,
      tpsStatus: String(update?.status ?? "unknown"),
      lastTpsUpdateTime: update?.time ?? new Date().toISOString(),
    });
  }

  getSnapshot() {
    const snapshot = { ...this.state };
    snapshot.tpsStatus = this.#resolveTpsStatus(snapshot);
    snapshot.serverTickRate = { ...this.serverTickRateConfig };
    snapshot.playerIdentityDisplay = { ...this.playerIdentityDisplayConfig };

    snapshot.logClockSeconds = this.logClock.getSeconds();
    snapshot.logClockHasAnchor = Boolean(this.logClock.hasAnchor);
    snapshot.logClockManual = Boolean(this.logClock.manual);
    snapshot.logClockAnchorLogTime = String(this.logClock.anchorLogTime || "");
    snapshot.logClockLastResetAt = String(this.logClock.lastResetAt || "");
    snapshot.logClockLastResetReason = String(this.logClock.lastResetReason || "");
    return snapshot;
  }

  setLogClockSeconds(seconds, meta = {}) {
    const next = this.logClock.setSeconds(seconds, meta);
    this.state.updatedAt = new Date().toISOString();
    return next;
  }

  resetLogClock(meta = {}) {
    this.logClock.resetToZero(meta);
    this.state.updatedAt = new Date().toISOString();
    return 0;
  }

  getWarmupState() {
    return {
      isWarmup: Boolean(this.state.isWarmup),
      updatedAt: this.state.warmupUpdatedAt,
      updatedBy: this.state.warmupUpdatedBy ?? null,
    };
  }

  async setWarmup(isWarmup, meta = {}) {
    const nextValue = Boolean(isWarmup);
    const previousValue = Boolean(this.state.isWarmup);
    const previousWarmupUpdatedAt = this.state.warmupUpdatedAt;
    const previousWarmupUpdatedBy = this.state.warmupUpdatedBy ?? null;
    const nextWarmupUpdatedAt = new Date().toISOString();
    const nextWarmupUpdatedBy = meta?.updatedBy ?? null;

    if (this.config?.set) {
      this.config.set("warmup.enabled", nextValue);
    }

    try {
      if (this.config?.save) {
        await this.config.save();
      }
    } catch (error) {
      if (this.config?.set) {
        this.config.set("warmup.enabled", previousValue);
      }
      this.state.isWarmup = previousValue;
      this.state.warmupUpdatedAt = previousWarmupUpdatedAt;
      this.state.warmupUpdatedBy = previousWarmupUpdatedBy;
      throw error;
    }

    this.patch({
      isWarmup: nextValue,
      warmupUpdatedAt: nextWarmupUpdatedAt,
      warmupUpdatedBy: nextWarmupUpdatedBy,
    });

    return this.getWarmupState();
  }

  #resolveTpsStatus(snapshot) {
    if (snapshot.tps == null || !snapshot.lastTpsUpdateTime) {
      return "unknown";
    }

    const updatedAtMs = Date.parse(snapshot.lastTpsUpdateTime);
    if (!Number.isFinite(updatedAtMs)) {
      return snapshot.tpsStatus || "unknown";
    }

    const staleAfterMs = Math.max(1, this.serverTickRateConfig.staleAfterSeconds) * 1000;
    if (Date.now() - updatedAtMs > staleAfterMs) {
      return "stale";
    }

    return snapshot.tpsStatus || "unknown";
  }
}
