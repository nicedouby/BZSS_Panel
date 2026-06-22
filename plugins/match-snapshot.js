import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const PLUGIN_ID = "match-snapshot";
const SNAPSHOT_DIR = "./data/match-snapshots";
const ICON_BASE_DIR = path.resolve(process.cwd(), "web-client/public");
const ARTIFACTS = [
  { format: "json", extension: ".json", label: "JSON", contentType: "application/json; charset=utf-8" },
  { format: "image", extension: ".png", label: "PNG", contentType: "image/png" },
  { format: "csv", extension: ".csv", label: "CSV", contentType: "text/csv; charset=utf-8" },
  { format: "markdown", extension: ".md", label: "Markdown", contentType: "text/markdown; charset=utf-8" },
];
const FORMAT_ALIASES = { png: "image", svg: "image", md: "markdown" };
const SHARP_BUNDLE_ROOT = "C:/Users/12703/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const sharpRequire = createRequire(import.meta.url);

const ROLE_ICON_MATCHES = [
  { patterns: ["squadleader", "sl", "leader"], icon: "/Icon/T_role_squadleader.PNG", label: "SL", tone: "#f59e0b" },
  { patterns: ["medic"], icon: "/Icon/T_role_medic.PNG", label: "Medic", tone: "#22c55e" },
  { patterns: ["heavyantitank", "heavy anti tank", "heavy anti-tank", "hat"], icon: "/Icon/T_role_heavyantitank.PNG", label: "HAT", tone: "#ef4444" },
  { patterns: ["lightantitank", "light anti tank", "light anti-tank", "antitank", "anti tank", "lat"], icon: "/Icon/T_role_lightantitank.PNG", label: "LAT", tone: "#f97316" },
  { patterns: ["machinegunner", "machine gunner", "mg"], icon: "/Icon/T_role_machinegunner.PNG", label: "MG", tone: "#8b5cf6" },
  { patterns: ["automaticrifleman", "automatic rifleman", "ar"], icon: "/Icon/T_role_automaticrifleman.PNG", label: "AR", tone: "#8b5cf6" },
  { patterns: ["combatengineer", "combat engineer", "engineer"], icon: "/Icon/T_role_engineer.PNG", label: "ENG", tone: "#eab308" },
  { patterns: ["designatedmarksman", "designated marksman", "marksman"], icon: "/Icon/T_role_designatedmarksman.PNG", label: "DMR", tone: "#06b6d4" },
  { patterns: ["sniper"], icon: "/Icon/T_role_sniper.PNG", label: "Sniper", tone: "#06b6d4" },
  { patterns: ["scout"], icon: "/Icon/T_role_scout.PNG", label: "Scout", tone: "#38bdf8" },
  { patterns: ["grenadier"], icon: "/Icon/T_role_grenadier.PNG", label: "Gren", tone: "#38bdf8" },
  { patterns: ["crewman", "crew"], icon: "/Icon/T_role_crewman.PNG", label: "Crew", tone: "#94a3b8" },
  { patterns: ["pilot"], icon: "/Icon/T_role_pilot.PNG", label: "Pilot", tone: "#38bdf8" },
  { patterns: ["rifleman scoped", "riflemanscoped"], icon: "/Icon/T_role_rifleman_scoped.PNG", label: "Rifle", tone: "#38bdf8" },
  { patterns: ["rifleman"], icon: "/Icon/T_role_rifleman.PNG", label: "Rifle", tone: "#38bdf8" },
];

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger ??
    core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "plugin",
    }) ??
    core?.logger ??
    console;

  async function takeSnapshot(triggerEvent = {}, inputOptions = {}) {
    const triggerName = String(triggerEvent?.eventName ?? triggerEvent?.type ?? "event");
    pluginLogger.info?.(`[MatchSnapshot] capturing player list triggered by ${triggerName}.`);

    await ensureSnapshotDir();

    const overview = getCurrentOverview();
    if (!overview) {
      pluginLogger.warn?.("[MatchSnapshot] match-state overview is unavailable.");
      return null;
    }

    const renderOptions = normalizeSnapshotOptions(inputOptions);
    const capturedAt = new Date().toISOString();
    const payload = await buildSnapshotPayload({
      overview,
      triggerEvent,
      capturedAt,
      renderOptions,
      modules,
    });
    const baseName = buildSnapshotBaseName(payload);
    const files = {
      json: `${baseName}.json`,
      image: `${baseName}.png`,
      csv: `${baseName}.csv`,
      markdown: `${baseName}.md`,
    };

    await Promise.all([
      writeArtifact(files.json, JSON.stringify(payload, null, 2)),
      writeArtifact(files.image, await generatePlayerListPng(payload, renderOptions)),
      writeArtifact(files.csv, generatePlayerCsv(payload, renderOptions)),
      writeArtifact(files.markdown, generateMarkdownReport(payload, renderOptions)),
    ]);

    const item = await describeSnapshot(baseName);
    pluginLogger.info?.(`[MatchSnapshot] saved ${baseName}.`);
    return item;
  }

  async function listSnapshots() {
    try {
      await ensureSnapshotDir();
      const files = await fs.readdir(resolveSnapshotDir());
      const baseNames = new Set();
      for (const file of files) {
        const artifact = artifactFromFilename(file);
        if (!artifact) continue;
        baseNames.add(file.slice(0, -artifact.extension.length));
      }

      const snapshots = [];
      for (const baseName of baseNames) {
        const item = await describeSnapshot(baseName);
        if (item) snapshots.push(item);
      }

      return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch (error) {
      pluginLogger.error?.(`[MatchSnapshot] list failed: ${error?.message || error}`);
      return [];
    }
  }

  async function readSnapshotArtifact(id, format = "json") {
    await ensureSnapshotDir();
    const fileName = resolveArtifactFileName(id, format);
    const artifact = artifactFromFilename(fileName);
    if (!artifact) {
      const error = new Error("Unsupported snapshot artifact format.");
      error.code = "UnsupportedFormat";
      error.statusCode = 400;
      throw error;
    }

    const content = await fs.readFile(path.join(resolveSnapshotDir(), fileName));
    return {
      id: fileName,
      fileName,
      format: artifact.format,
      contentType: artifact.contentType,
      content,
    };
  }

  async function deleteSnapshot(id) {
    await ensureSnapshotDir();
    const baseName = sanitizeBaseName(path.basename(String(id ?? "").trim()).replace(/\.(json|png|svg|csv|md)$/i, ""));
    if (!baseName) {
      const error = new Error("Snapshot id is required.");
      error.code = "MissingId";
      error.statusCode = 400;
      throw error;
    }

    const removedFiles = [];
    for (const artifact of ARTIFACTS) {
      const fileName = `${baseName}${artifact.extension}`;
      try {
        await fs.unlink(path.join(resolveSnapshotDir(), fileName));
        removedFiles.push(fileName);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    return {
      id: baseName,
      removed: removedFiles.length > 0,
      removedFiles,
    };
  }

  function getCurrentOverview() {
    const api = modules?.matchState?.api ?? modules?.matchState;
    const overview = api?.getOverview?.();
    if (overview) return overview;

    const matchState = api?.getState?.();
    if (!matchState) return null;
    return {
      status: core?.webStatus?.getSnapshot?.() ?? {},
      matchState,
      serverStatus: matchState.serverStatus,
      match: matchState.match,
      players: Array.isArray(matchState.players?.list) ? matchState.players.list : [],
      squads: Array.isArray(matchState.squads?.list) ? matchState.squads.list : [],
    };
  }

  const api = {
    deleteSnapshot,
    listSnapshots,
    readSnapshotArtifact,
    takeSnapshot,
    takeManualSnapshot: (options = {}) => takeSnapshot({ eventName: "MANUAL_TRIGGER" }, options),
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "对局快照",
      kind: "plugin",
      version: "1.4.0",
      description: "录制对局状态玩家列表，并输出 PNG、JSON、CSV、Markdown 文件。",
    },
    apiName: "matchSnapshot",
    api,

    async start() {
      if (core?.eventBus?.onCoreEvent) {
        core.eventBus.onCoreEvent("round.match_winner", (event) => takeSnapshot(event).catch((error) => {
          pluginLogger.error?.(`[MatchSnapshot] round.match_winner capture failed: ${error?.stack || error}`);
        }));
        core.eventBus.onCoreEvent("MATCH_END", (event) => takeSnapshot(event).catch((error) => {
          pluginLogger.error?.(`[MatchSnapshot] MATCH_END capture failed: ${error?.stack || error}`);
        }));
      }

      const enableDebug = config?.get?.("web.enableDebugPage", false);
      if (enableDebug) {
        core?.webRegistry?.registerPage?.({
          id: `web.${PLUGIN_ID}.debug`,
          title: "快照录制",
          group: "调试",
          route: "/debug/match-snapshots",
          pageModule: "/pages/match-snapshot-debug.js",
          source: PLUGIN_ID,
          description: "查看和管理已录制的对局状态玩家列表快照。",
          required: false,
          enabled: true,
          order: 999,
          icon: "SNP",
        });
      }

      pluginLogger.info?.(`[MatchSnapshot] plugin started${enableDebug ? " with debug page" : ""}.`);
    },

    async stop() {
      pluginLogger.info?.("[MatchSnapshot] plugin stopped.");
    },
  };
}

function resolveSnapshotDir() {
  return path.resolve(process.cwd(), SNAPSHOT_DIR);
}

async function ensureSnapshotDir() {
  await fs.mkdir(resolveSnapshotDir(), { recursive: true });
}

async function writeArtifact(fileName, content) {
  const filePath = path.join(resolveSnapshotDir(), fileName);
  if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
    await fs.writeFile(filePath, content);
    return;
  }
  await fs.writeFile(filePath, `${String(content ?? "")}\n`, "utf8");
}

