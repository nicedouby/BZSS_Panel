// -*- coding: utf-8 -*-

import path from "node:path";
import fsp from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { FileIOManager } from "./file-io-manager.js";
import { resolveLogPostWorkingDirectory } from "./logpost-working-directory.js";

const MAX_READ_CHUNK_BYTES = 256 * 1024;
const MAX_PARTIAL_LINE_BYTES = 1024 * 1024;
const DEFAULT_MAX_PROCESS_SLICE_MS = 8;
const YIELD_CHECK_EVERY_LINES = 24;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_RECENT_REPLAY_LINES = 120;
const DEFAULT_EVENT_NAME = "On_RawLogLine";
const ALL_EVENTS_FILE_NAME = "all.jsonl";
const BZSS_CORE_PLAYER_CHUNK_EVENT_NAME = "On_BzssCorePlayerChunk";
const MAX_PROCESS_RETRIES = 3;

export class LogPostFileBridge {
  constructor({ config, logger, eventBus, eventPipeline, webStatus, logPostMonitor = null, fileIO = null, performanceMonitor = null }) {
    this.config = config ?? {};
    this.logger = logger;
    this.eventBus = eventBus;
    this.eventPipeline = eventPipeline;
    this.webStatus = webStatus;
    this.logPostMonitor = logPostMonitor;
    this.fileIO = fileIO ?? new FileIOManager({ config: {} });
    this.performanceMonitor = performanceMonitor;
    this.enabled = Boolean(this.config.enabled);
    this.workingDirectory = resolveLogPostWorkingDirectory(this.config.workingDirectory ?? "./LogPost");
    this.eventName = String(this.config.eventName ?? DEFAULT_EVENT_NAME).trim() || DEFAULT_EVENT_NAME;
    this.pollIntervalMs = Math.max(100, Number(this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS);
    this.replayRecentLines = Math.max(0, Number(this.config.replayRecentLines ?? DEFAULT_RECENT_REPLAY_LINES) || 0);
    this.fromEnd = this.config.fromEnd !== false;
    this.maxProcessSliceMs = Math.max(2, Math.min(25, Number(this.config.maxProcessSliceMs ?? DEFAULT_MAX_PROCESS_SLICE_MS) || DEFAULT_MAX_PROCESS_SLICE_MS));
    this.serverId = String(this.config.serverId ?? "BZSS_Main") || "BZSS_Main";
    this.checkpointPath = path.resolve(this.config.checkpointPath ?? `./data/logpost-consumer/${safeSegment(this.serverId)}.json`);
    this.deadLetterDirectory = path.resolve(this.config.deadLetterDirectory ?? path.join(this.workingDirectory, "dead-letter"));
    this.timer = null;
    this.currentFilePath = "";
    this.currentFileId = "";
    this.currentDateKey = "";
    this.readOffset = 0;
    this.committedOffset = 0;
    this.partialBuffer = Buffer.alloc(0);
    this.partialOffset = 0;
    this.isTicking = false;
    this.failureAttempts = new Map();
    this.lastEventId = "";
    this.metrics = {
      startedAt: "", ticks: 0, overlappingTickSkips: 0, bytesRead: 0,
      linesRead: 0, linesProcessed: 0, acceptedEvents: 0, replayedEvents: 0,
      duplicateEventsDropped: 0, duplicates: 0, invalidJsonLines: 0,
      filteredEvents: 0, oversizedPartialLines: 0, fileResets: 0,
      readErrors: 0, retryCount: 0, deadLetterCount: 0, eventGapCount: 0,
      sourceGapCount: 0, currentFileSize: 0, backlogBytes: 0,
      maxBacklogBytes: 0, lastTickAt: "", lastReadAt: "", lastCommitAt: "",
      lastTickDurationMs: 0, maxTickDurationMs: 0, lastChunkBytes: 0,
      lastChunkLines: 0, eventLoopYields: 0,
    };
  }

  get currentOffset() { return this.committedOffset; }
  set currentOffset(value) { this.resetReadState(value); }
  get partialLine() { return this.partialBuffer.toString("utf8"); }

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
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.isTicking = false;
    if (this.enabled && this.currentFilePath) await this.persistCheckpoint();
    this.webStatus?.set?.("logPostFileBridge", this.enabled ? "stopped" : "disabled");
    this.publishDiagnostics();
  }

