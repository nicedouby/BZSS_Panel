// -*- coding: utf-8 -*-

import dgram from "node:dgram";
import { parentPort, workerData } from "node:worker_threads";
import { UdpPacketLossMonitor } from "../core/udp-packet-loss-monitor.js";

const PACKET_STAT_EVENT_NAME = "LOGPOST_PACKET_STAT";
const DIAGNOSTICS_PUBLISH_INTERVAL_MS = 500;

const config = normalizeConfig(workerData ?? {});
const socket = dgram.createSocket("udp4");
const packetLossMonitor = new UdpPacketLossMonitor({
  finalizeGraceMs: config.packetStatsFinalizeGraceMs,
  historySize: config.packetStatsHistorySize,
  historyFilePath: config.packetStatsHistoryFile,
  retentionMs: config.packetStatsRetentionHours * 60 * 60 * 1000,
  staleAfterMs: config.packetStatsStaleAfterSeconds * 1000,
  onUpdate: () => publishDiagnostics(true),
});

let nextIngressSeq = 1;
let nextBatchId = 1;
let queue = [];
let queueBytes = 0;
let inFlightBatches = new Map();
let batchTimer = null;
let diagnosticsTimer = null;
let shuttingDown = false;
let lastDiagnosticsPublishedAt = 0;

const metrics = {
  startedAt: "",
  packetsReceived: 0,
  bytesReceived: 0,
  acceptedEvents: 0,
  eventsQueued: 0,
  eventsForwarded: 0,
  batchesSent: 0,
  batchesAcked: 0,
  invalidJson: 0,
  oversizedMessages: 0,
  missingEventField: 0,
  queueOverflowEvents: 0,
  workerErrors: 0,
  socketErrors: 0,
  lastPacketAt: "",
  lastPacketBytes: 0,
  lastRemote: "",
  lastBatchAt: "",
  lastAckAt: "",
  queueHighWaterMark: 0,
  queueBytesHighWaterMark: 0,
  requestedRecvBufferBytes: config.recvBufferBytes,
  actualRecvBufferBytes: 0,
};

socket.on("message", onMessage);
socket.on("error", (error) => {
  metrics.socketErrors += 1;
  metrics.workerErrors += 1;
  publishDiagnostics(true);
  parentPort.postMessage({ type: "workerError", error: serializeError(error) });
});

parentPort.on("message", (message) => {
  if (message?.type === "batchAck") {
    if (inFlightBatches.delete(message.batchId)) {
      metrics.batchesAcked += 1;
      metrics.lastAckAt = new Date().toISOString();
      flushBatches();
      void completeShutdownIfDrained();
    }
    publishDiagnostics();
    return;
  }
  if (message?.type === "shutdown") {
    void shutdown();
  }
});

void start();

async function start() {
  try {
    await packetLossMonitor.initialize();
    await new Promise((resolve, reject) => {
      const onListening = () => {
        socket.off("error", onError);
        resolve();
      };
      const onError = (error) => {
        socket.off("listening", onListening);
        reject(error);
      };
      socket.once("listening", onListening);
      socket.once("error", onError);
      socket.bind(config.port, config.host);
    });
    socket.setRecvBufferSize(config.recvBufferBytes);
    metrics.actualRecvBufferBytes = socket.getRecvBufferSize();
    metrics.startedAt = new Date().toISOString();
    diagnosticsTimer = setInterval(() => publishDiagnostics(true), DIAGNOSTICS_PUBLISH_INTERVAL_MS);
    diagnosticsTimer.unref?.();
    publishDiagnostics(true);
    parentPort.postMessage({ type: "ready", diagnostics: getDiagnostics() });
  } catch (error) {
    metrics.workerErrors += 1;
    parentPort.postMessage({ type: "startupError", error: serializeError(error), diagnostics: getDiagnostics() });
  }
}

function onMessage(buffer, remoteInfo) {
  metrics.packetsReceived += 1;
  metrics.bytesReceived += buffer.length;
  metrics.lastPacketAt = new Date().toISOString();
  metrics.lastPacketBytes = buffer.length;
  metrics.lastRemote = `${remoteInfo.address}:${remoteInfo.port}`;

  if (buffer.length > config.maxMessageBytes) {
    metrics.oversizedMessages += 1;
    publishDiagnostics();
    return;
  }

  let rawEvent;
  try {
    rawEvent = JSON.parse(buffer.toString("utf8"));
  } catch {
    metrics.invalidJson += 1;
    publishDiagnostics();
    return;
  }
  if (!rawEvent || !rawEvent.Event) {
    metrics.missingEventField += 1;
    publishDiagnostics();
    return;
  }

  const packetType = String(rawEvent.PacketType ?? "").trim().toUpperCase();
  if (packetType === "EVENT") packetLossMonitor.recordEvent(rawEvent);
  if (packetType === "STAT" || rawEvent.Event === PACKET_STAT_EVENT_NAME) {
    packetLossMonitor.recordStat(rawEvent);
    publishDiagnostics();
    return;
  }

  metrics.acceptedEvents += 1;
  const receivedAtMs = Date.now();
  const event = {
    ingressSeq: nextIngressSeq++,
    receivedAtMs,
    remoteAddress: remoteInfo.address,
    remotePort: remoteInfo.port,
    rawEvent,
  };
  const bytes = buffer.length;
  if (queue.length >= config.maxQueueEvents) {
    // Deliberately do not discard an older event. Retain the new one as well so
    // diagnostics exposes the real overload instead of hiding a loss.
    metrics.queueOverflowEvents += 1;
  }
  queue.push({ event, bytes });
  queueBytes += bytes;
  metrics.eventsQueued += 1;
  metrics.queueHighWaterMark = Math.max(metrics.queueHighWaterMark, queue.length);
  metrics.queueBytesHighWaterMark = Math.max(metrics.queueBytesHighWaterMark, queueBytes);
  if (queue.length >= config.batchMaxEvents) flushBatches();
  else scheduleBatchFlush();
  publishDiagnostics();
}

