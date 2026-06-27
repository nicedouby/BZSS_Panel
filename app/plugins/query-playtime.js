// -*- coding: utf-8 -*-

const PLUGIN_ID = "query-playtime";

// 匹配小队时长查询的指令模式
const SQUAD_CMD_RE = /^!?(?:查询?\s*小队\s*时长|小队\s*时长|sq(?:t(?:ime)?)?|squad\s*(?:t(?:ime)?)?)$/iu;
// 匹配阵营时长查询的指令模式
const TEAM_CMD_RE = /^!?(?:查询?\s*阵营\s*时长|阵营\s*时长|tt|team\s*(?:t(?:ime)?)?)$/iu;

const DEFAULT_COOLDOWN_MS = 15_000;
const MAX_LINE_CHARS = 175;

function readConfig(config) {
  const cfg = config?.get?.(`plugins.${PLUGIN_ID}`, {}) ?? {};
  return {
    enabled: Boolean(cfg.enabled ?? true),
    cooldownMs: Math.max(0, Number(cfg.cooldownMs ?? DEFAULT_COOLDOWN_MS) || DEFAULT_COOLDOWN_MS),
  };
}

function normalizeId(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "0" || text.toLowerCase() === "none") return "";
  return text;
}

function formatHours(gameSeconds) {
  const s = Math.max(0, Math.floor(Number(gameSeconds) || 0));
  if (!s) return "未知h";
  const h = s / 3600;
  return `${Number(h.toFixed(1))}h`;
}

