// -*- coding: utf-8 -*-

import { resolvePlayerFireTeam } from "./match-end-snapshot-fireteam.js";

const PLUGIN_ID = "squad-members-playtime-warning";
const DEFAULT_FIRST_WARNING_SECONDS = 5 * 60;
const DEFAULT_LEADER_WARNING_SECONDS = 7 * 60 + 30;
const DEFAULT_POLL_INTERVAL_MS = 1000;

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function id(value) {
  return text(value);
}

function first(value, ...fallbacks) {
  if (value != null && text(value)) return text(value);
  for (const fallback of fallbacks) {
    if (fallback != null && text(fallback)) return text(fallback);
  }
  return "";
}

function formatHours(gameSeconds) {
  const seconds = Math.max(0, Math.floor(Number(gameSeconds) || 0));
  if (!seconds) return "未知小时";
  const hours = Number((seconds / 3600).toFixed(1));
  return `${hours}小时`;
}

function normalizeFireTeam(player) {
  const corePlayer = player?.bzssCore;
  if (!corePlayer || typeof corePlayer !== "object") return "";

  const sources = [
    corePlayer,
    corePlayer?.soldierInfo,
    corePlayer?.playerScoreboard,
  ];

  for (const source of sources) {
    const resolved = resolvePlayerFireTeam(source, source);
    if (resolved.fireTeam) return resolved.fireTeam;
  }

  return "";
}
function getRole(player) {
  return first(
    player?.roleName,
    player?.roleDisplayName,
    player?.className,
    player?.class,
    player?.kitName,
    player?.kit,
    player?.role,
    player?.兵种,
    "未知",
  );
}

function getSquadName(squad) {
  return first(
    squad?.squadName,
    squad?.name,
    squad?.displayName,
    squad?.squad_name,
    squad?.squad,
    "未命名小队",
  );
}

function getTeamId(player) {
  return first(player?.teamID, player?.teamId, player?.team, player?.team_id);
}

function getSquadId(player) {
  return first(player?.squadID, player?.squadId, player?.squad, player?.squad_id);
}

function isLeader(player) {
  return Boolean(
    player?.isLeader ??
    player?.isSquadLeader ??
    player?.squadLeader ??
    player?.leader ??
    player?.role === "SquadLeader",
  );
}

function getPlayerName(player) {
  return first(player?.name, player?.playerName, player?.player_name, "未知玩家");
}

function getSteamId(player) {
  return first(player?.steamID, player?.steamId, player?.steam_id);
}

function getEosId(player) {
  return first(player?.eosID, player?.eosId, player?.eos_id);
}

