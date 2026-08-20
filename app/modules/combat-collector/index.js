// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { CombatEventStore } from "./combat-event-store.js";
import { normalizeLiveCombatEvent } from "./combat-event-normalizer.js";

const MODULE_ID = "module.combatCollector";
const WORKER_PATH = new URL("../../workers/kill-replay-worker.js", import.meta.url);
const REPLAY_PARSER_VERSION = 4;
const CORE_COMBAT_TYPES = Object.freeze({
  On_PlayerDamaged: "damage",
  On_PlayerWounded: "wound",
  On_PlayerDied: "death",
});

export function createCombatCollectorModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({ moduleId: MODULE_ID, source: MODULE_ID, channel: "module" }) ?? core.logger;
  const explicitConfig = config?.get?.("modules.combatCollector", null);
  const legacyConfig = config?.get?.("modules.killRecords", {}) ?? {};
  const moduleConfig = explicitConfig && typeof explicitConfig === "object" ? explicitConfig : legacyConfig;
  const squadLifecycleConfig = config?.get?.("modules.squadLifecycle", {}) ?? {};
  const squadReplayConfig = config?.get?.("modules.squadLifecycle.replay", squadLifecycleConfig.replay ?? {}) ?? squadLifecycleConfig.replay ?? {};
  const restoreSquadCreationOrder = squadReplayConfig.enabled !== false && squadReplayConfig.restoreCreationOrder !== false;
  const serverId = String(moduleConfig.serverId ?? config?.get?.("serverId", "") ?? core.webStatus?.serverId ?? "BZSS_Main") || "BZSS_Main";
  const storeDirectory = path.resolve(moduleConfig.storeDirectory ?? `./data/combat-events/${safeSegment(serverId)}`);
  const store = new CombatEventStore({ directory: storeDirectory, logger: moduleLogger });
  const unsubscribers = [];
  let worker = null;
  let messageQueue = Promise.resolve();
  let importQueue = Promise.resolve();
  let liveQueue = Promise.resolve();
  let stopping = false;
  let replayStatus = createReplayStatus();
  let rotationRetryCount = 0;

  const api = {
    getStatus,
    getReplayStatus: () => clone(replayStatus),
    getRecords: (filter = {}) => store.query(filter),
    getCombatRecords: (filter = {}) => store.query(filter),
    getOverview,
    getAll: () => store.getAll(),
    readCacheSnapshot: async () => ({ records: store.getAll(), stats: store.getStats() }),
    importReplayBatch,
    ingestLiveRecord,
    ingestCoreEvent,
    restartReplay,
    clearCache,
  };

  function ingestLiveRecord(payload = {}) {
    const source = payload?.record ?? payload;
    if (!source || !["damage", "wound", "death", "kill", "died"].includes(String(source.type ?? "").toLowerCase())) return null;
    const record = normalizeLiveCombatEvent(source);
    // insert() updates the in-memory index synchronously before its append
    // promise yields, so bursts cannot sit outside the collector's memory.
    const pendingWrite = store.insert(record, { observedMode: "live" });
    liveQueue = liveQueue
      .then(() => pendingWrite, () => pendingWrite)
      .catch((error) => moduleLogger?.error?.(`实时战斗事件写入缓存失败: ${error?.message ?? error}`));
    return record;
  }

  function ingestCoreEvent(event = {}) {
    const type = CORE_COMBAT_TYPES[event?.eventName];
    if (!type) return null;
    const combat = event?.normalized?.combat ?? {};
    const paramMap = event?.paramMap ?? {};
    return ingestLiveRecord({
      type,
      serverId: event.serverId,
      time: event.time,
      logTime: event.logTime,
      sourceEventId: event.eventId,
      sourceMode: event.sourceMode,
      sourceFile: event.sourceFile,
      sourceFileId: event.sourceFileId,
      sourceOffset: event.sourceOffset,
      rawLineHash: event.rawLineHash,
      rawLog: event.rawLog ?? event.rawEvent?.Raw,
      attacker: {
        name: firstValue(combat.attackerName, paramMap.AttackerName),
        steam64ID: firstValue(combat.attackerSteam64ID, paramMap.AttackerSteam64ID),
        eosID: firstValue(combat.attackerEOSID, paramMap.AttackerEOSID),
        controllerID: firstValue(combat.attackerControllerId, combat.attackerControllerID, paramMap.AttackerControllerID),
        teamID: firstValue(combat.attackerTeamID, paramMap.AttackerTeamID),
      },
      victim: {
        name: firstValue(combat.victimName, paramMap.VictimName),
        steam64ID: firstValue(combat.victimCachedSteam64ID, paramMap.VictimCachedSteam64ID),
        eosID: firstValue(combat.victimCachedEOSID, paramMap.VictimCachedEOSID),
        teamID: firstValue(combat.victimTeamID, paramMap.VictimTeamID),
      },
      weapon: firstValue(combat.weapon, combat.causedBy, paramMap.CausedBy),
      damage: firstValue(combat.damage, paramMap.ActualDamage, paramMap.KillingDamage),
      parse: {
        confidence: firstValue(combat.confidence, paramMap.Confidence),
        identityConfidence: firstValue(combat.identityConfidence, paramMap.IdentityConfidence),
        parseConfidence: firstValue(combat.parseConfidence, paramMap.ParseConfidence),
        status: firstValue(combat.parseStatus, paramMap.ParseStatus),
      },
    });
  }

  async function startReplay({ clear = false } = {}) {
    if (worker) return { ok: false, code: "ReplayAlreadyRunning" };
    if (clear) await store.clear();
    const sourcePath = await resolveSourcePath(moduleConfig);
    if (!sourcePath) return failReplay(new Error("SquadGameLogNotConfigured"));

    let stat;
    try {
      stat = await fs.stat(sourcePath);
    } catch (error) {
      return failReplay(error);
    }

    const sourceFileId = makeFileId(stat);
    const replayCutoffOffset = stat.size;
    const startedAt = new Date().toISOString();
    replayStatus = {
      ...createReplayStatus(),
      status: "starting",
      sourcePath,
      sourceFileId,
      startOffset: 0,
      replayCutoffOffset,
      completedOffset: 0,
      totalBytes: replayCutoffOffset,
      startedAt,
    };
    await store.saveState(replayStatus);

    if (restoreSquadCreationOrder) {
      modules?.squadLifecycle?.updateReplayProgress?.({
        status: "scanning", progress: 0, scannedBytes: 0,
        totalBytes: replayCutoffOffset, startedAt,
      });
    }

    worker = new Worker(WORKER_PATH, {
      workerData: {
        sourcePath,
        sourceFileId,
        serverId,
        startOffset: 0,
        endOffset: replayCutoffOffset,
        restoreSquadCreationOrder,
        readChunkBytes: moduleConfig.readChunkBytes,
        batchSize: moduleConfig.batchSize,
      },
    });
    replayStatus.status = "running";
    const activeWorker = worker;
    activeWorker.on("message", (message) => {
      messageQueue = messageQueue
        .then(() => handleWorkerMessage(message))
        .catch((error) => failReplay(error));
    });
    activeWorker.on("error", (error) => void failReplay(error));
    activeWorker.on("exit", (code) => {
      if (worker === activeWorker) worker = null;
      if (code !== 0 && replayStatus.status === "running") void failReplay(new Error(`Combat replay worker exited with code ${code}`));
      void messageQueue.finally(() => {
        if (!stopping && replayStatus.status === "source_changed" && rotationRetryCount < 3) {
          rotationRetryCount += 1;
          setTimeout(() => { if (!stopping && !worker) void startReplay(); }, 100);
        }
      });
    });
    return { ok: true, replay: clone(replayStatus) };
  }

  async function handleWorkerMessage(message = {}) {
    if (message.type === "combatBatch" || message.type === "killBatch") {
      await importReplayBatch(message.records);
      return;
    }
    if (message.type === "squadCreateBatch") {
      if (restoreSquadCreationOrder) modules?.squadLifecycle?.importReplayCreateBatch?.(message.records ?? []);
      return;
    }
    if (message.type === "squadReplayComplete") {
      if (restoreSquadCreationOrder) {
        modules?.squadLifecycle?.finalizeReplay?.({
          serverId,
          scannedBytes: Number(message.scannedBytes) || 0,
          totalBytes: Number(message.totalBytes) || 0,
          sourceFile: replayStatus.sourcePath,
          sourceFileId: replayStatus.sourceFileId,
          replayCutoffOffset: replayStatus.replayCutoffOffset,
          roundBoundaryOffset: Number(message.roundBoundaryOffset) || 0,
        });
      }
      return;
    }
    if (message.type === "progress") {
      replayStatus = { ...replayStatus, ...pickProgress(message), status: "running" };
      modules?.squadLifecycle?.updateReplayProgress?.({ ...pickProgress(message), status: "scanning" });
      await store.saveState(replayStatus);
      return;
    }
    if (message.type === "complete") {
      await importQueue;
      rotationRetryCount = 0;
      replayStatus = {
        ...replayStatus,
        ...pickProgress(message),
        status: "completed",
        progress: 100,
        completed: true,
        completedAt: new Date().toISOString(),
        durationMs: Number(message.durationMs) || 0,
      };
      await store.saveState(replayStatus);
      return;
    }
    if (message.type === "sourceChanged") {
      replayStatus = { ...replayStatus, status: "source_changed", completed: false, completedOffset: Number(message.offset) || replayStatus.completedOffset };
      await store.saveState(replayStatus);
      return;
    }
    if (message.type === "error") await failReplay(new Error(String(message.message ?? "Combat replay failed")), message.offset);
  }

  async function importReplayBatch(records = []) {
    importQueue = importQueue.then(async () => {
      const result = await store.insertBatch(records, { observedMode: "replay" });
      replayStatus.imported += result.inserted;
      replayStatus.duplicates += result.duplicates;
      return result;
    });
    return importQueue;
  }

  async function restartReplay({ clear = false } = {}) {
    if (worker) return { ok: false, code: "ReplayAlreadyRunning" };
    return startReplay({ clear });
  }

  async function clearCache() {
    if (worker) return { ok: false, code: "ReplayAlreadyRunning" };
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
    moduleLogger?.warn?.(`战斗日志溯源失败: ${replayStatus.error}`);
    return { ok: false, code: "CombatReplayFailed", message: replayStatus.error };
  }

  function getOverview() {
    const stats = store.getStats();
    return { ...stats, replay: clone(replayStatus), cacheFile: store.dataPath };
  }

  function getStatus() {
    return { ok: true, collector: getOverview(), replay: clone(replayStatus) };
  }

  return {
    manifest: {
      id: MODULE_ID,
      name: "战斗信息收集器",
      kind: "module",
      version: "1.1.0",
      description: "无副作用地收集实时和日志溯源的伤害、击倒、死亡事件，并保存到内存与 JSONL 缓存。",
    },
    apiName: "combatCollector",
    api,
    async start() {
      await store.load();
      replayStatus = { ...createReplayStatus(), ...(store.getStats().state ?? {}), status: "idle", completed: false };
      core.webRegistry?.registerPage?.({
        id: "web.combatRecords",
        title: "战斗记录",
        group: "管理",
        route: "/combat-records",
        pageModule: "/pages/combat-records.js",
        source: MODULE_ID,
        required: false,
        enabled: true,
        order: 108,
        icon: "⚔️",
        requiredPermission: "combat_manager.view",
        legacyRequiredPermissions: ["kill_manager.view"],
      });
      for (const eventName of Object.keys(CORE_COMBAT_TYPES)) {
        unsubscribers.push(core.eventBus?.onCoreEvent?.(eventName, ingestCoreEvent));
      }
      // Full source verification is mandatory on every process start. The
      // fixed cutoff keeps new bytes on the live path while the worker scans
      // [0, cutoff) and the store removes overlap idempotently.
      void startReplay();
    },
    async stop() {
      stopping = true;
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe?.(); } catch {}
      }
      if (worker) {
        const running = worker;
        worker = null;
        replayStatus.status = "stopped";
        await running.terminate();
      }
      await messageQueue;
      await importQueue;
      await liveQueue;
      await store.saveState(replayStatus);
      await store.flush();
    },
  };
}

