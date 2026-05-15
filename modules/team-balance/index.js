// -*- coding: utf-8 -*-

const MODULE_ID = "module.teamBalance";
const API_NAME = "teamBalance";

export function createTeamBalanceModule({ core, modules, config, logger }) {
  const moduleConfig = config.get("modules.teamBalance", {});

  const enabled = moduleConfig.enabled !== false;
  const permission = String(moduleConfig.permission ?? "tb");
  const commandTemplate = String(moduleConfig.commandTemplate ?? 'AdminForceTeamChange "{name}"');
  const historyLimit = Number(moduleConfig.historyLimit ?? 200);
  const history = [];
  const state = {
    containers: [],
    lastPlan: null,
    lastExecution: null,
    updatedAt: "",
  };

  touchState();

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

    getState() {
      return cloneJson(state);
    },

    setContainers(containers) {
      const normalized = normalizeContainers(containers);
      state.containers = normalized;
      touchState();
      return cloneJson(state);
    },

    setContainerTargetTeam(containerId, targetTeam) {
      const container = requireContainer(containerId);
      container.targetTeam = normalizeTargetTeam(targetTeam);
      touchState();
      return cloneJson(container);
    },

    buildBalancePlan(options = {}) {
      return buildBalancePlanInternal(options);
    },

    async executePlan(planId, context = {}) {
      return executePlanInternal(planId, context);
    },

    async groupTogetherAndExecute(context = {}) {
      const plan = buildBalancePlanInternal({
        execute: false,
        mode: "groupTogether",
      });
      applyPlanTargets(plan);
      state.lastPlan = cloneJson(plan);
      touchState();
      const result = await executePlanInternal(plan.id, context);
      return {
        plan: cloneJson(plan),
        result,
      };
    },

    balanceOnly() {
      const plan = buildBalancePlanInternal({
        execute: false,
        mode: "balanceOnly",
      });
      applyPlanTargets(plan);
      state.lastPlan = cloneJson(plan);
      touchState();
      return cloneJson(plan);
    },

    balanceSingleContainer(containerId, targetTeam = null) {
      const container = requireContainer(containerId);
      const resolvedTargetTeam = normalizeTargetTeam(targetTeam) ?? chooseLessPopulatedTeam(state.containers);
      container.targetTeam = resolvedTargetTeam;

      const plan = buildSingleContainerPlan(container);
      state.lastPlan = cloneJson(plan);
      touchState();

      return {
        container: cloneJson(container),
        plan,
      };
    },

    async executeContainer(containerId, context = {}) {
      const container = requireContainer(containerId);
      const targetTeam = normalizeTargetTeam(container.targetTeam);

      if (![1, 2].includes(targetTeam)) {
        throw createHandledError(400, "InvalidTargetTeam", "Container targetTeam must be 1 or 2 before execution.");
      }

      const plan = buildSingleContainerPlan(container);
      state.lastPlan = cloneJson(plan);
      touchState();
      return executePlanInternal(plan.id, context);
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

    const command = buildLegacySwitchTeamCommand(tb, commandTemplate);

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
    core.eventBus?.emitModuleEvent?.(MODULE_ID, tbEvent.type, tbEvent);

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
    });

    return {
      ok,
      event: tbEvent,
    };
  }

  function buildBalancePlanInternal(options = {}) {
    const mode = String(options.mode ?? "balanceOnly");
    const execute = Boolean(options.execute);
    const containers = state.containers.map((container) => ({
      ...cloneJson(container),
      size: getContainerOnlineSize(container),
      actualTeamCounts: getContainerActualTeamCounts(container),
    }));

    const sorted = [...containers].sort((a, b) => {
      const sizeDiff = Number(b.size) - Number(a.size);
      if (sizeDiff !== 0) return sizeDiff;
      return String(a.name).localeCompare(String(b.name), "zh-CN");
    });

    const totals = { 1: 0, 2: 0 };
    const actualTotals = getActualOnlineTotals(containers);
    const planned = [];

    for (const container of sorted) {
      const lockedTarget = container.locked ? normalizeTargetTeam(container.targetTeam) : null;
      const targetTeam = lockedTarget ?? chooseTeamForPlan(totals, actualTotals);
      totals[targetTeam] += container.size;

      planned.push({
        containerId: container.id,
        name: container.name,
        size: container.size,
        targetTeam,
        locked: Boolean(container.locked),
        playerIDs: container.players
          .map((player) => normalizeNullableNumber(player.playerID))
          .filter((value) => value != null),
      });
    }

    return {
      id: makeEventId("plan"),
      mode,
      execute,
      containers: planned,
      totals: {
        team1: totals[1],
        team2: totals[2],
      },
      createdAt: new Date().toISOString(),
    };
  }

  function buildSingleContainerPlan(container) {
    const targetTeam = normalizeTargetTeam(container.targetTeam);
    if (![1, 2].includes(targetTeam)) {
      throw createHandledError(400, "InvalidTargetTeam", "Container targetTeam must be 1 or 2.");
    }

    return {
      id: makeEventId("plan"),
      mode: "singleContainer",
      execute: false,
      containers: [{
        containerId: container.id,
        name: container.name,
        size: getContainerOnlineSize(container),
        targetTeam,
        locked: Boolean(container.locked),
        playerIDs: container.players
          .map((player) => normalizeNullableNumber(player.playerID))
          .filter((value) => value != null),
      }],
      totals: {
        team1: targetTeam === 1 ? getContainerOnlineSize(container) : 0,
        team2: targetTeam === 2 ? getContainerOnlineSize(container) : 0,
      },
      createdAt: new Date().toISOString(),
    };
  }

  async function executePlanInternal(planId, context = {}) {
    let plan = state.lastPlan && String(state.lastPlan.id) === String(planId)
      ? cloneJson(state.lastPlan)
      : null;

    if (!plan && !planId) {
      plan = buildCurrentTargetsPlan();
      state.lastPlan = cloneJson(plan);
    }

    if (!plan) {
      throw createHandledError(404, "PlanNotFound", `Plan not found: ${planId}`);
    }

    const actor = normalizeActor(context.actor);
    const results = [];

    for (const plannedContainer of plan.containers ?? []) {
      const container = state.containers.find((item) => item.id === plannedContainer.containerId);
      if (!container) continue;

      container.targetTeam = normalizeTargetTeam(plannedContainer.targetTeam);

      for (const player of container.players) {
        const result = await switchPlayerToTargetTeam(player, container.targetTeam, actor);
        results.push(result);
      }
    }

    const execution = {
      planId: plan.id,
      executedAt: new Date().toISOString(),
      totalPlayers: results.length,
      switched: results.filter((item) => item.action === "switch" && item.success).length,
      skipped: results.filter((item) => item.action === "skip").length,
      failed: results.filter((item) => item.action === "switch" && !item.success).length,
      results,
    };

    state.lastExecution = cloneJson(execution);
    touchState();
    pushHistory({
      eventId: makeEventId("execution"),
      moduleId: MODULE_ID,
      source: MODULE_ID,
      type: "team-balance.plan-executed",
      time: execution.executedAt,
      actor,
      planId: plan.id,
      execution,
    });

    return execution;
  }

  async function switchPlayerToTargetTeam(player, targetTeam, actor = {}) {
    const currentTeam = Number(player?.teamID);
    const desiredTeam = Number(targetTeam);
    const playerID = normalizeNullableNumber(player?.playerID);
    const name = normalizeText(player?.name) || "Unknown";

    if (player?.online !== true) {
      return buildPlayerResult(playerID, name, currentTeam, desiredTeam, "skip", true, "Player is offline.");
    }

    if (![1, 2].includes(currentTeam)) {
      return buildPlayerResult(playerID, name, currentTeam, desiredTeam, "skip", true, "Player current team is not 1 or 2.");
    }

    if (![1, 2].includes(desiredTeam)) {
      return buildPlayerResult(playerID, name, currentTeam, desiredTeam, "skip", true, "Target team is invalid.");
    }

    if (currentTeam === desiredTeam) {
      return buildPlayerResult(playerID, name, currentTeam, desiredTeam, "skip", true, "Player is already on target team.");
    }

    const anyID = buildPlayerAnyId(player);
    if (!anyID) {
      return buildPlayerResult(playerID, name, currentTeam, desiredTeam, "skip", false, "No usable player identifier.");
    }

    if (!core.rconManager?.dispatchCommand) {
      return buildPlayerResult(playerID, name, currentTeam, desiredTeam, "switch", false, "RCON manager is unavailable.");
    }

    const command = `AdminForceTeamChange "${escapeCommandString(anyID)}"`;
    const result = await core.rconManager.dispatchCommand({
      command,
      requestedBy: `${MODULE_ID}:${actor.username || actor.id || "system"}`,
      reason: "team-balance",
    });

    return {
      playerID,
      name,
      fromTeam: currentTeam,
      targetTeam: desiredTeam,
      action: "switch",
      success: Boolean(result?.success),
      message: result?.message ?? "",
      rconExecuted: Boolean(result?.rconExecuted),
      rconResponse: result?.rconResponse ?? "",
    };
  }

  function applyPlanTargets(plan) {
    const targetMap = new Map((plan?.containers ?? []).map((item) => [item.containerId, normalizeTargetTeam(item.targetTeam)]));
    for (const container of state.containers) {
      if (!targetMap.has(container.id)) continue;
      container.targetTeam = targetMap.get(container.id);
    }
  }

  function buildCurrentTargetsPlan() {
    const planned = [];
    const totals = { team1: 0, team2: 0 };

    for (const container of state.containers) {
      const targetTeam = normalizeTargetTeam(container.targetTeam);
      if (![1, 2].includes(targetTeam)) continue;

      const size = getContainerOnlineSize(container);
      if (targetTeam === 1) totals.team1 += size;
      if (targetTeam === 2) totals.team2 += size;

      planned.push({
        containerId: container.id,
        name: container.name,
        size,
        targetTeam,
        locked: Boolean(container.locked),
        playerIDs: container.players
          .map((player) => normalizeNullableNumber(player.playerID))
          .filter((value) => value != null),
      });
    }

    return {
      id: makeEventId("plan"),
      mode: "manualTargets",
      execute: false,
      containers: planned,
      totals,
      createdAt: new Date().toISOString(),
    };
  }

  function requireContainer(containerId) {
    const container = state.containers.find((item) => item.id === String(containerId ?? ""));
    if (!container) {
      throw createHandledError(404, "ContainerNotFound", `Container not found: ${containerId}`);
    }
    return container;
  }

  function touchState() {
    state.updatedAt = new Date().toISOString();
  }

  function pushHistory(event) {
    history.push(cloneJson(event));
    while (history.length > historyLimit) history.shift();
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

  return {
    manifest: {
      id: MODULE_ID,
      name: "TeamBalance Module",
      kind: "module",
      version: "0.2.0",
      description: "Team balance planning and controlled team-switch execution.",
    },
    apiName: API_NAME,
    api,
  };
}

