import assert from "node:assert/strict";

import { UdpEventReceiver } from "../core/udp-event-receiver.js";
import { UdpPacketLossMonitor } from "../core/udp-packet-loss-monitor.js";

function createHarness() {
  const emitted = [];
  let pipelineCalls = 0;
  let inspectCalls = 0;

  const receiver = new UdpEventReceiver({
    config: {
      host: "127.0.0.1",
      port: 12345,
      maxMessageBytes: 65535,
      // Keep the timer from finalizing during this synchronous unit test.
      packetStatsFinalizeGraceMs: 60_000,
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    eventBus: {
      emitCoreEvent(eventName, event) {
        emitted.push({ eventName, event });
      },
    },
    webStatus: {
      set() {},
    },
    eventPipeline: {
      processRawGameEvent(rawEvent) {
        pipelineCalls += 1;
        return {
          eventName: rawEvent.Event,
          rawEvent,
        };
      },
    },
    logPostMonitor: {
      inspectEvent(event) {
        inspectCalls += 1;
        return event.eventName === "On_RawLogLine"
          ? { eventName: "LOGPOST_EVENT_GAP_DETECTED", gap: true }
          : null;
      },
    },
  });

  return {
    receiver,
    emitted,
    counts: {
      get pipelineCalls() {
        return pipelineCalls;
      },
      get inspectCalls() {
        return inspectCalls;
      },
    },
  };
}

function remote(port = 10000) {
  return { address: "127.0.0.1", port };
}

function testChunkFastPath() {
  const { receiver, emitted, counts } = createHarness();
  const rawEvent = {
    Event: "On_BzssCorePlayerChunk",
    EventId: "evt-1",
    ServerID: "BZSS_Main",
    SessionID: "session-1",
    Seq: "17",
    SourceSeq: "5",
    Time: "2026-07-09T10:00:00.000Z",
    Tick: "123",
    Count: "1",
    Players: [[7, 0, 0, 1, 2, 3, 4, 55, "Alpha", 9, 1, 2]],
    SourceMode: "live",
    CanTriggerActions: "true",
    IsReplay: "false",
  };

  receiver.handleMessage(Buffer.from(JSON.stringify(rawEvent), "utf8"), remote());

  assert.equal(counts.pipelineCalls, 0);
  assert.equal(counts.inspectCalls, 0);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, "On_BzssCorePlayerChunk");
  assert.equal(emitted[0].event.seq, "17");
  assert.equal(emitted[0].event.tick, "123");
  assert.equal(emitted[0].event.count, "1");
  assert.deepEqual(emitted[0].event.rawEvent.Players, rawEvent.Players);
}

function testRegularEventStillUsesPipeline() {
  const { receiver, emitted, counts } = createHarness();
  const rawEvent = {
    Event: "On_RawLogLine",
    EventId: "evt-2",
    ServerID: "BZSS_Main",
    SessionID: "session-1",
    Seq: "18",
    SourceSeq: "6",
    Time: "2026-07-09T10:00:01.000Z",
    Raw: "PIE: Error: PlayerBaseInfo{}",
  };

  receiver.handleMessage(Buffer.from(JSON.stringify(rawEvent), "utf8"), remote(10001));

  assert.equal(counts.pipelineCalls, 1);
  assert.equal(counts.inspectCalls, 1);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].eventName, "LOGPOST_EVENT_GAP_DETECTED");
  assert.equal(emitted[1].eventName, "On_RawLogLine");
}

function testStatPacketNeverEntersBusinessPipeline() {
  const { receiver, emitted, counts } = createHarness();
  const stat = {
    Event: "LOGPOST_PACKET_STAT",
    PacketType: "STAT",
    PacketSessionId: "sender-a",
    StatSeq: "1",
    WindowStartMs: "1000",
    WindowEndMs: "11000",
    FirstSeq: "1",
    LastSeq: "3",
    SentPackets: "3",
    TotalSent: "3",
  };

  receiver.handleMessage(Buffer.from(JSON.stringify(stat), "utf8"), remote(10002));

  assert.equal(counts.pipelineCalls, 0);
  assert.equal(counts.inspectCalls, 0);
  assert.equal(emitted.length, 0);
  assert.equal(receiver.getDiagnostics().packetLoss.metrics.statPacketsObserved, 1);
}

function createLossMonitor() {
  const monitor = new UdpPacketLossMonitor({ finalizeGraceMs: 0 });
  // Unit tests exercise calculation only; persistence is covered by the
  // production path and should not write into the repository test checkout.
  monitor.persistPoint = () => {};
  return monitor;
}

function businessPacket(sessionId, seq) {
  return {
    Event: "On_RawLogLine",
    PacketType: "EVENT",
    PacketSessionId: sessionId,
    PacketSeq: String(seq),
  };
}

