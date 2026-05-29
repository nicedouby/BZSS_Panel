// -*- coding: utf-8 -*-

const MODULE_ID = "module.teamBalance";
const DEFAULT_SOURCE = "对局状态手动操作";
const DEFAULT_SWITCH_PERMISSION = "squad.switch";

export function createTeamBalanceService({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config?.get?.("modules.teamBalance", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const switchPermission = String(moduleConfig.switchPermission ?? DEFAULT_SWITCH_PERMISSION).trim() || DEFAULT_SWITCH_PERMISSION;

  const api = {
    async requestSwitchTeam(request = {}) {
      return switchPlayerTeam(request);
    },

    async switchTeam(request = {}) {
      return switchPlayerTeam(request);
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
      version: "0.1.0",
      description: "Central gateway for manual team switch actions.",
    },
    apiName: "teamBalance",
    api,

    async start() {
      moduleLogger.info("TeamBalance module started.", {
        operation: "start",
        data: {
          enabled,
          switchPermission,
        },
      });
    },
  };

  async function switchPlayerTeam(request = {}) {
    const serverId = normalizeServerId(request.serverId ?? core.webStatus?.serverId ?? "");
    const actor = request.actor ?? request.viewer ?? null;
    const operatorName = normalizeText(request.operatorName ?? actor?.username ?? actor?.name);
    const source = normalizeText(request.source) || DEFAULT_SOURCE;
    const reason = normalizeText(request.reason) || "manual_team_balance";
    const system = Boolean(request.system);
    const target = resolveSwitchTarget(request);
    const matchId = normalizeText(request.matchId ?? modules?.squadManagement?.getState?.(serverId)?.matchId ?? "");

    if (!enabled) {
      return buildResult({
        ok: false,
        serverId,
        source,
        operatorName,
        reason,
        target,
        error: "ModuleDisabled",
        message: "TeamBalance module is disabled.",
        system,
      });
    }

    if (!serverId) {
      return buildResult({
        ok: false,
        serverId,
        source,
        operatorName,
        reason,
        target,
        error: "InvalidServerId",
        message: "serverId is required.",
        system,
      });
    }

    if (!target.anyId) {
      return buildResult({
        ok: false,
        serverId,
        source,
        operatorName,
        reason,
        target,
        error: "InvalidTarget",
        message: "A player target is required.",
        system,
      });
    }

    if (!system && !canSwitch(actor, { switchPermission })) {
      return buildResult({
        ok: false,
        serverId,
        source,
        operatorName,
        reason,
        target,
        error: "Forbidden",
        message: `Permission '${switchPermission}' is required.`,
        system,
      });
    }

    const command = `AdminForceTeamChange "${escapeCommandString(target.anyId)}"`;
    try {
      const response = await executeSwitchCommand({
        serverId,
        command,
        target,
        source,
        operatorName,
        reason,
        system,
      });

      const record = await modules?.squadManagement?.recordAction?.({
        kind: "switch_team",
        serverId,
        matchId,
        source,
        operatorName,
        system,
        playerName: target.name ?? "",
        playerKey: target.playerKey ?? target.anyId,
        playerId: target.playerId ?? null,
        steamId: target.steamId ?? "",
        eosId: target.eosId ?? "",
        reason,
        result: response.ok ? "success" : "failed",
        error: response.ok ? "" : response.error,
        command,
        payload: {
          request,
          target,
          response,
          note: `${source}，操作者${operatorName || "unknown"}`,
        },
      });

      await modules?.audit?.record?.({
        actorId: actor?.id ?? actor?.username ?? operatorName ?? "unknown",
        actorName: operatorName || actor?.username || "unknown",
        sourceModule: MODULE_ID,
        action: "switch_team",
        serverId,
        target: {
          anyId: target.anyId,
          playerId: target.playerId ?? null,
          playerName: target.name ?? "",
          steamId: target.steamId ?? "",
          eosId: target.eosId ?? "",
        },
        source,
        reason,
        result: response.ok ? "success" : "failed",
        operatorName,
      });

      return buildResult({
        ok: response.ok,
        serverId,
        source,
        operatorName,
        reason,
        target,
        error: response.ok ? "" : response.error,
        message: response.ok ? "Team switch requested." : response.error,
        command,
        rconExecuted: response.executed,
        rconResponse: response.response,
        record,
        system,
      });
    } catch (error) {
      const errorMessage = String(error?.message ?? error);
      await modules?.audit?.record?.({
        actorId: actor?.id ?? actor?.username ?? operatorName ?? "unknown",
        actorName: operatorName || actor?.username || "unknown",
        sourceModule: MODULE_ID,
        action: "switch_team",
        serverId,
        target: {
          anyId: target.anyId,
          playerId: target.playerId ?? null,
          playerName: target.name ?? "",
          steamId: target.steamId ?? "",
          eosId: target.eosId ?? "",
        },
        source,
        reason,
        result: "failed",
        operatorName,
        error: errorMessage,
      });

      return buildResult({
        ok: false,
        serverId,
        source,
        operatorName,
        reason,
        target,
        error: errorMessage,
        message: errorMessage,
        command: `AdminForceTeamChange "${escapeCommandString(target.anyId)}"`,
        system,
      });
    }
  }

  async function executeSwitchCommand({ command, target, source, operatorName, reason, system }) {
    if (typeof core.squadRcon?.switchTeam === "function") {
      const response = await core.squadRcon.switchTeam(target.anyId);
      return normalizeSwitchResponse(response);
    }

    if (typeof core.rconManager?.dispatchCommand === "function") {
      const response = await core.rconManager.dispatchCommand({
        command,
        requestedBy: `${MODULE_ID}:${operatorName || "system"}`,
        reason: reason || source || "switch_team",
        system,
      });
      if (response?.success || response?.rconExecuted) {
        return {
          ok: true,
          executed: Boolean(response?.rconExecuted ?? response?.success ?? true),
          response: response?.rconResponse ?? response?.message ?? "",
          error: "",
        };
      }
      return {
        ok: false,
        executed: false,
        response: response?.rconResponse ?? "",
        error: String(response?.message ?? "RCON command failed."),
      };
    }

    if (typeof core.rcon?.execute === "function") {
      const response = await core.rcon.execute(command);
      return {
        ok: true,
        executed: true,
        response,
        error: "",
      };
    }

    throw new Error("No RCON executor is available.");
  }
}

function buildResult({
  ok,
  serverId,
  source,
  operatorName,
  reason,
  target,
  error = "",
  message = "",
  command = "",
  rconExecuted = false,
  rconResponse = "",
  record = null,
  system = false,
}) {
  return {
    ok: Boolean(ok),
    type: "switch_team",
    action: "switch_team",
    serverId,
    source,
    operatorName,
    system: Boolean(system),
    target,
    reason,
    error,
    message,
    command,
    rconExecuted: Boolean(rconExecuted),
    rconResponse,
    record,
  };
}

function resolveSwitchTarget(request = {}) {
  const playerId = normalizeNullableNumber(request.playerId ?? request.playerID);
  const playerKey = normalizeText(request.playerKey ?? request.anyId ?? request.playerId ?? request.playerID ?? "");
  const steamId = normalizeText(request.steamId ?? request.steamID ?? "");
  const eosId = normalizeText(request.eosId ?? request.eosID ?? "");
  const name = normalizeText(request.name ?? request.playerName ?? "");
  const anyId = normalizeText(request.anyId ?? steamId ?? eosId ?? name ?? playerKey);
  return {
    playerId,
    playerKey,
    steamId,
    eosId,
    name,
    anyId,
  };
}

function canSwitch(viewer, config = {}) {
  return Boolean(
    viewer?.isSuperAdmin
    || viewer?.permissions?.includes?.(config.switchPermission)
  );
}

function normalizeSwitchResponse(response) {
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

function normalizeServerId(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeNullableNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function escapeCommandString(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
