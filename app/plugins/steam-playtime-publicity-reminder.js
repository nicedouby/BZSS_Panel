// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.steam-playtime-publicity-reminder";
const PLUGIN_CONFIG_KEY = "steam-playtime-publicity-reminder";

const DEFAULT_START_AFTER_SECONDS = 300;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_LEADER_WARNING_INTERVAL_MS = 10_000;
const DEFAULT_BROADCAST_BATCH_SIZE = 5;
const DEFAULT_BROADCAST_BATCH_INTERVAL_MS = 120_000;
const DEFAULT_BROADCAST_CYCLE_COOLDOWN_MS = 600_000;
const DEFAULT_WARNING_MESSAGE = "你的steam个人资料尚未公开\n为了其他玩家的游戏体验，请公开你的steam个人资料";
const DEFAULT_BROADCAST_PREFIX = "当前未公开steam个人资料的玩家有";

export function createPlugin({ core, modules, config, logger } = {}) {
  const log = logger ?? core?.logger ?? console;
  let cfg = readConfig(config);
  let timer = null;
  let chain = Promise.resolve();
  const unsubscribers = [];
  const nextLeaderWarningAt = new Map();

  const state = {
    roundKey: "",
    blockedRoundKey: "",
    lastClockSeconds: 0,
    warningCount: 0,
    warningFailureCount: 0,
    broadcastCount: 0,
    broadcastFailureCount: 0,
    confirmedPrivateCount: 0,
    privateLeaderCount: 0,
    broadcastCycleIds: [],
    broadcastCursor: 0,
    nextBroadcastAtMs: 0,
    lastWarningAt: "",
    lastBroadcastAt: "",
    lastBroadcastIds: [],
    lastError: "",
  };

  const enqueue = (fn) => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return cfg.enabled && isSubscribed();
  }

  function resetRound(roundKey = "") {
    state.roundKey = text(roundKey);
    state.blockedRoundKey = "";
    state.lastClockSeconds = 0;
    state.confirmedPrivateCount = 0;
    state.privateLeaderCount = 0;
    state.broadcastCycleIds = [];
    state.broadcastCursor = 0;
    state.nextBroadcastAtMs = 0;
    state.lastBroadcastIds = [];
    state.lastError = "";
    nextLeaderWarningAt.clear();
  }

  function clock() {
    const status = core?.webStatus?.getSnapshot?.() ?? core?.webStatus ?? {};
    const match = modules?.matchState?.getState?.() ?? {};
    const round = modules?.matchState?.getRoundState?.()?.current ?? match?.round?.current;
    const serverId = text(status.serverId ?? core?.webStatus?.serverId ?? match.serverId) || "server";
    const identity = text(round?.dedupeKey)
      || [round?.logLineTime, round?.worldPath, round?.serverPlayAt].map(text).filter(Boolean).join("|")
      || [status.logClockAnchorLogTime, status.logClockLastResetAt].map(text).filter(Boolean).join("|");
    const seconds = Math.max(0, Math.floor(Number(status.logClockSeconds) || 0));
    return {
      seconds,
      roundKey: identity ? `${serverId}|${identity}` : "",
      trusted: Boolean(status.logClockHasAnchor) && !status.logClockManual && Boolean(identity),
    };
  }

  function roster() {
    const overview = modules?.matchState?.getOverview?.() ?? {};
    const match = overview.matchState ?? modules?.matchState?.getState?.() ?? {};
    const serverId = text(core?.webStatus?.serverId ?? overview?.status?.serverId ?? match.serverId);
    const basePlayers = Array.isArray(overview.players) ? overview.players : match?.players?.list ?? [];
    const statePlayers = serverId
      ? (modules?.playerState?.getPlayerList?.(serverId) ?? modules?.playerState?.getOnlinePlayers?.(serverId) ?? [])
      : [];
    const corePlayers = modules?.bzssCoreMonitor?.getPlayers?.() ?? modules?.bzssCoreMonitor?.getTelemetryPlayers?.() ?? [];

    return mergePlayers([basePlayers, statePlayers, corePlayers])
      .filter((player) => player.name && player.online !== false && player.stale !== true);
  }

  async function resolveConfirmedPrivate(players) {
    const result = [];
    const queue = dedupePlayers(players);
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const player = queue.shift();
        if (!player?.steamID) continue;
        try {
          const row = await modules?.playtime?.getBySteamID?.(player.steamID);
          if (isConfirmedPrivatePlaytimeRow(row)) result.push(player);
        } catch (error) {
          log?.debug?.(`[SteamPlaytimePublicityReminder] cached playtime lookup failed for ${player.steamID}: ${error.message}`);
        }
      }
    });
    await Promise.all(workers);
    return result;
  }

  async function sendWarning(player, reason) {
    const warner = modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn;
    if (typeof warner !== "function") {
      state.warningFailureCount += 1;
      state.lastError = "adminWarn warn API unavailable";
      return false;
    }

    try {
      const result = await warner.call(modules.adminWarn, {
        targetName: player.name,
        targetPlayerId: player.playerID || undefined,
        targetSteamId: player.steamID || undefined,
        targetEosId: player.eosID || undefined,
        message: cfg.warningMessage,
        reason,
        sourceModule: PLUGIN_ID,
        relatedEventId: `${state.roundKey}:${player.steamID || player.playerID || player.name}`,
        system: true,
      });
      if (result?.success === false) {
        state.warningFailureCount += 1;
        state.lastError = result?.errorMessage || "warn_failed";
        return false;
      }
      state.warningCount += 1;
      state.lastWarningAt = new Date().toISOString();
      return true;
    } catch (error) {
      state.warningFailureCount += 1;
      state.lastError = error?.message || String(error);
      log?.warn?.(`[SteamPlaytimePublicityReminder] warning failed: ${state.lastError}`);
      return false;
    }
  }

  async function sendBroadcast(playerIds, reason) {
    const ids = playerIds.map((value) => text(value)).filter(Boolean);
    if (!ids.length) return false;
    const broadcaster = modules?.adminWarn?.sendAdminBroadcast ?? modules?.adminWarn?.broadcastMessage;
    if (typeof broadcaster !== "function") {
      state.broadcastFailureCount += 1;
      state.lastError = "adminWarn broadcast API unavailable";
      return false;
    }

    const message = `${cfg.broadcastPrefix}\n${ids.join("  ")}`;
    try {
      const result = await broadcaster.call(modules.adminWarn, {
        message,
        reason,
        sourceModule: PLUGIN_ID,
        relatedEventId: `${state.roundKey}:broadcast:${state.broadcastCursor}`,
        system: true,
      });
      if (result?.success === false) {
        state.broadcastFailureCount += 1;
        state.lastError = result?.errorMessage || "broadcast_failed";
        return false;
      }
      state.broadcastCount += 1;
      state.lastBroadcastAt = new Date().toISOString();
      state.lastBroadcastIds = ids;
      return true;
    } catch (error) {
      state.broadcastFailureCount += 1;
      state.lastError = error?.message || String(error);
      log?.warn?.(`[SteamPlaytimePublicityReminder] broadcast failed: ${state.lastError}`);
      return false;
    }
  }

  async function processLeaderWarnings(privateLeaders, nowMs) {
    state.privateLeaderCount = privateLeaders.length;
    const activeKeys = new Set();

    for (const player of privateLeaders) {
      const key = player.steamID || player.eosID || player.playerID || player.name;
      if (!key) continue;
      activeKeys.add(key);
      const nextAt = Number(nextLeaderWarningAt.get(key) || 0);
      if (nowMs < nextAt) continue;
      await sendWarning(player, "steam_playtime_profile_private");
      nextLeaderWarningAt.set(key, nowMs + cfg.leaderWarningIntervalMs);
    }

    for (const key of [...nextLeaderWarningAt.keys()]) {
      if (!activeKeys.has(key)) nextLeaderWarningAt.delete(key);
    }
  }

  async function processBroadcastCycle(privatePlayers, nowMs) {
    if (nowMs < state.nextBroadcastAtMs) return;

    if (!state.broadcastCycleIds.length || state.broadcastCursor >= state.broadcastCycleIds.length) {
      const ids = [...new Set(
        privatePlayers
          .map((player) => player.playerID)
          .filter(isNumericPlayerId),
      )].sort(compareNumericIds);

      state.broadcastCycleIds = ids;
      state.broadcastCursor = 0;

      if (!ids.length) {
        state.nextBroadcastAtMs = nowMs + cfg.broadcastCycleCooldownMs;
        return;
      }
    }

    const currentPrivateIds = new Set(
      privatePlayers.map((player) => player.playerID).filter(isNumericPlayerId),
    );

    let batch = [];
    while (state.broadcastCursor < state.broadcastCycleIds.length && batch.length === 0) {
      const candidates = state.broadcastCycleIds.slice(
        state.broadcastCursor,
        state.broadcastCursor + cfg.broadcastBatchSize,
      );
      state.broadcastCursor += cfg.broadcastBatchSize;
      batch = candidates.filter((playerId) => currentPrivateIds.has(playerId));
    }

    if (batch.length) {
      await sendBroadcast(batch, "steam_playtime_private_roster");
    }

    if (state.broadcastCursor >= state.broadcastCycleIds.length) {
      state.broadcastCycleIds = [];
      state.broadcastCursor = 0;
      state.nextBroadcastAtMs = nowMs + cfg.broadcastCycleCooldownMs;
    } else {
      state.nextBroadcastAtMs = nowMs + cfg.broadcastBatchIntervalMs;
    }
  }

  async function evaluate(reason = "poll", nowMs = Date.now()) {
    cfg = readConfig(config);
    if (!isActive()) return publicState();

    const current = clock();
    state.lastClockSeconds = current.seconds;
    if (!current.trusted) return publicState();

    if (state.blockedRoundKey) {
      if (current.roundKey === state.blockedRoundKey) return publicState();
      state.blockedRoundKey = "";
    }

    if (state.roundKey !== current.roundKey) {
      resetRound(current.roundKey);
      state.lastClockSeconds = current.seconds;
    }

    if (current.seconds < cfg.startAfterSeconds) return publicState();

    const players = roster();
    const leaderCandidates = players.filter((player) => player.isLeader && player.teamID && player.squadID);
    const broadcastDue = nowMs >= state.nextBroadcastAtMs;
    const privatePlayers = broadcastDue ? await resolveConfirmedPrivate(players) : null;
    const privateLeaders = privatePlayers
      ? privatePlayers.filter((player) => player.isLeader && player.teamID && player.squadID)
      : await resolveConfirmedPrivate(leaderCandidates);

    if (privatePlayers) state.confirmedPrivateCount = privatePlayers.length;
    await processLeaderWarnings(privateLeaders, nowMs);
    if (privatePlayers) await processBroadcastCycle(privatePlayers, nowMs);

    if (!state.lastError || reason === "poll") state.lastError = "";
    return publicState();
  }

  const publicState = () => ({
    ...state,
    enabled: cfg.enabled,
    subscribed: isSubscribed(),
    active: isActive(),
    config: { ...cfg },
    trackedLeaderWarningCount: nextLeaderWarningAt.size,
  });

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "督促时长公开",
      kind: "plugin",
      version: "1.0.2",
      category: "Moderation",
      description: "开局5分钟后持续提醒未公开 Steam 时长的小队长，并分批广播已确认未公开资料的在线玩家数字ID。",
      configSchema: [
        { key: "enabled", type: "boolean", default: true, description: "是否启用插件" },
        { key: "startAfterSeconds", type: "number", default: 300, description: "开局多少秒后启用提醒和广播" },
        { key: "leaderWarningIntervalMs", type: "number", default: 10000, description: "未公开资料的小队长重复警告间隔" },
        { key: "broadcastBatchSize", type: "number", default: 5, description: "每批广播的玩家数字ID数量" },
        { key: "broadcastBatchIntervalMs", type: "number", default: 120000, description: "同一轮广播不同批次之间的间隔" },
        { key: "broadcastCycleCooldownMs", type: "number", default: 600000, description: "完整广播一轮后的冷却时间" },
        { key: "pollIntervalMs", type: "number", default: 1000, description: "插件检查周期" },
        { key: "warningMessage", type: "string", default: DEFAULT_WARNING_MESSAGE, description: "发送给小队长的警告内容" },
        { key: "broadcastPrefix", type: "string", default: DEFAULT_BROADCAST_PREFIX, description: "公开广播前缀" },
      ],
    },

    apiName: "steamPlaytimePublicityReminder",
    api: {
      getState: publicState,
      evaluateNow: (nowMs = Date.now()) => enqueue(() => evaluate("manual", nowMs)),
      resetRound: () => enqueue(async () => {
        resetRound("");
        return publicState();
      }),
      reloadConfig: () => {
        cfg = readConfig(config);
        return publicState();
      },
      getRosterDiagnostics: async () => {
        const players = roster();
        const privatePlayers = await resolveConfirmedPrivate(players);
        return {
          players,
          confirmedPrivatePlayers: privatePlayers,
          privateLeaders: privatePlayers.filter((player) => player.isLeader && player.teamID && player.squadID),
        };
      },
    },

    async start() {
      cfg = readConfig(config);
      if (!isActive()) {
        log?.info?.("[SteamPlaytimePublicityReminder] plugin disabled or unsubscribed.");
        return;
      }

      if (core?.eventBus?.onCoreEvent) {
        unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", () => {
          void enqueue(async () => {
            const oldRoundKey = state.roundKey || clock().roundKey;
            resetRound("");
            state.blockedRoundKey = oldRoundKey;
          });
        }));
      }

      timer = setInterval(() => void enqueue(() => evaluate("poll")), cfg.pollIntervalMs);
      timer.unref?.();
      void enqueue(() => evaluate("startup"));
      log?.info?.(`[SteamPlaytimePublicityReminder] started. start=${cfg.startAfterSeconds}s warn=${cfg.leaderWarningIntervalMs}ms batch=${cfg.broadcastBatchSize}/${cfg.broadcastBatchIntervalMs}ms cooldown=${cfg.broadcastCycleCooldownMs}ms`);
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe(); } catch {}
      }
      nextLeaderWarningAt.clear();
      await chain.catch(() => {});
      log?.info?.("[SteamPlaytimePublicityReminder] stopped.");
    },
  };
}

