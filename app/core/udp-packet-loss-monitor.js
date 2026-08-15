// -*- coding: utf-8 -*-

const DEFAULT_HISTORY_SIZE = 180;
const DEFAULT_FINALIZE_GRACE_MS = 750;
const DEFAULT_MAX_TRACKED_SESSIONS = 4;

/**
 * Compares LogPost EVENT PacketSeq values against periodic STAT snapshots.
 *
 * The sender's PacketSeq is contiguous only for business packets successfully
 * handed to sendto(). STAT packets never consume PacketSeq, so the resulting
 * loss rate describes the local UDP delivery path instead of parser filtering.
 */
export class UdpPacketLossMonitor {
  constructor({
    logger = null,
    onUpdate = null,
    historySize = DEFAULT_HISTORY_SIZE,
    finalizeGraceMs = DEFAULT_FINALIZE_GRACE_MS,
    maxTrackedSessions = DEFAULT_MAX_TRACKED_SESSIONS,
  } = {}) {
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.historySize = Math.max(30, Number(historySize) || DEFAULT_HISTORY_SIZE);
    this.finalizeGraceMs = Math.max(0, Number(finalizeGraceMs) || DEFAULT_FINALIZE_GRACE_MS);
    this.maxTrackedSessions = Math.max(2, Number(maxTrackedSessions) || DEFAULT_MAX_TRACKED_SESSIONS);

    this.sessions = new Map();
    this.pendingTimers = new Set();
    this.history = [];
    this.current = null;
    this.lastUpdatedAt = "";
    this.metrics = {
      businessPacketsObserved: 0,
      uniqueBusinessPacketsObserved: 0,
      duplicateBusinessPackets: 0,
      statPacketsObserved: 0,
      invalidTelemetryPackets: 0,
      staleStatPackets: 0,
      latePacketsAfterFinalize: 0,
      finalizedWindows: 0,
      totalExpectedPackets: 0,
      totalReceivedPackets: 0,
      totalLostPackets: 0,
    };
  }

  recordEvent(rawEvent = {}) {
    if (String(rawEvent?.PacketType ?? "").toUpperCase() !== "EVENT") return false;
    const sessionId = String(rawEvent?.PacketSessionId ?? "").trim();
    const seq = toPositiveInteger(rawEvent?.PacketSeq);
    if (!sessionId || seq <= 0) {
      this.metrics.invalidTelemetryPackets += 1;
      return false;
    }

    this.metrics.businessPacketsObserved += 1;
    const state = this.getOrCreateSession(sessionId);
    if (seq <= state.lastFinalizedSeq) {
      this.metrics.latePacketsAfterFinalize += 1;
      return false;
    }
    if (state.receivedSeqs.has(seq)) {
      this.metrics.duplicateBusinessPackets += 1;
      return false;
    }

    state.receivedSeqs.add(seq);
    state.highestReceivedSeq = Math.max(state.highestReceivedSeq, seq);
    state.lastEventAt = Date.now();
    this.metrics.uniqueBusinessPacketsObserved += 1;
    this.touchSession(sessionId, state);
    return true;
  }

