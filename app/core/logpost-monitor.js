// -*- coding: utf-8 -*-

const DEFAULT_MAX_TRACKED_STREAMS = 32;
const DEFAULT_MAX_REORDER_DISTANCE = 64;

export class LogPostMonitor {
  constructor({ logger, maxTrackedStreams = DEFAULT_MAX_TRACKED_STREAMS, maxReorderDistance = DEFAULT_MAX_REORDER_DISTANCE } = {}) {
    this.logger = logger;
    this.maxTrackedStreams = Math.max(4, Number(maxTrackedStreams) || DEFAULT_MAX_TRACKED_STREAMS);
    this.maxReorderDistance = Math.max(1, Number(maxReorderDistance) || DEFAULT_MAX_REORDER_DISTANCE);

    // Compatibility fields: expose the most recently inspected stream through the old API.
    this.lastSourceSeq = 0;
    this.lastEventSeq = 0;
    this.lastSessionId = "";
    this.lastEventId = "";
    this.lastStreamKey = "";

    // UDP and FileBridge can ingest independent LogPost sequences at the same time.
    // Tracking by stream prevents one transport/session from corrupting another stream's sequence state.
    this.streamStates = new Map();

    this.recentEventGaps = [];
    this.recentSourceJumps = [];
    this.maxRecentGaps = 200;

    this.metrics = {
      inspectedEvents: 0,
      ignoredReplayEvents: 0,
      eventGapCount: 0,
      missingEventCount: 0,
      observationalEventGapCount: 0,
      observationalMissingEventCount: 0,
      duplicateEventCount: 0,
      outOfOrderEventCount: 0,
      sequenceResetCount: 0,
      sourceJumpCount: 0,
      skippedRawLines: 0,
      lastEventAt: "",
      lastEventLatencyMs: null,
      maxEventLatencyMs: 0,
      latencySamples: [],
    };
  }