function readConfig(config) {
  const raw = config?.get?.(`plugins.${PLUGIN_CONFIG_KEY}`, null)
    ?? config?.get?.(`plugins.${PLUGIN_ID}`, null)
    ?? config?.get?.(`plugins.plugin.${PLUGIN_CONFIG_KEY}`, null)
    ?? {};

  return {
    enabled: raw.enabled !== false,
    startAfterSeconds: number(raw.startAfterSeconds, DEFAULT_START_AFTER_SECONDS, 0, 86400),
    pollIntervalMs: number(raw.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 250, 30000),
    leaderWarningIntervalMs: number(raw.leaderWarningIntervalMs, DEFAULT_LEADER_WARNING_INTERVAL_MS, 1000, 3600000),
    broadcastBatchSize: number(raw.broadcastBatchSize, DEFAULT_BROADCAST_BATCH_SIZE, 1, 20),
    broadcastBatchIntervalMs: number(raw.broadcastBatchIntervalMs, DEFAULT_BROADCAST_BATCH_INTERVAL_MS, 1000, 3600000),
    broadcastCycleCooldownMs: number(raw.broadcastCycleCooldownMs, DEFAULT_BROADCAST_CYCLE_COOLDOWN_MS, 1000, 86400000),
    warningMessage: text(raw.warningMessage) || DEFAULT_WARNING_MESSAGE,
    broadcastPrefix: text(raw.broadcastPrefix) || DEFAULT_BROADCAST_PREFIX,
  };
}

