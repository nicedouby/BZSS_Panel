import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { FIRETEAM_COLORS, fireTeamRank, resolveSnapshotPlayerFireTeam } from "./match-end-snapshot-fireteam.js";

const WIDTH = 3200;
const HEIGHT = 1800;
const BASE_WIDTH = 1600;
const BASE_HEIGHT = 900;
const TEAM_COLUMN_WIDTH = 775;
const TEAM_CONTENT_TOP = 220;
const TEAM_CONTENT_BOTTOM = 844;
const TEAM_LANE_GAP = 8;
const TEAM_LANE_WIDTH = Math.floor((TEAM_COLUMN_WIDTH - 20 - TEAM_LANE_GAP) / 2);
const TEAM_LANE_HEADER_HEIGHT = 18;
const TEAM_LANE_HEADER_GAP = 4;
const SQUAD_HEADER_HEIGHT = 16;
const SQUAD_GAP = 4;
const DEFAULT_PLAYER_ROW_HEIGHT = 20;
const MIN_PLAYER_ROW_HEIGHT = 12;
const PLAYER_STAT_COLUMNS = Object.freeze([
  { key: "kills", label: "K", width: 16, tone: "#e8f4ff" },
  { key: "downs", label: "W", width: 16, tone: "#d8ecff" },
  { key: "deaths", label: "D", width: 16, tone: "#ff7c87" },
  { key: "teamKills", label: "TK", width: 19, tone: "#ff9b75" },
  { key: "vehicleKills", label: "VK", width: 20, tone: "#f8bd55" },
  { key: "revives", label: "R", width: 16, tone: "#52e79b" },
  { key: "healPoints", label: "H", width: 20, tone: "#67e8f9" },
  { key: "combatScore", label: "C", width: 20, tone: "#7dd3fc" },
  { key: "objectiveScore", label: "O", width: 20, tone: "#93c5fd" },
  { key: "teamworkScore", label: "T", width: 20, tone: "#a5b4fc" },
  { key: "ping", label: "P", width: 25, tone: "#cbd5e1" },
]);

const SHARP_BUNDLE_ROOT = "C:/Users/12703/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const sharpRequire = createRequire(import.meta.url);
let sharpLoaderPromise = null;

const MAP_SCENE_FILE_BY_KEY = {
  AlBasrah: "LoadingScreen_AlBasrah_DQHD.PNG",
  Anvil: "LoadingScreen_Anvil_DQHD.PNG",
  Belaya_Pass: "LoadingScreen_Belaya_Pass_DQHD.PNG",
  BlackCoast: "LoadingScreen_BlackCoast_DQHD.PNG",
  Chora: "LoadingScreen_Chora_DQHD.PNG",
  Fallujah: "LoadingScreen_Fallujah_DQHD.PNG",
  FoolsRoad: "LoadingScreen_FoolsRoad_DQHD.PNG",
  GooseBay: "LoadingScreen_GooseBay_DQHD.PNG",
  Gorodok: "LoadingScreen_Gorodok_DQHD.PNG",
  Harju: "LoadingScreen_Harju_DQHD.PNG",
  JensensRange: "LoadingScreen_JensensRange_DQHD.PNG",
  Kamdesh: "LoadingScreen_Kamdesh_DQHD.PNG",
  Kohat: "LoadingScreen_Kohat_DQHD.PNG",
  Kokan: "LoadingScreen_Kokan_DQHD.PNG",
  Lashkar: "LoadingScreen_Lashkar_DQHD.PNG",
  Manicouagan: "LoadingScreen_Manicouagan_DQHD.PNG",
  Mestia: "LoadingScreen_Mestia_DQHD.PNG",
  Mutaha: "LoadingScreen_Mutaha_DQHD.PNG",
  Narva: "LoadingScreen_Narva_DQHD.PNG",
  PacificProvingGrounds: "LoadingScreen_PacificProvingGrounds_DQHD.PNG",
  Sanxian: "LoadingScreen_Sanxian_DQHD.PNG",
  Skorpo: "LoadingScreen_Skorpo_DQHD.PNG",
  Sumari: "LoadingScreen_Sumari_DQHD.PNG",
  Tallil: "LoadingScreen_Tallil_DQHD.PNG",
  Yehorivka: "LoadingScreen_Yehorivka_DQHD.PNG",
};

const MAP_MINIMAP_EXTENSIONS = [".PNG", ".png", ".JPG", ".jpg", ".JPEG", ".jpeg"];

const FACTION_FLAG_FILES = Object.freeze({
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
});
const FACTION_CODES_BY_LENGTH = Object.keys(FACTION_FLAG_FILES).sort((left, right) => right.length - left.length);
const FACTION_NAME_ALIASES = Object.freeze({
  peoplesliberationarmynavymarinecorps: "PLANMC",
  peoplesliberationarmyairforce: "PLAAGF",
  unitedstatesmarinecorps: "USMC",
  russianairborneforces: "VDV",
  australiandefenceforce: "ADF",
  canadianarmedforces: "CAF",
  britisharmedforces: "BAF",
  peoplesliberationarmy: "PLA",
  unitedstatesarmy: "USA",
  russiangroundforces: "RGF",
  middleeasternalliance: "MEA",
  turkishlandforces: "TLF",
});

const TEAM_ACCENTS = {
  1: "#37c8ff",
  2: "#ef3b4f",
};

const ROLE_META = [
  { patterns: ["squadleader", "leader", "sl"], label: "SL", tone: "#f6c453" },
  { patterns: ["commander", "cmd"], label: "CO", tone: "#facc15" },
  { patterns: ["medic"], label: "MED", tone: "#45d483" },
  { patterns: ["heavyantitank", "hat"], label: "HAT", tone: "#ef6464" },
  { patterns: ["lightantitank", "lat"], label: "LAT", tone: "#ff8a45" },
  { patterns: ["machinegunner", "mg"], label: "MG", tone: "#a78bfa" },
  { patterns: ["automaticrifleman", "ar"], label: "AR", tone: "#8b5cf6" },
  { patterns: ["combatengineer", "engineer"], label: "ENG", tone: "#eab308" },
  { patterns: ["marksman", "dmr"], label: "DMR", tone: "#22d3ee" },
  { patterns: ["sniper"], label: "SNP", tone: "#06b6d4" },
  { patterns: ["grenadier"], label: "GRN", tone: "#38bdf8" },
  { patterns: ["crewman", "crew"], label: "CRW", tone: "#94a3b8" },
  { patterns: ["pilot"], label: "PLT", tone: "#60a5fa" },
  { patterns: ["rifleman"], label: "RFL", tone: "#7dd3fc" },
];

