import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
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
  { patterns: ["squadleader", "sl", "leader"], icon: "/assets/icons/T_role_squadleader.PNG", label: "SL", tone: "#f59e0b" },
  { patterns: ["medic"], icon: "/assets/icons/T_role_medic.PNG", label: "Medic", tone: "#22c55e" },
  { patterns: ["heavyantitank", "heavy anti tank", "heavy anti-tank", "hat"], icon: "/assets/icons/T_role_heavyantitank.PNG", label: "HAT", tone: "#ef4444" },
  { patterns: ["lightantitank", "light anti tank", "light anti-tank", "antitank", "anti tank", "lat"], icon: "/assets/icons/T_role_lightantitank.PNG", label: "LAT", tone: "#f97316" },
  { patterns: ["machinegunner", "machine gunner", "mg"], icon: "/assets/icons/T_role_machinegunner.PNG", label: "MG", tone: "#8b5cf6" },
  { patterns: ["automaticrifleman", "automatic rifleman", "ar"], icon: "/assets/icons/T_role_automaticrifleman.PNG", label: "AR", tone: "#8b5cf6" },
  { patterns: ["combatengineer", "combat engineer", "engineer"], icon: "/assets/icons/T_role_engineer.PNG", label: "ENG", tone: "#eab308" },
  { patterns: ["designatedmarksman", "designated marksman", "marksman"], icon: "/assets/icons/T_role_designatedmarksman.PNG", label: "DMR", tone: "#06b6d4" },
  { patterns: ["sniper"], icon: "/assets/icons/T_role_sniper.PNG", label: "Sniper", tone: "#06b6d4" },
  { patterns: ["scout"], icon: "/assets/icons/T_role_scout.PNG", label: "Scout", tone: "#38bdf8" },
  { patterns: ["grenadier"], icon: "/assets/icons/T_role_grenadier.PNG", label: "Gren", tone: "#38bdf8" },
  { patterns: ["crewman", "crew"], icon: "/assets/icons/T_role_crewman.PNG", label: "Crew", tone: "#94a3b8" },
  { patterns: ["pilot"], icon: "/assets/icons/T_role_pilot.PNG", label: "Pilot", tone: "#38bdf8" },
  { patterns: ["rifleman scoped", "riflemanscoped"], icon: "/assets/icons/T_role_rifleman_scoped.PNG", label: "Rifle", tone: "#38bdf8" },
  { patterns: ["rifleman"], icon: "/assets/icons/T_role_rifleman.PNG", label: "Rifle", tone: "#38bdf8" },
];

const MAP_SCENE_THEMES = {
  desert: { hud: "#d8c08a", hud2: "#8f6f3a", line: "#f2dfad", alert: "#f2b84b", team1: "#2dd4bf", team2: "#f59e0b" },
  forest: { hud: "#a7d7a5", hud2: "#42683d", line: "#d5f5cf", alert: "#facc15", team1: "#22c55e", team2: "#38bdf8" },
  snow: { hud: "#d7efff", hud2: "#6aa5c8", line: "#eff9ff", alert: "#f97316", team1: "#67e8f9", team2: "#60a5fa" },
  urban: { hud: "#d2d7df", hud2: "#65717f", line: "#eef2f7", alert: "#ef4444", team1: "#14b8a6", team2: "#a78bfa" },
  coast: { hud: "#b5e6ea", hud2: "#287682", line: "#defcff", alert: "#facc15", team1: "#06b6d4", team2: "#818cf8" },
};

const MAP_SCENE_STYLE_BY_KEY = {
  AlBasrah: "desert",
  Fallujah: "desert",
  Kohat: "desert",
  Kokan: "desert",
  Lashkar: "desert",
  Mutaha: "desert",
  Sumari: "desert",
  Tallil: "desert",
  Belaya_Pass: "snow",
  GooseBay: "snow",
  Manicouagan: "snow",
  Mestia: "snow",
  BlackCoast: "coast",
  Harju: "coast",
  PacificProvingGrounds: "coast",
  Sanxian: "coast",
  Skorpo: "coast",
  Chora: "forest",
  FoolsRoad: "forest",
  Gorodok: "forest",
  Kamdesh: "forest",
  Yehorivka: "forest",
  Anvil: "urban",
  JensensRange: "urban",
  Narva: "urban",
};

const MAP_SCENE_MINIMAP_PLACEMENT = {
  AlBasrah: { x: 1110, y: 226, size: 300 },
  Anvil: { x: 1056, y: 210, size: 304 },
  Belaya_Pass: { x: 1096, y: 218, size: 304 },
  BlackCoast: { x: 1048, y: 212, size: 310 },
  Chora: { x: 1114, y: 214, size: 300 },
  Fallujah: { x: 1100, y: 222, size: 304 },
  FoolsRoad: { x: 1088, y: 214, size: 304 },
  GooseBay: { x: 1086, y: 218, size: 304 },
  Gorodok: { x: 1104, y: 216, size: 300 },
  Harju: { x: 1084, y: 208, size: 306 },
  Kamdesh: { x: 1072, y: 220, size: 304 },
  Kohat: { x: 1098, y: 224, size: 300 },
  Kokan: { x: 1102, y: 224, size: 300 },
  Lashkar: { x: 1096, y: 220, size: 304 },
  Manicouagan: { x: 1076, y: 214, size: 306 },
  Mestia: { x: 1088, y: 218, size: 304 },
  Mutaha: { x: 1104, y: 220, size: 302 },
  Narva: { x: 1110, y: 210, size: 302 },
  PacificProvingGrounds: { x: 1060, y: 212, size: 306 },
  Sanxian: { x: 1090, y: 212, size: 304 },
  Skorpo: { x: 1068, y: 210, size: 306 },
  Sumari: { x: 1114, y: 224, size: 300 },
  Tallil: { x: 1084, y: 214, size: 306 },
  Yehorivka: { x: 1092, y: 216, size: 304 },
};

const TACTICAL_MINIMAP_BY_KEY = {
  Anvil_RAAS_v1: "Anvil_Minimap.PNG",
  Belaya_RAAS_v1: "Belaya_Minimap.PNG",
  Chora_RAAS_v1: "Chora_Minimap.PNG",
  Fallujah_RAAS_v1: "T_Fallujah_Minimap.PNG",
  FoolsRoad_RAAS_v1: "Fools_Road_Minimap.PNG",
  GooseBay_RAAS_v1: "GooseBay_Minimap.PNG",
  Gorodok_RAAS_v1: "gorodok_minimap.PNG",
  Kamdesh_RAAS_v1: "Kamdesh_Minimap.PNG",
  Kohat_RAAS_v1: "kohat_minimap.PNG",
  Kokan_RAAS_v1: "T_Kokan_Minimap.PNG",
  Lashkar_RAAS_v1: "T_Lashkar_Minimap.PNG",
  Logar_RAAS_v1: "Logar_Valley_Minimap.PNG",
  Manicouagan_RAAS_v1: "T_Manicouagan_Minimap.PNG",
  Mestia_RAAS_v1: "T_Mestia_Minimap.PNG",
  Mutaha_RAAS_v1: "Mutaha_Minimap.PNG",
  Narva_RAAS_v1: "Narva_Minimap.PNG",
  Skorpo_RAAS_v1: "Skorpo_Minimap.PNG",
  Sumari_RAAS_v1: "Sumari_Minimap.PNG",
  Tallil_RAAS_v1: "Tallil_Outskirts_Minimap.PNG",
  Yehorivka_RAAS_v1: "Yehorivka_Minimap.PNG",
};

const FACTION_GLOW_BY_CODE = {
  ADF: ["#012169", "#e4002b"],
  AFU: ["#0057b7", "#ffd700"],
  BAF: ["#012169", "#c8102e"],
  CAF: ["#ff0000", "#ffffff"],
  CRF: ["#1f2937", "#f97316"],
  GFI: ["#0f766e", "#fde047"],
  IMF: ["#166534", "#dc2626"],
  MEA: ["#b45309", "#111827"],
  MEI: ["#166534", "#eab308"],
  PLA: ["#de2910", "#ffde00"],
  PLAAGF: ["#de2910", "#ffde00"],
  PLANMC: ["#de2910", "#2563eb"],
  RGF: ["#ffffff", "#0039a6", "#d52b1e"],
  TLF: ["#e30a17", "#ffffff"],
  USA: ["#3c3b6e", "#b22234"],
  USMC: ["#b31942", "#facc15"],
  VDV: ["#2563eb", "#22d3ee"],
  WPMC: ["#111827", "#facc15"],
};