async function describeSnapshot(baseName) {
  const files = {};
  const artifacts = [];
  let createdAt = "";
  let totalSize = 0;

  for (const artifact of ARTIFACTS) {
    const fileName = `${baseName}${artifact.extension}`;
    try {
      const stats = await fs.stat(path.join(resolveSnapshotDir(), fileName));
      const item = {
        format: artifact.format,
        label: artifact.label,
        id: fileName,
        fileName,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
      };
      files[artifact.format] = fileName;
      artifacts.push(item);
      totalSize += stats.size;
      if (!createdAt || item.createdAt > createdAt) createdAt = item.createdAt;
    } catch {}
  }

  if (!artifacts.length) return null;
  const jsonArtifact = artifacts.find((item) => item.format === "json");
  return {
    id: baseName,
    name: baseName,
    createdAt: jsonArtifact?.createdAt ?? createdAt,
    size: jsonArtifact?.size ?? totalSize,
    totalSize,
    file: jsonArtifact?.fileName ?? artifacts[0].fileName,
    files,
    artifacts,
  };
}

function artifactFromFilename(fileName) {
  const name = path.basename(String(fileName ?? ""));
  return ARTIFACTS.find((artifact) => name.endsWith(artifact.extension)) ?? null;
}

function resolveArtifactFileName(id, format) {
  const rawId = path.basename(String(id ?? "").trim());
  if (!rawId) {
    const error = new Error("Snapshot id is required.");
    error.code = "MissingId";
    error.statusCode = 400;
    throw error;
  }

  const direct = artifactFromFilename(rawId);
  if (direct) return rawId;

  const requestedFormat = String(format ?? "json").trim().toLowerCase() || "json";
  const normalizedFormat = FORMAT_ALIASES[requestedFormat] ?? requestedFormat;
  const artifact = ARTIFACTS.find((item) => item.format === normalizedFormat);
  if (!artifact) {
    const error = new Error("Unsupported snapshot artifact format.");
    error.code = "UnsupportedFormat";
    error.statusCode = 400;
    throw error;
  }

  return `${sanitizeBaseName(rawId)}${artifact.extension}`;
}

