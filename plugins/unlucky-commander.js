// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.unlucky-commander";

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeId(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function normalizeLower(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sameIdentity(left = {}, right = {}) {
  const leftSteam = normalizeId(left.steam64ID ?? left.steamID ?? left.steamId);
  const rightSteam = normalizeId(right.steam64ID ?? right.steamID ?? right.steamId);
  if (leftSteam && rightSteam && leftSteam === rightSteam) return true;

  const leftEos = normalizeId(left.eosID ?? left.eosId ?? left.eos_id);
  const rightEos = normalizeId(right.eosID ?? right.eosId ?? right.eos_id);
  if (leftEos && rightEos && leftEos === rightEos) return true;

  const leftName = normalizeLower(left.name ?? left.displayName);
  const rightName = normalizeLower(right.name ?? right.displayName);
  if (leftName && rightName && leftName === rightName) return true;

  return false;
}

function resolveRecord(event = {}) {
  return event?.record ?? event?.payload?.record ?? event?.data?.record ?? event?.rejection?.record ?? null;
}

function isRconTeamKillRecord(record = {}) {
  // CombatClean normalizes raw "tk" to processed "kill", so we rely on raw record metadata.
  const rawRecord = record?.raw?.rawRecord ?? record?.rawRecord ?? {};
  const causedBy = String(rawRecord?.causedBy ?? rawRecord?.rawCausedBy ?? "").trim();
  const type = String(rawRecord?.type ?? record?.type ?? "").trim().toLowerCase();
  const rawEventName = String(rawRecord?.eventName ?? rawRecord?.event_name ?? "").trim();

  const isTk = Boolean(
    record?.isTeamKill
      || record?.tk
      || record?.relation?.friendlyFireType === "team_kill"
      || record?.relation?.isFriendlyFire
      || record?.isFriendlyFire,
  );

  if (!isTk) return false;

  if (type === "tk") return true;

  const upper = causedBy.toUpperCase();
  if (upper === "RCON_TEAM_KILL") return true;
  if (upper.includes("RCON") && upper.includes("TEAM_KILL")) return true;

  if (String(rawEventName).toUpperCase() === "TEAM_KILL") return true;

  // Best-effort fallback: combat-state's rcon tk uses this marker.
  if (upper.includes("RCON") && upper.includes("KILL")) return true;

  return false;
}

function isCommandSquadName(value) {
  const name = normalizeLower(value);
  if (!name) return false;
  if (name === "command squad") return true;
  if (name === "cmd") return true;
  if (name === "command") return true;
  return /\bcommand\s*squad\b/i.test(name);
}

function isCommandSquadId(value) {
  const id = normalizeLower(value);
  if (!id) return false;
  return id === "10" || id === "cmd" || id === "command";
}

function listCommandSquadIds(modules, serverId, teamID) {
  const squadApi = modules?.squadManagement;
  if (typeof squadApi?.getSquads !== "function") return [];

  const list = squadApi.getSquads(serverId) ?? [];
  const team = normalizeId(teamID);
  if (!Array.isArray(list) || !team) return [];

  const ids = [];
  for (const squad of list) {
    const squadName = squad?.squadName ?? squad?.name ?? "";
    if (!isCommandSquadName(squadName)) continue;

    const squadTeam = normalizeId(squad?.teamID ?? squad?.teamId);
    const squadId = normalizeId(squad?.squadID ?? squad?.squadId);
    if (squadTeam !== team) continue;
    if (!squadId) continue;

    ids.push(squadId);
  }
  return ids;
}

function isVictimCurrentTeamCommander({ modules, serverId, victim }) {
  if (!victim || typeof victim !== "object") return false;

  // "指挥官"定义：指挥小队( Command Squad )的队长。
  if (!victim.isLeader) return false;

  const teamID = normalizeId(victim.teamID);
  const squadID = normalizeId(victim.squadID);
  if (!teamID || !squadID) return false;

  const commandSquads = listCommandSquadIds(modules, serverId, teamID);
  if (commandSquads.length > 0) {
    return commandSquads.some((id) => normalizeId(id) === squadID);
  }

  // Fallback: some servers use fixed command squad id.
  return isCommandSquadId(squadID);
}

function readRuntimeConfig(config) {
  const cfg = config?.get?.(`plugins.${PLUGIN_ID}`, {}) ?? {};
  return {
    enabled: Boolean(cfg.enabled ?? true),
  };
}

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger ??
    core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "module",
    }) ??
    core?.logger ??
    console;

  const unsubscribers = [];

  const handled = new Map();

  const state = {
    enabled: true,
    subscribed: true,
    handled: 0,
    broadcasted: 0,
    lastHandledAt: "",
    lastBroadcastAt: "",
    lastError: "",
  };

  function isPluginSubscribed() {
    const isSubscribed = core?.pluginSubscriptions?.isSubscribed;
    if (typeof isSubscribed !== "function") return true;
    return isSubscribed(PLUGIN_ID);
  }

  function isActive() {
    return Boolean(state.enabled) && isPluginSubscribed();
  }

  function pruneHandled(now = Date.now()) {
    for (const [key, ts] of handled.entries()) {
      if (now - ts > 10 * 60_000) handled.delete(key);
    }
    while (handled.size > 1000) {
      const first = handled.keys().next().value;
      if (!first) break;
      handled.delete(first);
    }
  }

  function buildEventKey(event = {}, record = {}) {
    const direct = normalizeText(event?.eventId ?? record?.id ?? record?.raw?.sourceEventId ?? record?.raw?.rawRecord?.sourceEventId);
    if (direct) return direct;

    const time = normalizeText(record?.time ?? event?.time);
    const attackerName = normalizeText(record?.attackerName ?? record?.attacker?.name);
    const victimName = normalizeText(record?.victimName ?? record?.victim?.name);
    return [time, attackerName, victimName].filter(Boolean).join("|") || `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  }

  function getBroadcastApi() {
    return modules?.adminWarn?.sendAdminBroadcast ?? modules?.adminWarn?.broadcastMessage ?? null;
  }

  async function broadcast(message, { reason, relatedEventId } = {}) {
    const api = getBroadcastApi();
    if (typeof api !== "function") return { success: false, skipped: true, skipReason: "broadcast_api_missing" };

    return api({
      message,
      reason: normalizeText(reason, "unlucky_commander_tk"),
      sourceModule: PLUGIN_ID,
      relatedEventId: normalizeText(relatedEventId) || undefined,
      system: true,
    });
  }

  async function handleCombatManagerEvent(event = {}) {
    if (!isActive()) return;

    const record = resolveRecord(event);
    if (!record) return;

    const serverId = normalizeText(record?.serverId ?? event?.serverId ?? core?.webStatus?.serverId);
    if (!serverId) return;

    if (!isRconTeamKillRecord(record)) return;

    const victim = record?.victim ?? {};
    const attacker = record?.attacker ?? {};

    if (!isVictimCurrentTeamCommander({ modules, serverId, victim })) return;

    // Ensure it is actually a teamkill by a teammate (best-effort).
    const victimTeam = normalizeId(victim?.teamID ?? record?.victimTeamID ?? record?.victimTeamId);
    const attackerTeam = normalizeId(attacker?.teamID ?? record?.attackerTeamID ?? record?.attackerTeamId);
    if (victimTeam && attackerTeam && victimTeam !== attackerTeam) return;

    // Avoid self-kill / identity collisions.
    if (sameIdentity(attacker, victim)) return;

    const key = buildEventKey(event, record);
    pruneHandled();
    if (handled.has(key)) return;
    handled.set(key, Date.now());

    state.handled += 1;
    state.lastHandledAt = new Date().toISOString();
    state.lastError = "";

    const attackerName = normalizeText(record?.attackerName ?? attacker?.name ?? attacker?.displayName, "未知玩家");

    const message = `叛徒${attackerName}击毙了己方指挥官！！！`;

    try {
      const result = await broadcast(message, {
        reason: "unlucky_commander_rcon_tk",
        relatedEventId: normalizeText(event?.eventId) || normalizeText(record?.id),
      });

      if (result?.success) {
        state.broadcasted += 1;
        state.lastBroadcastAt = new Date().toISOString();
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "倒霉狗官",
      kind: "plugin",
      version: "1.0.0",
      description: "订阅战斗管理的 RCON TK 事件：当受害者为指挥小队队长（当前阵营指挥官）且被己方击毙时，广播叛徒击毙指挥官提示。",
      configSchema: [
        {
          key: `plugins.${PLUGIN_ID}.enabled`,
          type: "boolean",
          default: true,
          description: "是否启用插件",
        },
      ],
    },

    apiName: "unluckyCommander",
    api: {
      getState() {
        return {
          ...state,
          subscribed: isPluginSubscribed(),
        };
      },
    },

    async start() {
      const runtimeConfig = readRuntimeConfig(config);
      state.enabled = runtimeConfig.enabled;

      if (!state.enabled) {
        pluginLogger?.info?.("[UnluckyCommander] plugin disabled by config.");
        return;
      }

      if (typeof core?.eventBus?.onModuleEvent !== "function") {
        pluginLogger?.warn?.("[UnluckyCommander] eventBus.onModuleEvent unavailable.");
        return;
      }

      unsubscribers.push(
        core.eventBus.onModuleEvent("module.combatManager", "KILL_MANAGER_EVENT", handleCombatManagerEvent),
      );

      pluginLogger?.info?.("[UnluckyCommander] subscriptions ready.");
    },

    async stop() {
      for (const un of unsubscribers.splice(0)) un();
      handled.clear();
      pluginLogger?.info?.("[UnluckyCommander] stopped.");
    },
  };
}