function scheduleBatchFlush() {
  if (batchTimer || queue.length === 0 || inFlightBatches.size >= config.maxInFlightBatches) return;
  batchTimer = setTimeout(() => {
    batchTimer = null;
    flushBatches();
  }, config.batchMaxDelayMs);
  batchTimer.unref?.();
}

function flushBatches() {
  while (queue.length > 0 && inFlightBatches.size < config.maxInFlightBatches) {
    const chunk = queue.splice(0, config.batchMaxEvents);
    const events = chunk.map((item) => item.event);
    queueBytes -= chunk.reduce((total, item) => total + item.bytes, 0);
    const batchId = nextBatchId++;
    inFlightBatches.set(batchId, { sentAtMs: Date.now(), count: events.length });
    metrics.eventsForwarded += events.length;
    metrics.batchesSent += 1;
    metrics.lastBatchAt = new Date().toISOString();
    parentPort.postMessage({ type: "eventBatch", batchId, events });
  }
  if (queue.length > 0) scheduleBatchFlush();
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (batchTimer) clearTimeout(batchTimer);
  if (diagnosticsTimer) clearInterval(diagnosticsTimer);
  flushBatches();
  await new Promise((resolve) => {
    try { socket.close(resolve); } catch { resolve(); }
  });
  completeShutdownIfDrained();
}

async function completeShutdownIfDrained() {
  if (!shuttingDown || queue.length > 0 || inFlightBatches.size > 0) return;
  await packetLossMonitor.close();
  publishDiagnostics(true);
  parentPort.postMessage({ type: "shutdownComplete", diagnostics: getDiagnostics() });
  parentPort.close();
}

function getDiagnostics() {
  const oldestQueuedEventAgeMs = queue.length > 0 ? Math.max(0, Date.now() - queue[0].event.receivedAtMs) : 0;
  return {
    ...metrics,
    host: config.host,
    port: config.port,
    maxMessageBytes: config.maxMessageBytes,
    workerStatus: shuttingDown ? "stopping" : metrics.startedAt ? "listening" : "starting",
    queueDepth: queue.length,
    queueBytes,
    oldestQueuedEventAgeMs,
    inFlightBatches: inFlightBatches.size,
    packetLoss: packetLossMonitor.getState(),
  };
}

function publishDiagnostics(force = false) {
  const now = Date.now();
  if (!force && now - lastDiagnosticsPublishedAt < DIAGNOSTICS_PUBLISH_INTERVAL_MS) return;
  lastDiagnosticsPublishedAt = now;
  parentPort.postMessage({ type: "diagnostics", udp: getDiagnostics() });
}

function normalizeConfig(value) {
  const ingress = value.ingressWorker ?? {};
  return {
    host: String(value.host ?? "127.0.0.1"),
    port: Number(value.port ?? 6666),
    maxMessageBytes: Math.max(1, Number(value.maxMessageBytes ?? 65535)),
    recvBufferBytes: Math.max(64 * 1024, Number(value.recvBufferBytes ?? 8 * 1024 * 1024)),
    batchMaxEvents: Math.max(1, Math.min(1024, Number(ingress.batchMaxEvents ?? 128))),
    batchMaxDelayMs: Math.max(1, Math.min(1000, Number(ingress.batchMaxDelayMs ?? 5))),
    maxInFlightBatches: Math.max(1, Math.min(64, Number(ingress.maxInFlightBatches ?? 4))),
    maxQueueEvents: Math.max(1, Number(ingress.maxQueueEvents ?? 100000)),
    packetStatsFinalizeGraceMs: Math.max(0, Number(value.packetStatsFinalizeGraceMs ?? 750)),
    packetStatsHistorySize: Math.max(120, Number(value.packetStatsHistorySize ?? 8640)),
    packetStatsHistoryFile: String(value.packetStatsHistoryFile ?? "./data/logpost-packet-stats.jsonl"),
    packetStatsRetentionHours: Math.max(1, Number(value.packetStatsRetentionHours ?? 24)),
    packetStatsStaleAfterSeconds: Math.max(15, Number(value.packetStatsStaleAfterSeconds ?? 30)),
  };
}

function serializeError(error) {
  return { message: String(error?.message ?? error), stack: String(error?.stack ?? ""), code: error?.code ?? "" };
}