function createReplayStatus() {
  return {
    schema: "combat-collector-state.v1",
    parserVersion: REPLAY_PARSER_VERSION,
    status: "idle",
    progress: 0,
    scannedBytes: 0,
    totalBytes: 0,
    scannedLines: 0,
    combatFound: 0,
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
    completedOffset: Math.max(0, Number(message.completedOffset) || 0),
    progress: Number.isFinite(Number(message.percentage)) ? Number(message.percentage) : (totalBytes ? scannedBytes / totalBytes * 100 : 100),
  };
}

async function resolveSourcePath(moduleConfig) {
  if (String(moduleConfig.sourcePath ?? "").trim()) return path.resolve(String(moduleConfig.sourcePath));
  const candidates = [path.resolve(moduleConfig.logPostConfigPath ?? "./LogPost/config.json"), path.resolve("./LogPost/config.example.json")];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, "utf8"));
      if (String(parsed.log_file ?? "").trim()) return path.resolve(String(parsed.log_file));
    } catch {}
  }
  return "";
}

function makeFileId(stat) {
  const ino = String(stat?.ino ?? 0);
  const dev = String(stat?.dev ?? 0);
  return ino !== "0" ? `${dev}:${ino}` : `${dev}:0:${Math.trunc(Number(stat?.ctimeMs) || 0)}`;
}

function safeSegment(value) {
  return String(value ?? "default").replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  }
  return "";
}

export default createCombatCollectorModule;