function normalizeContainers(input) {
  const containers = Array.isArray(input) ? input : [];
  return containers.map((container, index) => normalizeContainer(container, index));
}

function normalizeContainer(input = {}, index = 0) {
  const players = Array.isArray(input.players) ? input.players.map((player) => normalizeContainerPlayer(player)).filter(Boolean) : [];
  return {
    id: normalizeText(input.id) || `container_${index + 1}`,
    name: normalizeText(input.name) || `Container ${index + 1}`,
    targetTeam: normalizeTargetTeam(input.targetTeam),
    locked: Boolean(input.locked),
    players,
  };
}

function normalizeContainerPlayer(input = {}) {
  return {
    playerID: normalizeNullableNumber(input.playerID ?? input.playerId ?? input.id),
    name: normalizeText(input.name),
    steamID: normalizeText(input.steamID ?? input.steamId),
    eosID: normalizeText(input.eosID ?? input.eosId),
    teamID: normalizeNullableNumber(input.teamID ?? input.teamId),
    squadID: normalizeNullableNumber(input.squadID ?? input.squadId),
    online: input.online === undefined ? true : Boolean(input.online),
  };
}

function normalizeTbObject(input = {}) {
  const target = input.target ?? {};

  return {
    type: String(input.type ?? "switch-team").trim(),
    serverId: String(input.serverId ?? "").trim(),
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
    id: normalizeText(input?.id) || "unknown",
    username: normalizeText(input?.username) || "unknown",
    role: normalizeText(input?.role),
    steam64: normalizeText(input?.steam64 ?? input?.steamId ?? input?.steamID),
    permissions: normalizePermissions(input?.permissions ?? input?.permission),
    isSuperAdmin: Boolean(input?.isSuperAdmin),
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

function buildLegacySwitchTeamCommand(tb, commandTemplate) {
  const values = {
    playerId: tb.target.playerId,
    steamId: tb.target.steamId,
    eosId: tb.target.eosId,
    name: tb.target.name,
    teamId: tb.target.teamId ?? "",
    squadId: tb.target.squadId ?? "",
  };

  return String(commandTemplateFallback(tb, values, commandTemplate)).trim();
}

function commandTemplateFallback(tb, values, fallbackTemplate) {
  const template = tb?.raw?.commandTemplate ?? null;
  const commandTemplate = typeof template === "string" && template.trim()
    ? template
    : String(fallbackTemplate ?? 'AdminForceTeamChange "{name}"');

  return commandTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const value = values[key] ?? "";
    return quoteCommandValue(String(value));
  });
}

function quoteCommandValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^\d+$/.test(text)) return text;
  return `"${escapeCommandString(text)}"`;
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

function normalizeTargetTeam(value) {
  const parsed = normalizeNullableNumber(value);
  return parsed === 1 || parsed === 2 ? parsed : null;
}

function normalizePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => String(key).trim())
      .filter(Boolean);
  }
  return [];
}

function getContainerOnlineSize(container) {
  return container.players.filter((player) => player?.online !== false).length;
}

function getContainerActualTeamCounts(container) {
  return {
    team1: container.players.filter((player) => player?.online !== false && Number(player?.teamID) === 1).length,
    team2: container.players.filter((player) => player?.online !== false && Number(player?.teamID) === 2).length,
  };
}

function getActualOnlineTotals(containers) {
  return containers.reduce((totals, container) => {
    const counts = container.actualTeamCounts ?? getContainerActualTeamCounts(container);
    totals[1] += Number(counts.team1 ?? 0);
    totals[2] += Number(counts.team2 ?? 0);
    return totals;
  }, { 1: 0, 2: 0 });
}

function chooseTeamForPlan(totals, actualTotals) {
  if (totals[1] < totals[2]) return 1;
  if (totals[2] < totals[1]) return 2;
  if (actualTotals[1] < actualTotals[2]) return 1;
  if (actualTotals[2] < actualTotals[1]) return 2;
  return 1;
}

function chooseLessPopulatedTeam(containers) {
  const actualTotals = getActualOnlineTotals(containers);
  if (actualTotals[1] < actualTotals[2]) return 1;
  if (actualTotals[2] < actualTotals[1]) return 2;
  return 1;
}

function buildPlayerAnyId(player = {}) {
  return normalizeText(player.steamID) || normalizeText(player.eosID) || normalizeText(player.name);
}

function buildPlayerResult(playerID, name, fromTeam, targetTeam, action, success, message) {
  return {
    playerID,
    name,
    fromTeam,
    targetTeam,
    action,
    success,
    message,
  };
}

function escapeCommandString(value) {
  return String(value ?? "").replace(/"/g, '\\"');
}

function createHandledError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeEventId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}
