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
      type: "FORCE_TEAM_CHANGE",
      ok: result.ok,
      steamId: result.steamId,
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
    };

    actionHistory.unshift(entry);
    if (actionHistory.length > MAX_ACTION_HISTORY) {
      actionHistory.length = MAX_ACTION_HISTORY;
    }

    if (result.ok) {
      moduleLogger?.info?.("[TB] FORCE_TEAM_CHANGE", entry);
      return;
    }

    moduleLogger?.warn?.("[TB] FORCE_TEAM_CHANGE_FAILED", entry);
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

function buildForceTeamChangeCommand(steamId) {
  return `AdminForceTeamChange "${escapeCommandString(steamId)}"`;
}

function canSwitch(viewer, config = {}) {
  if (!viewer) return false;
  if (viewer.isSuperAdmin) return true;
  const permissions = normalizePermissionList(viewer.permissions ?? viewer.permission);
  return permissions.includes(config.switchPermission);
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