async function buildSnapshotPayload({ overview, triggerEvent, capturedAt, renderOptions, modules }) {
  const matchState = overview?.matchState && typeof overview.matchState === "object" ? overview.matchState : {};
  const status = overview?.status && typeof overview.status === "object" ? overview.status : {};
  const serverStatus = matchState.serverStatus && typeof matchState.serverStatus === "object" ? matchState.serverStatus : {};
  const bzssCoreApi = modules?.bzssCoreMonitor?.api ?? modules?.bzssCoreMonitor ?? null;
  const bzssCoreRawSnapshot = typeof bzssCoreApi?.getRawSnapshot === "function"
    ? bzssCoreApi.getRawSnapshot()
    : null;
  const match = {
    ...(matchState.match && typeof matchState.match === "object" ? matchState.match : {}),
    ...(overview?.match && typeof overview.match === "object" ? overview.match : {}),
  };

  let players = normalizePlayers(
    Array.isArray(overview?.players)
      ? overview.players
      : Array.isArray(matchState.players?.list)
        ? matchState.players.list
        : [],
  );
  const squads = normalizeSquads(
    Array.isArray(overview?.squads)
      ? overview.squads
      : Array.isArray(matchState.squads?.list)
        ? matchState.squads.list
        : [],
  );

  players = await enrichPlayers(players, {
    modules,
    serverId: stringifyValue(matchState.serverId ?? overview?.serverId ?? status.serverId ?? ""),
  });
  const teams = buildTeams(players, squads);

  return {
    schemaVersion: 4,
    capturedAt,
    generatedBy: PLUGIN_ID,
    trigger: {
      eventName: String(triggerEvent?.eventName ?? triggerEvent?.type ?? "MANUAL_TRIGGER"),
      winner: stringifyValue(triggerEvent?.winner ?? triggerEvent?.winningTeam ?? triggerEvent?.team ?? ""),
      raw: cloneJsonSafe(triggerEvent ?? {}),
    },
    server: {
      serverId: stringifyValue(matchState.serverId ?? overview?.serverId ?? status.serverId ?? ""),
      serverName: firstText(status.serverName, status.name, serverStatus.serverName, serverStatus.name),
      rcon: firstText(matchState.rconStatus?.status, status.rcon, serverStatus.rcon),
      capturedFrom: "match-state",
    },
    match: {
      map: firstText(match.map, status.map, serverStatus.map, status.currentLayer, serverStatus.layer),
      layer: firstText(match.layer, status.layer, status.currentLayer, serverStatus.layer),
      mode: firstText(match.mode, match.gameMode, status.gameMode, status.mode, serverStatus.gameMode, serverStatus.mode),
      nextLayer: firstText(match.nextLayer, status.nextLayer, serverStatus.nextLayer),
      playtime: firstFiniteNumber(match.playtime, status.playtime, serverStatus.playtime, status.matchTimeSeconds, serverStatus.matchTimeSeconds),
      tps: firstFiniteNumber(status.tps, serverStatus.tps),
      playerCount: players.length,
      maxPlayers: firstFiniteNumber(status.maxPlayers, serverStatus.maxPlayers),
    },
    summary: {
      playerCount: players.length,
      squadCount: squads.length,
      teamCount: teams.length,
      leaderCount: players.filter((player) => player.isLeader).length,
      unassignedCount: teams.reduce((sum, team) => sum + team.unassignedPlayers.length, 0),
    },
    teams,
    players,
    squads,
    captureZones: Array.isArray(bzssCoreRawSnapshot?.captureZones)
      ? bzssCoreRawSnapshot.captureZones.map((zone) => cloneJsonSafe(zone))
      : [],
    fobs: Array.isArray(bzssCoreRawSnapshot?.fobs)
      ? bzssCoreRawSnapshot.fobs.map((fob) => cloneJsonSafe(fob))
      : [],
    source: {
      matchStateUpdatedAt: firstText(matchState.updatedAt, matchState.players?.lastUpdatedAt, matchState.squads?.lastUpdatedAt),
      playersUpdatedAt: firstText(matchState.players?.lastUpdatedAt),
      squadsUpdatedAt: firstText(matchState.squads?.lastUpdatedAt),
      bzssCoreUpdatedAt: firstText(bzssCoreRawSnapshot?.updatedAt, bzssCoreRawSnapshot?.lastCompletedAt),
    },
    renderOptions: {
      includeSteamID: Boolean(renderOptions?.includeSteamID ?? true),
      includeEOSID: Boolean(renderOptions?.includeEOSID ?? false),
    },
  };
}

async function enrichPlayers(players, { modules, serverId }) {
  const byIdentity = new Map(players.map((player) => [buildIdentityKey(player), { ...player }]));
  await enrichPlayersWithPlaytime(byIdentity, modules);
  enrichPlayersWithCombat(byIdentity, modules, serverId);
  return [...byIdentity.values()].sort((left, right) =>
    compareNumbers(left.teamID, right.teamID)
    || compareNumbers(left.squadID, right.squadID)
    || String(left.name).localeCompare(String(right.name), "zh-CN"));
}

async function enrichPlayersWithPlaytime(byIdentity, modules) {
  const playtimeApi = modules?.playtime?.api ?? modules?.playtime ?? null;
  if (typeof playtimeApi?.enrichPlayers !== "function") return;

  const enriched = await playtimeApi.enrichPlayers([...byIdentity.values()]);
  for (const player of enriched) {
    const key = buildIdentityKey(player);
    if (!byIdentity.has(key)) continue;
    byIdentity.set(key, {
      ...byIdentity.get(key),
      gameSeconds: normalizeNumber(player?.gameSeconds),
      gameHours: normalizeNumber(player?.gameHours),
      steamPlaytime: cloneJsonSafe(player?.steamPlaytime ?? null),
    });
  }
}