  inspectEvent(event = {}) {
    const sourceMode = String(event?.sourceMode ?? event?.rawEvent?.SourceMode ?? "").trim().toLowerCase();
    const canTriggerActions = event?.canTriggerActions ?? event?.rawEvent?.CanTriggerActions;

    if (sourceMode && sourceMode !== "live") {
      this.metrics.ignoredReplayEvents += 1;
      return null;
    }
    if (canTriggerActions === false || String(canTriggerActions).toLowerCase() === "false") {
      this.metrics.ignoredReplayEvents += 1;
      return null;
    }

    this.metrics.inspectedEvents += 1;
    this.metrics.lastEventAt = new Date().toISOString();
    this.recordLatency(event);

    const serverId = String(event?.serverId ?? event?.rawEvent?.ServerID ?? "");
    const sessionId = String(event?.sessionId ?? event?.rawEvent?.SessionID ?? "");
    const transportSource = resolveTransportSource(event);
    const streamKey = buildStreamKey({ serverId, sessionId, transportSource });
    const stream = this.getOrCreateStreamState(streamKey, { serverId, sessionId, transportSource });

    const currentEventSeq = toPositiveNumber(
      event?.seq
      ?? event?.rawEvent?.Seq
      ?? event?.paramMap?.Seq
      ?? 0,
    );

    const currentSourceSeq = toPositiveNumber(
      event?.sourceSeq
      ?? event?.rawEvent?.SourceSeq
      ?? event?.paramMap?.SourceSeq
      ?? 0,
    );

    let gapEvent = null;

    if (currentEventSeq > 0) {
      if (stream.lastEventSeq > 0 && currentEventSeq === stream.lastEventSeq) {
        this.metrics.duplicateEventCount += 1;
      } else if (stream.lastEventSeq > 0 && currentEventSeq < stream.lastEventSeq) {
        const backwardsDistance = stream.lastEventSeq - currentEventSeq;
        if (backwardsDistance > this.maxReorderDistance) {
          // Parser restart or sequence reset without a new SessionID. Start a new baseline silently.
          this.metrics.sequenceResetCount += 1;
          stream.lastEventSeq = currentEventSeq;
          stream.lastSourceSeq = currentSourceSeq > 0 ? currentSourceSeq : 0;
        } else {
          // UDP is allowed to arrive out of order. Do not move the high-water mark backwards.
          this.metrics.outOfOrderEventCount += 1;
        }
      } else {
        if (stream.lastEventSeq > 0 && currentEventSeq > stream.lastEventSeq + 1) {
          const missingEventCount = currentEventSeq - stream.lastEventSeq - 1;

          // FileBridge reaches this monitor after cross-transport EventId de-duplication
          // and intentionally skips some high-volume telemetry paths. Its Event Seq view
          // is therefore sparse by design and cannot prove transport loss. Preserve the
          // observation for diagnostics without emitting a false loss event/WARN.
          if (transportSource === "file-bridge") {
            this.metrics.observationalEventGapCount += 1;
            this.metrics.observationalMissingEventCount += missingEventCount;
            this.logger?.debug?.(
              `LogPost observational event seq gap stream=${streamKey} expected=${stream.lastEventSeq + 1} actual=${currentEventSeq} missing=${missingEventCount}`,
            );
          } else {
            gapEvent = {
              eventName: "LOGPOST_EVENT_GAP_DETECTED",
              layer: "core",
              source: "core.logPostMonitor",
              time: new Date().toISOString(),
              serverId,
              sessionId,
              seq: String(currentEventSeq),
              sourceSeq: currentSourceSeq > 0 ? currentSourceSeq : "",
              payload: {
                streamKey,
                transportSource,
                expectedEventSeq: stream.lastEventSeq + 1,
                actualEventSeq: currentEventSeq,
                lastEventSeq: stream.lastEventSeq,
                missingEventCount,
                currentEventId: String(event?.eventId ?? ""),
                previousEventId: stream.lastEventId,
                sourceMode,
              },
            };

            this.metrics.eventGapCount += 1;
            this.metrics.missingEventCount += missingEventCount;
            this.recentEventGaps.unshift(gapEvent);
            trimArray(this.recentEventGaps, this.maxRecentGaps);

            this.logger?.warn?.(
              `LogPost event seq gap detected stream=${streamKey} expected=${stream.lastEventSeq + 1} actual=${currentEventSeq} missing=${missingEventCount}`,
            );
          }
        }

        stream.lastEventSeq = currentEventSeq;
      }
    }

    // SourceSeq jumps are observational only. Blacklists and filtered/raw-only lines legitimately create them.
    if (
      currentSourceSeq > 0
      && stream.lastSourceSeq > 0
      && currentSourceSeq > stream.lastSourceSeq + 1
    ) {
      const skippedRawLines = currentSourceSeq - stream.lastSourceSeq - 1;
      this.metrics.sourceJumpCount += 1;
      this.metrics.skippedRawLines += skippedRawLines;

      this.recentSourceJumps.unshift({
        time: new Date().toISOString(),
        serverId,
        sessionId,
        streamKey,
        transportSource,
        previousSourceSeq: stream.lastSourceSeq,
        currentSourceSeq,
        skippedRawLines,
        eventName: String(event?.eventName ?? ""),
        eventId: String(event?.eventId ?? ""),
      });
      trimArray(this.recentSourceJumps, this.maxRecentGaps);

      this.logger?.debug?.(
        `LogPost source seq jumped stream=${streamKey} skippedRawLines=${skippedRawLines} previous=${stream.lastSourceSeq} current=${currentSourceSeq}`,
      );
    }

    if (currentSourceSeq > 0 && currentSourceSeq >= stream.lastSourceSeq) {
      stream.lastSourceSeq = currentSourceSeq;
    }

    stream.lastEventId = String(event?.eventId ?? "");
    stream.lastSeenAt = Date.now();
    this.touchStream(streamKey, stream);
    this.updateCompatibilityState(streamKey, stream);

    return gapEvent;
  }