  async bootstrapCurrentFile() {
    const filePath = await this.resolveCurrentFilePath();
    this.currentFilePath = filePath;
    this.currentDateKey = getDateKey(new Date());
    this.resetReadState(0);
    if (!(await this.fileIO.exists(filePath))) {
      this.currentFileId = "";
      this.metrics.currentFileSize = 0;
      this.metrics.backlogBytes = 0;
      return;
    }
    const stat = await this.fileIO.stat(filePath, { cache: false });
    this.currentFileId = makeFileId(stat);
    this.metrics.currentFileSize = stat.size;
    const checkpoint = await this.loadCheckpoint();
    const valid = checkpoint && checkpoint.sourcePath === filePath
      && checkpoint.fileId === this.currentFileId
      && Number(checkpoint.committedOffset) >= 0
      && Number(checkpoint.committedOffset) <= stat.size;
    if (valid) {
      this.resetReadState(Number(checkpoint.committedOffset));
      this.lastEventId = String(checkpoint.lastEventId ?? "");
      await this.readPendingFromFile(filePath);
    } else if (this.fromEnd) {
      this.resetReadState(stat.size);
      if (this.replayRecentLines > 0) await this.replayRecent(filePath, stat.size);
      await this.persistCheckpoint();
    } else {
      await this.readPendingFromFile(filePath);
    }
    this.updateBacklog(stat.size);
  }

  async tick() {
    if (!this.enabled) return;
    if (this.isTicking) {
      this.metrics.overlappingTickSkips += 1;
      return;
    }
    this.isTicking = true;
    const startedAt = performance.now();
    this.metrics.ticks += 1;
    this.metrics.lastTickAt = new Date().toISOString();
    this.metrics.lastChunkBytes = 0;
    this.metrics.lastChunkLines = 0;
    try {
      if (getDateKey(new Date()) !== this.currentDateKey) await this.bootstrapCurrentFile();
      await this.readPendingFromFile(this.currentFilePath || await this.resolveCurrentFilePath());
    } finally {
      const duration = performance.now() - startedAt;
      this.metrics.lastTickDurationMs = duration;
      this.metrics.maxTickDurationMs = Math.max(this.metrics.maxTickDurationMs, duration);
      this.performanceMonitor?.recordOperation?.("logpostFileBridge.tick", duration);
      this.isTicking = false;
      this.publishDiagnostics();
    }
  }

  async resolveCurrentFilePath() {
    const dateKey = getDateKey(new Date());
    const candidates = [
      path.resolve(this.workingDirectory, "events", dateKey, ALL_EVENTS_FILE_NAME),
      path.resolve(this.workingDirectory, "LogPost", "events", dateKey, ALL_EVENTS_FILE_NAME),
      path.resolve(this.workingDirectory, "events", dateKey, `${this.eventName}.jsonl`),
      path.resolve(this.workingDirectory, "LogPost", "events", dateKey, `${this.eventName}.jsonl`),
    ];
    for (const candidate of candidates) if (await this.fileIO.exists(candidate)) return candidate;
    return candidates[0];
  }

  async replayRecent(filePath, fileSize) {
    const windowBytes = Math.min(fileSize, 512 * 1024);
    if (windowBytes <= 0) return;
    const start = Math.max(0, fileSize - windowBytes);
    const buffer = await this.fileIO.readRange(filePath, start, windowBytes);
    for (const row of splitCompleteLines(buffer, start).lines.slice(-this.replayRecentLines)) {
      try { this.ingestJsonLine(row.buffer.toString("utf8"), { replay: true, filePath }); }
      catch (error) { this.logger?.warn?.(`LogPost recent replay ignored invalid row: ${error?.message ?? error}`); }
    }
  }