function enrichPlayersWithCombat(byIdentity, modules, serverId) {
  const combatApi = modules?.combatClean?.api ?? modules?.combatClean ?? modules?.combatManager?.api ?? modules?.combatManager ?? null;
  if (typeof combatApi?.getEvents !== "function") {
    for (const [key, player] of byIdentity) {
      byIdentity.set(key, { ...player, combatStats: emptyCombatStats() });
    }
    return;
  }

  const events = combatApi.getEvents({ serverId, limit: 5000 }) ?? [];
  const statsByIdentity = new Map();

  for (const event of events) {
    const type = normalizeCombatType(event?.type);
    const attackerKey = buildEventPlayerKey(event?.attacker);
    const victimKey = buildEventPlayerKey(event?.victim);

    if (type === "wound" && attackerKey) incrementCombatStat(statsByIdentity, attackerKey, "wounds");
    if (type === "kill") {
      if (attackerKey) incrementCombatStat(statsByIdentity, attackerKey, "kills");
      if (victimKey) incrementCombatStat(statsByIdentity, victimKey, "deaths");
    }
    if (type === "tk") {
      if (attackerKey) incrementCombatStat(statsByIdentity, attackerKey, "tk");
      if (victimKey) incrementCombatStat(statsByIdentity, victimKey, "deaths");
    }
  }

  for (const [key, player] of byIdentity) {
    byIdentity.set(key, { ...player, combatStats: statsByIdentity.get(key) ?? emptyCombatStats() });
  }
}

function incrementCombatStat(statsByIdentity, identityKey, field) {
  if (!identityKey) return;
  const next = statsByIdentity.get(identityKey) ?? emptyCombatStats();
  next[field] += 1;
  statsByIdentity.set(identityKey, next);
}

function emptyCombatStats() {
  return {
    kills: 0,
    wounds: 0,
    deaths: 0,
    tk: 0,
  };
}

function normalizeCombatType(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "teamkill" || text === "tk") return "tk";
  if (text === "death") return "kill";
  return text;
}

function normalizePlayers(players) {
  return players.map((player) => ({
    playerID: nullableNumber(player?.playerID ?? player?.playerId ?? player?.id),
    name: firstText(player?.name, player?.playerName, "Unknown"),
    teamID: nullableNumber(player?.teamID ?? player?.teamId),
    squadID: nullableNumber(player?.squadID ?? player?.squadId),
    isLeader: Boolean(player?.isLeader ?? player?.leader),
    role: firstText(player?.role, player?.roleName, ""),
    steamID: firstText(player?.steamID, player?.steamId, player?.steam64ID, player?.steam64, ""),
    eosID: firstText(player?.eosID, player?.eosId, player?.EOSID, ""),
    controllerID: firstText(player?.controllerID, player?.controllerId, ""),
    online: player?.online !== false,
    gameSeconds: normalizeNumber(player?.gameSeconds),
    gameHours: normalizeNumber(player?.gameHours),
    combatStats: cloneJsonSafe(player?.combatStats ?? emptyCombatStats()),
    raw: cloneJsonSafe(player ?? {}),
  }));
}

function normalizeSquads(squads) {
  return squads.map((squad) => ({
    key: firstText(squad?.key, ""),
    teamID: nullableNumber(squad?.teamID ?? squad?.teamId),
    squadID: nullableNumber(squad?.squadID ?? squad?.squadId),
    teamName: firstText(squad?.teamName, ""),
    squadName: firstText(squad?.squadName, squad?.name, ""),
    size: nullableNumber(squad?.size ?? squad?.memberCount),
    locked: Boolean(squad?.locked),
    creatorName: firstText(squad?.creatorName, ""),
    createdAt: firstText(squad?.createdAt, ""),
    raw: cloneJsonSafe(squad ?? {}),
  })).sort((left, right) =>
    compareNumbers(left.teamID, right.teamID)
    || compareNumbers(left.squadID, right.squadID)
    || String(left.squadName).localeCompare(String(right.squadName), "zh-CN"));
}

function buildTeams(players, squads) {
  const teamIds = new Set();
  for (const player of players) if (player.teamID != null) teamIds.add(player.teamID);
  for (const squad of squads) if (squad.teamID != null) teamIds.add(squad.teamID);
  if (!teamIds.size) {
    teamIds.add(1);
    teamIds.add(2);
  }

  const squadMap = new Map();
  for (const squad of squads) {
    squadMap.set(buildSquadKey(squad.teamID, squad.squadID), { ...squad, members: [] });
  }

  const teamMap = new Map([...teamIds].sort(compareNumbers).map((teamID) => [
    teamID,
    {
      teamID,
      teamName: firstText(squads.find((squad) => squad.teamID === teamID)?.teamName, `Team ${teamID}`),
      squads: squads
        .filter((squad) => squad.teamID === teamID)
        .map((squad) => squadMap.get(buildSquadKey(squad.teamID, squad.squadID))),
      unassignedPlayers: [],
      playerCount: 0,
    },
  ]));

  for (const player of players) {
    const teamID = player.teamID ?? 0;
    if (!teamMap.has(teamID)) {
      teamMap.set(teamID, {
        teamID,
        teamName: `Team ${teamID}`,
        squads: [],
        unassignedPlayers: [],
        playerCount: 0,
      });
    }
    const team = teamMap.get(teamID);
    const squad = player.squadID != null ? squadMap.get(buildSquadKey(teamID, player.squadID)) : null;
    if (squad) squad.members.push(player);
    else team.unassignedPlayers.push(player);
    team.playerCount += 1;
  }

  return [...teamMap.values()]
    .map((team) => ({
      ...team,
      squads: team.squads.filter(Boolean).map((squad) => ({
        ...squad,
        members: squad.members.sort((left, right) =>
          Number(right.isLeader) - Number(left.isLeader)
          || String(left.name).localeCompare(String(right.name), "zh-CN")),
      })),
      unassignedPlayers: team.unassignedPlayers.sort((left, right) => String(left.name).localeCompare(String(right.name), "zh-CN")),
    }))
    .sort((left, right) => compareNumbers(left.teamID, right.teamID));
}

