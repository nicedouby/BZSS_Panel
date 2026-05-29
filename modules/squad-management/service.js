// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";
import { classifySquadName } from "../../domain/squad/squad_name_classifier.js";
import { createSquadLifecycleReducer } from "../squad-lifecycle/reducer.js";
import { buildSquadLifecycleKey, buildSquadLifecycleSlotKey } from "../squad-lifecycle/service.js";
import { normalizeSquadName } from "../squad-lifecycle/log-adapter.js";
import { canDisband, canKick, canRemove } from "./permissions.js";

const MODULE_ID = "module.squadManagement";
const API_NAME = "squadManagement";

const SQUAD_ACTION_TYPES = {
  DISBAND_SQUAD: "disband_squad",
  KICK_PLAYER: "kick_player",
  REMOVE_FROM_SQUAD: "remove_from_squad",
};

const ACTION_TYPE_TO_KIND = {
  [SQUAD_ACTION_TYPES.DISBAND_SQUAD]: "disband",
  [SQUAD_ACTION_TYPES.KICK_PLAYER]: "kick",
  [SQUAD_ACTION_TYPES.REMOVE_FROM_SQUAD]: "remove",
};

const ACTION_KIND_TO_TYPE = {
  disband: SQUAD_ACTION_TYPES.DISBAND_SQUAD,
  kick: SQUAD_ACTION_TYPES.KICK_PLAYER,
  remove: SQUAD_ACTION_TYPES.REMOVE_FROM_SQUAD,
};

const DEFAULT_DISBAND_PERMISSION = "squad.disband";
const DEFAULT_KICK_PERMISSION = "squad.kick";
const DEFAULT_REMOVE_PERMISSION = "squad.remove";
const DEFAULT_KICK_THRESHOLD = 10;
const DEFAULT_MATCH_ID_PREFIX = "match";
const MAX_RECENT_ACTIONS = 100;