const MAP_SCENE_TEMPLATE_ENTRIES = [
  ["AlBasrah", "LoadingScreen_AlBasrah_DQHD.PNG"],
  ["Anvil", "LoadingScreen_Anvil_DQHD.PNG"],
  ["Belaya_Pass", "LoadingScreen_Belaya_Pass_DQHD.PNG"],
  ["BlackCoast", "LoadingScreen_BlackCoast_DQHD.PNG"],
  ["Chora", "LoadingScreen_Chora_DQHD.PNG"],
  ["Fallujah", "LoadingScreen_Fallujah_DQHD.PNG"],
  ["FoolsRoad", "LoadingScreen_FoolsRoad_DQHD.PNG"],
  ["GooseBay", "LoadingScreen_GooseBay_DQHD.PNG"],
  ["Gorodok", "LoadingScreen_Gorodok_DQHD.PNG"],
  ["Harju", "LoadingScreen_Harju_DQHD.PNG"],
  ["JensensRange", "LoadingScreen_JensensRange_DQHD.PNG"],
  ["Kamdesh", "LoadingScreen_Kamdesh_DQHD.PNG"],
  ["Kohat", "LoadingScreen_Kohat_DQHD.PNG"],
  ["Kokan", "LoadingScreen_Kokan_DQHD.PNG"],
  ["Lashkar", "LoadingScreen_Lashkar_DQHD.PNG"],
  ["Manicouagan", "LoadingScreen_Manicouagan_DQHD.PNG"],
  ["Mestia", "LoadingScreen_Mestia_DQHD.PNG"],
  ["Mutaha", "LoadingScreen_Mutaha_DQHD.PNG"],
  ["Narva", "LoadingScreen_Narva_DQHD.PNG"],
  ["PacificProvingGrounds", "LoadingScreen_PacificProvingGrounds_DQHD.PNG"],
  ["Sanxian", "LoadingScreen_Sanxian_DQHD.PNG"],
  ["Skorpo", "LoadingScreen_Skorpo_DQHD.PNG"],
  ["Sumari", "LoadingScreen_Sumari_DQHD.PNG"],
  ["Tallil", "LoadingScreen_Tallil_DQHD.PNG"],
  ["Yehorivka", "LoadingScreen_Yehorivka_DQHD.PNG"],
];

const MAP_SCENE_TEMPLATE_LIST = MAP_SCENE_TEMPLATE_ENTRIES.map(([key, fileName], index) => createMapSceneTemplate(key, fileName, index));
const MINIMAP_PLACEMENT_CACHE = new Map();

const MAP_SCENE_TEMPLATE_BY_KEY = Object.fromEntries(
  MAP_SCENE_TEMPLATE_LIST.map((template) => [template.key, template]),
);

const FACTION_FLAG_BY_CODE = {
  ADF: "ADF.PNG",
  AFU: "AFU.PNG",
  BAF: "BAF.PNG",
  CAF: "CAF.PNG",
  CRF: "CRF.PNG",
  GFI: "GFI.PNG",
  IMF: "IMF.PNG",
  MEA: "MEA.PNG",
  MEI: "MEI.PNG",
  PLA: "PLA.PNG",
  PLAAGF: "PLAAGF.PNG",
  PLANMC: "PLANMC.png",
  RGF: "RGF.PNG",
  TLF: "TLF.PNG",
  USA: "USA.PNG",
  USMC: "USMC.PNG",
  VDV: "VDV.png",
  WPMC: "WPMC.PNG",
};

const FACTION_ASSET_DATA_PATH = path.resolve(process.cwd(), "web-client", "src", "shared", "faction-assets", "faction-data.ts");

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

    const overview = inputOptions?.overview && typeof inputOptions.overview === "object"
      ? inputOptions.overview
      : getCurrentOverview();
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
      description: "Capture match-state player snapshots as PNG, JSON, CSV, and Markdown files.",
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
          description: "View and manage recorded match-state player snapshot records.",
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
  const serverId = stringifyValue(matchState.serverId ?? overview?.serverId ?? status.serverId ?? "");
  const enrichedTeams = teams.map((team) => {
    const factionCode = resolveFactionCodeFromTeamName(team.teamName);
    const commanderPlayer = resolveTeamCommander({ team, players, squads, modules, serverId });
    return {
      ...team,
      factionCode,
      flagAssetPath: resolveFactionFlagAssetPath(team.teamName) ?? "",
      commanderName: commanderPlayer?.name ?? "",
      commanderPlayer: commanderPlayer ? cloneJsonSafe(commanderPlayer) : null,
    };
  });

  return {
    schemaVersion: 5,
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
      queueCount: firstFiniteNumber(status.queueCount, serverStatus.queueCount, matchState.serverStatus?.queueCount) ?? 0,
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
      rconTime: firstFiniteNumber(status.playtime, serverStatus.playtime, match.playtime, status.matchTimeSeconds, serverStatus.matchTimeSeconds),
    },
    summary: {
      playerCount: players.length,
      squadCount: squads.length,
      teamCount: teams.length,
      leaderCount: players.filter((player) => player.isLeader).length,
      unassignedCount: teams.reduce((sum, team) => sum + team.unassignedPlayers.length, 0),
    },
    teams: enrichedTeams,
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
      steamAvatar: firstText(
        player?.steamAvatar,
        player?.steam_avatar,
        player?.avatar,
        player?.steamPlaytime?.steamAvatar,
        player?.steamPlaytime?.steam_avatar,
      ),
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
    isCommander: Boolean(player?.isCommander ?? player?.commander),
    role: firstText(player?.role, player?.roleName, ""),
    steamID: firstText(player?.steamID, player?.steamId, player?.steam64ID, player?.steam64, ""),
    eosID: firstText(player?.eosID, player?.eosId, player?.EOSID, ""),
    controllerID: firstText(player?.controllerID, player?.controllerId, ""),
    online: player?.online !== false,
    gameSeconds: normalizeNumber(player?.gameSeconds),
    gameHours: normalizeNumber(player?.gameHours),
    steamAvatar: firstText(
      player?.steamAvatar,
      player?.steam_avatar,
      player?.avatar,
      player?.steamPlaytime?.steamAvatar,
      player?.steamPlaytime?.steam_avatar,
    ),
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
      teamName: resolveTeamDisplayNameFromSquads(squads, teamID),
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

function resolveTeamDisplayNameFromSquads(squads, teamID) {
  const teamSquads = (Array.isArray(squads) ? squads : []).filter((squad) => Number(squad?.teamID) === Number(teamID));
  const direct = firstText(
    teamSquads.find((squad) => firstText(squad?.teamName, ""))?.teamName,
    ...teamSquads.map((squad) => firstText(
      squad?.raw?.teamName,
      squad?.raw?.team,
      squad?.raw?.faction,
      squad?.raw?.factionName,
      squad?.raw?.battlegroup,
      squad?.raw?.battleGroup,
    )),
  );
  if (direct) return direct;

  const squadNameFaction = teamSquads
    .map((squad) => firstText(squad?.squadName, squad?.raw?.squadName, squad?.raw?.name, ""))
    .find((name) => resolveFactionCodeFromTeamName(name));
  return squadNameFaction || `Team ${teamID}`;
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
  lines.push("# 对局状态玩家列表快照");
  lines.push('');
  lines.push('- Captured: ' + formatDateTimeLocal(snapshot.capturedAt));
  lines.push('- Map: ' + (snapshot.match.map || '-'));
  lines.push('- Layer: ' + (snapshot.match.layer || '-'));
  lines.push('- Mode: ' + (snapshot.match.mode || '-'));
  lines.push('- Summary: players ' + snapshot.summary.playerCount + ' / squads ' + snapshot.summary.squadCount + ' / SL ' + snapshot.summary.leaderCount + ' / unassigned ' + snapshot.summary.unassignedCount);
  lines.push('- Trigger: ' + (snapshot.trigger?.eventName || '-') + (snapshot.trigger?.winner ? ' / ' + snapshot.trigger.winner : ''));
  lines.push('');

  for (const team of snapshot.teams) {
    lines.push('## ' + team.teamName + ' (' + team.playerCount + ')');
    lines.push('');
    for (const squad of team.squads) {
      lines.push('### ' + (buildSquadDisplayName(squad) || 'Unnamed Squad') + ' (' + squad.members.length + ')');
      appendMarkdownPlayers(lines, squad.members, { includeSteamID });
    }
    if (team.unassignedPlayers.length) {
      lines.push('### Unassigned');
      appendMarkdownPlayers(lines, team.unassignedPlayers, { includeSteamID });
    }
  }

  return lines.join('\n');
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
  const sharp = await loadSharp();
  return renderMatchScenePng(sharp, snapshot, options);
}