function readConfig(config) {
  const cfg = config?.get?.(`plugins.${PLUGIN_ID}`, {}) ?? {};
  return {
    enabled: Boolean(cfg.enabled ?? true),
    firstWarningSeconds: Math.max(1, Number(cfg.firstWarningSeconds ?? DEFAULT_FIRST_WARNING_SECONDS)),
    leaderWarningSeconds: Math.max(1, Number(cfg.leaderWarningSeconds ?? DEFAULT_LEADER_WARNING_SECONDS)),
    pollIntervalMs: Math.max(250, Number(cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)),
    liveLookupWhenMissing: Boolean(cfg.liveLookupWhenMissing ?? false),
  };
}

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger = logger ?? core?.logger ?? console;
  const unsubscribers = [];
  let timer = null;
  let runtimeConfig = readConfig(config);
  let activeMatchKey = "";
  let firstWarningSent = false;
  let leaderWarningSent = false;
  const playtimeCache = new Map();

  function isSubscribed() {
    return core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return runtimeConfig.enabled && isSubscribed();
  }

  function getSnapshot() {
    return core?.webStatus?.getSnapshot?.() ?? {};
  }

  function getClockSeconds(snapshot) {
    return Math.max(0, Math.floor(Number(snapshot?.logClockSeconds ?? 0) || 0));
  }

  function getMatchKey(snapshot) {
    const serverId = first(snapshot?.serverId, core?.webStatus?.serverId, "server");
    const anchor = first(
      snapshot?.logClockAnchorLogTime,
      snapshot?.logClockLastResetAt,
      snapshot?.matchId,
      snapshot?.currentMap,
      "current",
    );
    return `${serverId}::${anchor}`;
  }

  function getPlayers(serverId) {
    const playerState = modules?.playerState;
    if (typeof playerState?.getPlayerList !== "function") return [];

    const players = playerState.getPlayerList(serverId) ?? [];
    const corePlayers = modules?.bzssCoreMonitor?.getPlayers?.()
      ?? modules?.bzssCoreMonitor?.getTelemetryPlayers?.()
      ?? [];
    if (!Array.isArray(corePlayers) || !corePlayers.length) return players;

    const identity = (player) => [
      player?.steamID,
      player?.steamId,
      player?.steam64ID,
      player?.eosID,
      player?.eosId,
      player?.playerID,
      player?.playerId,
      player?.name,
      player?.playerName,
    ].map((value) => text(value).toLowerCase()).find(Boolean) || "";

    const coreByIdentity = new Map();
    for (const corePlayer of corePlayers) {
      const key = identity(corePlayer);
      if (key) coreByIdentity.set(key, corePlayer);
    }

    return players.map((player) => {
      const corePlayer = coreByIdentity.get(identity(player));
      return corePlayer ? { ...player, bzssCore: corePlayer } : player;
    });
  }

  function getWarnApi() {
    return modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn ?? null;
  }

  async function getPlaytimeSeconds(player) {
    const steamID = getSteamId(player);
    if (!steamID) return null;
    if (playtimeCache.has(steamID)) return playtimeCache.get(steamID);

    const promise = (async () => {
      const playtime = modules?.playtime;
      if (!playtime) return null;

      try {
        const cached = await playtime.getBySteamID?.(steamID);
        const cachedSeconds = cached?.game_seconds ?? cached?.gameSeconds;
        if (cachedSeconds != null) return Number(cachedSeconds) || 0;

        if (!runtimeConfig.liveLookupWhenMissing) return null;
        const lookup = await playtime.lookupSteamID?.(steamID, { lastSeenName: getPlayerName(player) });
        return lookup?.gameSeconds != null ? Number(lookup.gameSeconds) || 0 : null;
      } catch (error) {
        pluginLogger?.debug?.(`[${PLUGIN_ID}] playtime lookup failed: ${error?.message ?? error}`);
        return null;
      }
    })();

    playtimeCache.set(steamID, promise);
    return promise;
  }

  async function buildMemberLine(player) {
    const fireTeam = normalizeFireTeam(player);
    const name = getPlayerName(player);
    const role = getRole(player);
    const seconds = await getPlaytimeSeconds(player);
    return `${fireTeam ? `（${fireTeam}组）` : ""}${name} ${role} 游戏时长 ${formatHours(seconds)}`;
  }

  async function buildLeaderLine(player, squadName) {
    const seconds = await getPlaytimeSeconds(player);
    return `${squadName} 队长 ${getPlayerName(player)} 游戏时长 ${formatHours(seconds)}`;
  }

  function recipientKey(player) {
    return getSteamId(player) || getEosId(player) || getPlayerName(player).toLowerCase();
  }

  async function warnPlayer(warnApi, recipient, message, reason, snapshot) {
    const targetName = getPlayerName(recipient);
    if (!targetName || targetName === "未知玩家") return false;

    const result = await warnApi({
      targetName,
      targetSteamId: getSteamId(recipient) || undefined,
      targetEosId: getEosId(recipient) || undefined,
      message,
      reason,
      sourceModule: PLUGIN_ID,
      relatedEventId: first(snapshot?.matchId, activeMatchKey),
      system: true,
    });

    return result?.success !== false;
  }

  async function sendSquadMemberWarnings(players, snapshot, warnApi) {
    const squads = new Map();

    for (const player of players) {
      const teamId = getTeamId(player);
      const squadId = getSquadId(player);
      if (!teamId || !squadId) continue;

      const key = `${teamId}::${squadId}`;
      if (!squads.has(key)) squads.set(key, { members: [], teamId, squadId });
      squads.get(key).members.push(player);
    }

    if (!squads.size) return false;

    let sent = false;
    for (const squad of squads.values()) {
      const lines = [];
      for (const member of squad.members) lines.push(await buildMemberLine(member));
      const message = `[小队游戏时长提醒] ${getSquadName(squad.members[0])}\n${lines.join("\n")}`;

      const seen = new Set();
      for (const recipient of squad.members) {
        const key = recipientKey(recipient);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        try {
          if (await warnPlayer(warnApi, recipient, message, "squad_members_playtime_warning", snapshot)) sent = true;
        } catch (error) {
          pluginLogger?.warn?.(`[${PLUGIN_ID}] member warning failed: ${error?.message ?? error}`);
        }
      }
    }

    return sent;
  }

  async function sendLeaderWarnings(players, snapshot, warnApi) {
    const teams = new Map();
    for (const player of players) {
      const teamId = getTeamId(player);
      if (!teamId) continue;
      if (!teams.has(teamId)) teams.set(teamId, { players: [], leaders: new Map() });
      teams.get(teamId).players.push(player);

      if (!isLeader(player)) continue;
      const squadId = getSquadId(player);
      if (!squadId) continue;
      const key = `${teamId}::${squadId}`;
      if (!teams.get(teamId).leaders.has(key)) {
        teams.get(teamId).leaders.set(key, { player, squadName: getSquadName(player) });
      }
    }

    if (!teams.size || ![...teams.values()].some((team) => team.leaders.size)) return false;

    let sent = false;
    for (const team of teams.values()) {
      const leaders = [...team.leaders.values()];
      const lines = [];
      for (const leader of leaders) lines.push(await buildLeaderLine(leader.player, leader.squadName));
      const message = `[小队长游戏时长提醒]\n${lines.join("\n")}`;

      const seen = new Set();
      for (const recipient of team.players) {
        const key = recipientKey(recipient);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        try {
          if (await warnPlayer(warnApi, recipient, message, "squad_leaders_playtime_warning", snapshot)) sent = true;
        } catch (error) {
          pluginLogger?.warn?.(`[${PLUGIN_ID}] leader warning failed: ${error?.message ?? error}`);
        }
      }
    }

    return sent;
  }

  async function tick() {
    if (!isActive()) return;
    runtimeConfig = readConfig(config);

    const snapshot = getSnapshot();
    const clockSeconds = getClockSeconds(snapshot);
    const matchKey = getMatchKey(snapshot);

    if (matchKey !== activeMatchKey || clockSeconds < 1) {
      activeMatchKey = matchKey;
      firstWarningSent = false;
      leaderWarningSent = false;
      playtimeCache.clear();
    }

    const serverId = first(snapshot?.serverId, core?.webStatus?.serverId);
    if (!serverId || clockSeconds <= 0) return;

    const warnApi = getWarnApi();
    if (typeof warnApi !== "function") return;

    const players = getPlayers(serverId);
    if (!players.length) return;

    if (!firstWarningSent && clockSeconds >= runtimeConfig.firstWarningSeconds) {
      const sent = await sendSquadMemberWarnings(players, snapshot, warnApi);
      if (sent) firstWarningSent = true;
    }

    if (!leaderWarningSent && clockSeconds >= runtimeConfig.leaderWarningSeconds) {
      const sent = await sendLeaderWarnings(players, snapshot, warnApi);
      if (sent) leaderWarningSent = true;
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      try {
        await tick();
      } finally {
        if (isActive()) schedule();
      }
    }, runtimeConfig.pollIntervalMs);
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "小队成员与队长游戏时长警告",
      kind: "plugin",
      version: "1.0.0",
      description: "开局5分钟向各小队成员发送本队成员游戏时长，7分30秒向各阵营发送本阵营小队长游戏时长。",
      configSchema: [
        {
          key: `plugins.${PLUGIN_ID}.enabled`,
          type: "boolean",
          default: true,
          description: "是否启用插件",
        },
        {
          key: `plugins.${PLUGIN_ID}.firstWarningSeconds`,
          type: "number",
          default: DEFAULT_FIRST_WARNING_SECONDS,
          description: "第一阶段警告时间，默认5分钟",
        },
        {
          key: `plugins.${PLUGIN_ID}.leaderWarningSeconds`,
          type: "number",
          default: DEFAULT_LEADER_WARNING_SECONDS,
          description: "小队长警告时间，默认7分30秒",
        },
        {
          key: `plugins.${PLUGIN_ID}.pollIntervalMs`,
          type: "number",
          default: DEFAULT_POLL_INTERVAL_MS,
          description: "日志时钟检查间隔",
        },
        {
          key: `plugins.${PLUGIN_ID}.liveLookupWhenMissing`,
          type: "boolean",
          default: false,
          description: "本地无缓存时是否实时查询 Steam 时长",
        },
      ],
    },
    apiName: "squadMembersPlaytimeWarning",
    api: {
      getState() {
        return {
          enabled: runtimeConfig.enabled,
          firstWarningSent,
          leaderWarningSent,
          activeMatchKey,
        };
      },
    },
    async start() {
      runtimeConfig = readConfig(config);
      if (!runtimeConfig.enabled) return;
      schedule();
      pluginLogger?.info?.(`[${PLUGIN_ID}] started.`);
    },
    async stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      playtimeCache.clear();
    },
  };
}
