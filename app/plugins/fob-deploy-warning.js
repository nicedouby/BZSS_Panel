// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.fob-deploy-warning";
const CONFIG_KEY = "fob-deploy-warning";
const RAW_EVENT_NAME = "On_RawLogLine";
const DEFAULT_MESSAGE_TEMPLATE = "[FOB预警] 警告${squadId}队（${squadName}） ${leaderName}队长 已经部署了一个FOB";

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger
    ?? core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "module",
    })
    ?? core?.logger
    ?? console;

  let runtimeConfig = readRuntimeConfig(config);
  const unsubscribers = [];
  const dedupeKeys = new Map();
  let serial = Promise.resolve();

  const state = {
    enabled: runtimeConfig.enabled,
    subscribed: true,
    receivedCount: 0,
    matchedCount: 0,
    dispatchCount: 0,
    failedCount: 0,
    skippedCount: 0,
    lastTriggerAt: "",
    lastDispatchAt: "",
    lastError: "",
  };

  function enqueue(task) {
    const next = serial.then(task, task);
    serial = next.catch(() => {});
    return next;
  }

  function isSubscribed() {
    const coreCheck = core?.pluginSubscriptions?.isSubscribed;
    const modulesCheck = modules?.pluginSubscriptions?.isSubscribed;
    const coreOk = typeof coreCheck === "function" ? coreCheck(PLUGIN_ID) !== false : true;
    const moduleOk = typeof modulesCheck === "function" ? modulesCheck(PLUGIN_ID) !== false : true;
    return coreOk && moduleOk;
  }

  function isActive() {
    state.subscribed = isSubscribed();
    return Boolean(runtimeConfig.enabled) && state.subscribed;
  }

  function resolveWarnApi() {
    return modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn ?? null;
  }

  function resolveServerId(event = {}) {
    return text(event?.serverId)
      || text(core?.webStatus?.serverId)
      || text(modules?.matchState?.getState?.()?.serverId)
      || "";
  }

  function cleanupDedupe(now = Date.now()) {
    for (const [key, expiresAt] of dedupeKeys.entries()) {
      if (Number(expiresAt) <= now) dedupeKeys.delete(key);
    }
  }

  async function maybeRefreshSquads() {
    if (!runtimeConfig.refreshSquadsBeforeResolve) return;
    const refresh = modules?.matchState?.refresh;
    if (typeof refresh !== "function") return;
    try {
      await refresh("squads");
    } catch (error) {
      pluginLogger?.warn?.(`[FobDeployWarning] matchState.refresh(squads) failed: ${error?.message ?? error}`);
    }
  }

  function parseRawFobPlacement(rawLog = "") {
    if (!rawLog) return null;

    // Some logs are missing a space before "has" due to display-name formatting.
    const match = String(rawLog).match(/Warning:\s*(.+?)\s*has placed FOB Team:(\d+)\s+Squad:(\d+)/i);
    if (!match) return null;

    const playerName = text(match[1]);
    const teamId = toInt(match[2]);
    const squadId = toInt(match[3]);
    if (teamId == null || squadId == null) return null;

    return {
      playerName,
      teamId,
      squadId,
    };
  }

  function getSquadState(serverId) {
    if (!serverId) return null;
    const stateSnapshot = modules?.squadManagement?.getState?.(serverId);
    return stateSnapshot && typeof stateSnapshot === "object" ? stateSnapshot : null;
  }

  function resolveSquadContext(serverId, parsed) {
    const fallback = {
      teamId: parsed.teamId,
      squadId: parsed.squadId,
      teamName: `阵营${parsed.teamId}`,
      squadName: `Squad ${parsed.squadId}`,
      leaderName: parsed.playerName || `${parsed.squadId}队长`,
    };

    const squadState = getSquadState(serverId);
    if (!squadState) return { ...fallback, players: [] };

    const squads = Array.isArray(squadState.squads) ? squadState.squads : [];
    const teams = Array.isArray(squadState.teams) ? squadState.teams : [];
    const players = Array.isArray(squadState.players) ? squadState.players : [];

    const squad = squads.find((item) =>
      toInt(item?.teamId ?? item?.teamID) === parsed.teamId
      && toInt(item?.squadId ?? item?.squadID) === parsed.squadId,
    ) ?? null;

    const team = teams.find((item) => toInt(item?.teamId ?? item?.teamID) === parsed.teamId) ?? null;

    const teamName = text(squad?.teamName) || text(team?.teamName) || fallback.teamName;
    const squadName = text(squad?.squadName) || text(squad?.name) || fallback.squadName;
    const leaderName = text(squad?.leaderName)
      || text(squad?.creatorName)
      || fallback.leaderName;

    return {
      teamId: parsed.teamId,
      squadId: parsed.squadId,
      teamName,
      squadName,
      leaderName,
      players,
    };
  }

  function resolveRecipients(serverId, teamId, snapshotPlayers = []) {
    const fromSnapshot = Array.isArray(snapshotPlayers) ? snapshotPlayers : [];
    const fromPlayerState =
      modules?.playerState?.getPlayerList?.(serverId)
      ?? modules?.playerState?.getOnlinePlayers?.(serverId)
      ?? [];

    const merged = [...fromSnapshot, ...fromPlayerState];
    const recipients = [];
    const deduped = new Set();

    for (const player of merged) {
      const playerTeamId = toInt(player?.teamId ?? player?.teamID);
      if (playerTeamId !== teamId) continue;

      const isOnline = player?.isOnline == null ? player?.online !== false : Boolean(player?.isOnline);
      if (!isOnline) continue;

      const targetPlayerId = text(player?.playerId ?? player?.playerID);
      const targetName = text(player?.name ?? player?.playerName);
      const targetSteamId = text(player?.steamId ?? player?.steamID ?? player?.steam64ID);
      const targetEosId = text(player?.eosId ?? player?.eosID);

      const key = targetPlayerId || targetSteamId || targetEosId || targetName;
      if (!key || deduped.has(key)) continue;
      deduped.add(key);

      recipients.push({
        targetPlayerId,
        targetName,
        targetSteamId,
        targetEosId,
      });
    }

    return recipients;
  }

  function buildMessage(context) {
    return String(runtimeConfig.messageTemplate || DEFAULT_MESSAGE_TEMPLATE)
      .replace(/\$\{teamId\}/g, String(context?.teamId ?? ""))
      .replace(/\$\{teamName\}/g, String(context?.teamName ?? ""))
      .replace(/\$\{squadId\}/g, String(context?.squadId ?? ""))
      .replace(/\$\{squadName\}/g, String(context?.squadName ?? ""))
      .replace(/\$\{leaderName\}/g, String(context?.leaderName ?? ""));
  }

  async function dispatchTeamWarning(event, parsed) {
    const serverId = resolveServerId(event);
    if (!serverId) {
      state.skippedCount += 1;
      state.lastError = "server_id_missing";
      return;
    }

    await maybeRefreshSquads();

    const context = resolveSquadContext(serverId, parsed);
    const recipients = resolveRecipients(serverId, context.teamId, context.players);

    if (!recipients.length) {
      state.skippedCount += 1;
      state.lastError = "no_recipients";
      pluginLogger?.warn?.(
        `[FobDeployWarning] no recipients for team=${context.teamId} squad=${context.squadId} server=${serverId}`,
      );
      return;
    }

    const warnApi = resolveWarnApi();
    if (typeof warnApi !== "function") {
      state.failedCount += recipients.length;
      state.lastError = "admin_warn_api_unavailable";
      pluginLogger?.warn?.("[FobDeployWarning] adminWarn API unavailable.");
      return;
    }

    const message = buildMessage(context);
    let success = 0;
    let failed = 0;

    for (const recipient of recipients) {
      const result = await warnApi.call(modules.adminWarn, {
        targetPlayerId: recipient.targetPlayerId || undefined,
        targetName: recipient.targetName || undefined,
        targetSteamId: recipient.targetSteamId || undefined,
        targetEosId: recipient.targetEosId || undefined,
        message,
        sourceModule: PLUGIN_ID,
        reason: "fob_deploy_warning",
        relatedEventId: text(event?.eventId) || undefined,
        system: true,
      });

      if (result?.success) success += 1;
      else failed += 1;
    }

    state.dispatchCount += success;
    state.failedCount += failed;
    state.lastDispatchAt = new Date().toISOString();
    state.lastError = failed > 0 ? `partial_failed_${failed}` : "";

    pluginLogger?.info?.(
      `[FobDeployWarning] dispatched team=${context.teamId} squad=${context.squadId} success=${success} failed=${failed} leader=${context.leaderName} squadName=${context.squadName}`,
    );
  }

  async function handleRawLogLine(event = {}) {
    state.receivedCount += 1;
    if (!isActive()) return;

    const rawLog = text(event?.rawLog ?? event?.rawEvent?.Raw);
    if (!rawLog) return;

    const parsed = parseRawFobPlacement(rawLog);
    if (!parsed) return;

    state.matchedCount += 1;
    state.lastTriggerAt = new Date().toISOString();

    cleanupDedupe();
    const dedupeSignature = [
      resolveServerId(event),
      String(parsed.teamId),
      String(parsed.squadId),
      text(event?.logTime) || rawLog,
    ].join("|");

    if (dedupeKeys.has(dedupeSignature)) {
      state.skippedCount += 1;
      return;
    }
    dedupeKeys.set(dedupeSignature, Date.now() + runtimeConfig.dedupeWindowMs);

    await dispatchTeamWarning(event, parsed);
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "FOB 部署警告",
      kind: "plugin",
      version: "1.0.0",
      description: "监听 FOB 部署日志，向对应阵营全体玩家发送警告消息。",
      category: "Warning",
    },

    apiName: "fobDeployWarning",

    api: {
      getState() {
        return {
          ...state,
          enabled: runtimeConfig.enabled,
          subscribed: isSubscribed(),
          active: isActive(),
          config: { ...runtimeConfig },
          dedupeSize: dedupeKeys.size,
        };
      },

      reloadConfig() {
        runtimeConfig = readRuntimeConfig(config);
        state.enabled = runtimeConfig.enabled;
        return this.getState();
      },
    },

    async start() {
      runtimeConfig = readRuntimeConfig(config);
      state.enabled = runtimeConfig.enabled;

      if (typeof core?.eventBus?.onCoreEvent !== "function") {
        pluginLogger?.warn?.("[FobDeployWarning] core event bus unavailable.");
        return;
      }

      unsubscribers.push(core.eventBus.onCoreEvent(RAW_EVENT_NAME, (event) => {
        void enqueue(() => handleRawLogLine(event));
      }));

      pluginLogger?.info?.("[FobDeployWarning] started.");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe(); } catch {}
      }
      dedupeKeys.clear();
      pluginLogger?.info?.("[FobDeployWarning] stopped.");
    },
  };
}

function readRuntimeConfig(config) {
  const raw =
    config?.get?.(`plugins.${CONFIG_KEY}`, null)
    ?? config?.get?.(`plugins.${PLUGIN_ID}`, null)
    ?? config?.get?.(`plugins.plugin.${CONFIG_KEY}`, null)
    ?? {};

  return {
    enabled: raw.enabled !== false,
    refreshSquadsBeforeResolve: raw.refreshSquadsBeforeResolve !== false,
    dedupeWindowMs: clamp(toInt(raw.dedupeWindowMs), 1000, 120000, 12000),
    messageTemplate: text(raw.messageTemplate) || DEFAULT_MESSAGE_TEMPLATE,
  };
}

function text(value) {
  return String(value ?? "").trim();
}

function toInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
