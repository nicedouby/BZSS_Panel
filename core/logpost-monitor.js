// -*- coding: utf-8 -*-

export class LogPostMonitor {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.lastSourceSeq = 0;
    this.lastEventId = "";
    this.recentGaps = [];
    this.maxRecentGaps = 200;
  }

  inspectEvent(event = {}) {
    const currentSeq = Number(
      event?.sourceSeq
      ?? event?.rawEvent?.SourceSeq
      ?? event?.paramMap?.SourceSeq
      ?? 0,
    );
    if (!Number.isFinite(currentSeq) || currentSeq <= 0) return null;

    let gapEvent = null;
    if (this.lastSourceSeq > 0 && currentSeq !== this.lastSourceSeq + 1) {
      gapEvent = {
        eventName: "LOGPOST_GAP_DETECTED",
        layer: "core",
        source: "core.logPostMonitor",
        time: new Date().toISOString(),
        serverId: String(event?.serverId ?? ""),
        sessionId: String(event?.sessionId ?? ""),
        seq: String(event?.seq ?? ""),
        sourceSeq: currentSeq,
        payload: {
          expectedSourceSeq: this.lastSourceSeq + 1,
          actualSourceSeq: currentSeq,
          lastSourceSeq: this.lastSourceSeq,
          currentEventId: String(event?.eventId ?? ""),
          previousEventId: this.lastEventId,
        },
      };
      this.recentGaps.unshift(gapEvent);
      if (this.recentGaps.length > this.maxRecentGaps) {
        this.recentGaps.length = this.maxRecentGaps;
      }
      this.logger?.warn?.(
        `LogPost source seq gap detected expected=${this.lastSourceSeq + 1} actual=${currentSeq}`,
      );
    }

    this.lastSourceSeq = currentSeq;
    this.lastEventId = String(event?.eventId ?? "");
    return gapEvent;
  }

  getState() {
    return {
      lastSourceSeq: this.lastSourceSeq,
      lastEventId: this.lastEventId,
      recentGaps: [...this.recentGaps],
    };
  }
}
