// -*- coding: utf-8 -*-

import { parseListSquads } from "../../core/squad-rcon.js";
import { BzssSquadLifecycleEventBus } from "./event-bus.js";
import { SquadLogAdapter } from "./log-adapter.js";
import { toRconSquadSnapshot } from "./parse-rcon-squads.js";
import { SquadRconPoller } from "./rcon-poller.js";
import { InMemorySquadLifecycleRepository } from "./repository.js";
import { SquadLifecycleService } from "./service.js";
import { defaultSquadLifecycleConfig, normalizeSquadLifecycleConfig } from "./config.js";

const MATCH_END_EVENTS = ["GAME_END", "MATCH_END", "ROUND_END", "ROUND_ENDED"];

export function createSquadLifecycleModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.squadLifecycle",
    source: "module.squadLifecycle",
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = normalizeSquadLifecycleConfig({
    ...defaultSquadLifecycleConfig,
    ...(config?.get("modules.squadLifecycle", {}) ?? {}),
  });

  const repository = new InMemorySquadLifecycleRepository();
  const eventBus = new BzssSquadLifecycleEventBus({ core });

  const matchRuntime = {
    byServer: new Map(),
    matchChangingUntil: 0,
  };

  const service = new SquadLifecycleService(moduleConfig, repository, eventBus, moduleLogger);

  const rconClient = {
    async getSquadSnapshot() {
      const serverId = resolveServerId(core);
      const matchContext = resolveMatchContext(serverId, modules, core, matchRuntime);
      const result = await core.rconManager.dispatchCommand({
        command: "ListSquads",
        requestedBy: "module.squadLifecycle",
        reason: "squad-lifecycle-poller",
      });

      if (!result?.success) {
        throw new Error(result?.message || "ListSquads failed");
      }

      const parsedSquads = parseListSquads(result.rconResponse);
      return toRconSquadSnapshot({
        serverId,
        matchId: matchContext.matchId,
        parsedSquads,
        rawText: result.rconResponse,
        capturedAt: Date.now(),
        playerCount: matchContext.playerCount,
        isMatchChanging: Date.now() < matchRuntime.matchChangingUntil,
      });
    },
  };

  const poller = new SquadRconPoller(moduleConfig, rconClient, service, moduleLogger);

  const logAdapter = new SquadLogAdapter(service, {
    resolveMatchContext: (serverId) => resolveMatchContext(serverId, modules, core, matchRuntime),
    findTeamIdForSquad: ({ serverId, squadId, squadName }) => {
      const squads = modules?.squadState?.getSquads?.(serverId) ?? [];
      const matches = squads.filter((x) => {
        if (Number(x.squadID) !== Number(squadId)) return false;
        if (!squadName) return true;
        return String(x.squadName ?? "").trim() === String(squadName).trim();
      });

      if (matches.length === 1 && Number.isFinite(Number(matches[0].teamID))) {
        return Number(matches[0].teamID);
      }

      return null;
    },
    logger: moduleLogger,
    debug: moduleConfig.debug,
  });

  const unsubscribers = [];

  const api = {
    getConfig() {
      return { ...moduleConfig };
    },

    async getCurrentSquads(serverId, matchId = null) {
      const sid = String(serverId || resolveServerId(core));
      const context = resolveMatchContext(sid, modules, core, matchRuntime);
      const targetMatchId = String(matchId || context.matchId);
      if (!targetMatchId) return [];
      return service.getCurrentSquads({ serverId: sid, matchId: targetMatchId });
    },

    async getEvents(serverId, matchId = null, limit = 1000) {
      const sid = String(serverId || resolveServerId(core));
      const context = resolveMatchContext(sid, modules, core, matchRuntime);
      const targetMatchId = String(matchId || context.matchId);
      if (!targetMatchId) return [];
      return repository.getEventsByMatch(sid, targetMatchId, limit);
    },

    dumpStates() {
      return repository.dumpStates();
    },

    dumpEvents() {
      return repository.dumpEvents();
    },

    async ingestSquadCreateLogEvent(event) {
      return service.handleSquadCreateLogEvent(event);
    },

    async ingestRconSnapshot(snapshot) {
      return service.handleRconSnapshot(snapshot);
    },

    async closeCurrentMatch(serverId, endedAt = Date.now()) {
      const sid = String(serverId || resolveServerId(core));
      const context = resolveMatchContext(sid, modules, core, matchRuntime);
      if (!context.matchId) return;
      await service.handleMatchEnded({
        serverId: sid,
        matchId: context.matchId,
        endedAt,
      });
    },
  };

  return {
    manifest: {
      id: "module.squadLifecycle",
      name: "Squad Lifecycle Module",
      kind: "module",
      version: "0.1.0",
      description: "小队生命周期状态机模块。日志负责建队输入，RCON 快照负责缺失与解散确认，支持切图关闭与 squadId 复用 generation。",
    },
    apiName: "squadLifecycle",
    api,

    async start() {
      if (!moduleConfig.enabled) {
        moduleLogger.info?.("SquadLifecycle disabled.", {
          label: "MODULE",
          operation: "start",
        });
        return;
      }

      unsubscribers.push(core.eventBus.onCoreEvent("On_SquadCreated", (event) => {
        void logAdapter.onCoreSquadCreatedEvent(event);
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("SQUAD_CREATED", (event) => {
        void logAdapter.onCoreSquadCreatedEvent(event);
      }));

      for (const eventName of MATCH_END_EVENTS) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, () => {
          const serverId = resolveServerId(core);
          const context = resolveMatchContext(serverId, modules, core, matchRuntime);
          if (!context.matchId) return;

          matchRuntime.matchChangingUntil = Date.now() + moduleConfig.matchChangingGraceMs;
          void service.handleMatchEnded({
            serverId,
            matchId: context.matchId,
            endedAt: Date.now(),
          });
        }));
      }

      poller.start();

      moduleLogger.info?.("SquadLifecycle started.", {
        label: "MODULE",
        operation: "start",
        data: {
          rconPollIntervalMs: moduleConfig.rconPollIntervalMs,
          rconTimeoutMs: moduleConfig.rconTimeoutMs,
          missingConfirmCount: moduleConfig.missingConfirmCount,
        },
      });
    },

    async stop() {
      poller.stop();
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();

      if (moduleConfig.closeSquadsOnMatchEnd) {
        const serverId = resolveServerId(core);
        const context = resolveMatchContext(serverId, modules, core, matchRuntime);
        if (context.matchId) {
          await service.handleMatchEnded({
            serverId,
            matchId: context.matchId,
            endedAt: Date.now(),
          });
        }
      }

      moduleLogger.info?.("SquadLifecycle stopped.", {
        label: "MODULE",
        operation: "stop",
      });
    },
  };
}

