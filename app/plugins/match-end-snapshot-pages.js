import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WIDTH = 1600;
const HEIGHT = 900;
const ROWS_PER_COLUMN = 25;
const PLAYERS_PER_PAGE = ROWS_PER_COLUMN * 2;
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
  1: "#31d0aa",
  2: "#f5a623",
};

export async function generateMatchEndSnapshotBundle(payload, options = {}) {
  const sharp = await loadSharp();
  const snapshotId = sanitizeFileToken(options.snapshotId || "match");
  const teams = buildTeams(payload);
  const background = await buildBackground(sharp, payload);
  const pages = [];

  const coverBuffer = await renderPng(sharp, background, renderCoverSvg(payload, teams));
  pages.push({
    index: 0,
    type: "cover",
    teamId: null,
    teamPage: null,
    teamPageCount: null,
    fileName: `${snapshotId}-00-cover.png`,
    width: WIDTH,
    height: HEIGHT,
    playerCount: Number(payload?.summary?.recordedPlayerCount ?? payload?.players?.length ?? 0),
    buffer: coverBuffer,
  });

  let pageIndex = 1;
  for (const team of teams) {
    const teamPlayers = sortPlayers(team.players);
    const chunks = chunk(teamPlayers, PLAYERS_PER_PAGE);
    if (!chunks.length) chunks.push([]);
    for (let teamPage = 0; teamPage < chunks.length; teamPage += 1) {
      const pagePlayers = chunks[teamPage];
      const fileTeam = sanitizeFileToken(`team${team.teamID}`);
      const pageSuffix = chunks.length > 1 ? `-page${teamPage + 1}` : "";
      const svg = renderTeamScoreboardSvg({
        payload,
        team,
        players: pagePlayers,
        teamPage,
        teamPageCount: chunks.length,
        globalPage: pageIndex,
      });
      const buffer = await renderPng(sharp, background, svg);
      pages.push({
        index: pageIndex,
        type: "team-scoreboard",
        teamId: team.teamID,
        teamPage: teamPage + 1,
        teamPageCount: chunks.length,
        fileName: `${snapshotId}-${String(pageIndex).padStart(2, "0")}-${fileTeam}${pageSuffix}.png`,
        width: WIDTH,
        height: HEIGHT,
        playerCount: pagePlayers.length,
        buffer,
      });
      pageIndex += 1;
    }
  }

  const combinedBuffer = await combinePages(sharp, pages);
  const manifest = {
    schemaVersion: 1,
    snapshotId,
    generatedAt: new Date().toISOString(),
    sourceCapturedAt: String(payload?.capturedAt ?? ""),
    width: WIDTH,
    height: HEIGHT,
    pageCount: pages.length,
    primaryImage: `${snapshotId}.png`,
    combinedImage: `${snapshotId}-combined.png`,
    pages: pages.map(({ buffer, ...page }) => page),
  };

  return {
    width: WIDTH,
    height: HEIGHT,
    pages,
    combinedBuffer,
    manifest,
  };
}

function buildTeams(payload) {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  const squads = Array.isArray(payload?.squads) ? payload.squads : [];
  const ids = new Set([1, 2]);
  for (const player of players) {
    const teamID = nullableNumber(player?.teamID ?? player?.teamId);
    if (teamID != null) ids.add(teamID);
  }
  for (const squad of squads) {
    const teamID = nullableNumber(squad?.teamID ?? squad?.teamId);
    if (teamID != null) ids.add(teamID);
  }

  return [...ids]
    .sort((a, b) => a - b)
    .map((teamID) => {
      const teamPlayers = players.filter((player) => Number(player?.teamID ?? player?.teamId) === teamID);
      const teamSquads = squads.filter((squad) => Number(squad?.teamID ?? squad?.teamId) === teamID);
      const teamName = firstText(
        teamSquads.find((squad) => firstText(squad?.teamName))?.teamName,
        `Team ${teamID}`,
      );
      const commander = teamPlayers.find((player) => player?.isCommander)
        ?? teamPlayers.find((player) => player?.isLeader && isCommandSquad(player?.squadInfo?.name))
        ?? teamPlayers.find((player) => player?.isLeader)
        ?? null;
      return {
        teamID,
        teamName,
        accent: TEAM_ACCENTS[teamID] ?? "#60a5fa",
        players: teamPlayers,
        squads: teamSquads,
        squadCount: new Set(teamPlayers.map((player) => player?.squadID).filter((value) => value != null)).size,
        commanderName: firstText(commander?.name, "Pending"),
      };
    });
}