  getOrCreateStreamState(streamKey, identity) {
    const existing = this.streamStates.get(streamKey);
    if (existing) return existing;

    const state = {
      ...identity,
      lastEventSeq: 0,
      lastSourceSeq: 0,
      lastEventId: "",
      lastSeenAt: Date.now(),
    };
    this.streamStates.set(streamKey, state);
    this.pruneStreams();
    return state;
  }

  touchStream(streamKey, stream) {
    this.streamStates.delete(streamKey);
    this.streamStates.set(streamKey, stream);
  }

  pruneStreams() {
    while (this.streamStates.size > this.maxTrackedStreams) {
      const oldestKey = this.streamStates.keys().next().value;
      if (!oldestKey) break;
      this.streamStates.delete(oldestKey);
    }
  }

  updateCompatibilityState(streamKey, stream) {
    this.lastStreamKey = streamKey;
    this.lastSessionId = stream.sessionId;
    this.lastEventSeq = stream.lastEventSeq;
    this.lastSourceSeq = stream.lastSourceSeq;
    this.lastEventId = stream.lastEventId;
  }

  recordLatency(event) {
    const rawTime = event?.time ?? event?.rawEvent?.Time ?? event?.rawEvent?.time;
    const timestamp = Date.parse(String(rawTime ?? ""));
    if (!Number.isFinite(timestamp)) return;
    const latency = Math.max(0, Date.now() - timestamp);
    // Ignore obviously different clocks/timezones instead of poisoning diagnostics.
    if (latency > 24 * 60 * 60 * 1000) return;
    this.metrics.lastEventLatencyMs = latency;
    this.metrics.maxEventLatencyMs = Math.max(this.metrics.maxEventLatencyMs, latency);
    this.metrics.latencySamples.push(latency);
    if (this.metrics.latencySamples.length > 120) {
      this.metrics.latencySamples.splice(0, this.metrics.latencySamples.length - 120);
    }
  }

  getState() {
    const latencySamples = this.metrics.latencySamples;
    const streams = [...this.streamStates.entries()].map(([streamKey, stream]) => ({
      streamKey,
      serverId: stream.serverId,
      sessionId: stream.sessionId,
      transportSource: stream.transportSource,
      lastEventSeq: stream.lastEventSeq,
      lastSourceSeq: stream.lastSourceSeq,
      lastEventId: stream.lastEventId,
      lastSeenAt: stream.lastSeenAt ? new Date(stream.lastSeenAt).toISOString() : "",
    }));

    return {
      lastSourceSeq: this.lastSourceSeq,
      lastEventSeq: this.lastEventSeq,
      lastSessionId: this.lastSessionId,
      lastEventId: this.lastEventId,
      lastStreamKey: this.lastStreamKey,
      trackedStreams: streams,
      recentGaps: [...this.recentEventGaps],
      recentEventGaps: [...this.recentEventGaps],
      recentSourceJumps: [...this.recentSourceJumps],
      metrics: {
        ...this.metrics,
        trackedStreamCount: streams.length,
        latencySamples: undefined,
        averageEventLatencyMs: average(latencySamples),
        p95EventLatencyMs: percentile(latencySamples, 0.95),
      },
    };
  }
}

function resolveTransportSource(event) {
  const explicit = String(event?.transportSource ?? event?.ingestionTransport ?? "").trim().toLowerCase();
  if (explicit) return explicit;
  if (event?.fileBridgeSourcePath) return "file-bridge";
  if (event?.udpRemoteAddress || event?.udpRemotePort) return "udp";
  return "unknown";
}

function buildStreamKey({ serverId, sessionId, transportSource }) {
  return `${serverId || "default"}|${sessionId || "no-session"}|${transportSource || "unknown"}`;
}

function trimArray(values, maxLength) {
  if (values.length > maxLength) values.length = maxLength;
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}