function resolveServerId(core) {
  const id = String(core?.webStatus?.serverId ?? "").trim();
  if (id) return id;
  return String(core?.config?.get?.("server.id", "BZSS_Main") ?? "BZSS_Main");
}

function resolveMatchContext(serverId, modules, core, matchRuntime) {
  const now = Date.now();
  const snapshot = modules?.matchState?.getState?.() ?? {};
  const status = snapshot.serverStatus ?? core?.webStatus?.getSnapshot?.() ?? {};

  const map = String(status.map ?? "").trim();
  const layer = String(status.layer ?? "").trim();
  const layerKey = layer || map || "unknown";

  const playtimeRaw = Number(status.playtime);
  const playtime = Number.isFinite(playtimeRaw) && playtimeRaw >= 0 ? playtimeRaw : null;

  let runtime = matchRuntime.byServer.get(serverId);

  if (!runtime) {
    const anchor = playtime == null ? now : Math.max(0, now - (playtime * 1000));
    runtime = {
      map,
      layer,
      layerKey,
      playtime,
      startAnchorMs: anchor,
    };
    matchRuntime.byServer.set(serverId, runtime);
  } else {
    const layerChanged = layerKey && runtime.layerKey && layerKey !== runtime.layerKey;
    const playtimeReset = playtime != null && runtime.playtime != null && playtime + 30 < runtime.playtime;

    if (layerChanged || playtimeReset) {
      runtime.startAnchorMs = playtime == null ? now : Math.max(0, now - (playtime * 1000));
    }

    runtime.map = map;
    runtime.layer = layer;
    runtime.layerKey = layerKey;
    runtime.playtime = playtime;
  }

  const matchId = `${serverId}:${layerKey}:${Math.floor(runtime.startAnchorMs / 1000)}`;
  const playerCount = Number(status.playerCount);

  return {
    matchId,
    map,
    layer,
    playtime,
    playerCount: Number.isFinite(playerCount) ? playerCount : null,
    isMatchChanging: Date.now() < matchRuntime.matchChangingUntil,
  };
}
