// -*- coding: utf-8 -*-

import dgram from "node:dgram";
import { UdpPacketLossMonitor } from "./udp-packet-loss-monitor.js";

const BZSS_CORE_PLAYER_CHUNK_EVENT_NAME = "On_BzssCorePlayerChunk";
const BZSS_CORE_VEHICLE_CHUNK_EVENT_NAME = "On_BzssCoreVehicleChunk";
const PACKET_STAT_EVENT_NAME = "LOGPOST_PACKET_STAT";
const DIAGNOSTICS_PUBLISH_INTERVAL_MS = 250;

/**
 * Core: UdpEventReceiver
 *
 * 接收 Python LogParser 发来的 UDP JSON 事件，并发布为 Core Event。
 */
export class UdpEventReceiver {
  constructor({ config, logger, eventBus, webStatus, eventPipeline, logPostMonitor = null }) {
    this.host = config.host ?? "127.0.0.1";
    this.port = Number(config.port ?? 6666);
    this.maxMessageBytes = Number(config.maxMessageBytes ?? 65535);

    this.logger = logger;
    this.eventBus = eventBus;
    this.webStatus = webStatus;
    this.eventPipeline = eventPipeline;
    this.logPostMonitor = logPostMonitor;
    this.legacySocketEnabled = config.legacySocket !== false;
    this.socket = this.legacySocketEnabled ? dgram.createSocket("udp4") : null;
    this.isStarting = false;
    this.lastDiagnosticsPublishAt = 0;
    this.metrics = {
      startedAt: "",
      packetsReceived: 0,
      bytesReceived: 0,
      acceptedEvents: 0,
      bzssCoreChunks: 0,
      bzssCoreVehicleChunks: 0,
      duplicateEventsDropped: 0,
      invalidJson: 0,
      oversizedMessages: 0,
      missingEventField: 0,
      socketErrors: 0,
      lastPacketAt: "",
      lastPacketBytes: 0,
      lastRemote: "",
    };
    this.packetLossMonitor = this.legacySocketEnabled ? new UdpPacketLossMonitor({
      logger: this.logger,
      finalizeGraceMs: Number(config.packetStatsFinalizeGraceMs ?? 750),
      historySize: Number(config.packetStatsHistorySize ?? 8640),
      historyFilePath: String(config.packetStatsHistoryFile ?? "./data/logpost-packet-stats.jsonl"),
      retentionMs: Math.max(1, Number(config.packetStatsRetentionHours ?? 24)) * 60 * 60 * 1000,
      staleAfterMs: Math.max(15, Number(config.packetStatsStaleAfterSeconds ?? 30)) * 1000,
      onUpdate: () => this.publishDiagnostics(true),
    }) : null;

    this.socket?.on("message", (buffer, remoteInfo) => this.handleMessage(buffer, remoteInfo));
    this.socket?.on("error", (error) => {
      this.metrics.socketErrors += 1;
      this.publishDiagnostics(true);
      if (this.isStarting) return;

      this.webStatus.set("udpReceiver", "error");
      this.logger.error(`UDP socket error: ${error.stack ?? error}`, {
        operation: "socketError",
      });
    });
  }

  async start() {
    if (!this.legacySocketEnabled) return;
    this.isStarting = true;

    try {
      await this.packetLossMonitor.initialize();
    } catch (error) {
      this.logger.warn?.(`LogPost packet history initialization failed; continuing without persisted history: ${error.message}`);
    }

    await new Promise((resolve, reject) => {
      const onListening = () => {
        this.socket.off("error", onError);
        this.isStarting = false;
        resolve();
      };

      const onError = (error) => {
        this.socket.off("listening", onListening);
        this.isStarting = false;
        this.webStatus.set("udpReceiver", "error");
        reject(wrapUdpStartupError(error, this.host, this.port));
      };

      this.socket.once("listening", onListening);
      this.socket.once("error", onError);
      this.socket.bind(this.port, this.host);
    });

    this.metrics.startedAt = new Date().toISOString();
    this.publishDiagnostics(true);
    this.webStatus.set("udpReceiver", "listening");
    this.logger.info(`UDP Receiver listening on ${this.host}:${this.port}`, {
      operation: "start",
    });
  }

  async stop() {
    if (!this.legacySocketEnabled) return;
    this.webStatus.set("udpReceiver", "stopped");

    await new Promise((resolve) => {
      try { this.socket.close(resolve); } catch { resolve(); }
    });
    await this.packetLossMonitor?.close();
    this.publishDiagnostics(true);
  }

  handleMessage(buffer, remoteInfo) {
    this.metrics.packetsReceived += 1;
    this.metrics.bytesReceived += buffer.length;
    this.metrics.lastPacketAt = new Date().toISOString();
    this.metrics.lastPacketBytes = buffer.length;
    this.metrics.lastRemote = `${remoteInfo.address}:${remoteInfo.port}`;

    if (buffer.length > this.maxMessageBytes) {
      this.metrics.oversizedMessages += 1;
      this.publishDiagnostics();
      this.logger.warn(`UDP message too large. Bytes=${buffer.length}`, {
        operation: "handleMessage",
        data: {
          bytes: buffer.length,
          remote: `${remoteInfo.address}:${remoteInfo.port}`,
        },
      });
      return;
    }

    let rawEvent;
    try {
      rawEvent = JSON.parse(buffer.toString("utf8"));
    } catch {
      this.metrics.invalidJson += 1;
      this.publishDiagnostics();
      return;
    }

    if (!rawEvent.Event) {
      this.metrics.missingEventField += 1;
      this.publishDiagnostics();
      this.logger.warn("UDP event missing Event field.", {
        operation: "handleMessage",
        data: {
          remote: `${remoteInfo.address}:${remoteInfo.port}`,
        },
      });
      return;
    }

    const packetType = String(rawEvent?.PacketType ?? "").trim().toUpperCase();
    if (packetType === "EVENT") {
      this.packetLossMonitor?.recordEvent(rawEvent);
    }
    if (packetType === "STAT" || rawEvent.Event === PACKET_STAT_EVENT_NAME) {
      this.packetLossMonitor?.recordStat(rawEvent);
      this.publishDiagnostics();
      return;
    }

    this.handleParsedEvent(rawEvent, {
      receivedAtMs: Date.now(),
      remoteAddress: remoteInfo.address,
      remotePort: remoteInfo.port,
    });
  }