function renderCoverSvg(payload, teams) {
  const map = firstText(payload?.match?.map, payload?.match?.layer, "Unknown Map");
  const layer = firstText(payload?.match?.layer, "-");
  const mode = firstText(payload?.match?.mode, "-");
  const next = firstText(payload?.match?.nextLayer, payload?.match?.nextMap, "-");
  const serverName = firstText(payload?.server?.serverName, payload?.server?.serverId, "BZSS Server");
  const winner = firstText(payload?.trigger?.winner, "未记录");
  const playerCount = Number(payload?.summary?.recordedPlayerCount ?? payload?.players?.length ?? 0);
  const queueCount = Number(payload?.server?.queueCount ?? 0);
  const playtime = formatDuration(payload?.match?.playtime);
  const capturedAt = formatDateTime(payload?.capturedAt);
  const totalKills = teams.reduce((sum, team) => sum + team.players.reduce((teamSum, player) => teamSum + stat(player, "kills"), 0), 0);
  const totalDowns = teams.reduce((sum, team) => sum + team.players.reduce((teamSum, player) => teamSum + stat(player, "downs"), 0), 0);
  const totalRevives = teams.reduce((sum, team) => sum + team.players.reduce((teamSum, player) => teamSum + stat(player, "revives"), 0), 0);

  const svg = [];
  svg.push(svgStart());
  svg.push(commonDefs());
  svg.push(pageShade());
  svg.push('<path d="M48 42 H1110 L1160 92 H1552 V170 H48 Z" fill="url(#headerPlate)" stroke="#dce9f7" stroke-opacity=".22"/>');
  svg.push('<text x="76" y="76" class="eyebrow">BZSS PANEL / MATCH END SNAPSHOT</text>');
  svg.push(`<text x="76" y="128" class="hero-title">${escapeXml(map)}</text>`);
  svg.push(`<text x="78" y="156" class="hero-sub">${escapeXml(layer)} · ${escapeXml(mode)} · ${escapeXml(serverName)}</text>`);
  svg.push(`<text x="1202" y="148" class="meta mono">${escapeXml(capturedAt)}</text>`);

  const cards = [
    ["PLAYERS", String(playerCount)],
    ["QUEUE", String(queueCount)],
    ["MATCH TIME", playtime],
    ["WINNER", winner],
  ];
  cards.forEach(([label, value], index) => {
    const x = 918 + index * 154;
    svg.push(`<path d="M${x} 66 H${x + 136} V128 H${x} Z" fill="#020817" fill-opacity=".72" stroke="#d7e7f7" stroke-opacity=".24"/>`);
    svg.push(`<text x="${x + 12}" y="88" class="card-label">${escapeXml(label)}</text>`);
    svg.push(`<text x="${x + 12}" y="116" class="card-value mono">${escapeXml(value)}</text>`);
  });

  svg.push('<path d="M58 206 H1542" stroke="#d7e7f7" stroke-opacity=".18"/>');
  svg.push('<text x="72" y="238" class="section-title">对局总结</text>');
  svg.push(`<text x="72" y="272" class="summary-line">下一图层  ${escapeXml(next)}</text>`);
  svg.push(`<text x="72" y="308" class="summary-line">总击杀  ${totalKills}    总击倒  ${totalDowns}    总复苏  ${totalRevives}</text>`);
  svg.push(`<text x="72" y="344" class="summary-line">快照玩家  ${playerCount}    小队  ${Number(payload?.summary?.squadCount ?? 0)}    BZSS-Core  ${Number(payload?.summary?.bzssCorePlayerCount ?? 0)}</text>`);

  const teamCards = teams.slice(0, 2);
  teamCards.forEach((team, index) => {
    const x = index === 0 ? 64 : 816;
    const y = 408;
    const width = 720;
    const topPlayers = [...team.players]
      .sort((a, b) => totalScore(b) - totalScore(a) || stat(b, "kills") - stat(a, "kills"))
      .slice(0, 3);
    svg.push(`<path d="M${x + 20} ${y} H${x + width - 28} L${x + width} ${y + 28} V${y + 330} H${x} V${y + 24} Z" fill="#031022" fill-opacity=".82" stroke="${team.accent}" stroke-opacity=".58"/>`);
    svg.push(`<rect x="${x}" y="${y + 22}" width="6" height="286" fill="${team.accent}"/>`);
    svg.push(`<text x="${x + 30}" y="${y + 54}" class="team-cover-title">${escapeXml(team.teamName)}</text>`);
    svg.push(`<text x="${x + 30}" y="${y + 82}" class="team-cover-meta mono">TEAM ${team.teamID} · ${team.players.length} PLAYERS · ${team.squadCount} SQUADS</text>`);
    svg.push(`<text x="${x + 30}" y="${y + 116}" class="team-cover-meta">COMMANDER  ${escapeXml(team.commanderName)}</text>`);
    svg.push(`<path d="M${x + 30} ${y + 138} H${x + width - 36}" stroke="${team.accent}" stroke-opacity=".35"/>`);
    svg.push(`<text x="${x + 30}" y="${y + 168}" class="rank-head">TOP PERFORMANCE</text>`);
    topPlayers.forEach((player, playerIndex) => {
      const rowY = y + 202 + playerIndex * 42;
      svg.push(`<text x="${x + 32}" y="${rowY}" class="rank-no mono">${String(playerIndex + 1).padStart(2, "0")}</text>`);
      svg.push(`<text x="${x + 70}" y="${rowY}" class="rank-name">${escapeXml(clip(player?.name, 28))}</text>`);
      svg.push(`<text x="${x + 438}" y="${rowY}" class="rank-stat mono">K ${stat(player, "kills")} · W ${stat(player, "downs")} · C ${stat(player, "combatScore")}</text>`);
    });
    if (!topPlayers.length) {
      svg.push(`<text x="${x + 32}" y="${y + 212}" class="team-cover-meta">没有保存到该阵营的玩家数据</text>`);
    }
  });

  svg.push('<text x="800" y="872" text-anchor="middle" class="footer">第 1 页 · 后续页面为双方完整记分板</text>');
  svg.push("</svg>");
  return svg.join("");
}