  async readPendingFromFile(filePath) {
    if (!filePath || !(await this.fileIO.exists(filePath))) {
      this.metrics.currentFileSize = 0;
      this.metrics.backlogBytes = 0;
      return;
    }
    const stat = await this.fileIO.stat(filePath, { cache: false });
    const fileId = makeFileId(stat);
    this.metrics.currentFileSize = stat.size;
    if (this.currentFileId && fileId !== this.currentFileId) {
      this.metrics.fileResets += 1;
      this.metrics.sourceGapCount += 1;
      await this.bootstrapCurrentFile();
      return;
    }
    this.currentFileId = fileId;
    if (stat.size < this.committedOffset) {
      this.metrics.fileResets += 1;
      this.metrics.sourceGapCount += 1;
      this.resetReadState(0);
    }
    if (stat.size <= this.readOffset) {
      this.updateBacklog(stat.size);
      return;
    }
    const length = Math.min(stat.size - this.readOffset, MAX_READ_CHUNK_BYTES);
    const chunkStart = this.readOffset;
    const buffer = await this.fileIO.readRange(filePath, chunkStart, length);
    if (!buffer.length) return;
    this.readOffset += buffer.length;
    this.metrics.bytesRead += buffer.length;
    this.metrics.lastChunkBytes = buffer.length;
    this.metrics.lastReadAt = new Date().toISOString();
    const blob = this.partialBuffer.length ? Buffer.concat([this.partialBuffer, buffer]) : buffer;
    const blobStart = this.partialBuffer.length ? this.partialOffset : chunkStart;
    const { lines, remainder, remainderOffset } = splitCompleteLines(blob, blobStart);
    let lineCount = 0;
    let sliceStartedAt = performance.now();
    for (const row of lines) {
      if (!row.buffer.length) {
        await this.commitLine(row.nextOffset, "");
        continue;
      }
      lineCount += 1;
      if (!(await this.processLine(row, filePath))) {
        this.resetReadState(row.offset);
        this.updateBacklog(stat.size);
        return;
      }
      if (lineCount % YIELD_CHECK_EVERY_LINES === 0 && performance.now() - sliceStartedAt >= this.maxProcessSliceMs) {
        this.metrics.eventLoopYields += 1;
        await yieldToEventLoop();
        sliceStartedAt = performance.now();
      }
    }
    this.partialBuffer = remainder;
    this.partialOffset = remainderOffset;
    if (this.partialBuffer.length > MAX_PARTIAL_LINE_BYTES) {
      const row = { buffer: this.partialBuffer.subarray(0, MAX_PARTIAL_LINE_BYTES), offset: this.partialOffset, nextOffset: this.readOffset };
      await this.writeDeadLetter(row, new Error("Oversized JSONL row"), filePath);
      await this.commitLine(this.readOffset, "");
      this.partialBuffer = Buffer.alloc(0);
      this.partialOffset = this.readOffset;
      this.metrics.oversizedPartialLines += 1;
    }
    this.metrics.linesRead += lineCount;
    this.metrics.lastChunkLines = lineCount;
    await this.persistCheckpoint();
    this.updateBacklog(stat.size);
  }

  async processLine(row, filePath) {
    const key = `${this.currentFileId}:${row.offset}`;
    try {
      const result = this.ingestJsonLine(row.buffer.toString("utf8"), { replay: false, filePath });
      this.failureAttempts.delete(key);
      this.metrics.linesProcessed += 1;
      await this.commitLine(row.nextOffset, result.eventId);
      return true;
    } catch (error) {
      if (error instanceof SyntaxError) this.metrics.invalidJsonLines += 1;
      const attempts = (this.failureAttempts.get(key) ?? 0) + 1;
      this.failureAttempts.set(key, attempts);
      this.metrics.retryCount += 1;
      if (attempts < MAX_PROCESS_RETRIES) {
        this.logger?.warn?.(`LogPost row failed at offset ${row.offset}; retry ${attempts}/${MAX_PROCESS_RETRIES}: ${error?.message ?? error}`);
        return false;
      }
      await this.writeDeadLetter(row, error, filePath);
      this.failureAttempts.delete(key);
      await this.commitLine(row.nextOffset, "");
      this.metrics.linesProcessed += 1;
      return true;
    }
  }

  ingestJsonLine(line, { replay, filePath }) {
    const rawEvent = JSON.parse(line);
    const eventId = String(rawEvent?.EventId ?? "").trim();
    if (eventId && this.eventBus?.hasRecentCoreEventId?.(eventId)) {
      this.metrics.duplicateEventsDropped += 1;
      this.metrics.duplicates += 1;
      return { eventId, duplicate: true };
    }
    if (path.basename(String(filePath ?? "")) !== ALL_EVENTS_FILE_NAME && String(rawEvent?.Event ?? "") !== this.eventName) {
      this.metrics.filteredEvents += 1;
      return { eventId, filtered: true };
    }
    const event = this.eventPipeline.processRawGameEvent(rawEvent);
    event.fileBridgeReplay = Boolean(replay);
    event.fileBridgeSourcePath = filePath;
    event.transportSource = "file-bridge";
    if (replay) {
      event.sourceMode = "recovery";
      event.canTriggerActions = false;
      event.isReplay = true;
      event.rawEvent = { ...(event.rawEvent ?? rawEvent), SourceMode: "recovery", IsReplay: "true", CanTriggerActions: "false" };
      this.metrics.replayedEvents += 1;
    } else this.metrics.acceptedEvents += 1;
    if (event.eventName !== BZSS_CORE_PLAYER_CHUNK_EVENT_NAME) {
      const gapEvent = this.logPostMonitor?.inspectEvent?.(event) ?? null;
      if (gapEvent) {
        this.metrics.eventGapCount += 1;
        this.eventBus.emitCoreEvent(gapEvent.eventName, gapEvent);
      }
    }
    this.eventBus.emitCoreEvent(event.eventName, event);
    return { eventId, event };
  }

  async commitLine(nextOffset, eventId) {
    this.committedOffset = Math.max(this.committedOffset, Number(nextOffset) || 0);
    if (eventId) this.lastEventId = String(eventId);
    this.metrics.lastCommitAt = new Date().toISOString();
  }

