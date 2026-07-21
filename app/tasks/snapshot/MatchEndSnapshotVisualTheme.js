import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let sharpPromise;

const W = 3200;
const H = 1800;
const TEAM_STYLE = [
  { id: 1, x: 48, accent: "#28d7ff", secondary: "#ffb547" },
  { id: 2, x: 1626, accent: "#ff465c", secondary: "#ad72ff" },
];

export async function applyMatchEndSnapshotVisualTheme(bundle, payload = {}) {
  if (!bundle?.pages?.length) return bundle;
  const page = bundle.pages.find((item) => item?.type === "match-status-scoreboard") ?? bundle.pages[0];
  if (!Buffer.isBuffer(page?.buffer)) return bundle;

  try {
    const source = page.buffer;
    const themed = await renderTheme(source, payload);
    bundle.pages = bundle.pages.map((item) => item === page ? { ...item, buffer: themed } : item);
    if (bundle.combinedBuffer === source || bundle.pages.length === 1) bundle.combinedBuffer = themed;
  } catch {
    // Styling must never make snapshot generation fail.
  }
  return bundle;
}

async function renderTheme(input, payload) {
  const sharp = await loadSharp();
  const metadata = await sharp(input).metadata();
  const width = Number(metadata.width) || W;
  const height = Number(metadata.height) || H;
  const svg = Buffer.from(buildSvg(buildModel(payload), width, height), "utf8");
  return sharp(input)
    .composite([{ input: svg, blend: "over" }])
    .sharpen({ sigma: 0.45, m1: 0.55, m2: 1.2 })
    .png()
    .toBuffer();
}

function buildModel(payload) {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  const squads = Array.isArray(payload?.squads) ? payload.squads : [];
  return {
    map: text(payload?.match?.map, payload?.match?.layer, "UNKNOWN SECTOR"),
    layer: text(payload?.match?.layer, "UNSPECIFIED LAYER"),
    mode: text(payload?.match?.mode, "UNKNOWN MODE"),
    next: text(payload?.match?.nextLayer, payload?.match?.nextMap, "PENDING"),
    server: text(payload?.server?.serverName, payload?.server?.serverId, "BZSS SERVER"),
    time: formatDate(payload?.capturedAt),
    players: Number(payload?.summary?.recordedPlayerCount ?? players.length ?? 0),
    queue: Number(payload?.server?.queueCount ?? 0),
    playtime: formatDuration(payload?.match?.playtime),
    winner: text(payload?.trigger?.winner, "—"),
    teams: TEAM_STYLE.map((style) => buildTeam(style, players, squads)),
  };
}

function buildTeam(style, players, squads) {
  const teamPlayers = players.filter((player) => Number(player?.teamID ?? player?.teamId) === style.id);
  const teamSquads = squads.filter((squad) => Number(squad?.teamID ?? squad?.teamId) === style.id);
  const commander = teamPlayers.find((player) => player?.isCommander)
    ?? teamPlayers.find((player) => player?.isLeader && /command|cmd/i.test(String(player?.squadInfo?.name ?? "")));
  const squadIds = new Set();
  for (const player of teamPlayers) {
    const id = finite(player?.squadID ?? player?.squadId);
    if (id != null) squadIds.add(id);
  }
  for (const squad of teamSquads) {
    const id = finite(squad?.squadID ?? squad?.squadId);
    if (id != null) squadIds.add(id);
  }
  const pings = teamPlayers
    .map((player) => finite(player?.bzssCore?.ping ?? player?.bzssCore?.latency ?? player?.ping ?? player?.playerScoreboard?.ping))
    .filter((value) => value != null && value >= 0);
  return {
    ...style,
    name: text(
      teamSquads.find((squad) => text(squad?.teamName))?.teamName,
      teamPlayers.find((player) => text(player?.squadInfo?.teamName))?.squadInfo?.teamName,
      `TEAM ${style.id}`,
    ),
    playerCount: teamPlayers.length,
    squadCount: squadIds.size,
    ping: pings.length ? Math.round(pings.reduce((sum, value) => sum + value, 0) / pings.length) : null,
    commander: text(commander?.name, "PENDING"),
  };
}