function renderTeamScoreboardSvg({ payload, team, players, teamPage, teamPageCount, globalPage }) {
  const map = firstText(payload?.match?.map, payload?.match?.layer, "Unknown Map");
  const layer = firstText(payload?.match?.layer, "-");
  const mode = firstText(payload?.match?.mode, "-");
  const winner = firstText(payload?.trigger?.winner, "");
  const columns = [
    players.slice(0, ROWS_PER_COLUMN),
    players.slice(ROWS_PER_COLUMN, PLAYERS_PER_PAGE),
  ];

  const svg = [];
  svg.push(svgStart());
  svg.push(commonDefs());
  svg.push(pageShade());
  svg.push(`<path d="M42 34 H1544 L1564 54 V136 H42 Z" fill="url(#headerPlate)" stroke="${team.accent}" stroke-opacity=".55"/>`);
  svg.push(`<rect x="42" y="34" width="7" height="102" fill="${team.accent}"/>`);
  svg.push(`<text x="72" y="72" class="eyebrow">TEAM ${team.teamID} / FULL SCOREBOARD</text>`);
  svg.push(`<text x="72" y="112" class="score-title">${escapeXml(team.teamName)}</text>`);
  svg.push(`<text x="630" y="78" class="score-meta">${escapeXml(map)} · ${escapeXml(layer)} · ${escapeXml(mode)}</text>`);
  svg.push(`<text x="630" y="108" class="score-meta mono">${team.players.length} PLAYERS · ${team.squadCount} SQUADS · CO ${escapeXml(team.commanderName)}</text>`);
  svg.push(`<text x="1326" y="76" class="score-meta mono">TEAM PAGE ${teamPage + 1}/${teamPageCount}</text>`);
  svg.push(`<text x="1326" y="106" class="score-meta mono">${winner ? `WINNER ${escapeXml(winner)}` : "MATCH END"}</text>`);

  columns.forEach((columnPlayers, columnIndex) => {
    renderScoreColumn(svg, {
      x: columnIndex === 0 ? 42 : 816,
      y: 166,
      width: 742,
      accent: team.accent,
      players: columnPlayers,
      startIndex: teamPage * PLAYERS_PER_PAGE + columnIndex * ROWS_PER_COLUMN,
    });
  });

  svg.push('<text x="60" y="868" class="footer">W 击倒 · K 击杀 · VK 载具击杀 · D 死亡 · TK 友军击杀 · R 复苏 · H 治疗分 · C 战斗分 · O 目标分 · T 团队分 · P 延迟</text>');
  svg.push(`<text x="1542" y="868" text-anchor="end" class="footer mono">PAGE ${globalPage + 1}</text>`);
  svg.push("</svg>");
  return svg.join("");
}

