// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { ReplayKillStore } from "./replay-store.js";
import { normalizeLiveCombat, normalizeLiveKill } from "./kill-record-normalizer.js";
import { dedupeKillRecords } from "./kill-record-dedupe.js";

const MODULE_ID = "module.killRecords";
const COMBAT_WORKER_PATH = new URL("../../workers/combat-replay-worker.js", import.meta.url);
const SQUAD_WORKER_PATH = new URL("../../workers/squad-replay-worker.js", import.meta.url);
const REPLAY_PARSER_VERSION = 4;

export function createKillRecordsModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({ moduleId: MODULE_ID, source: MODULE_ID, channel: "module" }) ?? core.logger;
  const moduleConfig = config?.get?.("modules.killRecords", {}) ?? {};
  const squadLifecycleConfig = config?.get?.("modules.squadLifecycle", {}) ?? {};
  const squadReplayConfig = config?.get?.("modules.squadLifecycle.replay", squadLifecycleConfig.replay ?? {}) ?? squadLifecycleConfig.replay ?? {};
  const restoreSquadCreationOrder = squadReplayConfig.enabled !== false && squadReplayConfig.restoreCreationOrder !== false;
  const serverId = String(moduleConfig.serverId ?? config?.get?.("serverId", "") ?? core.webStatus?.serverId ?? "BZSS_Main") || "BZSS_Main";
  const storeDirectory = path.resolve(moduleConfig.storeDirectory ?? `./data/kill-records/${safeSegment(serverId)}`);
  const store = new ReplayKillStore({ directory: storeDirectory, logger: moduleLogger });
  let combatWorker = null;
  let squadWorker = null;
  let importQueue = Promise.resolve();
  let messageQueue = Promise.resolve();
  let replayStatus = createReplayStatus();

  const api = {
    getStatus,
    getReplayStatus: () => clone(replayStatus),
    getReplayKills: (filter = {}) => applyFilters(store.getAll().filter((record) => record.type === "kill"), filter),
    getCombatRecords,
    getLiveKills,
    getRecords,
    getOverview,
    importReplayBatch,
    restartReplay,
    clearReplay,
  };