async function renderMatchScenePng(sharp, snapshot, options = {}) {
  const layout = await buildMatchSceneLayout(snapshot, options);
  const bg = await buildMatchSceneBackground(sharp, layout);
  const minimapLayer = await buildMinimapLayer(sharp, layout);
  const overlay = Buffer.from(renderMatchSceneSvg(layout), "utf8");
  const composites = [];
  if (minimapLayer) composites.push(minimapLayer);
  composites.push({ input: overlay });
  return sharp(bg)
    .composite(composites)
    .png()
    .toBuffer();
}

async function buildMinimapLayer(sharp, layout) {
  const minimap = layout.minimap;
  if (!minimap?.assetPath) return null;

  try {
    const size = Number(minimap.size ?? 300) || 300;
    const placement = await resolveMinimapPlacement(sharp, layout, size);
    const theme = layout.template?.theme ?? MAP_SCENE_THEMES.forest;
    const map = await sharp(minimap.assetPath)
      .resize(size, size, { fit: "cover", position: "centre" })
      .modulate({ brightness: 0.78, saturation: 0.76 })
      .png()
      .toBuffer();
    const frame = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><filter id="soft"><feGaussianBlur stdDeviation="9"/></filter><linearGradient id="scan" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${theme.line}" stop-opacity="0.12"/><stop offset="100%" stop-color="#020617" stop-opacity="0.08"/></linearGradient></defs><rect x="8" y="8" width="${size - 16}" height="${size - 16}" fill="${theme.hud}" opacity="0.16" filter="url(#soft)"/><path d="M 0 22 L 22 0 H ${size} V ${size - 22} L ${size - 22} ${size} H 0 Z" fill="rgba(2,6,23,0.08)" stroke="${theme.line}" stroke-opacity="0.58" stroke-width="2"/><path d="M 12 12 H 88 M ${size - 88} 12 H ${size - 12} M 12 ${size - 12} H 88 M ${size - 88} ${size - 12} H ${size - 12}" stroke="${theme.alert}" stroke-width="2.5"/><path d="M 20 46 H ${size - 20} M 20 92 H ${size - 20} M 20 138 H ${size - 20} M 20 184 H ${size - 20} M 20 230 H ${size - 20}" stroke="url(#scan)" stroke-width="1"/><text x="22" y="${size - 22}" font-family="Cascadia Mono,Consolas,monospace" font-size="13" font-weight="800" fill="${theme.line}" opacity="0.88">TACTICAL GRID</text></svg>`,
      "utf8",
    );
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><path d="M 0 22 L 22 0 H ${size} V ${size - 22} L ${size - 22} ${size} H 0 Z" fill="white"/></svg>`,
      "utf8",
    );
    const layer = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: map, left: 0, top: 0 },
        { input: mask, blend: "dest-in" },
        { input: frame, left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
    return {
      input: layer,
      left: placement.x,
      top: placement.y,
    };
  } catch {
    return null;
  }
}

async function resolveMinimapPlacement(sharp, layout, size) {
  const fallback = layout.minimap ?? MAP_SCENE_MINIMAP_PLACEMENT.Sumari;
  const mapImage = getMapSceneAssetPath(layout);
  if (!mapImage) {
    return {
      x: Number(fallback.x ?? 0) || 0,
      y: Number(fallback.y ?? 0) || 0,
    };
  }

  const cacheKey = `${layout.template?.key ?? "unknown"}:${mapImage}:${size}`;
  const cached = MINIMAP_PLACEMENT_CACHE.get(cacheKey);
  if (cached) return cached;

  try {
    const thumbWidth = 160;
    const thumbHeight = 90;
    const { data, info } = await sharp(mapImage)
      .resize(thumbWidth, thumbHeight, { fit: "cover", position: "centre" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const candidates = buildMinimapPlacementCandidates(layout.width, layout.height, size);
    let best = null;
    for (const candidate of candidates) {
      const score = scoreMinimapPlacementCandidate(data, info, candidate, layout.width, layout.height);
      if (!best || score < best.score) best = { ...candidate, score };
    }
    const placement = best
      ? { x: best.x, y: best.y }
      : { x: Number(fallback.x ?? 0) || 0, y: Number(fallback.y ?? 0) || 0 };
    MINIMAP_PLACEMENT_CACHE.set(cacheKey, placement);
    return placement;
  } catch {
    return {
      x: Number(fallback.x ?? 0) || 0,
      y: Number(fallback.y ?? 0) || 0,
    };
  }
}

function buildMinimapPlacementCandidates(width, height, size) {
  const candidates = [];
  const left = 72;
  const right = width - size - 72;
  const top = 188;
  const bottom = Math.min(486, height - size - 98);
  const stepX = 64;
  const stepY = 46;
  for (let y = top; y <= bottom; y += stepY) {
    for (let x = left; x <= right; x += stepX) {
      if (overlapsRect(x, y, size, size, 48, 44, 1504, 126)) continue;
      if (overlapsRect(x, y, size, size, 48, 520, 1504, 330)) continue;
      candidates.push({ x, y, size });
    }
  }
  const fallback = MAP_SCENE_MINIMAP_PLACEMENT.Sumari;
  candidates.push({ x: fallback.x, y: fallback.y, size });
  return candidates;
}

function scoreMinimapPlacementCandidate(data, info, candidate, imageWidth, imageHeight) {
  const channels = info.channels || 3;
  const scaleX = info.width / imageWidth;
  const scaleY = info.height / imageHeight;
  const startX = Math.max(0, Math.floor(candidate.x * scaleX));
  const startY = Math.max(0, Math.floor(candidate.y * scaleY));
  const endX = Math.min(info.width - 1, Math.ceil((candidate.x + candidate.size) * scaleX));
  const endY = Math.min(info.height - 1, Math.ceil((candidate.y + candidate.size) * scaleY));
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let edge = 0;
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const idx = (y * info.width + x) * channels;
      const lum = luminance(data[idx], data[idx + 1], data[idx + 2]);
      sum += lum;
      sumSq += lum * lum;
      count += 1;
      if (x > startX) {
        const prev = (y * info.width + x - 1) * channels;
        edge += Math.abs(lum - luminance(data[prev], data[prev + 1], data[prev + 2]));
      }
      if (y > startY) {
        const prev = ((y - 1) * info.width + x) * channels;
        edge += Math.abs(lum - luminance(data[prev], data[prev + 1], data[prev + 2]));
      }
    }
  }
  if (!count) return Number.POSITIVE_INFINITY;
  const avg = sum / count;
  const variance = Math.max(0, sumSq / count - avg * avg);
  const edgeDensity = edge / count;
  const brightnessPenalty = avg < 38 ? (38 - avg) * 0.9 : avg > 218 ? (avg - 218) * 0.35 : 0;
  const centerPenalty = Math.abs(candidate.x + candidate.size / 2 - imageWidth / 2) * 0.015;
  return edgeDensity * 2.2 + Math.sqrt(variance) * 1.4 + brightnessPenalty + centerPenalty;
}

function luminance(r = 0, g = 0, b = 0) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function overlapsRect(x, y, width, height, rx, ry, rw, rh) {
  return x < rx + rw && x + width > rx && y < ry + rh && y + height > ry;
}

async function buildMatchSceneBackground(sharp, layout) {
  const mapImage = getMapSceneAssetPath(layout);
  try {
    if (!mapImage) throw new Error("missing map image");

    const base = await sharp(mapImage)
      .resize(layout.width, layout.height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();

    return sharp(base)
      .composite([
        {
          input: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + layout.width + '" height="' + layout.height + '"><defs><linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#020617" stop-opacity="0.28"/><stop offset="28%" stop-color="#020617" stop-opacity="0.06"/><stop offset="100%" stop-color="#020617" stop-opacity="0.34"/></linearGradient><radialGradient id="vignette" cx="50%" cy="42%" r="74%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0"/><stop offset="100%" stop-color="#020617" stop-opacity="0.26"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#topFade)"/><rect width="100%" height="100%" fill="url(#vignette)"/></svg>',
            'utf8',
          ),
        },
      ])
      .png()
      .toBuffer();
  } catch {
    return sharp({
      create: {
        width: layout.width,
        height: layout.height,
        channels: 4,
        background: '#08111f',
      },
    }).png().toBuffer();
  }
}

function getMapSceneAssetPath(layout) {
  return layout.template?.assetPath
    ? path.resolve(process.cwd(), layout.template.assetPath)
    : layout.template?.fileName
      ? path.resolve(process.cwd(), "MapScene", layout.template.fileName)
      : null;
}

async function buildMatchSceneLayout(snapshot, options = {}) {
  const width = 1600;
  const height = 900;
  const sortedTeams = [...(snapshot.teams ?? [])].sort((left, right) => compareNumbers(left.teamID, right.teamID));
  const team1 = sortedTeams.find((team) => Number(team.teamID) === 1) ?? sortedTeams[0] ?? emptyTeam(1);
  const team2 = sortedTeams.find((team) => Number(team.teamID) === 2) ?? sortedTeams[1] ?? emptyTeam(2);
  const mapKey = resolveMapSceneKey(snapshot.match.map, snapshot.match.layer);
  const template = MAP_SCENE_TEMPLATE_BY_KEY[mapKey] ?? MAP_SCENE_TEMPLATE_BY_KEY.Sumari;
  const minimap = resolveMatchMinimap(snapshot.match.map, snapshot.match.layer, template);
  const commander1 = resolveCommanderName(team1) || findTeamCommanderName(snapshot.players, team1.teamID);
  const commander2 = resolveCommanderName(team2) || findTeamCommanderName(snapshot.players, team2.teamID);
  const maxPlayers = Number(snapshot.match.maxPlayers ?? 0) || 0;
  const currentPlayers = Number(snapshot.match.playerCount ?? snapshot.summary?.playerCount ?? 0) || 0;
  const queueCount = Number(snapshot.server?.queueCount ?? 0) || 0;
  const rconTime = Number(snapshot.match.rconTime ?? snapshot.match.playtime ?? 0) || 0;

  return {
    width,
    height,
    template,
    minimap,
    mapTitle: snapshot.match.map || snapshot.match.layer || 'Unknown Map',
    layerTitle: snapshot.match.layer || '-',
    modeTitle: snapshot.match.mode || '-',
    serverName: snapshot.server.serverName || snapshot.server.serverId || 'BZSS Panel',
    capturedAt: snapshot.capturedAt,
    serverPlayersText: String(currentPlayers),
    serverCapacityText: maxPlayers ? `${currentPlayers}/${maxPlayers}` : String(currentPlayers),
    queueText: String(queueCount),
    rconTimeText: formatDurationClock(rconTime),
    serverTag: snapshot.server.rcon || 'unknown',
    teamPanels: [
      await buildMatchTeamPanel(team1, 64, 540, 720, 268, template.theme.team1, commander1, options),
      await buildMatchTeamPanel(team2, 816, 540, 720, 268, template.theme.team2, commander2, options),
    ],
    statCards: [
      { x: 956, label: 'SERVER PLAYERS', value: String(currentPlayers), tone: template.theme.hud },
      { x: 1162, label: 'CAPACITY', value: maxPlayers ? `${currentPlayers}/${maxPlayers}` : String(currentPlayers), tone: template.theme.accent },
      { x: 1402, label: 'QUEUE', value: String(queueCount), tone: template.theme.accent2 },
      { x: 1226, label: 'RCON TIME', value: formatDurationClock(rconTime), tone: '#22c55e' },
    ],
  };
}

async function buildMatchTeamPanel(team, x, y, width, height, accent, commanderName, options = {}) {
  const resolvedFlag = team.flagAssetPath || resolveFactionFlagAssetPath(team.teamName);
  const commanderPlayer = team.commanderPlayer ?? null;
  const commanderAvatar = firstText(
    commanderPlayer?.steamAvatar,
    commanderPlayer?.steam_avatar,
    commanderPlayer?.avatar,
    commanderPlayer?.steamPlaytime?.steamAvatar,
    commanderPlayer?.steamPlaytime?.steam_avatar,
  );
  return {
    x,
    y,
    width,
    height,
    accent,
    teamName: team.teamName || 'Team ' + team.teamID,
    teamId: team.teamID,
    factionCode: team.factionCode || resolveFactionCodeFromTeamName(team.teamName),
    playerCount: Number(team.playerCount ?? 0) || 0,
    squadCount: Array.isArray(team.squads) ? team.squads.length : 0,
    commanderName: commanderName || 'Pending',
    commanderLabel: commanderName || 'Pending',
    commanderPlaytimeText: formatDurationLong(resolvePlayerGameSeconds(commanderPlayer)),
    commanderAvatarDataUri: commanderAvatar ? await readImageDataUri(commanderAvatar) : '',
    flagDataUri: resolvedFlag ? await readAssetDataUri(resolvedFlag) : '',
    commanderPlayer,
    includeSteamID: Boolean(options.includeSteamID ?? true),
  };
}

function renderMatchSceneSvg(layout) {
  const svg = [];
  const theme = layout.template?.theme ?? MAP_SCENE_THEMES.forest;
  svg.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + layout.width + '" height="' + layout.height + '" viewBox="0 0 ' + layout.width + ' ' + layout.height + '">');
  svg.push('<defs>');
  svg.push(`<linearGradient id="topPlate" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#020617" stop-opacity="0.74"/><stop offset="50%" stop-color="${theme.hud2}" stop-opacity="0.24"/><stop offset="100%" stop-color="#020617" stop-opacity="0.68"/></linearGradient>`);
  svg.push('<linearGradient id="teamShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#020617" stop-opacity="0.62"/><stop offset="58%" stop-color="#020617" stop-opacity="0.34"/><stop offset="100%" stop-color="#020617" stop-opacity="0.04"/></linearGradient>');
  svg.push('<filter id="flagGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="32"/></filter>');
  svg.push('<style><![CDATA[');
  svg.push("text{font-family:'Bahnschrift SemiCondensed','Bahnschrift','Agency FB','Arial Narrow','Microsoft YaHei',sans-serif;fill:#eef4ff;letter-spacing:.2px}.mono{font-family:'Cascadia Mono','Consolas',monospace}.eyebrow{font-size:13px;fill:#b8c7d8;font-weight:800}.title{font-size:48px;font-weight:900;fill:#ffffff}.sub{font-size:17px;fill:#d7e2ee}.meta{font-size:12px;fill:#a8b8c8}.chip-label{font-size:10px;fill:#b7c4d2;font-weight:900}.chip-value{font-size:23px;fill:#ffffff;font-weight:900}.team-tag{font-size:12px;fill:#0b1220;font-weight:900}.team-name{font-size:24px;font-weight:900;fill:#ffffff;letter-spacing:.5px}.team-meta{font-size:13px;fill:#dce7f3}.team-row{font-size:11px;fill:#aebdca;font-weight:900;letter-spacing:1.1px}.team-stat{font-size:11px;fill:#c2cfdb;font-weight:800}.strong{font-size:20px;font-weight:900;fill:#ffffff}.avatar-initial{font-size:21px;font-weight:900;fill:#0b1220}]]></style>");
  svg.push('</defs>');
  svg.push('<rect x="0" y="0" width="1600" height="900" fill="rgba(2,6,23,0.12)"/>');
  svg.push('<path d="M48 44 H1118 L1168 94 H1552 V162 H48 Z" fill="url(#topPlate)"/>');
  svg.push(`<path d="M48 44 H1118 L1168 94 H1552" fill="none" stroke="${theme.line}" stroke-opacity="0.24" stroke-width="1.5"/>`);
  svg.push(`<path d="M68 160 H642" stroke="${theme.line}" stroke-opacity="0.28" stroke-width="1"/>`);
  svg.push(`<path d="M68 44 V76 M48 64 H86 M1532 162 V130 M1552 142 H1514" stroke="${theme.hud}" stroke-opacity="0.7" stroke-width="2"/>`);
  svg.push('<text x="76" y="72" class="eyebrow">LIVE MATCH / RCON SNAPSHOT</text>');
  svg.push('<text x="76" y="124" class="title">' + xmlEscape(layout.mapTitle) + '</text>');
  svg.push('<text x="78" y="151" class="sub">' + xmlEscape(layout.layerTitle) + ' | ' + xmlEscape(layout.modeTitle) + ' | ' + xmlEscape(layout.serverName) + '</text>');
  svg.push('<text x="1192" y="148" class="meta mono">CAPTURED ' + xmlEscape(formatDateTimeLocal(layout.capturedAt)) + '</text>');

  const topStats = [
    { x: 932, label: 'SERVER PLAYERS', value: layout.serverPlayersText, tone: theme.hud },
    { x: 1096, label: 'CAPACITY', value: layout.serverCapacityText, tone: theme.line },
    { x: 1260, label: 'RCON TIME', value: layout.rconTimeText, tone: '#22c55e' },
    { x: 1424, label: 'QUEUE', value: layout.queueText, tone: theme.alert },
  ];
  for (const stat of topStats) {
    svg.push(renderHeroStatCard(stat.x, 64, 132, 58, stat.label, stat.value, stat.tone));
  }

  svg.push(`<path d="M72 520 H1528" stroke="${theme.line}" stroke-opacity="0.24" stroke-width="1"/>`);
  svg.push(`<path d="M72 838 H1528" stroke="${theme.line}" stroke-opacity="0.18" stroke-width="1"/>`);
  svg.push(`<path d="M800 548 V820" stroke="${theme.line}" stroke-opacity="0.16" stroke-width="1"/>`);
  for (const team of layout.teamPanels) {
    svg.push(renderTeamPanel(team));
  }

  svg.push('</svg>');
  return svg.join('\n');
}

