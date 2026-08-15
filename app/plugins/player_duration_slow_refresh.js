// -*- coding: utf-8 -*-

const LOG_SCOPE = "PlayerDurationSlowRefresh";
const CURRENT_REFRESH_INTERVALS_MS = [15_000, 30_000, 60_000];
const DATABASE_REFRESH_INTERVALS_MS = [120_000, 300_000, 600_000];
const IDLE_REFRESH_INTERVALS_MS = [300_000, 600_000, 1200_000];
const FAILURE_REFRESH_INTERVALS_MS = [180_000, 600_000, 1800_000];
const PLAYTIME_REFRESH_COOLDOWN_MS = 10 * 60 * 60_000;
const PROFILE_REFRESH_COOLDOWN_MS = 24 * 60 * 60_000;
const DATABASE_PLAYER_INACTIVE_CUTOFF_MS = 15 * 24 * 60 * 60_000;
const MAX_DATABASE_SCAN_PER_LOOP = 100;
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

function normalizeTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function ageMs(timestamp, nowTs = Date.now()) {
  const ts = normalizeTimestamp(timestamp);
  if (!ts) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowTs - ts);
}

function isFresh(timestamp, freshnessMs, nowTs = Date.now()) {
  const ts = normalizeTimestamp(timestamp);
  return ts > 0 && ageMs(ts, nowTs) < freshnessMs;
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
    updatedAt: normalizeTimestamp(player?.updated_at ?? player?.updatedAt),
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
    inactiveDatabaseSteamIDs: new Set(),
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
    lastPlaytimeFetchedAt: null,
    lastProfileSuccessAt: null,
    currentMatchEligibleCount: 0,
    databaseEligibleCount: 0,
    totalSuccess: 0,
    totalFailed: 0,
    totalSkippedFreshPlaytime: 0,
    totalSkippedInactive: 0,
    totalProfileRefreshes: 0,
    lastScheduleLogAt: 0,
    lastScheduleLogKey: "",
  };

  function isDatabaseCoolingDown(steamID) {
    const taggedAt = Number(state.databaseRefreshTaggedAtBySteamID.get(steamID) || 0) || 0;
    if (!taggedAt) return false;

    const isCooling = Date.now() - taggedAt < PLAYTIME_REFRESH_COOLDOWN_MS;
    if (!isCooling) {
      state.databaseRefreshTaggedAtBySteamID.delete(steamID);
    }
    return isCooling;
  }

  function markDatabaseRefreshTag(steamID, refreshedAt = Date.now()) {
    const ts = normalizeTimestamp(refreshedAt) || Date.now();
    state.databaseRefreshTaggedAtBySteamID.set(steamID, ts);

    const nowTs = Date.now();
    for (const [id, taggedAt] of state.databaseRefreshTaggedAtBySteamID.entries()) {
      if (nowTs - taggedAt >= PLAYTIME_REFRESH_COOLDOWN_MS) {
        state.databaseRefreshTaggedAtBySteamID.delete(id);
      }
    }
  }

  function setCurrentMatchContext(matchContext) {
    const changed = state.matchFingerprint !== matchContext.fingerprint;
    state.matchRevision = matchContext.revision;
    state.matchUpdatedAt = matchContext.updatedAt;
    state.matchFingerprint = matchContext.fingerprint;

    // A player visible in the current match is active by definition. Clear any
    // previous inactive-database suppression immediately when they return.
    for (const player of matchContext.players) {
      state.inactiveDatabaseSteamIDs.delete(player.steamID);
    }

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
    const nowTs = Date.now();
    const key = [
      target.source,
      target.intervalMs,
      target.totalCount,
      target.eligibleCount > 0 ? "eligible" : "none",
      target.matchChanged ? "match-changed" : "match-stable",
    ].join(":");

    if (key === state.lastScheduleLogKey && nowTs - state.lastScheduleLogAt < SCHEDULE_LOG_INTERVAL_MS) {
      return;
    }

    state.lastScheduleLogKey = key;
    state.lastScheduleLogAt = nowTs;

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

  async function getPlaytimeRefreshState(steamID) {
    if (typeof steamGameDurationService?.getBySteamID !== "function") {
      return {
        due: true,
        fetchedAt: 0,
        ageMs: Number.POSITIVE_INFINITY,
      };
    }

    const cached = await steamGameDurationService.getBySteamID(steamID);
    const fetchedAt = normalizeTimestamp(cached?.fetchedAt ?? cached?.fetched_at);
    const cachedAgeMs = ageMs(fetchedAt);
    return {
      due: !fetchedAt || cachedAgeMs >= PLAYTIME_REFRESH_COOLDOWN_MS,
      fetchedAt,
      ageMs: cachedAgeMs,
    };
  }

  async function resolvePlayerLastSeenAt(player) {
    if (player?.source === "current-match") return Date.now();

    const playerId = Number(player?.id);
    if (Number.isFinite(playerId) && typeof playerRepository?.listPlayerAliases === "function") {
      try {
        const aliases = await playerRepository.listPlayerAliases(playerId, { limit: 1, offset: 0 });
        const aliasSeenAt = normalizeTimestamp(aliases?.[0]?.seen_at ?? aliases?.[0]?.seenAt);
        if (aliasSeenAt) return aliasSeenAt;
      } catch (error) {
        log.warn(`读取玩家最后出现时间失败：player=${playerId} error=${error?.message || error}`);
      }
    }

    // Fallback only. players.updated_at can also be touched by non-presence
    // writes, so aliases.seen_at remains the primary inactivity signal.
    return normalizeTimestamp(player?.updatedAt ?? player?.updated_at);
  }

  async function isDatabasePlayerActive(player) {
    if (state.inactiveDatabaseSteamIDs.has(player.steamID)) return false;

    const lastSeenAt = await resolvePlayerLastSeenAt(player);
    if (!lastSeenAt) return true;

    const active = ageMs(lastSeenAt) <= DATABASE_PLAYER_INACTIVE_CUTOFF_MS;
    if (!active) {
      state.inactiveDatabaseSteamIDs.add(player.steamID);
      state.totalSkippedInactive += 1;
    }
    return active;
  }

  async function getProfileRefreshState(playerId) {
    if (!Number.isFinite(Number(playerId)) || typeof playerRepository?.getPlayerDetail !== "function") {
      return {
        due: false,
        lastSuccessAt: 0,
        ageMs: Number.POSITIVE_INFINITY,
        state: "unavailable",
      };
    }

    try {
      const detail = await playerRepository.getPlayerDetail(Number(playerId));
      const profile = detail?.steamProfile ?? detail?.steam_profile ?? null;
      const profileState = cleanText(profile?.profile_state ?? profile?.profileState, "unknown");
      const lastSuccessAt = normalizeTimestamp(profile?.last_success_at ?? profile?.lastSuccessAt);
      const profileAgeMs = ageMs(lastSuccessAt);
      return {
        due: profileState !== "ready" || !lastSuccessAt || profileAgeMs >= PROFILE_REFRESH_COOLDOWN_MS,
        lastSuccessAt,
        ageMs: profileAgeMs,
        state: profileState,
      };
    } catch (error) {
      log.warn(`读取 Steam 资料缓存时间失败：player=${playerId} error=${error?.message || error}`);
      return {
        due: false,
        lastSuccessAt: 0,
        ageMs: Number.POSITIVE_INFINITY,
        state: "error",
      };
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

  async function runFullSteamRefresh(player) {
    if (typeof steamGameDurationService?.refreshPlayer !== "function") {
      return null;
    }

    const job = await steamGameDurationService.refreshPlayer({
      steamID: player.steamID,
      name: player.name || null,
      eosID: player.eosID || null,
      label: player.name || player.steamID,
    });

    if (!job?.id) return null;

    let completed = job;
    if (typeof steamGameDurationService?.waitForJob === "function") {
      completed = await steamGameDurationService.waitForJob(job.id, 30_000) ?? job;
    }

    if (completed?.status === "failed") {
      throw new Error(completed?.error?.message || "Steam full refresh failed.");
    }
    if (completed?.status !== "completed") {
      throw new Error(`Steam full refresh did not finish in time: ${completed?.status || "unknown"}`);
    }

    const cached = typeof steamGameDurationService?.getBySteamID === "function"
      ? await steamGameDurationService.getBySteamID(player.steamID)
      : null;
    return resolveGameSeconds(cached);
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
      // Re-check the persistent Steam timestamp immediately before querying so
      // overlapping refresh paths cannot bypass the 10-hour cache window.
      const playtimeState = await getPlaytimeRefreshState(player.steamID);
      state.lastPlaytimeFetchedAt = playtimeState.fetchedAt || null;
      if (!playtimeState.due) {
        state.totalSkippedFreshPlaytime += 1;
        state.currentMatchRefreshedSteamIDs.add(player.steamID);
        if (source === "database") markDatabaseRefreshTag(player.steamID, playtimeState.fetchedAt);
        return true;
      }

      const profileState = await getProfileRefreshState(playerId);
      state.lastProfileSuccessAt = profileState.lastSuccessAt || null;

      let seconds;
      if (profileState.due) {
        const fullRefreshSeconds = await runFullSteamRefresh(player);
        if (fullRefreshSeconds != null) {
          seconds = fullRefreshSeconds;
          state.totalProfileRefreshes += 1;
        }
      }

      // A full refresh is used only when the profile is at least 24 hours old.
      // Otherwise query playtime alone, so the 10-hour playtime cadence cannot
      // accidentally refresh the Steam profile every time.
      if (seconds == null) {
        seconds = await fetchGameDurationSeconds(steamGameDurationService, player.steamID, player.name);
        await playerRepository.updateGameDuration(playerId, seconds);
      }

      state.refreshedThisRound.add(playerId);
      state.currentMatchRefreshedSteamIDs.add(player.steamID);
      if (source === "database") {
        markDatabaseRefreshTag(player.steamID);
      }

      state.lastSuccessAt = Date.now();
      state.totalSuccess += 1;
      state.lastGameSeconds = seconds;
      state.lastPlaytimeFetchedAt = state.lastSuccessAt;
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
        `玩家 Steam 信息刷新失败：${player.name} steam=${player.steamID} error=${error?.message || error} source=${source}`,
      );
      return false;
    } finally {
      state.currentPlayerId = null;
      state.currentSteamID = null;
      state.currentSource = null;
    }
  }

  async function findCurrentMatchTarget(players) {
    if (!Array.isArray(players) || players.length === 0) return null;

    const start = Number(state.currentMatchCursor || 0) % players.length;
    let checked = 0;
    for (let offset = 0; offset < players.length; offset += 1) {
      const index = (start + offset) % players.length;
      const player = players[index];
      if (!player) continue;
      checked += 1;
      state.currentMatchCursor = (index + 1) % players.length;

      if (state.currentMatchRefreshedSteamIDs.has(player.steamID)) continue;

      const refreshState = await getPlaytimeRefreshState(player.steamID);
      if (!refreshState.due) {
        state.currentMatchRefreshedSteamIDs.add(player.steamID);
        state.totalSkippedFreshPlaytime += 1;
        continue;
      }

      return { player, checked };
    }

    return null;
  }

  async function findDatabaseTarget(players, currentMatchSteamIDs) {
    if (!Array.isArray(players) || players.length === 0) return null;

    const start = Number(state.databaseCursor || 0) % players.length;
    let checked = 0;
    for (let offset = 0; offset < players.length && checked < MAX_DATABASE_SCAN_PER_LOOP; offset += 1) {
      const index = (start + offset) % players.length;
      const player = players[index];
      if (!player) continue;
      checked += 1;
      state.databaseCursor = (index + 1) % players.length;

      if (currentMatchSteamIDs.has(player.steamID)) continue;
      if (state.inactiveDatabaseSteamIDs.has(player.steamID)) continue;
      if (isDatabaseCoolingDown(player.steamID)) continue;

      const refreshState = await getPlaytimeRefreshState(player.steamID);
      if (!refreshState.due) {
        markDatabaseRefreshTag(player.steamID, refreshState.fetchedAt);
        state.totalSkippedFreshPlaytime += 1;
        continue;
      }

      if (!await isDatabasePlayerActive(player)) {
        continue;
      }

      return { player, checked };
    }

    return null;
  }

  async function pickNextTarget() {
    const matchContext = collectCurrentMatchContext(modules?.matchState);
    const matchChanged = setCurrentMatchContext(matchContext);
    const currentMatchSteamIDs = new Set(matchContext.players.map((player) => player.steamID));

    const currentTarget = await findCurrentMatchTarget(matchContext.players);
    state.currentMatchEligibleCount = currentTarget ? 1 : 0;

    if (currentTarget?.player) {
      return {
        player: currentTarget.player,
        source: "current-match",
        matchChanged,
        intervalMs: computeInterval("current-match", 1, matchChanged),
        totalCount: matchContext.players.length,
        eligibleCount: 1,
        matchContext,
      };
    }

    // Do not cap the database query at the first 100 rows. The old code sorted
    // by updated_at ASC and could become permanently trapped behind inactive
    // legacy players. Scan the full local list, but inspect at most 100 entries
    // per loop so SQLite/API work remains bounded.
    const players = await playerRepository.listPlayersWithSteamID({ order: "DESC" });
    const list = (Array.isArray(players) ? players : [])
      .map((player) => normalizePlayerCandidate(player, "database"))
      .filter(Boolean);

    const databaseTarget = await findDatabaseTarget(list, currentMatchSteamIDs);
    state.databaseEligibleCount = databaseTarget ? 1 : 0;

    if (databaseTarget?.player) {
      return {
        player: databaseTarget.player,
        source: "database",
        matchChanged,
        intervalMs: computeInterval("database", 1, matchChanged),
        totalCount: list.length,
        eligibleCount: 1,
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

    log.info(
      `玩家 Steam 信息慢速刷新插件已启动：时长缓存=${PLAYTIME_REFRESH_COOLDOWN_MS / 3_600_000}h 资料缓存=${PROFILE_REFRESH_COOLDOWN_MS / 3_600_000}h 非活跃截止=${DATABASE_PLAYER_INACTIVE_CUTOFF_MS / 86_400_000}d`,
    );

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
          log.error(`玩家 Steam 信息慢速刷新循环失败：${error?.stack || error}`);
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
      log.info("玩家 Steam 信息慢速刷新插件已停止");
    }
  }

  const api = {
    getState() {
      const databaseRefreshTaggedAtBySteamID = Object.fromEntries(state.databaseRefreshTaggedAtBySteamID);
      return {
        ...state,
        refreshedThisRound: Array.from(state.refreshedThisRound),
        currentMatchRefreshedSteamIDs: Array.from(state.currentMatchRefreshedSteamIDs),
        inactiveDatabaseSteamIDs: Array.from(state.inactiveDatabaseSteamIDs),
        databaseRefreshTaggedAtBySteamID,
        refreshTaggedAtBySteamID: databaseRefreshTaggedAtBySteamID,
        policy: {
          playtimeRefreshCooldownMs: PLAYTIME_REFRESH_COOLDOWN_MS,
          profileRefreshCooldownMs: PROFILE_REFRESH_COOLDOWN_MS,
          databasePlayerInactiveCutoffMs: DATABASE_PLAYER_INACTIVE_CUTOFF_MS,
          maxDatabaseScanPerLoop: MAX_DATABASE_SCAN_PER_LOOP,
        },
      };
    },
  };

  return {
    manifest: {
      id: "plugin.player_duration_slow_refresh",
      name: "Player Duration Slow Refresh",
      kind: "plugin",
      version: "0.2.0",
      description: "后台刷新玩家 Steam 信息：游戏时长至少间隔 10 小时、Steam 资料至少间隔 24 小时，并停止刷新超过 15 天未出现的历史玩家。",
    },
    apiName: "playerDurationSlowRefresh",
    api,

    async start() {
      void loop().catch((error) => {
        log.error(`玩家 Steam 信息慢速刷新插件崩溃：${error?.stack || error}`);
      });
    },

    async stop() {
      state.stopRequested = true;
      if (!state.running) {
        log.info("玩家 Steam 信息慢速刷新插件已停止");
      }
    },

    getState() {
      return api.getState();
    },
  };
}

export default createPlugin;
