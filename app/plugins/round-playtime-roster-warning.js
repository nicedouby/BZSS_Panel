// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import { resolvePlayerFireTeam } from "./match-end-snapshot-fireteam.js";

const PLUGIN_ID = "round-playtime-roster-warning";
const DEFAULT_STATE_FILE = "./data/round-playtime-roster-warning/state.json";
const ROLE_LABELS = [
  [["squadleader", "squad leader", "leader"], "小队长", "队长"],
  [["medic"], "医疗兵", "医疗"],
  [["heavyantitank", "heavy anti tank", "hat"], "重型反坦克兵", "重反"],
  [["lightantitank", "light anti tank", "antitank", "lat"], "轻型反坦克兵", "轻反"],
  [["machinegunner", "machine gunner"], "机枪手", "机枪"],
  [["automaticrifleman", "automatic rifleman"], "自动步枪手", "自动"],
  [["combatengineer", "combat engineer", "engineer", "sapper"], "战斗工兵", "工兵"],
  [["designatedmarksman", "designated marksman", "marksman"], "精确射手", "射手"],
  [["sniper"], "狙击手", "狙击"],
  [["scout"], "侦察兵", "侦察"],
  [["grenadier"], "榴弹兵", "榴弹"],
  [["crewman", "crew"], "载具乘员", "乘员"],
  [["pilot"], "飞行员", "飞行"],
  [["rifleman"], "步枪兵", "步枪"],
];