function renderHeroStatCard(x, y, width, height, label, value, tone) {
  return [
    `<path d="M ${x} ${y} H ${x + width - 12} L ${x + width} ${y + 12} V ${y + height} H ${x} Z" fill="rgba(2,6,23,0.48)" stroke="${tone}" stroke-opacity="0.55" stroke-width="1.5"/>`,
    `<path d="M ${x + 10} ${y + 8} H ${x + 48}" stroke="${tone}" stroke-width="2"/>`,
    `<text x="${x + 12}" y="${y + 25}" class="chip-label">${xmlEscape(label)}</text>`,
    `<text x="${x + 12}" y="${y + 51}" class="chip-value mono">${xmlEscape(value)}</text>`,
  ].join("");
}

function renderTeamPanel(team) {
  const flagDataUri = team.flagDataUri || '';
  const commanderText = team.commanderName || 'Pending';
  const commanderAvatarDataUri = team.commanderAvatarDataUri || '';
  const commanderPlaytimeText = team.commanderName ? (team.commanderPlaytimeText || '0m') : '-';
  const squadCountText = team.squadCount + ' squads';
  const panelX = team.x;
  const panelY = team.y;
  const width = team.width;
  const height = team.height;
  const flagSize = 166;
  const isRight = Number(team.teamId) === 2;
  const tagX = isRight ? panelX + width - 104 : panelX + 28;
  const textX = isRight ? panelX + 42 : panelX + 222;
  const flagX = isRight ? panelX + width - 206 : panelX + 34;
  const textMaxWidth = isRight ? width - 292 : width - 270;
  const avatarX = textX;
  const avatarY = panelY + 160;
  const avatarSize = 58;
  const glowColors = FACTION_GLOW_BY_CODE[team.factionCode] ?? [team.accent, "#ffffff"];
  const glowCenterX = flagX + flagSize / 2;
  const glowCenterY = panelY + 64 + flagSize / 2;
  const shadePath = isRight
    ? `M ${panelX} ${panelY + 22} H ${panelX + width - 42} L ${panelX + width} ${panelY + 72} V ${panelY + height - 22} H ${panelX + 54} L ${panelX} ${panelY + height - 74} Z`
    : `M ${panelX + 42} ${panelY + 22} H ${panelX + width} V ${panelY + height - 74} L ${panelX + width - 54} ${panelY + height - 22} H ${panelX} V ${panelY + 72} Z`;
  return [
    `<path d="${shadePath}" fill="url(#teamShade)" stroke="${team.accent}" stroke-opacity="0.3" stroke-width="1.5"/>`,
    `<ellipse cx="${glowCenterX}" cy="${glowCenterY}" rx="174" ry="88" fill="${glowColors[0]}" opacity="0.42" filter="url(#flagGlow)"/>`,
    `<ellipse cx="${glowCenterX + (isRight ? 34 : -34)}" cy="${glowCenterY + 18}" rx="132" ry="68" fill="${glowColors[1] ?? glowColors[0]}" opacity="0.34" filter="url(#flagGlow)"/>`,
    glowColors[2]
      ? `<ellipse cx="${glowCenterX}" cy="${glowCenterY - 28}" rx="110" ry="48" fill="${glowColors[2]}" opacity="0.26" filter="url(#flagGlow)"/>`
      : "",
    `<path d="M ${panelX + 18} ${panelY + 48} H ${panelX + 92} M ${panelX + width - 92} ${panelY + height - 46} H ${panelX + width - 18}" stroke="${team.accent}" stroke-opacity="0.9" stroke-width="3"/>`,
    `<path d="M ${panelX + 18} ${panelY + height - 46} H ${panelX + 68} M ${panelX + width - 68} ${panelY + 48} H ${panelX + width - 18}" stroke="#d6e4f2" stroke-opacity="0.28" stroke-width="1.5"/>`,
    `<rect x="${tagX}" y="${panelY + 36}" width="76" height="26" fill="${team.accent}"/>`,
    `<text x="${tagX + 38}" y="${panelY + 55}" text-anchor="middle" class="team-tag">TEAM ${xmlEscape(String(team.teamId ?? '?'))}</text>`,
    flagDataUri
      ? `<image href="${flagDataUri}" x="${flagX}" y="${panelY + 64}" width="${flagSize}" height="${flagSize}" preserveAspectRatio="xMidYMid meet"/>`
      : `<path d="M ${flagX} ${panelY + 64} H ${flagX + flagSize} V ${panelY + 64 + flagSize} H ${flagX} Z" fill="${team.accent}" fill-opacity="0.28" stroke="${team.accent}" stroke-opacity="0.74"/>`,
    renderFitText({ x: textX, y: panelY + 92, className: "team-name", maxWidth: textMaxWidth, charWidth: 13.8 }, truncateText(team.teamName, isRight ? 26 : 29)),
    `<text x="${textX}" y="${panelY + 124}" class="team-meta mono">${xmlEscape(team.factionCode || 'UNKNOWN')} / ${xmlEscape(String(team.playerCount))} PAX / ${xmlEscape(squadCountText)}</text>`,
    `<path d="M ${textX} ${panelY + 148} H ${isRight ? panelX + width - 236 : panelX + width - 44}" stroke="#d6e4f2" stroke-opacity="0.24" stroke-width="1"/>`,
    `<path d="M ${avatarX} ${avatarY} H ${avatarX + avatarSize - 10} L ${avatarX + avatarSize} ${avatarY + 10} V ${avatarY + avatarSize} H ${avatarX} Z" fill="rgba(226,238,250,0.92)" stroke="${team.accent}" stroke-opacity="0.9" stroke-width="2"/>`,
    commanderAvatarDataUri
      ? `<image href="${commanderAvatarDataUri}" x="${avatarX + 4}" y="${avatarY + 4}" width="${avatarSize - 8}" height="${avatarSize - 8}" preserveAspectRatio="xMidYMid slice"/>`
      : `<text x="${avatarX + avatarSize / 2}" y="${avatarY + 38}" text-anchor="middle" class="avatar-initial">${xmlEscape(getPlayerInitials(commanderText))}</text>`,
    `<text x="${textX + 76}" y="${panelY + 174}" class="team-row">COMMANDER</text>`,
    renderFitText({ x: textX + 76, y: panelY + 204, className: "strong", maxWidth: textMaxWidth - 82, charWidth: 12.8 }, truncateText(commanderText, isRight ? 22 : 24)),
    `<text x="${textX + 76}" y="${panelY + 228}" class="team-stat mono">GAME TIME ${xmlEscape(commanderPlaytimeText)}</text>`,
    `<text x="${textX}" y="${panelY + 240}" class="team-stat mono">READY ${xmlEscape(String(team.playerCount).padStart(2, '0'))} | SQUADS ${xmlEscape(String(team.squadCount).padStart(2, '0'))}</text>`,
  ].join("");
}