function renderScoreColumn(svg, { x, y, width, accent, players, startIndex }) {
  const headerHeight = 30;
  const rowHeight = 25;
  svg.push(`<path d="M${x} ${y} H${x + width - 12} L${x + width} ${y + 12} V${y + headerHeight} H${x} Z" fill="#061426" fill-opacity=".94" stroke="${accent}" stroke-opacity=".52"/>`);
  const headers = [
    [10, "SQ", "start"], [44, "PLAYER", "start"], [246, "ROLE", "start"],
    [318, "W", "middle"], [350, "K", "middle"], [382, "VK", "middle"],
    [416, "D", "middle"], [448, "TK", "middle"], [482, "R", "middle"],
    [520, "H", "middle"], [566, "C", "middle"], [612, "O", "middle"],
    [658, "T", "middle"], [710, "P", "middle"],
  ];
  for (const [offset, label, anchor] of headers) {
    svg.push(`<text x="${x + offset}" y="${y + 20}"${anchor === "middle" ? ' text-anchor="middle"' : ""} class="table-head">${label}</text>`);
  }

  for (let rowIndex = 0; rowIndex < ROWS_PER_COLUMN; rowIndex += 1) {
    const player = players[rowIndex];
    const rowY = y + headerHeight + rowIndex * rowHeight;
    const opacity = rowIndex % 2 === 0 ? ".76" : ".62";
    svg.push(`<rect x="${x}" y="${rowY}" width="${width}" height="${rowHeight}" fill="#020a16" fill-opacity="${opacity}" stroke="#ffffff" stroke-opacity=".045"/>`);
    if (!player) continue;
    const previous = rowIndex > 0 ? players[rowIndex - 1] : null;
    const squadChanged = !previous || Number(previous?.squadID) !== Number(player?.squadID);
    if (squadChanged) {
      svg.push(`<rect x="${x}" y="${rowY}" width="4" height="${rowHeight}" fill="${accent}" opacity=".92"/>`);
    }
    const rank = startIndex + rowIndex + 1;
    const prefix = player?.isCommander ? "CO " : player?.isLeader ? "SL " : "";
    svg.push(`<text x="${x + 10}" y="${rowY + 17}" class="row-squad mono">${escapeXml(player?.squadID ?? "-")}</text>`);
    svg.push(`<text x="${x + 44}" y="${rowY + 17}" class="row-name">${escapeXml(`${prefix}${clip(player?.name, 24)}`)}</text>`);
    svg.push(`<text x="${x + 246}" y="${rowY + 17}" class="row-role">${escapeXml(clip(resolveRole(player), 10))}</text>`);
    const values = [
      [318, stat(player, "downs")], [350, stat(player, "kills")], [382, stat(player, "vehicleKills")],
      [416, stat(player, "deaths")], [448, stat(player, "teamKills")], [482, stat(player, "revives")],
      [520, stat(player, "healPoints")], [566, stat(player, "combatScore")],
      [612, stat(player, "objectiveScore")], [658, stat(player, "teamworkScore")],
      [710, ping(player)],
    ];
    for (const [offset, value] of values) {
      svg.push(`<text x="${x + offset}" y="${rowY + 17}" text-anchor="middle" class="row-stat mono">${escapeXml(value)}</text>`);
    }
    svg.push(`<text x="${x + width - 8}" y="${rowY + 17}" text-anchor="end" class="row-rank mono">${rank}</text>`);
  }
}