export function createPlugin({ core, modules, config, logger } = {}) {
  const log = logger ?? core?.logger ?? console;
  let cfg = readConfig(config);
  let timer = null;
  let chain = Promise.resolve();
  const unsubscribers = [];
  const playtimeCache = new Map();
  const state = {
    roundKey: "",
    squadSent: false,
    leaderSent: false,
    squadSentAt: "",
    leaderSentAt: "",
    lastClockSeconds: 0,
    blockedRoundKey: "",
    lastError: "",
  };

  const enqueue = (fn) => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const active = () => cfg.enabled
    && modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
    && core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  const statePath = () => cfg.persistState ? path.resolve(process.cwd(), cfg.stateFile) : "";

  async function loadState() {
    if (!statePath()) return;
    try {
      const saved = JSON.parse(await fs.readFile(statePath(), "utf8"));
      state.roundKey = text(saved.roundKey);
      state.squadSent = Boolean(saved.squadSent);
      state.leaderSent = Boolean(saved.leaderSent);
      state.squadSentAt = text(saved.squadSentAt);
      state.leaderSentAt = text(saved.leaderSentAt);
      state.blockedRoundKey = text(saved.blockedRoundKey);
    } catch (error) {
      if (error?.code !== "ENOENT") log?.warn?.(`[RoundPlaytimeRosterWarning] load state failed: ${error.message}`);
    }
  }

  async function saveState() {
    const file = statePath();
    if (!file) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: 1, ...state }, null, 2), "utf8");
  }

  function resetRound(roundKey = "") {
    state.roundKey = text(roundKey);
    state.squadSent = false;
    state.leaderSent = false;
    state.squadSentAt = "";
    state.leaderSentAt = "";
    state.lastError = "";
    playtimeCache.clear();
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

  async function evaluate(reason = "poll") {
    if (!active()) return publicState();
    const current = clock();
    state.lastClockSeconds = current.seconds;
    if (!current.trusted) return publicState();
    if (state.blockedRoundKey) {
      if (current.roundKey === state.blockedRoundKey) return publicState();
      state.blockedRoundKey = "";
    }
    if (state.roundKey !== current.roundKey) {
      resetRound(current.roundKey);
      await saveState();
    }
    if (current.seconds >= cfg.squadWarningSeconds && !state.squadSent) {
      const result = await dispatchSquads(reason);
      if (result.attempted > 0) {
        state.squadSent = true;
        state.squadSentAt = new Date().toISOString();
        await saveState();
      }
    }
    if (current.seconds >= cfg.leaderWarningSeconds && !state.leaderSent) {
      const result = await dispatchLeaders(reason);
      if (result.attempted > 0) {
        state.leaderSent = true;
        state.leaderSentAt = new Date().toISOString();
        await saveState();
      }
    }
    return publicState();
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
    const players = mergePlayers([basePlayers, statePlayers, corePlayers])
      .filter((player) => player.name && player.online !== false && player.stale !== true);
    const squads = Array.isArray(overview.squads) ? overview.squads : match?.squads?.list ?? [];
    const squadNames = new Map(squads.map((squad) => [
      `${id(squad.teamID ?? squad.teamId)}|${id(squad.squadID ?? squad.squadId)}`,
      text(squad.squadName ?? squad.name),
    ]));
    return { players, squadNames };
  }

  async function gameSeconds(player) {
    if (!player.steamID || !modules?.playtime) return null;
    if (playtimeCache.has(player.steamID)) return playtimeCache.get(player.steamID);
    try {
      let row = await modules.playtime.getBySteamID?.(player.steamID);
      let seconds = readSeconds(row);
      if (seconds == null && cfg.liveLookupWhenMissing) {
        row = await modules.playtime.lookupSteamID?.(player.steamID, { lastSeenName: player.name });
        seconds = readSeconds(row);
      }
      playtimeCache.set(player.steamID, seconds);
      return seconds;
    } catch (error) {
      log?.debug?.(`[RoundPlaytimeRosterWarning] playtime lookup failed: ${error.message}`);
      return null;
    }
  }

  async function enrich(players) {
    const queue = dedupe(players);
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const player = queue.shift();
        player.gameSeconds = await gameSeconds(player);
      }
    });
    await Promise.all(workers);
  }

  async function warn(recipient, message, reason) {
    const api = modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn;
    if (typeof api !== "function") return { success: false };
    return api.call(modules.adminWarn, {
      targetName: recipient.name,
      targetPlayerId: recipient.playerID || undefined,
      targetSteamId: recipient.steamID || undefined,
      targetEosId: recipient.eosID || undefined,
      message,
      reason,
      sourceModule: PLUGIN_ID,
      relatedEventId: `${state.roundKey}:${reason}`,
      system: true,
    });
  }

  async function dispatchSquads(reason = "clock") {
    try {
      const { players } = roster();
      const groups = group(players, (player) => player.teamID && player.squadID ? `${player.teamID}|${player.squadID}` : "");
      await enrich([...groups.values()].flat());
      let attempted = 0;
      for (const members of groups.values()) {
        members.sort(memberSort);
        const message = buildSquadRosterMessage(members, cfg.maxWarningChars);
        for (const recipient of dedupe(members)) {
          attempted += 1;
          await warn(recipient, message, `round_squad_playtime_${reason}`);
        }
      }
      return { attempted };
    } catch (error) {
      state.lastError = error.message ?? String(error);
      log?.warn?.(`[RoundPlaytimeRosterWarning] squad dispatch failed: ${state.lastError}`);
      return { attempted: 0 };
    }
  }

  async function dispatchLeaders(reason = "clock") {
    try {
      const { players, squadNames } = roster();
      const leaders = players.filter((player) => player.isLeader && player.teamID && player.squadID);
      await enrich(leaders);
      const byTeam = group(leaders, (player) => player.teamID);
      const recipients = group(players, (player) => player.teamID);
      let attempted = 0;
      for (const [teamID, teamLeaders] of byTeam) {
        const lines = teamLeaders.map((leader) => ({
          ...leader,
          squadName: text(squadNames.get(`${leader.teamID}|${leader.squadID}`)) || "未命名队",
        })).sort((a, b) => a.squadName.localeCompare(b.squadName, "zh-CN"));
        const message = buildLeaderRosterMessage(lines, cfg.maxWarningChars);
        for (const recipient of dedupe(recipients.get(teamID) ?? [])) {
          attempted += 1;
          await warn(recipient, message, `round_leader_playtime_${reason}`);
        }
      }
      return { attempted };
    } catch (error) {
      state.lastError = error.message ?? String(error);
      log?.warn?.(`[RoundPlaytimeRosterWarning] leader dispatch failed: ${state.lastError}`);
      return { attempted: 0 };
    }
  }

  const publicState = () => ({ ...state, enabled: cfg.enabled, active: active(), config: { ...cfg } });
  const api = {
    getState: publicState,
    evaluateNow: () => enqueue(() => evaluate("manual_evaluate")),
    sendSquadSummaryNow: () => enqueue(() => dispatchSquads("manual")),
    sendLeaderSummaryNow: () => enqueue(() => dispatchLeaders("manual")),
    resetRound: (reason = "manual") => enqueue(async () => { resetRound(""); await saveState(); return { reason, ...publicState() }; }),
    reloadConfig: () => { cfg = readConfig(config); return publicState(); },
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "开局小队与队长游戏时长提醒",
      kind: "plugin",
      version: "1.0.0",
      category: "Moderation",
      description: "日志时间达到5分钟时发送小队成员时长，达到7分30秒时发送本阵营各小队长时长。",
    },
    apiName: "roundPlaytimeRosterWarning",
    api,
    async init() { cfg = readConfig(config); await loadState(); },
    async start() {
      cfg = readConfig(config);
      if (!active()) return;
      if (core?.eventBus?.onCoreEvent) {
        unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", () => {
          void enqueue(async () => {
            const oldRoundKey = state.roundKey || clock().roundKey;
            resetRound("");
            state.blockedRoundKey = oldRoundKey;
            await saveState();
          });
        }));
      }
      timer = setInterval(() => void enqueue(() => evaluate("poll")), cfg.pollIntervalMs);
      timer.unref?.();
      void enqueue(() => evaluate("startup"));
      log?.info?.(`[RoundPlaytimeRosterWarning] started: ${cfg.squadWarningSeconds}s / ${cfg.leaderWarningSeconds}s`);
    },
    async stop() {
      if (timer) clearInterval(timer);
      for (const unsubscribe of unsubscribers.splice(0)) { try { unsubscribe(); } catch {} }
      await chain.catch(() => {});
      await saveState().catch(() => {});
    },
  };
}