function isConfirmedPrivatePlaytimeRow(row) {
  if (!row || typeof row !== "object") return false;
  const fetchedAt = Number(row.fetched_at ?? row.fetchedAt ?? 0);
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return false;

  const rawSeconds = row.steam_game_seconds
    ?? row.steamGameSeconds
    ?? row.game_seconds
    ?? row.gameSeconds;
  if (rawSeconds == null || String(rawSeconds).trim() === "") return false;
  const seconds = Number(rawSeconds);
  return Number.isFinite(seconds) && seconds === 0;
}

function mergePlayers(sources) {
  const output = [];
  const indexes = new Map();

  for (const source of sources ?? []) {
    for (const raw of Array.isArray(source) ? source : []) {
      const next = normalizePlayer(raw);
      if (!next.name) continue;
      const keys = identityKeys(next);
      const index = keys.map((key) => indexes.get(key)).find((value) => value != null);
      if (index == null) output.push(next);
      else output[index] = mergePlayer(output[index], next);
      const resolvedIndex = index ?? output.length - 1;
      for (const key of identityKeys(output[resolvedIndex])) indexes.set(key, resolvedIndex);
    }
  }

  return output;
}

function normalizePlayer(raw) {
  return {
    playerID: id(raw?.playerID ?? raw?.playerId ?? raw?.playerIndex ?? raw?.id ?? raw?.rcon?.playerID),
    name: text(raw?.name ?? raw?.playerName ?? raw?.displayName ?? raw?.rcon?.name),
    steamID: text(raw?.steamID ?? raw?.steamId ?? raw?.steam64ID ?? raw?.steam64 ?? raw?.rcon?.steamID),
    eosID: text(raw?.eosID ?? raw?.eosId ?? raw?.eos ?? raw?.rcon?.eosID),
    teamID: id(raw?.teamID ?? raw?.teamId ?? raw?.team ?? raw?.rcon?.teamID),
    squadID: id(raw?.squadID ?? raw?.squadId ?? raw?.squad ?? raw?.rcon?.squadID),
    isLeader: Boolean(raw?.isLeader ?? raw?.isSquadLeader ?? raw?.rcon?.isLeader),
    online: raw?.online ?? raw?.rcon?.online,
    stale: raw?.stale,
  };
}