function statSnapshot(sessionId, statSeq, firstSeq, lastSeq, reportedSent = lastSeq - firstSeq + 1) {
  return {
    sessionId,
    statSeq,
    firstSeq,
    lastSeq,
    reportedSent,
    totalSent: lastSeq,
    windowStartMs: 1_000 * statSeq,
    windowEndMs: 1_000 * statSeq + 10_000,
    receivedAtMs: 1_000 * statSeq + 10_001,
  };
}

function testLossCalculationUsesUniquePacketSequence() {
  const monitor = createLossMonitor();
  monitor.recordEvent(businessPacket("sender-a", 1));
  monitor.recordEvent(businessPacket("sender-a", 1)); // duplicate must not inflate received count
  monitor.recordEvent(businessPacket("sender-a", 3));
  monitor.finalizeStat(statSnapshot("sender-a", 1, 1, 3, 3));

  const state = monitor.getState();
  assert.equal(state.current.sentPackets, 3);
  assert.equal(state.current.receivedPackets, 2);
  assert.equal(state.current.lostPackets, 1);
  assert.equal(state.current.maxConsecutiveLost, 1);
  assert.equal(state.current.lossRate, 1 / 3);
  assert.equal(state.metrics.duplicateBusinessPackets, 1);
}

function testMissingStatCannotHideBusinessPacketGap() {
  const monitor = createLossMonitor();
  monitor.recordEvent(businessPacket("sender-a", 1));
  monitor.recordEvent(businessPacket("sender-a", 2));
  monitor.finalizeStat(statSnapshot("sender-a", 1, 1, 2, 2));

  // Pretend the next STAT packet was lost.  The following STAT says only two
  // packets were sent in its immediate window, but the receiver must span from
  // the last finalized high-water mark and therefore evaluate seq 3..5.
  monitor.recordEvent(businessPacket("sender-a", 3));
  monitor.recordEvent(businessPacket("sender-a", 5));
  monitor.finalizeStat(statSnapshot("sender-a", 3, 4, 5, 2));

  const state = monitor.getState();
  assert.equal(state.current.firstSeq, 3);
  assert.equal(state.current.lastSeq, 5);
  assert.equal(state.current.sentPackets, 3);
  assert.equal(state.current.receivedPackets, 2);
  assert.equal(state.current.lostPackets, 1);
}

function testPacketSequenceBufferStaysBoundedWithoutStats() {
  const monitor = new UdpPacketLossMonitor({
    finalizeGraceMs: 0,
    maxBufferedPacketsPerSession: 4,
  });
  monitor.persistPoint = () => {};

  for (let seq = 1; seq <= 20; seq += 1) {
    monitor.recordEvent(businessPacket("sender-a", seq));
  }

  const state = monitor.getState();
  assert.ok(state.sessions[0].bufferedPackets <= 4);
  assert.ok(state.metrics.bufferPrunes > 0);
  assert.ok(state.metrics.bufferedPacketsDiscarded > 0);
  assert.equal(state.maxBufferedPacketsPerSession, 4);
}

async function testPendingStatTimersAreCoalescedPerSession() {
  const monitor = new UdpPacketLossMonitor({ finalizeGraceMs: 60_000 });
  monitor.persistPoint = () => {};

  monitor.recordStat({
    PacketType: "STAT",
    PacketSessionId: "sender-a",
    StatSeq: "1",
    FirstSeq: "1",
    LastSeq: "1",
    SentPackets: "1",
  });
  monitor.recordStat({
    PacketType: "STAT",
    PacketSessionId: "sender-a",
    StatSeq: "2",
    FirstSeq: "2",
    LastSeq: "2",
    SentPackets: "1",
  });

  const state = monitor.getState();
  assert.equal(state.pendingFinalizations, 1);
  assert.equal(state.metrics.coalescedStatPackets, 1);
  await monitor.close();
  assert.equal(monitor.getState().pendingFinalizations, 0);
}

function testSenderRestartUsesIndependentSession() {
  const monitor = createLossMonitor();
  monitor.recordEvent(businessPacket("sender-a", 1));
  monitor.finalizeStat(statSnapshot("sender-a", 1, 1, 1, 1));

  monitor.recordEvent(businessPacket("sender-b", 1));
  monitor.finalizeStat(statSnapshot("sender-b", 1, 1, 1, 1));

  const state = monitor.getState();
  assert.equal(state.current.sessionId, "sender-b");
  assert.equal(state.current.sentPackets, 1);
  assert.equal(state.current.receivedPackets, 1);
  assert.equal(state.current.lostPackets, 0);
  assert.equal(state.sessions.length, 2);
}

testChunkFastPath();
testRegularEventStillUsesPipeline();
testStatPacketNeverEntersBusinessPipeline();
testLossCalculationUsesUniquePacketSequence();
testMissingStatCannotHideBusinessPacketGap();
testPacketSequenceBufferStaysBoundedWithoutStats();
await testPendingStatTimersAreCoalescedPerSession();
testSenderRestartUsesIndependentSession();

console.log("run-udp-event-receiver-tests: ok");