function sortPlayers(players) {
  return [...players].sort((left, right) =>
    numberSort(left?.squadID, right?.squadID)
    || Number(Boolean(right?.isCommander)) - Number(Boolean(left?.isCommander))
    || Number(Boolean(right?.isLeader)) - Number(Boolean(left?.isLeader))
    || totalScore(right) - totalScore(left)
    || String(left?.name ?? "").localeCompare(String(right?.name ?? ""), "zh-CN", { numeric: true }),
  );
}

function stat(player, field) {
  const core = player?.bzssCore ?? {};
  const aliases = {
    kills: ["kills", "numKills"],
    vehicleKills: ["vehicleKills"],
    deaths: ["deaths", "numDeaths"],
    downs: ["downs", "numWoundeds"],
    wounds: ["wounds", "numWounds"],
    teamKills: ["teamKills", "tk", "numTeamKills"],
    revives: ["revives", "revivedPoints"],
    healPoints: ["healPoints"],
    combatScore: ["combatScore"],
    objectiveScore: ["objectiveScore"],
    teamworkScore: ["teamworkScore"],
  };
  for (const key of aliases[field] ?? [field]) {
    const value = Number(core?.[key] ?? player?.[key]);
    if (Number.isFinite(value)) return Math.trunc(value);
  }
  return 0;
}

function totalScore(player) {
  return stat(player, "combatScore") + stat(player, "objectiveScore") + stat(player, "teamworkScore");
}

function ping(player) {
  const value = Number(player?.bzssCore?.ping ?? player?.ping);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : "--";
}

function resolveRole(player) {
  const role = firstText(player?.role, player?.bzssCore?.soldierClass, "-");
  return role
    .replace(/^.*?_/, "")
    .replace(/SquadLeader/i, "SL")
    .replace(/Rifleman/i, "Rifle")
    .replace(/AutomaticRifleman/i, "AR")
    .replace(/MachineGunner/i, "MG")
    .replace(/HeavyAntiTank/i, "HAT")
    .replace(/LightAntiTank/i, "LAT")
    .replace(/CombatEngineer/i, "ENG")
    .replace(/DesignatedMarksman/i, "DMR");
}

