// -*- coding: utf-8 -*-

const MODULE_ID = "module.teamBalance";
const API_NAME = "teamBalance";

export function createTeamBalanceModule({ core, modules, config, logger }) {
  const moduleConfig = config.get("modules.teamBalance", {});

  const enabled = moduleConfig.enabled !== false;
  const permission = String(moduleConfig.permission ?? "tb");
  const commandTemplate = String(moduleConfig.commandTemplate ?? "AdminForceTeamChangeById {playerId}");
  const historyLimit = Number(moduleConfig.historyLimit ?? 200);
  const history = [];

  const api = {
    async execute(request = {}) {
      return executeTbRequest(request);
    },

    getRecentEvents({ limit = 100 } = {}) {
      return history.slice(-Number(limit || 100)).reverse();
    },

    getStatus() {
      return {
        enabled,
        permission,
        commandTemplate,
        historySize: history.length,
      };
    },
  };

  async function executeTbRequest(request = {}) {
    const requestedAt = new Date().toISOString();
    const actor = normalizeActor(request.actor);
    const tb = normalizeTbObject(request.tb);

    const baseEvent = {
      eventId: makeEventId("tb"),
      moduleId: MODULE_ID,
      source: MODULE_ID,
      serverId: tb.serverId || core.webStatus?.serverId || "",
      time: requestedAt,
      actor,
      tb,
    };

    if (!enabled) {
      const result = {
        ok: false,
        error: "TeamBalanceDisabled",
        message: "TeamBalance module is disabled.",
        ...baseEvent,
      };

      await recordAudit({
        actor,
        action: "teamBalance.rejected",
        result: "rejected",
        reason: "module-disabled",
        tb,
        serverId: baseEvent.serverId,
      });

      return result;
    }

    if (!core.authManager?.hasPermission?.(actor, permission)) {
      const result = {
        ok: false,
        error: "Forbidden",
        message: `Permission '${permission}' is required.`,
        ...baseEvent,
      };

      await recordAudit({
        actor,
        action: "teamBalance.rejected",
        result: "forbidden",
        reason: "missing-permission",
        requiredPermission: permission,
        tb,
        serverId: baseEvent.serverId,
      });

      return result;
    }

    if (tb.type !== "switch-team") {
      const result = {
        ok: false,
        error: "UnsupportedTbType",
        message: `Unsupported tb type: ${tb.type}`,
        ...baseEvent,
      };

      await recordAudit({
        actor,
        action: "teamBalance.rejected",
        result: "unsupported",
        reason: `unsupported-type:${tb.type}`,
        tb,
        serverId: baseEvent.serverId,
      });

      return result;
    }

    const validation = validateSwitchTeamTb(tb);
    if (!validation.ok) {
      const result = {
        ok: false,
        error: "InvalidTbObject",
        message: validation.message,
        ...baseEvent,
      };

      await recordAudit({
        actor,
        action: "teamBalance.rejected",
        result: "invalid",
        reason: validation.message,
        tb,
        serverId: baseEvent.serverId,
      });

      return result;
    }

    const command = buildSwitchTeamCommand(tb);

    logger.info(`[TB] ${actor.username} switch-team ${tb.target.name} command=${command}`, {
      operation: "execute",
      data: {
        actor: actor.username,
        playerId: tb.target.playerId,
        steamId: tb.target.steamId,
        eosId: tb.target.eosId,
        playerName: tb.target.name,
        command,
      },
    });

    if (!core.rconManager?.dispatchCommand) {
      const result = {
        ok: false,
        error: "RconUnavailable",
        message: "RCON manager is unavailable.",
        ...baseEvent,
      };

      await recordAudit({
        actor,
        action: "teamBalance.rejected",
        result: "rcon-unavailable",
        reason: "rcon-manager-missing",
        tb,
        serverId: baseEvent.serverId,
      });

      return result;
    }

    const rconResult = await core.rconManager.dispatchCommand({
      command,
      requestedBy: `${MODULE_ID}:${actor.username || actor.id || "unknown"}`,
      reason: tb.reason || "manual team switch",
      sourceEventId: baseEvent.eventId,
    });

    const ok = Boolean(rconResult?.success);

    const tbEvent = {
      ...baseEvent,
      eventName: ok ? "team-balance.tb-executed" : "team-balance.tb-failed",
      type: ok ? "team-balance.tb-executed" : "team-balance.tb-failed",
      command,
      result: {
        ok,
        message: rconResult?.message ?? "",
        rconExecuted: Boolean(rconResult?.rconExecuted),
        rconResponse: String(rconResult?.rconResponse ?? ""),
      },
    };

    pushHistory(tbEvent);
    core.eventBus.emitModuleEvent(MODULE_ID, tbEvent.type, tbEvent);

    const commandEvent = {
      eventId: makeEventId("command"),
      eventName: "admin-command.executed",
      type: "admin-command.executed",
      source: MODULE_ID,
      moduleId: MODULE_ID,
      serverId: tbEvent.serverId,
      time: new Date().toISOString(),
      actor,
      action: "teamBalance.switchTeam",
      target: tb.target,
      command,
      ok,
      result: tbEvent.result,
      sourceEventId: tbEvent.eventId,
    };

    core.eventBus.emitModuleEvent(MODULE_ID, "admin-command.executed", commandEvent);

    await recordAudit({
      actor,
      action: "teamBalance.switchTeam",
      result: ok ? "success" : "failed",
      serverId: tbEvent.serverId,
      target: tb.target,
      command,
      tb,
      rcon: tbEvent.result,
      sourceEventId: tbEvent.eventId,
      commandEventId: commandEvent.eventId,
    });

    return {
      ok,
      event: tbEvent,
      commandEvent,
    };
  }

  function normalizeTbObject(input = {}) {
    const target = input.target ?? {};

    return {
      type: String(input.type ?? "switch-team").trim(),
      serverId: String(input.serverId ?? core.webStatus?.serverId ?? "").trim(),
      source: String(input.source ?? "unknown").trim(),
      reason: String(input.reason ?? "manual").trim(),
      target: {
        playerId: normalizeText(target.playerId ?? target.id ?? target.playerID),
        name: normalizeText(target.name ?? target.playerName),
        steamId: normalizeText(target.steamId ?? target.steamID ?? target.steam64 ?? target.steam64ID),
        eosId: normalizeText(target.eosId ?? target.eosID),
        teamId: normalizeNullableNumber(target.teamId ?? target.teamID ?? target.team),
        squadId: normalizeNullableNumber(target.squadId ?? target.squadID ?? target.squad),
      },
      raw: input,
    };
  }

  function normalizeActor(input = {}) {
    return {
      id: normalizeText(input.id) || "unknown",
      username: normalizeText(input.username) || "unknown",
      role: normalizeText(input.role),
      steam64: normalizeText(input.steam64 ?? input.steamId ?? input.steamID),
      permissions: normalizePermissions(input.permissions ?? input.permission),
      isSuperAdmin: Boolean(input.isSuperAdmin),
    };
  }

  function validateSwitchTeamTb(tb) {
    if (!tb.target) {
      return { ok: false, message: "tb.target is required." };
    }

    if (!tb.target.playerId && !tb.target.steamId && !tb.target.name) {
      return {
        ok: false,
        message: "Switch team requires playerId, steamId, or name.",
      };
    }

    return { ok: true };
  }

  function buildSwitchTeamCommand(tb) {
    const values = {
      playerId: tb.target.playerId,
      steamId: tb.target.steamId,
      eosId: tb.target.eosId,
      name: tb.target.name,
      teamId: tb.target.teamId ?? "",
      squadId: tb.target.squadId ?? "",
    };

    const command = commandTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
      const value = values[key] ?? "";
      return quoteCommandValue(String(value));
    });

    return command.trim();
  }

  function quoteCommandValue(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (/^\d+$/.test(text)) return text;
    return `"${text.replace(/"/g, '\\"')}"`;
  }

  async function recordAudit(payload) {
    try {
      return await modules.audit?.record?.({
        moduleId: MODULE_ID,
        time: new Date().toISOString(),
        actorId: payload.actor?.id,
        actorName: payload.actor?.username,
        actorRole: payload.actor?.role,
        action: payload.action,
        result: payload.result,
        serverId: payload.serverId,
        data: payload,
      });
    } catch (error) {
      logger?.warn?.(`[TB] audit record failed: ${error?.message ?? error}`);
      return null;
    }
  }

  function pushHistory(event) {
    history.push(event);

    while (history.length > historyLimit) {
      history.shift();
    }
  }

  return {
    manifest: {
      id: MODULE_ID,
      name: "TeamBalance Module",
      kind: "module",
      version: "0.1.0",
      description: "队伍管理 / TB 模块。提供人工跳边操作入口，执行权限校验、RCON 命令下发、tb 事件和管理命令审计事件。",
    },
    apiName: API_NAME,
    api,
  };
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePermissions(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => String(key).trim())
      .filter(Boolean);
  }

  return [];
}

function makeEventId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}
