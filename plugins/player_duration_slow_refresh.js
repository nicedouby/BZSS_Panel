// -*- coding: utf-8 -*-

const LOG_SCOPE = "PlayerDurationSlowRefresh";
const MATCH_REFRESH_INTERVAL_MS = 10_000;
const DATA_REFRESH_INTERVAL_MS = 60_000;
const REFRESH_COOLDOWN_MS = 30 * 60_000;

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

function formatHours(seconds) {
  return (Math.max(0, Number(seconds) || 0) / 3600).toFixed(1);
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

function collectCurrentMatchPlayers(matchState) {
  const overview = matchState?.getOverview?.() ?? matchState?.api?.getOverview?.() ?? null;
  const players = Array.isArray(overview?.players)
    ? overview.players
    : Array.isArray(overview?.matchState?.players?.list)
      ? overview.matchState.players.list
      : Array.isArray(overview?.matchState?.players?.active)
        ? overview.matchState.players.active
        : [];

  return players.map((player) => normalizePlayerCandidate(player, "current-match")).filter(Boolean);
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
    refreshTaggedAtBySteamID: new Map(),
    lastSuccessAt: null,
    lastErrorAt: null,
    lastDelayMs: null,
    lastSelectedSource: null,
    totalSuccess: 0,
    totalFailed: 0,
  };

  function isCoolingDown(steamID) {
    const taggedAt = Number(state.refreshTaggedAtBySteamID.get(steamID) || 0) || 0;
    if (!taggedAt) return false;
    const isCool = Date.now() - taggedAt < REFRESH_COOLDOWN_MS;
    if (!isCool) {
      state.refreshTaggedAtBySteamID.delete(steamID);
    }
    return isCool;
  }

  function markRefreshTag(steamID) {
    const nowTime = Date.now();
    state.refreshTaggedAtBySteamID.set(steamID, nowTime);
    for (const [id, taggedAt] of state.refreshTaggedAtBySteamID.entries()) {
      if (nowTime - taggedAt >= REFRESH_COOLDOWN_MS) {
        state.refreshTaggedAtBySteamID.delete(id);
      }
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
    markRefreshTag(player.steamID);

    try {
      const sourceLabel = source === "current-match" ? "当前对局" : "数据";
      log.info(`开始刷新${sourceLabel}玩家时长：${player.name} steam=${player.steamID}`);

      const seconds = await fetchGameDurationSeconds(steamGameDurationService, player.steamID, player.name);
      await playerRepository.updateGameDuration(playerId, seconds);

      state.refreshedThisRound.add(playerId);
      state.lastSuccessAt = Date.now();
      state.totalSuccess += 1;

      log.info(
        `玩家时长刷新成功：${player.name} steam=${player.steamID} seconds=${seconds} hours=${formatHours(seconds)} source=${source}`,
      );
      return true;
    } catch (error) {
      state.lastErrorAt = Date.now();
      state.totalFailed += 1;
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
    const currentMatchPlayers = collectCurrentMatchPlayers(modules?.matchState);
    const eligibleCurrentPlayers = currentMatchPlayers.filter((player) => !isCoolingDown(player.steamID));

    if (eligibleCurrentPlayers.length > 0) {
      return {
        player: eligibleCurrentPlayers[0],
        source: "current-match",
        intervalMs: MATCH_REFRESH_INTERVAL_MS,
        totalCount: currentMatchPlayers.length,
        eligibleCount: eligibleCurrentPlayers.length,
      };
    }

    const players = await playerRepository.listPlayersWithSteamID({ limit: 100, order: "ASC" });
    const list = (Array.isArray(players) ? players : [])
      .map((player) => normalizePlayerCandidate(player, "database"))
      .filter(Boolean);
    const eligibleDatabasePlayers = list.filter((player) => !isCoolingDown(player.steamID));

    if (eligibleDatabasePlayers.length > 0) {
      return {
        player: eligibleDatabasePlayers[0],
        source: "database",
        intervalMs: DATA_REFRESH_INTERVAL_MS,
        totalCount: list.length,
        eligibleCount: eligibleDatabasePlayers.length,
      };
    }

    return {
      player: null,
      source: "idle",
      intervalMs: DATA_REFRESH_INTERVAL_MS,
      totalCount: list.length,
      eligibleCount: 0,
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

          if (!target.player) {
            log.info(`第 ${state.round} 轮没有可刷新的玩家，${Math.round(target.intervalMs / 1000)} 秒后重试。`);
            if (!state.stopRequested) {
              await sleepImpl(target.intervalMs);
            }
            continue;
          }

          log.info(
            `第 ${state.round} 轮刷新 ${target.source === "current-match" ? "当前对局" : "数据"} 玩家：${target.player.name} steam=${target.player.steamID}，间隔=${Math.round(target.intervalMs / 1000)} 秒`,
          );

          await processPlayer(target.player, target.source);

          if (!state.stopRequested) {
            await sleepImpl(target.intervalMs);
          }
        } catch (error) {
          state.lastErrorAt = Date.now();
          state.totalFailed += 1;
          log.error(`玩家时长慢速刷新循环失败：${error?.stack || error}`);
          if (!state.stopRequested) {
            await sleepImpl(DATA_REFRESH_INTERVAL_MS);
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
      return {
        ...state,
        refreshedThisRound: Array.from(state.refreshedThisRound),
        refreshTaggedAtBySteamID: Object.fromEntries(state.refreshTaggedAtBySteamID),
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
