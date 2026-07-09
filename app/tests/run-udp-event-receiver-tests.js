import assert from "node:assert/strict";

import { UdpEventReceiver } from "../core/udp-event-receiver.js";

function createHarness() {
  const emitted = [];
  let pipelineCalls = 0;
  let inspectCalls = 0;

  const receiver = new UdpEventReceiver({
    config: {
      host: "127.0.0.1",
      port: 12345,
      maxMessageBytes: 65535,
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

  receiver.handleMessage(Buffer.from(JSON.stringify(rawEvent), "utf8"), {
    address: "127.0.0.1",
    port: 10000,
  });

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

  receiver.handleMessage(Buffer.from(JSON.stringify(rawEvent), "utf8"), {
    address: "127.0.0.1",
    port: 10001,
  });

  assert.equal(counts.pipelineCalls, 1);
  assert.equal(counts.inspectCalls, 1);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].eventName, "LOGPOST_EVENT_GAP_DETECTED");
  assert.equal(emitted[1].eventName, "On_RawLogLine");
}

testChunkFastPath();
testRegularEventStillUsesPipeline();

console.log("run-udp-event-receiver-tests: ok");