function generatePlayerCsv(snapshot, options = {}) {
  const columns = getExportColumns(options);
  const rows = [columns.map((column) => column.header)];

  forEachPlayerRow(snapshot, ({ team, squad, player }) => {
    const row = {
      capturedAt: snapshot.capturedAt,
      teamID: team.teamID,
      teamName: team.teamName,
      squadID: squad?.squadID ?? "",
      squadName: buildSquadDisplayName(squad, player),
      playerID: player.playerID ?? "",
      name: buildPlayerDisplayName(player),
      role: resolveRoleMeta(player.role).label,
      steamID: player.steamID,
      kwd: buildKwdText(player),
      tk: String(player?.combatStats?.tk ?? 0),
      duration: formatDurationShort(player?.gameSeconds),
      controllerID: player.controllerID,
      online: player.online ? "true" : "false",
    };
    rows.push(columns.map((column) => csvEscape(row[column.key] ?? "")));
  });

  return rows.map((row) => row.join(",")).join("\n");
}

function generateMarkdownReport(snapshot, options = {}) {
  const includeSteamID = Boolean(options.includeSteamID);
  const lines = [];
  lines.push("# 对局状态玩家列表快照", "");
  lines.push(`- 录制时间: ${formatDateTimeLocal(snapshot.capturedAt)}`);
  lines.push(`- 地图: ${snapshot.match.map || "-"}`);
  lines.push(`- 图层: ${snapshot.match.layer || "-"}`);
  lines.push(`- 模式: ${snapshot.match.mode || "-"}`);
  lines.push(`- 战绩: 玩家 ${snapshot.summary.playerCount} / 小队 ${snapshot.summary.squadCount} / SL ${snapshot.summary.leaderCount} / 未分队 ${snapshot.summary.unassignedCount}`);
  lines.push(`- 触发: ${snapshot.trigger.eventName}${snapshot.trigger.winner ? ` / ${snapshot.trigger.winner}` : ""}`, "");

  for (const team of snapshot.teams) {
    lines.push(`## ${team.teamName} (${team.playerCount})`, "");
    for (const squad of team.squads) {
      lines.push(`### ${buildSquadDisplayName(squad) || "未命名小队"} (${squad.members.length})`);
      appendMarkdownPlayers(lines, squad.members, { includeSteamID });
    }
    if (team.unassignedPlayers.length) {
      lines.push("### 未进小队");
      appendMarkdownPlayers(lines, team.unassignedPlayers, { includeSteamID });
    }
  }

  lines.push("---", "Generated by BZSS Match Snapshot Plugin");
  return lines.join("\n");
}

