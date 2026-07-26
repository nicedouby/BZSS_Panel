// -*- coding: utf-8 -*-

import { TeamBalanceBatchManager } from "./batch-manager.js";
import {
  canSendRconCommand,
  hasPermission,
  resolveRconPermission,
} from "../../../web-client/src/shared/rcon-permissions.js";

const MODULE_ID = "module.teamBalance";
const DEFAULT_SOURCE = "manual";
const DEFAULT_REASON = "manual_team_balance";
const DEFAULT_SHUFFLE_SOURCE = "web.matchStatus.shufflePlan";
const DEFAULT_SHUFFLE_REASON = "match_status_playtime_shuffle_plan";
const DEFAULT_SWITCH_PERMISSION = "squad.switch";
const MAX_ACTION_HISTORY = 100;
const SHUFFLE_ALGORITHMS = new Set(["playtime_balanced", "random_even", "mirror"]);
const SHUFFLE_PLAN_TTL_MS = 10 * 60 * 1000;

export function createTeamBalanceService({ core, modules, config, logger }) {
  const moduleLogger = logger
    ?? core.createLogger?.({
      moduleId: MODULE_ID,
      source: MODULE_ID,
      channel: "module",
    })
    ?? core.logger;

  const moduleConfig = config?.get?.("modules.teamBalance", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const switchPermission = String(moduleConfig.switchPermission ?? DEFAULT_SWITCH_PERMISSION).trim() || DEFAULT_SWITCH_PERMISSION;
  const actionHistory = [];
  const shufflePlans = new Map();
  const unsubscribers = [];
  const batchManager = new TeamBalanceBatchManager({
    executeOnePlayer: (player) => forceTeamChange(player),
    resolveCurrentPlayer,
    canContinue: canContinueBatch,
    recordAudit: recordBatchAudit,
    logger: moduleLogger,
  });

  const api = {
    forceTeamChange(request = {}) {
      return forceTeamChange(request);
    },

    requestSwitchTeam(request = {}) {
      return forceTeamChange(request);
    },

    switchTeam(request = {}) {
      return forceTeamChange(request);
    },

    createPlaytimeShufflePlan(request = {}) {
      return createPlaytimeShufflePlan(request);
    },

    executeShufflePlan(request = {}) {
      return executeShufflePlan(request);
    },

    listForceTeamChangeRecords(request = {}) {
      return listForceTeamChangeRecords(request);
    },

    createForceTeamChangeBatch(request = {}) {
      return createForceTeamChangeBatch(request);
    },

    listForceTeamChangeBatches() {
      return batchManager.list();
    },

    getForceTeamChangeBatch(batchId) {
      return batchManager.get(batchId);
    },

    cancelForceTeamChangeBatch(batchId) {
      return batchManager.cancel(batchId);
    },

    getConfig() {
      return {
        enabled,
        switchPermission,
      };
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Team Balance Module",
      kind: "module",
      version: "0.2.0",
      description: "Single gateway for force team change actions.",
    },
    apiName: "teamBalance",
    api,

    async init() {},

    async start() {
      if (core.eventBus?.onModuleEvent) {
        unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "updated", handleMatchStateEvent));
      }
      if (core.eventBus?.onCoreEvent) {
        unsubscribers.push(core.eventBus.onCoreEvent("RCON_MATCH_STATE_UPDATED", handleMatchStateEvent));
      }

      moduleLogger?.info?.("TeamBalance module started.", {
        operation: "start",
        data: {
          enabled,
          switchPermission,
        },
      });
    },

    async stop() {
      batchManager.cancelActiveByType("shuffle", "module_stopped");
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe?.();
        } catch {}
      }
      shufflePlans.clear();
    },
  };

  function createForceTeamChangeBatch(request = {}) {
    const operator = normalizeOperator(
      request.operator ?? request.actor ?? request.viewer ?? null,
      request.operatorName ?? request.actorName ?? "",
    );
    const source = normalizeText(request.source) || "web.matchStatus.batch";
    const reason = normalizeText(request.reason) || "manual_batch_team_balance";

    if (!enabled) {
      return { ok: false, error: "ModuleDisabled", message: "TeamBalance module is disabled." };
    }
    if (!canSwitch(operator, { switchPermission })) {
      return { ok: false, error: "Forbidden", message: `Permission '${switchPermission}' is required.` };
    }

    return batchManager.create({
      ...request,
      source,
      reason,
      operator,
    });
  }

  async function forceTeamChange(request = {}) {
    const operator = normalizeOperator(
      request.operator ?? request.actor ?? request.viewer ?? null,
      request.operatorName ?? request.actorName ?? "",
    );
    const source = normalizeText(request.source) || DEFAULT_SOURCE;
    const reason = normalizeText(request.reason) || DEFAULT_REASON;
    const steamId = normalizeText(request.steamId ?? request.steamID ?? request.anyId ?? request.playerKey ?? request.playerId ?? "");
    const playerName = normalizeText(request.playerName ?? request.name ?? "");
    const system = Boolean(request.system);
    const command = buildForceTeamChangeCommand(steamId);

    if (!enabled) {
      const result = buildResult({
        ok: false,
        error: "ModuleDisabled",
        message: "TeamBalance module is disabled.",
        command,
        steamId,
        playerName,
        source,
        reason,
        operator,
        system,
        batchId: request.batchId ?? "",
      });
      recordAction(result);
      return result;
    }

    if (!steamId) {
      const result = buildResult({
        ok: false,
        error: "MissingSteamId",
        message: "steamId is required.",
        command,
        steamId,
        playerName,
        source,
        reason,
        operator,
        system,
      });
      recordAction(result);
      return result;
    }

    if (!system && !canSwitch(operator, { switchPermission })) {
      const result = buildResult({
        ok: false,
        error: "Forbidden",
        message: `Permission '${switchPermission}' is required.`,
        command,
        steamId,
        playerName,
        source,
        reason,
        operator,
        system,
      });
      recordAction(result);
      return result;
    }

    try {
      const response = await executeForceTeamChangeCommand({
        command,
        source,
        reason,
        operator,
        system,
        priority: request.priority,
        batchId: request.batchId ?? "",
      });

      const result = buildResult({
        ok: response.ok,
        error: response.ok ? "" : response.error,
        message: response.ok ? "Team switch requested." : (response.error || "RCON command failed."),
        command,
        rconExecuted: response.executed,
        rconResponse: response.response,
        steamId,
        playerName,
        source,
        reason,
        operator,
        system,
      });

      recordAction(result);
      return result;
    } catch (error) {
      const errorMessage = String(error?.message ?? error);
      const result = buildResult({
        ok: false,
        error: "RCON_FAILED",
        message: errorMessage,
        command,
        steamId,
        playerName,
        source,
        reason,
        operator,
        system,
      });
      recordAction(result);
      return result;
    }
  }

  async function createPlaytimeShufflePlan(request = {}) {
    const operator = normalizeOperator(
      request.operator ?? request.actor ?? request.viewer ?? null,
      request.operatorName ?? request.actorName ?? "",
    );
    const source = normalizeText(request.source) || DEFAULT_SHUFFLE_SOURCE;
    const reason = normalizeText(request.reason) || DEFAULT_SHUFFLE_REASON;
    const system = Boolean(request.system);
    const algorithm = normalizeShuffleAlgorithm(request.algorithm ?? request.mode);
    const roster = normalizeShuffleRoster(request.players ?? request.roster);
    const rawGroups = Array.isArray(request.groups)
      ? request.groups
      : typeof core.groupReport?.getShuffleGroups === "function"
        ? core.groupReport.getShuffleGroups()
        : typeof core.groupReport?.getGroups === "function"
          ? core.groupReport.getGroups()
          : [];
    const shuffleGroups = normalizeShuffleGroups(rawGroups, roster);

    if (!enabled) {
      const result = buildShufflePlanResult({
        ok: false,
        error: "ModuleDisabled",
        message: "TeamBalance module is disabled.",
        source,
        reason,
        operator,
        system,
      });
      recordAction(result);
      return result;
    }

    if (!system && !canSwitch(operator, { switchPermission })) {
      const result = buildShufflePlanResult({
        ok: false,
        error: "Forbidden",
        message: `Permission '${switchPermission}' is required.`,
        source,
        reason,
        operator,
        system,
      });
      recordAction(result);
      return result;
    }

    if (roster.length === 0) {
      const result = buildShufflePlanResult({
        ok: false,
        error: "EmptyRoster",
        message: "No eligible players were provided for shuffle planning.",
        source,
        reason,
        operator,
        system,
      });
      recordAction(result);
      return result;
    }

    const teamIds = [...new Set(roster.map((player) => player.teamId))];
    if (!teamIds.includes(1) || !teamIds.includes(2)) {
      const result = buildShufflePlanResult({
        ok: false,
        error: "MissingTeamRoster",
        message: "Both team 1 and team 2 players are required.",
        source,
        reason,
        operator,
        system,
      });
      recordAction(result);
      return result;
    }

    const gate = getShuffleGate();
    if (!gate.ok) {
      const result = buildShufflePlanResult({
        ok: false,
        error: "ShuffleUnavailable",
        message: gate.message,
        source,
        reason,
        operator,
        system,
        algorithm,
      });
      recordAction(result);
      return result;
    }

    const planId = `shuffle-plan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const roundKey = gate.roundKey;
    const generatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SHUFFLE_PLAN_TTL_MS).toISOString();
    const plan = buildPlaytimeShufflePlanWithGroups(roster, shuffleGroups, algorithm);
    plan.plan = {
      ...plan.plan,
      planId,
      roundKey,
      generatedAt,
      expiresAt,
      executedAt: null,
    };
    shufflePlans.set(planId, {
      planId,
      roundKey,
      expiresAt,
      executedAt: null,
      executedBatchId: "",
      plan: plan.plan,
    });

    const result = buildShufflePlanResult({
      ok: true,
      error: "",
      message: "Playtime-balanced shuffle plan recorded. No team switch executed.",
      source,
      reason,
      operator,
      system,
      algorithm,
      summary: plan.summary,
      plan: plan.plan,
    });
    recordAction(result);
    return result;
  }

  async function executeShufflePlan(request = {}) {
    const operator = normalizeOperator(
      request.operator ?? request.actor ?? request.viewer ?? null,
      request.operatorName ?? request.actorName ?? "",
    );
    const source = normalizeText(request.source) || "web.teamShuffle";
    const reason = normalizeText(request.reason) || "team_shuffle_execute";
    const system = Boolean(request.system);
    const algorithm = normalizeShuffleAlgorithm(request.algorithm ?? request.mode);
    const planId = normalizeText(request.planId);
    const planEntry = planId ? shufflePlans.get(planId) : null;

    if (!enabled) {
      return buildShuffleExecuteResult({
        ok: false,
        error: "ModuleDisabled",
        message: "TeamBalance module is disabled.",
        source,
        reason,
        operator,
        system,
        algorithm,
        planId,
      });
    }

    if (!system && !canSwitch(operator, { switchPermission })) {
      return buildShuffleExecuteResult({
        ok: false,
        error: "Forbidden",
        message: `Permission '${switchPermission}' is required.`,
        source,
        reason,
        operator,
        system,
        algorithm,
        planId,
      });
    }

    if (!planId || !planEntry) {
      return buildShuffleExecuteResult({
        ok: false,
        error: "UnknownShufflePlan",
        message: "The shuffle plan is missing or has expired.",
        source,
        reason,
        operator,
        system,
        algorithm,
        planId,
      });
    }

    if (planEntry.executedBatchId) {
      return buildShuffleExecuteResult({
        ok: true,
        duplicate: true,
        accepted: true,
        message: "This shuffle plan has already been submitted.",
        source,
        reason,
        operator,
        system,
        algorithm,
        planId,
        roundKey: planEntry.roundKey,
        batch: batchManager.get(planEntry.executedBatchId),
      });
    }

    if (Date.parse(planEntry.expiresAt) <= Date.now()) {
      return buildShuffleExecuteResult({
        ok: false,
        error: "ShufflePlanExpired",
        message: "The shuffle plan has expired.",
        source,
        reason,
        operator,
        system,
        algorithm,
        planId,
      });
    }

    const gate = getShuffleGate();
    if (!gate.ok || gate.roundKey !== planEntry.roundKey) {
      return buildShuffleExecuteResult({
        ok: false,
        error: "ShuffleUnavailable",
        message: gate.ok ? "The shuffle plan belongs to another round." : gate.message,
        source,
        reason,
        operator,
        system,
        algorithm,
        planId,
        roundKey: gate.roundKey,
      });
    }

    const active = batchManager.findActive({ type: "shuffle", roundKey: planEntry.roundKey });
    if (active) {
      return buildShuffleExecuteResult({
        ok: false,
        error: "ShuffleAlreadyRunning",
        message: "A shuffle task is already running for this round.",
        source,
        reason,
        operator,
        system,
        algorithm,
        planId,
        roundKey: planEntry.roundKey,
        batch: active,
      });
    }

    const roster = normalizeShuffleRoster(request.players ?? request.roster);
    const moves = interleaveShuffleMoves(
      roster
        .map((player) => ({
          ...player,
          targetTeamId: normalizeTeamId(player.targetTeamId ?? player.targetTeamID),
        }))
        .filter((player) => (
          player.steamId
          && player.targetTeamId != null
          && player.teamId !== player.targetTeamId
          && player.online !== false
        )),
    );

    if (!moves.length) {
      return buildShuffleExecuteResult({
        ok: true,
        message: "No team switches were required.",
        source,
        reason,
        operator,
        system,
        algorithm,
        planId,
        roundKey: planEntry.roundKey,
        batch: null,
      });
    }

    const created = batchManager.create({
      clientRequestId: normalizeText(request.clientRequestId) || `shuffle:${planId}`,
      type: "shuffle",
      planId,
      roundKey: planEntry.roundKey,
      source,
      reason,
      operator,
      players: moves.map((move) => ({
        playerId: move.playerId,
        steamId: move.steamId,
        playerName: move.playerName,
        fromTeamId: move.teamId,
        targetTeamId: move.targetTeamId,
      })),
    });

    if (!created.ok) {
      return buildShuffleExecuteResult({
        ok: false,
        error: created.error || "BatchCreateFailed",
        message: created.message || "Failed to create shuffle batch.",
        source,
        reason,
        operator,
        system,
        algorithm,
        planId,
        roundKey: planEntry.roundKey,
      });
    }

    planEntry.executedBatchId = created.batch.id;
    planEntry.executedAt = new Date().toISOString();

    return buildShuffleExecuteResult({
      ok: true,
      accepted: true,
      duplicate: Boolean(created.duplicate),
      message: created.duplicate ? "This shuffle plan has already been submitted." : "Shuffle batch queued.",
      source,
      reason,
      operator,
      system,
      algorithm,
      planId,
      roundKey: planEntry.roundKey,
      batch: created.batch,
    });
  }

  function listForceTeamChangeRecords(request = {}) {
    const limit = clampInteger(request.limit ?? request.count ?? 50, 1, MAX_ACTION_HISTORY);
    return actionHistory.slice(0, limit);
  }

  async function executeForceTeamChangeCommand({ command, source, reason, operator, system, priority = false, batchId = "" }) {
    const requiredPermission = resolveRconPermission(command, { requiredPermission: "rcon.tb" });
    if (!system && !canSendRconCommand(operator, command, { requiredPermission })) {
      return {
        ok: false,
        executed: false,
        response: "",
        error: `Permission '${requiredPermission}' is required.`,
      };
    }

    if (typeof core.rconManager?.dispatchCommand === "function") {
      const response = await core.rconManager.dispatchCommand({
        command,
        requestedBy: `${MODULE_ID}:${normalizeText(operator?.name ?? operator?.username ?? "system") || "system"}`,
        reason: reason || source || DEFAULT_REASON,
        system,
        actor: operator,
        requiredPermission,
        priority: requestPriority({ priority }),
        batchId,
      });
      return normalizeDispatchResponse(response);
    }

    if (typeof core.rcon?.execute === "function") {
      const response = await core.rcon.execute(command);
      return {
        ok: true,
        executed: true,
        response: String(response ?? ""),
        error: "",
      };
    }

    throw new Error("No RCON executor is available.");
  }

  function getCurrentMatchContext() {
    const state = modules?.matchState?.api?.getState?.() ?? {};
    const serverId = normalizeText(
      state?.serverId
      ?? core?.webStatus?.serverId
      ?? core?.webStatus?.getSnapshot?.()?.serverId
      ?? "",
    );
    const round = state?.round?.current ?? {};
    const roundAnchor = [
      round?.worldPath,
      round?.serverPlayAt,
      round?.logLineTime,
      round?.receivedAt,
      state?.round?.lastAcceptedAt,
    ].map(normalizeText).find(Boolean) || "no-round";
    const map = normalizeText(state?.match?.map ?? state?.serverStatus?.map);
    const layer = normalizeText(state?.match?.layer ?? state?.serverStatus?.layer);
    const phase = normalizeText(state?.match?.phase).toLowerCase() || "unknown";
    const rawPlaytime = state?.match?.playtime ?? state?.serverStatus?.playtime;
    const playtime = Number(rawPlaytime);
    return {
      state,
      serverId,
      phase,
      playtime,
      roundKey: [serverId, map, layer, roundAnchor].join("|"),
    };
  }

  function getShuffleGate() {
    const context = getCurrentMatchContext();
    if (!context.serverId || context.roundKey.endsWith("|no-round")) {
      return { ok: false, reason: "round_unavailable", roundKey: context.roundKey, message: "当前没有可识别的对局。" };
    }
    if (context.phase !== "warmup") {
      return { ok: false, reason: "match_started", roundKey: context.roundKey, message: "对局已经开始，不能执行随机打乱。" };
    }
    if (Number.isFinite(context.playtime) && context.playtime > 0) {
      return { ok: false, reason: "match_started", roundKey: context.roundKey, message: "对局已经开始，不能执行随机打乱。" };
    }
    return { ok: true, roundKey: context.roundKey };
  }

  async function canContinueBatch(batch) {
    if (batch?.type !== "shuffle") return { ok: true };
    const gate = getShuffleGate();
    if (!gate.ok) return gate;
    if (batch.roundKey && gate.roundKey !== batch.roundKey) {
      return {
        ok: false,
        reason: "round_changed",
        message: "对局已切换。",
      };
    }
    return { ok: true };
  }

  function handleMatchStateEvent(event = {}) {
    const context = event?.matchState
      ? {
          ...getCurrentMatchContext(),
          state: event.matchState,
          phase: normalizeText(event.matchState?.match?.phase).toLowerCase() || "unknown",
          playtime: Number(event.matchState?.match?.playtime ?? event.matchState?.serverStatus?.playtime),
        }
      : getCurrentMatchContext();

    if (context.phase !== "warmup" || (Number.isFinite(context.playtime) && context.playtime > 0)) {
      batchManager.cancelActiveByType("shuffle", "match_started");
      return;
    }

    if (event?.eventName === "module.matchState.roundUpdated") {
      batchManager.cancelActiveByType("shuffle", "round_changed");
    }
  }

  function interleaveShuffleMoves(moves) {
    const t1ToT2 = moves.filter((move) => move.teamId === 1 && move.targetTeamId === 2);
    const t2ToT1 = moves.filter((move) => move.teamId === 2 && move.targetTeamId === 1);
    const ordered = [];
    const count = Math.max(t1ToT2.length, t2ToT1.length);
    for (let index = 0; index < count; index += 1) {
      if (t1ToT2[index]) ordered.push(t1ToT2[index]);
      if (t2ToT1[index]) ordered.push(t2ToT1[index]);
    }
    return ordered;
  }

  async function resolveCurrentPlayer(player) {
    const serverId = normalizeText(
      core?.webStatus?.serverId
      ?? core?.webStatus?.state?.serverId
      ?? modules?.matchState?.api?.getState?.()?.serverId
      ?? "",
    );
    const playerState = modules?.playerState?.api;
    if (typeof playerState?.getPlayerBySteamID === "function") {
      return playerState.getPlayerBySteamID(serverId, player.steamId);
    }

    const matchState = modules?.matchState?.api?.getState?.();
    const players = Array.isArray(matchState?.players?.list) ? matchState.players.list : [];
    return players.find((candidate) => normalizeText(candidate?.steamID ?? candidate?.steamId).toLowerCase() === normalizeText(player.steamId).toLowerCase()) ?? null;
  }

  async function recordBatchAudit(record) {
    const audit = modules?.audit?.api;
    if (typeof audit?.record !== "function") return;
    await audit.record({
      ...record,
      actorId: record.actor?.id ?? record.actor?.username ?? "",
      actorName: record.actor?.name ?? record.actor?.username ?? "",
      serverId: core?.webStatus?.serverId ?? "",
    });
  }

  function recordAction(result) {
    const entry = {
      id: `${Date.now()}-${actionHistory.length + 1}`,
      timestamp: new Date().toISOString(),
      type: normalizeText(result.type).toUpperCase() || "UNKNOWN_ACTION",
      action: normalizeText(result.action) || "unknown_action",
      ok: result.ok,
      steamId: result.steamId || "",
      playerName: result.playerName || null,
      source: result.source,
      reason: result.reason,
      executor: formatExecutor(result.operator),
      executorId: result.operator?.id || "",
      operator: result.operator,
      command: result.command,
      rconExecuted: result.rconExecuted,
      rconResponse: result.rconResponse,
      error: result.error,
      message: result.message,
      summary: result.summary ?? null,
      plan: result.plan ?? null,
    };

    actionHistory.unshift(entry);
    if (actionHistory.length > MAX_ACTION_HISTORY) {
      actionHistory.length = MAX_ACTION_HISTORY;
    }

    if (result.ok) {
      moduleLogger?.info?.(`[TB] ${entry.type}`, entry);
      return;
    }

    moduleLogger?.warn?.(`[TB] ${entry.type}_FAILED`, entry);
  }
}

function buildResult({
  ok,
  error = "",
  message = "",
  command = "",
  rconExecuted = false,
  rconResponse = "",
  steamId = "",
  playerName = "",
  source = DEFAULT_SOURCE,
  reason = DEFAULT_REASON,
  operator = null,
  system = false,
}) {
  return {
    ok: Boolean(ok),
    type: "force_team_change",
    action: "force_team_change",
    steamId,
    playerName,
    source,
    reason,
    executor: formatExecutor(operator),
    operator,
    system: Boolean(system),
    error,
    message,
    command,
    rconExecuted: Boolean(rconExecuted),
    rconResponse,
  };
}

function buildShufflePlanResult({
  ok,
  error = "",
  message = "",
  source = DEFAULT_SHUFFLE_SOURCE,
  reason = DEFAULT_SHUFFLE_REASON,
  operator = null,
  system = false,
  algorithm = "playtime_balanced",
  summary = null,
  plan = null,
}) {
  return {
    ok: Boolean(ok),
    type: "playtime_shuffle_plan",
    action: "playtime_shuffle_plan",
    steamId: "",
    playerName: "",
    source,
    reason,
    executor: formatExecutor(operator),
    operator,
    system: Boolean(system),
    algorithm,
    error,
    message,
    command: "",
    rconExecuted: false,
    rconResponse: "",
    summary,
    plan,
  };
}

function buildShuffleExecuteResult({
  ok,
  error = "",
  message = "",
  source = "web.teamShuffle",
  reason = "team_shuffle_execute",
  operator = null,
  system = false,
  algorithm = "playtime_balanced",
  executed = [],
  failed = [],
  accepted = false,
  duplicate = false,
  planId = "",
  roundKey = "",
  batch = null,
}) {
  return {
    ok: Boolean(ok),
    type: "shuffle_execute",
    action: "shuffle_execute",
    steamId: "",
    playerName: "",
    source,
    reason,
    executor: formatExecutor(operator),
    operator,
    system: Boolean(system),
    algorithm,
    error,
    message,
    accepted: Boolean(accepted),
    duplicate: Boolean(duplicate),
    planId,
    roundKey,
    batch,
    command: "",
    rconExecuted: executed.length > 0,
    rconResponse: "",
    summary: {
      plannedMoveCount: executed.length + failed.length,
      executedCount: executed.length,
      failedCount: failed.length,
    },
    plan: {
      generatedAt: new Date().toISOString(),
      mode: algorithm,
      moves: [...executed, ...failed],
      executed,
      failed,
    },
  };
}

function buildForceTeamChangeCommand(steamId) {
  return `AdminForceTeamChange "${escapeCommandString(steamId)}"`;
}

function canSwitch(viewer, config = {}) {
  if (!viewer) return false;
  if (viewer.isSuperAdmin) return true;
  const permissions = normalizePermissionList(viewer.permissions ?? viewer.permission);
  return hasPermission(permissions, config.switchPermission || DEFAULT_SWITCH_PERMISSION);
}

function requestPriority(request) {
  return request?.priority === "high" ? "high" : false;
}

function normalizeDispatchResponse(response) {
  if (response && typeof response === "object") {
    return {
      ok: Boolean(response.ok ?? response.success ?? true),
      executed: Boolean(response.executed ?? response.rconExecuted ?? response.success ?? true),
      response: String(response.response ?? response.rconResponse ?? response.message ?? ""),
      error: String(response.error ?? response.message ?? ""),
    };
  }

  return {
    ok: true,
    executed: true,
    response: String(response ?? ""),
    error: "",
  };
}

function normalizeOperator(operator, fallbackName = "") {
  if (operator && typeof operator === "object") {
    return {
      id: normalizeText(operator.id ?? operator.userId ?? operator.username ?? ""),
      name: normalizeText(operator.name ?? operator.username ?? fallbackName),
      username: normalizeText(operator.username ?? operator.name ?? fallbackName),
      role: normalizeText(operator.role ?? ""),
      isSuperAdmin: Boolean(operator.isSuperAdmin),
      permissions: normalizePermissionList(operator.permissions ?? operator.permission),
    };
  }

  const name = normalizeText(fallbackName);
  if (!name) return null;
  return {
    id: "",
    name,
    username: name,
    role: "",
    isSuperAdmin: false,
    permissions: [],
  };
}

function normalizePermissionList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => normalizeText(entry)).filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([entry]) => normalizeText(entry))
      .filter(Boolean);
  }
  return [];
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeShuffleAlgorithm(value) {
  const text = normalizeText(value);
  return SHUFFLE_ALGORITHMS.has(text) ? text : "playtime_balanced";
}

function formatExecutor(operator) {
  if (!operator) return "system";
  return normalizeText(operator.name || operator.username || operator.id || "system") || "system";
}

function clampInteger(value, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(Math.max(parsed, min), max);
}

function escapeCommandString(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function normalizeShuffleRoster(players) {
  if (!Array.isArray(players)) return [];
  return players
    .map((player, index) => normalizeShufflePlayer(player, index))
    .filter(Boolean);
}

function normalizeShuffleGroups(groups, players) {
  if (!Array.isArray(groups) || !groups.length) return [];
  const playerMap = new Map();
  for (const player of Array.isArray(players) ? players : []) {
    const steamId = normalizeText(player?.steamId ?? player?.steamID);
    const eosId = normalizeText(player?.eosId ?? player?.eosID);
    const playerId = normalizeText(player?.playerId ?? player?.playerID);
    if (steamId) playerMap.set(`steam:${steamId}`, player);
    if (eosId) playerMap.set(`eos:${eosId}`, player);
    if (playerId) playerMap.set(`pid:${playerId}`, player);
  }

  return groups
    .map((group, index) => normalizeShuffleGroup(group, index, playerMap))
    .filter((group) => group && group.members.length > 0 && group.anchorPlayerKey);
}

function normalizeShuffleGroup(group, index, playerMap) {
  const members = Array.isArray(group?.members)
    ? group.members
      .map((member) => normalizeShuffleGroupMember(member, playerMap))
      .filter(Boolean)
    : [];
  const memberKeys = new Set(members.map((member) => member.playerKey));
  const anchorPlayerKey = normalizeText(group?.anchorPlayerKey);
  const normalizedAnchor = memberKeys.has(anchorPlayerKey) ? anchorPlayerKey : members[0]?.playerKey || "";
  if (!normalizedAnchor || members.length === 0) return null;
  return {
    index,
    id: normalizeText(group?.id) || `group-${index + 1}`,
    name: normalizeText(group?.name) || `Group ${index + 1}`,
    color: normalizeColorValue(group?.color),
    anchorPlayerKey: normalizedAnchor,
    members,
  };
}

function normalizeShuffleGroupMember(member, playerMap) {
  const playerKey = normalizeText(member?.playerKey);
  const linked = playerMap.get(playerKey)
    ?? playerMap.get(`steam:${normalizeText(member?.steamId)}`)
    ?? playerMap.get(`eos:${normalizeText(member?.eosId)}`)
    ?? playerMap.get(`pid:${normalizeText(member?.playerId)}`);
  if (!playerKey || !linked) return null;
  return {
    playerKey,
    steamId: normalizeText(member?.steamId ?? linked?.steamId ?? linked?.steamID),
    eosId: normalizeText(member?.eosId ?? linked?.eosId ?? linked?.eosID),
  };
}

function normalizeColorValue(value) {
  const text = normalizeText(value);
  return /^#[0-9A-Fa-f]{6}$/.test(text) ? text.toUpperCase() : "";
}

function normalizeShufflePlayer(player, index) {
  const teamId = normalizeTeamId(player?.teamId ?? player?.teamID);
  if (teamId == null) return null;

  const playtimeSeconds = normalizePlaytimeSeconds(
    player?.playtimeSeconds ?? player?.gameSeconds ?? player?.playtime?.gameSeconds,
  );

  return {
    index,
    playerId: normalizeText(player?.playerId ?? player?.playerID ?? ""),
    steamId: normalizeText(player?.steamId ?? player?.steamID ?? ""),
    eosId: normalizeText(player?.eosId ?? player?.eosID ?? ""),
    playerName: normalizeText(player?.playerName ?? player?.name ?? "") || "Unknown",
    teamId,
    squadId: normalizeNullableInteger(player?.squadId ?? player?.squadID),
    role: normalizeText(player?.role ?? ""),
    online: player?.online !== false,
    playtimeSeconds,
    playtimeHours: toRoundedHours(playtimeSeconds),
    targetTeamId: normalizeTeamId(player?.targetTeamId ?? player?.targetTeamID),
  };
}

function buildPlaytimeShufflePlan(players) {
  return buildPlaytimeShufflePlanWithGroups(players, []);
}

function buildPlaytimeShufflePlanWithGroups(players, groups = [], algorithm = "playtime_balanced") {
  if (algorithm === "random_even") return buildRandomEvenShufflePlan(players, groups, algorithm);
  if (algorithm === "mirror") return buildMirrorShufflePlan(players, groups, algorithm);

  const teamSizes = {
    1: players.filter((player) => player.teamId === 1).length,
    2: players.filter((player) => player.teamId === 2).length,
  };
  const groupedKeys = new Set();
  const validGroups = Array.isArray(groups) ? groups : [];
  for (const group of validGroups) {
    for (const member of group.members) groupedKeys.add(member.playerKey);
  }

  const ungroupedPlayers = players.filter((player) => !groupedKeys.has(resolveShufflePlayerKey(player)));
  const knownPlayers = ungroupedPlayers
    .filter((player) => Number.isFinite(player.playtimeSeconds))
    .sort(compareShufflePlayersByPlaytime);
  const unknownPlayers = ungroupedPlayers
    .filter((player) => !Number.isFinite(player.playtimeSeconds))
    .sort(compareShufflePlayersByName);

  // --- Phase 1: greedy LPT assignment (respects team size caps) ---
  const assigned = { 1: [], 2: [] };
  const knownTotals = { 1: 0, 2: 0 };

  for (const group of validGroups) {
    const assignment = assignGroupedPlayers(group, players, assigned, knownTotals, teamSizes);
    if (!assignment) continue;
  }

  for (const player of knownPlayers) {
    const targetTeamId = chooseKnownTargetTeam({ assigned, knownTotals, teamSizes });
    assigned[targetTeamId].push({ ...player, targetTeamId });
    knownTotals[targetTeamId] += Number(player.playtimeSeconds ?? 0);
  }

  // --- Phase 2: 2-opt swap improvement (fixed team sizes) ---
  improveKnownAssignment(assigned);

  // --- Phase 3: fill unknown players to maintain team sizes ---
  for (const player of unknownPlayers) {
    const targetTeamId = chooseUnknownTargetTeam({ assigned, teamSizes });
    assigned[targetTeamId].push({ ...player, targetTeamId });
  }

  const assignments = [...assigned[1], ...assigned[2]]
    .sort((left, right) => left.index - right.index)
    .map((player) => ({
      playerId: player.playerId || null,
      steamId: player.steamId || null,
      eosId: player.eosId || null,
      playerName: player.playerName,
      role: player.role || null,
      squadId: player.squadId,
      fromTeamId: player.teamId,
      targetTeamId: player.targetTeamId,
      playtimeSeconds: Number.isFinite(player.playtimeSeconds) ? player.playtimeSeconds : null,
      playtimeHours: toRoundedHours(player.playtimeSeconds),
      hasKnownPlaytime: Number.isFinite(player.playtimeSeconds),
      switchRequired: player.teamId !== player.targetTeamId,
      online: player.online !== false,
      groupId: player.groupId || null,
      groupName: player.groupName || null,
      groupColor: player.groupColor || null,
      anchorPlayerKey: player.anchorPlayerKey || null,
    }));

  const moves = assignments
    .filter((player) => player.switchRequired)
    .sort((left, right) => {
      const diff = Number(right.playtimeSeconds ?? -1) - Number(left.playtimeSeconds ?? -1);
      if (diff !== 0) return diff;
      return String(left.playerName).localeCompare(String(right.playerName), "zh-CN");
    });

  const before = buildTeamSummary(players, "teamId");
  const after = buildTeamSummary(assignments, "targetTeamId");
  const averageDeltaHours = roundHours(Math.abs(
    Number(after.team1.averagePlaytimeHours ?? 0) - Number(after.team2.averagePlaytimeHours ?? 0),
  ));

  return {
    summary: {
      totalPlayers: players.length,
      plannedMoveCount: moves.length,
      knownPlaytimePlayers: knownPlayers.length,
      unknownPlaytimePlayers: unknownPlayers.length,
      averageDeltaHours,
      before,
      after,
    },
    plan: {
      generatedAt: new Date().toISOString(),
      mode: algorithm,
      players: assignments,
      moves,
      groups: validGroups.map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color || null,
        anchorPlayerKey: group.anchorPlayerKey,
        memberCount: group.members.length,
      })),
    },
  };
}

function buildRandomEvenShufflePlan(players, groups = [], algorithm = "random_even") {
  const teamSizes = {
    1: players.filter((player) => player.teamId === 1).length,
    2: players.filter((player) => player.teamId === 2).length,
  };
  const groupedKeys = new Set();
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const member of group.members) groupedKeys.add(member.playerKey);
  }

  const assigned = { 1: [], 2: [] };
  for (const group of Array.isArray(groups) ? shuffleArray(groups) : []) {
    const members = group.members
      .map((member) => findRosterPlayer(players, member))
      .filter(Boolean);
    if (!members.length) continue;
    const preferred = assigned[1].length <= assigned[2].length ? 1 : 2;
    const fallback = preferred === 1 ? 2 : 1;
    const targetTeamId = teamSizes[preferred] - assigned[preferred].length >= members.length
      ? preferred
      : teamSizes[fallback] - assigned[fallback].length >= members.length
        ? fallback
        : null;
    if (!targetTeamId) continue;
    for (const player of members) {
      assigned[targetTeamId].push({
        ...player,
        targetTeamId,
        groupId: group.id,
        groupName: group.name,
        groupColor: group.color || "",
        anchorPlayerKey: group.anchorPlayerKey,
      });
    }
  }

  for (const player of shuffleArray(players.filter((player) => !groupedKeys.has(resolveShufflePlayerKey(player))))) {
    const targetTeamId = chooseUnknownTargetTeam({ assigned, teamSizes });
    assigned[targetTeamId].push({ ...player, targetTeamId });
  }

  return buildPlanFromAssigned(players, assigned, groups, algorithm);
}

function buildMirrorShufflePlan(players, groups = [], algorithm = "mirror") {
  const assigned = { 1: [], 2: [] };
  for (const player of players) {
    const targetTeamId = player.teamId === 1 ? 2 : 1;
    assigned[targetTeamId].push({ ...player, targetTeamId });
  }
  return buildPlanFromAssigned(players, assigned, groups, algorithm);
}

function buildPlanFromAssigned(players, assigned, groups, algorithm) {
  const assignments = [...assigned[1], ...assigned[2]]
    .sort((left, right) => left.index - right.index)
    .map((player) => ({
      playerId: player.playerId || null,
      steamId: player.steamId || null,
      eosId: player.eosId || null,
      playerName: player.playerName,
      role: player.role || null,
      squadId: player.squadId,
      fromTeamId: player.teamId,
      targetTeamId: player.targetTeamId,
      playtimeSeconds: Number.isFinite(player.playtimeSeconds) ? player.playtimeSeconds : null,
      playtimeHours: toRoundedHours(player.playtimeSeconds),
      hasKnownPlaytime: Number.isFinite(player.playtimeSeconds),
      switchRequired: player.teamId !== player.targetTeamId,
      online: player.online !== false,
      groupId: player.groupId || null,
      groupName: player.groupName || null,
      groupColor: player.groupColor || null,
      anchorPlayerKey: player.anchorPlayerKey || null,
    }));

  const moves = assignments
    .filter((player) => player.switchRequired)
    .sort((left, right) => String(left.playerName).localeCompare(String(right.playerName), "zh-CN"));
  const before = buildTeamSummary(players, "teamId");
  const after = buildTeamSummary(assignments, "targetTeamId");
  const averageDeltaHours = roundHours(Math.abs(
    Number(after.team1.averagePlaytimeHours ?? 0) - Number(after.team2.averagePlaytimeHours ?? 0),
  ));

  return {
    summary: {
      totalPlayers: players.length,
      plannedMoveCount: moves.length,
      knownPlaytimePlayers: players.filter((player) => Number.isFinite(player.playtimeSeconds)).length,
      unknownPlaytimePlayers: players.filter((player) => !Number.isFinite(player.playtimeSeconds)).length,
      averageDeltaHours,
      before,
      after,
    },
    plan: {
      generatedAt: new Date().toISOString(),
      mode: algorithm,
      players: assignments,
      moves,
      groups: (Array.isArray(groups) ? groups : []).map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color || null,
        anchorPlayerKey: group.anchorPlayerKey,
        memberCount: group.members.length,
      })),
    },
  };
}

function shuffleArray(values) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function assignGroupedPlayers(group, players, assigned, knownTotals, teamSizes) {
  const members = group.members
    .map((member) => findRosterPlayer(players, member))
    .filter(Boolean);
  if (!members.length) return null;

  const anchor = members.find((member) => resolveShufflePlayerKey(member) === group.anchorPlayerKey) ?? members[0];
  const targetTeamId = normalizeTeamId(anchor?.teamId);
  if (targetTeamId == null) return null;

  const otherTeamId = targetTeamId === 1 ? 2 : 1;
  const targetRemaining = teamSizes[targetTeamId] - assigned[targetTeamId].length;
  if (members.length > targetRemaining) return null;

  for (const player of members) {
    const playtimeSeconds = Number.isFinite(player.playtimeSeconds) ? Number(player.playtimeSeconds) : 0;
    assigned[targetTeamId].push({
      ...player,
      targetTeamId,
      groupId: group.id,
      groupName: group.name,
      groupColor: group.color || "",
      anchorPlayerKey: group.anchorPlayerKey,
    });
    if (Number.isFinite(player.playtimeSeconds)) {
      knownTotals[targetTeamId] += playtimeSeconds;
    }
  }

  return {
    targetTeamId,
    otherTeamId,
  };
}

function findRosterPlayer(players, member) {
  const steamId = normalizeText(member?.steamId);
  const eosId = normalizeText(member?.eosId);
  return players.find((player) => {
    if (steamId && normalizeText(player?.steamId) === steamId) return true;
    if (eosId && normalizeText(player?.eosId) === eosId) return true;
    return resolveShufflePlayerKey(player) === member.playerKey;
  }) ?? null;
}

function resolveShufflePlayerKey(player) {
  const eosId = normalizeText(player?.eosId ?? player?.eosID);
  if (eosId) return `eos:${eosId}`;
  const steamId = normalizeText(player?.steamId ?? player?.steamID);
  if (steamId) return `steam:${steamId}`;
  const playerId = normalizeText(player?.playerId ?? player?.playerID);
  if (playerId) return `pid:${playerId}`;
  return "";
}

/**
 * Iterative pairwise swap: try every (i in T1, j in T2) swap.
 * Accept the swap if it strictly reduces |total1 - total2|.
 * Repeat until no improvement is found (convergence).
 * Complexity: O(k^2) per pass, passes ≤ k, so O(k^3) worst-case
 * which is fine for k ≤ 100 players.
 */
function improveKnownAssignment(assigned) {
  let improved = true;
  while (improved) {
    improved = false;
    const t1 = assigned[1];
    const t2 = assigned[2];
    const total1 = t1.reduce((s, p) => s + Number(p.playtimeSeconds ?? 0), 0);
    const total2 = t2.reduce((s, p) => s + Number(p.playtimeSeconds ?? 0), 0);
    const current = calcImbalance(total1, total2);

    for (let i = 0; i < t1.length; i++) {
      for (let j = 0; j < t2.length; j++) {
        const s1 = Number(t1[i].playtimeSeconds ?? 0);
        const s2 = Number(t2[j].playtimeSeconds ?? 0);
        if (s1 === s2) continue; // swap has no effect
        const newTotal1 = total1 - s1 + s2;
        const newTotal2 = total2 - s2 + s1;
        if (calcImbalance(newTotal1, newTotal2) < current) {
          // Perform the swap
          const tmp = { ...t1[i], targetTeamId: 2 };
          t1[i] = { ...t2[j], targetTeamId: 1 };
          t2[j] = tmp;
          // Update assigned arrays in-place
          assigned[1] = t1;
          assigned[2] = t2;
          improved = true;
          // Restart the inner scan after a successful swap
          break;
        }
      }
      if (improved) break;
    }
  }
}

function calcImbalance(total1, total2) {
  return Math.abs(total1 - total2);
}

function buildTeamSummary(players, teamKey) {
  return {
    team1: buildSingleTeamSummary(players, teamKey, 1),
    team2: buildSingleTeamSummary(players, teamKey, 2),
  };
}

function buildSingleTeamSummary(players, teamKey, teamId) {
  const list = players.filter((player) => normalizeTeamId(player?.[teamKey]) === teamId);
  const known = list.filter((player) => Number.isFinite(player.playtimeSeconds));
  const totalPlaytimeSeconds = known.reduce((sum, player) => sum + Number(player.playtimeSeconds ?? 0), 0);
  return {
    teamId,
    playerCount: list.length,
    knownPlaytimePlayers: known.length,
    unknownPlaytimePlayers: list.length - known.length,
    totalPlaytimeSeconds,
    averagePlaytimeHours: known.length > 0 ? roundHours(totalPlaytimeSeconds / known.length / 3600) : null,
  };
}

function chooseKnownTargetTeam({ assigned, knownTotals, teamSizes }) {
  const team1Full = assigned[1].length >= teamSizes[1];
  const team2Full = assigned[2].length >= teamSizes[2];
  if (team1Full && !team2Full) return 2;
  if (team2Full && !team1Full) return 1;
  if (knownTotals[1] < knownTotals[2]) return 1;
  if (knownTotals[2] < knownTotals[1]) return 2;
  if (assigned[1].length < assigned[2].length) return 1;
  if (assigned[2].length < assigned[1].length) return 2;
  return 1;
}

function chooseUnknownTargetTeam({ assigned, teamSizes }) {
  const team1Remaining = teamSizes[1] - assigned[1].length;
  const team2Remaining = teamSizes[2] - assigned[2].length;
  if (team1Remaining <= 0 && team2Remaining > 0) return 2;
  if (team2Remaining <= 0 && team1Remaining > 0) return 1;
  if (assigned[1].length < assigned[2].length) return 1;
  if (assigned[2].length < assigned[1].length) return 2;
  if (team1Remaining > team2Remaining) return 1;
  if (team2Remaining > team1Remaining) return 2;
  return 1;
}

function compareShufflePlayersByPlaytime(left, right) {
  const secondsDiff = Number(right.playtimeSeconds ?? -1) - Number(left.playtimeSeconds ?? -1);
  if (secondsDiff !== 0) return secondsDiff;
  return compareShufflePlayersByName(left, right);
}

function compareShufflePlayersByName(left, right) {
  return String(left.playerName ?? "").localeCompare(String(right.playerName ?? ""), "zh-CN");
}

function normalizeTeamId(value) {
  const numeric = Number(value);
  if (numeric === 1 || numeric === 2) return numeric;
  return null;
}

function normalizePlaytimeSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0) return null;
  return Math.round(numeric);
}

function normalizeNullableInteger(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function toRoundedHours(seconds) {
  if (!Number.isFinite(seconds)) return null;
  return roundHours(Number(seconds) / 3600);
}

function roundHours(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(Number(value) * 10) / 10;
}