async function startReplay({ clear = false } = {}) {
    if (combatWorker || squadWorker) return { ok: false, code: "ReplayAlreadyRunning" };
    if (clear) await store.clear();
    const sourcePath = await resolveSourcePath(moduleConfig);
    if (!sourcePath) {
      replayStatus = { ...createReplayStatus(), status: "failed", error: "SquadGameLogNotConfigured" };
      await store.saveState(replayStatus);
      return { ok: false, code: "SquadGameLogNotConfigured" };
    }
    let stat;
    try { stat = await fs.stat(sourcePath); }
    catch (error) {
      replayStatus = { ...createReplayStatus(), status: "failed", sourcePath, error: error?.message ?? String(error) };
      await store.saveState(replayStatus);
      return { ok: false, code: "SquadGameLogUnavailable", message: replayStatus.error };
    }
    const sourceFileId = makeFileId(stat);
    const previous = store.getStats().state ?? {};
    const parserChanged = Number(previous.parserVersion) !== REPLAY_PARSER_VERSION;
    if (parserChanged && Object.keys(previous).length) await store.clear();
    const previousOffset = Number(previous.completedOffset);
    const canResume = Number(previous.parserVersion) === REPLAY_PARSER_VERSION
      && previous.sourcePath === sourcePath
      && previous.sourceFileId === sourceFileId
      && Number.isSafeInteger(previousOffset)
      && previousOffset >= 0 && previousOffset <= stat.size;
    const combatStartOffset = canResume ? previousOffset : 0;
    const cutoff = stat.size;
    const startedAt = new Date().toISOString();
    replayStatus = {
      ...createReplayStatus(),
      status: "running",
      parserVersion: REPLAY_PARSER_VERSION,
      sourcePath, sourceFileId,
      startOffset: combatStartOffset,
      replayCutoffOffset: cutoff,
      completedOffset: combatStartOffset,
      totalBytes: Math.max(0, cutoff - combatStartOffset),
      startedAt,
      combat: { status: "running", startOffset: combatStartOffset, cutoffOffset: cutoff },
      squad: { status: "locating_boundary", startOffset: 0, cutoffOffset: cutoff },
    };
    await store.saveState(replayStatus);
    modules?.squadLifecycle?.updateReplayProgress?.({ status: "locating_boundary", progress: 0, startedAt, sourceFile: sourcePath, sourceFileId, cutoffOffset: cutoff });
    const commonData = { sourcePath, sourceFileId, serverId, endOffset: cutoff, readChunkBytes: moduleConfig.readChunkBytes, batchSize: moduleConfig.batchSize };
    combatWorker = new Worker(COMBAT_WORKER_PATH, { workerData: { ...commonData, startOffset: combatStartOffset } });
    squadWorker = new Worker(SQUAD_WORKER_PATH, { workerData: { ...commonData, startOffset: 0, matchId: modules?.squadLifecycle?.getCurrentMatchId?.(serverId) ?? "" } });
    attachWorker(combatWorker, "combat");
    attachWorker(squadWorker, "squad");
    return { ok: true, replay: clone(replayStatus) };
  }

  function attachWorker(instance, kind) {
    instance.on("message", (message) => {
      messageQueue = messageQueue.then(() => handleWorkerMessage(message, kind)).catch((error) => failReplay(error));
    });
    instance.on("error", (error) => { void failReplay(error); });
    instance.on("exit", (code) => {
      if (kind === "combat") combatWorker = null;
      else squadWorker = null;
      if (code !== 0 && replayStatus.status !== "failed") void failReplay(new Error(`${kind} replay worker exited with code ${code}`));
      moduleLogger?.debug?.(`${kind} replay worker exited (${code}).`);
    });
  }

  async function handleWorkerMessage(message = {}, kind = "combat") {
    if (kind === "combat" && (message.type === "combatBatch" || message.type === "killBatch")) {
      await importReplayBatch(message.records);
      return;
    }
    if (kind === "squad" && message.type === "squadCreateBatch") {
      modules?.squadLifecycle?.importReplayCreateBatch?.(message.records ?? []);
      return;
    }
    if (kind === "squad" && message.type === "boundaryUnknown") {
      replayStatus = { ...replayStatus, squad: { ...(replayStatus.squad ?? {}), status: "boundary_unknown", boundaryFound: false, roundBoundaryOffset: null, cutoffOffset: message.cutoffOffset } };
      modules?.squadLifecycle?.updateReplayProgress?.({ status: "boundary_unknown", boundaryFound: false, roundBoundaryOffset: null, cutoffOffset: message.cutoffOffset });
      await store.saveState(replayStatus);
      return;
    }
    if (kind === "squad" && message.type === "boundaryFound") {
      replayStatus = { ...replayStatus, squad: { ...(replayStatus.squad ?? {}), status: "scanning", boundaryFound: true, roundBoundaryOffset: message.roundBoundaryOffset, cutoffOffset: message.cutoffOffset } };
      modules?.squadLifecycle?.updateReplayProgress?.({ status: "scanning", boundaryFound: true, roundBoundaryOffset: message.roundBoundaryOffset, cutoffOffset: message.cutoffOffset });
      await store.saveState(replayStatus);
      return;
    }
    if (kind === "squad" && message.type === "progress") {
      modules?.squadLifecycle?.updateReplayProgress?.({ ...message, status: "scanning" });
      replayStatus = { ...replayStatus, squad: { ...(replayStatus.squad ?? {}), ...message, status: "scanning" } };
      await store.saveState(replayStatus);
      return;
    }
    if (kind === "squad" && message.type === "complete") {
      modules?.squadLifecycle?.finalizeReplay?.({
        serverId, sourceFile: replayStatus.sourcePath, sourceFileId: replayStatus.sourceFileId,
        replayCutoffOffset: replayStatus.replayCutoffOffset,
        roundBoundaryOffset: message.roundBoundaryOffset ?? null,
        scannedBytes: message.scannedBytes, totalBytes: message.totalBytes,
      });
      replayStatus = { ...replayStatus, squad: { ...(replayStatus.squad ?? {}), ...message, status: "completed" } };
      await store.saveState(replayStatus);
      return;
    }
    if (kind === "combat" && message.type === "progress") {
      replayStatus = { ...replayStatus, ...pickProgress(message), status: "running", combat: { ...(replayStatus.combat ?? {}), ...pickProgress(message), status: "scanning" } };
      await store.saveState(replayStatus);
      return;
    }
    if (kind === "combat" && message.type === "complete") {
      await importQueue;
      replayStatus = { ...replayStatus, ...pickProgress(message), progress: 100, completed: true, status: "completed", completedAt: new Date().toISOString(), durationMs: Number(message.durationMs) || 0, combat: { ...(replayStatus.combat ?? {}), ...message, status: "completed" } };
      await store.saveState(replayStatus);
      return;
    }
    if (message.type === "sourceChanged") {
      replayStatus = { ...replayStatus, status: "source_changed", completed: false, error: `${kind} source changed during replay` };
      await store.saveState(replayStatus);
      return;
    }
    if (message.type === "error") await failReplay(new Error(String(message.message ?? `${kind} replay failed`)), message.offset);
  }

  async function importReplayBatch(records = []) {
    importQueue = importQueue.then(async () => {
      const result = await store.insertBatch(records);
      replayStatus.imported += result.inserted;
      replayStatus.duplicates += result.duplicates;
      replayStatus.combatFound = Math.max(replayStatus.combatFound, replayStatus.imported + replayStatus.duplicates);
      return result;
    });
    return importQueue;
  }

  function getLiveKills(filter = {}) {
    const state = modules?.combatClean?.getState?.(String(filter.serverId ?? "")) ?? { events: [] };
    const records = (state.events ?? [])
      .filter((record) => record.type === "kill")
      .map(normalizeLiveKill);
    return applyFilters(records, filter);
  }

  function getCombatRecords(filter = {}) {
    const source = String(filter.source ?? "all");
    const replay = source === "live" ? [] : store.getAll();
    const liveEvents = source === "replay"
      ? []
      : (modules?.combatClean?.getEvents?.({ serverId: filter.serverId, type: "all", limit: 5000, offset: 0 }) ?? [])
        .map(normalizeLiveCombat);
    return applyCombatFilters(dedupeCombatRecords([...replay, ...liveEvents]), filter);
  }

  function getRecords(filter = {}) {
    const source = String(filter.source ?? "all");
    const replay = source === "live" ? [] : store.getAll().filter((record) => record.type === "kill");
    const live = source === "replay" ? [] : getLiveKills({ serverId: filter.serverId, raw: true }).records;
    const merged = dedupeKillRecords([...replay, ...live]);
    return applyFilters(merged, filter);
  }

  function getOverview() {
    const replayStats = store.getStats();
    const replayKills = store.getAll().filter((record) => record.type === "kill");
    const live = getLiveKills({ raw: true }).records;
    const combined = dedupeKillRecords([...replayKills, ...live]);
    return {
      replayCount: replayStats.kill,
      replayDamage: replayStats.damage,
      replayWound: replayStats.wound,
      replayKills: replayStats.kill,
      liveCount: live.length,
      total: combined.length,
      teamKills: combined.filter((record) => record.isTeamKill).length,
      lastUpdatedAt: latestTime(combined),
      replay: clone(replayStatus),
    };
  }

  function getStatus() {
    return { ok: true, replay: clone(replayStatus), live: { count: getLiveKills({ raw: true }).records.length }, overview: getOverview() };
  }

  async function restartReplay(options = {}) {
    if (combatWorker || squadWorker) return { ok: false, code: "ReplayAlreadyRunning" };
    return startReplay({ clear: Boolean(options.clear) });
  }

  async function clearReplay() {
    if (combatWorker || squadWorker) return { ok: false, code: "ReplayAlreadyRunning" };
    const cleared = await store.clear();
    replayStatus = createReplayStatus();
    return { ok: true, cleared };
  }

  async function failReplay(error, offset = null) {
    replayStatus = {
      ...replayStatus,
      status: "failed",
      completed: false,
      error: error?.message ?? String(error),
      completedOffset: offset === null ? replayStatus.completedOffset : Number(offset) || replayStatus.completedOffset,
    };
    await store.saveState(replayStatus);
    if (restoreSquadCreationOrder) {
      modules?.squadLifecycle?.finalizeReplay?.({ serverId, error: replayStatus.error });
    }
    moduleLogger?.warn?.(`Kill replay failed: ${replayStatus.error}`);
  }

  return {
    manifest: {
      id: MODULE_ID,
      name: "击杀记录",
      kind: "module",
      version: "1.1.0",
      description: "在独立 Worker 中回溯 SquadGame.log 的历史伤害、击倒和击杀；回溯只进入查询存储，不进入 EventBus。",
    },
    apiName: "killRecords",
    api,
    async start() {
      await store.load();
      replayStatus = { ...createReplayStatus(), ...(store.getStats().state ?? {}) };
      core.webRegistry?.registerPage?.({
        id: "web.killRecords",
        title: "击杀记录",
        group: "管理",
        route: "/kill-records",
        pageModule: "/pages/kill-records.js",
        source: MODULE_ID,
        required: false,
        enabled: true,
        order: 109,
        icon: "🎯",
        requiredPermission: "combat_manager.view",
        legacyRequiredPermissions: ["kill_manager.view"],
      });
      if (moduleConfig.replayOnStart !== false || restoreSquadCreationOrder) void startReplay();
    },
    async stop() {
      const runningCombat = combatWorker;
      const runningSquad = squadWorker;
      combatWorker = null;
      squadWorker = null;
      replayStatus.status = "stopped";
      if (runningCombat) await runningCombat.terminate();
      if (runningSquad) await runningSquad.terminate();
      await importQueue;
      await messageQueue;
      await store.saveState(replayStatus);
      await store.flush();
    },
  };
}