function appendMarkdownPlayers(lines, players, options = {}) {
  const headers = ["名称", "角色", "KWD", "TK", "时长"];
  if (options.includeSteamID) headers.push("SteamID");
  lines.push(`| ${headers.join(" | ")} |`);
  const alignments = [":---", ":---:", ":---:", ":---:", ":---:"];
  if (options.includeSteamID) alignments.push(":---:");
  lines.push(`| ${alignments.join(" | ")} |`);
  for (const player of players) {
    const role = resolveRoleMeta(player.role);
    const cells = [
      mdEscape(buildPlayerDisplayName(player)),
      mdEscape(role.label),
      mdEscape(buildKwdText(player)),
      mdEscape(String(player?.combatStats?.tk ?? 0)),
      mdEscape(formatDurationShort(player?.gameSeconds)),
    ];
    if (options.includeSteamID) cells.push(mdEscape(player.steamID));
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
}

async function generatePlayerListPng(snapshot, options = {}) {
  const layout = await buildPlayerListPngLayout(snapshot, options);
  const svg = renderPlayerListSvg(layout);
  const sharp = await loadSharp();
  return sharp(Buffer.from(svg, "utf8"), { density: 144 }).png().toBuffer();
}

async function buildPlayerListPngLayout(snapshot, options = {}) {
  const width = 1400;
  const panelTop = 176;
  const panelGap = 24;
  const panelWidth = Math.floor((width - 48 - panelGap) / 2);
  const sortedTeams = [...snapshot.teams].sort((left, right) => compareNumbers(left.teamID, right.teamID));
  const team1 = sortedTeams.find((team) => Number(team.teamID) === 1) ?? sortedTeams[0] ?? emptyTeam(1);
  const team2 = sortedTeams.find((team) => Number(team.teamID) === 2) ?? sortedTeams[1] ?? emptyTeam(2);
  const iconCache = await loadRoleIconCache();

  const leftPanel = buildPlayerPanelLayout(team1, options, 24, panelTop, panelWidth, iconCache);
  const rightPanel = buildPlayerPanelLayout(team2, options, 24 + panelWidth + panelGap, panelTop, panelWidth, iconCache);
  const height = panelTop + Math.max(leftPanel.height, rightPanel.height) + 24;

  return {
    width,
    height,
    title: snapshot.match.map || "Unknown Map",
    subtitle: `${snapshot.match.layer || "-"} / ${snapshot.match.mode || "-"}`,
    infoLine: `${formatDateTimeLocal(snapshot.capturedAt)} | ${snapshot.server.serverName || snapshot.server.serverId || "server"}`,
    summary: {
      playerCount: snapshot.summary.playerCount,
      squadCount: snapshot.summary.squadCount,
      leaderCount: snapshot.summary.leaderCount,
      unassignedCount: snapshot.summary.unassignedCount,
      matchDuration: formatDurationLong(snapshot.match.playtime),
    },
    renderOptions: {
      includeSteamID: Boolean(options.includeSteamID ?? snapshot.renderOptions?.includeSteamID ?? true),
    },
    panels: [leftPanel, rightPanel],
  };
}

function emptyTeam(teamID) {
  return {
    teamID,
    teamName: `Team ${teamID}`,
    squads: [],
    unassignedPlayers: [],
    playerCount: 0,
  };
}

function buildPlayerPanelLayout(team, options, x, y, width, iconCache) {
  const rows = [];
  const leaderCount = team.squads.reduce((sum, squad) => sum + squad.members.filter((player) => player.isLeader).length, 0)
    + team.unassignedPlayers.filter((player) => player.isLeader).length;

  for (const squad of team.squads) {
    rows.push({
      type: "squad",
      label: buildSquadDisplayName(squad) || "未命名小队",
      count: squad.members.length,
      height: 34,
    });
    for (const player of squad.members) rows.push(buildPlayerRow(player, options, iconCache));
  }

  if (team.unassignedPlayers.length) {
    rows.push({
      type: "squad",
      label: "未进小队",
      count: team.unassignedPlayers.length,
      height: 34,
    });
    for (const player of team.unassignedPlayers) rows.push(buildPlayerRow(player, options, iconCache));
  }

  const headerHeight = 114;
  const rowsHeight = rows.reduce((sum, row) => sum + row.height, 0);
  return {
    teamID: team.teamID,
    teamName: team.teamName || `Team ${team.teamID}`,
    statsLine: `玩家 ${team.playerCount} · 小队 ${team.squads.length} · SL ${leaderCount} · 未分队 ${team.unassignedPlayers.length}`,
    x,
    y,
    width,
    height: headerHeight + rowsHeight + 18,
    headerHeight,
    columns: buildPngColumns(options, width),
    rows,
  };
}

function buildPlayerRow(player, options, iconCache) {
  const role = resolveRoleMeta(player.role);
  return {
    type: "player",
    height: 42,
    name: String(player?.name ?? "Unknown").trim() || "Unknown",
    steamID: Boolean(options.includeSteamID) ? player.steamID : "",
    kwd: buildKwdText(player),
    tk: String(player?.combatStats?.tk ?? 0),
    duration: formatDurationShort(player?.gameSeconds),
    roleLabel: role.label,
    roleIconData: iconCache.get(role.iconPath) ?? "",
    roleTone: role.tone,
    isLeader: Boolean(player.isLeader),
  };
}

function buildPngColumns(options, width) {
  const columns = [
    { key: "name", label: "名称", x: 18, width: 160 },
  ];
  if (Boolean(options.includeSteamID)) {
    columns.push(
      { key: "role", label: "角色", x: 192, width: 76 },
      { key: "steamID", label: "SteamID", x: 282, width: 146 },
      { key: "kwd", label: "KWD", x: 442, width: 94 },
      { key: "tk", label: "TK", x: 550, width: 38 },
      { key: "duration", label: "时长", x: 602, width: 46 }
    );
  } else {
    columns[0].width = 232;
    columns.push(
      { key: "role", label: "角色", x: 264, width: 76 },
      { key: "kwd", label: "KWD", x: 354, width: 110 },
      { key: "tk", label: "TK", x: 478, width: 50 },
      { key: "duration", label: "时长", x: 542, width: 106 }
    );
  }
  return columns;
}

function renderPlayerListSvg(layout) {
  const svg = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`);
  svg.push("<defs>");
  svg.push('<linearGradient id="bgGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0b0f19"/><stop offset="100%" stop-color="#111827"/></linearGradient>');
  svg.push('<linearGradient id="panelGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0f1626"/><stop offset="100%" stop-color="#090d16"/></linearGradient>');
  svg.push('<linearGradient id="teamGradient1" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0f766e"/><stop offset="100%" stop-color="#14b8a6"/></linearGradient>');
  svg.push('<linearGradient id="teamGradient2" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#1d4ed8"/><stop offset="100%" stop-color="#4f46e5"/></linearGradient>');
  svg.push("<style><![CDATA[");
  svg.push("text{font-family:'system-ui',-apple-system,'Segoe UI',Roboto,'Microsoft YaHei',sans-serif;fill:#f8fafc}.mono{font-family:'Consolas','Cascadia Mono',monospace}.title{font-size:30px;font-weight:800;fill:#f8fafc}.subtitle{font-size:15px;fill:#cbd5e1}.meta{font-size:12px;fill:#94a3b8}.metric-label{font-size:12px;font-weight:600;fill:#64748b;letter-spacing:1px}.metric-value{font-size:24px;font-weight:800;fill:#f8fafc}.team-title{font-size:20px;font-weight:800;fill:#f8fafc}.team-stat{font-size:13px;fill:#cbd5e1}.header{font-size:12px;font-weight:800;fill:#94a3b8;letter-spacing:0.5px}.squad{font-size:13px;font-weight:800;fill:#f1f5f9}.row{font-size:14px;fill:#f8fafc}.row-bold{font-size:14px;font-weight:700;fill:#f8fafc}.small{font-size:12px;fill:#94a3b8}.badge{font-size:11px;font-weight:800;fill:#0f172a}");
  svg.push("]]></style>");
  svg.push("</defs>");
  svg.push('<rect x="0" y="0" width="100%" height="100%" fill="url(#bgGradient)"/>');

  // Header Card
  svg.push('<rect x="24" y="20" width="1352" height="136" rx="16" fill="#0c1222" stroke="#1e293b" stroke-width="1.5"/>');
  svg.push(`<text x="48" y="62" class="title">${xmlEscape(layout.title)}</text>`);
  svg.push(`<text x="48" y="90" class="subtitle">${xmlEscape(layout.subtitle)}</text>`);
  svg.push(`<text x="48" y="116" class="meta">${xmlEscape(layout.infoLine)}</text>`);
  svg.push(renderSummaryMetric(648, 34, "玩家", layout.summary.playerCount, "#38bdf8"));
  svg.push(renderSummaryMetric(792, 34, "小队", layout.summary.squadCount, "#a78bfa"));
  svg.push(renderSummaryMetric(936, 34, "SL", layout.summary.leaderCount, "#f59e0b"));
  svg.push(renderSummaryMetric(1080, 34, "未分队", layout.summary.unassignedCount, "#ef4444"));
  svg.push(renderSummaryMetric(1224, 34, "对局时长", layout.summary.matchDuration || "-", "#22c55e"));

  for (const panel of layout.panels) {
    const gradientId = Number(panel.teamID) === 1 ? "teamGradient1" : (Number(panel.teamID) === 2 ? "teamGradient2" : "panelGradient");
    
    // Panel background
    svg.push(`<rect x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}" rx="18" fill="url(#panelGradient)" stroke="#1e293b" stroke-width="1.5"/>`);
    
    // Panel Header with only top corners rounded
    const r = 18;
    const headerH = 60;
    const pathData = `M ${panel.x + r} ${panel.y} ` +
      `L ${panel.x + panel.width - r} ${panel.y} ` +
      `Q ${panel.x + panel.width} ${panel.y} ${panel.x + panel.width} ${panel.y + r} ` +
      `L ${panel.x + panel.width} ${panel.y + headerH} ` +
      `L ${panel.x} ${panel.y + headerH} ` +
      `L ${panel.x} ${panel.y + r} ` +
      `Q ${panel.x} ${panel.y} ${panel.x + r} ${panel.y} Z`;
    svg.push(`<path d="${pathData}" fill="url(#${gradientId})"/>`);
    
    svg.push(`<text x="${panel.x + 20}" y="${panel.y + 36}" class="team-title">${xmlEscape(panel.teamName)}</text>`);
    svg.push(`<text x="${panel.x + panel.width - 20}" y="${panel.y + 36}" text-anchor="end" class="team-stat">${xmlEscape(panel.statsLine)}</text>`);
    
    // Column Header Row
    svg.push(`<rect x="${panel.x + 12}" y="${panel.y + 70}" width="${panel.width - 24}" height="32" rx="6" fill="#131e35" stroke="#223154" stroke-opacity="0.6"/>`);
    for (const column of panel.columns) {
      svg.push(`<text x="${panel.x + column.x}" y="${panel.y + 90}" class="header">${xmlEscape(column.label)}</text>`);
    }

    let rowY = panel.y + panel.headerHeight;
    let rowIndex = 0;
    for (const row of panel.rows) {
      if (row.type === "squad") {
        const leftBorderColor = Number(panel.teamID) === 1 ? "#0d9488" : "#3b82f6";
        svg.push(`<rect x="${panel.x + 12}" y="${rowY}" width="${panel.width - 24}" height="${row.height - 4}" rx="6" fill="#17223b" stroke="#223154"/>`);
        // Accent vertical bar
        svg.push(`<rect x="${panel.x + 12}" y="${rowY}" width="4" height="${row.height - 4}" rx="2" fill="${leftBorderColor}"/>`);
        svg.push(`<text x="${panel.x + 26}" y="${rowY + 20}" class="squad">${xmlEscape(row.label)}</text>`);
        svg.push(`<text x="${panel.x + panel.width - 26}" y="${rowY + 20}" text-anchor="end" class="squad-count small">${xmlEscape(String(row.count) + " 玩家")}</text>`);
      } else {
        const fill = rowIndex % 2 === 0 ? "#0d1324" : "#111a30";
        svg.push(`<rect x="${panel.x + 12}" y="${rowY}" width="${panel.width - 24}" height="${row.height - 4}" rx="6" fill="${fill}" stroke="#1e293b" stroke-opacity="0.3"/>`);
        
        for (const column of panel.columns) {
          const columnX = panel.x + column.x;
          if (column.key === "name") {
            const maxLen = Boolean(layout.renderOptions?.includeSteamID) ? (row.isLeader ? 15 : 19) : (row.isLeader ? 24 : 28);
            if (row.isLeader) {
              svg.push(`<rect x="${columnX}" y="${rowY + 11}" width="26" height="16" rx="4" fill="#eab308"/>`);
              svg.push(`<text x="${columnX + 13}" y="${rowY + 23}" text-anchor="middle" class="badge">SL</text>`);
              svg.push(`<text x="${columnX + 34}" y="${rowY + 24}" class="row-bold">${xmlEscape(clipTextByWidth(row.name, maxLen))}</text>`);
            } else {
              svg.push(`<text x="${columnX}" y="${rowY + 24}" class="row">${xmlEscape(clipTextByWidth(row.name, maxLen))}</text>`);
            }
          } else if (column.key === "role") {
            if (row.roleIconData) {
              svg.push(`<image href="${row.roleIconData}" x="${columnX}" y="${rowY + 7}" width="24" height="24"/>`);
            } else {
              svg.push(`<rect x="${columnX}" y="${rowY + 9}" width="24" height="20" rx="4" fill="${row.roleTone}"/>`);
            }
            svg.push(`<text x="${columnX + 30}" y="${rowY + 24}" class="small">${xmlEscape(row.roleLabel)}</text>`);
          } else if (column.key === "steamID") {
            svg.push(`<text x="${columnX}" y="${rowY + 24}" class="row mono small">${xmlEscape(clipTextByWidth(row.steamID || "-", 18))}</text>`);
          } else if (column.key === "kwd") {
            svg.push(`<text x="${columnX}" y="${rowY + 24}" class="row mono">${xmlEscape(row.kwd)}</text>`);
          } else if (column.key === "tk") {
            const tkColor = Number(row.tk) > 0 ? "#ef4444" : "#f8fafc";
            svg.push(`<text x="${columnX}" y="${rowY + 24}" class="row mono" ${Number(row.tk) > 0 ? 'style="fill:#ef4444"' : ""}>${xmlEscape(row.tk)}</text>`);
          } else if (column.key === "duration") {
            svg.push(`<text x="${columnX}" y="${rowY + 24}" class="row mono small">${xmlEscape(row.duration)}</text>`);
          }
        }
        rowIndex += 1;
      }
      rowY += row.height;
    }
  }

  svg.push("</svg>");
  return svg.join("\n");
}

