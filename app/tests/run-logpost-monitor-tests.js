import assert from "node:assert/strict";

import { LogPostMonitor } from "../core/logpost-monitor.js";

function createEvent({ seq, sourceSeq = seq, transportSource, sessionId = "session-1", serverId = "BZSS_Main", eventId = `evt-${transportSource}-${seq}` }) {
  return {
    eventId,
    eventName: "On_RawLogLine",
    serverId,
    sessionId,
    seq: String(seq),
    sourceSeq: String(sourceSeq),
    sourceMode: "live",
    canTriggerActions: true,
    transportSource,
    time: new Date().toISOString(),
  };
}

function testIndependentTransportStreamsDoNotCrossTriggerGaps() {
  const warnings = [];
  const monitor = new LogPostMonitor({ logger: { warn(message) { warnings.push(message); }, debug() {} } });

  assert.equal(monitor.inspectEvent(createEvent({ seq: 64952, transportSource: "file-bridge" })), null);
  assert.equal(monitor.inspectEvent(createEvent({ seq: 15195, transportSource: "udp" })), null);
  assert.equal(monitor.inspectEvent(createEvent({ seq: 64953, transportSource: "file-bridge" })), null);
  assert.equal(monitor.inspectEvent(createEvent({ seq: 15196, transportSource: "udp" })), null);

  const state = monitor.getState();
  assert.equal(state.metrics.eventGapCount, 0);
  assert.equal(state.metrics.trackedStreamCount, 2);
  assert.equal(warnings.length, 0);
}

function testBackwardUdpPacketIsNotReportedAsGap() {
  const monitor = new LogPostMonitor({ logger: { warn() {}, debug() {} } });

  monitor.inspectEvent(createEvent({ seq: 100, transportSource: "udp" }));
  const gap = monitor.inspectEvent(createEvent({ seq: 103, transportSource: "udp" }));
  assert.equal(gap?.payload?.missingEventCount, 2);
  assert.equal(monitor.inspectEvent(createEvent({ seq: 101, transportSource: "udp" })), null);

  const state = monitor.getState();
  assert.equal(state.metrics.eventGapCount, 1);
  assert.equal(state.metrics.outOfOrderEventCount, 1);
  assert.equal(state.lastEventSeq, 103);
}

function testLargeBackwardJumpResetsBaselineWithoutGapStorm() {
  const monitor = new LogPostMonitor({ logger: { warn() {}, debug() {} }, maxReorderDistance: 16 });

  monitor.inspectEvent(createEvent({ seq: 65000, transportSource: "file-bridge", sessionId: "" }));
  assert.equal(monitor.inspectEvent(createEvent({ seq: 15000, transportSource: "file-bridge", sessionId: "" })), null);
  assert.equal(monitor.inspectEvent(createEvent({ seq: 15001, transportSource: "file-bridge", sessionId: "" })), null);

  const state = monitor.getState();
  assert.equal(state.metrics.sequenceResetCount, 1);
  assert.equal(state.metrics.eventGapCount, 0);
  assert.equal(state.lastEventSeq, 15001);
}

testIndependentTransportStreamsDoNotCrossTriggerGaps();
testBackwardUdpPacketIsNotReportedAsGap();
testLargeBackwardJumpResetsBaselineWithoutGapStorm();

console.log("run-logpost-monitor-tests: ok");