export async function generateMatchEndSnapshotBundle(payload, options = {}) {
  const snapshotId = sanitizeFileToken(options.snapshotId || "match");
  const buffer = await generateMatchEndOverviewPng(payload);
  const sharp = await loadSharp();
  const thumbnailBuffer = await sharp(buffer)
    .resize(640, 360, { fit: "cover", position: "centre" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const playerCount = Number(payload?.summary?.recordedPlayerCount ?? payload?.players?.length ?? 0);
  const page = {
    index: 0,
    type: "match-status-scoreboard",
    teamId: null,
    teamPage: null,
    teamPageCount: null,
    fileName: `${snapshotId}-00-scoreboard.png`,
    width: WIDTH,
    height: HEIGHT,
    playerCount,
    buffer,
  };
  const manifest = {
    schemaVersion: 1,
    snapshotId,
    generatedAt: new Date().toISOString(),
    sourceCapturedAt: String(payload?.capturedAt ?? ""),
    width: WIDTH,
    height: HEIGHT,
    pageCount: 1,
    primaryImage: `${snapshotId}.png`,
    combinedImage: `${snapshotId}-combined.png`,
    thumbnailImage: `${snapshotId}-thumb.png`,
    pages: [{ ...page, buffer: undefined }],
  };
  delete manifest.pages[0].buffer;
  return {
    width: WIDTH,
    height: HEIGHT,
    pages: [page],
    combinedBuffer: buffer,
    thumbnailBuffer,
    manifest,
  };
}

export async function generateMatchEndOverviewPng(payload) {
  const sharp = await loadSharp();
  const model = buildMatchEndOverviewModel(payload);
  await attachRoleIconData(model);
  await attachTeamVisuals(model);
  await attachMapMinimapData(model, payload);
  const background = await buildBackground(sharp, payload);
  const overlay = Buffer.from(renderOverviewSvg(model), "utf8");
  return sharp(background)
    .composite([{ input: overlay }])
    .png()
    .toBuffer();
}

export function buildMatchEndOverviewModel(payload) {
  const teams = buildTeams(payload);
  const mapTitle = firstText(payload?.match?.map, payload?.match?.layer, "Unknown Map");
  const layerTitle = firstText(payload?.match?.layer, "-");
  const modeTitle = firstText(payload?.match?.mode, "-");
  const nextLayer = firstText(payload?.match?.nextLayer, payload?.match?.nextMap, "-");
  const serverName = firstText(payload?.server?.serverName, payload?.server?.serverId, "BZSS Server");
  const capturedAt = formatDateTime(payload?.capturedAt);
  const playerCount = Number(payload?.summary?.recordedPlayerCount ?? payload?.players?.length ?? payload?.server?.playerCount ?? 0);
  const queueCount = Number(payload?.server?.queueCount ?? 0);
  const playtime = formatDuration(payload?.match?.playtime);

  return {
    width: WIDTH,
    height: HEIGHT,
    mapTitle,
    layerTitle,
    modeTitle,
    nextLayer,
    serverName,
    capturedAt,
    playerCount,
    queueCount,
    playtime,
    teams: [
      buildTeamColumnModel(teams.find((team) => team.teamID === 1) ?? emptyTeam(1), 24),
      buildTeamColumnModel(teams.find((team) => team.teamID === 2) ?? emptyTeam(2), 801),
    ],
  };
}

function buildTeams(payload) {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  const squads = Array.isArray(payload?.squads) ? payload.squads : [];
  const teamIds = new Set([1, 2]);

  for (const player of players) {
    const teamID = nullableNumber(player?.teamID ?? player?.teamId);
    if (teamID != null) teamIds.add(teamID);
  }
  for (const squad of squads) {
    const teamID = nullableNumber(squad?.teamID ?? squad?.teamId);
    if (teamID != null) teamIds.add(teamID);
  }

  return [...teamIds].sort((left, right) => left - right).map((teamID) => {
    const teamPlayers = players.filter((player) => Number(player?.teamID ?? player?.teamId) === teamID);
    const teamSquads = squads.filter((squad) => Number(squad?.teamID ?? squad?.teamId) === teamID);
    const teamName = firstText(
      teamSquads.find((squad) => firstText(squad?.teamName))?.teamName,
      teamPlayers.find((player) => firstText(player?.squadInfo?.teamName))?.squadInfo?.teamName,
      `Team ${teamID}`,
    );
    const groups = buildSquadGroups(teamPlayers, teamSquads);
    const commander = teamPlayers.find((player) => Boolean(player?.isCommander))
      ?? teamPlayers.find((player) => Boolean(player?.isLeader) && isCommandSquad(player?.squadInfo?.name))
      ?? groups.find((group) => group.isCommandSquad)?.players?.find((player) => Boolean(player?.isLeader))
      ?? null;

    const pings = teamPlayers.map(readPing).filter((value) => value != null);
    const averagePing = pings.length
      ? Math.round(pings.reduce((sum, value) => sum + value, 0) / pings.length)
      : null;

    return {
      teamID,
      teamName,
      accent: TEAM_ACCENTS[teamID] ?? "#60a5fa",
      factionId: firstText(payload?.match?.factionIds?.[`team${teamID}`], payload?.match?.factionIds?.[String(teamID)], teamSquads.find((squad) => firstText(squad?.factionId))?.factionId),
      factionCode: resolveFactionCode(
        payload?.match?.factionIds?.[`team${teamID}`],
        payload?.match?.factionIds?.[String(teamID)],
        teamSquads.find((squad) => firstText(squad?.factionCode, squad?.faction))?.factionCode,
        teamSquads.find((squad) => firstText(squad?.faction))?.faction,
        teamPlayers.find((player) => firstText(player?.factionCode, player?.faction))?.factionCode,
        teamPlayers.find((player) => firstText(player?.faction))?.faction,
        teamName,
      ),
      playerCount: teamPlayers.length,
      squadCount: groups.filter((group) => group.squadID != null).length,
      averagePing,
      tickets: readTeamTickets(payload, teamID),
      combatTotals: sumTeamPlayerCombatStats(teamPlayers),
      commanderName: firstText(commander?.name, ""),
      commanderPlayer: commander,
      groups,
    };
  });
}

function buildSquadGroups(players, squads) {
  const squadMap = new Map();

  for (const squad of squads) {
    const squadID = nullableNumber(squad?.squadID ?? squad?.squadId);
    const key = squadKey(squadID);
    squadMap.set(key, {
      squadID,
      squadName: firstText(squad?.squadName, squad?.name, squadID == null ? "未加入小队" : `Squad ${squadID}`),
      creatorName: firstText(squad?.creatorName, squad?.creator?.name, squad?.creator, squad?.createdBy, squad?.ownerName),
      locked: Boolean(squad?.locked),
      isCommandSquad: isCommandSquad(firstText(squad?.squadName, squad?.name)),
      players: [],
    });
  }

  for (const player of players) {
    const squadID = nullableNumber(player?.squadID ?? player?.squadId);
    const key = squadKey(squadID);
    if (!squadMap.has(key)) {
      squadMap.set(key, {
        squadID,
        squadName: firstText(player?.squadInfo?.name, squadID == null ? "未加入小队" : `Squad ${squadID}`),
        creatorName: firstText(player?.squadInfo?.creatorName, player?.squadInfo?.creator?.name, player?.squadInfo?.creator, player?.squadInfo?.createdBy),
        locked: Boolean(player?.squadInfo?.locked),
        isCommandSquad: isCommandSquad(firstText(player?.squadInfo?.name)),
        players: [],
      });
    }
    squadMap.get(key).players.push(player);
  }

  const groups = [...squadMap.values()]
    .filter((group) => group.players.length > 0)
    .map((group) => ({
      ...group,
      players: [...group.players].sort(comparePlayers),
    }))
    .sort((left, right) =>
      Number(right.isCommandSquad) - Number(left.isCommandSquad)
      || compareNullableNumbers(left.squadID, right.squadID)
      || String(left.squadName).localeCompare(String(right.squadName), "zh-CN", { numeric: true }),
    );

  return groups;
}

function buildTeamColumnModel(team, x) {
  const laneHeaderTop = TEAM_CONTENT_TOP;
  const contentTop = laneHeaderTop + TEAM_LANE_HEADER_HEIGHT + TEAM_LANE_HEADER_GAP;
  const availableHeight = TEAM_CONTENT_BOTTOM - contentTop;
  const lanes = [[], []];
  const laneWeights = [0, 0];

  for (const group of team.groups) {
    const targetLane = laneWeights[0] <= laneWeights[1] ? 0 : 1;
    lanes[targetLane].push(group);
    laneWeights[targetLane] += SQUAD_HEADER_HEIGHT + SQUAD_GAP + group.players.length * DEFAULT_PLAYER_ROW_HEIGHT;
  }

  const laneFixedWeights = lanes.map((groups) =>
    groups.reduce((sum, group) => sum + SQUAD_HEADER_HEIGHT + SQUAD_GAP, 0)
  );
  const lanePlayerCounts = lanes.map((groups) =>
    groups.reduce((sum, group) => sum + group.players.length, 0)
  );
  const tallestLane = laneFixedWeights
    .map((fixed, index) => fixed + lanePlayerCounts[index] * DEFAULT_PLAYER_ROW_HEIGHT)
    .indexOf(Math.max(...laneFixedWeights.map((fixed, index) => fixed + lanePlayerCounts[index] * DEFAULT_PLAYER_ROW_HEIGHT), 1));
  const fixedWeight = laneFixedWeights[tallestLane] ?? 0;
  const playerCountInTallestLane = Math.max(lanePlayerCounts[tallestLane] ?? 0, 1);
  const rowHeight = Math.max(
    MIN_PLAYER_ROW_HEIGHT,
    Math.min(DEFAULT_PLAYER_ROW_HEIGHT, Math.floor((availableHeight - fixedWeight) / playerCountInTallestLane)),
  );

  return {
    ...team,
    x,
    width: TEAM_COLUMN_WIDTH,
    laneHeaderTop,
    contentTop,
    contentBottom: TEAM_CONTENT_BOTTOM,
    laneWidth: TEAM_LANE_WIDTH,
    laneGap: TEAM_LANE_GAP,
    rowHeight,
    lanes,
  };
}

async function attachRoleIconData(model) {
  const players = [];
  for (const team of model.teams ?? []) {
    for (const lane of team.lanes ?? []) {
      for (const group of lane) players.push(...(group.players ?? []));
    }
  }
  await Promise.all(players.map(async (player) => {
    const role = resolveRoleMeta(firstText(player?.role, player?.bzssCore?.soldierClass));
    const fileName = roleIconFileName(role.label);
    if (!fileName) return;
    const candidates = [
      path.resolve(process.cwd(), "web-client", "public", "assets", "icons", fileName),
      path.resolve(process.cwd(), "web-client", "public", "Icon", fileName),
    ];
    const candidate = candidates.find((item) => existsSync(item));
    if (!candidate) return;
    try {
      player.roleIconData = `data:image/png;base64,${(await fs.readFile(candidate)).toString("base64")}`;
    } catch {}
  }));
}

function roleIconFileName(label) {
  const key = normalizeToken(label);
  const files = {
    sl: "T_role_squadleader.PNG", "squadleader": "T_role_squadleader.PNG",
    med: "T_role_medic.PNG", "hat": "T_role_heavyantitank.PNG", "lat": "T_role_lightantitank.PNG",
    mg: "T_role_machinegunner.PNG", "ar": "T_role_automaticrifleman.PNG", "eng": "T_role_engineer.PNG",
    dmr: "T_role_designatedmarksman.PNG", "snp": "T_role_sniper.PNG", "grn": "T_role_grenadier.PNG",
    crw: "T_role_crewman.PNG", "plt": "T_role_pilot.PNG", "rfl:": "T_role_rifleman.PNG", "rfl": "T_role_rifleman.PNG",
  };
  return files[key] ?? "T_role_rifleman.PNG";
}

async function attachMapMinimapData(model, payload) {
  const candidate = resolveMinimapPath(payload);
  if (!candidate) return;
  try {
    // Minimap source files can be tens of megabytes. Never embed the original
    // file in the SVG: libxml2 (used by Sharp) rejects oversized XML buffers.
    const sharp = await loadSharp();
    const buffer = await sharp(candidate)
      .resize(160, 160, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    model.minimapData = `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {}
}

function resolveMinimapPath(payload) {
  const key = resolveMapKey(firstText(payload?.match?.layer, payload?.match?.map));
  const candidates = [];
  for (const extension of MAP_MINIMAP_EXTENSIONS) {
    candidates.push(path.resolve(process.cwd(), "web-client", "public", `${key}_Minimap${extension}`));
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}

const localAssetSearchCache = new Map();

async function resolveLocalFactionAsset(fileName, factionCode) {
  const key = String(factionCode || fileName || "").toLowerCase();
  if (localAssetSearchCache.has(key)) return localAssetSearchCache.get(key);
  const directCandidates = [
    path.resolve(process.cwd(), "web-client", "public", fileName),
    path.resolve(process.cwd(), "web-client", "public", `${String(factionCode ?? "").trim()}.PNG`),
    path.resolve(process.cwd(), "web-client", "public", `${String(factionCode ?? "").trim()}.png`),
    path.resolve(process.cwd(), "web-client", "public", "assets", "faction-assets", fileName),
    path.resolve(process.cwd(), "web-client", "public", "assets", "flags", fileName),
    path.resolve(process.cwd(), "web-client", "public", "assets", "factions", fileName),
    path.resolve(process.cwd(), "web-client", "src", "shared", "faction-assets", fileName),
    path.resolve(process.cwd(), "web-client", "src", "assets", fileName),
  ];
  let found = directCandidates.find((item) => existsSync(item)) ?? "";
  if (!found) {
    const roots = [
      path.resolve(process.cwd(), "web-client", "public"),
      path.resolve(process.cwd(), "web-client", "src"),
    ];
    const wanted = new Set([
      fileName.toLowerCase(),
      `flag_${String(factionCode).toLowerCase()}.png`,
      `faction_${String(factionCode).toLowerCase()}.png`,
      `t_faction_${String(factionCode).toLowerCase()}.png`,
    ]);
    for (const root of roots) {
      try {
        const entries = await fs.readdir(root, { recursive: true });
        const match = entries.find((entry) => wanted.has(path.basename(String(entry)).toLowerCase()));
        if (match) {
          found = path.join(root, String(match));
          break;
        }
      } catch {}
    }
  }
  localAssetSearchCache.set(key, found);
  return found;
}

function readTeamTickets(payload, teamID) {
  const values = [
    payload?.match?.teamTickets,
    payload?.match?.tickets,
    payload?.summary?.teamTickets,
    payload?.summary?.tickets,
    payload?.tickets,
  ];
  for (const source of values) {
    const value = readTicketValue(source, teamID);
    if (value != null) return value;
  }
  return null;
}

function sumTeamPlayerCombatStats(players) {
  const totals = {
    deaths: 0,
    revives: 0,
    teamKills: 0,
    source: "players",
  };
  for (const player of players) {
    const core = player?.bzssCore ?? {};
    const scoreboard = player?.playerScoreboard?.stats ?? {};
    totals.deaths += readNonNegativeStat(
      core.deaths,
      core.numDeaths,
      scoreboard.numDeaths,
      player?.deaths,
      player?.death,
    );
    totals.revives += readNonNegativeStat(
      core.revives,
      core.revivedPoints,
      scoreboard.revivedPoints,
      player?.revives,
      player?.revivedPoints,
    );
    totals.teamKills += readNonNegativeStat(
      core.teamKills,
      core.tk,
      core.numTeamKills,
      scoreboard.numTeamKills,
      player?.teamKills,
      player?.tk,
    );
  }
  return totals;
}

function readNonNegativeStat(...values) {
  const value = firstFiniteNumber(...values);
  return value == null ? 0 : Math.max(0, Math.round(value));
}

function readTicketValue(source, teamID) {
  if (source == null) return null;
  if (Array.isArray(source)) {
    for (const item of source) {
      const itemTeam = nullableNumber(item?.teamID ?? item?.teamId ?? item?.id);
      if (itemTeam === teamID) {
        return firstFiniteNumber(item?.tickets, item?.ticket, item?.value, item?.count);
      }
    }
    return firstFiniteNumber(source[teamID - 1]);
  }
  if (typeof source === "object") {
    const keys = [String(teamID), `team${teamID}`, `team_${teamID}`, `team${teamID}Tickets`, `team${teamID}tickets`];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const value = source[key];
        return typeof value === "object"
          ? firstFiniteNumber(value?.tickets, value?.ticket, value?.value, value?.count)
          : firstFiniteNumber(value);
      }
    }
  }
  return null;
}

function resolveFactionCode(...values) {
  for (const value of values) {
    const normalized = normalizeToken(value).toUpperCase();
    if (!normalized) continue;
    const normalizedLower = normalized.toLowerCase();
    const namedAlias = Object.entries(FACTION_NAME_ALIASES)
      .find(([name]) => normalizedLower.includes(name))?.[1];
    if (namedAlias) return namedAlias;
    const exact = FACTION_CODES_BY_LENGTH.find((code) => normalized === code);
    if (exact) return exact;
    const embedded = FACTION_CODES_BY_LENGTH.find((code) => normalized.includes(code));
    if (embedded) return embedded;
  }
  return "";
}

function colorToHex(color, fallback = "#d8f3ff") {
  if (!color) return fallback;
  const channels = [color.r, color.g, color.b].map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))));
  const brightest = Math.max(...channels);
  const lifted = brightest < 96
    ? channels.map((value) => Math.min(255, Math.round(value + (96 - brightest) * 0.82)))
    : channels;
  return `#${lifted.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function attachTeamVisuals(model) {
  const sharp = await loadSharp();
  for (const team of model.teams ?? []) {
    const code = resolveFactionCode(team.factionId, team.factionCode, team.teamName);
    const file = FACTION_FLAG_FILES[code];
    if (file) {
      const found = await resolveLocalFactionAsset(file, code);
      if (found) {
        try {
          const normalizedFlag = await sharp(found)
            .resize(168, 88, { fit: "inside", withoutEnlargement: true })
            .png()
            .toBuffer();
          team.flagData = `data:image/png;base64,${normalizedFlag.toString("base64")}`;
        } catch {}
      }
    }

    const commander = team.commanderPlayer ?? {};
    const avatar = commander.avatarUrl ?? commander.avatar ?? commander.steamAvatar ?? commander.steamAvatarUrl ?? commander.steam_avatar ?? commander.avatar_full ?? commander.avatar_medium ?? commander.steamProfile?.avatar ?? commander.steamProfile?.avatar_full ?? commander.steam?.avatar ?? commander.profile?.avatar ?? "";
    if (typeof avatar === "string" && avatar.startsWith("http")) {
      try {
        const response = await fetch(avatar);
        if (!response.ok) continue;
        const avatarBuffer = await sharp(Buffer.from(await response.arrayBuffer()))
          .resize(96, 96, { fit: "cover", position: "centre" })
          .png()
          .toBuffer();
        const stats = await sharp(avatarBuffer).stats();
        team.commanderAvatarData = `data:image/png;base64,${avatarBuffer.toString("base64")}`;
        team.commanderGlowColor = colorToHex(stats?.dominant, team.accent);
      } catch {}
    }
  }
}

export function renderOverviewSvg(model) {
  const svg = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`);
  svg.push(renderDefs());
  svg.push('<g transform="scale(2)">');
  svg.push('<rect width="1600" height="900" fill="url(#pageShade)"/>');

  svg.push('<path d="M36 32 H1112 L1162 68 H1564 V126 H36 Z" fill="url(#headerPlate)" stroke="#dce9f7" stroke-opacity=".22"/>');
  if (model.minimapData) svg.push(`<image href="${model.minimapData}" x="48" y="45" width="148" height="66" preserveAspectRatio="xMidYMid meet" opacity=".94"/>`);
  svg.push('<text x="220" y="58" class="eyebrow">BZSS PANEL / MATCH END OVERVIEW</text>');
  svg.push(`<text x="220" y="86" class="hero-title">${escapeXml(model.mapTitle)}</text>`);
  svg.push(`<text x="222" y="105" class="hero-sub">${escapeXml(model.layerTitle)} · ${escapeXml(model.modeTitle)} · NEXT ${escapeXml(model.nextLayer)}</text>`);
  svg.push(renderGlobalMatchMetrics(model));
  svg.push(`<text x="1530" y="39" text-anchor="end" class="meta mono">${escapeXml(model.capturedAt)}</text>`);
  svg.push(renderServerBattleStrip(model));

  for (const team of model.teams) {
    svg.push(renderTeamColumn(team));
  }

  svg.push('<text x="48" y="880" class="footer">K 击杀 · W 击倒 · D 死亡 · TK 友军击杀 · VK 载具击杀 · R 复苏 · H 治疗 · C 战斗分 · O 目标分 · T 团队分 · P 延迟</text>');
  svg.push("</g>");
  svg.push("</svg>");
  return svg.join("");
}

function renderServerBattleStrip(model) {
  const team1 = model.teams.find((team) => team.teamID === 1) ?? emptyTeam(1);
  const team2 = model.teams.find((team) => team.teamID === 2) ?? emptyTeam(2);
  return [
    renderTeamCombatPanel(team1, 888, "left"),
    renderTeamCombatPanel(team2, 1213, "right"),
  ].join("");
}

function renderGlobalMatchMetrics(model) {
  return [
    `<text x="222" y="122" class="global-server">${escapeXml(clip(model.serverName, 42))}</text>`,
    '<circle cx="544" cy="118.5" r="2.5" fill="#37c8ff"/>',
    '<text x="553" y="122" class="global-metric-label">PLAYERS</text>',
    `<text x="607" y="122" class="global-metric-value mono">${escapeXml(String(model.playerCount))}</text>`,
    '<circle cx="650" cy="118.5" r="2.5" fill="#f8bd55"/>',
    '<text x="659" y="122" class="global-metric-label">QUEUE</text>',
    `<text x="702" y="122" class="global-metric-value mono">${escapeXml(String(model.queueCount))}</text>`,
    '<circle cx="744" cy="118.5" r="2.5" fill="#52e79b"/>',
    '<text x="753" y="122" class="global-metric-label">TIME</text>',
    `<text x="788" y="122" class="global-metric-value mono">${escapeXml(model.playtime)}</text>`,
  ].join("");
}

function renderTeamCombatPanel(team, x, side) {
  const isRight = side === "right";
  const panelPath = side === "right"
    ? `M${x + 10} 48 H${x + 315} V128 H${x} V58 Z`
    : `M${x} 48 H${x + 305} L${x + 315} 58 V128 H${x} Z`;
  const flagX = isRight ? x + 251 : x + 12;
  const textX = isRight ? x + 241 : x + 74;
  const textAnchor = isRight ? "end" : "start";
  const dividerX = isRight ? x + 158 : x + 157;
  const statCenters = isRight
    ? [x + 27, x + 79, x + 131]
    : [x + 184, x + 236, x + 288];
  const ticket = team.tickets == null ? "--" : String(team.tickets);
  const factionLabel = firstText(team.factionCode, team.factionId, `TEAM ${team.teamID}`);
  const totals = team.combatTotals ?? { deaths: 0, revives: 0, teamKills: 0 };
  const flag = team.flagData
    ? `<image href="${team.flagData}" x="${flagX}" y="56" width="52" height="29" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="${flagX + 26}" y="74" text-anchor="middle" class="ticket-flag-fallback">${escapeXml(clip(factionLabel, 8))}</text>`;
  return [
    `<path d="${panelPath}" fill="url(#team${team.teamID}TicketPanel)" stroke="${team.accent}" stroke-opacity=".68"/>`,
    `<path d="M${x + (isRight ? 314 : 1)} 57 V119" stroke="${team.accent}" stroke-width="3" stroke-linecap="round"/>`,
    `<path d="M${x + 12} 122 H${x + 303}" stroke="${team.accent}" stroke-opacity=".46"/>`,
    `<path d="M${dividerX} 57 V118" stroke="${team.accent}" stroke-opacity=".28"/>`,
    flag,
    `<text x="${textX}" y="65" text-anchor="${textAnchor}" class="ticket-team">TEAM ${team.teamID} · ${escapeXml(clip(factionLabel, 12))}</text>`,
    `<text x="${textX}" y="83" text-anchor="${textAnchor}" class="ticket-label">TICKETS</text>`,
    `<text x="${textX}" y="113" text-anchor="${textAnchor}" class="ticket-value mono" fill="${team.accent}">${escapeXml(ticket)}</text>`,
    renderBattleStat("DEATHS", totals.deaths, statCenters[0], "#ff6b76"),
    renderBattleStat("REVIVES", totals.revives, statCenters[1], "#52e79b"),
    renderBattleStat("TK", totals.teamKills, statCenters[2], "#f8bd55"),
  ].join("");
}

function renderBattleStat(label, value, centerX, color) {
  return [
    `<text x="${centerX}" y="78" text-anchor="middle" class="battle-stat-label">${escapeXml(label)}</text>`,
    `<text x="${centerX}" y="108" text-anchor="middle" class="battle-stat-value mono" fill="${color}">${escapeXml(String(value ?? 0))}</text>`,
  ].join("");
}

function renderTeamColumn(team) {
  const svg = [];
  const x = team.x;
  const y = 158;
  const headerHeight = 58;

  svg.push(`<rect x="${x}" y="${y}" width="${team.width}" height="${TEAM_CONTENT_BOTTOM - y + 8}" rx="12" fill="#030b18" fill-opacity=".46" stroke="${team.accent}" stroke-opacity=".34"/>`);
  svg.push(`<rect x="${x + 8}" y="${y + 8}" width="${team.width - 16}" height="${headerHeight - 8}" rx="9" fill="#071426" fill-opacity=".58" stroke="${team.accent}" stroke-opacity=".42"/>`);
  svg.push(`<rect x="${x + 8}" y="${y + 8}" width="5" height="${headerHeight - 8}" rx="2" fill="${team.accent}"/>`);

  svg.push(`<text x="${x + 28}" y="${y + 31}" class="team-title">TEAM ${team.teamID} · ${escapeXml(clip(team.teamName, 38))}</text>`);
  svg.push(`<text x="${x + 28}" y="${y + 49}" class="team-meta mono">${team.playerCount} PLAYERS · ${team.squadCount} SQUADS · AVG ${team.averagePing == null ? "--" : `${team.averagePing}ms`}</text>`);
  if (team.commanderPlayer) {
    const commanderAvatar = team.commanderAvatarData ?? team.commanderPlayer?.avatarUrl ?? team.commanderPlayer?.avatar ?? team.commanderPlayer?.steamAvatar ?? team.commanderPlayer?.steamAvatarUrl ?? team.commanderPlayer?.steam_avatar ?? team.commanderPlayer?.avatar_full ?? team.commanderPlayer?.avatar_medium ?? team.commanderPlayer?.steamProfile?.avatar ?? team.commanderPlayer?.steamProfile?.avatar_full ?? team.commanderPlayer?.steam?.avatar ?? team.commanderPlayer?.profile?.avatar ?? "";
    const commanderSize = 38;
    const commanderX = x + team.width - commanderSize - 15;
    const commanderY = y + 11;
    const commanderCenterX = commanderX + commanderSize / 2;
    const commanderCenterY = commanderY + commanderSize / 2;
    const commanderClipId = `commander-avatar-${team.teamID}`;
    const commanderGlowColor = team.commanderGlowColor ?? team.accent;
    svg.push(`<defs><clipPath id="${commanderClipId}"><rect x="${commanderX}" y="${commanderY}" width="${commanderSize}" height="${commanderSize}" rx="3"/></clipPath></defs>`);
    svg.push(`<rect x="${commanderX - 1}" y="${commanderY - 1}" width="${commanderSize + 2}" height="${commanderSize + 2}" rx="4" fill="#0b1422" stroke="#eef8ff" stroke-opacity=".24"/>`);
    svg.push(`<text x="${commanderCenterX}" y="${y + 31}" text-anchor="middle" class="commander-initial">${escapeXml(String(team.commanderName || "?").trim().slice(0, 1))}</text>`);
    if (commanderAvatar) {
      // The portrait itself is the light source. Blurred masked copies preserve
      // the avatar's real colors and spread outward from its silhouette.
      svg.push(`<g filter="url(#commanderAvatarDiffuseWide)" opacity=".52"><image href="${escapeXml(commanderAvatar)}" x="${commanderX}" y="${commanderY}" width="${commanderSize}" height="${commanderSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${commanderClipId})"/></g>`);
      svg.push(`<g filter="url(#commanderAvatarDiffuseTight)" opacity=".84"><image href="${escapeXml(commanderAvatar)}" x="${commanderX}" y="${commanderY}" width="${commanderSize}" height="${commanderSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${commanderClipId})"/></g>`);
      svg.push(`<image href="${escapeXml(commanderAvatar)}" x="${commanderX}" y="${commanderY}" width="${commanderSize}" height="${commanderSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${commanderClipId})"/>`);
    }
    svg.push(`<rect x="${commanderX - .5}" y="${commanderY - .5}" width="${commanderSize + 1}" height="${commanderSize + 1}" rx="3.5" fill="none" stroke="${commanderGlowColor}" stroke-width="1.4" stroke-opacity=".92"/>`);
    svg.push(`<path d="M${commanderX + 3} ${commanderY + 1}H${commanderX + commanderSize - 3}" fill="none" stroke="#ffffff" stroke-width="1.25" stroke-linecap="round" stroke-opacity=".56"/>`);
    svg.push(`<text x="${commanderX - 8}" y="${y + 48}" text-anchor="end" class="commander-caption">${escapeXml(clip(team.commanderName, 14))}</text>`);
  }

  const laneXs = [x + 10, x + 10 + team.laneWidth + team.laneGap];
  team.lanes.forEach((groups, laneIndex) => {
    svg.push(renderLaneScoreboardHeader(team, laneXs[laneIndex], team.laneHeaderTop));
    let cursorY = team.contentTop;
    for (const group of groups) {
      svg.push(renderSquadCard(team, group, laneXs[laneIndex], cursorY));
      cursorY += SQUAD_HEADER_HEIGHT + group.players.length * team.rowHeight + SQUAD_GAP;
    }
  });

  return svg.join("");
}

function renderLaneScoreboardHeader(team, x, y) {
  const layout = buildPlayerStatLayout(x, team.laneWidth);
  const svg = [
    `<rect x="${x}" y="${y}" width="${team.laneWidth}" height="${TEAM_LANE_HEADER_HEIGHT}" rx="3" fill="#071426" fill-opacity=".90" stroke="${team.accent}" stroke-opacity=".34"/>`,
    `<rect x="${x}" y="${y}" width="5" height="${TEAM_LANE_HEADER_HEIGHT}" rx="2" fill="${team.accent}"/>`,
    `<text x="${x + 31}" y="${y + 12}" class="scoreboard-header-title">PLAYER</text>`,
    `<path d="M${layout.metricsStart - 3} ${y + 3}V${y + TEAM_LANE_HEADER_HEIGHT - 3}" stroke="${team.accent}" stroke-opacity=".34"/>`,
  ];
  for (const column of layout.columns) {
    svg.push(`<rect x="${column.x + 1}" y="${y + 3}" width="${column.width - 2}" height="${TEAM_LANE_HEADER_HEIGHT - 6}" rx="2" fill="${column.tone}" fill-opacity=".075"/>`);
    svg.push(`<text x="${column.center}" y="${y + 12}" text-anchor="middle" class="scoreboard-header-stat" fill="${column.tone}">${column.label}</text>`);
  }
  return svg.join("");
}

function renderSquadCard(team, group, x, y) {
  const svg = [];
  const height = SQUAD_HEADER_HEIGHT + group.players.length * team.rowHeight;
  const badge = group.locked ? "🔒" : `${group.players.length}/9`;
  const title = `${group.squadID == null ? "-" : `#${group.squadID}`} ${group.squadName}`;
  const creator = firstText(group.creatorName, "-");

  svg.push(`<rect x="${x}" y="${y}" width="${team.laneWidth}" height="${height}" rx="0" fill="#061020" fill-opacity=".62" stroke="#ffffff" stroke-opacity=".10"/>`);
  svg.push(`<path d="M${x} ${y} H${x + team.laneWidth - 12} L${x + team.laneWidth} ${y + 6} V${y + SQUAD_HEADER_HEIGHT} H${x} Z" fill="${team.accent}" fill-opacity=".20" stroke="${team.accent}" stroke-opacity=".42"/>`);
  svg.push(`<rect x="${x}" y="${y}" width="4" height="${SQUAD_HEADER_HEIGHT}" rx="2" fill="${team.accent}" opacity=".90"/>`);
  svg.push(`<text x="${x + 12}" y="${y + 13}" class="squad-title">${escapeXml(clip(title, 28))}</text>`);
  svg.push(`<text x="${x + team.laneWidth - 82}" y="${y + 13}" text-anchor="end" class="squad-meta mono">${escapeXml(clip(creator, 12))}</text>`);
  svg.push(`<text x="${x + team.laneWidth - 10}" y="${y + 13}" text-anchor="end" class="${group.locked ? "squad-locked" : "squad-meta"} mono">${escapeXml(badge)}</text>`);

  group.players.forEach((player, index) => {
    const rowY = y + SQUAD_HEADER_HEIGHT + index * team.rowHeight;
    svg.push(renderPlayerRow(team, player, x, rowY, index));
  });

  return svg.join("");
}

function renderPlayerRow(team, player, x, y, index) {
  const role = resolveRoleMeta(firstText(player?.role, player?.bzssCore?.soldierClass));
  const rowHeight = team.rowHeight;
  const fireTeam = resolveSnapshotPlayerFireTeam(player).fireTeam;
  const backgroundOpacity = index % 2 === 0 ? ".64" : ".48";
  const metrics = buildSnapshotPlayerMetrics(player);
  const layout = buildPlayerStatLayout(x, team.laneWidth);
  const nameClipId = `player-name-${team.teamID}-${Math.round(x)}-${Math.round(y)}`;
  const svg = [
    `<rect x="${x}" y="${y}" width="${team.laneWidth}" height="${rowHeight}" fill="#020817" fill-opacity="${backgroundOpacity}" stroke="#ffffff" stroke-opacity=".035"/>`,
    `<rect x="${x}" y="${y}" width="7" height="${rowHeight}" fill="${fireTeamColor(fireTeam)}" fill-opacity="${fireTeam ? "1" : ".65"}"/>`,
    `<rect x="${x + 7}" y="${y}" width="1" height="${rowHeight}" fill="#ffffff" fill-opacity=".18"/>`,
    `<rect x="${x + 10}" y="${y + 2}" width="16" height="16" rx="2" fill="#081321" stroke="#91a4b8" stroke-opacity=".42"/>`,
    player.roleIconData ? `<image href="${player.roleIconData}" x="${x + 10}" y="${y + 2}" width="16" height="16" opacity=".9" preserveAspectRatio="xMidYMid meet"/>` : "",
    `<defs><clipPath id="${nameClipId}"><rect x="${x + 29}" y="${y}" width="${Math.max(20, layout.metricsStart - x - 34)}" height="${rowHeight}"/></clipPath></defs>`,
    `<text x="${x + 31}" y="${y + rowHeight - 6}" class="player-name" clip-path="url(#${nameClipId})">${escapeXml(firstText(player?.name, "Unknown"))}</text>`,
    `<path d="M${layout.metricsStart - 3} ${y + 2}V${y + rowHeight - 2}" stroke="#ffffff" stroke-opacity=".08"/>`,
  ];
  for (const column of layout.columns) {
    const value = metrics[column.key];
    const color = column.key === "ping" ? pingColor(value === "--" ? null : value) : column.tone;
    svg.push(`<text x="${column.center}" y="${y + rowHeight - 6}" text-anchor="middle" class="player-stat mono" fill="${color}">${escapeXml(String(value))}</text>`);
  }
  return svg.join("");
}

function buildPlayerStatLayout(x, laneWidth) {
  const metricsWidth = PLAYER_STAT_COLUMNS.reduce((sum, column) => sum + column.width, 0);
  const metricsStart = x + laneWidth - metricsWidth;
  let cursor = metricsStart;
  const columns = PLAYER_STAT_COLUMNS.map((column) => {
    const resolved = {
      ...column,
      x: cursor,
      center: cursor + column.width / 2,
    };
    cursor += column.width;
    return resolved;
  });
  return { metricsStart, columns };
}

export function buildSnapshotPlayerMetrics(player) {
  const core = player?.bzssCore ?? {};
  const scoreboard = player?.playerScoreboard?.stats ?? {};
  const ping = readPing(player);
  return {
    kills: readNonNegativeStat(core.kills, core.numKills, scoreboard.numKills, player?.kills),
    downs: readNonNegativeStat(core.downs, core.numWoundeds, scoreboard.numWoundeds, player?.downs, player?.woundeds),
    deaths: readNonNegativeStat(core.deaths, core.numDeaths, scoreboard.numDeaths, player?.deaths),
    teamKills: readNonNegativeStat(core.teamKills, core.tk, core.numTeamKills, scoreboard.numTeamKills, player?.teamKills, player?.tk),
    vehicleKills: readNonNegativeStat(core.vehicleKills, scoreboard.vehicleKills, player?.vehicleKills),
    revives: readNonNegativeStat(core.revives, core.revivedPoints, scoreboard.revivedPoints, player?.revives, player?.revivedPoints),
    healPoints: readRoundedStat(core.healPoints, scoreboard.healPoints, player?.healPoints),
    combatScore: readRoundedStat(core.combatScore, scoreboard.combatScore, player?.combatScore),
    objectiveScore: readRoundedStat(core.objectiveScore, scoreboard.objectiveScore, player?.objectiveScore),
    teamworkScore: readRoundedStat(core.teamworkScore, scoreboard.teamworkScore, player?.teamworkScore),
    ping: ping == null ? "--" : ping,
  };
}

function readRoundedStat(...values) {
  const value = firstFiniteNumber(...values);
  return value == null ? 0 : Math.round(value);
}

function comparePlayers(left, right) {
  return fireTeamRank(left?.fireTeam) - fireTeamRank(right?.fireTeam)
    || Number(Boolean(right?.isCommander)) - Number(Boolean(left?.isCommander))
    || Number(Boolean(right?.isLeader)) - Number(Boolean(left?.isLeader))
    || String(left?.name ?? "").localeCompare(String(right?.name ?? ""), "zh-CN", { numeric: true })
    || compareNullableNumbers(left?.playerID, right?.playerID);
}

function resolveRoleMeta(value) {
  const normalized = normalizeToken(value);
  for (const item of ROLE_META) {
    if (item.patterns.some((pattern) => normalized.includes(normalizeToken(pattern)))) return item;
  }
  return { label: "PLY", tone: "#7dd3fc" };
}

function readHealth(player) {
  const value = firstFiniteNumber(player?.health, player?.bzssCore?.health, player?.soldierInfo?.health);
  if (value == null) return null;
  return Math.max(0, Math.min(100, value));
}

function compactMetric(core, ...keys) {
  for (const key of keys) {
    const value = Number(core?.[key]);
    if (Number.isFinite(value)) return Math.round(value);
  }
  return "-";
}

function fireTeamColor(fireTeam) {
  return FIRETEAM_COLORS[fireTeam] ?? FIRETEAM_COLORS.UNKNOWN;
}

function healthColor(health) {
  if (health == null || health > 70) return "#34d399";
  if (health > 35) return "#facc15";
  return "#fb7185";
}

function pingColor(ping) {
  if (ping == null) return "#94a3b8";
  if (ping < 70) return "#34d399";
  if (ping <= 150) return "#facc15";
  return "#fb7185";
}

function readPing(player) {
  const value = firstFiniteNumber(player?.bzssCore?.ping, player?.bzssCore?.latency, player?.ping, player?.playerScoreboard?.ping);
  if (value == null || value < 0) return null;
  return Math.round(value);
}

async function buildBackground(sharp, payload) {
  const assetPath = resolveLoadingScreenPath(payload);
  if (assetPath) {
    try {
      return await sharp(assetPath)
        .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
        .modulate({ brightness: 0.52, saturation: 0.60 })
        .blur(1.4)
        .png()
        .toBuffer();
    } catch {}
  }

  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: { r: 5, g: 12, b: 24, alpha: 1 },
    },
  }).png().toBuffer();
}

function resolveLoadingScreenPath(payload) {
  const key = resolveMapKey(firstText(payload?.match?.layer, payload?.match?.map));
  const fileName = MAP_SCENE_FILE_BY_KEY[key] ?? MAP_SCENE_FILE_BY_KEY.Sumari;
  const candidates = [
    path.resolve(process.cwd(), "MapScene", fileName),
    path.resolve(process.cwd(), "web-client", "public", "MapScene", fileName),
    path.resolve(process.cwd(), "web-client", "public", fileName),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}

function resolveMapKey(value) {
  const normalized = normalizeToken(value);
  let best = "Sumari";
  let bestLength = 0;
  for (const key of Object.keys(MAP_SCENE_FILE_BY_KEY)) {
    const candidate = normalizeToken(key);
    if (normalized.includes(candidate) && candidate.length > bestLength) {
      best = key;
      bestLength = candidate.length;
    }
  }
  return best;
}

function renderDefs() {
  return `<defs>
    <linearGradient id="pageShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#020611" stop-opacity=".28"/>
      <stop offset="42%" stop-color="#020611" stop-opacity=".52"/>
      <stop offset="100%" stop-color="#020611" stop-opacity=".82"/>
    </linearGradient>
    <linearGradient id="headerPlate" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#061426" stop-opacity=".92"/>
      <stop offset="55%" stop-color="#10243c" stop-opacity=".78"/>
      <stop offset="100%" stop-color="#061020" stop-opacity=".90"/>
    </linearGradient>
    <linearGradient id="team1TicketPanel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#062d4b" stop-opacity=".96"/>
      <stop offset="62%" stop-color="#07182b" stop-opacity=".92"/>
      <stop offset="100%" stop-color="#04101e" stop-opacity=".96"/>
    </linearGradient>
    <linearGradient id="team2TicketPanel" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#48111b" stop-opacity=".96"/>
      <stop offset="62%" stop-color="#21101a" stop-opacity=".92"/>
      <stop offset="100%" stop-color="#100812" stop-opacity=".96"/>
    </linearGradient>
    <filter id="commanderAvatarDiffuseWide" x="-150%" y="-150%" width="400%" height="400%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="8.5"/>
    </filter>
    <filter id="commanderAvatarDiffuseTight" x="-90%" y="-90%" width="280%" height="280%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="3.2"/>
    </filter>
    <style><![CDATA[
      text{font-family:'Bahnschrift SemiCondensed','Bahnschrift','Arial Narrow','Microsoft YaHei',sans-serif;fill:#eef6ff}
      .mono{font-family:'Cascadia Mono','Consolas',monospace}
      .eyebrow{font-size:9px;font-weight:900;letter-spacing:1.5px;fill:#b9cadc}
      .hero-title{font-size:32px;font-weight:900}
      .hero-sub{font-size:11px;fill:#d4e1ee}
      .meta{font-size:8px;fill:#b7c8d8}
      .global-server{font-size:7px;font-weight:900;letter-spacing:.55px;fill:#aebfd0}
      .global-metric-label{font-size:7px;font-weight:900;fill:#8398ad;letter-spacing:.35px}.global-metric-value{font-size:7px;font-weight:900;fill:#eef7ff}
      .ticket-team{font-size:6.5px;font-weight:900;letter-spacing:.4px;fill:#dce9f5}
      .ticket-label{font-size:5.5px;font-weight:900;letter-spacing:1px;fill:#8ea4b8}
      .ticket-value{font-size:23px;font-weight:900}
      .ticket-flag-fallback{font-size:7px;font-weight:900;fill:#d6e5f2}
      .battle-stat-label{font-size:5.5px;font-weight:900;letter-spacing:.55px;fill:#91a5b9}
      .battle-stat-value{font-size:17px;font-weight:900}
      .team-title{font-size:19px;font-weight:900}
      .team-meta{font-size:10px;font-weight:800;fill:#b9c9d8}
      .commander-initial{font-size:13px;font-weight:900}.commander-orbit{stroke-linecap:round}.commander-caption{font-size:7px;font-weight:900;letter-spacing:.35px;fill:#d9e9f6}.team-commander{font-size:9px;font-weight:900;fill:#dce8f3}
      .squad-title{font-size:8px;font-weight:900}
      .squad-meta{font-size:7px;font-weight:800;fill:#b6c5d3}.squad-locked{font-size:10px;font-weight:900;fill:#ff5d6c}
      .scoreboard-header-title{font-size:6px;font-weight:900;letter-spacing:.65px;fill:#a9bed1}
      .scoreboard-header-stat{font-size:6px;font-weight:900}
      .role-badge{font-size:8px;font-weight:900}
      .player-name{font-size:7.5px;font-weight:900}
      .player-stat{font-size:6.1px;font-weight:900}
      .ft-badge{font-size:8px;font-weight:900;fill:#a9bdd0}
      .player-meta{font-size:8px;font-weight:800;fill:#d6e3ef}
      .player-ping{font-size:8px;font-weight:800;fill:#b8c7d5}.ping-unit{font-size:5px;opacity:.85}
      .combat-stats{font-size:6.2px;font-weight:800;fill:#d7e5f2;letter-spacing:-.15px}
      .footer{font-size:10px;fill:#91a4b7}
    ]]></style>
  </defs>`;
}

function emptyTeam(teamID) {
  return {
    teamID,
    teamName: `Team ${teamID}`,
    accent: TEAM_ACCENTS[teamID] ?? "#60a5fa",
    playerCount: 0,
    squadCount: 0,
    factionId: "",
    averagePing: null,
    tickets: null,
    combatTotals: { deaths: 0, revives: 0, teamKills: 0, source: "players" },
    commanderName: "Pending",
    groups: [],
  };
}

function isCommandSquad(value) {
  const text = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return text === "command"
    || text === "cmd"
    || text === "command squad"
    || /\bcommand\s*squad\b/i.test(text);
}

function squadKey(value) {
  return value == null ? "unassigned" : String(value);
}

function compareNullableNumbers(left, right) {
  const a = nullableNumber(left);
  const b = nullableNumber(right);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return firstText(value, "-");
  return date.toLocaleString("zh-CN", { hour12: false });
}

function clip(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function normalizeToken(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (value != null && value !== "" && Number.isFinite(number)) return number;
  }
  return null;
}

function nullableNumber(value) {
  const number = Number(value);
  return value == null || value === "" || !Number.isFinite(number) ? null : number;
}

async function loadSharp() {
  if (!sharpLoaderPromise) {
    sharpLoaderPromise = (async () => {
      try {
        const imported = await import("sharp");
        return imported.default ?? imported;
      } catch (importError) {
        try {
          return sharpRequire("sharp");
        } catch {}
        try {
          return sharpRequire(path.join(SHARP_BUNDLE_ROOT, "sharp"));
        } catch {
          const error = new Error(`sharp is unavailable: ${importError?.message ?? importError}`);
          error.code = "SharpUnavailable";
          throw error;
        }
      }
    })();
  }
  return sharpLoaderPromise;
}

function sanitizeFileToken(value) {
  return String(value ?? "match")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "match";
}
