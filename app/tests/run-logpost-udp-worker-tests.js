import assert from "node:assert/strict";
import dgram from "node:dgram";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LogPostUdpIngressBridge } from "../core/logpost-udp-ingress-bridge.js";
import { UdpEventReceiver } from "../core/udp-event-receiver.js";

const port = 44000 + (process.pid % 1000);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "bzss-udp-worker-test-"));
const emitted = [];
const webState = {};
const receiver = new UdpEventReceiver({
  config: { host: "127.0.0.1", port, legacySocket: false },
  logger: quietLogger(),
  eventBus: { emitCoreEvent(name, event) { emitted.push({ name, event }); }, hasRecentCoreEventId() { return false; } },
  webStatus: { state: webState, set(key, value) { webState[key] = value; } },
  eventPipeline: { processRawGameEvent(rawEvent) { return { eventName: rawEvent.Event, rawEvent }; } },
});
const bridge = new LogPostUdpIngressBridge({
  config: {
    host: "127.0.0.1", port, maxMessageBytes: 256, recvBufferBytes: 1024 * 1024,
    packetStatsFinalizeGraceMs: 5, packetStatsHistoryFile: path.join(tempDir, "packet-stats.jsonl"),
    ingressWorker: { enabled: true, batchMaxEvents: 32, batchMaxDelayMs: 2, maxInFlightBatches: 2, maxQueueEvents: 10000 },
  },
  logger: quietLogger(), webStatus: receiver.webStatus, receiver,
});

try {
  await bridge.start();
  assert.ok(bridge.getDiagnostics().actualRecvBufferBytes > 0, "worker must report actual receive buffer");

  await sendJson({ PacketType: "STAT", Event: "LOGPOST_PACKET_STAT", PacketSessionId: "test", StatSeq: 1, FirstSeq: 1, LastSeq: 1, SentPackets: 1 });
  await wait(550);
  assert.equal(emitted.length, 0, "STAT must never enter EventPipeline");

  await sendRaw("{");
  await sendRaw("x".repeat(300));
  await wait(550);
  assert.equal(bridge.getDiagnostics().invalidJson, 1);
  assert.equal(bridge.getDiagnostics().oversizedMessages, 1);

  const total = 1000;
  await Promise.all(Array.from({ length: total }, (_, index) => sendJson({
    PacketType: "EVENT", PacketSessionId: "test", PacketSeq: index + 1,
    Event: "On_TestEvent", EventId: `event-${index + 1}`,
  })));
  await waitFor(() => emitted.length === total, 10_000);
  assert.deepEqual(emitted.map(({ event }) => event.rawEvent.PacketSeq), Array.from({ length: total }, (_, index) => index + 1));

  // Duplicate PacketSeq stays out of loss accounting while its business Event
  // remains independently subject to EventId dedupe in the main thread.
  await sendJson({ PacketType: "EVENT", PacketSessionId: "test", PacketSeq: 1000, Event: "On_TestEvent", EventId: "duplicate-seq" });
  await waitFor(() => emitted.length === total + 1, 3000);
  await wait(550);
  assert.equal(bridge.getDiagnostics().packetLoss.metrics.duplicateBusinessPackets, 1);

  console.log("run-logpost-udp-worker-tests: ok");
} finally {
  await bridge.stop();
  await rm(tempDir, { recursive: true, force: true });
}

function quietLogger() { return { info() {}, warn() {}, error() {}, debug() {} }; }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for UDP ingress worker.");
    await wait(5);
  }
}
function sendRaw(text) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket("udp4");
    client.send(Buffer.from(text), port, "127.0.0.1", (error) => {
      client.close();
      if (error) reject(error); else resolve();
    });
  });
}
function sendJson(value) { return sendRaw(JSON.stringify(value)); }
