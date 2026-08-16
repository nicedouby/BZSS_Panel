// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_HISTORY_SIZE = 8640;
const DEFAULT_FINALIZE_GRACE_MS = 750;
const DEFAULT_MAX_TRACKED_SESSIONS = 4;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COMPACT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 30 * 1000;
const DEFAULT_MAX_BUFFERED_PACKETS_PER_SESSION = 100_000;
const MAX_BUFFERED_PACKETS_PER_SESSION = 1_000_000;

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
    maxBufferedPacketsPerSession = DEFAULT_MAX_BUFFERED_PACKETS_PER_SESSION,
    historyFilePath = "./data/logpost-packet-stats.jsonl",
    retentionMs = DEFAULT_RETENTION_MS,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
  } = {}) {
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.historySize = Math.max(120, Number(historySize) || DEFAULT_HISTORY_SIZE);
    this.finalizeGraceMs = Math.max(0, Number(finalizeGraceMs) || DEFAULT_FINALIZE_GRACE_MS);
    this.maxTrackedSessions = Math.max(2, Number(maxTrackedSessions) || DEFAULT_MAX_TRACKED_SESSIONS);
    this.maxBufferedPacketsPerSession = Math.max(
      3,
      Math.min(
        MAX_BUFFERED_PACKETS_PER_SESSION,
        Number(maxBufferedPacketsPerSession) || DEFAULT_MAX_BUFFERED_PACKETS_PER_SESSION,
      ),
    );
    this.historyFilePath = path.resolve(process.cwd(), String(historyFilePath || "./data/logpost-packet-stats.jsonl"));
    this.retentionMs = Math.max(60 * 60 * 1000, Number(retentionMs) || DEFAULT_RETENTION_MS);
    this.staleAfterMs = Math.max(15_000, Number(staleAfterMs) || DEFAULT_STALE_AFTER_MS);

    this.sessions = new Map();
    this.pendingFinalizations = new Map();
    this.history = [];
    this.current = null;
    this.lastUpdatedAt = "";
    this.lastCompactionAt = 0;
    this.persistChain = Promise.resolve();
    this.metrics = {
      businessPacketsObserved: 0,
      uniqueBusinessPacketsObserved: 0,
      duplicateBusinessPackets: 0,
      statPacketsObserved: 0,
      invalidTelemetryPackets: 0,
      staleStatPackets: 0,
      latePacketsAfterFinalize: 0,
      finalizedWindows: 0,
      persistedWindowsLoaded: 0,
      persistenceErrors: 0,
      totalExpectedPackets: 0,
      totalReceivedPackets: 0,
      totalLostPackets: 0,
      bufferPrunes: 0,
      bufferedPacketsDiscarded: 0,
      coalescedStatPackets: 0,
    };
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.historyFilePath), { recursive: true });
    let text = "";
    try {
      text = await fs.readFile(this.historyFilePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.metrics.persistenceErrors += 1;
        this.logger?.warn?.(`Unable to read LogPost packet history: ${error.message}`);
      }
    }

    const cutoff = Date.now() - this.retentionMs;
    const loaded = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (Number(row?.windowEndMs || 0) >= cutoff) loaded.push(row);
      } catch {
        this.metrics.persistenceErrors += 1;
      }
    }

    this.history = loaded.slice(-this.historySize);
    this.current = this.history.at(-1) ?? null;
    this.lastUpdatedAt = String(this.current?.finalizedAt ?? "");
    this.metrics.persistedWindowsLoaded = this.history.length;
    this.metrics.finalizedWindows = this.history.length;
    this.metrics.totalExpectedPackets = sumField(this.history, "sentPackets");
    this.metrics.totalReceivedPackets = sumField(this.history, "receivedPackets");
    this.metrics.totalLostPackets = sumField(this.history, "lostPackets");
    this.lastCompactionAt = Date.now();

    // Rewrite on startup so an old file never grows without bound.
    await this.compactPersistedHistory();
    this.onUpdate?.();
  }

  async close() {
    for (const pending of this.pendingFinalizations.values()) clearTimeout(pending.timer);
    this.pendingFinalizations.clear();
    await this.persistChain.catch(() => {});
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
    if (state.receivedSeqs.size > this.maxBufferedPacketsPerSession) {
      this.pruneSessionBuffer(sessionId, state, seq);
    }
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
    if (
      lastSeq < state.lastFinalizedSeq
      || (statSeq > 0 && state.lastStatSeq > 0 && statSeq <= state.lastStatSeq)
    ) {
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

    const pending = this.pendingFinalizations.get(sessionId);
    if (pending) {
      if (
        snapshot.statSeq > 0
        && pending.snapshot.statSeq > 0
        && snapshot.statSeq <= pending.snapshot.statSeq
      ) {
        this.metrics.staleStatPackets += 1;
        return false;
      }
      clearTimeout(pending.timer);
      this.metrics.coalescedStatPackets += 1;
    }

    const timer = setTimeout(() => {
      const active = this.pendingFinalizations.get(sessionId);
      if (!active || active.timer !== timer) return;
      this.pendingFinalizations.delete(sessionId);
      this.finalizeStat(snapshot);
    }, this.finalizeGraceMs);
    timer.unref?.();
    this.pendingFinalizations.set(sessionId, { timer, snapshot });
    return true;
  }

  finalizeStat(snapshot) {
    const state = this.sessions.get(snapshot.sessionId);
    if (!state) return;

    if (
      snapshot.lastSeq < state.lastFinalizedSeq
      || (snapshot.statSeq > 0 && state.lastStatSeq > 0 && snapshot.statSeq <= state.lastStatSeq)
    ) {
      this.metrics.staleStatPackets += 1;
      return;
    }

    let startSeq = 0;
    const endSeq = snapshot.lastSeq;
    if (state.lastFinalizedSeq > 0) {
      startSeq = state.lastFinalizedSeq + 1;
    } else if (snapshot.firstSeq > 0) {
      startSeq = snapshot.firstSeq;
    } else if (snapshot.reportedSent > 0 && endSeq > 0) {
      startSeq = Math.max(1, endSeq - snapshot.reportedSent + 1);
    }

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
    const effectiveWindowStartMs = state.lastWindowEndMs > 0
      ? state.lastWindowEndMs
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
    const cutoff = Date.now() - this.retentionMs;
    this.history = this.history
      .filter((row) => Number(row?.windowEndMs || 0) >= cutoff)
      .slice(-this.historySize);

    this.metrics.finalizedWindows += 1;
    this.metrics.totalExpectedPackets += expectedPackets;
    this.metrics.totalReceivedPackets += receivedPackets;
    this.metrics.totalLostPackets += lostPackets;

    if (endSeq > state.lastFinalizedSeq) state.lastFinalizedSeq = endSeq;
    state.lastWindowEndMs = snapshot.windowEndMs || Date.now();
    state.lastStatSeq = Math.max(state.lastStatSeq, snapshot.statSeq);
    state.lastStatAt = Date.now();

    for (const seq of state.receivedSeqs) {
      if (seq <= state.lastFinalizedSeq) state.receivedSeqs.delete(seq);
    }
    this.touchSession(snapshot.sessionId, state);
    this.persistPoint(point);

    if (lostPackets > 0) {
      this.logger?.warn?.(
        `LogPost UDP packet loss session=${snapshot.sessionId} seq=${startSeq}-${endSeq} sent=${expectedPackets} received=${receivedPackets} lost=${lostPackets} rate=${(lossRate * 100).toFixed(2)}%`,
      );
    }
    this.onUpdate?.();
  }

  persistPoint(point) {
    this.persistChain = this.persistChain
      .then(async () => {
        await fs.mkdir(path.dirname(this.historyFilePath), { recursive: true });
        await fs.appendFile(this.historyFilePath, `${JSON.stringify(point)}\n`, "utf8");
        if (Date.now() - this.lastCompactionAt >= DEFAULT_COMPACT_INTERVAL_MS) {
          await this.compactPersistedHistory();
        }
      })
      .catch((error) => {
        this.metrics.persistenceErrors += 1;
        this.logger?.warn?.(`Unable to persist LogPost packet history: ${error.message}`);
      });
  }

  async compactPersistedHistory() {
    const cutoff = Date.now() - this.retentionMs;
    const rows = this.history
      .filter((row) => Number(row?.windowEndMs || 0) >= cutoff)
      .slice(-this.historySize);
    const text = rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
    await fs.mkdir(path.dirname(this.historyFilePath), { recursive: true });
    await fs.writeFile(this.historyFilePath, text, "utf8");
    this.lastCompactionAt = Date.now();
  }

  getState() {
    const now = Date.now();
    const oneMinute = aggregateHistory(this.history, now - 60_000);
    const fiveMinutes = aggregateHistory(this.history, now - 5 * 60_000);
    const lifetimeExpected = this.metrics.totalExpectedPackets;
    const lifetimeLost = this.metrics.totalLostPackets;
    const lifetimeLossRate = lifetimeExpected > 0 ? lifetimeLost / lifetimeExpected : 0;

    return {
      status: lossStatus(this.current, this.staleAfterMs),
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
      history: this.history.slice(-120),
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
      pendingFinalizations: this.pendingFinalizations.size,
      maxBufferedPacketsPerSession: this.maxBufferedPacketsPerSession,
      retentionHours: this.retentionMs / 3_600_000,
      historyFilePath: this.historyFilePath,
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
      lastBufferPruneLogAt: 0,
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

  pruneSessionBuffer(sessionId, state, newestSeq) {
    const retainCount = Math.max(1, Math.floor(this.maxBufferedPacketsPerSession * 0.75));
    const pruneThrough = Math.max(state.lastFinalizedSeq, newestSeq - retainCount);
    let discarded = 0;
    for (const bufferedSeq of state.receivedSeqs) {
      if (bufferedSeq <= pruneThrough) {
        state.receivedSeqs.delete(bufferedSeq);
        discarded += 1;
      }
    }
    state.lastFinalizedSeq = Math.max(state.lastFinalizedSeq, pruneThrough);
    this.metrics.bufferPrunes += 1;
    this.metrics.bufferedPacketsDiscarded += discarded;

    const now = Date.now();
    if (now - state.lastBufferPruneLogAt >= 60_000) {
      state.lastBufferPruneLogAt = now;
      this.logger?.warn?.(
        `LogPost packet sequence buffer reached its safety limit for session=${sessionId}; discarded=${discarded} resumeAfterSeq=${state.lastFinalizedSeq}`,
      );
    }
  }

  deletePendingFinalization(sessionId) {
    const pending = this.pendingFinalizations.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingFinalizations.delete(sessionId);
  }

  pruneSessions() {
    while (this.sessions.size > this.maxTrackedSessions) {
      const oldestKey = this.sessions.keys().next().value;
      if (!oldestKey) break;
      this.sessions.delete(oldestKey);
      this.deletePendingFinalization(oldestKey);
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

function lossStatus(current, staleAfterMs) {
  if (!current) return "waiting";
  const windowEndMs = Number(current.windowEndMs || 0);
  if (!windowEndMs || Date.now() - windowEndMs > staleAfterMs) return "stale";
  const lossRate = Number(current.lossRate || 0);
  if (lossRate >= 0.05) return "critical";
  if (lossRate >= 0.01) return "warning";
  return "healthy";
}

function sumField(rows, field) {
  return rows.reduce((sum, row) => sum + Number(row?.[field] || 0), 0);
}

function toPositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}
