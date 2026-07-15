// -*- coding: utf-8 -*-

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const MAX_READ_CHUNK_BYTES = 256 * 1024;
const MAX_PARTIAL_LINE_CHARS = 1024 * 1024;

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_RECENT_REPLAY_LINES = 120;
const DEFAULT_EVENT_NAME = "On_RawLogLine";
const ALL_EVENTS_FILE_NAME = "all.jsonl";
const BZSS_CORE_PLAYER_CHUNK_EVENT_NAME = "On_BzssCorePlayerChunk";

export class LogPostFileBridge {
  constructor({ config, logger, eventBus, eventPipeline, webStatus, logPostMonitor = null }) {
    this.config = config ?? {};
    this.logger = logger;
    this.eventBus = eventBus;
    this.eventPipeline = eventPipeline;
    this.webStatus = webStatus;
    this.logPostMonitor = logPostMonitor;

    this.enabled = Boolean(this.config.enabled);
    this.workingDirectory = path.resolve(process.cwd(), String(this.config.workingDirectory ?? "./LogPost").trim());
    this.eventName = String(this.config.eventName ?? DEFAULT_EVENT_NAME).trim() || DEFAULT_EVENT_NAME;
    this.pollIntervalMs = Math.max(100, Number(this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS);
    this.replayRecentLines = Math.max(0, Number(this.config.replayRecentLines ?? DEFAULT_RECENT_REPLAY_LINES) || 0);
    this.fromEnd = this.config.fromEnd !== false;

    this.timer = null;
    this.currentFilePath = "";
    this.currentDateKey = "";
    this.currentOffset = 0;
    this.partialLine = "";
    this.isTicking = false;
    this.metrics = {
      startedAt: "",
      ticks: 0,
      overlappingTickSkips: 0,
      bytesRead: 0,
      linesRead: 0,
      acceptedEvents: 0,
      replayedEvents: 0,
      invalidJsonLines: 0,
      filteredEvents: 0,
      oversizedPartialLines: 0,
      fileResets: 0,
      readErrors: 0,
      currentFileSize: 0,
      backlogBytes: 0,
      lastTickAt: "",
      lastReadAt: "",
      lastTickDurationMs: 0,
      maxTickDurationMs: 0,
      lastChunkBytes: 0,
      lastChunkLines: 0,
    };
  }

  async start() {
    if (!this.enabled) {
      this.webStatus?.set?.("logPostFileBridge", "disabled");
      this.publishDiagnostics();
      this.logger?.info?.("LogPost file bridge disabled.");
      return;
    }

    this.webStatus?.set?.("logPostFileBridge", "starting");
    await this.bootstrapCurrentFile();
    this.metrics.startedAt = new Date().toISOString();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        this.metrics.readErrors += 1;
        this.publishDiagnostics();
        this.webStatus?.set?.("logPostFileBridge", "error");
        this.logger?.warn?.(`LogPost file bridge tick failed: ${error?.message ?? error}`);
      });
    }, this.pollIntervalMs);
    this.timer.unref?.();
    this.webStatus?.set?.("logPostFileBridge", "running");
    this.publishDiagnostics();
    this.logger?.info?.(`LogPost file bridge watching ${this.workingDirectory}`);
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isTicking = false;
    this.webStatus?.set?.("logPostFileBridge", this.enabled ? "stopped" : "disabled");
    this.publishDiagnostics();
  }

  async bootstrapCurrentFile() {
    const filePath = this.resolveCurrentFilePath();
    this.currentFilePath = filePath;
    this.currentDateKey = getDateKey(new Date());
    this.currentOffset = 0;
    this.partialLine = "";

    if (!fs.existsSync(filePath)) {
      this.metrics.currentFileSize = 0;
      this.metrics.backlogBytes = 0;
      this.publishDiagnostics();
      return;
    }

    const stat = fs.statSync(filePath);
    this.metrics.currentFileSize = stat.size;
    if (this.fromEnd) {
      this.currentOffset = stat.size;
      if (this.replayRecentLines > 0) {
        await this.replayRecent(filePath, stat.size);
      }
      this.metrics.backlogBytes = Math.max(0, stat.size - this.currentOffset);
      this.publishDiagnostics();
      return;
    }

    this.currentOffset = 0;
    await this.readPendingFromFile(filePath);
  }

  async tick() {
    if (!this.enabled) return;
    if (this.isTicking) {
      this.metrics.overlappingTickSkips += 1;
      this.publishDiagnostics();
      return;
    }
    this.isTicking = true;
    const startedAt = performance.now();
    this.metrics.ticks += 1;
    this.metrics.lastTickAt = new Date().toISOString();
    this.metrics.lastChunkBytes = 0;
    this.metrics.lastChunkLines = 0;
    try {
      const nextDateKey = getDateKey(new Date());
      if (nextDateKey !== this.currentDateKey) {
        await this.bootstrapCurrentFile();
      }
      await this.readPendingFromFile(this.currentFilePath || this.resolveCurrentFilePath());
    } finally {
      const duration = performance.now() - startedAt;
      this.metrics.lastTickDurationMs = duration;
      this.metrics.maxTickDurationMs = Math.max(this.metrics.maxTickDurationMs, duration);
      this.isTicking = false;
      this.publishDiagnostics();
    }
  }

  resolveCurrentFilePath() {
    const dateKey = getDateKey(new Date());
    return resolveLogPostEventFilePath(this.workingDirectory, dateKey, this.eventName);
  }

  async replayRecent(filePath, fileSize) {
    const replayWindowBytes = Math.min(fileSize, 512 * 1024);
    if (replayWindowBytes <= 0) return;
    const start = Math.max(0, fileSize - replayWindowBytes);
    const buffer = Buffer.alloc(fileSize - start);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      fs.closeSync(fd);
    }

    const rows = buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
    const recentRows = rows.slice(-this.replayRecentLines);
    for (const row of recentRows) {
      this.ingestJsonLine(row, { replay: true, filePath });
    }
  }

  async readPendingFromFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      this.metrics.currentFileSize = 0;
      this.metrics.backlogBytes = 0;
      return;
    }

    const stat = fs.statSync(filePath);
    this.metrics.currentFileSize = stat.size;
    if (stat.size < this.currentOffset) {
      this.currentOffset = 0;
      this.partialLine = "";
      this.metrics.fileResets += 1;
    }
    if (stat.size === this.currentOffset) {
      this.metrics.backlogBytes = 0;
      return;
    }

    const length = Math.min(stat.size - this.currentOffset, MAX_READ_CHUNK_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, length, this.currentOffset);
    } finally {
      fs.closeSync(fd);
    }

    this.currentOffset += length;
    this.metrics.bytesRead += length;
    this.metrics.lastChunkBytes = length;
    this.metrics.lastReadAt = new Date().toISOString();
    const chunkText = this.partialLine + buffer.toString("utf8");
    const lines = chunkText.split(/\r?\n/);
    this.partialLine = lines.pop() ?? "";
    if (this.partialLine.length > MAX_PARTIAL_LINE_CHARS) {
      this.metrics.oversizedPartialLines += 1;
      this.logger?.warn?.("LogPost file bridge discarded an oversized partial JSONL row.");
      this.partialLine = "";
    }
    let lineCount = 0;
    for (const line of lines) {
      if (!line) continue;
      lineCount += 1;
      this.ingestJsonLine(line, { replay: false, filePath });
    }
    this.metrics.linesRead += lineCount;
    this.metrics.lastChunkLines = lineCount;
    this.metrics.backlogBytes = Math.max(0, stat.size - this.currentOffset);
  }

  ingestJsonLine(line, { replay, filePath }) {
    let rawEvent;
    try {
      rawEvent = JSON.parse(line);
    } catch (error) {
      this.metrics.invalidJsonLines += 1;
      this.logger?.warn?.(`LogPost file bridge ignored invalid jsonl row: ${error?.message ?? error}`);
      return;
    }

    const sourceFileName = path.basename(String(filePath ?? ""));
    const acceptAllEvents = sourceFileName === ALL_EVENTS_FILE_NAME;
    if (!acceptAllEvents && String(rawEvent?.Event ?? "") !== this.eventName) {
      this.metrics.filteredEvents += 1;
      return;
    }

    const event = this.eventPipeline.processRawGameEvent(rawEvent);
    event.fileBridgeReplay = Boolean(replay);
    event.fileBridgeSourcePath = this.currentFilePath;
    if (replay) this.metrics.replayedEvents += 1;
    else this.metrics.acceptedEvents += 1;
    if (event.eventName !== BZSS_CORE_PLAYER_CHUNK_EVENT_NAME) {
      const gapEvent = this.logPostMonitor?.inspectEvent?.(event) ?? null;
      if (gapEvent) {
        this.eventBus.emitCoreEvent(gapEvent.eventName, gapEvent);
      }
    }
    this.eventBus.emitCoreEvent(event.eventName, event);
  }

  getDiagnostics() {
    return {
      ...this.metrics,
      enabled: this.enabled,
      status: this.webStatus?.state?.logPostFileBridge ?? (this.enabled ? "unknown" : "disabled"),
      workingDirectory: this.workingDirectory,
      currentFilePath: this.currentFilePath,
      currentOffset: this.currentOffset,
      partialLineChars: this.partialLine.length,
      pollIntervalMs: this.pollIntervalMs,
      maxReadChunkBytes: MAX_READ_CHUNK_BYTES,
      theoreticalMaxBytesPerSec: Math.floor((1000 / this.pollIntervalMs) * MAX_READ_CHUNK_BYTES),
      isTicking: this.isTicking,
    };
  }

  publishDiagnostics() {
    this.webStatus?.set?.("logPostFileBridgeDiagnostics", this.getDiagnostics());
  }
}

function getDateKey(now) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveLogPostEventFilePath(workingDirectory, dateKey, eventName) {
  const baseDirectory = path.resolve(workingDirectory);
  const candidates = [
    path.resolve(baseDirectory, "events", dateKey, ALL_EVENTS_FILE_NAME),
    path.resolve(baseDirectory, "LogPost", "events", dateKey, ALL_EVENTS_FILE_NAME),
    path.resolve(baseDirectory, "events", dateKey, `${eventName}.jsonl`),
    path.resolve(baseDirectory, "LogPost", "events", dateKey, `${eventName}.jsonl`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}
