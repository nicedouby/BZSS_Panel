// -*- coding: utf-8 -*-

export class LogPostMonitor {
  constructor({ logger } = {}) {
    this.logger = logger;

    // SourceSeq = 原始日志行序号，只能用于观察“两个事件之间跳过了多少原始日志行”
    this.lastSourceSeq = 0;

    // Event Seq = Python 发出的业务事件序号，这个才用于检测真正的 UDP/事件投递 gap
    this.lastEventSeq = 0;

    this.lastSessionId = "";
    this.lastEventId = "";

    this.recentEventGaps = [];
    this.recentSourceJumps = [];
    this.maxRecentGaps = 200;
  }

  inspectEvent(event = {}) {
    const sourceMode = String(event?.sourceMode ?? event?.rawEvent?.SourceMode ?? "").trim().toLowerCase();
    const canTriggerActions = event?.canTriggerActions ?? event?.rawEvent?.CanTriggerActions;

    if (sourceMode && sourceMode !== "live") return null;
    if (canTriggerActions === false || String(canTriggerActions).toLowerCase() === "false") return null;

    const sessionId = String(event?.sessionId ?? event?.rawEvent?.SessionID ?? "");

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

    if (sessionId && sessionId !== this.lastSessionId) {
      this.lastSessionId = sessionId;
      this.lastEventSeq = 0;
      this.lastSourceSeq = 0;
      this.lastEventId = "";
    }

    let gapEvent = null;

    // 真正需要 WARN 的只有 Event Seq gap。
    // 这代表 Python 已经发出的业务事件，在 Node 收到时不连续。
    if (
      currentEventSeq > 0
      && this.lastEventSeq > 0
      && currentEventSeq !== this.lastEventSeq + 1
    ) {
      gapEvent = {
        eventName: "LOGPOST_EVENT_GAP_DETECTED",
        layer: "core",
        source: "core.logPostMonitor",
        time: new Date().toISOString(),
        serverId: String(event?.serverId ?? ""),
        sessionId,
        seq: String(currentEventSeq),
        sourceSeq: currentSourceSeq > 0 ? currentSourceSeq : "",
        payload: {
          expectedEventSeq: this.lastEventSeq + 1,
          actualEventSeq: currentEventSeq,
          lastEventSeq: this.lastEventSeq,
          currentEventId: String(event?.eventId ?? ""),
          previousEventId: this.lastEventId,
          sourceMode,
        },
      };

      this.recentEventGaps.unshift(gapEvent);
      if (this.recentEventGaps.length > this.maxRecentGaps) {
        this.recentEventGaps.length = this.maxRecentGaps;
      }

      this.logger?.warn?.(
        `LogPost event seq gap detected expected=${this.lastEventSeq + 1} actual=${currentEventSeq}`,
      );
    }

    // SourceSeq 跳跃不是错误。它只说明中间有原始日志行没有投递到 Node。
    // blacklist、unknown、raw_log_output=false 都会造成这种跳跃。
    if (
      currentSourceSeq > 0
      && this.lastSourceSeq > 0
      && currentSourceSeq > this.lastSourceSeq + 1
    ) {
      const skippedRawLines = currentSourceSeq - this.lastSourceSeq - 1;

      this.recentSourceJumps.unshift({
        time: new Date().toISOString(),
        serverId: String(event?.serverId ?? ""),
        sessionId,
        previousSourceSeq: this.lastSourceSeq,
        currentSourceSeq,
        skippedRawLines,
        eventName: String(event?.eventName ?? ""),
        eventId: String(event?.eventId ?? ""),
      });

      if (this.recentSourceJumps.length > this.maxRecentGaps) {
        this.recentSourceJumps.length = this.maxRecentGaps;
      }

      this.logger?.debug?.(
        `LogPost source seq jumped skippedRawLines=${skippedRawLines} previous=${this.lastSourceSeq} current=${currentSourceSeq}`,
      );
    }

    if (currentEventSeq > 0) {
      this.lastEventSeq = currentEventSeq;
    }

    if (currentSourceSeq > 0) {
      this.lastSourceSeq = currentSourceSeq;
    }

    this.lastEventId = String(event?.eventId ?? "");

    return gapEvent;
  }

  getState() {
    return {
      lastSourceSeq: this.lastSourceSeq,
      lastEventSeq: this.lastEventSeq,
      lastSessionId: this.lastSessionId,
      lastEventId: this.lastEventId,
      recentGaps: [...this.recentEventGaps],
      recentEventGaps: [...this.recentEventGaps],
      recentSourceJumps: [...this.recentSourceJumps],
    };
  }
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}