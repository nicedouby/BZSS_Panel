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
    .sharpen({ sigma: 0.35, m1: 0.45, m2: 1.0 })
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
  const name = text(
    teamSquads.find((squad) => text(squad?.teamName))?.teamName,
    teamPlayers.find((player) => text(player?.squadInfo?.teamName))?.squadInfo?.teamName,
    `TEAM ${style.id}`,
  );

  return {
    ...style,
    name,
    factionCode: resolveFactionCode(
      teamSquads.map((squad) => text(squad?.factionCode, squad?.faction, squad?.teamName)),
      teamPlayers.map((player) => text(
        player?.factionCode,
        player?.faction,
        player?.squadInfo?.factionCode,
        player?.squadInfo?.teamName,
      )),
      name,
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
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#01040a" stop-opacity=".18"/>
      <stop offset=".52" stop-color="#020711" stop-opacity=".015"/>
      <stop offset="1" stop-color="#010205" stop-opacity=".24"/>
    </linearGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="0">
      <stop stop-color="#050b12" stop-opacity=".985"/>
      <stop offset=".58" stop-color="#07111d" stop-opacity=".965"/>
      <stop offset="1" stop-color="#090711" stop-opacity=".98"/>
    </linearGradient>
    <linearGradient id="fog" x1="0" y1="0" x2="1" y2="0">
      <stop stop-color="#28d7ff" stop-opacity="0"/>
      <stop offset=".30" stop-color="#d7eff7" stop-opacity=".07"/>
      <stop offset=".68" stop-color="#ddd6f5" stop-opacity=".055"/>
      <stop offset="1" stop-color="#ff465c" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="cyan" cx="0" cy="1" r="1"><stop stop-color="#22d3ee" stop-opacity=".055"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
    <radialGradient id="purple" cx="1" cy="1" r="1"><stop stop-color="#9f67ff" stop-opacity=".045"/><stop offset="1" stop-color="#9f67ff" stop-opacity="0"/></radialGradient>
    <pattern id="scan" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 1H10" stroke="#d9efff" stroke-opacity=".010"/></pattern>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="2" seed="27"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .028 0"/></filter>
    <style><![CDATA[
      .display{font-family:'Agency FB','DIN Condensed','Bahnschrift SemiCondensed','Arial Narrow','Microsoft YaHei',sans-serif;fill:#f4f7fb}
      .tech{font-family:'Cascadia Mono','Consolas','Microsoft YaHei',monospace;fill:#d9e4ee}
      .hero{font-size:60px;font-weight:900;letter-spacing:1.2px}
      .kicker{font-size:16px;font-weight:900;letter-spacing:5px;fill:#a8b8c8}
      .sub{font-size:19px;font-weight:800;letter-spacing:.6px;fill:#c7d1db}
      .label{font-size:13px;font-weight:900;letter-spacing:1.8px;fill:#8998a8}
      .value{font-size:27px;font-weight:900;letter-spacing:.4px}
      .team-code{font-size:14px;font-weight:900;letter-spacing:4px;fill:#9eacba}
      .team-title{font-size:36px;font-weight:900;letter-spacing:.9px}
      .team-meta{font-size:16px;font-weight:900;letter-spacing:.7px;fill:#c3ced8}
      .commander-name{font-size:17px;font-weight:900;letter-spacing:.5px;fill:#e7edf3}
      .footer{font-size:14px;font-weight:900;letter-spacing:1.2px;fill:#8292a2}
    ]]></style>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
  <rect width="1600" height="1800" fill="url(#cyan)"/>
  <rect x="1600" width="1600" height="1800" fill="url(#purple)"/>
  <path d="M-180 420C420 300 820 530 1430 395C1990 270 2510 470 3380 290V560C2600 680 2020 495 1450 610C820 735 350 560-180 690Z" fill="url(#fog)" opacity=".28"/>
  <path d="M-240 1390C390 1240 830 1510 1440 1370C2070 1225 2570 1515 3400 1320V1720C2660 1810 2120 1580 1470 1735C830 1885 330 1635-240 1780Z" fill="url(#fog)" opacity=".16"/>
  <rect width="${W}" height="${H}" fill="url(#scan)" opacity=".30"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity=".08"/>

  <path d="M72 36H2110L2172 92H3128V220H72Z" fill="url(#plate)" stroke="#dce7f0" stroke-opacity=".18" stroke-width="2"/>
  <path d="M72 36H910" stroke="#28d7ff" stroke-width="5"/>
  <path d="M910 36H1430" stroke="#ffb547" stroke-width="5"/>
  <path d="M1430 36H1800" stroke="#ad72ff" stroke-width="5"/>
  <path d="M1800 36H2110" stroke="#ff465c" stroke-width="5"/>
  <text x="118" y="82" class="display kicker">BZSS // AFTER ACTION REPORT</text>
  <text x="112" y="148" class="display hero">${xml(clip(model.map.toUpperCase(), 34))}</text>
  <text x="116" y="186" class="display sub">${xml(clip(model.layer, 45))} / ${xml(clip(model.mode, 18))} / NEXT: ${xml(clip(model.next, 34))}</text>
  <text x="3102" y="72" text-anchor="end" class="tech label">${xml(model.time)}</text>

  ${metrics}
  ${model.teams.map(teamFrame).join("")}

  <path d="M80 1742H3120" fill="none" stroke="#dce8f1" stroke-opacity=".16" stroke-width="2"/>
  <path d="M80 1742H520" stroke="#28d7ff" stroke-width="3"/>
  <path d="M2680 1742H3120" stroke="#ff465c" stroke-width="3"/>
  <text x="90" y="1780" class="tech footer">BZSS TACTICAL DATA / MATCH END SNAPSHOT</text>
  <text x="3110" y="1780" text-anchor="end" class="tech footer">${xml(clip(model.server, 54))}</text>
</svg>`;
}

function metricCard(x, label, value, accent) {
  return `<g>
    <rect x="${x}" y="92" width="270" height="82" fill="#03070d" fill-opacity=".86" stroke="#d9e4ee" stroke-opacity=".14" stroke-width="2"/>
    <rect x="${x}" y="92" width="6" height="82" fill="${accent}" opacity=".88"/>
    <rect x="${x + 18}" y="107" width="78" height="2" fill="${accent}" opacity=".65"/>
    <text x="${x + 22}" y="132" class="tech label">${label}</text>
    <text x="${x + 22}" y="164" class="display value">${xml(clip(value, 12))}</text>
  </g>`;
}

function teamFrame(team) {
  const x = team.x;
  const y = 286;
  const w = 1550;
  const h = 1418;
  const headerH = 154;
  const ping = team.ping == null ? "--" : `${team.ping}MS`;
  const avatarX = x + w - 376;
  const avatarY = y + 40;
  const avatarSize = 62;
  const flagX = x + 28;
  const flagY = y + 42;
  const flagW = 84;
  const flagH = 52;

  return `<g>
    <rect x="${x - 8}" y="${y - 8}" width="${w + 16}" height="${h + 16}" fill="none" stroke="#02050a" stroke-opacity=".90" stroke-width="20"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${team.accent}" stroke-opacity=".30" stroke-width="2"/>
    <path d="M${x} ${y + 100}V${y}H${x + 250}" fill="none" stroke="${team.accent}" stroke-width="5"/>
    <path d="M${x + w - 250} ${y}H${x + w}V${y + 100}" fill="none" stroke="${team.secondary}" stroke-width="5"/>

    <path fill="url(#plate)" fill-rule="evenodd" d="M${x + 12} ${y + 12}H${x + w - 12}V${y + headerH}H${x + 12}Z
      M${avatarX - 5} ${avatarY - 5}H${avatarX + avatarSize + 5}V${avatarY + avatarSize + 5}H${avatarX - 5}Z"/>
    <rect x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${headerH - 12}" fill="none" stroke="${team.accent}" stroke-opacity=".28" stroke-width="2"/>
    ${renderFlag(team.factionCode, flagX, flagY, flagW, flagH)}
    ${renderFlagWatermark(team.factionCode, x + 820, y + 24, 430, 118)}

    <rect x="${x + 126}" y="${y + 34}" width="122" height="3" fill="${team.secondary}" opacity=".72"/>
    <text x="${x + 126}" y="${y + 62}" class="display team-code">TACTICAL GROUP ${String(team.id).padStart(2, "0")} · ${xml(team.factionCode || "UNKNOWN")}</text>
    <text x="${x + 124}" y="${y + 103}" class="display team-title" fill="${team.accent}">TEAM ${team.id} · ${xml(clip(team.name.toUpperCase(), 31))}</text>
    <text x="${x + 126}" y="${y + 132}" class="tech team-meta">${team.playerCount} PLAYERS / ${team.squadCount} SQUADS / AVG ${ping}</text>

    <text x="${avatarX - 24}" y="${y + 58}" text-anchor="end" class="tech label">COMMANDER</text>
    <text x="${avatarX - 24}" y="${y + 92}" text-anchor="end" class="display commander-name">${xml(clip(team.commander.toUpperCase(), 18))}</text>
    <rect x="${avatarX - 5}" y="${avatarY - 5}" width="${avatarSize + 10}" height="${avatarSize + 10}" fill="none" stroke="${team.secondary}" stroke-opacity=".48" stroke-width="2"/>
    <path d="M${avatarX - 5} ${avatarY + 16}V${avatarY - 5}H${avatarX + 16}" fill="none" stroke="${team.secondary}" stroke-width="4"/>
    <path d="M${avatarX + avatarSize - 16} ${avatarY + avatarSize + 5}H${avatarX + avatarSize + 5}V${avatarY + avatarSize - 16}" fill="none" stroke="${team.accent}" stroke-width="4"/>

    <path d="M${x + 18} ${y + headerH + 14}H${x + w - 18}" stroke="#cbd8e3" stroke-opacity=".12" stroke-width="2"/>
    <path d="M${x + 18} ${y + headerH + 14}H${x + 440}" stroke="${team.accent}" stroke-opacity=".72" stroke-width="3"/>
    <path d="M${x + w - 360} ${y + headerH + 14}H${x + w - 18}" stroke="${team.secondary}" stroke-opacity=".60" stroke-width="3"/>
  </g>`;
}

function renderFlag(code, x, y, w, h) {
  const flag = String(code || "").toUpperCase();
  const border = `<rect x="${x - 2}" y="${y - 2}" width="${w + 4}" height="${h + 4}" fill="#02050a" stroke="#d7e0e8" stroke-opacity=".32" stroke-width="2"/>`;

  if (["USA", "USMC"].includes(flag)) {
    const stripeH = h / 13;
    const stripes = Array.from({ length: 13 }, (_, index) =>
      `<rect x="${x}" y="${y + index * stripeH}" width="${w}" height="${stripeH + .2}" fill="${index % 2 === 0 ? "#b22234" : "#f4f5f7"}"/>`,
    ).join("");
    return `<g>${border}${stripes}<rect x="${x}" y="${y}" width="${w * .42}" height="${stripeH * 7}" fill="#3c3b6e"/><text x="${x + w * .21}" y="${y + stripeH * 4.7}" text-anchor="middle" class="tech" font-size="13" font-weight="900" fill="#fff">✦</text></g>`;
  }

  if (["RGF", "VDV"].includes(flag)) {
    return `<g>${border}<rect x="${x}" y="${y}" width="${w}" height="${h / 3}" fill="#f4f5f7"/><rect x="${x}" y="${y + h / 3}" width="${w}" height="${h / 3}" fill="#244a9b"/><rect x="${x}" y="${y + h * 2 / 3}" width="${w}" height="${h / 3}" fill="#d52b1e"/></g>`;
  }

  if (flag === "BAF") {
    return `<g>${border}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#163b73"/><path d="M${x} ${y}L${x + w} ${y + h}M${x + w} ${y}L${x} ${y + h}" stroke="#fff" stroke-width="${Math.max(8, h * .20)}"/><path d="M${x} ${y}L${x + w} ${y + h}M${x + w} ${y}L${x} ${y + h}" stroke="#c8102e" stroke-width="${Math.max(4, h * .09)}"/><path d="M${x + w / 2} ${y}V${y + h}M${x} ${y + h / 2}H${x + w}" stroke="#fff" stroke-width="${Math.max(10, h * .25)}"/><path d="M${x + w / 2} ${y}V${y + h}M${x} ${y + h / 2}H${x + w}" stroke="#c8102e" stroke-width="${Math.max(5, h * .12)}"/></g>`;
  }

  if (["PLA", "PLAAGF", "PLANMC"].includes(flag)) {
    return `<g>${border}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#de2910"/><text x="${x + w * .24}" y="${y + h * .67}" text-anchor="middle" font-size="${h * .62}" font-weight="900" fill="#ffde00">★</text></g>`;
  }

  if (flag === "AFU") {
    return `<g>${border}<rect x="${x}" y="${y}" width="${w}" height="${h / 2}" fill="#0057b7"/><rect x="${x}" y="${y + h / 2}" width="${w}" height="${h / 2}" fill="#ffd700"/></g>`;
  }

  if (flag === "CAF") {
    return `<g>${border}<rect x="${x}" y="${y}" width="${w * .25}" height="${h}" fill="#d80621"/><rect x="${x + w * .25}" y="${y}" width="${w * .5}" height="${h}" fill="#fff"/><rect x="${x + w * .75}" y="${y}" width="${w * .25}" height="${h}" fill="#d80621"/><text x="${x + w / 2}" y="${y + h * .68}" text-anchor="middle" font-size="${h * .48}" font-weight="900" fill="#d80621">◆</text></g>`;
  }

  if (flag === "ADF") {
    return `<g>${border}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#123b76"/><text x="${x + w * .72}" y="${y + h * .67}" text-anchor="middle" font-size="${h * .55}" font-weight="900" fill="#fff">✦</text><rect x="${x}" y="${y}" width="${w * .42}" height="${h * .52}" fill="#1f315f"/><path d="M${x} ${y}L${x + w * .42} ${y + h * .52}M${x + w * .42} ${y}L${x} ${y + h * .52}" stroke="#fff" stroke-width="${h * .09}"/><path d="M${x + w * .21} ${y}V${y + h * .52}M${x} ${y + h * .26}H${x + w * .42}" stroke="#c8102e" stroke-width="${h * .07}"/></g>`;
  }

  if (flag === "TLF") {
    return `<g>${border}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e30a17"/><circle cx="${x + w * .42}" cy="${y + h / 2}" r="${h * .26}" fill="#fff"/><circle cx="${x + w * .48}" cy="${y + h / 2}" r="${h * .21}" fill="#e30a17"/><text x="${x + w * .68}" y="${y + h * .66}" text-anchor="middle" font-size="${h * .42}" fill="#fff">★</text></g>`;
  }

  if (["MEA", "MEI"].includes(flag)) {
    return `<g>${border}<rect x="${x}" y="${y}" width="${w}" height="${h / 3}" fill="#1a1a1a"/><rect x="${x}" y="${y + h / 3}" width="${w}" height="${h / 3}" fill="#f5f5f5"/><rect x="${x}" y="${y + h * 2 / 3}" width="${w}" height="${h / 3}" fill="#15803d"/><path d="M${x} ${y}L${x + w * .34} ${y + h / 2}L${x} ${y + h}Z" fill="#b91c1c"/></g>`;
  }

  return `<g>${border}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#111827"/><rect x="${x}" y="${y}" width="7" height="${h}" fill="#64748b"/><text x="${x + w / 2}" y="${y + h * .64}" text-anchor="middle" class="tech" font-size="${Math.max(13, h * .28)}" font-weight="900" fill="#dbe4ec">${xml(flag || "N/A")}</text></g>`;
}

function renderFlagWatermark(code, x, y, w, h) {
  return `<g opacity=".055">${renderFlag(code, x, y, w, h)}</g>`;
}

function resolveFactionCode(...values) {
  const source = values.flat(Infinity).map((value) => String(value ?? "").toUpperCase()).join(" | ");
  const direct = source.match(/PLAAGF|PLANMC|USMC|WPMC|ADF|AFU|BAF|CAF|CRF|GFI|IMF|MEA|MEI|RGF|TLF|USA|VDV|PLA/);
  if (direct) return direct[0];
  if (/UNITED STATES.*MARINE|U\.?S\.?\s*MARINE/.test(source)) return "USMC";
  if (/UNITED STATES|US ARMY|U\.?S\.?\s*ARMY/.test(source)) return "USA";
  if (/RUSSIAN.*AIRBORNE|RUSSIAN.*VDV/.test(source)) return "VDV";
  if (/RUSSIAN|RUSSIAN GROUND|COMBINED ARMS ARMY|ARMY CORPS/.test(source)) return "RGF";
  if (/PEOPLE.S LIBERATION ARMY.*MARINE|CHINESE.*MARINE/.test(source)) return "PLANMC";
  if (/PEOPLE.S LIBERATION ARMY.*GROUND|CHINESE.*GROUND/.test(source)) return "PLAAGF";
  if (/PEOPLE.S LIBERATION ARMY|CHINESE/.test(source)) return "PLA";
  if (/BRITISH|UNITED KINGDOM/.test(source)) return "BAF";
  if (/CANADIAN|CANADA/.test(source)) return "CAF";
  if (/AUSTRALIAN|AUSTRALIA/.test(source)) return "ADF";
  if (/UKRAINIAN|UKRAINE/.test(source)) return "AFU";
  if (/MIDDLE EASTERN ALLIANCE/.test(source)) return "MEA";
  if (/MIDDLE EASTERN INSURGENT/.test(source)) return "MEI";
  if (/INSURGENT/.test(source)) return "IMF";
  if (/IRREGULAR MILITIA|MILITIA/.test(source)) return "GFI";
  if (/TURKISH|TURKEY/.test(source)) return "TLF";
  return "";
}

async function loadSharp() {
  if (!sharpPromise) sharpPromise = import("sharp").then((module) => module.default ?? module).catch(() => require("sharp"));
  return sharpPromise;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}H ${minutes}M`;
  if (minutes) return `${minutes}M ${secs}S`;
  return `${secs}S`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value, "-") : date.toLocaleString("zh-CN", { hour12: false });
}

function finite(value) {
  const number = Number(value);
  return value == null || value === "" || !Number.isFinite(number) ? null : number;
}

function text(...values) {
  for (const value of values) {
    const result = String(value ?? "").trim();
    if (result) return result;
  }
  return "";
}

function clip(value, length) {
  const result = String(value ?? "");
  return result.length <= length ? result : `${result.slice(0, Math.max(1, length - 1))}…`;
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