function renderFitText({ x, y, className, maxWidth, charWidth }, value) {
  const text = String(value ?? "");
  const attrs = [`x="${x}"`, `y="${y}"`, `class="${className}"`];
  if (estimateDisplayWidth(text, charWidth) > maxWidth) {
    attrs.push(`textLength="${Math.max(80, Math.floor(maxWidth))}"`, 'lengthAdjust="spacingAndGlyphs"');
  }
  return `<text ${attrs.join(" ")}>${xmlEscape(text)}</text>`;
}

function estimateDisplayWidth(text, charWidth = 12) {
  return [...String(text ?? "")].reduce((total, char) => total + (/[\u4e00-\u9fff]/.test(char) ? charWidth * 1.35 : charWidth), 0);
}
async function readAssetDataUri(assetPath) {
  const cleanPath = String(assetPath ?? "").replace(/^\//, "");
  const candidates = [
    path.join(ICON_BASE_DIR, cleanPath.replace(/\//g, path.sep)),
    path.resolve(process.cwd(), cleanPath.replace(/\//g, path.sep)),
    path.resolve(process.cwd(), "MapScene", path.basename(cleanPath)),
    path.join(process.cwd(), "web-client", "src", "shared", "faction-assets", path.basename(cleanPath)),
  ];

  for (const filePath of candidates) {
    try {
      const content = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
      return `data:${mime};base64,${content.toString("base64")}`;
    } catch {
      // Try next candidate.
    }
  }

  return "";
}

async function readImageDataUri(source) {
  const value = String(source ?? "").trim();
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  if (/^https?:\/\//i.test(value)) {
    return readRemoteImageDataUri(value);
  }
  return readAssetDataUri(value);
}

async function readRemoteImageDataUri(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("image/")) return "";
    const arrayBuffer = await response.arrayBuffer();
    return `data:${contentType.split(";")[0]};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
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
      label: buildSquadDisplayName(squad) || "Unnamed Squad",
      count: squad.members.length,
      height: 34,
    });
    for (const player of squad.members) rows.push(buildPlayerRow(player, options, iconCache));
  }

  if (team.unassignedPlayers.length) {
    rows.push({
      type: "squad",
      label: "Unassigned",
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
    statsLine: `Players ${team.playerCount} | Squads ${team.squads.length} | SL ${leaderCount} | Unassigned ${team.unassignedPlayers.length}`,
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
  svg.push(renderSummaryMetric(648, 34, "Players", layout.summary.playerCount, "#38bdf8"));
  svg.push(renderSummaryMetric(792, 34, "Squads", layout.summary.squadCount, "#a78bfa"));
  svg.push(renderSummaryMetric(936, 34, "SL", layout.summary.leaderCount, "#f59e0b"));
  svg.push(renderSummaryMetric(1080, 34, "Unassigned", layout.summary.unassignedCount, "#ef4444"));
  svg.push(renderSummaryMetric(1224, 34, "Match Duration", layout.summary.matchDuration || "-", "#22c55e"));

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
      return `${result}...`;
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

function formatDurationClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function resolveCommanderName(team) {
  return String(team?.commanderName ?? team?.commanderPlayer?.name ?? "").trim();
}

function findTeamCommanderName(players = [], teamID) {
  const commander = resolveTeamCommander({
    team: { teamID, squads: [] },
    players,
    squads: [],
    modules: null,
    serverId: "",
  });
  return commander?.name ?? "";
}

function resolveTeamCommander({ team, players = [], squads = [], modules = null, serverId = "" }) {
  const teamID = Number(team?.teamID);
  if (!Number.isFinite(teamID)) return null;

  const commandSquadIds = resolveCommandSquadIds({ teamID, squads: team?.squads?.length ? team.squads : squads, modules, serverId });
  const teamPlayers = (Array.isArray(players) ? players : []).filter((player) => Number(player?.teamID) === teamID);

  if (commandSquadIds.length > 0) {
    const commandPlayers = teamPlayers.filter((player) =>
      commandSquadIds.some((squadID) => normalizeCommandId(squadID) === normalizeCommandId(player?.squadID)),
    );
    return commandPlayers.find((player) => Boolean(player?.isLeader) && hasPlayerName(player))
      ?? commandPlayers.find((player) => isCommanderRole(player) && hasPlayerName(player))
      ?? commandPlayers.find(hasPlayerName)
      ?? null;
  }

  return teamPlayers.find((player) => Boolean(player?.isCommander) && hasPlayerName(player))
    ?? teamPlayers.find((player) => isCommanderRole(player) && hasPlayerName(player))
    ?? null;
}

function resolveCommandSquadIds({ teamID, squads = [], modules = null, serverId = "" }) {
  const ids = [];
  const pushId = (value) => {
    const id = normalizeCommandId(value);
    if (id && !ids.includes(id)) ids.push(id);
  };

  for (const squad of Array.isArray(squads) ? squads : []) {
    if (Number(squad?.teamID ?? squad?.teamId) !== Number(teamID)) continue;
    const squadName = firstText(squad?.squadName, squad?.name, "");
    const squadID = squad?.squadID ?? squad?.squadId;
    if (isCommandSquadName(squadName) || isCommandSquadId(squadID)) pushId(squadID);
  }

  const squadApi = modules?.squadManagement?.api ?? modules?.squadManagement ?? null;
  if (typeof squadApi?.getSquads === "function") {
    const list = squadApi.getSquads(serverId) ?? [];
    for (const squad of Array.isArray(list) ? list : []) {
      if (Number(squad?.teamID ?? squad?.teamId) !== Number(teamID)) continue;
      const squadName = firstText(squad?.squadName, squad?.name, "");
      if (isCommandSquadName(squadName)) pushId(squad?.squadID ?? squad?.squadId);
    }
  }

  return ids;
}

function isCommanderRole(player) {
  const role = String(player?.role ?? "").trim().toLowerCase();
  return role.includes("commander") || role === "cmd" || role.includes(" cmd");
}

function hasPlayerName(player) {
  return Boolean(String(player?.name ?? "").trim());
}

function isCommandSquadName(value) {
  const name = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!name) return false;
  return name === "command squad" || name === "cmd" || name === "command" || /\bcommand\s*squad\b/i.test(name);
}

function isCommandSquadId(value) {
  const id = normalizeCommandId(value);
  return id === "10" || id === "cmd" || id === "command";
}

function normalizeCommandId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resolvePlayerGameSeconds(player) {
  if (!player) return 0;
  const direct = firstFiniteNumber(
    player.gameSeconds,
    player.playtimeSeconds,
    player.steamPlaytime?.gameSeconds,
    player.steamPlaytime?.game_seconds,
  );
  if (direct != null) return direct;
  const hours = firstFiniteNumber(player.gameHours, player.playtimeHours);
  return hours != null ? hours * 3600 : 0;
}

function getPlayerInitials(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "--";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function truncateText(value, maxLength = 28) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function resolveMapSceneKey(mapName, layerName) {
  const candidates = [String(layerName ?? ""), String(mapName ?? "")];
  for (const candidate of candidates) {
    const candidateTokens = tokenizeSceneName(candidate);
    const candidateCompact = compactTokens(candidateTokens);
    if (!candidateTokens.length && !candidateCompact) continue;

    for (const template of MAP_SCENE_TEMPLATE_LIST) {
      const templateTokens = tokenizeSceneName(template.key);
      const templateCompact = compactTokens(templateTokens);
      if (tokensMatch(candidateTokens, templateTokens, candidateCompact, templateCompact)) {
        return template.key;
      }
    }
  }

  return "Sumari";
}

function resolveMatchMinimap(mapName, layerName, template) {
  const minimapFile = resolveTacticalMinimapFile(mapName, layerName, template?.key);
  if (!minimapFile) return null;
  const assetPath = resolveMinimapAssetPath(minimapFile);
  if (!assetPath) return null;
  const placement = MAP_SCENE_MINIMAP_PLACEMENT[template?.key] ?? MAP_SCENE_MINIMAP_PLACEMENT.Sumari;
  return {
    ...placement,
    fileName: minimapFile,
    assetPath,
  };
}

function resolveTacticalMinimapFile(mapName, layerName, sceneKey) {
  const normalizedLayer = normalizeTacticalMapKey(layerName);
  if (TACTICAL_MINIMAP_BY_KEY[normalizedLayer]) return TACTICAL_MINIMAP_BY_KEY[normalizedLayer];

  const normalizedMap = normalizeTacticalMapKey(mapName);
  if (TACTICAL_MINIMAP_BY_KEY[normalizedMap]) return TACTICAL_MINIMAP_BY_KEY[normalizedMap];

  const sceneTokens = tokenizeSceneName(sceneKey);
  const candidates = Object.entries(TACTICAL_MINIMAP_BY_KEY);
  for (const [key, fileName] of candidates) {
    const keyTokens = tokenizeSceneName(key);
    if (tokensMatch(sceneTokens, keyTokens, compactTokens(sceneTokens), compactTokens(keyTokens))) return fileName;
  }

  return null;
}

function normalizeTacticalMapKey(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (TACTICAL_MINIMAP_BY_KEY[text]) return text;
  const withoutLayerSuffix = text.replace(/_v\d+$/i, "_v1");
  if (TACTICAL_MINIMAP_BY_KEY[withoutLayerSuffix]) return withoutLayerSuffix;
  const mapKey = resolveMapSceneKey(text, text);
  const raasKey = `${mapKey}_RAAS_v1`;
  return TACTICAL_MINIMAP_BY_KEY[raasKey] ? raasKey : text;
}

function resolveMinimapAssetPath(fileName) {
  const candidates = [
    path.resolve(process.cwd(), "web-client", "public", fileName),
    path.resolve(process.cwd(), "public", fileName),
    path.resolve(process.cwd(), "MapScene", fileName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

function createMapSceneTemplate(key, fileName, index = 0) {
  const styleKey = MAP_SCENE_STYLE_BY_KEY[key] ?? "forest";
  const theme = MAP_SCENE_THEMES[styleKey] ?? MAP_SCENE_THEMES.forest;
  return {
    key,
    fileName,
    assetPath: path.join("MapScene", fileName),
    displayName: prettifySceneKey(key),
    styleKey,
    theme,
  };
}

function prettifySceneKey(key) {
  return String(key ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSceneName(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .filter((part) => !["raas", "aas", "v1", "v2", "v3", "seed", "map", "layer", "loading", "screen", "dqhd"].includes(part));
}

function compactTokens(tokens) {
  return tokens.join("");
}

function tokensMatch(candidateTokens, templateTokens, candidateCompact, templateCompact) {
  if (!candidateTokens.length || !templateTokens.length) return false;
  if (candidateTokens.some((token) => templateTokens.includes(token))) return true;
  if (candidateCompact && templateTokens.some((token) => candidateCompact.includes(token))) return true;
  if (templateCompact && candidateTokens.some((token) => templateCompact.includes(token))) return true;
  return false;
}

function resolveFactionFlagAssetPath(teamName) {
  const code = resolveFactionCodeFromTeamName(teamName);
  if (!code) return null;
  const fileName = FACTION_FLAG_BY_CODE[code];
  if (!fileName) return null;
  return `/assets/faction-assets/${fileName}`;
}

function resolveFactionCodeFromTeamName(teamName) {
  const normalized = normalizeFactionLookupName(teamName);
  if (!normalized) return null;

  const visualCode = getBattlegroupFactionLookup().get(normalized);
  if (visualCode) return visualCode;

  const fallbackRules = [
    ["RGF", ["combined arms army", "russian ground", "russian", "motor rifle", "guards rifle"]],
    ["USMC", ["marine corps", "marines", "expeditionary", "amphibious"]],
    ["USA", ["air assault", "infantry division", "army", "us army", "united states", "american"]],
    ["PLANMC", ["naval infantry", "marine corps"]],
    ["VDV", ["airborne", "air assault", "guards airborne"]],
    ["PLAAGF", ["army group", "group army"]],
  ];
  for (const [code, terms] of fallbackRules) {
    if (terms.some((term) => normalized.includes(term))) return code;
  }

  const rules = [
    ["ADF", ["adf", "australian", "royal australian"]],
    ["AFU", ["afu", "ukraine", "ukrainian"]],
    ["BAF", ["baf", "british", "uk armed forces", "british armed"]],
    ["CAF", ["caf", "canadian", "canada"]],
    ["CRF", ["crf"]],
    ["GFI", ["gfi", "ger", "german", "federal"]],
    ["IMF", ["imf", "insurgent mil", "militia"]],
    ["MEA", ["mea", "middle east", "arab", "insurgent"]],
    ["MEI", ["mei", "irregular", "militia"]],
    ["PLA", ["pla", "people's liberation", "people liberation", "chinese", "china"]],
    ["PLAAGF", ["plaagf", "agf", "army group"]],
    ["PLANMC", ["planmc", "marine corps", "naval infantry"]],
    ["RGF", ["rgf", "russian ground", "russian"]],
    ["TLF", ["tlf", "turkish", "turkey"]],
    ["USA", ["usa", "us army", "american", "united states", "u.s."]],
    ["USMC", ["usmc", "marine", "marines"]],
    ["VDV", ["vdv", "airborne", "guards airborne"]],
    ["WPMC", ["wpmc", "manticore", "private military", "pmc"]],
  ];

  for (const [code, terms] of rules) {
    if (terms.some((term) => normalized.includes(term))) return code;
  }

  return null;
}

let battlegroupFactionLookup = null;

function getBattlegroupFactionLookup() {
  if (battlegroupFactionLookup) return battlegroupFactionLookup;

  const lookup = new Map();
  for (const code of Object.keys(FACTION_FLAG_BY_CODE)) {
    lookup.set(normalizeFactionLookupName(code), code);
  }

  try {
    const source = readFileSync(FACTION_ASSET_DATA_PATH, "utf8");
    const visualBlocks = source.match(/\{\s*name:\s*"[^"]+"[\s\S]*?unitIconBasename:\s*"[^"]*"[\s\S]*?\}/g) ?? [];
    for (const block of visualBlocks) {
      const faction = block.match(/faction:\s*"([A-Z]+)"/)?.[1];
      if (!faction || !FACTION_FLAG_BY_CODE[faction]) continue;

      const names = [];
      const primaryName = block.match(/name:\s*"([^"]+)"/)?.[1];
      if (primaryName) names.push(primaryName);

      const aliasesText = block.match(/aliases:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
      for (const aliasMatch of aliasesText.matchAll(/"([^"]+)"/g)) {
        names.push(aliasMatch[1]);
      }

      for (const name of names) {
        const key = normalizeFactionLookupName(name);
        if (key) lookup.set(key, faction);
      }
    }
  } catch {
    // Keep the built-in fallback rules when the Vue asset manifest is not available.
  }

  battlegroupFactionLookup = lookup;
  return battlegroupFactionLookup;
}

function normalizeFactionLookupName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}


export async function generateMatchEndReportPng(payload, options = {}) {
  const snapshot = buildMatchEndRenderSnapshot(payload);
  const sharp = await loadSharp();
  const hero = await renderMatchScenePng(sharp, snapshot, {
    ...options,
    includeSteamID: false,
  });
  const scoreboard = buildMatchEndScoreboardLayout(snapshot);
  const scoreboardSvg = Buffer.from(renderMatchEndScoreboardSvg(scoreboard), "utf8");
  const totalHeight = 900 + scoreboard.height;

  return sharp({
    create: {
      width: 1600,
      height: totalHeight,
      channels: 4,
      background: { r: 2, g: 6, b: 18, alpha: 1 },
    },
  })
    .composite([
      { input: hero, left: 0, top: 0 },
      { input: scoreboardSvg, left: 0, top: 900 },
    ])
    .png()
    .toBuffer();
}

function buildMatchEndRenderSnapshot(payload) {
  const players = (Array.isArray(payload?.players) ? payload.players : []).map((player) => ({
    ...cloneJsonSafe(player),
    name: firstText(player?.name, "Unknown"),
    teamID: nullableNumber(player?.teamID),
    squadID: nullableNumber(player?.squadID),
    isLeader: Boolean(player?.isLeader),
    isCommander: Boolean(player?.isCommander),
    role: firstText(player?.role, player?.bzssCore?.soldierClass, ""),
    online: true,
    combatStats: {
      kills: normalizeNumber(player?.bzssCore?.kills),
      wounds: normalizeNumber(player?.bzssCore?.downs),
      deaths: normalizeNumber(player?.bzssCore?.deaths),
      tk: normalizeNumber(player?.bzssCore?.teamKills),
    },
    raw: cloneJsonSafe(player),
  }));
  const squads = normalizeSquads(Array.isArray(payload?.squads) ? payload.squads : []);
  const teams = buildTeams(players, squads);
  const playerCount = Number(payload?.server?.playerCount ?? payload?.summary?.playerCount ?? players.length) || players.length;

  return {
    capturedAt: payload?.capturedAt ?? new Date().toISOString(),
    trigger: cloneJsonSafe(payload?.trigger ?? {}),
    server: {
      ...cloneJsonSafe(payload?.server ?? {}),
      playerCount,
      queueCount: Number(payload?.server?.queueCount ?? 0) || 0,
    },
    match: {
      ...cloneJsonSafe(payload?.match ?? {}),
      playerCount,
    },
    summary: {
      ...cloneJsonSafe(payload?.summary ?? {}),
      playerCount,
      squadCount: squads.length,
    },
    players,
    squads,
    teams,
  };
}

function buildMatchEndScoreboardLayout(snapshot) {
  const teams = [...(snapshot.teams ?? [])].sort((left, right) => compareNumbers(left.teamID, right.teamID));
  const sections = [];
  let y = 104;
  for (const team of teams) {
    const players = [
      ...team.squads.flatMap((squad) => squad.members.map((player) => ({
        ...player,
        squadName: buildSquadDisplayName(squad, player),
      }))),
      ...team.unassignedPlayers.map((player) => ({ ...player, squadName: "未加入小队" })),
    ];
    players.sort((left, right) =>
      compareNumbers(left.squadID, right.squadID)
      || Number(right.isCommander) - Number(left.isCommander)
      || Number(right.isLeader) - Number(left.isLeader)
      || compareNumbers(right?.bzssCore?.combatScore, left?.bzssCore?.combatScore)
      || String(left.name).localeCompare(String(right.name), "zh-CN"));
    const height = 82 + Math.max(1, players.length) * 38;
    sections.push({
      teamID: team.teamID,
      teamName: team.teamName || "Team " + team.teamID,
      playerCount: players.length,
      commander: findTeamCommanderName(snapshot.players, team.teamID) || "未记录",
      accent: Number(team.teamID) === 2 ? "#f59e0b" : "#2dd4bf",
      players,
      y,
      height,
    });
    y += height + 22;
  }
  return {
    width: 1600,
    height: Math.max(280, y + 42),
    capturedAt: snapshot.capturedAt,
    map: firstText(snapshot?.match?.map, snapshot?.match?.layer, "Unknown Map"),
    nextMap: firstText(snapshot?.match?.nextMap, snapshot?.match?.nextLayer, "未知"),
    winner: firstText(snapshot?.trigger?.winner, ""),
    sections,
  };
}

function renderMatchEndScoreboardSvg(layout) {
  const svg = [];
  svg.push('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="' + layout.height + '" viewBox="0 0 1600 ' + layout.height + '">');
  svg.push('<defs>');
  svg.push('<linearGradient id="reportBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#071426"/><stop offset="100%" stop-color="#020611"/></linearGradient>');
  svg.push('<linearGradient id="reportTitle" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0f2944"/><stop offset="50%" stop-color="#13243c"/><stop offset="100%" stop-color="#0a1629"/></linearGradient>');
  svg.push('<style><![CDATA[');
  svg.push("text{font-family:'Bahnschrift SemiCondensed','Bahnschrift','Arial Narrow','Microsoft YaHei',sans-serif;fill:#edf5ff}.mono{font-family:'Cascadia Mono','Consolas',monospace}.report-title{font-size:28px;font-weight:900}.report-sub{font-size:13px;fill:#9fb1c5}.team-title{font-size:23px;font-weight:900}.team-meta{font-size:13px;fill:#c5d2e0}.head{font-size:11px;font-weight:900;fill:#8fa4ba}.cell{font-size:13px;fill:#e8f0fa}.name{font-size:14px;font-weight:800;fill:#ffffff}.muted{font-size:11px;fill:#8498ae}]]></style>");
  svg.push('</defs>');
  svg.push('<rect width="1600" height="' + layout.height + '" fill="url(#reportBg)"/>');
  svg.push('<path d="M38 24 H1518 L1562 68 V88 H38 Z" fill="url(#reportTitle)" stroke="#5e7997" stroke-opacity=".38"/>');
  svg.push('<text x="64" y="58" class="report-title">MATCH END / 全员战绩报告</text>');
  svg.push('<text x="64" y="80" class="report-sub">' + xmlEscape(layout.map) + ' → ' + xmlEscape(layout.nextMap) + ' · ' + xmlEscape(formatDateTimeLocal(layout.capturedAt)) + (layout.winner ? ' · WINNER ' + xmlEscape(layout.winner) : '') + '</text>');

  for (const section of layout.sections) {
    const x = 38;
    const width = 1524;
    const headerY = section.y;
    svg.push('<path d="M' + x + ' ' + headerY + ' H' + (x + width - 24) + ' L' + (x + width) + ' ' + (headerY + 24) + ' V' + (headerY + section.height) + ' H' + x + ' Z" fill="#07101f" stroke="' + section.accent + '" stroke-opacity=".5"/>');
    svg.push('<rect x="' + x + '" y="' + headerY + '" width="8" height="' + section.height + '" fill="' + section.accent + '" opacity=".9"/>');
    svg.push('<text x="64" y="' + (headerY + 31) + '" class="team-title">TEAM ' + xmlEscape(String(section.teamID ?? "?")) + ' · ' + xmlEscape(truncateText(section.teamName, 58)) + '</text>');
    svg.push('<text x="64" y="' + (headerY + 54) + '" class="team-meta">人数 ' + section.playerCount + ' · 指挥官 ' + xmlEscape(section.commander) + '</text>');
    svg.push(renderMatchEndColumnHeaders(headerY + 76));
    if (!section.players.length) {
      svg.push('<text x="64" y="' + (headerY + 108) + '" class="muted">该队伍没有保存到玩家记录</text>');
      continue;
    }
    section.players.forEach((player, index) => {
      const rowY = headerY + 82 + index * 38;
      const core = player?.bzssCore ?? {};
      if (index % 2 === 0) svg.push('<rect x="48" y="' + rowY + '" width="1502" height="38" fill="#ffffff" opacity=".025"/>');
      svg.push('<text x="64" y="' + (rowY + 24) + '" class="name">' + xmlEscape(truncateText(player.name, 26)) + '</text>');
      svg.push('<text x="330" y="' + (rowY + 24) + '" class="cell">' + xmlEscape(truncateText(player.squadName, 16)) + '</text>');
      svg.push('<text x="480" y="' + (rowY + 24) + '" class="cell">' + xmlEscape(truncateText(firstText(player.role, core.soldierClass, "-"), 17)) + '</text>');
      const values = [
        core.kills, core.downs, core.deaths, core.teamKills, core.vehicleKills,
        core.revives, core.healPoints, core.combatScore, core.objectiveScore,
        core.teamworkScore, core.ping,
      ];
      const xs = [672, 724, 776, 832, 892, 954, 1022, 1102, 1192, 1282, 1374];
      values.forEach((value, valueIndex) => {
        const label = value == null || value === "" ? "-" : String(Math.round(Number(value) || 0));
        svg.push('<text x="' + xs[valueIndex] + '" y="' + (rowY + 24) + '" text-anchor="middle" class="cell mono">' + xmlEscape(label) + '</text>');
      });
      const health = firstFiniteNumber(player?.health, core.health);
      svg.push('<text x="1468" y="' + (rowY + 24) + '" text-anchor="middle" class="cell mono">' + (health == null ? "-" : xmlEscape(String(Math.round(health)))) + '</text>');
    });
  }

  svg.push('<text x="800" y="' + (layout.height - 18) + '" text-anchor="middle" class="muted">BZSS PANEL · MATCH END SNAPSHOT · DATA FROZEN AT MATCH END</text>');
  svg.push('</svg>');
  return svg.join("\n");
}

function renderMatchEndColumnHeaders(y) {
  const columns = [
    [64, "玩家"], [330, "小队"], [480, "ROLE"], [672, "K"], [724, "W"],
    [776, "D"], [832, "TK"], [892, "载具"], [954, "复苏"], [1022, "治疗"],
    [1102, "战斗"], [1192, "目标"], [1282, "团队"], [1374, "延迟"], [1468, "生命"],
  ];
  return columns.map(([x, label], index) =>
    '<text x="' + x + '" y="' + y + '"' + (index >= 3 ? ' text-anchor="middle"' : '') + ' class="head">' + xmlEscape(label) + '</text>'
  ).join("");
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