function applyFilters(records, filter = {}) {
  const serverId = String(filter.serverId ?? "");
  const type = String(filter.type ?? "all");
  const search = String(filter.search ?? "").trim().toLowerCase();
  let result = records;
  if (serverId) result = result.filter((record) => record.serverId === serverId);
  if (type === "tk") result = result.filter((record) => record.isTeamKill);
  else if (type === "kill") result = result.filter((record) => !record.isTeamKill);
  if (search) result = result.filter((record) => [record.attacker, record.victim, record.weapon, record.rawLog]
    .some((value) => JSON.stringify(value ?? "").toLowerCase().includes(search)));
  result = result.slice().sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || Number(b.sourceOffset) - Number(a.sourceOffset));
  if (filter.raw) return { total: result.length, records: result };
  const offset = Math.max(0, Number(filter.offset) || 0);
  const limit = Math.max(1, Math.min(1000, Number(filter.limit) || 200));
  return { total: result.length, records: result.slice(offset, offset + limit) };
}

function applyCombatFilters(records, filter = {}) {
  const serverId = String(filter.serverId ?? "");
  const type = normalizeCombatType(filter.type ?? "all");
  const search = String(filter.search ?? "").trim().toLowerCase();
  let result = records;
  if (serverId) result = result.filter((record) => record.serverId === serverId);
  if (type !== "all") result = result.filter((record) => normalizeCombatType(record.type) === type);
  if (search) result = result.filter((record) => [record.attacker, record.victim, record.weapon, record.rawLog]
    .some((value) => JSON.stringify(value ?? "").toLowerCase().includes(search)));
  result = result.slice().sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || Number(b.sourceOffset) - Number(a.sourceOffset));
  const offset = Math.max(0, Number(filter.offset) || 0);
  const limit = Math.max(1, Math.min(5000, Number(filter.limit) || 300));
  return { total: result.length, records: result.slice(offset, offset + limit) };
}