function renderSummaryMetric(x, y, label, value, color) {
  return [
    `<rect x="${x}" y="${y}" width="132" height="84" rx="12" fill="#131e35" stroke="#223154" stroke-width="1"/>`,
    `<path d="M ${x + 12} ${y} L ${x + 120} ${y}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`,
    `<text x="${x + 14}" y="${y + 28}" class="metric-label">${xmlEscape(label)}</text>`,
    `<text x="${x + 14}" y="${y + 62}" class="metric-value mono">${xmlEscape(String(value))}</text>`,
  ].join("");
}

async function loadRoleIconCache() {
  const cache = new Map();
  for (const entry of ROLE_ICON_MATCHES) {
    if (cache.has(entry.icon)) continue;
    cache.set(entry.icon, await readIconAsDataUri(entry.icon));
  }
  return cache;
}

async function readIconAsDataUri(iconPath) {
  const filePath = path.join(ICON_BASE_DIR, iconPath.replace(/^\//, "").replace(/\//g, path.sep));
  try {
    const content = await fs.readFile(filePath);
    return `data:image/png;base64,${content.toString("base64")}`;
  } catch {
    return "";
  }
}

function resolveRoleMeta(roleText) {
  const normalized = String(roleText ?? "").toLowerCase().replace(/[_-]+/g, " ");
  const compact = normalized.replace(/\s+/g, "");
  for (const entry of ROLE_ICON_MATCHES) {
    if (entry.patterns.some((pattern) => normalized.includes(pattern) || compact.includes(pattern.replace(/\s+/g, "")))) {
      return {
        iconPath: entry.icon,
        label: entry.label,
        tone: entry.tone,
      };
    }
  }
  return {
    iconPath: "",
    label: String(roleText ?? "").trim() || "Role",
    tone: "#64748b",
  };
}

function forEachPlayerRow(snapshot, callback) {
  for (const team of snapshot.teams) {
    for (const squad of team.squads) {
      for (const player of squad.members) callback({ team, squad, player });
    }
    for (const player of team.unassignedPlayers) callback({ team, squad: null, player });
  }
}

function buildSnapshotBaseName(payload) {
  const map = sanitizeBaseName(payload.match.map || payload.match.layer || "UnknownMap");
  const timestamp = payload.capturedAt.replace(/[:.]/g, "-");
  return `Match-${map}-${timestamp}`;
}

function sanitizeBaseName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._\-\u4e00-\u9fff]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 120) || "snapshot";
}

