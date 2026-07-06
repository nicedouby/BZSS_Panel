// -*- coding: utf-8 -*-

import fs from "node:fs";
import path from "node:path";

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_RECENT_REPLAY_LINES = 120;
const DEFAULT_EVENT_NAME = "On_RawLogLine";
const ALL_EVENTS_FILE_NAME = "all.jsonl";

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
  }

  async start() {
    if (!this.enabled) {
      this.webStatus?.set?.("logPostFileBridge", "disabled");
      this.logger?.info?.("LogPost file bridge disabled.");
      return;
    }

    this.webStatus?.set?.("logPostFileBridge", "starting");
    await this.bootstrapCurrentFile();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        this.webStatus?.set?.("logPostFileBridge", "error");
        this.logger?.warn?.(`LogPost file bridge tick failed: ${error?.message ?? error}`);
      });
    }, this.pollIntervalMs);
    this.timer.unref?.();
    this.webStatus?.set?.("logPostFileBridge", "running");
    this.logger?.info?.(`LogPost file bridge watching ${this.workingDirectory}`);
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isTicking = false;
    this.webStatus?.set?.("logPostFileBridge", this.enabled ? "stopped" : "disabled");
  }

  async bootstrapCurrentFile() {
    const filePath = this.resolveCurrentFilePath();
    this.currentFilePath = filePath;
    this.currentDateKey = getDateKey(new Date());
    this.currentOffset = 0;
    this.partialLine = "";

    if (!fs.existsSync(filePath)) {
      return;
    }

    const stat = fs.statSync(filePath);
    if (this.fromEnd) {
      this.currentOffset = stat.size;
      if (this.replayRecentLines > 0) {
        await this.replayRecent(filePath, stat.size);
      }
      return;
    }

    this.currentOffset = 0;
    await this.readPendingFromFile(filePath);
  }

  async tick() {
    if (this.isTicking || !this.enabled) return;
    this.isTicking = true;
    try {
      const nextDateKey = getDateKey(new Date());
      if (nextDateKey !== this.currentDateKey) {
        await this.bootstrapCurrentFile();
      }
      await this.readPendingFromFile(this.currentFilePath || this.resolveCurrentFilePath());
    } finally {
      this.isTicking = false;
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
    if (!filePath || !fs.existsSync(filePath)) return;

    const stat = fs.statSync(filePath);
    if (stat.size < this.currentOffset) {
      this.currentOffset = 0;
      this.partialLine = "";
    }
    if (stat.size === this.currentOffset) return;

    const length = stat.size - this.currentOffset;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, length, this.currentOffset);
    } finally {
      fs.closeSync(fd);
    }

    this.currentOffset = stat.size;
    const chunkText = this.partialLine + buffer.toString("utf8");
    const lines = chunkText.split(/\r?\n/);
    this.partialLine = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      this.ingestJsonLine(line, { replay: false, filePath });
    }
  }

  ingestJsonLine(line, { replay, filePath }) {
    let rawEvent;
    try {
      rawEvent = JSON.parse(line);
    } catch (error) {
      this.logger?.warn?.(`LogPost file bridge ignored invalid jsonl row: ${error?.message ?? error}`);
      return;
    }

    const sourceFileName = path.basename(String(filePath ?? ""));
    const acceptAllEvents = sourceFileName === ALL_EVENTS_FILE_NAME;
    if (!acceptAllEvents && String(rawEvent?.Event ?? "") !== this.eventName) {
      return;
    }

    const event = this.eventPipeline.processRawGameEvent(rawEvent);
    event.fileBridgeReplay = Boolean(replay);
    event.fileBridgeSourcePath = this.currentFilePath;
    const gapEvent = this.logPostMonitor?.inspectEvent?.(event) ?? null;
    if (gapEvent) {
      this.eventBus.emitCoreEvent(gapEvent.eventName, gapEvent);
    }
    this.eventBus.emitCoreEvent(event.eventName, event);
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
