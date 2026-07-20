import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WIDTH = 3200;
const HEIGHT = 1800;
const BASE_WIDTH = 1600;
const BASE_HEIGHT = 900;
const TEAM_COLUMN_WIDTH = 748;
const TEAM_CONTENT_TOP = 186;
const TEAM_CONTENT_BOTTOM = 844;
const TEAM_LANE_GAP = 10;
const TEAM_LANE_WIDTH = Math.floor((TEAM_COLUMN_WIDTH - TEAM_LANE_GAP) / 2);
const SQUAD_HEADER_HEIGHT = 27;
const SQUAD_GAP = 8;
const DEFAULT_PLAYER_ROW_HEIGHT = 20;
const MIN_PLAYER_ROW_HEIGHT = 16;

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

const TEAM_ACCENTS = {
  1: "#37c8ff",
  2: "#ff9b45",
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
  const playerCount = Number(payload?.summary?.recordedPlayerCount ?? payload?.players?.length ?? 0);
  const page = {
    index: 0,
    type: "match-status-overview",
    teamId: null,
    teamPage: null,
    teamPageCount: null,
    fileName: `${snapshotId}-00-overview.png`,
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
    pages: [{ ...page, buffer: undefined }],
  };
  delete manifest.pages[0].buffer;
  return {
    width: WIDTH,
    height: HEIGHT,
    pages: [page],
    combinedBuffer: buffer,
    manifest,
  };
}