function mergePlayer(base, overlay) {
  const online = base.online === true || overlay.online === true ? true : (overlay.online ?? base.online);
  return {
    playerID: overlay.playerID || base.playerID,
    name: overlay.name || base.name,
    steamID: overlay.steamID || base.steamID,
    eosID: overlay.eosID || base.eosID,
    teamID: overlay.teamID || base.teamID,
    squadID: overlay.squadID || base.squadID,
    isLeader: base.isLeader || overlay.isLeader,
    online,
    stale: online === true ? false : (overlay.stale ?? base.stale),
  };
}

function identityKeys(player) {
  return [
    player.steamID ? `steam:${player.steamID}` : "",
    player.eosID ? `eos:${player.eosID}` : "",
    player.playerID ? `player:${player.playerID}` : "",
  ].filter(Boolean);
}

function dedupePlayers(players) {
  const seen = new Set();
  const result = [];
  for (const player of players ?? []) {
    const key = player.steamID || player.eosID || player.playerID || player.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(player);
  }
  return result;
}

function isNumericPlayerId(value) {
  return /^\d+$/u.test(text(value));
}

function compareNumericIds(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return String(a).localeCompare(String(b), "en");
}

function number(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function text(value) {
  return String(value ?? "").trim();
}

function id(value) {
  const normalized = text(value);
  return normalized && normalized !== "0" && normalized.toLowerCase() !== "n/a" ? normalized : "";
}

export const __test = {
  isConfirmedPrivatePlaytimeRow,
  mergePlayers,
};

export default { createPlugin };