function buildSvg(model, width, height) {
  const metrics = [
    ["PLAYERS", model.players, "#28d7ff"],
    ["QUEUE", model.queue, "#ffb547"],
    ["TIME", model.playtime, "#ad72ff"],
    ["WINNER", model.winner, "#ff465c"],
  ].map(([label, value, accent], index) => metricCard(1852 + index * 310, label, value, accent)).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#01040a" stop-opacity=".28"/><stop offset=".45" stop-color="#020711" stop-opacity=".03"/><stop offset="1" stop-color="#010205" stop-opacity=".52"/></linearGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#050b12" stop-opacity=".97"/><stop offset=".55" stop-color="#07111d" stop-opacity=".88"/><stop offset="1" stop-color="#090711" stop-opacity=".94"/></linearGradient>
    <linearGradient id="fog" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#28d7ff" stop-opacity="0"/><stop offset=".22" stop-color="#bcefff" stop-opacity=".13"/><stop offset=".55" stop-color="#f1f4f6" stop-opacity=".08"/><stop offset=".8" stop-color="#cba6ff" stop-opacity=".10"/><stop offset="1" stop-color="#ff465c" stop-opacity="0"/></linearGradient>
    <radialGradient id="cyan" cx="0" cy="1" r="1"><stop stop-color="#22d3ee" stop-opacity=".18"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
    <radialGradient id="purple" cx="1" cy="1" r="1"><stop stop-color="#9f67ff" stop-opacity=".16"/><stop offset="1" stop-color="#9f67ff" stop-opacity="0"/></radialGradient>
    <pattern id="scan" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 1H10" stroke="#d9efff" stroke-opacity=".018"/></pattern>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="2" seed="27"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .055 0"/></filter>
    <style><![CDATA[
      .display{font-family:'Agency FB','DIN Condensed','Bahnschrift SemiCondensed','Arial Narrow','Microsoft YaHei',sans-serif;fill:#f4f7fb}.tech{font-family:'Cascadia Mono','Consolas','Microsoft YaHei',monospace;fill:#d9e4ee}
      .hero{font-size:68px;font-weight:900;letter-spacing:2px}.kicker{font-size:18px;font-weight:900;letter-spacing:6px;fill:#a8b8c8}.sub{font-size:23px;font-weight:800;letter-spacing:1px;fill:#c7d1db}
      .label{font-size:15px;font-weight:900;letter-spacing:2.2px;fill:#8998a8}.value{font-size:31px;font-weight:900;letter-spacing:.6px}.team-kicker{font-size:15px;font-weight:900;letter-spacing:4px;fill:#9eacba}.team-title{font-size:38px;font-weight:900;letter-spacing:1.2px}.team-meta{font-size:17px;font-weight:900;letter-spacing:.9px;fill:#c3ced8}.footer{font-size:15px;font-weight:900;letter-spacing:1.4px;fill:#8292a2}
    ]]></style>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#shade)"/><rect width="1600" height="1800" fill="url(#cyan)"/><rect x="1600" width="1600" height="1800" fill="url(#purple)"/>
  <path d="M-180 420C420 300 820 530 1430 395C1990 270 2510 470 3380 290V560C2600 680 2020 495 1450 610C820 735 350 560-180 690Z" fill="url(#fog)" opacity=".64"/>
  <path d="M-240 1390C390 1240 830 1510 1440 1370C2070 1225 2570 1515 3400 1320V1720C2660 1810 2120 1580 1470 1735C830 1885 330 1635-240 1780Z" fill="url(#fog)" opacity=".48"/>
  <rect width="${W}" height="${H}" fill="url(#scan)"/><rect width="${W}" height="${H}" filter="url(#grain)" opacity=".22"/>
  <path d="M72 50H2110L2190 116H3128V252H72Z" fill="url(#plate)" stroke="#dce7f0" stroke-opacity=".23" stroke-width="2"/>
  <path d="M72 50H910" stroke="#28d7ff" stroke-width="7"/><path d="M910 50H1430" stroke="#ffb547" stroke-width="7"/><path d="M1430 50H1800" stroke="#ad72ff" stroke-width="7"/><path d="M1800 50H2110" stroke="#ff465c" stroke-width="7"/>
  <text x="118" y="100" class="display kicker">BZSS // AFTER ACTION REPORT</text><text x="112" y="178" class="display hero">${xml(clip(model.map.toUpperCase(), 34))}</text>
  <text x="116" y="222" class="display sub">${xml(clip(model.layer, 45))} / ${xml(clip(model.mode, 18))} / NEXT: ${xml(clip(model.next, 34))}</text><text x="3102" y="82" text-anchor="end" class="tech label">${xml(model.time)}</text>
  ${metrics}${model.teams.map(teamFrame).join("")}
  <path d="M80 1740H1230L1260 1770H3120" fill="none" stroke="#dce8f1" stroke-opacity=".22" stroke-width="2"/><path d="M80 1740H600" stroke="#28d7ff" stroke-width="5"/><path d="M600 1740H930" stroke="#ffb547" stroke-width="5"/><path d="M2270 1740H2650" stroke="#ad72ff" stroke-width="5"/><path d="M2650 1740H3120" stroke="#ff465c" stroke-width="5"/>
  <text x="90" y="1780" class="tech footer">HARDLINE SCOREBOARD / BZSS TACTICAL DATA</text><text x="3110" y="1780" text-anchor="end" class="tech footer">${xml(clip(model.server, 54))}</text>
</svg>`;
}

function metricCard(x, label, value, accent) {
  return `<g><rect x="${x}" y="102" width="270" height="104" fill="#03070d" fill-opacity=".74" stroke="#d9e4ee" stroke-opacity=".18" stroke-width="2"/><rect x="${x}" y="102" width="8" height="104" fill="${accent}"/><rect x="${x + 16}" y="118" width="94" height="3" fill="${accent}" opacity=".8"/><text x="${x + 24}" y="148" class="tech label">${label}</text><text x="${x + 24}" y="190" class="display value">${xml(clip(value, 12))}</text></g>`;
}

function teamFrame(team) {
  const x = team.x; const y = 316; const w = 1550; const h = 1388; const ping = team.ping == null ? "--" : `${team.ping}MS`;
  return `<g><rect x="${x - 2}" y="${y - 2}" width="${w + 4}" height="${h + 4}" fill="none" stroke="#02050a" stroke-opacity=".92" stroke-width="26"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${team.accent}" stroke-opacity=".58" stroke-width="3"/>
  <path d="M${x} ${y + 120}V${y}H${x + 320}" fill="none" stroke="${team.accent}" stroke-width="8"/><path d="M${x + w - 320} ${y}H${x + w}V${y + 120}" fill="none" stroke="${team.secondary}" stroke-width="8"/><path d="M${x} ${y + h - 120}V${y + h}H${x + 320}" fill="none" stroke="${team.secondary}" stroke-width="8"/><path d="M${x + w - 320} ${y + h}H${x + w}V${y + h - 120}" fill="none" stroke="${team.accent}" stroke-width="8"/>
  <rect x="${x + 16}" y="${y + 16}" width="${w - 32}" height="100" fill="none" stroke="#02050a" stroke-width="20"/><rect x="${x + 16}" y="${y + 16}" width="${w - 32}" height="100" fill="none" stroke="${team.accent}" stroke-opacity=".55" stroke-width="2"/>
  <path d="M${x + 22} ${y + 22}H${x + 1030}L${x + 1082} ${y + 72}H${x + 1180}V${y + 108}H${x + 22}Z" fill="#030812" fill-opacity=".84"/><rect x="${x + 22}" y="${y + 22}" width="9" height="86" fill="${team.accent}"/><rect x="${x + 44}" y="${y + 34}" width="160" height="4" fill="${team.secondary}"/>
  <text x="${x + 48}" y="${y + 58}" class="display team-kicker">TACTICAL GROUP ${String(team.id).padStart(2, "0")}</text><text x="${x + 46}" y="${y + 96}" class="display team-title" fill="${team.accent}">TEAM ${team.id} · ${xml(clip(team.name.toUpperCase(), 30))}</text>
  <text x="${x + 760}" y="${y + 95}" class="tech team-meta">${team.playerCount} PLY / ${team.squadCount} SQD / AVG ${ping}</text><text x="${x + w - 338}" y="${y + 52}" text-anchor="end" class="tech label">COMMAND AUTHORITY</text><text x="${x + w - 338}" y="${y + 88}" text-anchor="end" class="display team-meta">${xml(clip(team.commander.toUpperCase(), 18))}</text>
  <path d="M${x + 18} ${y + 132}H${x + w - 18}" stroke="#cbd8e3" stroke-opacity=".14" stroke-width="2"/><path d="M${x + 18} ${y + 132}H${x + 510}" stroke="${team.accent}" stroke-width="3"/><path d="M${x + w - 410} ${y + 132}H${x + w - 18}" stroke="${team.secondary}" stroke-width="3"/></g>`;
}

async function loadSharp() {
  if (!sharpPromise) sharpPromise = import("sharp").then((module) => module.default ?? module).catch(() => require("sharp"));
  return sharpPromise;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0) || 0));
  const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const secs = total % 60;
  if (hours) return `${hours}H ${minutes}M`; if (minutes) return `${minutes}M ${secs}S`; return `${secs}S`;
}
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? text(value, "-") : date.toLocaleString("zh-CN", { hour12: false }); }
function finite(value) { const number = Number(value); return value == null || value === "" || !Number.isFinite(number) ? null : number; }
function text(...values) { for (const value of values) { const result = String(value ?? "").trim(); if (result) return result; } return ""; }
function clip(value, length) { const result = String(value ?? ""); return result.length <= length ? result : `${result.slice(0, Math.max(1, length - 1))}…`; }
function xml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
