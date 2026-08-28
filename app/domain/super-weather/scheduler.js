// -*- coding: utf-8 -*-

import { compileTimeline, normalizeTimeline, resolveTimeline, weatherName } from "./timeline.js";
import { RconAnchoredClock } from "./rcon-clock.js";

export class SuperWeatherScheduler {
  constructor({ commandService, logger, tickIntervalMs = 1000, maxExtrapolationSeconds = 180,
    backwardJitterToleranceSeconds = 15, jumpThresholdSeconds = 5,
    commandRetryDelayMs = 5000, now, onStateChange } = {}) {
    this.commandService = commandService;
    this.logger = logger;
    this.tickIntervalMs = Math.max(250, Number(tickIntervalMs) || 1000);
    this.jumpThresholdSeconds = Math.max(0.5, Number(jumpThresholdSeconds) || 5);
    this.commandRetryDelayMs = Math.max(250, Number(commandRetryDelayMs) || 5000);
    this.onStateChange = onStateChange;
    this.clock = new RconAnchoredClock({ maxExtrapolationSeconds, backwardJitterToleranceSeconds, now });
    this.timer = null;
    this.busy = false;
    this.pendingReconcileReason = "";
    this.enabled = false;
    this.state = "DISABLED";
    this.activePresetId = null;
    this.activePresetVersion = null;
    this.activeTimeline = null;
    this.compiled = null;
    this.roundKey = "";
    this.lastSegmentId = "";
    this.lastWeather = null;
    this.lastCommand = "";
    this.lastCommandAt = "";
    this.lastAction = "";
    this.currentSegment = null;
    this.diagnostics = [];
    this.pendingRetry = null;
    this.retryNotBeforeMs = 0;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.evaluate(), this.tickIntervalMs);
    this.timer.unref?.();
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  restore(runtime = {}) {
    this.enabled = Boolean(runtime.enabled && runtime.activePresetId && Array.isArray(runtime.activeTimeline?.timeline));
    this.activePresetId = runtime.activePresetId ?? null;
    this.activePresetVersion = runtime.activeTimeline?.version ?? null;
    this.activeTimeline = runtime.activeTimeline
      ? { ...runtime.activeTimeline, timeline: normalizeTimeline(runtime.activeTimeline.timeline) }
      : null;
    try {
      this.compiled = this.enabled ? compileTimeline(this.activeTimeline.timeline) : null;
    } catch (error) {
      this.enabled = false;
      this.compiled = null;
      this.log("SUPER_WEATHER_ERROR", `Saved runtime timeline is invalid and was not resumed: ${error.message}`);
    }
    this.roundKey = String(runtime.roundKey ?? "");
    this.lastSegmentId = String(runtime.lastSegmentId ?? "");
    this.lastWeather = Number.isInteger(runtime.lastAppliedWeather) ? runtime.lastAppliedWeather : null;
    this.lastCommand = String(runtime.lastCommand ?? "");
    this.lastCommandAt = String(runtime.lastCommandAt ?? "");
    this.pendingRetry = null;
    this.retryNotBeforeMs = 0;
    this.state = this.enabled ? "WAITING_RCON" : "DISABLED";
    if (this.enabled) this.log("SUPER_WEATHER_RESTORE", "Runtime restored; waiting for a reliable RCON anchor.");
    this.notify();
  }

  async activate(preset) {
    this.activePresetId = preset.id;
    this.activePresetVersion = preset.version;
    this.activeTimeline = JSON.parse(JSON.stringify({
      ...preset,
      timeline: normalizeTimeline(preset.timeline),
    }));
    this.compiled = compileTimeline(this.activeTimeline.timeline);
    this.enabled = true;
    this.lastSegmentId = "";
    this.pendingRetry = null;
    this.retryNotBeforeMs = 0;
    this.state = Number.isFinite(this.clock.rawRconSeconds) ? "SYNCING" : "WAITING_RCON";
    this.log("SUPER_WEATHER_ACTIVATE", `Activated preset ${preset.name}.`, { presetId: preset.id, version: preset.version });
    this.notify();
    if (Number.isFinite(this.clock.getLogicalSeconds())) return this.reconcile("activate", { force: true });
    return this.getState();
  }

