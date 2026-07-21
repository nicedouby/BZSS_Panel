import assert from "node:assert/strict";

import { EventBus } from "../core/event-bus.js";

const logger = {
  debug() {},
  event() {},
  info() {},
  warn() {},
  error() {},
};

const eventBus = new EventBus({
  logger,
  coreEventDedupeTtlMs: 60_000,
  maxRecentCoreEventIds: 1000,
});

const received = [];
eventBus.onCoreEvent("On_RawLogLine", (event) => received.push(event));

const eventId = "BZSS_Main:42:test:On_RawLogLine:7";
const baseEvent = {
  eventId,
  eventName: "On_RawLogLine",
  source: "python-log-parser",
  serverId: "BZSS_Main",
  sessionId: "session-1",
  seq: "7",
  sourceSeq: "42",
  sourceMode: "live",
  canTriggerActions: true,
  rawEvent: {
    EventId: eventId,
  },
};

const udpEvent = {
  ...baseEvent,
  transportSource: "udp",
  udpRemoteAddress: "127.0.0.1",
};
const fileBridgeEvent = {
  ...baseEvent,
  transportSource: "file-bridge",
  fileBridgeSourcePath: "events/all.jsonl",
};

assert.equal(eventBus.emitCoreEvent(udpEvent.eventName, udpEvent), true);
assert.equal(eventBus.emitCoreEvent(fileBridgeEvent.eventName, fileBridgeEvent), false);
assert.equal(received.length, 1);
assert.equal(received[0], udpEvent);
assert.equal(eventBus.hasRecentCoreEventId(eventId), true);

const diagnostics = eventBus.getDiagnostics();
assert.equal(diagnostics.coreEventsReceived, 2);
assert.equal(diagnostics.coreEventsEmitted, 1);
assert.equal(diagnostics.coreEventsDeduplicated, 1);

console.log("run-event-bus-dedupe-tests: ok");