function readConfig(config) {
  const raw = config?.get?.(`plugins.${PLUGIN_ID}`, null) ?? config?.get?.("plugins.roundPlaytimeRosterWarning", null) ?? {};
  const squadWarningSeconds = number(raw.squadWarningSeconds, 300, 0, 86400);
  return {
    enabled: raw.enabled !== false,
    squadWarningSeconds,
    leaderWarningSeconds: Math.max(squadWarningSeconds, number(raw.leaderWarningSeconds, 450, 0, 86400)),
    pollIntervalMs: number(raw.pollIntervalMs, 1000, 250, 30000),
    maxWarningChars: number(raw.maxWarningChars, 180, 80, 180),
    liveLookupWhenMissing: raw.liveLookupWhenMissing === true,
    persistState: raw.persistState !== false,
    stateFile: text(raw.stateFile) || DEFAULT_STATE_FILE,
  };
}

function mergePlayers(sources) {
  const output = [];
  const indexes = new Map();
  for (const source of sources) for (const raw of Array.isArray(source) ? source : []) {
    const next = normalizePlayer(raw);
    if (!next.name) continue;
    const keys = identityKeys(next);
    const index = keys.map((key) => indexes.get(key)).find((value) => value != null);
    if (index == null) output.push(next);
    else output[index] = merge(output[index], next);
    const resolvedIndex = index ?? output.length - 1;
    for (const key of identityKeys(output[resolvedIndex])) indexes.set(key, resolvedIndex);
  }
  return output;
}

function normalizePlayer(raw) {
  const fireTeam = resolvePlayerFireTeam(raw, raw?.bzssCore ?? raw).fireTeam;
  const role = text(raw.role ?? raw.roleName ?? raw?.soldierInfo?.soldierClass ?? raw?.bzssCore?.soldierInfo?.soldierClass);
  const roleInfo = resolveRole(role);
  return {
    playerID: id(raw.playerID ?? raw.playerId ?? raw.playerIndex ?? raw.id),
    name: text(raw.name ?? raw.playerName ?? raw.displayName),
    steamID: text(raw.steamID ?? raw.steamId ?? raw.steam64ID),
    eosID: text(raw.eosID ?? raw.eosId ?? raw.eos),
    teamID: id(raw.teamID ?? raw.teamId ?? raw.team),
    squadID: id(raw.squadID ?? raw.squadId ?? raw.squad),
    isLeader: Boolean(raw.isLeader),
    role: roleInfo.label,
    roleShort: roleInfo.short,
    fireTeam,
    online: raw.online,
    stale: raw.stale,
    gameSeconds: null,
  };
}

function merge(base, overlay) {
  return {
    playerID: overlay.playerID || base.playerID,
    name: overlay.name || base.name,
    steamID: overlay.steamID || base.steamID,
    eosID: overlay.eosID || base.eosID,
    teamID: overlay.teamID || base.teamID,
    squadID: overlay.squadID || base.squadID,
    isLeader: base.isLeader || overlay.isLeader,
    role: base.role !== "未知兵种" ? base.role : overlay.role,
    roleShort: base.role !== "未知兵种" ? base.roleShort : overlay.roleShort,
    fireTeam: overlay.fireTeam || base.fireTeam,
    online: overlay.online ?? base.online,
    stale: overlay.stale ?? base.stale,
    gameSeconds: base.gameSeconds ?? overlay.gameSeconds,
  };
}