  stop() {
    this.enabled = false;
    this.state = "DISABLED";
    this.log("SUPER_WEATHER_STOP", "Scheduler stopped; current server weather was left unchanged.");
    this.notify();
    return this.getState();
  }

  async updateRcon(reportedSeconds, roundKey = "", metadata = {}) {
    const normalizedRoundKey = String(roundKey ?? "").trim();
    const roundChanged = Boolean(normalizedRoundKey && this.roundKey && normalizedRoundKey !== this.roundKey);
    if (roundChanged) this.resetRound(normalizedRoundKey);
    else if (normalizedRoundKey) this.roundKey = normalizedRoundKey;

    const numericReportedSeconds = Number(reportedSeconds);
    if (!Number.isFinite(this.clock.rawRconSeconds) && (!Number.isFinite(numericReportedSeconds) || numericReportedSeconds <= 0)) {
      this.state = this.enabled ? "WAITING_RCON" : this.state;
      this.log("SUPER_WEATHER_CLOCK_SYNC", "Ignored non-positive initial RCON anchor; waiting for a reliable value.", {
        reportedSeconds,
        observedAt: metadata.observedAt ?? "",
      });
      this.notify();
      return this.getState();
    }

    const wasStale = this.clock.clockState === "CLOCK_STALE";
    const update = this.clock.update(reportedSeconds, { jumpThresholdSeconds: this.jumpThresholdSeconds });
    if (update.ignoredJitter) {
      this.log("SUPER_WEATHER_CLOCK_SYNC", `Ignored backward RCON jitter (${update.backwardSeconds.toFixed(1)}s).`, update);
      return this.getState();
    }
    if (!update.accepted) return this.getState();

    this.log("SUPER_WEATHER_CLOCK_SYNC", `RCON anchor updated to ${Math.round(Number(reportedSeconds))}s.`, {
      ...update,
      observedAt: metadata.observedAt ?? "",
    });
    if (!this.enabled) {
      this.notify();
      return this.getState();
    }

    if (roundChanged || update.firstAnchor || wasStale) {
      const reason = roundChanged ? "round-reset" : wasStale ? "clock-recovered" : "initial-sync";
      return this.reconcile(reason, { force: true });
    }
    if (update.jumped) {
      // A coarse RCON sample can cross one or more zero-width Transition
      // nodes. Resolve the final Weather immediately, but do not resend when
      // the sample still belongs to the already-applied Weather segment.
      return this.reconcile("rcon-jump", { force: false });
    }
    this.state = "RUNNING";
    // Accepted samples are evaluated immediately. Waiting for the interval
    // tick can otherwise miss a boundary when RCON updates are sparse.
    return this.evaluate();
  }

  resetRound(roundKey) {
    this.roundKey = String(roundKey ?? "");
    this.clock.reset();
    this.lastSegmentId = "";
    this.lastWeather = null;
    this.lastAction = "";
    this.currentSegment = null;
    this.pendingRetry = null;
    this.retryNotBeforeMs = 0;
    this.state = this.enabled ? "WAITING_RCON" : "DISABLED";
    this.log("SUPER_WEATHER_ROUND_RESET", `Round reset detected (${this.roundKey || "unknown"}).`);
    this.notify();
  }

  async evaluate() {
    if (!this.enabled || !this.compiled || this.busy) return this.getState();
    const clockState = this.clock.getState();
    if (clockState.clockState === "CLOCK_STALE") {
      if (this.state !== "CLOCK_STALE") {
        this.state = "CLOCK_STALE";
        this.log("SUPER_WEATHER_CLOCK_STALE", "RCON anchor exceeded the safe extrapolation window; new weather actions paused.");
        this.notify();
      }
      return this.getState();
    }
    if (!Number.isFinite(clockState.logicalSeconds)) {
      this.state = "WAITING_RCON";
      return this.getState();
    }
    const resolved = resolveTimeline(this.compiled, clockState.logicalSeconds);
    this.currentSegment = resolved;
    if (this.state === "ERROR" && this.pendingRetry) {
      if (this.clock.now() < this.retryNotBeforeMs) return this.getState();
      if (resolved.segmentId === this.pendingRetry.segmentId) {
        return this.applyResolved(resolved, {
          reason: "command-retry",
          force: true,
          transitionSecondsOverride: this.pendingRetry.transitionSeconds,
        });
      }
      // The timeline moved beyond the failed target. Drop that stale retry
      // and synchronize only the final Weather that is valid now.
      this.pendingRetry = null;
      this.retryNotBeforeMs = 0;
    }
    if (resolved.segmentId !== this.lastSegmentId) {
      return this.applyResolved(resolved, { reason: "segment-crossing", force: false });
    }
    this.state = "RUNNING";
    return this.getState();
  }