  async writeDeadLetter(row, error, sourcePath) {
    await fsp.mkdir(this.deadLetterDirectory, { recursive: true });
    const filePath = path.join(this.deadLetterDirectory, `${getDateKey(new Date())}.jsonl`);
    const payload = {
      sourcePath, fileId: this.currentFileId, offset: row.offset, nextOffset: row.nextOffset,
      rawLine: row.buffer.toString("utf8"), error: error?.message ?? String(error),
      stack: error?.stack ?? "", time: new Date().toISOString(),
    };
    await fsp.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
    const handle = await fsp.open(filePath, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
    this.metrics.deadLetterCount += 1;
  }

  async loadCheckpoint() {
    try {
      const payload = JSON.parse(await fsp.readFile(this.checkpointPath, "utf8"));
      return payload?.schema === "logpost.consumer.v1" ? payload : null;
    } catch { return null; }
  }

  async persistCheckpoint() {
    if (!this.currentFilePath || !this.currentFileId) return;
    await this.fileIO.writeJsonAtomic(this.checkpointPath, {
      schema: "logpost.consumer.v1", sourcePath: this.currentFilePath,
      fileId: this.currentFileId, committedOffset: this.committedOffset,
      lastEventId: this.lastEventId, updatedAt: new Date().toISOString(),
    });
  }

  resetReadState(offset) {
    const safe = Math.max(0, Number(offset) || 0);
    this.readOffset = safe;
    this.committedOffset = safe;
    this.partialBuffer = Buffer.alloc(0);
    this.partialOffset = safe;
  }

  updateBacklog(fileSize) {
    this.metrics.backlogBytes = Math.max(0, Number(fileSize) - this.committedOffset);
    this.metrics.maxBacklogBytes = Math.max(this.metrics.maxBacklogBytes, this.metrics.backlogBytes);
  }

  getDiagnostics() {
    const elapsedSeconds = this.metrics.startedAt
      ? Math.max(0.001, (Date.now() - Date.parse(this.metrics.startedAt)) / 1000)
      : 0;
    return {
      ...this.metrics,
      enabled: this.enabled,
      status: this.webStatus?.state?.logPostFileBridge ?? (this.enabled ? "unknown" : "disabled"),
      workingDirectory: this.workingDirectory, currentFilePath: this.currentFilePath,
      currentFileId: this.currentFileId, currentOffset: this.committedOffset,
      sourceOffset: this.committedOffset, fileSize: this.metrics.currentFileSize,
      readOffset: this.readOffset, committedOffset: this.committedOffset,
      partialLineChars: this.partialBuffer.length, checkpointPath: this.checkpointPath,
      checkpointAgeMs: this.metrics.lastCommitAt ? Math.max(0, Date.now() - Date.parse(this.metrics.lastCommitAt)) : null,
      pollIntervalMs: this.pollIntervalMs, maxReadChunkBytes: MAX_READ_CHUNK_BYTES,
      maxProcessSliceMs: this.maxProcessSliceMs,
      theoreticalMaxBytesPerSec: Math.floor((1000 / this.pollIntervalMs) * MAX_READ_CHUNK_BYTES),
      linesPerSecond: elapsedSeconds ? this.metrics.linesProcessed / elapsedSeconds : 0,
      eventsPerSecond: elapsedSeconds ? this.metrics.acceptedEvents / elapsedSeconds : 0,
      isTicking: this.isTicking,
    };
  }

  publishDiagnostics() { this.webStatus?.set?.("logPostFileBridgeDiagnostics", this.getDiagnostics()); }
}

function splitCompleteLines(buffer, startOffset) {
  const lines = [];
  let cursor = 0;
  while (true) {
    const newline = buffer.indexOf(0x0a, cursor);
    if (newline < 0) break;
    let line = buffer.subarray(cursor, newline);
    if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
    lines.push({ buffer: line, offset: startOffset + cursor, nextOffset: startOffset + newline + 1 });
    cursor = newline + 1;
  }
  return { lines, remainder: cursor < buffer.length ? Buffer.from(buffer.subarray(cursor)) : Buffer.alloc(0), remainderOffset: startOffset + cursor };
}

function makeFileId(stat) {
  const ino = String(stat?.ino ?? 0);
  const dev = String(stat?.dev ?? 0);
  return ino !== "0" ? `${dev}:${ino}` : `${dev}:0:${Math.trunc(Number(stat?.ctimeMs) || 0)}`;
}
function safeSegment(value) { return String(value ?? "default").replace(/[^a-zA-Z0-9._-]/g, "_") || "default"; }
function yieldToEventLoop() { return new Promise((resolve) => setImmediate(resolve)); }
function getDateKey(now) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
