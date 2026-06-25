// -*- coding: utf-8 -*-

import {
  canSendRconCommand,
  resolveRconPermission,
} from "../../web-client/src/shared/rcon-permissions.js";

const MODULE_ID = "module.teamBalance";
const DEFAULT_SOURCE = "manual";
const DEFAULT_REASON = "manual_team_balance";
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
    const playerId = normalizePlayerId(request.playerId ?? request.playerID ?? request.playerid);
    const steamId = normalizeText(request.steamId ?? request.steamID ?? request.anyId ?? request.playerKey ?? request.playerId ?? "");
    const playerName = normalizeText(request.playerName ?? request.name ?? "");
    const system = Boolean(request.system);
    const command = buildForceTeamChangeCommand({ playerId, steamId, playerName });

    if (!enabled) {
      const result = buildResult({
        ok: false,
        error: "ModuleDisabled",
        message: "TeamBalance module is disabled.",
        command,
        steamId,
        playerId,
        playerName,
        source,
        reason,
        operator,
        system,
      });
      recordAction(result);
      return result;
    }

    if (playerId == null && !steamId) {
      const result = buildResult({
        ok: false,
        error: "MissingSteamId",
        message: "steamId is required.",
        command,
        steamId,
        playerId,
        playerName,
        source,
        reason,
        operator,
        system,
      });
      recordAction(result);
      return result;
    }

    if (!system && !canSwitch(operator, command, { switchPermission })) {
      const result = buildResult({
        ok: false,
        error: "Forbidden",
        message: `Permission '${switchPermission}' is required.`,
        command,
        steamId,
        playerId,
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
        error: response.ok ? "" : (response.error || "RCON_FAILED"),
        message: response.ok ? "Team switch requested." : (response.message || response.error || "RCON command failed."),
        command,
        rconExecuted: response.executed,
        rconResponse: response.response,
        steamId,
        playerId,
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
        playerId,
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

    if (typeof core?.rconManager?.dispatchCommand === "function") {
      const response = await core.rconManager.dispatchCommand({
        command,
        requiredPermission,
        source,
        reason,
        operator,
        system,
      });

      return normalizeRconExecutionResponse(response);
    }

    if (typeof core?.rcon?.execute === "function") {
      const response = await core.rcon.execute(command, {
        requiredPermission,
        source,
        reason,
        operator,
      });

      return normalizeRconExecutionResponse(response);
    }

    return {
      ok: false,
      executed: false,
      response: "",
      error: "RCON unavailable.",
    };
  }

  function recordAction(entry) {
    actionHistory.unshift({
      id: cryptoRandomId(),
      timestamp: new Date().toISOString(),
      executor: entry.operator?.name || entry.operator?.username || entry.operator?.id || "system",
      action: "force_team_change",
      ...entry,
    });
    if (actionHistory.length > MAX_ACTION_HISTORY) {
      actionHistory.length = MAX_ACTION_HISTORY;
    }
    moduleLogger?.info?.(`[TB] ${entry.type ?? entry.action}`, entry);
  }
}

function normalizeRconExecutionResponse(response) {
  if (typeof response === "string") {
    return {
      ok: true,
      executed: true,
      response,
      error: "",
    };
  }

  return {
    ok: Boolean(response?.success ?? response?.ok),
    executed: Boolean(response?.rconExecuted ?? response?.executed ?? response?.success ?? response?.ok),
    response: String(response?.rconResponse ?? response?.response ?? response?.message ?? ""),
    error: response?.error
      ? String(response.error)
      : response?.code
        ? String(response.code)
        : "",
    message: String(response?.message ?? response?.error ?? response?.code ?? ""),
  };
}

function buildForceTeamChangeCommand({ playerId = null, steamId = "", playerName = "" } = {}) {
  const normalizedPlayerId = normalizePlayerId(playerId);
  if (normalizedPlayerId != null) {
    return `AdminForceTeamChangeById ${normalizedPlayerId}`;
  }

  const normalizedSteamId = normalizeText(steamId);
  if (normalizedSteamId) {
    return `AdminForceTeamChange "${normalizedSteamId}"`;
  }

  const normalizedPlayerName = normalizeText(playerName);
  if (normalizedPlayerName) {
    return `AdminForceTeamChange "${normalizedPlayerName}"`;
  }

  return "AdminForceTeamChange";
}

function buildResult({
  ok = false,
  error = "",
  message = "",
  command = "",
  rconExecuted = false,
  rconResponse = "",
  playerId = null,
  steamId = "",
  playerName = "",
  source = DEFAULT_SOURCE,
  reason = DEFAULT_REASON,
  operator = null,
  system = false,
} = {}) {
  return {
    ok: Boolean(ok),
    type: "force_team_change",
    action: "force_team_change",
    playerId,
    steamId,
    playerName,
    source,
    reason,
    operator,
    system: Boolean(system),
    error: error || "",
    message: message || "",
    command,
    rconExecuted: Boolean(rconExecuted),
    rconResponse: rconResponse || "",
  };
}

function normalizeOperator(operator, fallbackName = "") {
  if (!operator) {
    return fallbackName
      ? { id: fallbackName, name: fallbackName, username: fallbackName, permissions: [] }
      : null;
  }

  return {
    id: normalizeText(operator.id ?? operator.username ?? operator.name ?? fallbackName),
    name: normalizeText(operator.name ?? operator.username ?? fallbackName),
    username: normalizeText(operator.username ?? operator.name ?? fallbackName),
    role: normalizeText(operator.role ?? ""),
    isSuperAdmin: Boolean(operator.isSuperAdmin),
    permissions: Array.isArray(operator.permissions)
      ? operator.permissions.map((item) => normalizeText(item)).filter(Boolean)
      : [],
  };
}

function canSwitch(operator, command, { switchPermission }) {
  return Boolean(operator?.isSuperAdmin)
    || canSendRconCommand(operator, command, { requiredPermission: switchPermission })
    || canSendRconCommand(operator, command, { requiredPermission: "rcon.tb" });
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizePlayerId(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function clampInteger(value, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function cryptoRandomId() {
  return `tb_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}