  async reconcile(reason = "manual", options = {}) {
    if (!this.enabled || !this.compiled) return this.getState();
    if (this.busy) {
      this.pendingReconcileReason = String(reason || "pending-reconcile");
      return this.getState();
    }
    const logicalSeconds = this.clock.getLogicalSeconds();
    if (!Number.isFinite(logicalSeconds)) {
      this.state = "WAITING_RCON";
      this.notify();
      return this.getState();
    }
    if (this.clock.clockState === "CLOCK_STALE") {
      this.state = "CLOCK_STALE";
      this.notify();
      return this.getState();
    }
    const resolved = resolveTimeline(this.compiled, logicalSeconds);
    this.currentSegment = resolved;
    this.state = "SYNCING";
    this.log("SUPER_WEATHER_RECONCILE", `Reconcile started (${reason}).`, {
      segmentId: resolved.segmentId,
      logicalSeconds,
      transitionNodeSeconds: resolved.transitionNodeSeconds ?? resolved.transitionTotalSeconds ?? 0,
    });
    return this.applyResolved(resolved, { reason, force: options.force !== false });
  }

  getTransitionSeconds(resolved, { reason, previousSegmentId } = {}) {
    const nodeSeconds = Math.max(0, Math.ceil(Number(
      resolved.transitionNodeSeconds ?? resolved.transitionTotalSeconds ?? 0
    )));
    if (!nodeSeconds || !resolved.transitionNodeId) return 0;

    const previousIndex = this.compiled?.segments?.findIndex(
      (segment) => segment.id === previousSegmentId
    ) ?? -1;
    const crossedForward = previousIndex >= 0 && resolved.segmentIndex > previousIndex;

    // Both the local interpolated clock and coarse RCON samples use interval
    // crossing. If one or more nodes were crossed, execute only the final
    // Weather and pass that Weather's Transition node value unchanged.
    if (crossedForward && (reason === "segment-crossing" || reason === "rcon-jump")) {
      return nodeSeconds;
    }

    // Initial sync, restart recovery and manual reconciliation should not
    // replay an old Transition, except when the authoritative time is exactly
    // on the node.
    const atNode = Math.abs(
      Number(resolved.timelinePositionSeconds) - Number(resolved.startSeconds)
    ) < 0.001;
    return atNode ? nodeSeconds : 0;
  }