function packIntoChunks(lines) {
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const safe = line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS - 2) + ".." : line;
    const candidate = current ? `${current}\n${safe}` : safe;
    if (candidate.length > MAX_LINE_CHARS) {
      if (current) chunks.push(current);
      current = safe;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildPlayerPairLines(sorted) {
  const lines = [];
  for (let i = 0; i < sorted.length; i += 2) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const aStr = `${a.name}:${formatHours(a.gameSeconds)}`;
    if (b) {
      lines.push(`${aStr}  ${b.name}:${formatHours(b.gameSeconds)}`);
    } else {
      lines.push(aStr);
    }
  }
  return lines;
}

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger ??
    core?.createLogger?.({ moduleId: PLUGIN_ID, source: PLUGIN_ID, channel: "plugin" }) ??
    core?.logger ??
    console;

  let runtimeConfig = readConfig(config);
  const unsubscribers = [];
  const cooldowns = new Map();

  function isActive() {
    const check = core?.pluginSubscriptions?.isSubscribed;
    if (typeof check === "function" && !check(PLUGIN_ID)) return false;
    return Boolean(runtimeConfig.enabled);
  }

  function isOnCooldown(key) {
    const last = cooldowns.get(key);
    return Boolean(last) && Date.now() - last < runtimeConfig.cooldownMs;
  }

  function setCooldown(key) {
    cooldowns.set(key, Date.now());
    if (cooldowns.size > 500) {
      const cutoff = Date.now() - runtimeConfig.cooldownMs * 2;
      for (const [id, ts] of cooldowns) {
        if (ts < cutoff) cooldowns.delete(id);
      }
    }
  }

  async function getGameSeconds(steamID) {
    if (!steamID || !modules?.playtime) return null;
    try {
      const cached = await modules.playtime.getBySteamID(steamID);
      const s = cached?.gameSeconds ?? cached?.game_seconds;
      return s != null ? Math.max(0, Math.floor(Number(s) || 0)) : null;
    } catch {
      return null;
    }
  }

  async function warnPlayer(targetName, targetSteamId, message) {
    const warnApi = modules?.adminWarn?.warnPlayer;
    if (typeof warnApi !== "function") return;
    try {
      await warnApi({
        targetName,
        targetSteamId: targetSteamId || undefined,
        message,
        reason: "query_playtime",
        sourceModule: PLUGIN_ID,
        system: true,
      });
    } catch (err) {
      pluginLogger?.warn?.(`[QueryPlaytime] warn failed: ${err?.message}`);
    }
  }

  async function sendLines(targetName, targetSteamId, lines) {
    for (const chunk of packIntoChunks(lines)) {
      await warnPlayer(targetName, targetSteamId, chunk);
    }
  }

  function resolveSender(event) {
    const name = String(event?.playerName ?? event?.name ?? "").trim();
    const steamId = String(event?.steamId ?? event?.steamID ?? "").trim();
    const eosId = String(event?.eosId ?? event?.eosID ?? "").trim();
    const serverId = String(event?.serverId ?? "").trim();

    // Look up in playerState for accurate current squad/team
    const player = steamId
      ? modules?.playerState?.getPlayerBySteamID?.(serverId, steamId)
      : name
        ? modules?.playerState?.getPlayerByName?.(serverId, name)
        : null;

    const teamId = normalizeId(player?.teamID ?? event?.teamId ?? event?.teamID);
    const squadId = normalizeId(player?.squadID ?? event?.squadId ?? event?.squadID);

    return { name, steamId, eosId, serverId, teamId, squadId };
  }

  async function handleSquadQuery(event) {
    const { name, steamId, serverId, teamId, squadId } = resolveSender(event);

    if (!name) return;

    const cooldownKey = steamId || name;
    if (isOnCooldown(cooldownKey)) {
      await warnPlayer(name, steamId, "[小队时长] 查询过于频繁，请稍后再试");
      return;
    }

    if (!teamId || !squadId) {
      await warnPlayer(name, steamId, "[小队时长] 你尚未加入任何小队");
      return;
    }

    setCooldown(cooldownKey);

    const allPlayers = modules?.playerState?.getPlayerList(serverId) ?? [];
    const members = allPlayers.filter(
      (p) => normalizeId(p?.teamID) === teamId && normalizeId(p?.squadID) === squadId,
    );

    if (!members.length) {
      await warnPlayer(name, steamId, "[小队时长] 未找到小队成员信息");
      return;
    }

    const withTime = await Promise.all(
      members.map(async (p) => ({
        name: String(p?.name ?? "未知"),
        steamID: String(p?.steamID ?? ""),
        isLeader: Boolean(p?.isLeader),
        gameSeconds: await getGameSeconds(String(p?.steamID ?? "")),
      })),
    );

    const known = withTime.filter((p) => p.gameSeconds != null);
    const avgSeconds = known.length
      ? known.reduce((sum, p) => sum + p.gameSeconds, 0) / known.length
      : null;
    const leader = withTime.find((p) => p.isLeader);
    const leaderSeconds = leader?.gameSeconds ?? null;

    const lines = [];
    lines.push(
      `[小队时长] 平均:${formatHours(avgSeconds)}  队长:${formatHours(leaderSeconds)}`,
    );

    const sorted = [...withTime].sort((a, b) => {
      if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
      return (b.gameSeconds ?? -1) - (a.gameSeconds ?? -1);
    });

    lines.push(...buildPlayerPairLines(sorted));
    await sendLines(name, steamId, lines);
  }

  async function handleTeamQuery(event) {
    const { name, steamId, serverId, teamId } = resolveSender(event);

    if (!name) return;

    const cooldownKey = steamId || name;
    if (isOnCooldown(cooldownKey)) {
      await warnPlayer(name, steamId, "[阵营时长] 查询过于频繁，请稍后再试");
      return;
    }

    if (!teamId) {
      await warnPlayer(name, steamId, "[阵营时长] 无法获取阵营信息");
      return;
    }

    setCooldown(cooldownKey);

    const allPlayers = modules?.playerState?.getPlayerList(serverId) ?? [];
    const teamPlayers = allPlayers.filter((p) => normalizeId(p?.teamID) === teamId);

    if (!teamPlayers.length) {
      await warnPlayer(name, steamId, "[阵营时长] 未找到阵营成员信息");
      return;
    }

    const withTime = await Promise.all(
      teamPlayers.map(async (p) => ({
        name: String(p?.name ?? "未知"),
        steamID: String(p?.steamID ?? ""),
        isLeader: Boolean(p?.isLeader),
        squadID: normalizeId(p?.squadID),
        gameSeconds: await getGameSeconds(String(p?.steamID ?? "")),
      })),
    );

    // 仅统计有时长且在小队中的玩家
    const inSquad = withTime.filter((p) => p.squadID);
    const known = inSquad.filter((p) => p.gameSeconds != null);
    const teamAvg = known.length
      ? known.reduce((sum, p) => sum + p.gameSeconds, 0) / known.length
      : null;
    const leaders = inSquad.filter((p) => p.isLeader && p.gameSeconds != null);
    const leaderAvg = leaders.length
      ? leaders.reduce((sum, p) => sum + p.gameSeconds, 0) / leaders.length
      : null;

    // 按小队分组
    const squads = new Map();
    for (const p of withTime) {
      if (!p.squadID) continue;
      if (!squads.has(p.squadID)) squads.set(p.squadID, []);
      squads.get(p.squadID).push(p);
    }

    const lines = [];
    lines.push(
      `[阵营时长] 平均:${formatHours(teamAvg)}  队长均:${formatHours(leaderAvg)}`,
    );

    const sortedSquads = [...squads.entries()].sort((a, b) => {
      const na = Number(a[0]) || 0;
      const nb = Number(b[0]) || 0;
      return na - nb;
    });

    for (const [sqId, members] of sortedSquads) {
      const sqKnown = members.filter((p) => p.gameSeconds != null);
      const sqAvg = sqKnown.length
        ? sqKnown.reduce((sum, p) => sum + p.gameSeconds, 0) / sqKnown.length
        : null;
      const sqLeader = members.find((p) => p.isLeader);
      const sqLeaderSeconds = sqLeader?.gameSeconds ?? null;

      lines.push(
        `[小队${sqId}] 均:${formatHours(sqAvg)}  队长:${formatHours(sqLeaderSeconds)}`,
      );

      const sorted = [...members].sort((a, b) => {
        if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
        return (b.gameSeconds ?? -1) - (a.gameSeconds ?? -1);
      });

      lines.push(...buildPlayerPairLines(sorted));
    }

    await sendLines(name, steamId, lines);
  }

  async function handleMessage(entry) {
    if (!isActive()) return;
    const msg = String(entry?.message ?? "").trim();
    if (!msg) return;

    if (SQUAD_CMD_RE.test(msg)) {
      handleSquadQuery(entry).catch((err) => {
        pluginLogger?.warn?.(`[QueryPlaytime] squad query error: ${err?.message}`);
      });
    } else if (TEAM_CMD_RE.test(msg)) {
      handleTeamQuery(entry).catch((err) => {
        pluginLogger?.warn?.(`[QueryPlaytime] team query error: ${err?.message}`);
      });
    }
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "查询时长",
      kind: "plugin",
      version: "1.0.0",
      description: "玩家通过聊天输入指令查询己方小队或阵营的游戏时长统计。",
      configSchema: [
        {
          key: `plugins.${PLUGIN_ID}.enabled`,
          type: "boolean",
          default: true,
          description: "是否启用插件",
        },
        {
          key: `plugins.${PLUGIN_ID}.cooldownMs`,
          type: "number",
          default: DEFAULT_COOLDOWN_MS,
          description: "同一玩家两次查询之间的冷却时间（毫秒）",
        },
      ],
    },

    apiName: "queryPlaytime",
    api: {
      getState() {
        return {
          enabled: runtimeConfig.enabled,
          cooldownMs: runtimeConfig.cooldownMs,
          activeCooldowns: cooldowns.size,
        };
      },
    },

    async start() {
      runtimeConfig = readConfig(config);
      if (!runtimeConfig.enabled) {
        pluginLogger?.info?.("[QueryPlaytime] plugin disabled by config.");
        return;
      }

      const chatManager = modules?.chatManager;
      if (!chatManager?.on) {
        pluginLogger?.warn?.("[QueryPlaytime] chatManager module unavailable.");
        return;
      }

      unsubscribers.push(chatManager.on("message", handleMessage));
      pluginLogger?.info?.("[QueryPlaytime] started. Listening for squad/team playtime queries.");
    },

    async stop() {
      for (const un of unsubscribers.splice(0)) {
        try { un(); } catch {}
      }
      cooldowns.clear();
      pluginLogger?.info?.("[QueryPlaytime] stopped.");
    },
  };
}
