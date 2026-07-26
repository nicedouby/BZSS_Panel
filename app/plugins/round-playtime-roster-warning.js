// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import {
  normalizeFireTeamId,
  normalizeFireTeamIndex,
  normalizeFireTeamLabel,
  resolvePlayerFireTeam,
} from "./match-end-snapshot-fireteam.js";

const PLUGIN_ID = "round-playtime-roster-warning";
const PAGE_ROUTE = "/plugins/round-playtime-roster-warning";
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
    clockInitialized: false,
    blockedRoundKey: "",
    lastError: "",
    lastDispatch: null,
    lastManualSquadNonce: "",
    lastManualLeaderNonce: "",
    lastManualSquadResult: null,
    lastManualLeaderResult: null,
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
      for (const key of Object.keys(state)) {
        if (Object.prototype.hasOwnProperty.call(saved, key)) state[key] = saved[key];
      }
    } catch (error) {
      if (error?.code !== "ENOENT") log?.warn?.(`[RoundPlaytimeRosterWarning] load state failed: ${error.message}`);
    }
  }

  async function saveState() {
    const file = statePath();
    if (!file) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: 2, ...state }, null, 2), "utf8");
  }

  function resetRound(roundKey = "") {
    state.roundKey = text(roundKey);
    state.squadSent = false;
    state.leaderSent = false;
    state.squadSentAt = "";
    state.leaderSentAt = "";
    state.lastClockSeconds = 0;
    state.clockInitialized = false;
    state.lastError = "";
    state.lastDispatch = null;
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

  async function handleManualTriggers() {
    if (cfg.manualSquadTriggerNonce && cfg.manualSquadTriggerNonce !== state.lastManualSquadNonce) {
      const result = await dispatchSquads("manual_page");
      state.lastManualSquadNonce = cfg.manualSquadTriggerNonce;
      state.lastManualSquadResult = summarizeDispatch(result);
      await saveState();
    }
    if (cfg.manualLeaderTriggerNonce && cfg.manualLeaderTriggerNonce !== state.lastManualLeaderNonce) {
      const result = await dispatchLeaders("manual_page");
      state.lastManualLeaderNonce = cfg.manualLeaderTriggerNonce;
      state.lastManualLeaderResult = summarizeDispatch(result);
      await saveState();
    }
  }

  async function evaluate(reason = "poll") {
    cfg = readConfig(config);
    if (!active()) return publicState();
    await handleManualTriggers();

    const current = clock();
    if (!current.trusted) return publicState();
    if (state.blockedRoundKey) {
      if (current.roundKey === state.blockedRoundKey) return publicState();
      state.blockedRoundKey = "";
    }
    if (state.roundKey !== current.roundKey) {
      resetRound(current.roundKey);
      state.lastClockSeconds = current.seconds;
      state.clockInitialized = true;
      await saveState();
      return publicState();
    }
    if (!state.clockInitialized) {
      state.lastClockSeconds = current.seconds;
      state.clockInitialized = true;
      await saveState();
      return publicState();
    }
    const previousSeconds = state.lastClockSeconds;
    state.lastClockSeconds = current.seconds;
    if (current.seconds < previousSeconds) {
      await saveState();
      return publicState();
    }
    const crossedSquadThreshold = previousSeconds < cfg.squadWarningSeconds
      && current.seconds >= cfg.squadWarningSeconds;
    const crossedLeaderThreshold = previousSeconds < cfg.leaderWarningSeconds
      && current.seconds >= cfg.leaderWarningSeconds;
    if (crossedSquadThreshold && !state.squadSent) {
      const result = await dispatchSquads(reason);
      if (result.attempted > 0) {
        state.squadSent = true;
        state.squadSentAt = new Date().toISOString();
        await saveState();
      }
    }
    if (crossedLeaderThreshold && !state.leaderSent) {
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
    const players = mergePlayers([
      { source: "matchState", players: basePlayers },
      { source: "playerState", players: statePlayers },
      { source: "bzssCore", players: corePlayers },
    ]).filter((player) => player.name && player.online !== false && player.stale !== true);
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
      const row = await modules.playtime.getBySteamID?.(player.steamID);
      const cachedUnpublished = row && (
        row.found === false
        || row.isPublic === false
        || String(row.visibility ?? "").toLowerCase() === "private"
      );
      let seconds = cachedUnpublished ? null : readSeconds(row);
      if (seconds == null || cachedUnpublished) {
        // 未公开或没有缓存时，先尝试实时获取一次。
        const lookup = await modules.playtime.lookupSteamID?.(player.steamID, { lastSeenName: player.name });
        seconds = lookup?.found === false ? null : readSeconds(lookup);
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
    if (typeof api !== "function") return { success: false, errorMessage: "adminWarn API unavailable" };
    return api.call(modules.adminWarn, {
      targetName: recipient.name,
      targetPlayerId: recipient.playerID || undefined,
      targetSteamId: recipient.steamID || undefined,
      targetEosId: recipient.eosID || undefined,
      message,
      reason,
      sourceModule: PLUGIN_ID,
      relatedEventId: `${state.roundKey || "manual"}:${reason}`,
      system: true,
    });
  }

  async function dispatchSquads(reason = "clock") {
    try {
      const { players } = roster();
      const groups = group(players, (player) => player.teamID && player.squadID ? `${player.teamID}|${player.squadID}` : "");
      await enrich([...groups.values()].flat());
      let attempted = 0;
      let succeeded = 0;
      let failed = 0;
      for (const members of groups.values()) {
        members.sort(memberSort);
        const message = buildSquadRosterMessage(members, cfg.maxWarningChars, cfg.lineBreakMode);
        for (const recipient of dedupe(members)) {
          attempted += 1;
          try {
            const result = await warn(recipient, message, `round_squad_playtime_${reason}`);
            if (result?.success) succeeded += 1;
            else failed += 1;
          } catch {
            failed += 1;
          }
        }
      }
      const result = { type: "squad", attempted, succeeded, failed, groupCount: groups.size, at: new Date().toISOString() };
      state.lastDispatch = result;
      state.lastError = failed > 0 ? `warn_failed_${failed}` : "";
      return result;
    } catch (error) {
      state.lastError = error.message ?? String(error);
      log?.warn?.(`[RoundPlaytimeRosterWarning] squad dispatch failed: ${state.lastError}`);
      return { type: "squad", attempted: 0, succeeded: 0, failed: 0, groupCount: 0, error: state.lastError };
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
      let succeeded = 0;
      let failed = 0;
      for (const [teamID, teamLeaders] of byTeam) {
        const lines = teamLeaders.map((leader) => ({
          ...leader,
          squadName: text(squadNames.get(`${leader.teamID}|${leader.squadID}`)) || "未命名队",
        })).sort((a, b) => a.squadName.localeCompare(b.squadName, "zh-CN"));
        const message = buildLeaderRosterMessage(lines, cfg.maxWarningChars, cfg.lineBreakMode);
        for (const recipient of dedupe(recipients.get(teamID) ?? [])) {
          attempted += 1;
          try {
            const result = await warn(recipient, message, `round_leader_playtime_${reason}`);
            if (result?.success) succeeded += 1;
            else failed += 1;
          } catch {
            failed += 1;
          }
        }
      }
      const result = { type: "leader", attempted, succeeded, failed, teamCount: byTeam.size, at: new Date().toISOString() };
      state.lastDispatch = result;
      state.lastError = failed > 0 ? `warn_failed_${failed}` : "";
      return result;
    } catch (error) {
      state.lastError = error.message ?? String(error);
      log?.warn?.(`[RoundPlaytimeRosterWarning] leader dispatch failed: ${state.lastError}`);
      return { type: "leader", attempted: 0, succeeded: 0, failed: 0, teamCount: 0, error: state.lastError };
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
    getRosterDiagnostics: () => roster(),
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "开局小队与队长游戏时长提醒",
      kind: "plugin",
      version: "1.1.0",
      category: "Moderation",
      description: "日志时间达到5分钟时发送小队成员时长，达到7分30秒时发送本阵营各小队长时长。",
      config: { ...cfg },
      configSchema: [
        { key: "enabled", type: "boolean", default: true, description: "是否启用插件" },
        { key: "squadWarningSeconds", type: "number", default: 300, description: "小队成员提醒时间（秒）" },
        { key: "leaderWarningSeconds", type: "number", default: 450, description: "阵营队长提醒时间（秒）" },
        { key: "lineBreakMode", type: "select", default: "actual", options: [
          { label: "RCON 转义换行（推荐）", value: "escaped" },
          { label: "真实换行", value: "actual" },
          { label: "竖线分隔", value: "separator" },
        ], description: "游戏内多行传输方式" },
        { key: "maxWarningChars", type: "number", default: 180, description: "单条警告最大字符数" },
        { key: "liveLookupWhenMissing", type: "boolean", default: false, description: "缺少缓存时实时查询 Steam 时长" },
      ],
    },
    apiName: "roundPlaytimeRosterWarning",
    api,
    async init() { cfg = readConfig(config); await loadState(); },
    async start() {
      cfg = readConfig(config);
      core?.webRegistry?.registerPage?.({
        id: "web.roundPlaytimeRosterWarning",
        title: "开局时长提醒",
        group: "插件",
        route: PAGE_ROUTE,
        source: PLUGIN_ID,
        description: "管理小队/队长游戏时长提醒，检查 ABC 火力组并手动触发。",
        required: false,
        superAdminOnly: true,
        enabled: true,
        order: 44,
        icon: "⏱",
      });
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
      log?.info?.(`[RoundPlaytimeRosterWarning] started: ${cfg.squadWarningSeconds}s / ${cfg.leaderWarningSeconds}s lineBreak=${cfg.lineBreakMode}`);
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
    lineBreakMode: normalizeLineBreakMode(raw.lineBreakMode),
    liveLookupWhenMissing: raw.liveLookupWhenMissing === true,
    persistState: raw.persistState !== false,
    stateFile: text(raw.stateFile) || DEFAULT_STATE_FILE,
    manualSquadTriggerNonce: text(raw.manualSquadTriggerNonce),
    manualLeaderTriggerNonce: text(raw.manualLeaderTriggerNonce),
  };
}

function mergePlayers(sources) {
  const normalizedSources = (sources ?? []).map((entry, index) => Array.isArray(entry)
    ? { source: `source${index}`, players: entry }
    : { source: text(entry?.source) || `source${index}`, players: entry?.players ?? [] });
  const output = [];
  const indexes = new Map();
  for (const source of normalizedSources) for (const raw of Array.isArray(source.players) ? source.players : []) {
    const next = normalizePlayer(raw, source.source);
    if (!next.name) continue;
    const keys = identityKeys(next);
    const index = keys.map((key) => indexes.get(key)).find((value) => value != null);
    if (index == null) output.push(next);
    else output[index] = merge(output[index], next);
    const resolvedIndex = index ?? output.length - 1;
    for (const key of identityKeys(output[resolvedIndex])) indexes.set(key, resolvedIndex);
  }
  return output.map(finalizeFireTeam);
}

function normalizePlayer(raw, sourceName = "player") {
  const role = text(raw.role ?? raw.roleName ?? raw?.rcon?.role ?? raw?.soldierInfo?.soldierClass ?? raw?.bzssCore?.soldierInfo?.soldierClass);
  const roleInfo = resolveRole(role);
  const evidence = collectFireTeamEvidence(raw, sourceName);
  const selected = selectFireTeamEvidence(evidence);
  return {
    playerID: id(raw.playerID ?? raw.playerId ?? raw.playerIndex ?? raw.id ?? raw?.rcon?.playerID),
    name: text(raw.name ?? raw.playerName ?? raw.displayName ?? raw?.rcon?.name),
    steamID: text(raw.steamID ?? raw.steamId ?? raw.steam64ID ?? raw?.rcon?.steamID),
    eosID: text(raw.eosID ?? raw.eosId ?? raw.eos ?? raw?.rcon?.eosID),
    teamID: id(raw.teamID ?? raw.teamId ?? raw.team ?? raw?.rcon?.teamID),
    squadID: id(raw.squadID ?? raw.squadId ?? raw.squad ?? raw?.rcon?.squadID),
    isLeader: Boolean(raw.isLeader ?? raw?.rcon?.isLeader),
    role: roleInfo.label,
    roleShort: roleInfo.short,
    fireTeam: selected.fireTeam,
    fireTeamRaw: selected.raw,
    fireTeamSource: selected.source,
    fireTeamConflict: selected.conflict,
    fireTeamEvidence: evidence,
    ftIndex: nullableNumber(raw.ftIndex ?? raw.fireTeamIndex ?? raw?.playerScoreboard?.fireTeamIndex),
    ftPosition: nullableNumber(raw.ftPosition ?? raw.fireTeamPosition ?? raw?.playerScoreboard?.fireTeamPosition),
    online: raw.online ?? raw?.rcon?.online,
    stale: raw.stale,
    gameSeconds: null,
  };
}

function collectFireTeamEvidence(raw, sourceName) {
  if (!text(sourceName).toLowerCase().includes("bzsscore")) return [];
  const evidence = [];
  const add = (fireTeam, rawValue, source, priority) => {
    if (!fireTeam) return;
    const key = `${fireTeam}|${source}|${String(rawValue)}`;
    if (evidence.some((item) => item.key === key)) return;
    evidence.push({ key, fireTeam, raw: rawValue, source, priority });
  };

  const resolved = resolvePlayerFireTeam(raw, raw?.bzssCore ?? raw);
  add(resolved.fireTeam, resolved.fireTeamRaw, `${sourceName}.${resolved.fireTeamSource}`, evidencePriority(resolved.fireTeamSource, sourceName));

  const scoreboard = raw?.playerScoreboard;
  if (scoreboard && typeof scoreboard === "object") {
    const nested = resolvePlayerFireTeam(scoreboard, scoreboard);
    add(nested.fireTeam, nested.fireTeamRaw, `${sourceName}.playerScoreboard.${nested.fireTeamSource}`, 420);
    add(normalizeFireTeamIndex(scoreboard.fireTeamIndex), scoreboard.fireTeamIndex, `${sourceName}.playerScoreboard.fireTeamIndex`, 430);
    add(normalizeFireTeamIndex(scoreboard.ftIndex), scoreboard.ftIndex, `${sourceName}.playerScoreboard.ftIndex`, 430);
  }

  const numericFireTeam = nullableNumber(raw?.fireTeam ?? raw?.fireteam);
  if (numericFireTeam != null) {
    add(normalizeFireTeamIndex(numericFireTeam), numericFireTeam, `${sourceName}.fireTeam(numeric-index)`, 260);
  }
  add(normalizeFireTeamLabel(raw?.fireTeamName ?? raw?.fireteamName), raw?.fireTeamName ?? raw?.fireteamName, `${sourceName}.fireTeamName`, 520);
  add(normalizeFireTeamId(raw?.fireTeamID ?? raw?.fireTeamId), raw?.fireTeamID ?? raw?.fireTeamId, `${sourceName}.fireTeamID`, 470);
  add(normalizeFireTeamIndex(raw?.ftIndex), raw?.ftIndex, `${sourceName}.ftIndex`, sourceName.toLowerCase().includes("bzss") ? 410 : 330);
  add(normalizeFireTeamIndex(raw?.fireTeamIndex), raw?.fireTeamIndex, `${sourceName}.fireTeamIndex`, sourceName.toLowerCase().includes("bzss") ? 410 : 330);
  return evidence.sort((a, b) => b.priority - a.priority);
}

function evidencePriority(source, sourceName) {
  const pathText = text(source).toLowerCase();
  let value = 200;
  if (pathText.includes("fireteamname") || pathText.endsWith(".fireteam")) value = 500;
  else if (pathText.includes("fireteamid")) value = 460;
  else if (pathText.includes("ftindex") || pathText.includes("fireteamindex")) value = 350;
  if (text(sourceName).toLowerCase().includes("bzss")) value += 40;
  return value;
}

function selectFireTeamEvidence(evidence) {
  const valid = (evidence ?? []).filter((item) => item.fireTeam);
  const selected = valid[0] ?? { fireTeam: "", raw: null, source: "unknown" };
  return {
    fireTeam: selected.fireTeam,
    raw: selected.raw,
    source: selected.source,
    conflict: new Set(valid.map((item) => item.fireTeam)).size > 1,
  };
}

function finalizeFireTeam(player) {
  const selected = selectFireTeamEvidence(player.fireTeamEvidence);
  return {
    ...player,
    fireTeam: selected.fireTeam,
    fireTeamRaw: selected.raw,
    fireTeamSource: selected.source,
    fireTeamConflict: selected.conflict,
  };
}

function merge(base, overlay) {
  const online = base.online === true || overlay.online === true ? true : (overlay.online ?? base.online);
  const evidence = [...(base.fireTeamEvidence ?? []), ...(overlay.fireTeamEvidence ?? [])]
    .sort((a, b) => b.priority - a.priority);
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
    fireTeamEvidence: evidence,
    fireTeam: "",
    fireTeamRaw: null,
    fireTeamSource: "unknown",
    fireTeamConflict: false,
    ftIndex: overlay.ftIndex ?? base.ftIndex,
    ftPosition: overlay.ftPosition ?? base.ftPosition,
    online,
    stale: online === true ? false : (overlay.stale ?? base.stale),
    gameSeconds: base.gameSeconds ?? overlay.gameSeconds,
  };
}

function resolveRole(value) {
  return {
    label: resolveRoleLabel(value),
    short: resolveRoleShortLabel(value),
  };
}

function buildSquadRosterLines(players, compact = false) {
  if (!compact) return players.map((player) => `${player.fireTeam ? `${player.fireTeam}组` : ""}${player.role} ${player.name} ${hours(player.gameSeconds)}`);
  return players.map((player) => `${player.fireTeam ? `${player.fireTeam}组` : ""}${player.roleShort} ${truncate(player.name, 10)} ${hours(player.gameSeconds)}`);
}

function buildLeaderRosterLines(leaders, compact = false) {
  if (!compact) return leaders.map((leader) => `${leader.squadName}队长 ${hours(leader.gameSeconds)}`);
  return leaders.map((leader) => `${truncate(leader.squadName, 10)}队长 ${hours(leader.gameSeconds)}`);
}

function buildSquadRosterMessage(players, maxChars, lineBreakMode = "escaped") {
  const full = buildSquadRosterLines(players, false);
  if (wireLength(full, lineBreakMode) <= maxChars) return encodeLines(full, lineBreakMode);
  const compact = buildSquadRosterLines(players, true);
  if (wireLength(compact, lineBreakMode) <= maxChars) return encodeLines(compact, lineBreakMode);
  return budget(players, maxChars, lineBreakMode, (player, limit) => `${player.fireTeam ? `${player.fireTeam}组` : ""}${player.roleShort} ${truncate(player.name, Math.max(1, limit - player.roleShort.length - 7))} ${hoursShort(player.gameSeconds)}`);
}

function buildLeaderRosterMessage(leaders, maxChars, lineBreakMode = "escaped") {
  const full = buildLeaderRosterLines(leaders, false);
  if (wireLength(full, lineBreakMode) <= maxChars) return encodeLines(full, lineBreakMode);
  const compact = buildLeaderRosterLines(leaders, true);
  if (wireLength(compact, lineBreakMode) <= maxChars) return encodeLines(compact, lineBreakMode);
  return budget(leaders, maxChars, lineBreakMode, (leader, limit) => `${truncate(leader.squadName, Math.max(1, limit - 7))}队长${hoursShort(leader.gameSeconds)}`);
}

function encodeLines(lines, mode) { return lines.join(lineSeparator(mode)); }
function lineSeparator(mode) { return mode === "actual" ? "\n" : mode === "separator" ? "｜" : "\\n"; }
function wireLength(lines, mode) { return lines.reduce((sum, line) => sum + line.length, 0) + Math.max(0, lines.length - 1) * lineSeparator(mode).length; }
function budget(items, maxChars, mode, builder) {
  const separatorLength = Math.max(0, items.length - 1) * lineSeparator(mode).length;
  const limit = Math.max(1, Math.floor((maxChars - separatorLength) / Math.max(1, items.length)));
  return encodeLines(items.map((item) => truncate(builder(item, limit), limit)), mode);
}
function normalizeLineBreakMode(value) { const mode = text(value).toLowerCase(); return ["escaped", "actual", "separator"].includes(mode) ? mode : "actual"; }
function summarizeDispatch(result) { return result ? { ...result } : null; }
function group(players, keyFn) { const map = new Map(); for (const player of players) { const key = keyFn(player); if (!key) continue; if (!map.has(key)) map.set(key, []); map.get(key).push(player); } return map; }
function dedupe(players) { const seen = new Set(); return (players ?? []).filter((player) => { const key = player.steamID || player.eosID || player.playerID || player.name.toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function identityKeys(player) { return [["steam", player.steamID], ["eos", player.eosID], ["player", player.playerID], ["name", player.name.toLowerCase()]].filter(([, value]) => value).map(([type, value]) => `${type}:${value}`); }
function memberSort(a, b) { return fireRank(a.fireTeam) - fireRank(b.fireTeam) || Number(b.isLeader) - Number(a.isLeader) || a.name.localeCompare(b.name, "zh-CN"); }
function fireRank(value) { return value === "A" ? 0 : value === "B" ? 1 : value === "C" ? 2 : 3; }
function readSeconds(row) { const value = Number(row?.game_seconds ?? row?.gameSeconds ?? row?.steam_game_seconds ?? row?.steamGameSeconds); return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null; }
function hours(seconds) { return seconds == null ? "未公开" : `${Number((seconds / 3600).toFixed(1))}h`; }
function hoursShort(seconds) { return seconds == null ? "未公开" : `${Number((seconds / 3600).toFixed(seconds >= 360000 ? 0 : 1))}h`; }
function truncate(value, max) { const raw = String(value ?? ""); return raw.length <= max ? raw : max <= 1 ? raw.slice(0, max) : `${raw.slice(0, max - 1)}…`; }
function text(value) { return String(value ?? "").trim(); }
function id(value) { const normalized = text(value); return normalized && normalized !== "0" && normalized.toLowerCase() !== "n/a" ? normalized : ""; }
function nullableNumber(value) { if (value == null || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function number(value, fallback, min, max) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback; }

export const __test = {
  buildSquadRosterMessage,
  buildLeaderRosterMessage,
  buildSquadRosterLines,
  buildLeaderRosterLines,
  mergePlayerSources: mergePlayers,
  normalizePlayer,
};
export default { createPlugin };
