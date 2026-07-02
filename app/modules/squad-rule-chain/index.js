// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

import {
  FINAL_SQUAD_RULE_PASSED_EVENT,
  SQUAD_RULE_CHAIN_MODULE_ID,
  SQUAD_RULE_SOURCES,
  TIERED_SQUAD_TIME_PASSED_EVENT,
  SQUAD_RULE_VIOLATION_EVENT,
  normalizeRuleChainPassEvent,
  normalizeSquadRuleViolationEvent,
} from "./events.js";
import { classifySquadName, SQUAD_NATURE, SQUAD_NATURE_LABEL } from "../../domain/squad/squad_name_classifier.js";

const API_NAME = "squadRuleChain";
const DEFAULT_RECENT_LIMIT = 200;
const DEFAULT_FINAL_PASS_FALLBACK_DELAY_MS = 1500;
const DEFAULT_DATA_DIR = "./data/squad-rule-chain";
const FINAL_PASS_CACHE_FILE = "final-pass-cache.json";

export function createSquadRuleChainModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: SQUAD_RULE_CHAIN_MODULE_ID,
    source: SQUAD_RULE_CHAIN_MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const unsubscribers = [];
  const recent = [];
  const finalPassRecords = [];
  const finalPassByPlayer = new Map();
  const finalPassSeenKeys = new Set();
  const pendingFinalPassTimers = new Map();
  const dataDir = path.resolve(process.cwd(), readRuntimeConfig().directory);
  let loadedFinalPassCache = null;
  let activeFinalPassCacheKey = "";
  let activeFinalPassMatchAliases = [];
  let finalPassCacheWrite = Promise.resolve();
  let nextCreationOrderCode = 1;
  const stats = {
    handled: 0,
    warned: 0,
    disbanded: 0,
    removed: 0,
    broadcasts: 0,
    errors: 0,
  };

  const api = {
    getState() {
      maybeRestoreFinalPassCacheForCurrentMatch();
      return {
        recent: recent.slice().reverse(),
        finalPassRecords: finalPassRecords.slice().reverse(),
        finalPassCache: {
          cacheKey: activeFinalPassCacheKey,
          matchAliases: activeFinalPassMatchAliases.slice(),
          loaded: Boolean(activeFinalPassCacheKey),
          filePath: finalPassCachePath(),
        },
        stats: { ...stats },
      };
    },

    clearCurrent(input = {}) {
      const aliases = resolveClearMatchAliases(input, core, modules);
      clearFinalPassState(aliases);
      persistFinalPassCacheLater();
      return {
        cacheKey: activeFinalPassCacheKey,
        matchAliases: activeFinalPassMatchAliases.slice(),
        cleared: true,
      };
    },
  };

  return {
    manifest: {
      id: SQUAD_RULE_CHAIN_MODULE_ID,
      name: "Squad Rule Chain",
      kind: "module",
      version: "1.0.0",
      description: "Chains squad-rule pass events and centralizes squad-rule violation handling.",
      hidden: true,
    },
    apiName: API_NAME,
    api,

    async init() {
      await loadFinalPassCache();
      maybeRestoreFinalPassCacheForCurrentMatch();
    },

    async start() {
      if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(
          core.eventBus.onModuleEvent(
            SQUAD_RULE_CHAIN_MODULE_ID,
            SQUAD_RULE_VIOLATION_EVENT,
            (event) => void handleViolation(event),
          ),
        );
        unsubscribers.push(
          core.eventBus.onModuleEvent(
            SQUAD_RULE_CHAIN_MODULE_ID,
            FINAL_SQUAD_RULE_PASSED_EVENT,
            (event) => void handleFinalPass(event),
          ),
        );
        unsubscribers.push(
          core.eventBus.onModuleEvent(
            SQUAD_RULE_CHAIN_MODULE_ID,
            TIERED_SQUAD_TIME_PASSED_EVENT,
            (event) => scheduleFinalPassFallback(event),
          ),
        );
        unsubscribers.push(
          core.eventBus.onCoreEvent?.("round.world_bring_up", (event) => {
            void handleRoundWorldBringUp(event);
          }) ?? (() => {}),
        );
      }
    },

    async stop() {
      for (const timer of pendingFinalPassTimers.values()) {
        clearTimeout(timer);
      }
      pendingFinalPassTimers.clear();
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe(); } catch {}
      }
      await finalPassCacheWrite.catch(() => {});
    },
  };

  async function handleViolation(input = {}) {
    const event = normalizeSquadRuleViolationEvent(input);
    if (!isLiveActionEvent(event)) {
      remember(recent, {
        id: `${SQUAD_RULE_CHAIN_MODULE_ID}:audit:${Date.now()}:${Math.random().toString(16).slice(2)}`,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        event,
        actions: [{ type: "audit_only" }],
        status: "audit_only",
      }, recentLimit());
      return;
    }
    cancelFinalPassFallback(event);
    const record = {
      id: `${SQUAD_RULE_CHAIN_MODULE_ID}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      event,
      actions: [],
    };

    try {
      record.status = "handling";
      if (event.removeLeaderBeforeDisband) {
        const removeResult = await removeLeader(event);
        record.actions.push({
          type: removeResult?.ok === false ? "remove_failed" : "removed",
          result: summarizeActionResult(removeResult),
        });
        if (removeResult?.ok !== false) stats.removed += 1;
      }

      if (event.broadcastMessage) {
        const broadcastResult = await broadcastViolation(event);
        record.actions.push({
          type: broadcastResult?.success === false ? "broadcast_failed" : "broadcasted",
          result: summarizeActionResult(broadcastResult),
        });
        if (broadcastResult?.success !== false) stats.broadcasts += 1;
      }

      const disbandResult = await disbandSquad(event);
      record.actions.push({
        type: disbandResult?.ok === false ? "disband_failed" : "disbanded",
        result: summarizeActionResult(disbandResult),
      });
      if (disbandResult?.ok !== false) stats.disbanded += 1;

      const warningMessages = buildWarningMessages(event);
      for (const message of warningMessages) {
        const warnResult = await warnLeader(event, message);
        record.actions.push({
          type: warnResult?.success === false ? "warn_failed" : "warned",
          result: summarizeActionResult(warnResult),
        });
        if (warnResult?.success !== false) stats.warned += 1;
      }

      stats.handled += 1;
      record.status = "handled";
      record.updatedAt = nowIso();
    } catch (error) {
      stats.errors += 1;
      record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = nowIso();
      moduleLogger?.warn?.(`[SquadRuleChain] failed to handle violation: ${record.error}`);
    }

    remember(recent, record, recentLimit());
  }

  async function handleFinalPass(input = {}) {
    const event = normalizeRuleChainPassEvent(input);
    if (!isLiveActionEvent(event)) {
      return;
    }
    ensureFinalPassCacheForEvent(event);
    cancelFinalPassFallback(event);
    const seenKey = buildFinalPassEventKey(event);
    if (seenKey && finalPassSeenKeys.has(seenKey)) return;
    if (seenKey) finalPassSeenKeys.add(seenKey);

    const record = {
      id: `${SQUAD_RULE_CHAIN_MODULE_ID}:final:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      event,
      creationOrderCode: takeNextCreationOrderCode(),
      actions: [],
      status: "handling",
    };

    const playerKey = buildPlayerKey(event);
    if (playerKey) {
      const previousId = finalPassByPlayer.get(playerKey);
      if (previousId) {
        removeFinalPassRecord(previousId);
        record.replacedRecordId = previousId;
      }
      finalPassByPlayer.set(playerKey, record.id);
    }

    try {
      const broadcastResult = await broadcastFinalPass(record);
      record.actions.push({
        type: broadcastResult?.success === false ? "broadcast_failed" : "broadcasted",
        result: summarizeActionResult(broadcastResult),
      });
      if (broadcastResult?.success !== false) stats.broadcasts += 1;

      const warningMessages = buildFinalPassWarningMessages(record.event);
      for (const message of warningMessages) {
        const warnResult = await warnLeader(record.event, message);
        record.actions.push({
          type: warnResult?.success === false ? "warn_failed" : "warned",
          result: summarizeActionResult(warnResult),
        });
        if (warnResult?.success !== false) stats.warned += 1;
      }

      record.status = broadcastResult?.success === false ? "broadcast_failed" : "handled";
      record.updatedAt = nowIso();
    } catch (error) {
      stats.errors += 1;
      record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = nowIso();
      moduleLogger?.warn?.(`[SquadRuleChain] failed to handle final pass: ${record.error}`);
    }

    remember(finalPassRecords, record, recentLimit());
    persistFinalPassCacheLater();
  }

  async function handleRoundWorldBringUp(input = {}) {
    const event = input && typeof input === "object" ? input : {};
    if (!isLiveActionEvent(event)) return;
    const cleared = api.clearCurrent(event);
    if (cleared?.cleared) {
      moduleLogger?.info?.(
        `[SquadRuleChain] cleared previous creation order for new round. cacheKey=${cleared.cacheKey || "unknown"} aliases=${cleared.matchAliases.join(",") || "none"}`,
        {
          operation: "roundWorldBringUpClear",
          data: {
            serverId: normalizeText(event.serverId),
            logLineTime: normalizeText(event?.normalized?.roundWorldBringUp?.logLineTime || event.logLineTime),
            layerName: normalizeText(event?.normalized?.roundWorldBringUp?.layerName || event.layerName),
            mapName: normalizeText(event?.normalized?.roundWorldBringUp?.mapName || event.mapName),
          },
        },
      );
    }
  }

  function scheduleFinalPassFallback(input = {}) {
    const event = normalizeRuleChainPassEvent(input);
    const key = buildFinalPassEventKey(event);
    if (!key || finalPassSeenKeys.has(key) || pendingFinalPassTimers.has(key)) return;
    const timer = setTimeout(() => {
      pendingFinalPassTimers.delete(key);
      void handleFinalPass({
        ...event,
        sourceEventId: event.sourceEventId || key,
      });
    }, finalPassFallbackDelayMs());
    pendingFinalPassTimers.set(key, timer);
  }

  function cancelFinalPassFallback(input = {}) {
    const event = normalizeRuleChainPassEvent(input);
    const key = buildFinalPassEventKey(event);
    if (!key) return;
    const timer = pendingFinalPassTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    pendingFinalPassTimers.delete(key);
  }

  function finalPassFallbackDelayMs() {
    const raw = config?.get?.("modules.squadRuleChain", {}) ?? {};
    const value = Number(raw.finalPassFallbackDelayMs);
    if (Number.isFinite(value) && value >= 0) return Math.floor(value);
    return DEFAULT_FINAL_PASS_FALLBACK_DELAY_MS;
  }

  function removeFinalPassRecord(recordId) {
    const index = finalPassRecords.findIndex((item) => item?.id === recordId);
    if (index >= 0) finalPassRecords.splice(index, 1);
  }

  function readRuntimeConfig() {
    const raw = config?.get?.("modules.squadRuleChain", {}) ?? {};
    return {
      directory: normalizeText(raw.directory) || DEFAULT_DATA_DIR,
    };
  }

  function finalPassCachePath() {
    return path.join(dataDir, FINAL_PASS_CACHE_FILE);
  }

  async function loadFinalPassCache() {
    try {
      const text = await fs.readFile(finalPassCachePath(), "utf8");
      const parsed = JSON.parse(text);
      loadedFinalPassCache = parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        moduleLogger?.warn?.(`[SquadRuleChain] failed to load final pass cache: ${error?.message ?? error}`);
      }
      loadedFinalPassCache = null;
    }
  }

  function maybeRestoreFinalPassCacheForCurrentMatch() {
    const currentAliases = buildCurrentMatchCacheAliases(core, modules);
    const currentKey = currentAliases[0] ?? "";
    if (currentAliases.length > 0 && activeFinalPassCacheKey && !hasAnyMatchAlias(activeFinalPassMatchAliases, currentAliases)) {
      finalPassRecords.splice(0, finalPassRecords.length);
      finalPassByPlayer.clear();
      finalPassSeenKeys.clear();
      nextCreationOrderCode = 1;
      activeFinalPassCacheKey = "";
      activeFinalPassMatchAliases = [];
    }
    if (finalPassRecords.length > 0 || !loadedFinalPassCache) return;
    if (!cacheMatchesCurrentMatch(loadedFinalPassCache, currentAliases, core, modules)) return;
    restoreFinalPassCache(loadedFinalPassCache, currentAliases);
  }

  function ensureFinalPassCacheForEvent(event) {
    const nextAliases = buildEventMatchCacheAliases(event, core, modules);
    const nextKey = nextAliases[0] ?? buildMatchCacheKey(event);
    if (!nextKey) return;
    if (!activeFinalPassCacheKey) {
      maybeRestoreFinalPassCacheForCurrentMatch();
    }
    if (activeFinalPassCacheKey && !hasAnyMatchAlias(activeFinalPassMatchAliases, nextAliases)) {
      finalPassRecords.splice(0, finalPassRecords.length);
      finalPassByPlayer.clear();
      finalPassSeenKeys.clear();
      nextCreationOrderCode = 1;
    }
    activeFinalPassCacheKey = nextKey;
    activeFinalPassMatchAliases = nextAliases;
  }

  function clearFinalPassState(currentAliases = []) {
    finalPassRecords.splice(0, finalPassRecords.length);
    finalPassByPlayer.clear();
    finalPassSeenKeys.clear();
    nextCreationOrderCode = 1;
    const normalizedAliases = normalizeMatchAliases(currentAliases);
    activeFinalPassMatchAliases = normalizedAliases;
    activeFinalPassCacheKey = normalizedAliases[0] ?? "";
  }

  function resolveClearMatchAliases(input = {}, core, modules = {}) {
    const event = input && typeof input === "object" ? input : {};
    const eventAliases = buildClearEventAliases(event);
    if (eventAliases.length > 0) {
      return normalizeMatchAliases([
        ...eventAliases,
        ...buildCurrentMatchCacheAliases(core, modules),
      ]);
    }
    return buildCurrentMatchCacheAliases(core, modules);
  }

  function restoreFinalPassCache(cache, currentAliases = []) {
    const records = Array.isArray(cache?.finalPassRecords) ? cache.finalPassRecords : [];
    finalPassRecords.splice(0, finalPassRecords.length, ...records.map(cloneJsonSafe));
    const normalized = normalizeCreationOrderCodes(finalPassRecords);
    finalPassByPlayer.clear();
    finalPassSeenKeys.clear();
    for (const record of finalPassRecords) {
      const playerKey = buildPlayerKey(record.event);
      if (playerKey) finalPassByPlayer.set(playerKey, record.id);
      const eventKey = buildFinalPassEventKey(record.event);
      if (eventKey) finalPassSeenKeys.add(eventKey);
    }
    const maxCode = finalPassRecords.reduce((max, record) => Math.max(max, Number(record.creationOrderCode ?? 0) || 0), 0);
    nextCreationOrderCode = Math.max(maxCode + 1, Number(cache?.nextCreationOrderCode ?? 1) || 1);
    activeFinalPassCacheKey = normalizeText(cache?.cacheKey);
    const previousAliases = normalizeMatchAliases(cache?.matchAliases, activeFinalPassCacheKey);
    activeFinalPassMatchAliases = normalizeMatchAliases([
      ...previousAliases,
      ...normalizeMatchAliases(currentAliases),
    ]);
    if (normalized || activeFinalPassMatchAliases.length !== previousAliases.length) {
      persistFinalPassCacheLater();
    }
  }

  function takeNextCreationOrderCode() {
    const maxCode = finalPassRecords.reduce((max, record) => Math.max(max, Number(record.creationOrderCode ?? 0) || 0), 0);
    nextCreationOrderCode = Math.max(nextCreationOrderCode, maxCode + 1);
    return nextCreationOrderCode++;
  }

  function persistFinalPassCacheLater() {
    const payload = {
      version: 1,
      cacheKey: activeFinalPassCacheKey,
      matchAliases: activeFinalPassMatchAliases.slice(),
      updatedAt: nowIso(),
      nextCreationOrderCode,
      finalPassRecords: finalPassRecords.map(cloneJsonSafe),
    };
    loadedFinalPassCache = payload;
    finalPassCacheWrite = (async () => {
      try {
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(finalPassCachePath(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      } catch (error) {
        moduleLogger?.warn?.(`[SquadRuleChain] failed to persist final pass cache: ${error?.message ?? error}`);
      }
    })();
  }

  async function removeLeader(event) {
    const apiRef = modules?.squadManagement;
    if (!event.leaderName && !event.leaderSteamId && !event.leaderEosId) {
      return { ok: false, skipped: true, skipReason: "target_missing" };
    }
    const request = {
      serverId: event.serverId,
      matchId: event.matchId,
      name: event.leaderName,
      steamId: event.leaderSteamId,
      eosId: event.leaderEosId,
      teamId: event.teamId,
      squadId: event.squadId,
      squadName: event.squadName,
      reason: buildRemoveReason(event),
      source: SQUAD_RULE_CHAIN_MODULE_ID,
      operatorName: SQUAD_RULE_CHAIN_MODULE_ID,
      system: true,
    };
    if (typeof apiRef?.requestRemoveFromSquad === "function") return await apiRef.requestRemoveFromSquad(request);
    if (typeof apiRef?.removeFromSquad === "function") return await apiRef.removeFromSquad(request);
    if (typeof apiRef?.executeAction === "function") return await apiRef.executeAction({ ...request, type: "remove_from_squad" });
    return { ok: false, error: "squad_management_unavailable" };
  }

  async function disbandSquad(event) {
    const apiRef = modules?.squadManagement;
    const request = {
      serverId: event.serverId,
      matchId: event.matchId,
      teamId: event.teamId,
      squadId: event.squadId,
      squadName: event.squadName,
      creatorName: event.leaderName,
      creatorSteamId: event.leaderSteamId,
      creatorEosId: event.leaderEosId,
      reason: event.disbandReason || buildDisbandReason(event),
      source: SQUAD_RULE_CHAIN_MODULE_ID,
      operatorName: SQUAD_RULE_CHAIN_MODULE_ID,
      system: true,
      allowUnverifiedTarget: true,
      allowRefresh: false,
      priority: "high",
      bypassRateLimit: true,
      rconChannel: "disband",
    };
    if (typeof apiRef?.requestDisband === "function") return await apiRef.requestDisband(request);
    if (typeof apiRef?.disband === "function") return await apiRef.disband(request);
    if (typeof apiRef?.executeAction === "function") return await apiRef.executeAction({ ...request, type: "disband_squad" });
    return { ok: false, error: "squad_management_unavailable" };
  }

  async function warnLeader(event, message) {
    const sender = modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer;
    if (typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    if (!event.leaderName) return { success: false, skipped: true, skipReason: "target_missing" };
    return await sender.call(modules.adminWarn, {
      targetName: event.leaderName,
      targetSteamId: event.leaderSteamId || undefined,
      targetEosId: event.leaderEosId || undefined,
      message,
      reason: buildWarnReason(event),
      sourceModule: SQUAD_RULE_CHAIN_MODULE_ID,
      relatedEventId: event.sourceEventId,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
  }

  async function broadcastViolation(event) {
    const sender = modules?.adminWarn?.broadcastMessage ?? modules?.adminWarn?.sendAdminBroadcast;
    if (typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    return await sender.call(modules.adminWarn, {
      message: event.broadcastMessage,
      reason: `${event.source}_broadcast`,
      sourceModule: SQUAD_RULE_CHAIN_MODULE_ID,
      relatedEventId: event.sourceEventId,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
  }

  async function broadcastFinalPass(record) {
    const sender = modules?.adminWarn?.broadcastMessage ?? modules?.adminWarn?.sendAdminBroadcast;
    if (typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    return await sender.call(modules.adminWarn, {
      message: buildFinalPassBroadcastMessageV2(record),
      reason: "squad_rule_chain_final_pass_broadcast",
      sourceModule: SQUAD_RULE_CHAIN_MODULE_ID,
      relatedEventId: record.event.sourceEventId,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
  }
}

function buildFinalPassBroadcastMessageV2(record) {
  const event = record?.event ?? {};
  const creator = event.leaderName || "未知玩家";
  const squadName = event.squadName || `Squad ${event.squadId ?? "?"}`;
  const squadNatureLabel = resolveSquadNatureLabel(event);
  return `${creator} 建立了${squadName}，队伍性质：${squadNatureLabel}，建队顺序码 ${record.creationOrderCode}`;
}

function buildFinalPassWarningMessages(event = {}) {
  const nature = resolveSquadNature(event);
  if (nature === SQUAD_NATURE.VEHICLE) {
    return ["本服绝大部分载具严禁单载，包括 ZCC ，请遵守服规。"];
  }
  if (nature === SQUAD_NATURE.SUPPORT) {
    return ["攻守模式禁止迫击炮单独建队。"];
  }
  return [];
}

function resolveSquadNature(event = {}) {
  const explicitNature = normalizeText(event.squadType);
  if (explicitNature && Object.values(SQUAD_NATURE).includes(explicitNature)) {
    return explicitNature;
  }
  return classifySquadName(event.squadName, { includeDebug: false })?.nature || SQUAD_NATURE.OTHER;
}

function resolveSquadNatureLabel(event = {}) {
  const nature = resolveSquadNature(event);
  return SQUAD_NATURE_LABEL[nature] || SQUAD_NATURE_LABEL[SQUAD_NATURE.OTHER];
}
function buildFinalPassBroadcastMessage(record) {
  return buildFinalPassBroadcastMessageV2(record);
}
function buildPlayerKey(event = {}) {
  if (event.leaderSteamId) return `steam:${event.leaderSteamId}`;
  if (event.leaderEosId) return `eos:${event.leaderEosId}`;
  if (event.leaderName) return `name:${event.leaderName.toLowerCase()}`;
  return "";
}

function buildMatchCacheKey(event = {}) {
  const serverId = normalizeText(event.serverId);
  if (!serverId) return "";
  const matchId = normalizeText(event.matchId);
  if (matchId) return `${serverId}|match:${matchId}`;
  const anchor = normalizeText(event.clockAnchorLogTime ?? event.roundAnchor);
  if (anchor) return `${serverId}|anchor:${anchor}`;
  return "";
}

function buildCurrentMatchCacheKey(core, modules = {}) {
  return buildCurrentMatchCacheAliases(core, modules)[0] ?? "";
}

function buildEventMatchCacheAliases(event = {}, core, modules = {}) {
  const aliases = [];
  pushMatchAlias(aliases, buildMatchCacheKey(event));
  const serverId = normalizeText(event.serverId);
  for (const alias of buildCurrentMatchCacheAliases(core, modules, serverId)) {
    pushMatchAlias(aliases, alias);
  }
  return aliases;
}

function buildClearEventAliases(event = {}) {
  const serverId = normalizeText(event.serverId);
  if (!serverId) return [];
  const round = event?.normalized?.roundWorldBringUp && typeof event.normalized.roundWorldBringUp === "object"
    ? event.normalized.roundWorldBringUp
    : {};
  const matchKey = buildMatchCacheKey({
    serverId,
    matchId: normalizeText(event.matchId || event.currentMatchId || round.matchId),
    clockAnchorLogTime: normalizeText(round.logLineTime || event.logLineTime || event.clockAnchorLogTime || event.anchorLogTime),
  });
  return matchKey ? [matchKey] : [];
}

function buildCurrentMatchCacheAliases(core, modules = {}, serverIdOverride = "") {
  const snapshot = core?.webStatus?.getSnapshot?.() ?? {};
  const serverId = normalizeText(serverIdOverride || snapshot.serverId || core?.webStatus?.serverId);
  const lifecycle = modules?.squadLifecycle?.getCurrent?.(serverId) ?? null;
  const aliases = [];
  pushMatchAlias(aliases, buildMatchCacheKey({
    serverId,
    matchId: snapshot.matchId ?? snapshot.currentMatchId ?? lifecycle?.matchId,
    clockAnchorLogTime: snapshot.logClockAnchorLogTime ?? snapshot.logClockLastResetAt,
  }));

  const status = modules?.matchCache?.getStatus?.(serverId) ?? null;
  appendMatchIdentityAliases(aliases, serverId, status?.currentMatch);
  appendMatchIdentityAliases(aliases, serverId, status?.cachedMatch);
  return aliases;
}

function appendMatchIdentityAliases(aliases, serverId, match = null) {
  const normalizedServerId = normalizeText(serverId);
  if (!normalizedServerId || !match || typeof match !== "object") return;
  pushMatchAlias(aliases, match.sessionId ? `${normalizedServerId}|session:${normalizeText(match.sessionId)}` : "");
  pushMatchAlias(aliases, match.fingerprint ? `${normalizedServerId}|fingerprint:${normalizeText(match.fingerprint)}` : "");
  pushMatchAlias(aliases, match.fullKey ? `${normalizedServerId}|full:${normalizeText(match.fullKey)}` : "");
  pushMatchAlias(aliases, match.baseKey ? `${normalizedServerId}|base:${normalizeText(match.baseKey)}` : "");
  pushMatchAlias(aliases, match.roundAnchor?.logLineTime ? `${normalizedServerId}|anchor:${normalizeText(match.roundAnchor.logLineTime)}` : "");
}

function pushMatchAlias(aliases, alias) {
  const text = normalizeText(alias);
  if (text && !aliases.includes(text)) aliases.push(text);
}

function normalizeMatchAliases(value, fallbackKey = "") {
  const aliases = [];
  if (Array.isArray(value)) {
    for (const item of value) pushMatchAlias(aliases, item);
  }
  pushMatchAlias(aliases, fallbackKey);
  return aliases;
}

function hasAnyMatchAlias(left = [], right = []) {
  const leftSet = new Set(normalizeMatchAliases(left));
  return normalizeMatchAliases(right).some((alias) => leftSet.has(alias));
}

function cacheMatchesCurrentMatch(cache, currentAliases, core, modules = {}) {
  const cacheAliases = normalizeMatchAliases(cache?.matchAliases, cache?.cacheKey);
  if (currentAliases.length > 0 && hasAnyMatchAlias(cacheAliases, currentAliases)) return true;
  return legacyCacheProbablyMatchesCurrentMatch(cache, core, modules);
}

function legacyCacheProbablyMatchesCurrentMatch(cache, core, modules = {}) {
  const cacheKey = normalizeText(cache?.cacheKey);
  const [cacheServerId = ""] = cacheKey.split("|");
  const snapshot = core?.webStatus?.getSnapshot?.() ?? {};
  const serverId = normalizeText(snapshot.serverId || core?.webStatus?.serverId);
  if (!cacheServerId || !serverId || cacheServerId !== serverId) return false;

  const matchIdTimes = parseBzssMatchIdTimes(cacheKey);
  if (matchIdTimes.length === 0) return false;

  const status = modules?.matchCache?.getStatus?.(serverId) ?? null;
  const candidates = [
    extractTimestampFromSessionId(status?.currentMatch?.sessionId),
    extractTimestampFromSessionId(status?.cachedMatch?.sessionId),
  ].filter(Number.isFinite);

  return candidates.some((time) => matchIdTimes.some((matchIdTime) => Math.abs(time - matchIdTime) <= 10 * 60 * 1000));
}

function parseBzssMatchIdTimes(value) {
  const match = normalizeText(value).match(/(\d{8})_(\d{6})/);
  if (!match) return [];
  const [, date, time] = match;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const second = Number(time.slice(4, 6));
  const localTime = new Date(year, month - 1, day, hour, minute, second).getTime();
  const utcTime = Date.UTC(year, month - 1, day, hour, minute, second);
  return [localTime, utcTime].filter(Number.isFinite);
}

function extractTimestampFromSessionId(value) {
  const match = normalizeText(value).match(/:(\d{11,})$/);
  if (!match) return Number.NaN;
  const time = Number(match[1]);
  return Number.isFinite(time) ? time : Number.NaN;
}

function buildFinalPassEventKey(event = {}) {
  return [
    String(event.serverId ?? "").trim(),
    String(event.matchId ?? "").trim(),
    event.teamId == null ? "" : String(event.teamId),
    event.squadId == null ? "" : String(event.squadId),
    String(event.squadName ?? "").trim().replace(/\s+/g, " ").toLowerCase(),
    String(event.createdAtMs ?? ""),
  ].join("|");
}

function normalizeCreationOrderCodes(records = []) {
  if (!Array.isArray(records) || records.length === 0) return false;
  const ordered = records
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      const timeDelta = recordSortTime(left.record) - recordSortTime(right.record);
      if (timeDelta !== 0) return timeDelta;
      return left.index - right.index;
    });
  let changed = false;
  for (let index = 0; index < ordered.length; index += 1) {
    const nextCode = index + 1;
    if (Number(ordered[index].record.creationOrderCode ?? 0) !== nextCode) {
      ordered[index].record.creationOrderCode = nextCode;
      ordered[index].record.updatedAt = ordered[index].record.updatedAt || nowIso();
      changed = true;
    }
  }
  return changed;
}

function recordSortTime(record = {}) {
  const candidates = [
    record.event?.createdAtMs,
    Date.parse(record.event?.createdAt ?? ""),
    Date.parse(record.createdAt ?? ""),
    Date.parse(record.updatedAt ?? ""),
  ];
  for (const value of candidates) {
    const time = Number(value);
    if (Number.isFinite(time) && time > 0) return time;
  }
  return Number.MAX_SAFE_INTEGER;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function cloneJsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildWarningMessages(event) {
  if (Array.isArray(event.warningMessages) && event.warningMessages.length > 0) {
    return event.warningMessages.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (event.reason) return [event.reason];
  return ["违规建队，已按规则处理。"];
}

function buildWarnReason(event) {
  if (event.source === SQUAD_RULE_SOURCES.squadNameRule) return "squad_name_policy_violation";
  if (event.source === SQUAD_RULE_SOURCES.tieredSquadTime) return "stepwise_squad_playtime_violation";
  if (event.source === SQUAD_RULE_SOURCES.fairSquadCreation) return "fair_squad_guard_violation";
  return "squad_rule_violation";
}

function buildRemoveReason(event) {
  if (event.source === SQUAD_RULE_SOURCES.squadNameRule) return `squad_name_policy_pre_disband_remove: ${event.reason}`.trim();
  if (event.source === SQUAD_RULE_SOURCES.fairSquadCreation) return `公平建队守护：解散前移出队长 ${event.reason}`.trim();
  return `squad_rule_pre_disband_remove: ${event.reason}`.trim();
}

function buildDisbandReason(event) {
  if (event.source === SQUAD_RULE_SOURCES.squadNameRule) return `squad_name_policy_violation: ${event.reason}`.trim();
  if (event.source === SQUAD_RULE_SOURCES.tieredSquadTime) return `阶梯时长守护：${event.reason}`.trim();
  if (event.source === SQUAD_RULE_SOURCES.fairSquadCreation) return `公平建队守护：${event.reason}`.trim();
  return `squad_rule_violation: ${event.reason}`.trim();
}

function summarizeActionResult(result) {
  if (!result || typeof result !== "object") return result ?? null;
  return {
    ok: result.ok ?? result.success ?? null,
    success: result.success ?? result.ok ?? null,
    skipped: result.skipped ?? false,
    error: result.error ?? result.errorMessage ?? result.skipReason ?? "",
    message: result.message ?? "",
    command: result.command ?? result.commandText ?? "",
  };
}

function remember(bucket, record, limit) {
  bucket.push(JSON.parse(JSON.stringify(record)));
  if (bucket.length > limit) {
    bucket.splice(0, bucket.length - limit);
  }
}

  function recentLimit() {
    return DEFAULT_RECENT_LIMIT;
  }

  function isLiveActionEvent(event = {}) {
    const sourceMode = normalizeText(event.sourceMode ?? event.SourceMode ?? event.rawEvent?.SourceMode).toLowerCase();
    const canTriggerActions = normalizeBoolean(event.canTriggerActions ?? event.CanTriggerActions ?? event.rawEvent?.CanTriggerActions, true);
    if (sourceMode && sourceMode !== "live") return false;
    return canTriggerActions !== false;
  }

function nowIso() {
  return new Date().toISOString();
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = normalizeText(value).toLowerCase();
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  return fallback;
}
