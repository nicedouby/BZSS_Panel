// -*- coding: utf-8 -*-

const LOG_SCOPE = "PlayerDurationSlowRefresh";
const CURRENT_REFRESH_INTERVALS_MS = [15_000, 30_000, 60_000];
const DATABASE_REFRESH_INTERVALS_MS = [120_000, 300_000, 600_000];
const IDLE_REFRESH_INTERVALS_MS = [300_000, 600_000, 1200_000];
const FAILURE_REFRESH_INTERVALS_MS = [180_000, 600_000, 1800_000];
const DATABASE_REFRESH_COOLDOWN_MS = 30 * 60_000;
const SCHEDULE_LOG_INTERVAL_MS = 10 * 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeSteamID(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function pickInterval(intervals, streak = 0) {
  const index = Math.max(0, Math.min(intervals.length - 1, Math.floor(Number(streak) || 0)));
  return intervals[index];
}

function resolveGameSeconds(result) {
  if (typeof result === "number") {
    return Math.max(0, Math.floor(result));
  }

  if (result && typeof result === "object") {
    return Math.max(
      0,
      Math.floor(Number(result.gameSeconds ?? result.game_seconds ?? result.seconds ?? 0) || 0),
    );
  }

  return 0;
}

async function fetchGameDurationSeconds(service, steamID, playerName) {
  if (!service) {
    throw new Error("Steam duration service is unavailable.");
  }

  if (typeof service.fetchGameDurationSeconds === "function") {
    const result = await service.fetchGameDurationSeconds(steamID);
    return resolveGameSeconds(result);
  }

  if (typeof service.lookupSteamID === "function") {
    const result = await service.lookupSteamID(steamID, {
      lastSeenName: playerName || null,
    });
    return resolveGameSeconds(result);
  }

  if (typeof service.lookupSteamDuration === "function") {
    const result = await service.lookupSteamDuration(steamID, {
      lastSeenName: playerName || null,
    });
    return resolveGameSeconds(result);
  }

  throw new Error("Steam duration service does not expose a supported lookup method.");
}

function normalizePlayerCandidate(player, source = "database") {
  const steamID = normalizeSteamID(player?.steam_id ?? player?.steamID ?? player?.steam64 ?? player?.SteamID);
  if (!steamID) return null;

  return {
    id: player?.id == null ? null : Number(player.id),
    name: cleanText(player?.current_name ?? player?.currentName ?? player?.name, "未知玩家"),
    steamID,
    eosID: normalizeSteamID(player?.eos_id ?? player?.eosID ?? player?.eos ?? player?.EOSID) || null,
    source,
  };
}

function collectCurrentMatchContext(matchState) {
  const overview = matchState?.getOverview?.() ?? matchState?.api?.getOverview?.() ?? null;
  const matchSnapshot = overview?.matchState ?? overview ?? null;
  const rawPlayers = Array.isArray(overview?.players)
    ? overview.players
    : Array.isArray(matchSnapshot?.players?.list)
      ? matchSnapshot.players.list
      : Array.isArray(matchSnapshot?.players?.active)
        ? matchSnapshot.players.active
        : [];

  const players = rawPlayers
    .map((player) => normalizePlayerCandidate(player, "current-match"))
    .filter(Boolean);

  const revision = Number(matchSnapshot?.revision ?? overview?.revision ?? 0) || 0;
  const updatedAt = String(matchSnapshot?.updatedAt ?? overview?.updatedAt ?? "");
  const fingerprint = `${revision}::${updatedAt}::${players.map((player) => player.steamID).join("|")}`;

  return {
    overview,
    matchSnapshot,
    players,
    revision,
    updatedAt,
    fingerprint,
  };
}

export function createPlugin(context = {}) {
  const {
    core = null,
    modules = {},
    logger = null,
    sleep: sleepImpl = sleep,
  } = context;

  const log = logger?.child?.({ scope: LOG_SCOPE }) ?? core?.logger?.child?.({ scope: LOG_SCOPE }) ?? logger ?? core?.logger ?? console;
  const playerRepository = context.playerRepository ?? modules?.playerDatabase ?? null;
  const steamGameDurationService = context.steamGameDurationService ?? modules?.playtime ?? null;

  const state = {
    running: false,
    stopRequested: false,
    currentPlayerId: null,
    currentSteamID: null,
    currentSource: null,
    round: 0,
    refreshedThisRound: new Set(),
    currentMatchRefreshedSteamIDs: new Set(),
    databaseRefreshTaggedAtBySteamID: new Map(),
    matchRevision: null,
    matchUpdatedAt: "",
    matchFingerprint: "",
    matchStableLoops: 0,
    currentMatchCursor: 0,
    databaseCursor: 0,
    databaseStableLoops: 0,
    idleStreak: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastDelayMs: null,
    lastSelectedSource: null,
    lastTargetSteamID: null,
    lastGameSeconds: null,
    currentMatchEligibleCount: 0,
    databaseEligibleCount: 0,
    totalSuccess: 0,
    totalFailed: 0,
    lastScheduleLogAt: 0,
    lastScheduleLogKey: "",
  };

  function isDatabaseCoolingDown(steamID) {
    const taggedAt = Number(state.databaseRefreshTaggedAtBySteamID.get(steamID) || 0) || 0;
    if (!taggedAt) return false;

    const isCooling = Date.now() - taggedAt < DATABASE_REFRESH_COOLDOWN_MS;
    if (!isCooling) {
      state.databaseRefreshTaggedAtBySteamID.delete(steamID);
    }
    return isCooling;
  }

  function markDatabaseRefreshTag(steamID) {
    const now = Date.now();
    state.databaseRefreshTaggedAtBySteamID.set(steamID, now);

    for (const [id, taggedAt] of state.databaseRefreshTaggedAtBySteamID.entries()) {
      if (now - taggedAt >= DATABASE_REFRESH_COOLDOWN_MS) {
        state.databaseRefreshTaggedAtBySteamID.delete(id);
      }
    }
  }

  function setCurrentMatchContext(matchContext) {
    const changed = state.matchFingerprint !== matchContext.fingerprint;
    state.matchRevision = matchContext.revision;
    state.matchUpdatedAt = matchContext.updatedAt;
    state.matchFingerprint = matchContext.fingerprint;

    if (changed) {
      state.currentMatchRefreshedSteamIDs.clear();
      state.refreshedThisRound.clear();
      state.currentMatchCursor = 0;
      state.matchStableLoops = 0;
      state.databaseStableLoops = 0;
      state.idleStreak = 0;
    } else {
      state.matchStableLoops += 1;
    }

    return changed;
  }

  function pickFromList(players, cursorKey) {
    if (!Array.isArray(players) || players.length === 0) {
      return null;
    }

    const start = Number(state[cursorKey] || 0) % players.length;
    for (let offset = 0; offset < players.length; offset += 1) {
      const index = (start + offset) % players.length;
      const player = players[index];
      if (player) {
        state[cursorKey] = (index + 1) % players.length;
        return player;
      }
    }

    return null;
  }

  function computeInterval(source, eligibleCount, matchChanged, explicitStreak = null) {
    if (source === "current-match") {
      if (matchChanged) {
        return CURRENT_REFRESH_INTERVALS_MS[0];
      }
      return pickInterval(
        CURRENT_REFRESH_INTERVALS_MS,
        Math.min(CURRENT_REFRESH_INTERVALS_MS.length - 1, state.matchStableLoops),
      );
    }

    if (source === "database") {
      return pickInterval(
        DATABASE_REFRESH_INTERVALS_MS,
        Math.min(DATABASE_REFRESH_INTERVALS_MS.length - 1, state.databaseStableLoops),
      );
    }

    const streak = explicitStreak == null ? state.idleStreak : explicitStreak;
    return pickInterval(
      IDLE_REFRESH_INTERVALS_MS,
      Math.min(IDLE_REFRESH_INTERVALS_MS.length - 1, streak),
    );
  }

  function sourceLabel(source) {
    if (source === "current-match") return "current-match";
    if (source === "database") return "database";
    return "idle";
  }

  function maybeLogSchedule(target) {
    const now = Date.now();
    const key = [
      target.source,
      target.intervalMs,
      target.totalCount,
      target.eligibleCount > 0 ? "eligible" : "none",
      target.matchChanged ? "match-changed" : "match-stable",
    ].join(":");

    if (key === state.lastScheduleLogKey && now - state.lastScheduleLogAt < SCHEDULE_LOG_INTERVAL_MS) {
      return;
    }

    state.lastScheduleLogKey = key;
    state.lastScheduleLogAt = now;

    const delaySeconds = Math.round(target.intervalMs / 1000);
    if (target.player) {
      log.info(
        `Player duration slow refresh: source=${sourceLabel(target.source)} eligible=${target.eligibleCount}/${target.totalCount} next=${delaySeconds}s target=${target.player.name} steam=${target.player.steamID}`,
      );
    } else {
      log.info(
        `Player duration slow refresh: source=${sourceLabel(target.source)} eligible=0/${target.totalCount} next=${delaySeconds}s`,
      );
    }
  }

  async function resolvePlayerRecord(player) {
    if (player?.id != null) {
      return player;
    }

    if (typeof playerRepository?.findByIdentity === "function") {
      const found = await playerRepository.findByIdentity({
        name: player?.name || null,
        steamID: player?.steamID || null,
        eosID: player?.eosID || null,
      });
      if (found?.id != null) return found;
    }

    if (typeof playerRepository?.upsertFromPresence === "function") {
      return playerRepository.upsertFromPresence({
        name: player?.name || null,
        steamID: player?.steamID || null,
        eosID: player?.eosID || null,
      });
    }

    return null;
  }

  async function processPlayer(candidate, source) {
    const player = normalizePlayerCandidate(candidate, source);
    if (!player) {
      log.warn("玩家缺少 SteamID，已跳过。");
      return false;
    }

    const resolvedPlayer = await resolvePlayerRecord(player);
    const playerId = resolvedPlayer?.id ?? player.id ?? null;
    if (playerId == null) {
      throw new Error(`无法解析玩家数据库记录：${player.name} steam=${player.steamID}`);
    }

    state.currentPlayerId = playerId;
    state.currentSteamID = player.steamID;
    state.currentSource = source;
    state.lastTargetSteamID = player.steamID;

    try {
      const seconds = await fetchGameDurationSeconds(steamGameDurationService, player.steamID, player.name);
      await playerRepository.updateGameDuration(playerId, seconds);

      state.refreshedThisRound.add(playerId);
      if (source === "current-match") {
        state.currentMatchRefreshedSteamIDs.add(player.steamID);
      } else {
        markDatabaseRefreshTag(player.steamID);
      }

      state.lastSuccessAt = Date.now();
      state.totalSuccess += 1;
      state.lastGameSeconds = seconds;
      state.databaseStableLoops = source === "database" ? state.databaseStableLoops + 1 : 0;
      state.idleStreak = 0;
      return true;
    } catch (error) {
      state.lastErrorAt = Date.now();
      state.totalFailed += 1;
      if (source === "database") {
        state.databaseStableLoops = 0;
      }
      log.warn(
        `玩家时长刷新失败：${player.name} steam=${player.steamID} error=${error?.message || error} source=${source}`,
      );
      return false;
    } finally {
      state.currentPlayerId = null;
      state.currentSteamID = null;
      state.currentSource = null;
    }
  }

  async function pickNextTarget() {
    const matchContext = collectCurrentMatchContext(modules?.matchState);
    const matchChanged = setCurrentMatchContext(matchContext);

    const eligibleCurrentPlayers = matchContext.players.filter(
      (player) => !state.currentMatchRefreshedSteamIDs.has(player.steamID),
    );
    state.currentMatchEligibleCount = eligibleCurrentPlayers.length;

    if (eligibleCurrentPlayers.length > 0) {
      const player = pickFromList(eligibleCurrentPlayers, "currentMatchCursor");
      return {
        player,
        source: "current-match",
        matchChanged,
        intervalMs: computeInterval("current-match", eligibleCurrentPlayers.length, matchChanged),
        totalCount: matchContext.players.length,
        eligibleCount: eligibleCurrentPlayers.length,
        matchContext,
      };
    }

    const players = await playerRepository.listPlayersWithSteamID({ limit: 100, order: "ASC" });
    const list = (Array.isArray(players) ? players : [])
      .map((player) => normalizePlayerCandidate(player, "database"))
      .filter(Boolean);
    const eligibleDatabasePlayers = list.filter(
      (player) => !isDatabaseCoolingDown(player.steamID) && !state.currentMatchRefreshedSteamIDs.has(player.steamID),
    );
    state.databaseEligibleCount = eligibleDatabasePlayers.length;

    if (eligibleDatabasePlayers.length > 0) {
      const player = pickFromList(eligibleDatabasePlayers, "databaseCursor");
      return {
        player,
        source: "database",
        matchChanged,
        intervalMs: computeInterval("database", eligibleDatabasePlayers.length, matchChanged),
        totalCount: list.length,
        eligibleCount: eligibleDatabasePlayers.length,
        matchContext,
      };
    }

    const idleStreak = state.idleStreak;
    state.idleStreak = Math.min(state.idleStreak + 1, IDLE_REFRESH_INTERVALS_MS.length - 1);
    return {
      player: null,
      source: "idle",
      matchChanged,
      intervalMs: computeInterval("idle", 0, matchChanged, idleStreak),
      totalCount: list.length,
      eligibleCount: 0,
      matchContext,
    };
  }

  async function loop() {
    if (state.running) return;

    if (!playerRepository?.listPlayersWithSteamID || !playerRepository?.updateGameDuration) {
      log.warn("玩家时长慢速刷新插件未启动：playerRepository 不可用。");
      return;
    }

    if (!steamGameDurationService) {
      log.warn("玩家时长慢速刷新插件未启动：steamGameDurationService 不可用。");
      return;
    }

    state.running = true;
    state.stopRequested = false;

    log.info("玩家时长慢速刷新插件已启动");

    try {
      while (!state.stopRequested) {
        state.round += 1;

        try {
          const target = await pickNextTarget();
          state.lastSelectedSource = target.source;
          state.lastDelayMs = target.intervalMs;
          state.matchRevision = target.matchContext?.revision ?? state.matchRevision;
          state.matchUpdatedAt = target.matchContext?.updatedAt ?? state.matchUpdatedAt;
          state.matchFingerprint = target.matchContext?.fingerprint ?? state.matchFingerprint;
          maybeLogSchedule(target);

          if (!target.player) {
            if (!state.stopRequested) {
              await sleepImpl(target.intervalMs);
            }
            continue;
          }

          const success = await processPlayer(target.player, target.source);
          if (success && target.source === "database") {
            state.databaseStableLoops = Math.min(state.databaseStableLoops, DATABASE_REFRESH_INTERVALS_MS.length - 1);
          }

          if (!state.stopRequested) {
            await sleepImpl(target.intervalMs);
          }
        } catch (error) {
          state.lastErrorAt = Date.now();
          state.totalFailed += 1;
          state.databaseStableLoops = 0;
          log.error(`玩家时长慢速刷新循环失败：${error?.stack || error}`);
          if (!state.stopRequested) {
            const failureDelayMs = pickInterval(
              FAILURE_REFRESH_INTERVALS_MS,
              Math.min(FAILURE_REFRESH_INTERVALS_MS.length - 1, state.totalFailed),
            );
            state.lastDelayMs = failureDelayMs;
            await sleepImpl(failureDelayMs);
          }
        }
      }
    } finally {
      state.running = false;
      state.currentPlayerId = null;
      state.currentSteamID = null;
      state.currentSource = null;
      log.info("玩家时长慢速刷新插件已停止");
    }
  }

  const api = {
    getState() {
      const databaseRefreshTaggedAtBySteamID = Object.fromEntries(state.databaseRefreshTaggedAtBySteamID);
      return {
        ...state,
        refreshedThisRound: Array.from(state.refreshedThisRound),
        currentMatchRefreshedSteamIDs: Array.from(state.currentMatchRefreshedSteamIDs),
        databaseRefreshTaggedAtBySteamID,
        refreshTaggedAtBySteamID: databaseRefreshTaggedAtBySteamID,
      };
    },
  };

  return {
    manifest: {
      id: "plugin.player_duration_slow_refresh",
      name: "Player Duration Slow Refresh",
      kind: "plugin",
      version: "0.1.0",
      description: "后台慢速轮询玩家 Steam Squad 时长，当前对局优先，按冷却标签顺序回写 players.game_seconds。",
    },
    apiName: "playerDurationSlowRefresh",
    api,

    async start() {
      void loop().catch((error) => {
        log.error(`玩家时长慢速刷新插件崩溃：${error?.stack || error}`);
      });
    },

    async stop() {
      state.stopRequested = true;
      if (!state.running) {
        log.info("玩家时长慢速刷新插件已停止");
      }
    },

    getState() {
      return api.getState();
    },
  };
}

export default createPlugin;
