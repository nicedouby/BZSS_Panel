// -*- coding: utf-8 -*-

import { performance } from "node:perf_hooks";

export class RconAnchoredClock {
  constructor({ maxExtrapolationSeconds = 180, backwardJitterToleranceSeconds = 15, now = () => performance.now() } = {}) {
    this.maxExtrapolationSeconds = Math.max(1, Number(maxExtrapolationSeconds) || 180);
    this.backwardJitterToleranceSeconds = Math.max(0, Number(backwardJitterToleranceSeconds) || 15);
    this.now = now;
    this.reset();
  }

  reset() {
    this.rawRconSeconds = null;
    this.previousRconSeconds = null;
    this.anchorSeconds = null;
    this.anchorMonotonicMs = null;
    this.anchorWallTime = "";
    this.lastRconUpdateAt = "";
    this.lastDriftSeconds = 0;
    this.clockState = "WAITING_RCON";
  }

  update(reportedSeconds, options = {}) {
    const reported = Number(reportedSeconds);
    const at = Number(options.nowMs ?? this.now());
    if (!Number.isFinite(reported) || reported < 0) {
      return { accepted: false, reason: "invalid", clockState: this.clockState };
    }

    const logicalBefore = this.getLogicalSeconds(at);
    const previous = this.rawRconSeconds;
    if (Number.isFinite(previous) && reported === previous) {
      return {
        accepted: false,
        duplicate: true,
        logicalSeconds: logicalBefore,
        clockState: this.clockState,
      };
    }
    const backward = Number.isFinite(previous) ? previous - reported : 0;
    if (backward > 0 && backward <= this.backwardJitterToleranceSeconds) {
      return {
        accepted: false,
        ignoredJitter: true,
        backwardSeconds: backward,
        logicalSeconds: logicalBefore,
        clockState: this.clockState,
      };
    }

    const driftSeconds = Number.isFinite(logicalBefore) ? reported - logicalBefore : 0;
    this.previousRconSeconds = previous;
    this.rawRconSeconds = reported;
    this.anchorSeconds = reported;
    this.anchorMonotonicMs = at;
    this.anchorWallTime = new Date().toISOString();
    this.lastRconUpdateAt = this.anchorWallTime;
    this.lastDriftSeconds = driftSeconds;
    this.clockState = "RUNNING";
    return {
      accepted: true,
      firstAnchor: !Number.isFinite(previous),
      driftSeconds,
      jumped: Number.isFinite(logicalBefore) && Math.abs(driftSeconds) >= Number(options.jumpThresholdSeconds ?? 2),
      backwardSeconds: Math.max(0, backward),
      logicalBefore,
      logicalSeconds: reported,
      clockState: this.clockState,
    };
  }

  getLogicalSeconds(nowMs = this.now()) {
    if (!Number.isFinite(this.anchorSeconds) || !Number.isFinite(this.anchorMonotonicMs)) return null;
    const elapsed = Math.max(0, (Number(nowMs) - this.anchorMonotonicMs) / 1000);
    if (elapsed > this.maxExtrapolationSeconds) {
      this.clockState = "CLOCK_STALE";
      return this.anchorSeconds + this.maxExtrapolationSeconds;
    }
    this.clockState = "RUNNING";
    return this.anchorSeconds + elapsed;
  }

  getState(nowMs = this.now()) {
    const logicalSeconds = this.getLogicalSeconds(nowMs);
    return {
      rawRconSeconds: this.rawRconSeconds,
      previousRconSeconds: this.previousRconSeconds,
      anchorSeconds: this.anchorSeconds,
      anchorWallTime: this.anchorWallTime,
      logicalSeconds,
      lastRconUpdateAt: this.lastRconUpdateAt,
      clockDriftSeconds: this.lastDriftSeconds,
      clockState: this.clockState,
    };
  }
}