async function buildBackground(sharp, payload) {
  const assetPath = resolveLoadingScreenPath(payload);
  if (assetPath) {
    try {
      return await sharp(assetPath)
        .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
        .modulate({ brightness: 0.56, saturation: 0.62 })
        .blur(1.2)
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
  const normalized = String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let best = "Sumari";
  let bestLength = 0;
  for (const key of Object.keys(MAP_SCENE_FILE_BY_KEY)) {
    const candidate = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalized.includes(candidate) && candidate.length > bestLength) {
      best = key;
      bestLength = candidate.length;
    }
  }
  return best;
}

async function renderPng(sharp, background, svg) {
  return sharp(background)
    .composite([{ input: Buffer.from(svg, "utf8") }])
    .png()
    .toBuffer();
}

async function combinePages(sharp, pages) {
  const height = HEIGHT * pages.length;
  const composites = pages.map((page, index) => ({
    input: page.buffer,
    left: 0,
    top: index * HEIGHT,
  }));
  return sharp({
    create: {
      width: WIDTH,
      height,
      channels: 4,
      background: { r: 2, g: 6, b: 18, alpha: 1 },
    },
  }).composite(composites).png().toBuffer();
}

function svgStart() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`;
}

function commonDefs() {
  return `<defs>
    <linearGradient id="pageShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#020611" stop-opacity=".34"/>
      <stop offset="40%" stop-color="#020611" stop-opacity=".62"/>
      <stop offset="100%" stop-color="#020611" stop-opacity=".88"/>
    </linearGradient>
    <linearGradient id="headerPlate" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#061426" stop-opacity=".90"/>
      <stop offset="55%" stop-color="#10243c" stop-opacity=".80"/>
      <stop offset="100%" stop-color="#061020" stop-opacity=".90"/>
    </linearGradient>
    <style><![CDATA[
      text{font-family:'Bahnschrift SemiCondensed','Bahnschrift','Arial Narrow','Microsoft YaHei',sans-serif;fill:#eef6ff}
      .mono{font-family:'Cascadia Mono','Consolas',monospace}
      .eyebrow{font-size:13px;font-weight:900;letter-spacing:1.6px;fill:#b9cadc}
      .hero-title{font-size:46px;font-weight:900}
      .hero-sub{font-size:17px;fill:#d4e1ee}
      .meta{font-size:12px;fill:#b7c8d8}
      .card-label{font-size:10px;font-weight:900;fill:#aabbd0}
      .card-value{font-size:19px;font-weight:900}
      .section-title{font-size:24px;font-weight:900}
      .summary-line{font-size:18px;font-weight:700;fill:#d9e6f3}
      .team-cover-title{font-size:28px;font-weight:900}
      .team-cover-meta{font-size:13px;font-weight:700;fill:#c1d0df}
      .rank-head{font-size:11px;font-weight:900;letter-spacing:1.2px;fill:#aebed0}
      .rank-no{font-size:13px;font-weight:900;fill:#8fa4b8}
      .rank-name{font-size:17px;font-weight:900}
      .rank-stat{font-size:13px;font-weight:800;fill:#d7e4ef}
      .score-title{font-size:34px;font-weight:900}
      .score-meta{font-size:13px;font-weight:800;fill:#c6d5e4}
      .table-head{font-size:11px;font-weight:900;fill:#b7c8d8}
      .row-squad{font-size:12px;font-weight:900;fill:#9fb1c3}
      .row-name{font-size:14px;font-weight:900}
      .row-role{font-size:12px;font-weight:800;fill:#c8d6e4}
      .row-stat{font-size:12px;font-weight:800}
      .row-rank{font-size:8px;fill:#52677b}
      .footer{font-size:11px;fill:#90a3b7}
    ]]></style>
  </defs>`;
}

function pageShade() {
  return `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#pageShade)"/>`;
}

function isCommandSquad(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "command" || text === "cmd" || text.includes("command squad");
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

function nullableNumber(value) {
  const number = Number(value);
  return value == null || value === "" || !Number.isFinite(number) ? null : number;
}

function numberSort(left, right) {
  const a = nullableNumber(left);
  const b = nullableNumber(right);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function chunk(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function sanitizeFileToken(value) {
  return String(value ?? "match")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "match";
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