  recordStat(rawEvent = {}) {
    if (String(rawEvent?.PacketType ?? "").toUpperCase() !== "STAT") return false;
    this.metrics.statPacketsObserved += 1;

    const sessionId = String(rawEvent?.PacketSessionId ?? "").trim();
    const lastSeq = toNonNegativeInteger(rawEvent?.LastSeq);
    const firstSeq = toNonNegativeInteger(rawEvent?.FirstSeq);
    const reportedSent = toNonNegativeInteger(rawEvent?.SentPackets);
    const statSeq = toNonNegativeInteger(rawEvent?.StatSeq);
    const windowStartMs = toNonNegativeInteger(rawEvent?.WindowStartMs);
    const windowEndMs = toNonNegativeInteger(rawEvent?.WindowEndMs) || Date.now();

    if (!sessionId) {
      this.metrics.invalidTelemetryPackets += 1;
      return false;
    }

    const state = this.getOrCreateSession(sessionId);
    if (lastSeq < state.lastFinalizedSeq) {
      this.metrics.staleStatPackets += 1;
      return false;
    }

    const snapshot = {
      sessionId,
      statSeq,
      firstSeq,
      lastSeq,
      reportedSent,
      totalSent: toNonNegativeInteger(rawEvent?.TotalSent),
      windowStartMs,
      windowEndMs,
      receivedAtMs: Date.now(),
    };

    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.finalizeStat(snapshot);
    }, this.finalizeGraceMs);
    timer.unref?.();
    this.pendingTimers.add(timer);
    return true;
  }

  finalizeStat(snapshot) {
    const state = this.sessions.get(snapshot.sessionId);
    if (!state) return;

    if (snapshot.lastSeq < state.lastFinalizedSeq) {
      this.metrics.staleStatPackets += 1;
      return;
    }

    let startSeq = 0;
    let endSeq = snapshot.lastSeq;
    if (state.lastFinalizedSeq > 0) {
      startSeq = state.lastFinalizedSeq + 1;
    } else if (snapshot.firstSeq > 0) {
      startSeq = snapshot.firstSeq;
    } else if (snapshot.reportedSent > 0 && endSeq > 0) {
      startSeq = Math.max(1, endSeq - snapshot.reportedSent + 1);
    }

    // A zero-traffic report is still useful for showing that telemetry is alive.
    const expectedPackets = startSeq > 0 && endSeq >= startSeq
      ? endSeq - startSeq + 1
      : 0;

    let receivedPackets = 0;
    let lostPackets = 0;
    let maxConsecutiveLost = 0;
    let consecutiveLost = 0;

    if (expectedPackets > 0) {
      for (let seq = startSeq; seq <= endSeq; seq += 1) {
        if (state.receivedSeqs.has(seq)) {
          receivedPackets += 1;
          consecutiveLost = 0;
        } else {
          lostPackets += 1;
          consecutiveLost += 1;
          maxConsecutiveLost = Math.max(maxConsecutiveLost, consecutiveLost);
        }
      }
    }

    const lossRate = expectedPackets > 0 ? lostPackets / expectedPackets : 0;
    const previousWindowEndMs = state.lastWindowEndMs;
    const effectiveWindowStartMs = previousWindowEndMs > 0
      ? Math.min(snapshot.windowEndMs, previousWindowEndMs)
      : snapshot.windowStartMs;

    const point = {
      sessionId: snapshot.sessionId,
      statSeq: snapshot.statSeq,
      windowStartMs: effectiveWindowStartMs || snapshot.receivedAtMs,
      windowEndMs: snapshot.windowEndMs || snapshot.receivedAtMs,
      finalizedAt: new Date().toISOString(),
      firstSeq: startSeq,
      lastSeq: endSeq,
      sentPackets: expectedPackets,
      reportedSentPackets: snapshot.reportedSent,
      receivedPackets,
      lostPackets,
      lossRate,
      lossRatePercent: lossRate * 100,
      maxConsecutiveLost,
      totalSent: snapshot.totalSent,
    };

    this.current = point;
    this.lastUpdatedAt = point.finalizedAt;
    this.history.push(point);
    if (this.history.length > this.historySize) {
      this.history.splice(0, this.history.length - this.historySize);
    }

    this.metrics.finalizedWindows += 1;
    this.metrics.totalExpectedPackets += expectedPackets;
    this.metrics.totalReceivedPackets += receivedPackets;
    this.metrics.totalLostPackets += lostPackets;

    if (endSeq > state.lastFinalizedSeq) state.lastFinalizedSeq = endSeq;
    state.lastWindowEndMs = snapshot.windowEndMs || Date.now();
    state.lastStatSeq = Math.max(state.lastStatSeq, snapshot.statSeq);
    state.lastStatAt = Date.now();

    // Everything through the finalized high-water mark is no longer needed.
    for (const seq of state.receivedSeqs) {
      if (seq <= state.lastFinalizedSeq) state.receivedSeqs.delete(seq);
    }
    this.touchSession(snapshot.sessionId, state);

    if (lostPackets > 0) {
      this.logger?.warn?.(
        `LogPost UDP packet loss session=${snapshot.sessionId} seq=${startSeq}-${endSeq} sent=${expectedPackets} received=${receivedPackets} lost=${lostPackets} rate=${(lossRate * 100).toFixed(2)}%`,
      );
    }
    this.onUpdate?.();
  }

  getState() {
    const now = Date.now();
    const oneMinute = aggregateHistory(this.history, now - 60_000);
    const fiveMinutes = aggregateHistory(this.history, now - 5 * 60_000);
    const lifetimeExpected = this.metrics.totalExpectedPackets;
    const lifetimeLost = this.metrics.totalLostPackets;
    const lifetimeLossRate = lifetimeExpected > 0 ? lifetimeLost / lifetimeExpected : 0;

    return {
      status: lossStatus(this.current?.lossRate ?? null),
      current: this.current ? { ...this.current } : null,
      oneMinute,
      fiveMinutes,
      lifetime: {
        sentPackets: lifetimeExpected,
        receivedPackets: this.metrics.totalReceivedPackets,
        lostPackets: lifetimeLost,
        lossRate: lifetimeLossRate,
        lossRatePercent: lifetimeLossRate * 100,
      },
      lastUpdatedAt: this.lastUpdatedAt,
      history: this.history.slice(-60),
      metrics: { ...this.metrics },
      sessions: [...this.sessions.entries()].map(([sessionId, state]) => ({
        sessionId,
        lastFinalizedSeq: state.lastFinalizedSeq,
        highestReceivedSeq: state.highestReceivedSeq,
        bufferedPackets: state.receivedSeqs.size,
        lastEventAt: state.lastEventAt ? new Date(state.lastEventAt).toISOString() : "",
        lastStatAt: state.lastStatAt ? new Date(state.lastStatAt).toISOString() : "",
      })),
      finalizeGraceMs: this.finalizeGraceMs,
    };
  }

  getOrCreateSession(sessionId) {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const state = {
      receivedSeqs: new Set(),
      highestReceivedSeq: 0,
      lastFinalizedSeq: 0,
      lastWindowEndMs: 0,
      lastStatSeq: 0,
      lastEventAt: 0,
      lastStatAt: 0,
    };
    this.sessions.set(sessionId, state);
    this.pruneSessions();
    return state;
  }

  touchSession(sessionId, state) {
    this.sessions.delete(sessionId);
    this.sessions.set(sessionId, state);
    this.pruneSessions();
  }

  pruneSessions() {
    while (this.sessions.size > this.maxTrackedSessions) {
      const oldestKey = this.sessions.keys().next().value;
      if (!oldestKey) break;
      this.sessions.delete(oldestKey);
    }
  }
}

function aggregateHistory(history, cutoffMs) {
  const rows = history.filter((row) => Number(row.windowEndMs || 0) >= cutoffMs);
  const sentPackets = rows.reduce((sum, row) => sum + Number(row.sentPackets || 0), 0);
  const receivedPackets = rows.reduce((sum, row) => sum + Number(row.receivedPackets || 0), 0);
  const lostPackets = rows.reduce((sum, row) => sum + Number(row.lostPackets || 0), 0);
  const lossRate = sentPackets > 0 ? lostPackets / sentPackets : 0;
  return {
    windows: rows.length,
    sentPackets,
    receivedPackets,
    lostPackets,
    lossRate,
    lossRatePercent: lossRate * 100,
    maxConsecutiveLost: rows.reduce((max, row) => Math.max(max, Number(row.maxConsecutiveLost || 0)), 0),
  };
}

function lossStatus(lossRate) {
  if (lossRate == null) return "waiting";
  if (lossRate >= 0.05) return "critical";
  if (lossRate >= 0.01) return "warning";
  return "healthy";
}

function toPositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}