function dedupeCombatRecords(records = []) {
  const byKey = new Map();
  for (const record of records) {
    const key = String(record.rawLog ?? "").trim()
      || [record.serverId, record.type, record.time, record.attacker?.name, record.victim?.name, record.damage, record.weapon].join("|");
    const previous = byKey.get(key);
    if (!previous || (record.source === "live" && previous.source !== "live")) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function normalizeCombatType(value) {
  const type = String(value ?? "").trim().toLowerCase();
  if (type === "damaged") return "damage";
  if (type === "wounded") return "wound";
  if (["death", "died", "dead", "tk"].includes(type)) return "kill";
  return ["damage", "wound", "kill"].includes(type) ? type : "all";
}

async function resolveSourcePath(moduleConfig) {
  if (String(moduleConfig.sourcePath ?? "").trim()) return path.resolve(String(moduleConfig.sourcePath));
  const candidates = [
    path.resolve(moduleConfig.logPostConfigPath ?? "./LogPost/config.json"),
    path.resolve("./LogPost/config.example.json"),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, "utf8"));
      if (String(parsed.log_file ?? "").trim()) return path.resolve(String(parsed.log_file));
    } catch {}
  }
  return "";
}

function createReplayStatus() {
  return {
    schema: "kill-replay-state.v1",
    parserVersion: REPLAY_PARSER_VERSION,
    status: "idle",
    progress: 0,
    combat: { status: "idle", startOffset: 0, cutoffOffset: 0, scannedLines: 0, damageCandidates: 0, woundCandidates: 0, killCandidates: 0, imported: 0, duplicates: 0 },
    squad: { status: "idle", boundaryFound: false, roundBoundaryOffset: null, cutoffOffset: 0, squadCreatesFound: 0, accepted: 0, pendingTeamResolution: 0 },
    scannedBytes: 0,
    totalBytes: 0,
    scannedLines: 0,
    combatFound: 0,
    combatCandidates: 0,
    damageCandidates: 0,
    woundCandidates: 0,
    killCandidates: 0,
    damageParsed: 0,
    woundParsed: 0,
    killParsed: 0,
    damageRejected: 0,
    woundRejected: 0,
    killRejected: 0,
    damageFound: 0,
    woundsFound: 0,
    killsFound: 0,
    imported: 0,
    duplicates: 0,
    startOffset: 0,
    replayCutoffOffset: 0,
    completedOffset: 0,
    completed: false,
    startedAt: "",
    completedAt: "",
    error: "",
  };
}

