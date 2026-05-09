// -*- coding: utf-8 -*-

/**
 * Core: LogClock
 *
 * A monotonic-ish wall-clock timer used to approximate "log time" / match runtime.
 * - Starts from a fallback value on process boot (default 10 minutes).
 * - Resets to 0 when a log anchor (e.g. SeamlessTravel) is detected.
 * - Can be manually edited by operators from the web UI.
 */
export class LogClock {
  constructor(options = {}) {
    const fallbackSeconds = Number(options.fallbackSeconds ?? 600);
    this.fallbackSeconds = Number.isFinite(fallbackSeconds) && fallbackSeconds >= 0 ? fallbackSeconds : 600;

    this.anchorAtMs = Date.now() - this.fallbackSeconds * 1000;
    this.hasAnchor = false;
    this.manual = false;
    this.anchorLogTime = "";
    this.anchorRawLog = "";
    this.lastResetAt = new Date().toISOString();
    this.lastResetReason = "startup";
  }

  getSeconds(nowMs = Date.now()) {
    const elapsedMs = Number(nowMs) - Number(this.anchorAtMs);
    if (!Number.isFinite(elapsedMs)) return 0;
    return Math.max(0, Math.floor(elapsedMs / 1000));
  }

  setSeconds(seconds, { reason = "manual", anchorLogTime = "", anchorRawLog = "" } = {}) {
    const nextSeconds = clampSeconds(seconds);
    this.anchorAtMs = Date.now() - nextSeconds * 1000;
    this.manual = reason === "manual";
    this.hasAnchor = !this.manual;
    this.anchorLogTime = String(anchorLogTime ?? "");
    this.anchorRawLog = String(anchorRawLog ?? "");
    this.lastResetAt = new Date().toISOString();
    this.lastResetReason = String(reason ?? "") || "manual";
    return this.getSeconds();
  }

  resetToZero({ reason = "anchor", anchorLogTime = "", anchorRawLog = "" } = {}) {
    this.anchorAtMs = Date.now();
    this.hasAnchor = true;
    this.manual = false;
    this.anchorLogTime = String(anchorLogTime ?? "");
    this.anchorRawLog = String(anchorRawLog ?? "");
    this.lastResetAt = new Date().toISOString();
    this.lastResetReason = String(reason ?? "") || "anchor";
    return 0;
  }
}

function clampSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  // keep it within a sane range (7 days)
  return Math.min(Math.floor(seconds), 7 * 24 * 3600);
}