  /**
   * Main-thread business half of UDP ingress. The Worker has already parsed,
   * size-checked and sequence-accounted the packet before this method runs.
   */
  handleParsedEvent(rawEvent, transportMeta = {}) {
    const remoteInfo = {
      address: transportMeta.remoteAddress ?? "",
      port: Number(transportMeta.remotePort ?? 0),
    };
    const eventId = String(rawEvent?.EventId ?? "").trim();
    if (eventId && this.eventBus?.hasRecentCoreEventId?.(eventId)) {
      this.metrics.duplicateEventsDropped += 1;
      this.publishDiagnostics();
      return;
    }

    this.metrics.acceptedEvents += 1;

    if (rawEvent.Event === BZSS_CORE_PLAYER_CHUNK_EVENT_NAME) {
      this.metrics.bzssCoreChunks += 1;
      const event = buildBzssCorePlayerChunkEvent(rawEvent, remoteInfo);
      event.transportSource = "udp";
      this.logger.debug(() => `UDP event accepted ${event.eventName}`, {
        operation: "handleMessage",
        eventName: event.eventName,
        data: {
          remote: `${remoteInfo.address}:${remoteInfo.port}`,
        },
      });
      this.eventBus.emitCoreEvent(event.eventName, event);
      this.publishDiagnostics();
      return;
    }

    if (rawEvent.Event === BZSS_CORE_VEHICLE_CHUNK_EVENT_NAME) {
      this.metrics.bzssCoreVehicleChunks += 1;
    }

    const event = this.eventPipeline.processRawGameEvent(rawEvent);
    event.udpRemoteAddress = remoteInfo.address;
    event.udpRemotePort = remoteInfo.port;
    event.transportSource = "udp";

    this.logger.debug(() => `UDP event accepted ${event.eventName}`, {
      operation: "handleMessage",
      eventName: event.eventName,
      data: {
        remote: `${remoteInfo.address}:${remoteInfo.port}`,
      },
    });

    const gapEvent = this.logPostMonitor?.inspectEvent?.(event) ?? null;
    if (gapEvent) {
      this.eventBus.emitCoreEvent(gapEvent.eventName, gapEvent);
    }
    this.eventBus.emitCoreEvent(event.eventName, event);
    this.publishDiagnostics();
  }

  getDiagnostics() {
    return {
      ...this.metrics,
      host: this.host,
      port: this.port,
      maxMessageBytes: this.maxMessageBytes,
      status: this.webStatus?.state?.udpReceiver ?? "unknown",
      packetLoss: this.packetLossMonitor?.getState?.() ?? null,
      legacySocketEnabled: this.legacySocketEnabled,
    };
  }

  publishDiagnostics(force = false) {
    const now = Date.now();
    if (!force && now - this.lastDiagnosticsPublishAt < DIAGNOSTICS_PUBLISH_INTERVAL_MS) return;
    this.lastDiagnosticsPublishAt = now;
    this.webStatus?.set?.("logPostUdpTransport", this.getDiagnostics());
  }
}

function wrapUdpStartupError(error, host, port) {
  if (!error || typeof error !== "object") {
    return new Error(`Failed to start UDP receiver on ${host}:${port}`);
  }

  if (error.code === "EADDRINUSE") {
    const wrapped = new Error(
      `UDP ${host}:${port} is already in use. Another BZSS Panel instance or log parser is likely already running. Stop the existing process or change udp.port in config.json before starting again.`,
    );
    wrapped.code = error.code;
    wrapped.cause = error;
    return wrapped;
  }

  return error;
}

function buildBzssCorePlayerChunkEvent(rawEvent, remoteInfo) {
  const eventId = String(rawEvent?.EventId ?? `${String(rawEvent?.ServerID ?? "")}:${String(rawEvent?.SessionID ?? "")}:${String(rawEvent?.Seq ?? "")}:${BZSS_CORE_PLAYER_CHUNK_EVENT_NAME}`);
  return {
    eventId,
    eventName: BZSS_CORE_PLAYER_CHUNK_EVENT_NAME,
    layer: "core",
    source: "python-log-parser",
    serverId: String(rawEvent?.ServerID ?? ""),
    sessionId: String(rawEvent?.SessionID ?? ""),
    seq: String(rawEvent?.Seq ?? ""),
    sourceSeq: String(rawEvent?.SourceSeq ?? ""),
    time: String(rawEvent?.Time ?? new Date().toISOString()),
    tick: String(rawEvent?.Tick ?? ""),
    count: String(rawEvent?.Count ?? ""),
    sourceMode: String(rawEvent?.SourceMode ?? "live"),
    canTriggerActions: parseBooleanLike(rawEvent?.CanTriggerActions ?? true),
    isReplay: parseBooleanLike(rawEvent?.IsReplay ?? false),
    rawEvent,
    udpRemoteAddress: remoteInfo.address,
    udpRemotePort: remoteInfo.port,
  };
}

function parseBooleanLike(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  return Boolean(value);
}
