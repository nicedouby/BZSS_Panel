// -*- coding: utf-8 -*-

const LOG_SCOPE = "PlayerDurationSlowRefresh";

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
    round: 0,
    refreshedThisRound: new Set(),
    lastSuccessAt: null,
    lastErrorAt: null,
    totalSuccess: 0,
    totalFailed: 0,
  };

  async function processPlayer(player) {
    const playerName = cleanText(player?.current_name ?? player?.currentName ?? player?.name, "未知玩家");
    const steamID = normalizeSteamID(player?.steam_id ?? player?.steamID ?? player?.steam64);

    if (!steamID) {
      log.warn(`玩家无 SteamID 跳过：${playerName}`);
      return;
    }

    state.currentPlayerId = player?.id ?? null;
    state.currentSteamID = steamID;

    try {
      log.info(`开始刷新玩家时长：${playerName} steam=${steamID}`);

      const seconds = await fetchGameDurationSeconds(steamGameDurationService, steamID, playerName);
      await playerRepository.updateGameDuration(player.id, seconds);

      state.refreshedThisRound.add(player.id);
      state.lastSuccessAt = Date.now();
      state.totalSuccess += 1;

      log.info(
        `玩家时长刷新成功：${playerName} steam=${steamID} seconds=${seconds} hours=${formatHours(seconds)}`,
      );
    } catch (error) {
      state.lastErrorAt = Date.now();
      state.totalFailed += 1;
      log.warn(
        `玩家时长刷新失败：${playerName} steam=${steamID} error=${error?.message || error}`,
      );
    } finally {
      state.currentPlayerId = null;
      state.currentSteamID = null;
    }
  }

  async function loop() {
    if (state.running) return;

    if (!playerRepository?.listPlayersWithSteamID || !playerRepository?.updateGameDuration) {
      log.warn("玩家时长慢速刷新插件未启动：playerRepository 不可用");
      return;
    }

    if (!steamGameDurationService) {
      log.warn("玩家时长慢速刷新插件未启动：steamGameDurationService 不可用");
      return;
    }

    state.running = true;
    state.stopRequested = false;

    log.info("玩家时长慢速刷新插件已启动");

    try {
      while (!state.stopRequested) {
        state.round += 1;
        state.refreshedThisRound.clear();

        let players = [];
        try {
          players = await playerRepository.listPlayersWithSteamID();
          const list = Array.isArray(players) ? players : [];

          log.info(`开始第 ${state.round} 轮玩家时长刷新，玩家数=${list.length}`);

          for (const player of list) {
            if (state.stopRequested) break;
            await processPlayer(player);
            if (state.stopRequested) break;
            await sleepImpl(10_000);
          }

          log.info(
            `第 ${state.round} 轮玩家时长刷新结束，完成=${state.refreshedThisRound.size}/${list.length}`,
          );

          if (!list.length && !state.stopRequested) {
            await sleepImpl(10_000);
          }
        } catch (error) {
          state.lastErrorAt = Date.now();
          state.totalFailed += 1;
          log.error(`第 ${state.round} 轮玩家时长刷新失败：${error?.stack || error}`);
          if (!state.stopRequested) {
            await sleepImpl(10_000);
          }
        }
      }
    } finally {
      state.running = false;
      state.currentPlayerId = null;
      state.currentSteamID = null;
      log.info("玩家时长慢速刷新插件已停止");
    }
  }

  const api = {
    getState() {
      return {
        ...state,
        refreshedThisRound: Array.from(state.refreshedThisRound),
      };
    },
  };

  return {
    manifest: {
      id: "plugin.player_duration_slow_refresh",
      name: "Player Duration Slow Refresh",
      kind: "plugin",
      version: "0.1.0",
      description: "后台慢速轮询玩家 Steam Squad 时长，单线程顺序写回 players.game_seconds。",
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