function pickProgress(message) {
  const scannedBytes = Math.max(0, Number(message.scannedBytes) || 0);
  const totalBytes = Math.max(0, Number(message.totalBytes) || 0);
  return {
    scannedBytes,
    totalBytes,
    scannedLines: Math.max(0, Number(message.scannedLines) || 0),
    combatFound: Math.max(0, Number(message.combatFound) || 0),
    damageFound: Math.max(0, Number(message.damageFound) || 0),
    woundsFound: Math.max(0, Number(message.woundsFound) || 0),
    killsFound: Math.max(0, Number(message.killsFound) || 0),
    combatCandidates: Math.max(0, Number(message.combatCandidates ?? message.combatFound) || 0),
    damageCandidates: Math.max(0, Number(message.damageCandidates ?? message.damageFound) || 0),
    woundCandidates: Math.max(0, Number(message.woundCandidates ?? message.woundsFound) || 0),
    killCandidates: Math.max(0, Number(message.killCandidates ?? message.killsFound) || 0),
    damageParsed: Math.max(0, Number(message.damageParsed ?? message.damageFound) || 0),
    woundParsed: Math.max(0, Number(message.woundParsed ?? message.woundsFound) || 0),
    killParsed: Math.max(0, Number(message.killParsed ?? message.killsFound) || 0),
    completedOffset: Math.max(0, Number(message.completedOffset) || 0),
    progress: Number.isFinite(Number(message.percentage)) ? Number(message.percentage) : (totalBytes ? scannedBytes / totalBytes * 100 : 100),
  };
}

function makeFileId(stat) {
  const ino = String(stat?.ino ?? 0);
  const dev = String(stat?.dev ?? 0);
  return ino !== "0" ? `${dev}:${ino}` : `${dev}:0:${Math.trunc(Number(stat?.ctimeMs) || 0)}`;
}

function latestTime(records) {
  return records.reduce((latest, record) => Date.parse(record.time) > Date.parse(latest || 0) ? record.time : latest, "");
}

function safeSegment(value) {
  return String(value ?? "default").replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export default createKillRecordsModule;