function buildSquadKey(teamID, squadID) {
  return `${String(teamID ?? "")}:${String(squadID ?? "")}`;
}

function buildSquadDisplayName(squad, player = null) {
  if (squad?.squadName) return String(squad.squadName).trim();
  if (squad?.squadID != null) return String(squad.squadID);
  if (player?.squadID != null) return String(player.squadID);
  return "";
}

function buildPlayerDisplayName(player) {
  const name = String(player?.name ?? "Unknown").trim() || "Unknown";
  return player?.isLeader ? `SL ${name}` : name;
}

function buildKwdText(player) {
  const stats = player?.combatStats ?? emptyCombatStats();
  return `${Number(stats.kills ?? 0)}/${Number(stats.wounds ?? 0)}/${Number(stats.deaths ?? 0)}`;
}

function getExportColumns(options = {}) {
  const columns = [
    { key: "capturedAt", header: "capturedAt" },
    { key: "teamID", header: "teamID" },
    { key: "teamName", header: "teamName" },
    { key: "squadID", header: "squadID" },
    { key: "squadName", header: "squadName" },
    { key: "playerID", header: "playerID" },
    { key: "name", header: "name" },
    { key: "role", header: "role" },
  ];
  if (Boolean(options.includeSteamID)) columns.push({ key: "steamID", header: "steamID" });
  columns.push(
    { key: "kwd", header: "kwd" },
    { key: "tk", header: "tk" },
    { key: "duration", header: "duration" },
    { key: "controllerID", header: "controllerID" },
    { key: "online", header: "online" },
  );
  return columns;
}

function buildIdentityKey(player) {
  const steamID = firstText(player?.steamID, player?.steamId, player?.steam64ID, player?.steam64, "").trim();
  if (steamID) return `steam:${steamID}`;
  const eosID = firstText(player?.eosID, player?.eosId, player?.EOSID, "").trim();
  if (eosID) return `eos:${eosID}`;
  return `name:${String(player?.name ?? "").trim().toLowerCase()}`;
}

function buildEventPlayerKey(player) {
  if (!player || typeof player !== "object") return "";
  const steamID = firstText(player?.steamID, player?.steamId, player?.steam64ID, player?.steam64, "").trim();
  if (steamID) return `steam:${steamID}`;
  const eosID = firstText(player?.eosID, player?.eosId, player?.EOSID, "").trim();
  if (eosID) return `eos:${eosID}`;
  return `name:${String(player?.name ?? "").trim().toLowerCase()}`;
}

function normalizeSnapshotOptions(input = {}) {
  return {
    includeSteamID: parseBoolean(input.includeSteamID ?? input.options?.includeSteamID, true),
    includeEOSID: parseBoolean(input.includeEOSID ?? input.options?.includeEOSID, false),
  };
}

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off", "n"].includes(text)) return false;
  if (["true", "1", "yes", "on", "y"].includes(text)) return true;
  return defaultValue;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = stringifyValue(value).trim();
    if (text) return text;
  }
  return "";
}

function stringifyValue(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function compareNumbers(left, right) {
  const a = Number(left);
  const b = Number(right);
  const aValid = Number.isFinite(a);
  const bValid = Number.isFinite(b);
  if (aValid && bValid) return a - b;
  if (aValid) return -1;
  if (bValid) return 1;
  return 0;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function mdEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDateTimeLocal(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString || "-";

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function clipTextByWidth(text, maxVisualWidth) {
  const value = String(text ?? "");
  let visualWidth = 0;
  let result = "";

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const code = char.charCodeAt(0);
    // Double-width character detection (CJK Unified Ideographs, full-width forms, etc.)
    const charWidth = (code >= 0x3000 && code <= 0x9FFF) || (code >= 0xFF00 && code <= 0xFFEF) ? 2 : 1;

    if (visualWidth + charWidth > maxVisualWidth) {
      return `${result}…`;
    }
    result += char;
    visualWidth += charWidth;
  }
  return result;
}

function cloneJsonSafe(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function formatDurationShort(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0) || 0));
  if (!total) return "0m";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDurationLong(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0) || 0));
  if (!total) return "0m";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

let sharpLoaderPromise = null;

async function loadSharp() {
  if (!sharpLoaderPromise) {
    const bundlePnpmNodeModules = `${SHARP_BUNDLE_ROOT}/.pnpm/node_modules`;
    process.env.NODE_PATH = [SHARP_BUNDLE_ROOT, bundlePnpmNodeModules, process.env.NODE_PATH || ""]
      .filter(Boolean)
      .join(";");
    sharpRequire("module")._initPaths();
    sharpLoaderPromise = Promise.resolve().then(() => sharpRequire("sharp"));
  }
  return sharpLoaderPromise;
}
