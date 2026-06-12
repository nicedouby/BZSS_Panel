// -*- coding: utf-8 -*-

import {
  canSendRconCommand,
  hasPermission,
  resolveRconPermission,
} from "../../web-client/src/shared/rcon-permissions.js";

const MODULE_ID = "module.teamBalance";
const DEFAULT_SOURCE = "manual";
const DEFAULT_REASON = "manual_team_balance";
const DEFAULT_SHUFFLE_SOURCE = "web.matchStatus.shufflePlan";
const DEFAULT_SHUFFLE_REASON = "match_status_playtime_shuffle_plan";
const DEFAULT_SWITCH_PERMISSION = "squad.switch";
const MAX_ACTION_HISTORY = 100;

export function createTeamBalanceService({ core, config, logger }) {
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

    listForceTeamChangeRecords(request = {}) {
      return listForceTeamChangeRecords(request);
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
      moduleLogger?.info?.("TeamBalance module started.", {
        operation: "start",
        data: {
          enabled,
          switchPermission,
        },
      });
    },

    async stop() {},
  };

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
    const roster = normalizeShuffleRoster(request.players ?? request.roster);

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

    const plan = buildPlaytimeShufflePlan(roster);
    const result = buildShufflePlanResult({
      ok: true,
      error: "",
      message: "Playtime-balanced shuffle plan recorded. No team switch executed.",
      source,
      reason,
      operator,
      system,
      summary: plan.summary,
      plan: plan.plan,
    });
    recordAction(result);
    return result;
  }

  function listForceTeamChangeRecords(request = {}) {
    const limit = clampInteger(request.limit ?? request.count ?? 50, 1, MAX_ACTION_HISTORY);
    return actionHistory.slice(0, limit);
  }

  async function executeForceTeamChangeCommand({ command, source, reason, operator, system }) {
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
    error,
    message,
    command: "",
    rconExecuted: false,
    rconResponse: "",
    summary,
    plan,
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
  };
}

function buildPlaytimeShufflePlan(players) {
  const teamSizes = {
    1: players.filter((player) => player.teamId === 1).length,
    2: players.filter((player) => player.teamId === 2).length,
  };
  const knownPlayers = players
    .filter((player) => Number.isFinite(player.playtimeSeconds))
    .sort(compareShufflePlayersByPlaytime);
  const unknownPlayers = players
    .filter((player) => !Number.isFinite(player.playtimeSeconds))
    .sort(compareShufflePlayersByName);

  // --- Phase 1: greedy LPT assignment (respects team size caps) ---
  const assigned = { 1: [], 2: [] };
  const knownTotals = { 1: 0, 2: 0 };

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
      mode: "playtime_balanced_shuffle",
      players: assignments,
      moves,
    },
  };
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