function resolveRole(value) {
  const normalized = text(value).toLowerCase().replace(/[_./\\-]+/g, " ");
  const rule = ROLE_LABELS.find(([patterns]) => patterns.some((pattern) => normalized.includes(pattern)));
  if (rule) return { label: rule[1], short: rule[2] };
  const clean = text(value).split(/[/.\\]/).pop().replace(/_C$/i, "").replace(/^(BP_|Role_|Soldier_)/i, "").replaceAll("_", " ");
  return { label: clean || "未知兵种", short: truncate(clean || "兵种", 4) };
}

function buildSquadRosterMessage(players, maxChars) {
  const full = players.map((player) => `（${player.fireTeam || "未分"}组）${player.role} ${player.name} 游戏时长 ${hours(player.gameSeconds)}`);
  if (length(full) <= maxChars) return full.join("\n");
  const compact = players.map((player) => `（${player.fireTeam || "?"}组）${player.roleShort}${truncate(player.name, 10)} ${hours(player.gameSeconds)}`);
  if (length(compact) <= maxChars) return compact.join("\n");
  return budget(players, maxChars, (player, limit) => `${player.fireTeam || "?"}${player.roleShort}${truncate(player.name, Math.max(1, limit - player.roleShort.length - 5))}${hoursShort(player.gameSeconds)}`);
}

function buildLeaderRosterMessage(leaders, maxChars) {
  const full = leaders.map((leader) => `${leader.squadName} 队长游戏时长 ${hours(leader.gameSeconds)}`);
  if (length(full) <= maxChars) return full.join("\n");
  const compact = leaders.map((leader) => `${truncate(leader.squadName, 10)}队长 ${hours(leader.gameSeconds)}`);
  if (length(compact) <= maxChars) return compact.join("\n");
  return budget(leaders, maxChars, (leader, limit) => `${truncate(leader.squadName, Math.max(1, limit - 7))}队长${hoursShort(leader.gameSeconds)}`);
}

function budget(items, maxChars, builder) {
  const limit = Math.max(1, Math.floor((maxChars - items.length + 1) / items.length));
  return items.map((item) => truncate(builder(item, limit), limit)).join("\n");
}
function group(players, keyFn) { const map = new Map(); for (const player of players) { const key = keyFn(player); if (!key) continue; if (!map.has(key)) map.set(key, []); map.get(key).push(player); } return map; }
function dedupe(players) { const seen = new Set(); return (players ?? []).filter((player) => { const key = player.steamID || player.eosID || player.playerID || player.name.toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function identityKeys(player) { return [["steam", player.steamID], ["eos", player.eosID], ["player", player.playerID], ["name", player.name.toLowerCase()]].filter(([, value]) => value).map(([type, value]) => `${type}:${value}`); }
function memberSort(a, b) { return fireRank(a.fireTeam) - fireRank(b.fireTeam) || Number(b.isLeader) - Number(a.isLeader) || a.name.localeCompare(b.name, "zh-CN"); }
function fireRank(value) { return value === "A" ? 0 : value === "B" ? 1 : value === "C" ? 2 : 3; }
function readSeconds(row) { const value = Number(row?.game_seconds ?? row?.gameSeconds ?? row?.steam_game_seconds ?? row?.steamGameSeconds); return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null; }
function hours(seconds) { return seconds == null ? "未知" : `${Number((seconds / 3600).toFixed(1))}小时`; }
function hoursShort(seconds) { return seconds == null ? "?h" : `${Number((seconds / 3600).toFixed(seconds >= 360000 ? 0 : 1))}h`; }
function length(lines) { return lines.reduce((sum, line) => sum + line.length, 0) + Math.max(0, lines.length - 1); }
function truncate(value, max) { const raw = String(value ?? ""); return raw.length <= max ? raw : max <= 1 ? raw.slice(0, max) : `${raw.slice(0, max - 1)}…`; }
function text(value) { return String(value ?? "").trim(); }
function id(value) { const normalized = text(value); return normalized && normalized !== "0" && normalized.toLowerCase() !== "n/a" ? normalized : ""; }
function number(value, fallback, min, max) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback; }

export const __test = { buildSquadRosterMessage, buildLeaderRosterMessage, mergePlayerSources: mergePlayers };
export default { createPlugin };
