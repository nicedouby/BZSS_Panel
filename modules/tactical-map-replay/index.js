// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { resolveTacticalMapKey, TACTICAL_MAP_CONFIGS } from "../../web-client/src/shared/tactical-map-data.shared.js";

const DEFAULT_DATA_DIR = "data/tactical-map-replay";
const DEFAULT_EXPORT_TEMP_DIR = path.join(os.tmpdir(), "bzss-tactical-map-replay");
const DEFAULT_RECORDING_MIN_PLAYER_COUNT = 50;
const DEFAULT_KEEPALIVE_KEYFRAME_MS = 2000;
const DEFAULT_POSITION_THRESHOLD = 300;
const DEFAULT_YAW_THRESHOLD = 8;
const DEFAULT_SEGMENT_IDLE_MS = 15000;
const DEFAULT_SNAP_DISTANCE = 14000;
const DEFAULT_EXPORT_FPS = 30;
const DEFAULT_EXPORT_RESOLUTION = 1280;
const MAX_QUERY_FRAMES = 8000;

export function createTacticalMapReplayModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.tacticalMapReplay",
    source: "module.tacticalMapReplay",
    channel: "module",
  }) ?? core.logger;

  const state = {
    initialized: false,
    config: null,
    dataDir: "",
    rawDir: "",
    indexDir: "",
    exportDir: "",
    exportTempDir: "",
    segmentIndexByServer: new Map(),
    lastRecordedFrameByServer: new Map(),
    exportTasks: new Map(),
    unsubscribe: null,
  };

  function readConfig() {
    const replayConfig = config.get("tacticalMapReplay", {}) ?? {};
    return {
      enabled: replayConfig.enabled !== false,
      dataDir: String(replayConfig.dataDir ?? DEFAULT_DATA_DIR).trim() || DEFAULT_DATA_DIR,
      exportTempDir: String(replayConfig.exportTempDir ?? DEFAULT_EXPORT_TEMP_DIR).trim() || DEFAULT_EXPORT_TEMP_DIR,
      ffmpegPath: String(replayConfig.ffmpegPath ?? "").trim(),
      recordingMinPlayerCount: normalizePositiveInteger(replayConfig.recordingMinPlayerCount, DEFAULT_RECORDING_MIN_PLAYER_COUNT),
      keepAliveKeyframeMs: normalizePositiveInteger(replayConfig.keepAliveKeyframeMs, DEFAULT_KEEPALIVE_KEYFRAME_MS),
      positionThreshold: normalizePositiveNumber(replayConfig.positionThreshold, DEFAULT_POSITION_THRESHOLD),
      yawThreshold: normalizePositiveNumber(replayConfig.yawThreshold, DEFAULT_YAW_THRESHOLD),
      segmentIdleMs: normalizePositiveInteger(replayConfig.segmentIdleMs, DEFAULT_SEGMENT_IDLE_MS),
      snapDistance: normalizePositiveNumber(replayConfig.snapDistance, DEFAULT_SNAP_DISTANCE),
    };
  }

  function getServerId() {
    return String(
      core.webStatus?.serverId
      ?? core.webStatus?.getSnapshot?.()?.serverId
      ?? "BZSS_Main",
    ).trim() || "BZSS_Main";
  }

  async function ensureInitialized() {
    if (state.initialized) return;
    state.config = readConfig();
    state.dataDir = path.resolve(process.cwd(), state.config.dataDir);
    state.rawDir = path.join(state.dataDir, "raw");
    state.indexDir = path.join(state.dataDir, "index");
    state.exportDir = path.join(state.dataDir, "exports");
    state.exportTempDir = path.resolve(process.cwd(), state.config.exportTempDir);
    await fs.mkdir(state.rawDir, { recursive: true });
    await fs.mkdir(state.indexDir, { recursive: true });
    await fs.mkdir(state.exportDir, { recursive: true });
    await fs.mkdir(state.exportTempDir, { recursive: true });
    state.initialized = true;
  }

  function buildFrame(players) {
    const now = Date.now();
    const snapshot = core.webStatus?.getSnapshot?.() ?? {};
    const runtime = core.runtimeState?.getAll?.() ?? {};
    const mapName = String(snapshot.mapName ?? snapshot.map ?? runtime?.server?.mapName ?? "").trim();
    const layer = String(snapshot.layer ?? snapshot.currentLayer ?? runtime?.server?.layer ?? "").trim();
    const mapKey = resolveTacticalMapKey(layer || mapName) ?? resolveTacticalMapKey(mapName) ?? "Sumari_RAAS_v1";
    return {
      frameId: `${now}-${crypto.randomBytes(4).toString("hex")}`,
      timestampMs: now,
      serverId: getServerId(),
      mapName,
      layer,
      mapKey,
      playerCount: Array.isArray(players) ? players.length : 0,
      players: normalizeReplayPlayers(players),
    };
  }

  function normalizeReplayPlayers(players) {
    return (Array.isArray(players) ? players : [])
      .map((player) => {
        const position = normalizeVector(player?.soldierInfo?.position);
        if (!position) return null;
        const rotation = normalizeVector(player?.soldierInfo?.rotation);
        return {
          playerGuid: String(player?.playerGuid ?? "").trim(),
          playerName: String(player?.playerName ?? "").trim(),
          teamId: normalizeFinite(player?.teamId),
          squadId: normalizeFinite(player?.squadId),
          health: normalizeFinite(player?.soldierInfo?.health),
          position,
          rotation,
          yaw: normalizeFinite(rotation?.z),
          soldierClass: String(player?.soldierInfo?.soldierClass ?? "").trim(),
          vehicleInfo: player?.vehicleInfo ? {
            vehicleType: String(player.vehicleInfo.vehicleType ?? "").trim(),
            health: normalizeFinite(player.vehicleInfo.health),
            maxHealth: normalizeFinite(player.vehicleInfo.maxHealth),
          } : null,
        };
      })
      .filter((item) => item && item.playerName && item.position);
  }

  function shouldRecordFrame(frame) {
    return frame.playerCount > state.config.recordingMinPlayerCount;
  }

  function getSegmentState(serverId) {
    const existing = state.segmentIndexByServer.get(serverId);
    if (existing) return existing;
    const next = { segments: [], currentSegmentId: "", dirty: false };
    state.segmentIndexByServer.set(serverId, next);
    return next;
  }

  async function loadSegmentIndex(serverId) {
    const filePath = getIndexFilePath(serverId);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      const loaded = {
        segments: Array.isArray(parsed?.segments) ? parsed.segments.map(clonePlainObject).filter(Boolean) : [],
        currentSegmentId: String(parsed?.currentSegmentId ?? "").trim(),
        dirty: false,
      };
      state.segmentIndexByServer.set(serverId, loaded);
      return loaded;
    } catch {
      const fresh = { segments: [], currentSegmentId: "", dirty: false };
      state.segmentIndexByServer.set(serverId, fresh);
      return fresh;
    }
  }

  async function ensureSegmentIndex(serverId) {
    const existing = state.segmentIndexByServer.get(serverId);
    if (existing) return existing;
    return loadSegmentIndex(serverId);
  }

  function getIndexFilePath(serverId) {
    return path.join(state.indexDir, `${sanitizeFileName(serverId)}.json`);
  }

  function getRawFilePath(serverId, timestampMs) {
    const date = new Date(timestampMs).toISOString().slice(0, 10);
    return path.join(state.rawDir, sanitizeFileName(serverId), `${date}.jsonl`);
  }

  function shouldStartNewSegment(segment, frame, previousFrame) {
    if (!segment) return true;
    if (!previousFrame) return false;
    if (frame.mapKey !== segment.mapKey) return true;
    if (frame.layer !== segment.layer) return true;
    if (frame.timestampMs - previousFrame.timestampMs > state.config.segmentIdleMs) return true;
    return false;
  }

  function createSegment(frame) {
    return {
      id: `tactical-replay-${frame.timestampMs}-${crypto.randomBytes(4).toString("hex")}`,
      serverId: frame.serverId,
      mapKey: frame.mapKey,
      mapName: frame.mapName,
      layer: frame.layer,
      startedAt: frame.timestampMs,
      endedAt: frame.timestampMs,
      frameCount: 0,
      playerNames: [],
      rawFiles: [],
      exportCount: 0,
    };
  }

  function shouldPersistFrame(frame, previousFrame) {
    if (!previousFrame) return true;
    if (!samePlayerSet(frame.players, previousFrame.players)) return true;
    const previousByGuid = new Map(previousFrame.players.map((item) => [buildReplayPlayerKey(item), item]));
    for (const player of frame.players) {
      const key = buildReplayPlayerKey(player);
      const previous = previousByGuid.get(key);
      if (!previous) return true;
      if (normalizeFinite(previous.health) <= 0 && normalizeFinite(player.health) > 0) return true;
      if (normalizeFinite(previous.health) > 0 && normalizeFinite(player.health) <= 0) return true;
      if (normalizeFinite(previous.teamId) !== normalizeFinite(player.teamId)) return true;
      if (normalizeFinite(previous.squadId) !== normalizeFinite(player.squadId)) return true;
      if (normalizeVehicleType(previous) !== normalizeVehicleType(player)) return true;
      const distance = distanceBetween(previous.position, player.position);
      if (distance >= state.config.positionThreshold) return true;
      const previousYaw = normalizeFinite(previous.yaw);
      const nextYaw = normalizeFinite(player.yaw);
      if (previousYaw != null && nextYaw != null && angularDifference(previousYaw, nextYaw) >= state.config.yawThreshold) {
        return true;
      }
    }
    return frame.timestampMs - previousFrame.timestampMs >= state.config.keepAliveKeyframeMs;
  }

  async function recordFrame(frame) {
    const serverId = frame.serverId;
    const segmentState = await ensureSegmentIndex(serverId);
    const previousFrame = state.lastRecordedFrameByServer.get(serverId) ?? null;

    let segment = segmentState.segments.find((item) => item.id === segmentState.currentSegmentId) ?? null;
    if (shouldStartNewSegment(segment, frame, previousFrame)) {
      segment = createSegment(frame);
      segmentState.segments.push(segment);
      segmentState.currentSegmentId = segment.id;
    }

    const rawFilePath = getRawFilePath(serverId, frame.timestampMs);
    await fs.mkdir(path.dirname(rawFilePath), { recursive: true });
    await fs.appendFile(rawFilePath, `${JSON.stringify({ segmentId: segment.id, frame })}\n`, "utf8");

    segment.frameCount += 1;
    segment.endedAt = frame.timestampMs;
    segment.playerNames = dedupeStrings([...segment.playerNames, ...frame.players.map((item) => item.playerName)]);
    const relativeRawPath = path.relative(state.dataDir, rawFilePath).replace(/\\/g, "/");
    if (!segment.rawFiles.includes(relativeRawPath)) segment.rawFiles.push(relativeRawPath);
    segmentState.dirty = true;

    state.lastRecordedFrameByServer.set(serverId, clonePlainObject(frame));
    await flushSegmentIndex(serverId, segmentState);
  }

  async function flushSegmentIndex(serverId, segmentState = null) {
    const target = segmentState ?? state.segmentIndexByServer.get(serverId);
    if (!target?.dirty) return;
    const filePath = getIndexFilePath(serverId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify({
      serverId,
      currentSegmentId: target.currentSegmentId,
      segments: target.segments,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
    target.dirty = false;
  }

  async function handleMonitorUpdate() {
    if (!state.config?.enabled) return;
    const players = modules?.bzssCoreMonitor?.getPlayers?.() ?? [];
    const frame = buildFrame(players);
    if (!shouldRecordFrame(frame)) return;
    const previousFrame = state.lastRecordedFrameByServer.get(frame.serverId) ?? null;
    if (!shouldPersistFrame(frame, previousFrame)) return;
    await recordFrame(frame);
  }

  async function listSegments() {
    await ensureInitialized();
    const files = await safeReaddir(state.indexDir);
    const serverIds = new Set([
      ...files.filter((item) => item.endsWith(".json")).map((fileName) => fileName.slice(0, -5)),
      ...state.segmentIndexByServer.keys(),
    ]);
    const all = [];
    for (const serverId of serverIds) {
      const index = await ensureSegmentIndex(serverId);
      for (const segment of index.segments) {
        all.push({
          ...clonePlainObject(segment),
          durationMs: Math.max(0, Number(segment.endedAt ?? 0) - Number(segment.startedAt ?? 0)),
        });
      }
    }
    all.sort((a, b) => Number(b.startedAt ?? 0) - Number(a.startedAt ?? 0));
    return {
      ok: true,
      items: all,
    };
  }

  async function getSegment(query = {}) {
    await ensureInitialized();
    const segmentId = String(query.id ?? "").trim();
    if (!segmentId) {
      return {
        ok: false,
        error: "InvalidSegmentId",
        message: "Segment id is required.",
      };
    }

    const located = await findSegmentById(segmentId);
    if (!located) {
      return {
        ok: false,
        error: "SegmentNotFound",
        message: `Segment '${segmentId}' was not found.`,
      };
    }

    const playerNames = parsePlayerNames(query.players);
    const fromMs = normalizeRangeValue(query.from, located.segment.startedAt);
    const toMs = normalizeRangeValue(query.to, located.segment.endedAt);
    const sampleEvery = Math.max(1, normalizePositiveInteger(query.sampleEvery ?? 1, 1));
    const frames = await readSegmentFrames(located.segment, { fromMs, toMs, playerNames, sampleEvery });
    return {
      ok: true,
      segment: {
        ...clonePlainObject(located.segment),
        durationMs: Math.max(0, Number(located.segment.endedAt ?? 0) - Number(located.segment.startedAt ?? 0)),
      },
      query: {
        fromMs,
        toMs,
        playerNames,
        sampleEvery,
      },
      frames,
      frameCount: frames.length,
    };
  }

  async function readSegmentFrames(segment, options = {}) {
    const fromMs = normalizeRangeValue(options.fromMs, segment.startedAt);
    const toMs = normalizeRangeValue(options.toMs, segment.endedAt);
    const playerNames = parsePlayerNames(options.playerNames);
    const sampleEvery = Math.max(1, normalizePositiveInteger(options.sampleEvery ?? 1, 1));
    const frames = [];
    let index = 0;
    for (const relativePath of segment.rawFiles ?? []) {
      const filePath = path.join(state.dataDir, relativePath);
      const content = await fs.readFile(filePath, "utf8").catch(() => "");
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (String(parsed?.segmentId ?? "") !== segment.id) continue;
        const frame = parsed?.frame;
        if (!frame || frame.timestampMs < fromMs || frame.timestampMs > toMs) continue;
        if (index % sampleEvery !== 0) {
          index += 1;
          continue;
        }
        const filtered = filterReplayFramePlayers(frame, playerNames);
        if (playerNames.length && filtered.players.length === 0) {
          index += 1;
          continue;
        }
        frames.push(filtered);
        index += 1;
        if (frames.length >= MAX_QUERY_FRAMES) return frames;
      }
    }
    return frames;
  }

  async function findSegmentById(segmentId) {
    const files = await safeReaddir(state.indexDir);
    const serverIds = new Set([
      ...files.filter((item) => item.endsWith(".json")).map((fileName) => fileName.slice(0, -5)),
      ...state.segmentIndexByServer.keys(),
    ]);
    for (const serverId of serverIds) {
      const index = await ensureSegmentIndex(serverId);
      const segment = index.segments.find((item) => item.id === segmentId);
      if (segment) return { serverId, segment };
    }
    return null;
  }

  async function createExportTask(input = {}) {
    await ensureInitialized();
    const segmentId = String(input.segmentId ?? "").trim();
    if (!segmentId) {
      return {
        ok: false,
        error: "InvalidSegmentId",
        message: "segmentId is required.",
      };
    }
    const located = await findSegmentById(segmentId);
    if (!located) {
      return {
        ok: false,
        error: "SegmentNotFound",
        message: `Segment '${segmentId}' was not found.`,
      };
    }

    const playerNames = parsePlayerNames(input.playerNames ?? input.players);
    const fromMs = normalizeRangeValue(input.fromMs, located.segment.startedAt);
    const toMs = normalizeRangeValue(input.toMs, located.segment.endedAt);
    const speed = normalizePlaybackSpeed(input.speed);
    const fps = normalizePositiveInteger(input.fps, DEFAULT_EXPORT_FPS);
    const resolution = normalizePositiveInteger(input.resolution, DEFAULT_EXPORT_RESOLUTION);
    const taskId = `tmr-export-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const fileName = `${sanitizeFileName(segmentId)}-${speed}x-${Date.now()}.mp4`;
    const outputFilePath = path.join(state.exportDir, fileName);
    const task = {
      id: taskId,
      segmentId,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fromMs,
      toMs,
      playerNames,
      speed,
      fps,
      resolution,
      outputFileName: fileName,
      outputFilePath,
      error: "",
      frameCount: 0,
    };
    state.exportTasks.set(taskId, task);
    runExportTask(task, located.segment).catch((error) => {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date().toISOString();
    });
    return { ok: true, task: clonePlainObject(task) };
  }

  async function runExportTask(task, segment) {
    task.status = "running";
    task.updatedAt = new Date().toISOString();
    if (!state.config.ffmpegPath) {
      throw new Error("tacticalMapReplay.ffmpegPath is not configured.");
    }
    const frames = await readSegmentFrames(segment, {
      fromMs: task.fromMs,
      toMs: task.toMs,
      playerNames: task.playerNames,
      sampleEvery: 1,
    });
    if (!frames.length) {
      throw new Error("No replay frames matched the export request.");
    }
    task.frameCount = frames.length;
    const tempDir = path.join(state.exportTempDir, task.id);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(tempDir, { recursive: true });

    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      const buffer = await renderReplayFrame(frame, {
        resolution: task.resolution,
        segment,
      });
      const filePath = path.join(tempDir, `${String(index + 1).padStart(6, "0")}.png`);
      await fs.writeFile(filePath, buffer);
    }

    await encodeVideoWithFfmpeg({
      ffmpegPath: state.config.ffmpegPath,
      inputPattern: path.join(tempDir, "%06d.png"),
      outputFilePath: task.outputFilePath,
      fps: task.fps,
      speed: task.speed,
    });

    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    task.status = "completed";
    task.updatedAt = new Date().toISOString();

    const located = await findSegmentById(task.segmentId);
    if (located?.segment) {
      located.segment.exportCount = Number(located.segment.exportCount ?? 0) + 1;
      const index = await ensureSegmentIndex(located.serverId);
      index.dirty = true;
      await flushSegmentIndex(located.serverId, index);
    }
  }

  function listExportTasks(query = {}) {
    const segmentId = String(query.id ?? query.segmentId ?? "").trim();
    const items = [...state.exportTasks.values()]
      .filter((task) => !segmentId || task.segmentId === segmentId)
      .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)))
      .map(clonePlainObject);
    return {
      ok: true,
      items,
    };
  }

  function getExportFile(query = {}) {
    const taskId = String(query.id ?? "").trim();
    const task = state.exportTasks.get(taskId);
    if (!task) return null;
    if (task.status !== "completed") return null;
    return {
      filePath: task.outputFilePath,
      fileName: task.outputFileName,
      contentType: "video/mp4",
    };
  }

  async function init() {
    await ensureInitialized();
    if (!state.config.enabled) return;
    const unsubscribe = modules?.bzssCoreMonitor?.subscribe?.(async () => {
      await handleMonitorUpdate().catch((error) => {
        moduleLogger.warn?.(`[TacticalMapReplay] Failed to record replay frame: ${error.message}`);
      });
    });
    state.unsubscribe = typeof unsubscribe === "function" ? unsubscribe : null;
  }

  async function stop() {
    if (typeof state.unsubscribe === "function") state.unsubscribe();
    state.unsubscribe = null;
    for (const [serverId, segmentState] of state.segmentIndexByServer) {
      await flushSegmentIndex(serverId, segmentState);
    }
  }

  return {
    manifest: {
      id: "module.tacticalMapReplay",
      name: "Tactical Map Replay",
      kind: "module",
      version: "0.1.0",
      description: "Records tactical map player samples, exposes replay queries, and exports filtered MP4 videos.",
    },
    apiName: "tacticalMapReplay",
    api: {
      listSegments,
      getSegment,
      createExportTask,
      listExportTasks,
      getExportFile,
      readConfig,
    },
    init,
    stop,
  };
}

async function renderReplayFrame(frame, options = {}) {
  const resolution = normalizePositiveInteger(options.resolution, DEFAULT_EXPORT_RESOLUTION);
  const height = resolution;
  const width = resolution;
  const mapConfig = TACTICAL_MAP_CONFIGS[frame.mapKey] ?? TACTICAL_MAP_CONFIGS.Sumari_RAAS_v1;
  const imagePath = path.join(process.cwd(), "web-client", "public", path.basename(mapConfig.image));
  let base = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 9, g: 19, b: 36, alpha: 1 },
    },
  });

  try {
    const mapBuffer = await sharp(imagePath)
      .resize(width, height, { fit: "cover" })
      .png()
      .toBuffer();
    base = base.composite([{ input: mapBuffer, left: 0, top: 0 }]);
  } catch {
    // Keep fallback solid background.
  }

  const overlays = [];
  for (const player of frame.players ?? []) {
    const position = projectReplayPlayer(player, mapConfig.bounds, width, height);
    if (!position) continue;
    const isVehicle = player.vehicleInfo && player.vehicleInfo.vehicleType && player.vehicleInfo.vehicleType !== "None";
    overlays.push({
      input: await createMarkerSvgBuffer({
        width,
        height,
        x: position.x,
        y: position.y,
        color: resolveTeamColor(player.teamId),
        label: player.playerName,
        isVehicle,
      }),
      left: 0,
      top: 0,
    });
  }
  overlays.push({
    input: Buffer.from(createFrameHeaderSvg({
      width,
      height,
      frame,
      segment: options.segment,
    })),
    left: 0,
    top: 0,
  });
  return base.composite(overlays).png().toBuffer();
}

function createFrameHeaderSvg({ width, frame, segment }) {
  const mapLabel = escapeXml(segment?.mapName || frame.mapName || frame.mapKey || "Unknown Map");
  const timeLabel = escapeXml(new Date(frame.timestampMs).toLocaleString("zh-CN", { hour12: false }));
  const playerLabel = escapeXml(`Players: ${frame.playerCount}`);
  return `
<svg width="${width}" height="${width}" xmlns="http://www.w3.org/2000/svg">
  <rect x="20" y="20" rx="12" ry="12" width="${width - 40}" height="70" fill="rgba(3,12,26,0.72)" />
  <text x="40" y="52" fill="#f8fafc" font-size="26" font-family="Segoe UI, Arial, sans-serif">${mapLabel}</text>
  <text x="40" y="82" fill="#bfdbfe" font-size="18" font-family="Segoe UI, Arial, sans-serif">${timeLabel}</text>
  <text x="${width - 220}" y="82" fill="#fde68a" font-size="18" font-family="Segoe UI, Arial, sans-serif">${playerLabel}</text>
</svg>`;
}

async function createMarkerSvgBuffer({ width, height, x, y, color, label, isVehicle }) {
  const safeLabel = escapeXml(label);
  const markerShape = isVehicle
    ? `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="${color}" stroke="#ffffff" stroke-width="2" transform="rotate(45, ${x}, ${y})" />`
    : `<circle cx="${x}" cy="${y}" r="8" fill="${color}" stroke="#ffffff" stroke-width="2" />`;
  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  ${markerShape}
  <rect x="${x + 12}" y="${y - 16}" rx="6" ry="6" width="${Math.max(90, safeLabel.length * 10)}" height="28" fill="rgba(7,16,31,0.88)" />
  <text x="${x + 20}" y="${y + 3}" fill="#f8fafc" font-size="16" font-family="Segoe UI, Arial, sans-serif">${safeLabel}</text>
</svg>`;
  return Buffer.from(svg);
}

function projectReplayPlayer(player, bounds, width, height) {
  const x = normalizeFinite(player?.position?.x);
  const y = normalizeFinite(player?.position?.y);
  if (x == null || y == null) return null;
  const percentX = projectValue(x, bounds.minX, bounds.maxX);
  const percentY = projectValue(y, bounds.minY, bounds.maxY);
  return {
    x: Math.round((percentX / 100) * width),
    y: Math.round((percentY / 100) * height),
  };
}

function projectValue(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) return 50;
  const pct = ((value - min) / (max - min)) * 100;
  return clamp(pct, 0, 100);
}

function resolveTeamColor(teamId) {
  if (Number(teamId) === 1) return "#3b82f6";
  if (Number(teamId) === 2) return "#ef4444";
  return "#f59e0b";
}

async function encodeVideoWithFfmpeg({ ffmpegPath, inputPattern, outputFilePath, fps, speed }) {
  await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
  const ptsScale = Number(speed) > 0 ? 1 / Number(speed) : 1;
  const args = [
    "-y",
    "-framerate", String(fps),
    "-i", inputPattern,
    "-vf", `setpts=${ptsScale.toFixed(6)}*PTS`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    outputFilePath,
  ];
  await spawnAndWait(ffmpegPath, args);
}

function spawnAndWait(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Process exited with code ${code}`));
    });
  });
}

function normalizeVector(vector) {
  if (!vector || typeof vector !== "object") return null;
  const x = normalizeFinite(vector.x);
  const y = normalizeFinite(vector.y);
  const z = normalizeFinite(vector.z);
  if (x == null || y == null) return null;
  return { x, y, z };
}

function buildReplayPlayerKey(player) {
  return String(player?.playerGuid ?? player?.playerName ?? "").trim();
}

function samePlayerSet(nextPlayers, previousPlayers) {
  const left = nextPlayers.map(buildReplayPlayerKey).filter(Boolean).sort();
  const right = previousPlayers.map(buildReplayPlayerKey).filter(Boolean).sort();
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function distanceBetween(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const dx = Number(left.x ?? 0) - Number(right.x ?? 0);
  const dy = Number(left.y ?? 0) - Number(right.y ?? 0);
  return Math.sqrt((dx * dx) + (dy * dy));
}

function angularDifference(left, right) {
  const diff = Math.abs(Number(left) - Number(right)) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function parsePlayerNames(value) {
  if (Array.isArray(value)) {
    return dedupeStrings(value.map((item) => String(item ?? "").trim()).filter(Boolean));
  }
  return dedupeStrings(
    String(value ?? "")
      .split(/[\r\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function filterReplayFramePlayers(frame, playerNames) {
  const allowed = new Set(parsePlayerNames(playerNames));
  if (!allowed.size) return clonePlainObject(frame);
  return {
    ...clonePlainObject(frame),
    players: (frame.players ?? []).filter((player) => allowed.has(String(player.playerName ?? "").trim())),
  };
}

function normalizeRangeValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : Math.trunc(Number(fallback ?? 0) || 0);
}

function normalizeVehicleType(player) {
  return String(player?.vehicleInfo?.vehicleType ?? "").trim();
}

function normalizeFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.trunc(number);
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

function normalizePlaybackSpeed(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 1;
  return clamp(number, 0.25, 8);
}

function safeReaddir(target) {
  return fs.readdir(target).catch(() => []);
}

function dedupeStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function sanitizeFileName(value) {
  return String(value ?? "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clonePlainObject(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