export async function generateMatchEndOverviewPng(payload) {
  const sharp = await loadSharp();
  const model = buildMatchEndOverviewModel(payload);
  await attachRoleIconData(model);
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
  const winner = firstText(payload?.trigger?.winner, "");
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
    winner,
    capturedAt,
    playerCount,
    queueCount,
    playtime,
    teams: [
      buildTeamColumnModel(teams.find((team) => team.teamID === 1) ?? emptyTeam(1), 36),
      buildTeamColumnModel(teams.find((team) => team.teamID === 2) ?? emptyTeam(2), 816),
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
      playerCount: teamPlayers.length,
      squadCount: groups.filter((group) => group.squadID != null).length,
      averagePing,
      commanderName: firstText(commander?.name, "Pending"),
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
      creatorName: firstText(squad?.creatorName),
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
        creatorName: firstText(player?.squadInfo?.creatorName),
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
  const availableHeight = TEAM_CONTENT_BOTTOM - TEAM_CONTENT_TOP;
  const lanes = [[], []];
  const laneWeights = [0, 0];

  for (const group of team.groups) {
    const targetLane = laneWeights[0] <= laneWeights[1] ? 0 : 1;
    lanes[targetLane].push(group);
    laneWeights[targetLane] += SQUAD_HEADER_HEIGHT + SQUAD_GAP + group.players.length * DEFAULT_PLAYER_ROW_HEIGHT;
  }

  const maxWeight = Math.max(...laneWeights, 1);
  const overflow = Math.max(0, maxWeight - availableHeight);
  const totalPlayersInTallestLane = Math.max(
    lanes[0].reduce((sum, group) => sum + group.players.length, 0),
    lanes[1].reduce((sum, group) => sum + group.players.length, 0),
    1,
  );
  const rowHeight = Math.max(
    MIN_PLAYER_ROW_HEIGHT,
    Math.floor(DEFAULT_PLAYER_ROW_HEIGHT - overflow / totalPlayersInTallestLane),
  );

  return {
    ...team,
    x,
    width: TEAM_COLUMN_WIDTH,
    contentTop: TEAM_CONTENT_TOP,
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

function renderOverviewSvg(model) {
  const svg = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`);
  svg.push(renderDefs());
  svg.push('<g transform="scale(2)">');
  svg.push('<rect width="1600" height="900" fill="url(#pageShade)"/>');

  svg.push('<path d="M36 32 H1112 L1162 82 H1564 V146 H36 Z" fill="url(#headerPlate)" stroke="#dce9f7" stroke-opacity=".22"/>');
  svg.push('<text x="64" y="62" class="eyebrow">BZSS PANEL / MATCH END OVERVIEW</text>');
  svg.push(`<text x="64" y="108" class="hero-title">${escapeXml(model.mapTitle)}</text>`);
  svg.push(`<text x="66" y="136" class="hero-sub">${escapeXml(model.layerTitle)} · ${escapeXml(model.modeTitle)} · NEXT ${escapeXml(model.nextLayer)}</text>`);
  svg.push(`<text x="1218" y="133" class="meta mono">${escapeXml(model.capturedAt)}</text>`);

  const cards = [
    ["PLAYERS", String(model.playerCount)],
    ["QUEUE", String(model.queueCount)],
    ["TIME", model.playtime],
    ["WINNER", model.winner || "-"],
  ];
  cards.forEach(([label, value], index) => {
    const x = 920 + index * 156;
    svg.push(`<path d="M${x} 50 H${x + 138} V112 H${x} Z" fill="#020817" fill-opacity=".72" stroke="#d7e7f7" stroke-opacity=".24"/>`);
    svg.push(`<text x="${x + 12}" y="72" class="card-label">${escapeXml(label)}</text>`);
    svg.push(`<text x="${x + 12}" y="101" class="card-value mono">${escapeXml(value)}</text>`);
  });

  for (const team of model.teams) {
    svg.push(renderTeamColumn(team));
  }

  svg.push('<text x="48" y="880" class="footer">对局结束总览仅展示玩家基础状态；详细击杀、击倒、治疗和分数保留在个人详情中。</text>');
  svg.push(`<text x="1552" y="880" text-anchor="end" class="footer mono">${escapeXml(model.serverName)}</text>`);
  svg.push("</g>");
  svg.push("</svg>");
  return svg.join("");
}

function renderTeamColumn(team) {
  const svg = [];
  const x = team.x;
  const y = 158;
  const headerHeight = 70;

  svg.push(`<rect x="${x}" y="${y}" width="${team.width}" height="${TEAM_CONTENT_BOTTOM - y + 8}" rx="12" fill="#030b18" fill-opacity=".72" stroke="${team.accent}" stroke-opacity=".34"/>`);
  svg.push(`<rect x="${x + 8}" y="${y + 8}" width="${team.width - 16}" height="${headerHeight - 8}" rx="9" fill="#071426" fill-opacity=".88" stroke="${team.accent}" stroke-opacity=".42"/>`);
  svg.push(`<rect x="${x + 8}" y="${y + 8}" width="5" height="${headerHeight - 8}" rx="2" fill="${team.accent}"/>`);

  svg.push(`<text x="${x + 28}" y="${y + 36}" class="team-title">TEAM ${team.teamID} · ${escapeXml(clip(team.teamName, 32))}</text>`);
  svg.push(`<text x="${x + 28}" y="${y + 58}" class="team-meta mono">${team.playerCount} PLAYERS · ${team.squadCount} SQUADS · AVG ${team.averagePing == null ? "--" : `${team.averagePing}ms`}</text>`);
  svg.push(`<text x="${x + team.width - 22}" y="${y + 36}" text-anchor="end" class="team-commander">CO · ${escapeXml(clip(team.commanderName, 22))}</text>`);

  const laneXs = [x + 10, x + 10 + team.laneWidth + team.laneGap];
  team.lanes.forEach((groups, laneIndex) => {
    let cursorY = team.contentTop;
    for (const group of groups) {
      svg.push(renderSquadCard(team, group, laneXs[laneIndex], cursorY));
      cursorY += SQUAD_HEADER_HEIGHT + group.players.length * team.rowHeight + SQUAD_GAP;
    }
  });

  return svg.join("");
}

function renderSquadCard(team, group, x, y) {
  const svg = [];
  const height = SQUAD_HEADER_HEIGHT + group.players.length * team.rowHeight;
  const badge = group.locked ? "LOCKED" : `${group.players.length}/9`;
  const title = `${group.squadID == null ? "-" : `#${group.squadID}`} ${group.squadName}`;

  svg.push(`<rect x="${x}" y="${y}" width="${team.laneWidth}" height="${height}" rx="8" fill="#061020" fill-opacity=".80" stroke="#ffffff" stroke-opacity=".10"/>`);
  svg.push(`<rect x="${x}" y="${y}" width="${team.laneWidth}" height="${SQUAD_HEADER_HEIGHT}" rx="8" fill="${team.accent}" fill-opacity=".16" stroke="${team.accent}" stroke-opacity=".28"/>`);
  svg.push(`<rect x="${x}" y="${y}" width="4" height="${SQUAD_HEADER_HEIGHT}" rx="2" fill="${team.accent}" opacity=".90"/>`);
  svg.push(`<text x="${x + 12}" y="${y + 18}" class="squad-title">${escapeXml(clip(title, 28))}${group.isCommandSquad ? " · CMD" : ""}</text>`);
  svg.push(`<text x="${x + team.laneWidth - 10}" y="${y + 18}" text-anchor="end" class="squad-meta mono">${escapeXml(badge)}</text>`);

  group.players.forEach((player, index) => {
    const rowY = y + SQUAD_HEADER_HEIGHT + index * team.rowHeight;
    svg.push(renderPlayerRow(team, player, x, rowY, index));
  });

  return svg.join("");
}

function renderPlayerRow(team, player, x, y, index) {
  const role = resolveRoleMeta(firstText(player?.role, player?.bzssCore?.soldierClass));
  const rowHeight = team.rowHeight;
  const health = readHealth(player);
  const ping = readPing(player);
  const fireTeam = normalizeFireTeam(player?.fireTeam);
  const leaderLabel = player?.isCommander ? "CO" : player?.isLeader ? "SL" : "";
  const backgroundOpacity = index % 2 === 0 ? ".64" : ".48";
  const core = player?.bzssCore ?? {};
  const stat = (...keys) => compactMetric(core, ...keys);
  const statsText = `K ${stat("kills", "kill", "numKills")} W ${stat("downs", "wounds", "wound")} D ${stat("deaths", "death")} TK ${stat("teamKills", "tk")} VK ${stat("vehicleKills", "vehicleKill")} R ${stat("revives", "revive")} H ${stat("healPoints", "healing")} C ${stat("combatScore", "combat")} O ${stat("objectiveScore", "objective")} T ${stat("teamworkScore", "teamwork")}`;
  return [
    `<rect x="${x}" y="${y}" width="${team.laneWidth}" height="${rowHeight}" fill="#020817" fill-opacity="${backgroundOpacity}" stroke="#ffffff" stroke-opacity=".035"/>`,
    player.roleIconData
      ? `<image href="${player.roleIconData}" x="${x + 9}" y="${y + 2}" width="20" height="16" preserveAspectRatio="xMidYMid meet"/>`
      : `<rect x="${x + 9}" y="${y + 4}" width="18" height="12" rx="3" fill="${role.tone}" fill-opacity=".35"/>`,
    `<text x="${x + 44}" y="${y + rowHeight - 6}" class="player-name">${leaderLabel ? `${leaderLabel} ` : ""}${escapeXml(clip(player?.name, 17))}</text>`,
    fireTeam
      ? `<text x="${x + 148}" y="${y + rowHeight - 6}" text-anchor="middle" class="ft-badge">${escapeXml(fireTeam)}</text>`
      : "",
    `<text x="${x + 168}" y="${y + rowHeight - 6}" class="combat-stats mono">${escapeXml(statsText)}</text>`,
    `<text x="${x + team.laneWidth - 52}" y="${y + rowHeight - 6}" text-anchor="middle" class="player-meta mono">${health == null ? "--" : "HP " + Math.round(health)}</text>`,
    `<text x="${x + team.laneWidth - 8}" y="${y + rowHeight - 6}" text-anchor="end" class="player-ping mono">${ping == null ? "--" : `${ping}ms`}</text>`,
  ].join("");
}

function comparePlayers(left, right) {
  return Number(Boolean(right?.isCommander)) - Number(Boolean(left?.isCommander))
    || Number(Boolean(right?.isLeader)) - Number(Boolean(left?.isLeader))
    || fireTeamRank(left?.fireTeam) - fireTeamRank(right?.fireTeam)
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
    <style><![CDATA[
      text{font-family:'Bahnschrift SemiCondensed','Bahnschrift','Arial Narrow','Microsoft YaHei',sans-serif;fill:#eef6ff}
      .mono{font-family:'Cascadia Mono','Consolas',monospace}
      .eyebrow{font-size:12px;font-weight:900;letter-spacing:1.5px;fill:#b9cadc}
      .hero-title{font-size:42px;font-weight:900}
      .hero-sub{font-size:15px;fill:#d4e1ee}
      .meta{font-size:11px;fill:#b7c8d8}
      .card-label{font-size:9px;font-weight:900;fill:#aabbd0}
      .card-value{font-size:18px;font-weight:900}
      .team-title{font-size:19px;font-weight:900}
      .team-meta{font-size:10px;font-weight:800;fill:#b9c9d8}
      .team-commander{font-size:11px;font-weight:900;fill:#dce8f3}
      .squad-title{font-size:10px;font-weight:900}
      .squad-meta{font-size:8px;font-weight:800;fill:#b6c5d3}
      .role-badge{font-size:8px;font-weight:900}
      .player-name{font-size:10.5px;font-weight:900}
      .ft-badge{font-size:8px;font-weight:900;fill:#a9bdd0}
      .player-meta{font-size:8px;font-weight:800;fill:#d6e3ef}
      .player-ping{font-size:8px;font-weight:800;fill:#b8c7d5}
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
    averagePing: null,
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

function normalizeFireTeam(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return "";
  const match = text.match(/(?:FIRE\s*TEAM\s*)?([ABC])(?:\s*TEAM)?/);
  return match?.[1] ?? text.slice(0, 3);
}

function fireTeamRank(value) {
  const fireTeam = normalizeFireTeam(value);
  return fireTeam === "A" ? 0 : fireTeam === "B" ? 1 : fireTeam === "C" ? 2 : 3;
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