  async applyResolved(resolved, { reason, force, transitionSecondsOverride = null }) {
    if (this.busy) return this.getState();
    if (!force && resolved.segmentId === this.lastSegmentId) {
      // The force flag now has real meaning: ordinary RCON corrections inside
      // the same Weather segment must not resend SetWeather.
      if (this.pendingRetry) return this.getState();
      this.currentSegment = resolved;
      this.state = "RUNNING";
      this.notify();
      return this.getState();
    }
    this.busy = true;
    try {
      const previousSegmentId = this.lastSegmentId;
      const targetWeather = resolved.currentWeather;
      const transitionSeconds = Number.isFinite(transitionSecondsOverride)
        ? Math.max(0, Math.ceil(Number(transitionSecondsOverride)))
        : this.getTransitionSeconds(resolved, {
          reason,
          previousSegmentId,
        });

      this.currentSegment = resolved;

      const parameter = `${targetWeather},${Math.max(0, Math.ceil(transitionSeconds))}`;
      const command = `SetWeather:${parameter}`;
      let result;
      try {
        result = await this.commandService.execute({
          directive: "SetWeather",
          parameter,
          source: "bzss-super-weather",
        });
      } catch (error) {
        result = { ok: false, error: error?.message ?? String(error) };
      }
      this.lastCommand = command;
      this.lastCommandAt = new Date().toISOString();
      this.lastAction = reason;
      if (!result.ok) {
        this.state = "ERROR";
        this.pendingRetry = {
          segmentId: resolved.segmentId,
          transitionSeconds,
        };
        this.retryNotBeforeMs = this.clock.now() + this.commandRetryDelayMs;
        this.log("SUPER_WEATHER_ERROR", `Weather command ${command} failed: ${result.message ?? result.error}; retry scheduled.`, {
          command,
          result,
          retryDelayMs: this.commandRetryDelayMs,
        });
        this.notify();
        return this.getState();
      }
      this.lastSegmentId = resolved.segmentId;
      this.lastWeather = targetWeather;
      this.pendingRetry = null;
      this.retryNotBeforeMs = 0;
      this.state = "RUNNING";
      this.log("SUPER_WEATHER_SET_WEATHER", `${command} (${reason}).`, {
        command,
        segmentId: resolved.segmentId,
        weatherName: weatherName(targetWeather),
        transitionNodeSeconds: resolved.transitionNodeSeconds ?? resolved.transitionTotalSeconds ?? 0,
        appliedTransitionSeconds: transitionSeconds,
      });
      this.notify();
      return this.getState();
    } finally {
      this.busy = false;
      const pendingReason = this.pendingReconcileReason;
      this.pendingReconcileReason = "";
      if (pendingReason && this.enabled) {
        queueMicrotask(() => void this.reconcile(pendingReason, { force: true }));
      }
    }
  }

  async testWeather(weatherType, transitionSeconds = 0) {
    const weather = Number(weatherType);
    const transition = Math.max(0, Math.ceil(Number(transitionSeconds) || 0));
    const command = `SetWeather:${weather},${transition}`;
    const result = await this.commandService.execute({
      directive: "SetWeather",
      parameter: `${weather},${transition}`,
      source: "bzss-super-weather-test",
    });
    this.log(result.ok ? "SUPER_WEATHER_SET_WEATHER" : "SUPER_WEATHER_ERROR",
      `Test command ${command} ${result.ok ? "succeeded" : "failed"}.`, { command, result });
    this.notify();
    return result;
  }

  log(type, message, data = null) {
    const entry = { at: new Date().toISOString(), type, message, data };
    this.diagnostics.unshift(entry);
    if (this.diagnostics.length > 100) this.diagnostics.length = 100;
    const method = type === "SUPER_WEATHER_ERROR" ? "error" : type === "SUPER_WEATHER_CLOCK_STALE" ? "warn" : "info";
    this.logger?.[method]?.(`[SuperWeather] ${message}`, { operation: type, data });
  }

  notify() {
    this.onStateChange?.(this.getRuntimeState());
  }

  getRuntimeState() {
    return {
      enabled: this.enabled,
      activePresetId: this.activePresetId,
      activeTimeline: this.activeTimeline,
      roundKey: this.roundKey,
      lastAppliedWeather: this.lastWeather,
      lastSegmentId: this.lastSegmentId,
      lastCommand: this.lastCommand,
      lastCommandAt: this.lastCommandAt,
      clockState: this.state,
    };
  }

  getState() {
    const clock = this.clock.getState();
    const current = Number.isFinite(clock.logicalSeconds) && this.compiled
      ? resolveTimeline(this.compiled, clock.logicalSeconds)
      : this.currentSegment;
    return {
      running: this.enabled,
      activePresetId: this.activePresetId,
      activePresetVersion: this.activePresetVersion,
      roundKey: this.roundKey,
      ...clock,
      clockState: this.state === "DISABLED" ? "DISABLED" : clock.clockState === "CLOCK_STALE" ? "CLOCK_STALE" : this.state,
      currentSegment: current,
      nextSegment: current?.nextSegment ?? null,
      nextActionSeconds: current?.nextSegment?.startSeconds ?? null,
      lastWeather: this.lastWeather,
      lastCommand: this.lastCommand,
      lastCommandAt: this.lastCommandAt,
      lastAction: this.lastAction,
      totalDurationSeconds: this.compiled?.totalDurationSeconds ?? 0,
      diagnostics: [...this.diagnostics],
    };
  }
}