export function createSquadManagementService({ core, modules, config, logger, repository }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config.get("modules.squadManagement", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const enforcementEnabled = Boolean(moduleConfig.enforcementEnabled ?? false);
  const disbandPermission = String(moduleConfig.disbandPermission ?? DEFAULT_DISBAND_PERMISSION).trim() || DEFAULT_DISBAND_PERMISSION;
  const kickPermission = String(moduleConfig.kickPermission ?? DEFAULT_KICK_PERMISSION).trim() || DEFAULT_KICK_PERMISSION;
  const removePermission = String(moduleConfig.removePermission ?? DEFAULT_REMOVE_PERMISSION).trim() || DEFAULT_REMOVE_PERMISSION;
  const kickThreshold = normalizePositiveInteger(moduleConfig.kickThreshold, DEFAULT_KICK_THRESHOLD);
  const allowedInfantryNames = Array.isArray(moduleConfig.allowedInfantryNames) ? moduleConfig.allowedInfantryNames : [];
  const defaultSquadNamePattern = String(moduleConfig.defaultSquadNamePattern ?? "^Squad\\s*\\d+$").trim() || "^Squad\\s*\\d+$";

  const lifecycle = createSquadLifecycleReducer({ config, logger: moduleLogger });
  const serverCache = new Map();
  const recentActions = [];
  const creatorsByServer = new Map();
  const pendingCreationsByServer = new Map();
  const unsubscribers = [];
  let initialized = false;

  const repositoryApi = repository ?? null;

  const api = {
    getState(serverId = getDefaultServerId()) {
      return buildStateSnapshot(serverId);
    },

    getCurrent(serverId = getDefaultServerId()) {
      return buildStateSnapshot(serverId);
    },

    getStatus(serverId = getDefaultServerId()) {
      const state = buildStateSnapshot(serverId);
      return {
        enabled,
        enforcementEnabled: Boolean(state.enforcementEnabled),
        disbandPermission: state.disbandPermission,
        kickPermission: state.kickPermission,
        removePermission: state.removePermission,
        kickThreshold: state.kickThreshold,
        noBuildUntilSeconds: state.noBuildUntilSeconds,
        infantryOnlyUntilSeconds: state.infantryOnlyUntilSeconds,
        allowedInfantryNames: state.allowedInfantryNames,
        defaultSquadNamePattern: state.defaultSquadNamePattern,
        window: state.window,
        currentSquads: state.squads.length,
        currentPlayers: state.players.length,
        creators: state.creators.length,
      };
    },

    async getRecords(query = {}) {
      return listRecords(query);
    },

    getSquads(serverId = getDefaultServerId()) {
      return buildStateSnapshot(serverId).squads;
    },

    getSquad(serverId, teamId, squadId) {
      return buildStateSnapshot(serverId).squads.find((squad) => sameSquadKey(squad, teamId, squadId)) ?? null;
    },

    getTeams(serverId = getDefaultServerId()) {
      return buildStateSnapshot(serverId).teams;
    },

    getPlayers(serverId = getDefaultServerId(), playerKey = null) {
      const players = buildStateSnapshot(serverId).players;
      if (!playerKey) return players;
      return players.find((player) => samePlayerKey(player, playerKey)) ?? null;
    },

    getPlayer(serverId, playerKey) {
      return api.getPlayers(serverId, playerKey);
    },

    getCreators(serverId = getDefaultServerId()) {
      return buildStateSnapshot(serverId).creators;
    },

    getLifecycleSnapshot(serverId = getDefaultServerId()) {
      return lifecycle.getCurrentSnapshot(serverId);
    },

    getLifecycleRecords(serverId = getDefaultServerId()) {
      return lifecycle.getCurrentSnapshot(serverId).list;
    },

    getCreationRecords(serverId = getDefaultServerId()) {
      return lifecycle.getCurrentSnapshot(serverId).list;
    },

    async executeAction(request = {}) {
      const type = normalizeActionType(request.type ?? request.action ?? request.kind);
      if (!type) {
        return buildInvalidActionResult(
          "action",
          "InvalidActionType",
          "type is required.",
          {
            serverId: normalizeServerId(request.serverId),
          },
        );
      }

      const serverId = normalizeServerId(request.serverId);
      const normalizedRequest = {
        ...request,
        type,
        action: ACTION_TYPE_TO_KIND[type],
        serverId,
        reason: normalizeText(request.reason),
        source: normalizeText(request.source) || "manual",
        system: Boolean(request.system),
        actor: request.actor ?? request.viewer ?? null,
      };

      let result;
      switch (type) {
        case SQUAD_ACTION_TYPES.DISBAND_SQUAD:
          result = await executeDisband(normalizedRequest);
          break;
        case SQUAD_ACTION_TYPES.KICK_PLAYER:
          result = await executeKick(normalizedRequest);
          break;
        case SQUAD_ACTION_TYPES.REMOVE_FROM_SQUAD:
          result = await executeRemoveFromSquad(normalizedRequest);
          break;
        default:
          result = buildInvalidActionResult("action", "UnsupportedActionType", `Unsupported action type: ${type}`, {
            serverId,
          });
          break;
      }

      const finalResult = {
        type,
        action: ACTION_TYPE_TO_KIND[type] ?? result.action ?? "action",
        serverId,
        source: normalizedRequest.source,
        system: Boolean(normalizedRequest.system),
        reason: normalizedRequest.reason ?? "",
        target: extractActionTarget(result.record) ?? null,
        time: result.record?.time ?? "",
        command: result.command ?? "",
        rconExecuted: Boolean(result.rconExecuted),
        rconResponse: result.rconResponse ?? "",
        error: result.error ?? "",
        message: result.message ?? "",
        record: result.record ?? null,
        state: result.state ?? buildStateSnapshot(serverId),
        ok: Boolean(result.ok),
      };

      core.eventBus?.emitModuleEvent?.(MODULE_ID, "actionExecuted", {
        type,
        ok: finalResult.ok,
        serverId,
        target: extractActionTarget(finalResult.record) ?? null,
        result: finalResult,
      });

      if (!finalResult.ok) {
        core.eventBus?.emitModuleEvent?.(MODULE_ID, "actionFailed", {
          type,
          serverId,
          error: finalResult.error ?? finalResult.message ?? "Action failed.",
          reason: normalizedRequest.reason ?? "",
          target: extractActionTarget(finalResult.record) ?? null,
        });
      }

      return finalResult;
    },

    async requestDisband(request = {}) {
      return api.executeAction({
        ...request,
        type: SQUAD_ACTION_TYPES.DISBAND_SQUAD,
      });
    },

    async requestKick(request = {}) {
      return api.executeAction({
        ...request,
        type: SQUAD_ACTION_TYPES.KICK_PLAYER,
      });
    },

    async requestRemoveFromSquad(request = {}) {
      return api.executeAction({
        ...request,
        type: SQUAD_ACTION_TYPES.REMOVE_FROM_SQUAD,
      });
    },

    async recordAction(entry = {}) {
      return persistActionRecord(entry);
    },

    async disband(request = {}) {
      return api.requestDisband(request);
    },

    async kick(request = {}) {
      return api.requestKick(request);
    },

    async removeFromSquad(request = {}) {
      return api.requestRemoveFromSquad(request);
    },

    async refresh(serverId = getDefaultServerId()) {
      return buildStateSnapshot(serverId);
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Management Module",
      kind: "module",
      version: "0.3.0",
      description: "Unified squad state, lifecycle, records, and action gateway.",
    },
    apiName: API_NAME,
    api,

    async init() {
      if (initialized) return;
      try {
        if (repositoryApi?.init) {
          await repositoryApi.init();
        }
        await hydrateFromRepository();
        await hydrateFromLifecycleModule();
        await hydrateFromPlayerState();
      } catch (error) {
        moduleLogger.warn(`[SquadManagement] init hydration failed: ${error?.message ?? error}`);
      }
      initialized = true;
    },

    async start() {
      if (!initialized) {
        try {
          if (repositoryApi?.init) {
            await repositoryApi.init();
          }
          await hydrateFromRepository();
          await hydrateFromLifecycleModule();
          await hydrateFromPlayerState();
        } catch (error) {
          moduleLogger.warn(`[SquadManagement] start hydration failed: ${error?.message ?? error}`);
        }
        initialized = true;
      }

      for (const [serverId, creators] of creatorsByServer.entries()) {
        for (const creator of creators.values()) {
          await checkKickPolicy(serverId, creator);
        }
      }

      if (!enabled) {
        moduleLogger.info("SquadManagement module disabled by config.", { operation: "start" });
        return;
      }

      if (!core.eventBus?.onCoreEvent) {
        moduleLogger.warn("SquadManagement module started without event bus support.", { operation: "start" });
        return;
      }

      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_SQUADS_UPDATED", (event) => {
        void handleRconSquadsUpdated(event);
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", (event) => {
        void handleRconPlayersUpdated(event);
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("On_SquadCreated", (event) => {
        void handleSquadCreated(event);
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("MATCH_STATE_UPDATED", (event) => {
        void handleMatchStateUpdated(event);
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("MAP_CHANGED", (event) => {
        void handleMapChanged(event);
      }));

      if (typeof core.eventBus.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "squadsUpdated", (event) => {
          void handleModuleSquadsUpdated(event);
        }));
        unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "playersUpdated", (event) => {
          void handleModulePlayersUpdated(event);
        }));
        unsubscribers.push(core.eventBus.onModuleEvent("module.squadLifecycle", "squadCreated", (event) => {
          void handleSquadCreated(event);
        }));
      }

      moduleLogger.info("SquadManagement module started.", {
        operation: "start",
        data: {
          disbandPermission,
          kickPermission,
          kickThreshold,
          enforcementEnabled,
        },
      });
    },

    async stop() {
      for (const unsubscriber of unsubscribers.splice(0)) {
        try {
          unsubscriber();
        } catch {}
      }

      if (repositoryApi?.close) {
        await repositoryApi.close();
      }
    },
  };

  async function hydrateFromPlayerState() {
    const serverId = getDefaultServerId();
    if (!serverId || !modules?.playerState) return;

    const state = modules.playerState.getState?.(serverId) ?? modules.playerState.getState?.() ?? null;
    const players = Array.isArray(state?.players) ? state.players : [];
    if (players.length === 0) return;

    const cache = ensureServerCache(serverId);
    cache.playersRaw = players;
    touchCache(cache);
  }

  async function hydrateFromRepository() {
    if (!repositoryApi?.listRecords) return;
    const records = await repositoryApi.listRecords({
      kind: "all",
      limit: 5000,
      offset: 0,
    });

    for (const record of records) {
      const serverId = normalizeServerId(record.serverId);
      if (!serverId) continue;
      const cache = ensureServerCache(serverId);
      applyRecordToCache(cache, record);

      if (record.kind === "squad_created") {
        const lifecycleRecord = lifecycle.handleSquadCreateLogEvent({
          serverId: record.serverId,
          matchId: record.matchId,
          teamId: record.teamId,
          squadId: record.squadId,
          squadName: record.squadName,
          factionName: record.teamName,
          creatorName: record.creatorName,
          creatorSteamId: record.creatorSteamId ?? record.steamId,
          creatorEosId: record.creatorEosId ?? record.eosId,
          eventTime: record.time,
          createdAtMs: record.timeMs,
          sourceEventId: record.recordKey,
          rawLog: "",
        });
        if (lifecycleRecord) {
          cache.lifecycleLoaded = true;
          touchCache(cache);
        }
        updateCreatorStats(serverId, buildCreatorRecordFromLifecycle(record));
      } else if (record.kind === "disband" || record.kind === "kick") {
        pushRecentAction(serverId, {
          time: record.time,
          action: record.kind,
          source: record.source,
          ok: record.result === "success",
          error: record.error,
          message: record.reason,
          reason: record.reason,
          command: record.command,
          system: record.system,
          target: {
            teamId: record.teamId,
            squadId: record.squadId,
            playerKey: record.playerKey,
            playerName: record.playerName,
            creatorName: record.creatorName,
          },
        });
      }
    }
  }

  async function hydrateFromLifecycleModule() {
    const serverId = getDefaultServerId();
    if (!serverId || !modules?.squadLifecycle) return;

    const snapshot =
      modules.squadLifecycle.getCurrentSnapshot?.(serverId)
      ?? modules.squadLifecycle.getCurrent?.(serverId)
      ?? modules.squadLifecycle.getCurrent?.()
      ?? null;

    const records = Array.isArray(snapshot?.list)
      ? snapshot.list
      : Array.isArray(snapshot?.records)
        ? snapshot.records
        : [];
    if (records.length === 0) return;

    const cache = ensureServerCache(serverId);
    cache.matchId = normalizeMatchId(snapshot?.matchId ?? cache.matchId ?? "");
    lifecycle.setCurrentMatchId(serverId, cache.matchId);

    for (const record of records) {
      if (record?.teamId == null || record?.squadId == null) continue;
      const lifecycleRecord = lifecycle.handleSquadCreateLogEvent({
        serverId,
        matchId: cache.matchId || normalizeMatchId(record.matchId ?? ""),
        teamId: record.teamId,
        squadId: record.squadId,
        squadName: record.squadName,
        factionName: record.factionName,
        creatorName: record.creatorName,
        creatorSteamId: record.creatorSteamId,
        creatorEosId: record.creatorEosId,
        createdAtMs: record.createdAtMs,
        eventTime: record.createdAt ?? record.createdAtMs ?? new Date().toISOString(),
        sourceEventId: record.key ?? record.slotKey ?? "",
        rawLog: record.rawLog ?? "",
      });
      if (lifecycleRecord) {
        updateCreatorStats(serverId, lifecycleRecord);
      }
    }
  }

  async function handleRconSquadsUpdated(event = {}) {
    const serverId = normalizeServerId(event.serverId);
    if (!serverId) return;
    const matchId = normalizeMatchId(event.matchId ?? event.sessionId ?? event.sessionID ?? getCurrentMatchId(serverId));
    const squads = normalizeRconSquads(event.squads ?? []);
    const cache = ensureServerCache(serverId);
    const resolvedMatchId = matchId || cache.matchId || normalizeMatchId(buildSyntheticMatchId(serverId, event));

    cache.matchId = resolvedMatchId;
    cache.rconUpdatedAt = event.time ?? new Date().toISOString();
    cache.squadsUpdatedAt = cache.rconUpdatedAt;
    cache.rawSquads = squads;
    cache.lastEventAt = cache.rconUpdatedAt;

    lifecycle.setCurrentMatchId(serverId, resolvedMatchId);
    lifecycle.handleRconSquadSnapshot({
      serverId,
      matchId: resolvedMatchId,
      observedAt: cache.rconUpdatedAt,
      squads,
    });

    touchCache(cache);
    await flushPendingSquadCreations(serverId);
    core.eventBus?.emitModuleEvent?.(MODULE_ID, "squadsUpdated", {
      serverId,
      matchId: cache.matchId,
      squads: buildStateSnapshot(serverId).squads,
    });
  }

  async function handleRconPlayersUpdated(event = {}) {
    const serverId = normalizeServerId(event.serverId);
    if (!serverId) return;
    const players = normalizeRconPlayers(event.players ?? []);
    const cache = ensureServerCache(serverId);
    cache.playersRaw = players;
    cache.playersUpdatedAt = event.time ?? new Date().toISOString();
    cache.lastEventAt = cache.playersUpdatedAt;
    if (!cache.matchId) {
      cache.matchId = normalizeMatchId(getCurrentMatchId(serverId) || buildSyntheticMatchId(serverId, event));
    }
    touchCache(cache);

    core.eventBus?.emitModuleEvent?.(MODULE_ID, "playersUpdated", {
      serverId,
      matchId: cache.matchId,
      players: buildStateSnapshot(serverId).players,
    });
  }

  async function handleModuleSquadsUpdated(event = {}) {
    if (!event?.serverId) return;
    await handleRconSquadsUpdated({
      serverId: event.serverId,
      matchId: event.matchId,
      squads: event.squads,
      time: event.time,
    });
  }

  async function handleModulePlayersUpdated(event = {}) {
    if (!event?.serverId) return;
    await handleRconPlayersUpdated({
      serverId: event.serverId,
      players: event.players,
      time: event.time,
    });
  }

  async function handleSquadCreated(event = {}) {
    const parsed = normalizeSquadCreatedEvent(event);
    if (!parsed.serverId || parsed.squadId == null) return;

    const resolvedTeamId = resolveTeamIdForCreatedSquad(parsed.serverId, parsed);
    if (resolvedTeamId == null) {
      queuePendingSquadCreation(parsed.serverId, parsed);
      return;
    }
    parsed.teamId = resolvedTeamId;

    const cache = ensureServerCache(parsed.serverId);
    const resolvedMatchId = parsed.matchId || cache.matchId || getCurrentMatchId(parsed.serverId) || buildSyntheticMatchId(parsed.serverId, event);
    cache.matchId = resolvedMatchId;
    cache.lastEventAt = parsed.createdAt ?? new Date().toISOString();

    lifecycle.setCurrentMatchId(parsed.serverId, resolvedMatchId);
    const lifecycleRecord = lifecycle.handleSquadCreateLogEvent({
      serverId: parsed.serverId,
      matchId: resolvedMatchId,
      teamId: parsed.teamId,
      squadId: parsed.squadId,
      squadName: parsed.squadName,
      factionName: parsed.teamName,
      creatorName: parsed.creatorName,
      creatorSteamId: parsed.creatorSteamId,
      creatorEosId: parsed.creatorEosId,
      eventTime: parsed.createdAt ?? parsed.time,
      createdAtMs: parsed.createdAtMs,
      sourceEventId: parsed.sourceEventId,
      rawLog: parsed.rawLog,
    });

    if (lifecycleRecord) {
      updateCreatorStats(parsed.serverId, lifecycleRecord);
      await checkSquadPolicy(parsed.serverId, lifecycleRecord);

      const creatorKey = buildCreatorKey(lifecycleRecord);
      const creators = creatorsByServer.get(parsed.serverId);
      const creator = creators?.get(creatorKey);
      if (creator) {
        await checkKickPolicy(parsed.serverId, creator);
      }

      const record = await repositoryApi?.insertRecord?.({
        kind: "squad_created",
        serverId: parsed.serverId,
        matchId: resolvedMatchId,
        source: parsed.source,
        system: false,
        teamId: parsed.teamId,
        squadId: parsed.squadId,
        generation: lifecycleRecord.generation,
        squadName: parsed.squadName,
        teamName: parsed.teamName,
        creatorName: parsed.creatorName,
        steamId: parsed.creatorSteamId,
        eosId: parsed.creatorEosId,
        reason: parsed.creationConfidence || parsed.creationSource || "",
        result: "created",
        payload: {
          event: parsed,
          lifecycle: lifecycleRecord,
        },
        creationSignature: lifecycleRecord.creationSignature ?? lifecycleRecord.key ?? "",
        time: lifecycleRecord.createdAt ?? parsed.createdAt ?? new Date().toISOString(),
        timeMs: lifecycleRecord.createdAtMs ?? parsed.createdAtMs ?? Date.now(),
        logTime: parsed.time ?? "",
        logSeconds: extractSeconds(parsed.time),
      });

      pushRecentAction(parsed.serverId, {
        time: record?.time ?? parsed.createdAt ?? new Date().toISOString(),
        action: "squad_created",
        source: parsed.source,
        ok: true,
        reason: parsed.creationSource ?? "LOG",
        message: parsed.creationConfidence ?? "HIGH",
        system: false,
        target: {
          teamId: parsed.teamId,
          squadId: parsed.squadId,
          squadName: parsed.squadName,
          creatorName: parsed.creatorName,
        },
      });
    }

    core.eventBus?.emitModuleEvent?.(MODULE_ID, "squadCreated", {
      serverId: parsed.serverId,
      matchId: resolvedMatchId,
      teamId: parsed.teamId,
      squadId: parsed.squadId,
      squadName: parsed.squadName,
      creatorName: parsed.creatorName,
    });
  }

  async function handleMatchStateUpdated(event = {}) {
    const serverId = normalizeServerId(event.serverId);
    if (!serverId) return;
    const cache = ensureServerCache(serverId);
    cache.matchId = normalizeMatchId(event.matchId ?? cache.matchId ?? getCurrentMatchId(serverId) ?? "");
    cache.match = {
      mapName: normalizeText(event.mapName ?? event.map ?? cache.match?.mapName ?? ""),
      layerName: normalizeText(event.layerName ?? event.layer ?? cache.match?.layerName ?? ""),
      gameMode: normalizeText(event.gameMode ?? cache.match?.gameMode ?? ""),
      logClockSeconds: normalizePositiveInteger(event.logClockSeconds ?? cache.match?.logClockSeconds ?? 0, 0),
      isWarmup: Boolean(event.isWarmup ?? cache.match?.isWarmup ?? false),
    };
    touchCache(cache);
  }

  async function handleMapChanged(event = {}) {
    const serverId = normalizeServerId(event.serverId);
    if (!serverId) return;
    const cache = ensureServerCache(serverId);
    cache.match = {
      mapName: normalizeText(event.mapName ?? event.level ?? cache.match?.mapName ?? ""),
      layerName: normalizeText(event.layerName ?? event.layer ?? cache.match?.layerName ?? ""),
      gameMode: normalizeText(event.gameMode ?? cache.match?.gameMode ?? ""),
      logClockSeconds: cache.match?.logClockSeconds ?? 0,
      isWarmup: Boolean(cache.match?.isWarmup ?? false),
    };
    touchCache(cache);
  }

  async function executeDisband(request = {}) {
    const serverId = normalizeServerId(request.serverId);
    const teamId = normalizeNullableNumber(request.teamId ?? request.teamID);
    const squadId = normalizeNullableNumber(request.squadId ?? request.squadID);
    const reason = normalizeText(request.reason);
    const source = normalizeText(request.source) || "manual";
    const operatorName = normalizeText(request.operatorName ?? request.actor?.username ?? request.actor?.name);
    const system = Boolean(request.system);
    const actor = request.actor ?? request.viewer ?? null;

    if (!serverId) {
      return buildInvalidActionResult("disband", "InvalidServerId", "serverId is required.", { serverId, teamId, squadId, reason, source, system });
    }
    if (teamId == null || squadId == null) {
      return recordFailedAction({
        kind: "disband",
        serverId,
        matchId: getCurrentMatchId(serverId),
        source,
        operatorName,
        system,
        teamId,
        squadId,
        reason,
        error: "InvalidTarget",
        message: "teamId and squadId are required.",
      });
    }

    let state = buildStateSnapshot(serverId);
    let target = state.squads.find((squad) => sameSquadKey(squad, teamId, squadId)) ?? null;
    if (!target && request.allowRefresh !== false) {
      await refreshSquadsSnapshot(serverId);
      state = buildStateSnapshot(serverId);
      target = state.squads.find((squad) => sameSquadKey(squad, teamId, squadId)) ?? null;
    }
    if (!target) {
      return recordFailedAction({
        kind: "disband",
        serverId,
        matchId: state.matchId,
        source,
        operatorName,
        system,
        teamId,
        squadId,
        reason,
        error: "TargetNotFound",
        message: "Target squad is not present in the current snapshot.",
      });
    }

    if (!system && !canDisband(actor, { disbandPermission })) {
      return recordFailedAction({
        kind: "disband",
        serverId,
        matchId: state.matchId,
        source,
        operatorName,
        system,
        teamId,
        squadId,
        reason,
        error: "Forbidden",
        message: `Permission '${disbandPermission}' is required.`,
        target,
      });
    }

    const command = `AdminDisbandSquad ${teamId} ${squadId}`;
    const commandResult = await executeDisbandCommand({ command, serverId, teamId, squadId, reason, source, operatorName, system });
    const result = await persistActionRecord({
      kind: "disband",
      serverId,
      matchId: state.matchId,
      source,
      operatorName,
      system,
      teamId,
      squadId,
      squadName: target.squadName,
      teamName: target.teamName,
      creatorName: target.creatorName,
      steamId: target.creatorSteamId,
      eosId: target.creatorEosId,
      playerKey: target.creatorKey,
      reason,
      result: commandResult.ok ? "success" : "failed",
      error: commandResult.ok ? "" : commandResult.error,
      command,
      payload: {
        request,
        target,
        commandResult,
      },
      ok: commandResult.ok,
      response: commandResult.response,
      action: "disband",
    });

    core.eventBus?.emitModuleEvent?.(MODULE_ID, "squadDisbanded", {
      serverId,
      matchId: state.matchId,
      teamId,
      squadId,
      reason,
      source,
      operatorName,
      system,
      result,
    });

    return {
      ok: commandResult.ok,
      type: SQUAD_ACTION_TYPES.DISBAND_SQUAD,
      action: "disband",
      serverId,
      command,
      rconExecuted: commandResult.executed,
      rconResponse: commandResult.response,
      error: commandResult.error,
      message: commandResult.ok ? "Squad disbanded." : commandResult.error,
      record: result,
      state: buildStateSnapshot(serverId),
    };
  }

  async function executeKick(request = {}) {
    const serverId = normalizeServerId(request.serverId);
    const reason = normalizeText(request.reason);
    const source = normalizeText(request.source) || "manual";
    const operatorName = normalizeText(request.operatorName ?? request.actor?.username ?? request.actor?.name);
    const system = Boolean(request.system);
    const actor = request.actor ?? request.viewer ?? null;
    const requestedPlayer = resolveRequestedPlayer(request);

    if (!serverId) {
      return buildInvalidActionResult("kick", "InvalidServerId", "serverId is required.", { serverId, reason, source, system });
    }
    if (!requestedPlayer.playerKey && !requestedPlayer.playerId && !requestedPlayer.steamId && !requestedPlayer.eosId && !requestedPlayer.name) {
      return recordFailedAction({
        kind: "kick",
        serverId,
        matchId: getCurrentMatchId(serverId),
        source,
        operatorName,
        system,
        reason,
        error: "InvalidTarget",
        message: "A kick target is required.",
      });
    }

    const state = buildStateSnapshot(serverId);
    const target = resolvePlayerTarget(state, requestedPlayer);
    if (!target) {
      return recordFailedAction({
        kind: "kick",
        serverId,
        matchId: state.matchId,
        source,
        operatorName,
        system,
        reason,
        error: "TargetNotFound",
        message: "Target player is not present in the current snapshot.",
      });
    }

    if (!system && !canKick(actor, { kickPermission })) {
      return recordFailedAction({
        kind: "kick",
        serverId,
        matchId: state.matchId,
        source,
        operatorName,
        system,
        reason,
        error: "Forbidden",
        message: `Permission '${kickPermission}' is required.`,
        target,
      });
    }

    const targetId = target.steamId || target.eosId || target.name || target.playerId || requestedPlayer.playerKey;
    const command = `AdminKick "${escapeCommandString(targetId)}" ${escapeCommandString(reason)}`.trim();
    const commandResult = await executeKickCommand({ command, serverId, target, reason, source, operatorName, system });

    const record = await persistActionRecord({
      kind: "kick",
      serverId,
      matchId: state.matchId,
      source,
      operatorName,
      system,
      playerName: target.name,
      playerKey: target.playerKey,
      steamId: target.steamId,
      eosId: target.eosId,
      reason,
      result: commandResult.ok ? "success" : "failed",
      error: commandResult.ok ? "" : commandResult.error,
      command,
      payload: {
        request,
        target,
        commandResult,
      },
      ok: commandResult.ok,
      response: commandResult.response,
      action: "kick",
    });

    core.eventBus?.emitModuleEvent?.(MODULE_ID, "playerKicked", {
      serverId,
      matchId: state.matchId,
      playerId: target.playerId,
      steamId: target.steamId,
      eosId: target.eosId,
      name: target.name,
      reason,
      source,
      operatorName,
      system,
    });

    return {
      ok: commandResult.ok,
      type: SQUAD_ACTION_TYPES.KICK_PLAYER,
      action: "kick",
      serverId,
      command,
      rconExecuted: commandResult.executed,
      rconResponse: commandResult.response,
      error: commandResult.error,
      message: commandResult.ok ? "Player kicked." : commandResult.error,
      record,
      state: buildStateSnapshot(serverId),
    };
  }

  async function executeRemoveFromSquad(request = {}) {
    const serverId = normalizeServerId(request.serverId);
    const reason = normalizeText(request.reason);
    const source = normalizeText(request.source) || "manual";
    const operatorName = normalizeText(request.operatorName ?? request.actor?.username ?? request.actor?.name);
    const system = Boolean(request.system);
    const actor = request.actor ?? request.viewer ?? null;
    const requestedPlayer = resolveRequestedPlayer(request);

    if (!serverId) {
      return buildInvalidActionResult("remove", "InvalidServerId", "serverId is required.", { serverId, reason, source, system });
    }
    if (!requestedPlayer.playerKey && !requestedPlayer.playerId && !requestedPlayer.steamId && !requestedPlayer.eosId && !requestedPlayer.name) {
      return recordFailedAction({
        kind: "remove",
        serverId,
        matchId: getCurrentMatchId(serverId),
        source,
        operatorName,
        system,
        reason,
        error: "InvalidTarget",
        message: "A target player is required.",
      });
    }

    const state = buildStateSnapshot(serverId);
    const target = resolvePlayerTarget(state, requestedPlayer);
    if (!target) {
      return recordFailedAction({
        kind: "remove",
        serverId,
        matchId: state.matchId,
        source,
        operatorName,
        system,
        reason,
        error: "TargetNotFound",
        message: "Target player is not present in the current snapshot.",
      });
    }

    if (!system && !canRemove(actor, { removePermission })) {
      return recordFailedAction({
        kind: "remove",
        serverId,
        matchId: state.matchId,
        source,
        operatorName,
        system,
        reason,
        error: "Forbidden",
        message: `Permission '${removePermission}' is required.`,
        target,
      });
    }

    const targetId = target.steamId || target.eosId || target.name || target.playerId || requestedPlayer.playerKey;
    const command = `AdminKickFromSquad "${escapeCommandString(targetId)}" ${escapeCommandString(reason)}`.trim();
    const commandResult = await executeRemoveCommand({ command, serverId, target, reason, source, operatorName, system });

    const record = await persistActionRecord({
      kind: "remove",
      serverId,
      matchId: state.matchId,
      source,
      operatorName,
      system,
      playerName: target.name,
      playerKey: target.playerKey,
      steamId: target.steamId,
      eosId: target.eosId,
      reason,
      result: commandResult.ok ? "success" : "failed",
      error: commandResult.ok ? "" : commandResult.error,
      command,
      payload: {
        request,
        target,
        commandResult,
      },
      ok: commandResult.ok,
      response: commandResult.response,
      action: "remove",
    });

    core.eventBus?.emitModuleEvent?.(MODULE_ID, "playerRemovedFromSquad", {
      serverId,
      matchId: state.matchId,
      playerId: target.playerId,
      steamId: target.steamId,
      eosId: target.eosId,
      name: target.name,
      reason,
      source,
      operatorName,
      system,
    });

    return {
      ok: commandResult.ok,
      type: SQUAD_ACTION_TYPES.REMOVE_FROM_SQUAD,
      action: "remove",
      serverId,
      command,
      rconExecuted: commandResult.executed,
      rconResponse: commandResult.response,
      error: commandResult.error,
      message: commandResult.ok ? "Player removed from squad." : commandResult.error,
      record,
      state: buildStateSnapshot(serverId),
    };
  }

  async function persistActionRecord(entry = {}) {
    const serverId = normalizeServerId(entry.serverId);
    const cache = ensureServerCache(serverId);
    const timeMs = Date.now();
    const time = new Date(timeMs).toISOString();
    const record = {
      kind: entry.kind,
      serverId,
      matchId: normalizeMatchId(entry.matchId ?? cache.matchId),
      source: entry.source,
      operatorName: entry.operatorName,
      system: entry.system,
      teamId: entry.teamId ?? null,
      squadId: entry.squadId ?? null,
      squadName: entry.squadName ?? "",
      teamName: entry.teamName ?? "",
      creatorName: entry.creatorName ?? "",
      playerName: entry.playerName ?? "",
      steamId: entry.steamId ?? "",
      eosId: entry.eosId ?? "",
      playerKey: entry.playerKey ?? "",
      reason: entry.reason ?? "",
      result: entry.result ?? "failed",
      error: entry.error ?? "",
      command: entry.command ?? "",
      payload: entry.payload ?? {},
      time,
      timeMs,
      logTime: time,
      logSeconds: null,
      creationSignature: "",
      createdAt: timeMs,
      updatedAt: timeMs,
    };

    const saved = await repositoryApi?.insertRecord?.(record);
    updateActionSummary(cache, saved ?? record);
    pushRecentAction(serverId, {
      time,
      action: entry.kind,
      source: entry.source,
      ok: entry.result === "success",
      error: entry.error ?? "",
      message: entry.reason ?? "",
      reason: entry.reason ?? "",
      command: entry.command ?? "",
      system: Boolean(entry.system),
      target: {
        teamId: entry.teamId ?? null,
        squadId: entry.squadId ?? null,
        playerKey: entry.playerKey ?? "",
        playerName: entry.playerName ?? "",
        creatorName: entry.creatorName ?? "",
      },
    });
    return saved ?? record;
  }

  async function listRecords(query = {}) {
    const serverId = normalizeServerId(query.serverId ?? getDefaultServerId());
    const kind = normalizeRecordKindFilter(query.kind ?? query.type ?? "all");
    const limit = normalizePositiveInteger(query.limit, 500);
    const offset = normalizePositiveInteger(query.offset, 0);
    const matchId = normalizeMatchId(query.matchId ?? getCurrentMatchId(serverId));
    const records = await repositoryApi?.listRecords?.({
      serverId,
      matchId,
      kind,
      limit,
      offset,
    }) ?? [];
    const summary = await repositoryApi?.getSummary?.({
      serverId,
      matchId,
    }) ?? buildEmptySummary();

    return {
      ok: true,
      kind,
      limit,
      offset,
      total: summary.total ?? records.length,
      summary,
      records,
    };
  }

  function buildStateSnapshot(serverIdInput) {
    const serverId = normalizeServerId(serverIdInput);
    const cache = ensureServerCache(serverId);
    const lifecycleSnapshot = lifecycle.getCurrentSnapshot(serverId);
    const lifecycleRecords = Array.isArray(lifecycleSnapshot.list) ? lifecycleSnapshot.list : [];
    const rawSquads = Array.isArray(cache.rawSquads) ? cache.rawSquads : [];
    const rawPlayers = Array.isArray(cache.playersRaw) ? cache.playersRaw : [];
    const rawSquadsBySlot = new Map(rawSquads.map((squad) => [buildSquadSlotKey(serverId, cache.matchId, squad.teamId, squad.squadId), squad]));
    const playersBySquad = groupPlayersBySquad(serverId, cache.matchId, rawPlayers);
    const squads = [];
    const creatorsMap = new Map(
      [...(creatorsByServer.get(serverId)?.entries?.() ?? [])].map(([key, value]) => [key, { ...value }]),
    );
    const teamsMap = new Map();

    for (const record of lifecycleRecords) {
      const slotKey = buildSquadSlotKey(serverId, record.matchId ?? cache.matchId, record.teamId, record.squadId);
      const rawSquad = rawSquadsBySlot.get(slotKey) ?? null;
      const merged = mergeSquadRecord({
        serverId,
        cache,
        record,
        rawSquad,
        players: playersBySquad.get(slotKey) ?? [],
      });
      squads.push(merged);
      if (merged.creatorKey) {
        creatorsMap.set(merged.creatorKey, createOrUpdateCreator(creatorsMap.get(merged.creatorKey), merged));
      }
      addTeamEntry(teamsMap, merged);
    }

    for (const rawSquad of rawSquads) {
      const slotKey = buildSquadSlotKey(serverId, cache.matchId, rawSquad.teamId, rawSquad.squadId);
      if (squads.some((squad) => squad.slotKey === slotKey)) continue;
      const merged = mergeSquadRecord({
        serverId,
        cache,
        record: createFallbackLifecycleRecord(serverId, cache.matchId, rawSquad),
        rawSquad,
        players: playersBySquad.get(slotKey) ?? [],
      });
      squads.push(merged);
      if (merged.creatorKey) {
        creatorsMap.set(merged.creatorKey, createOrUpdateCreator(creatorsMap.get(merged.creatorKey), merged));
      }
      addTeamEntry(teamsMap, merged);
    }

    const players = rawPlayers.map((player) => normalizePlayerSnapshot(serverId, cache.matchId, player));
    for (const player of players) {
      const key = buildPlayerKey(player);
      if (!key) continue;
      const squadKey = buildSquadSlotKey(serverId, cache.matchId, player.teamId, player.squadId);
      const squad = squads.find((item) => item.slotKey === squadKey) ?? null;
      if (squad) {
        squad.memberCount = Number(squad.memberCount ?? 0);
      }
      const creatorKey = resolveCreatorKeyFromPlayer(player, squad);
      if (creatorKey) {
        creatorsMap.set(creatorKey, createOrUpdateCreator(creatorsMap.get(creatorKey), squad ?? player, player));
      }
    }

    const filledSquads = squads.map((squad) => {
      const members = rawPlayers
        .filter((player) => matchesSquad(player, squad))
        .map((player) => normalizePlayerSnapshot(serverId, cache.matchId, player));
      const leader = members.find((player) => player.isLeader) ?? members[0] ?? null;
      const creatorStats = squad.creatorKey ? creatorsMap.get(squad.creatorKey) : null;
      const memberCount = members.length;
      const active = Boolean(rawSquadsBySlot.get(squad.slotKey));

      const next = {
        ...squad,
        leaderName: leader?.name ?? squad.leaderName ?? squad.creatorName ?? "",
        leaderSteamId: leader?.steamId ?? squad.leaderSteamId ?? "",
        leaderEosId: leader?.eosId ?? squad.leaderEosId ?? "",
        memberCount,
        members,
        active,
        disbanded: !active,
        warnings: Array.isArray(squad.warnings) ? squad.warnings : [],
        creatorCount: creatorStats?.count ?? 0,
        currentCreatorCount: creatorStats?.count ?? 0,
      };
      const nature = classifySquadName(next.squadName ?? "");
      next.squadNature = nature.nature;
      next.squadNatureLabel = nature.label;
      next.squadNatureReason = nature.reason;
      next.squadNatureRule = nature.matchedRule;
      next.squadNatureConfidence = nature.confidence;
      next.squadNatureNormalizedName = nature.normalizedName;
      return next;
    });

    const populatedTeams = [...teamsMap.values()].map((team) => {
      const teamSquads = filledSquads.filter((squad) => Number(squad.teamId ?? -1) === Number(team.teamId ?? -2));
      const playerCount = players.filter((player) => Number(player.teamId ?? -1) === Number(team.teamId ?? -2)).length;
      return {
        ...team,
        playerCount,
        squads: teamSquads,
      };
    }).sort((left, right) => Number(left.teamId ?? 0) - Number(right.teamId ?? 0));

    const state = {
      serverId,
      matchId: cache.matchId || lifecycleSnapshot.matchId || "",
      updatedAt: cache.updatedAt || new Date().toISOString(),
      rconUpdatedAt: cache.rconUpdatedAt || "",
      playersUpdatedAt: cache.playersUpdatedAt || "",
      squadsUpdatedAt: cache.squadsUpdatedAt || "",
      match: {
        mapName: normalizeText(cache.match?.mapName),
        layerName: normalizeText(cache.match?.layerName),
        gameMode: normalizeText(cache.match?.gameMode),
        logClockSeconds: Number(cache.match?.logClockSeconds ?? 0) || 0,
        isWarmup: Boolean(cache.match?.isWarmup ?? false),
      },
      teams: populatedTeams,
      squads: filledSquads.sort(sortSquads),
      players,
      creators: [...creatorsMap.values()].sort((left, right) => Number(right.count ?? 0) - Number(left.count ?? 0)),
      recentActions: [...cache.recentActions],
      recordsSummary: cache.recordsSummary ?? buildEmptySummary(),
      window: deriveWindow(cache),
      enforcementEnabled,
      disbandPermission,
      kickPermission,
      removePermission,
      kickThreshold,
      noBuildUntilSeconds: normalizePositiveInteger(moduleConfig.noBuildUntilSeconds, 0),
      infantryOnlyUntilSeconds: normalizePositiveInteger(moduleConfig.infantryOnlyUntilSeconds, 0),
      allowedInfantryNames,
      defaultSquadNamePattern,
      currentMatchId: cache.matchId || lifecycleSnapshot.matchId || "",
      activationEnabled: false,
      activationPopulation: players.length,
      activationPlayerThreshold: 0,
      activationPopulationSource: "squadManagement.players",
      roundKey: `${serverId}:${cache.matchId || lifecycleSnapshot.matchId || ""}`,
      roundStartedAtMs: 0,
      roundStartedAt: "",
      logClockSeconds: Number(cache.match?.logClockSeconds ?? 0) || 0,
      logClockHasAnchor: true,
      logClockManual: false,
      logClockLastResetAt: "",
      logClockLastResetReason: "",
      isWarmup: Boolean(cache.match?.isWarmup ?? false),
      summary: {
        currentSquads: filledSquads.length,
        violations: 0,
        creators: creatorsMap.size,
        trackedCreations: lifecycleRecords.length,
      },
      lastBootstrapAt: cache.lastBootstrapAt || "",
      lastSweepAt: cache.lastSweepAt || "",
      lastSweepReason: cache.lastSweepReason || "",
      lastStateUpdatedAt: cache.updatedAt || "",
      lastResetAt: "",
      lastResetReason: "",
    };

    cache.lastState = state;
    touchCache(cache);
    return state;
  }

  async function executeDisbandCommand({ command, serverId, teamId, squadId, reason, source, operatorName, system }) {
    try {
      const response = await runRconCommand({
        command,
        serverId,
        teamId,
        squadId,
        reason,
        source,
        operatorName,
        system,
      }, "disband");
      return {
        ok: true,
        executed: true,
        response,
      };
    } catch (error) {
      return {
        ok: false,
        executed: false,
        response: "",
        error: String(error?.message ?? error),
      };
    }
  }

  async function executeKickCommand({ command, serverId, target, reason, source, operatorName, system }) {
    try {
      const response = await runRconCommand({
        command,
        serverId,
        target,
        reason,
        source,
        operatorName,
        system,
      }, "kick");
      return {
        ok: true,
        executed: true,
        response,
      };
    } catch (error) {
      return {
        ok: false,
        executed: false,
        response: "",
        error: String(error?.message ?? error),
      };
    }
  }

  async function executeRemoveCommand({ command, serverId, target, reason, source, operatorName, system }) {
    try {
      const response = await runRconCommand({
        command,
        serverId,
        target,
        reason,
        source,
        operatorName,
        system,
      }, "remove");
      return {
        ok: true,
        executed: true,
        response,
      };
    } catch (error) {
      return {
        ok: false,
        executed: false,
        response: "",
        error: String(error?.message ?? error),
      };
    }
  }

  async function runRconCommand(meta, action) {
    if (action === "disband") {
      if (typeof core.squadRcon?.adminDisbandSquad === "function") {
        return await core.squadRcon.adminDisbandSquad(meta.teamId, meta.squadId);
      }
    }

    if (action === "kick" || action === "remove") {
      const target = resolveRconPlayerTarget(meta.target);
      if (action === "kick") {
        if (typeof core.squadRcon?.kick === "function") {
          return await core.squadRcon.kick(target, meta.reason ?? "");
        }
      } else {
        if (typeof core.squadRcon?.kickFromSquad === "function") {
          return await core.squadRcon.kickFromSquad(target, meta.reason ?? "");
        }
      }
    }

    if (typeof core.rconManager?.dispatchCommand === "function") {
      const response = await core.rconManager.dispatchCommand({
        command: meta.command,
        requestedBy: `${MODULE_ID}:${meta.operatorName || "system"}`,
        reason: meta.reason || meta.source || action,
        system: meta.system,
      });
      if (response?.success || response?.rconExecuted) {
        return response?.rconResponse ?? response;
      }
      throw new Error(response?.message || "RCON command failed.");
    }

    if (typeof core.rcon?.execute === "function") {
      return await core.rcon.execute(meta.command);
    }

    throw new Error("No RCON executor is available.");
  }

  function resolveRconPlayerTarget(target) {
    if (!target || typeof target !== "object") return String(target ?? "");
    return normalizeText(target.steamId ?? target.eosId ?? target.name ?? target.playerId ?? target.anyId ?? target.playerKey ?? "");
  }

  function getDefaultServerId() {
    return normalizeServerId(core.webStatus?.serverId ?? "");
  }

  function getCurrentMatchId(serverId) {
    return normalizeMatchId(lifecycle.getCurrentMatchId(serverId) || ensureServerCache(serverId).matchId || "");
  }

  function ensureServerCache(serverId) {
    const key = normalizeServerId(serverId) || getDefaultServerId() || "default";
    let cache = serverCache.get(key);
    if (cache) return cache;

    cache = {
      serverId: key,
      matchId: "",
      match: {
        mapName: "",
        layerName: "",
        gameMode: "",
        logClockSeconds: 0,
        isWarmup: false,
      },
      rawSquads: [],
      playersRaw: [],
      rconUpdatedAt: "",
      playersUpdatedAt: "",
      squadsUpdatedAt: "",
      lastEventAt: "",
      recentActions: [],
      recordsSummary: buildEmptySummary(),
      updatedAt: new Date().toISOString(),
      lastState: null,
    };
    serverCache.set(key, cache);
    return cache;
  }

  function touchCache(cache) {
    cache.updatedAt = new Date().toISOString();
  }

  function updateActionSummary(cache, record) {
    if (!cache.recordsSummary) cache.recordsSummary = buildEmptySummary();
    cache.recordsSummary.total += 1;
    if (record.kind === "squad_created") cache.recordsSummary.created += 1;
    if (record.kind === "disband") cache.recordsSummary.disbanded += 1;
    if (record.kind === "kick") cache.recordsSummary.kicked += 1;
    if (record.kind === "remove") cache.recordsSummary.removed += 1;
    if (record.kind === "disband" || record.kind === "kick" || record.kind === "remove") cache.recordsSummary.actions += 1;
    if (record.result === "success") cache.recordsSummary.success += 1;
    if (record.result && record.result !== "success") cache.recordsSummary.failed += 1;
    cache.recordsSummary.lastEventAt = record.time || cache.recordsSummary.lastEventAt || "";
  }

  function applyRecordToCache(cache, record) {
    if (!cache.recordsSummary) cache.recordsSummary = buildEmptySummary();
    updateActionSummary(cache, record);
  }

  function pushRecentAction(serverId, action) {
    const cache = ensureServerCache(serverId);
    cache.recentActions.push({
      time: normalizeText(action.time) || new Date().toISOString(),
      action: normalizeText(action.action),
      source: normalizeText(action.source),
      ok: Boolean(action.ok),
      error: normalizeText(action.error),
      message: normalizeText(action.message),
      reason: normalizeText(action.reason),
      command: normalizeText(action.command),
      system: Boolean(action.system),
      target: cloneValue(action.target ?? null),
    });

    while (cache.recentActions.length > MAX_RECENT_ACTIONS) {
      cache.recentActions.shift();
    }

    recentActions.push({
      serverId,
      ...cloneValue(action),
    });

    while (recentActions.length > MAX_RECENT_ACTIONS * 2) {
      recentActions.shift();
    }
  }

  function buildEmptySummary() {
    return {
      total: 0,
      created: 0,
      disbanded: 0,
      kicked: 0,
      actions: 0,
      success: 0,
      failed: 0,
      lastEventAt: "",
    };
  }

  function createFallbackLifecycleRecord(serverId, matchId, rawSquad) {
    return {
      key: buildSquadLifecycleKey(serverId, matchId, rawSquad.teamId, rawSquad.squadId, 1),
      slotKey: buildSquadLifecycleSlotKey(serverId, matchId, rawSquad.teamId, rawSquad.squadId),
      serverId,
      matchId,
      teamId: rawSquad.teamId ?? null,
      squadId: rawSquad.squadId ?? null,
      squadName: rawSquad.squadName ?? "",
      factionName: rawSquad.teamName ?? "",
      creatorName: rawSquad.creatorName ?? "",
      creatorSteamId: rawSquad.creatorSteamId ?? rawSquad.creatorSteamID ?? "",
      creatorEosId: rawSquad.creatorEosId ?? rawSquad.creatorEOSID ?? "",
      createdAtMs: Date.now(),
      createdAt: new Date().toISOString(),
      creationSource: "RCON_SNAPSHOT",
      creationConfidence: "MEDIUM",
      generation: 1,
    };
  }

  function mergeSquadRecord({ serverId, cache, record, rawSquad, players }) {
    const raw = rawSquad ?? {};
    const slotKey = buildSquadLifecycleSlotKey(serverId, record.matchId ?? cache.matchId, record.teamId, record.squadId);
    const lifecycleKey = buildSquadLifecycleKey(serverId, record.matchId ?? cache.matchId, record.teamId, record.squadId, record.generation);
    const creatorKey = buildCreatorKey({
      creatorSteamId: record.creatorSteamId ?? raw.creatorSteamId ?? raw.creatorSteamID ?? "",
      creatorEosId: record.creatorEosId ?? raw.creatorEosId ?? raw.creatorEOSID ?? "",
      creatorName: record.creatorName ?? raw.creatorName ?? "",
    });
    const members = Array.isArray(players) ? players.map((player) => normalizePlayerSnapshot(serverId, cache.matchId, player)) : [];
    const leader = members.find((player) => player.isLeader) ?? null;
    const createdAtMs = Number(record.createdAtMs ?? raw.createdAtMs ?? Date.now()) || Date.now();

    return {
      serverId,
      matchId: record.matchId ?? cache.matchId ?? "",
      teamId: normalizeNullableNumber(record.teamId ?? raw.teamId ?? raw.teamID),
      squadId: normalizeNullableNumber(record.squadId ?? raw.squadId ?? raw.squadID),
      generation: normalizeNullableNumber(record.generation) ?? 1,
      squadName: normalizeText(record.squadName ?? raw.squadName ?? raw.name),
      teamName: normalizeText(record.factionName ?? raw.teamName),
      leaderName: normalizeText(leader?.name ?? raw.creatorName ?? record.creatorName),
      leaderSteamId: normalizeText(leader?.steamId ?? record.creatorSteamId ?? raw.creatorSteamId ?? raw.creatorSteamID),
      leaderEosId: normalizeText(leader?.eosId ?? record.creatorEosId ?? raw.creatorEosId ?? raw.creatorEOSID),
      creatorName: normalizeText(record.creatorName ?? raw.creatorName ?? ""),
      creatorSteamId: normalizeText(record.creatorSteamId ?? raw.creatorSteamId ?? raw.creatorSteamID ?? ""),
      creatorEosId: normalizeText(record.creatorEosId ?? raw.creatorEosId ?? raw.creatorEOSID ?? ""),
      creatorKey,
      creatorCount: 0,
      createdAt: record.createdAt ?? new Date(createdAtMs).toISOString(),
      createdAtMs,
      createdSeconds: Math.floor(createdAtMs / 1000),
      creationSource: record.creationSource ?? "RCON_SNAPSHOT",
      creationConfidence: record.creationConfidence ?? "MEDIUM",
      memberCount: members.length,
      members,
      locked: Boolean(raw.locked ?? false),
      warnings: [],
      lifecycleKey,
      slotKey,
      active: Boolean(rawSquad),
      disbanded: !rawSquad,
      recordKey: record.key,
      anyId: normalizeText(record.creatorSteamId ?? record.creatorEosId ?? record.creatorName ?? ""),
      raw: raw.raw ?? "",
      violationType: "",
      violationReason: "",
      shouldDisband: false,
      currentCreatorCount: 0,
    };
  }

  function createOrUpdateCreator(existing, squad, player = null) {
    const source = player ?? squad ?? {};
    const firstSeenAtMs = Number(existing?.firstSeenAtMs ?? squad.createdAtMs ?? Date.now()) || Date.now();
    const lastSeenAtMs = Number(squad.createdAtMs ?? player?.joinedAtMs ?? Date.now()) || Date.now();
    const creatorKey = existing?.creatorKey ?? squad.creatorKey ?? buildCreatorKey({
      creatorSteamId: squad.creatorSteamId,
      creatorEosId: squad.creatorEosId,
      creatorName: squad.creatorName,
    });

    return {
      creatorKey,
      creatorName: normalizeText(existing?.creatorName ?? squad.creatorName ?? source.name),
      steamId: normalizeText(existing?.steamId ?? squad.creatorSteamId ?? source.steamId),
      eosId: normalizeText(existing?.eosId ?? squad.creatorEosId ?? source.eosId),
      anyId: normalizeText(existing?.anyId ?? squad.creatorSteamId ?? squad.creatorEosId ?? squad.creatorName),
      count: Number(existing?.count ?? 0) + (existing ? 0 : (player ? 0 : 1)),
      firstSeenAtMs,
      firstSeenAt: new Date(firstSeenAtMs).toISOString(),
      lastSeenAtMs,
      lastSeenAt: new Date(lastSeenAtMs).toISOString(),
      lastKickAt: normalizeText(existing?.lastKickAt),
      lastKickResult: normalizeText(existing?.lastKickResult),
      lastKickAttemptedCount: Number(existing?.lastKickAttemptedCount ?? 0),
      lastKickMessage: normalizeText(existing?.lastKickMessage),
      latestSquadName: normalizeText(existing?.latestSquadName ?? squad.squadName),
      latestSquadId: existing?.latestSquadId ?? squad.squadId ?? null,
      latestTeamId: existing?.latestTeamId ?? squad.teamId ?? null,
      lastActionAt: new Date().toISOString(),
    };
  }

  function updateCreatorStats(serverId, lifecycleRecord) {
    const cache = ensureServerCache(serverId);
    const creators = creatorsByServer.get(serverId) ?? new Map();
    const creatorKey = buildCreatorKey(lifecycleRecord);
    if (!creatorKey) return;
    const existing = creators.get(creatorKey);
    const firstSeenAtMs = Number(existing?.firstSeenAtMs ?? lifecycleRecord.createdAtMs ?? Date.now()) || Date.now();
    const lastSeenAtMs = Number(lifecycleRecord.createdAtMs ?? Date.now()) || Date.now();
    creators.set(creatorKey, {
      creatorKey,
      creatorName: normalizeText(existing?.creatorName ?? lifecycleRecord.creatorName),
      steamId: normalizeText(existing?.steamId ?? lifecycleRecord.creatorSteamId),
      eosId: normalizeText(existing?.eosId ?? lifecycleRecord.creatorEosId),
      anyId: normalizeText(existing?.anyId ?? lifecycleRecord.creatorSteamId ?? lifecycleRecord.creatorEosId ?? lifecycleRecord.creatorName),
      count: Number(existing?.count ?? 0) + 1,
      firstSeenAtMs,
      firstSeenAt: new Date(firstSeenAtMs).toISOString(),
      lastSeenAtMs,
      lastSeenAt: new Date(lastSeenAtMs).toISOString(),
      lastKickAt: normalizeText(existing?.lastKickAt),
      lastKickResult: normalizeText(existing?.lastKickResult),
      lastKickAttemptedCount: Number(existing?.lastKickAttemptedCount ?? 0),
      lastKickMessage: normalizeText(existing?.lastKickMessage),
      latestSquadName: normalizeText(lifecycleRecord.squadName ?? existing?.latestSquadName),
      latestSquadId: lifecycleRecord.squadId ?? existing?.latestSquadId ?? null,
      latestTeamId: lifecycleRecord.teamId ?? existing?.latestTeamId ?? null,
      lastActionAt: new Date().toISOString(),
    });
    creatorsByServer.set(serverId, creators);
    cache.creators = [...creators.values()];
  }

  async function checkSquadPolicy(serverId, lifecycleRecord) {
    if (!enforcementEnabled) return;

    const logSeconds = core.logClock?.getSeconds(lifecycleRecord.createdAtMs)
      ?? lifecycleRecord.logSeconds
      ?? extractSeconds(lifecycleRecord.eventTime)
      ?? 0;

    // Policy 1: No Build until X seconds
    const noBuildUntilSeconds = normalizePositiveInteger(moduleConfig.noBuildUntilSeconds, 0);
    if (noBuildUntilSeconds > 0 && logSeconds < noBuildUntilSeconds) {
      return api.executeAction({
        type: SQUAD_ACTION_TYPES.DISBAND_SQUAD,
        serverId,
        teamId: lifecycleRecord.teamId,
        squadId: lifecycleRecord.squadId,
        reason: `No building allowed until ${noBuildUntilSeconds}s (current: ${logSeconds}s)`,
        source: "policy.fairSquadBuilding",
        system: true,
      });
    }

    // Policy 2: Infantry Only until Y seconds
    const infantryOnlyUntilSeconds = normalizePositiveInteger(moduleConfig.infantryOnlyUntilSeconds, 0);
    if (infantryOnlyUntilSeconds > 0 && logSeconds < infantryOnlyUntilSeconds) {
      const squadName = normalizeText(lifecycleRecord.squadName);
      const classification = classifySquadName(squadName);
      const isAllowed = classification.nature === "infantry"
        || allowedInfantryNames.some((name) => squadName.toLowerCase().includes(normalizeText(name).toLowerCase()));
      if (!isAllowed) {
        return api.executeAction({
          type: SQUAD_ACTION_TYPES.DISBAND_SQUAD,
          serverId,
          teamId: lifecycleRecord.teamId,
          squadId: lifecycleRecord.squadId,
          reason: `Infantry/Allowed squads only until ${infantryOnlyUntilSeconds}s`,
          source: "policy.fairSquadBuilding",
          system: true,
        });
      }
    }
  }

  async function checkKickPolicy(serverId, creator) {
    if (!enforcementEnabled) return;
    if (creator.count <= kickThreshold) return;
    if (creator.lastKickAttemptedCount >= creator.count) return;

    const reason = `Creating too many squads (${creator.count} > ${kickThreshold})`;
    creator.lastKickAttemptedCount = creator.count;
    creator.lastKickAt = new Date().toISOString();

    return executeKick({
      serverId,
      reason,
      source: "policy",
      system: true,
      steamId: creator.steamId,
      eosId: creator.eosId,
      name: creator.creatorName,
      playerKey: creator.creatorKey,
    });
  }

  function buildCreatorRecordFromLifecycle(record) {
    return {
      creatorKey: buildCreatorKey(record),
      creatorName: record.creatorName,
      steamId: record.creatorSteamId,
      eosId: record.creatorEosId,
      count: 1,
      firstSeenAtMs: record.timeMs ?? record.createdAtMs ?? Date.now(),
      lastSeenAtMs: record.timeMs ?? record.createdAtMs ?? Date.now(),
      latestSquadName: record.squadName,
      latestSquadId: record.squadId,
      latestTeamId: record.teamId,
    };
  }

  function getStateCreators(serverId) {
    const creators = creatorsByServer.get(serverId);
    return creators ? [...creators.values()] : [];
  }

  function normalizeRconSquads(squads = []) {
    return squads.map((squad) => ({
      teamId: normalizeNullableNumber(squad.teamId ?? squad.teamID),
      squadId: normalizeNullableNumber(squad.squadId ?? squad.squadID),
      squadName: normalizeText(squad.squadName ?? squad.name),
      teamName: normalizeText(squad.teamName),
      creatorName: normalizeText(squad.creatorName),
      creatorSteamId: normalizeText(squad.creatorSteamId ?? squad.creatorSteamID),
      creatorEosId: normalizeText(squad.creatorEosId ?? squad.creatorEOSID),
      locked: Boolean(squad.locked),
      size: Number(squad.size ?? 0) || 0,
      raw: normalizeText(squad.raw),
      sourceEventId: normalizeText(squad.sourceEventId),
    }));
  }

  function normalizeRconPlayers(players = []) {
    return players.map((player) => ({
      playerId: normalizeText(player.playerId ?? player.playerID),
      name: normalizeText(player.name),
      steamId: normalizeText(player.steamId ?? player.steamID),
      eosId: normalizeText(player.eosId ?? player.eosID),
      ip: normalizeText(player.ip),
      teamId: normalizeNullableNumber(player.teamId ?? player.teamID),
      squadId: normalizeNullableNumber(player.squadId ?? player.squadID),
      role: normalizeText(player.role),
      isLeader: Boolean(player.isLeader),
      isOnline: player.isOnline == null ? player.online !== false : Boolean(player.isOnline),
      playtimeSeconds: normalizeNullableNumber(player.playtimeSeconds),
      joinedAt: normalizeText(player.joinedAt),
      raw: normalizeText(player.raw),
      steamId: normalizeText(player.steamId ?? player.steamID),
      eosId: normalizeText(player.eosId ?? player.eosID),
    }));
  }

  function normalizePlayerSnapshot(serverId, matchId, player) {
    return {
      playerId: normalizeText(player.playerId ?? player.playerID),
      name: normalizeText(player.name),
      steamId: normalizeText(player.steamId ?? player.steamID),
      eosId: normalizeText(player.eosId ?? player.eosID),
      ip: normalizeText(player.ip),
      teamId: normalizeNullableNumber(player.teamId ?? player.teamID),
      squadId: normalizeNullableNumber(player.squadId ?? player.squadID),
      role: normalizeText(player.role),
      isLeader: Boolean(player.isLeader),
      isOnline: player.isOnline == null ? player.online !== false : Boolean(player.isOnline),
      playtimeSeconds: normalizeNullableNumber(player.playtimeSeconds),
      joinedAt: normalizeText(player.joinedAt),
      raw: normalizeText(player.raw),
      playerKey: buildPlayerKey(player),
      serverId,
      matchId,
    };
  }

  function buildPlayerKey(player = {}) {
    const playerId = normalizeText(player.playerId ?? player.playerID);
    const steamId = normalizeText(player.steamId ?? player.steamID);
    const eosId = normalizeText(player.eosId ?? player.eosID);
    const name = normalizeText(player.name);
    if (playerId) return `player:${playerId}`;
    if (steamId) return `steam:${steamId}`;
    if (eosId) return `eos:${eosId}`;
    if (name) return `name:${name}`;
    return "";
  }

  function buildCreatorKey(source = {}) {
    const steamId = normalizeText(source.creatorSteamId ?? source.steamId ?? source.steamID);
    const eosId = normalizeText(source.creatorEosId ?? source.eosId ?? source.eosID);
    const name = normalizeSquadName(source.creatorName ?? source.name);
    if (steamId) return `steam:${steamId}`;
    if (eosId) return `eos:${eosId}`;
    if (name) return `name:${name}`;
    return "";
  }

  function resolveCreatorKeyFromPlayer(player, squad) {
    const creatorKey = buildCreatorKey({
      creatorSteamId: squad?.creatorSteamId ?? player?.steamId,
      creatorEosId: squad?.creatorEosId ?? player?.eosId,
      creatorName: squad?.creatorName ?? player?.name,
    });
    return creatorKey;
  }

  function resolveRequestedPlayer(request) {
    return {
      anyId: normalizeText(request.anyId ?? request.playerKey ?? request.playerID ?? request.playerId ?? request.steamId ?? request.steamID ?? request.eosId ?? request.eosID ?? request.name ?? request.playerName),
      playerKey: normalizeText(request.playerKey ?? request.playerID ?? request.playerId),
      playerId: normalizeText(request.playerId ?? request.playerID),
      steamId: normalizeText(request.steamId ?? request.steamID ?? request.Steam64ID),
      eosId: normalizeText(request.eosId ?? request.eosID ?? request.EOSID),
      name: normalizeText(request.name ?? request.playerName),
    };
  }

  function resolvePlayerTarget(state, request) {
    const lookup = {
      anyId: normalizeText(request.anyId ?? request.playerKey ?? request.playerId ?? request.playerID ?? request.steamId ?? request.steamID ?? request.eosId ?? request.eosID ?? request.name ?? request.playerName),
      playerKey: normalizeText(request.playerKey ?? request.playerId ?? request.playerID),
      playerId: normalizeText(request.playerId ?? request.playerID),
      steamId: normalizeText(request.steamId ?? request.steamID),
      eosId: normalizeText(request.eosId ?? request.eosID),
      name: normalizeText(request.name ?? request.playerName ?? request.creatorName),
    };

    const target = state.players.find((player) => {
      if (lookup.anyId && (
        normalizeText(player.playerId) === lookup.anyId
        || normalizeText(player.steamId) === lookup.anyId
        || normalizeText(player.eosId) === lookup.anyId
        || normalizeText(player.name) === lookup.anyId
        || samePlayerKey(player, lookup.anyId)
      )) return true;
      if (lookup.playerKey && samePlayerKey(player, lookup.playerKey)) return true;
      if (lookup.playerId && normalizeText(player.playerId) === lookup.playerId) return true;
      if (lookup.steamId && normalizeText(player.steamId) === lookup.steamId) return true;
      if (lookup.eosId && normalizeText(player.eosId) === lookup.eosId) return true;
      if (lookup.name && normalizeText(player.name) === lookup.name) return true;
      return false;
    });

    return target ? {
      ...target,
      playerKey: buildPlayerKey(target),
    } : null;
  }

  function normalizeSquadCreatedEvent(event = {}) {
    const serverId = normalizeServerId(event.serverId ?? core.webStatus?.serverId ?? "");
    const teamId = normalizeNullableNumber(event.teamId ?? event.TeamID ?? getParam(event, "TeamID"));
    const squadId = normalizeNullableNumber(event.squadId ?? event.squadID ?? getParam(event, "SquadID"));
    const creatorName = normalizeText(event.creatorName ?? event.playerName ?? getParam(event, "PlayerName"));
    const creatorSteamId = normalizeText(event.creatorSteamId ?? event.steamID ?? event.Steam64ID ?? getParam(event, "Steam64ID"));
    const creatorEosId = normalizeText(event.creatorEosId ?? event.eosID ?? event.EOSID ?? getParam(event, "EOSID"));
    const squadName = normalizeText(event.squadName ?? getParam(event, "SquadName"));
    const teamName = normalizeText(event.teamName ?? event.factionName ?? getParam(event, "FactionName"));
    const source = normalizeText(event.source ?? event.layer ?? "log");
    const createdAt = normalizeText(event.createdAt ?? event.time ?? new Date().toISOString());
    const createdAtMs = normalizePositiveNumber(event.createdAtMs ?? event.timeMs ?? createdAt, Date.now());
    const matchId = normalizeMatchId(event.matchId ?? event.sessionId ?? event.sessionID ?? getCurrentMatchId(serverId) ?? "");

    return {
      serverId,
      matchId,
      teamId,
      squadId,
      creatorName,
      creatorSteamId,
      creatorEosId,
      squadName,
      teamName,
      source,
      time: createdAt,
      createdAt,
      createdAtMs,
      sourceEventId: normalizeText(event.sourceEventId ?? event.eventId),
      rawLog: normalizeText(event.rawLog ?? event.raw ?? ""),
      creationSource: normalizeText(event.creationSource ?? "LOG") || "LOG",
      creationConfidence: normalizeText(event.creationConfidence ?? "HIGH") || "HIGH",
    };
  }

  function normalizePositiveNumber(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.trunc(number);
  }

  function normalizePositiveInteger(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return Math.floor(Number(fallback) || 0);
    return Math.floor(number);
  }


  function normalizeNullableNumber(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : null;
  }

  function normalizeServerId(value) {
    return normalizeText(value || core.webStatus?.serverId || "");
  }

  function normalizeMatchId(value) {
    return normalizeText(value);
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function resolveTeamIdForCreatedSquad(serverId, parsed) {
    if (parsed?.teamId != null) return parsed.teamId;

    const cache = ensureServerCache(serverId);
    const squads = Array.isArray(cache.rawSquads) ? cache.rawSquads : [];
    const parsedSquadId = Number(parsed?.squadId);
    const parsedSquadName = normalizeText(parsed?.squadName).toLowerCase();
    const parsedCreatorName = normalizeText(parsed?.creatorName).toLowerCase();
    const parsedCreatorSteamId = normalizeText(parsed?.creatorSteamId).toLowerCase();
    const parsedCreatorEosId = normalizeText(parsed?.creatorEosId).toLowerCase();
    const parsedTeamName = normalizeText(parsed?.teamName).toLowerCase();

    const byStrict = squads.find((squad) =>
      Number(squad.squadId) === parsedSquadId
      && normalizeText(squad.squadName).toLowerCase() === parsedSquadName,
    );
    if (byStrict?.teamId != null) return byStrict.teamId;

    const byCreator = squads.find((squad) =>
      Number(squad.squadId) === parsedSquadId
      && normalizeText(squad.creatorName).toLowerCase() === parsedCreatorName,
    );
    if (byCreator?.teamId != null) return byCreator.teamId;

    const byIdentity = squads.find((squad) =>
      normalizeText(squad.squadName).toLowerCase() === parsedSquadName
      && (
        normalizeText(squad.creatorSteamId).toLowerCase() === parsedCreatorSteamId
        || normalizeText(squad.creatorEosId).toLowerCase() === parsedCreatorEosId
      ),
    );
    if (byIdentity?.teamId != null) return byIdentity.teamId;

    const byFaction = squads.find((squad) =>
      Number(squad.squadId) === parsedSquadId
      && (
        normalizeText(squad.teamName).toLowerCase() === parsedTeamName
        || normalizeText(squad.teamName).toLowerCase() === normalizeText(parsed?.teamName).toLowerCase()
      ),
    );
    if (byFaction?.teamId != null) return byFaction.teamId;

    return null;
  }

  function queuePendingSquadCreation(serverId, parsed) {
    const key = normalizeServerId(serverId);
    if (!key) return;
    const queue = pendingCreationsByServer.get(key) ?? [];
    const signature = buildPendingCreationSignature(parsed);
    if (queue.some((item) => buildPendingCreationSignature(item) === signature)) return;
    queue.push({ ...parsed });
    pendingCreationsByServer.set(key, queue);
  }

  async function flushPendingSquadCreations(serverId) {
    const key = normalizeServerId(serverId);
    const queue = pendingCreationsByServer.get(key);
    if (!Array.isArray(queue) || queue.length === 0) return;

    pendingCreationsByServer.set(key, []);
    for (const parsed of queue) {
      await handleSquadCreated(parsed);
    }

    const remaining = pendingCreationsByServer.get(key) ?? [];
    if (remaining.length === 0) {
      pendingCreationsByServer.delete(key);
    }
  }

  async function refreshSquadsSnapshot(serverId) {
    const matchState = modules?.matchState;
    if (typeof matchState?.refresh === "function") {
      await matchState.refresh("squads");
      return true;
    }

    if (typeof core.rconManager?.dispatchCommand === "function") {
      await core.rconManager.dispatchCommand({
        command: "ListSquads",
        requestedBy: `${MODULE_ID}:refresh`,
        reason: "squad-target-refresh",
      });
    }

    return false;
  }

  function extractActionTarget(record = null) {
    if (!record || typeof record !== "object") return null;
    const payload = record.payload ?? {};
    return payload.target ?? payload?.request?.target ?? null;
  }

  function buildPendingCreationSignature(parsed = {}) {
    return [
      normalizeServerId(parsed.serverId),
      normalizeText(parsed.matchId),
      normalizeText(parsed.squadId),
      normalizeText(parsed.teamId),
      normalizeText(parsed.squadName).toLowerCase(),
      normalizeText(parsed.creatorName).toLowerCase(),
      normalizeText(parsed.creatorSteamId).toLowerCase(),
      normalizeText(parsed.creatorEosId).toLowerCase(),
    ].join(":");
  }

  function buildSyntheticMatchId(serverId, event = {}) {
    const rawMatchId = normalizeMatchId(event.matchId ?? event.sessionId ?? event.sessionID ?? "");
    if (rawMatchId) return rawMatchId;
    return `${DEFAULT_MATCH_ID_PREFIX}:${serverId}:${Date.now()}`;
  }

  function normalizeRecordKindFilter(value) {
    const kind = normalizeText(value).toLowerCase();
    if (kind === "created" || kind === "squad_created") return "squad_created";
    if (kind === "remove") return "remove";
    if (kind === "disband" || kind === "kick" || kind === "action" || kind === "all") return kind;
    return "all";
  }

  function normalizeActionType(value) {
    const type = normalizeText(value).toLowerCase();
    if (type in ACTION_TYPE_TO_KIND) return type;
    if (type in ACTION_KIND_TO_TYPE) return ACTION_KIND_TO_TYPE[type];
    return "";
  }

  function buildInvalidActionResult(action, error, message, details = {}) {
    return {
      ok: false,
      type: ACTION_KIND_TO_TYPE[action] ?? action,
      action,
      serverId: normalizeServerId(details.serverId),
      command: "",
      rconExecuted: false,
      rconResponse: "",
      error,
      message,
      record: null,
      state: buildStateSnapshot(normalizeServerId(details.serverId)),
    };
  }

  async function recordFailedAction(entry) {
    const record = await persistActionRecord({
      kind: entry.kind,
      serverId: entry.serverId,
      matchId: entry.matchId,
      source: entry.source,
      operatorName: entry.operatorName,
      system: entry.system,
      teamId: entry.teamId,
      squadId: entry.squadId,
      squadName: entry.squadName,
      teamName: entry.teamName,
      creatorName: entry.creatorName,
      playerName: entry.playerName,
      steamId: entry.steamId,
      eosId: entry.eosId,
      playerKey: entry.playerKey,
      reason: entry.reason,
      result: "failed",
      error: entry.error,
      command: entry.command ?? "",
      payload: entry.payload ?? {
        reason: entry.reason,
      },
    });

    return {
      ok: false,
      type: ACTION_KIND_TO_TYPE[entry.kind] ?? entry.kind,
      action: entry.kind,
      serverId: normalizeServerId(entry.serverId),
      command: entry.command ?? "",
      rconExecuted: false,
      rconResponse: "",
      error: entry.error,
      message: entry.message,
      record,
      state: buildStateSnapshot(entry.serverId),
    };
  }

  function sameSquadKey(squad, teamId, squadId) {
    return Number(squad.teamId ?? -1) === Number(teamId ?? -2)
      && Number(squad.squadId ?? -1) === Number(squadId ?? -2);
  }

  function samePlayerKey(player, key) {
    return buildPlayerKey(player) === normalizeText(key);
  }

  function matchesSquad(player, squad) {
    return Number(player.teamId ?? -1) === Number(squad.teamId ?? -2)
      && Number(player.squadId ?? -1) === Number(squad.squadId ?? -2);
  }

  function buildSquadSlotKey(serverId, matchId, teamId, squadId) {
    return buildSquadLifecycleSlotKey(serverId, matchId, teamId, squadId);
  }

  function groupPlayersBySquad(serverId, matchId, players = []) {
    const map = new Map();
    for (const player of players) {
      const key = buildSquadSlotKey(serverId, matchId, player.teamId, player.squadId);
      const list = map.get(key) ?? [];
      list.push(player);
      map.set(key, list);
    }
    return map;
  }

  function addTeamEntry(teamsMap, squad) {
    const key = Number(squad.teamId ?? -1);
    if (!teamsMap.has(key)) {
      teamsMap.set(key, {
        teamId: squad.teamId ?? null,
        teamName: squad.teamName || "",
        playerCount: 0,
        squads: [],
      });
    }
    teamsMap.get(key).squads.push(squad);
  }

  function sortSquads(left, right) {
    const leftTeam = Number(left.teamId ?? 0);
    const rightTeam = Number(right.teamId ?? 0);
    if (leftTeam !== rightTeam) return leftTeam - rightTeam;
    return Number(left.squadId ?? 0) - Number(right.squadId ?? 0);
  }

  function cloneValue(value) {
    if (value == null || typeof value !== "object") return value;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  function deriveWindow(cache) {
    if (cache.match?.isWarmup) return "warmup";
    if (cache.matchId) return "open";
    return "waiting";
  }

  function extractSeconds(value) {
    const parsed = Date.parse(String(value ?? ""));
    if (!Number.isFinite(parsed)) return null;
    return Math.floor(parsed / 1000);
  }

  function escapeCommandString(value) {
    return String(value ?? "").replace(/"/g, '\\"');
  }
}
