export const FIRETEAM_COLORS = Object.freeze({
  A: "#35D07F",
  B: "#A78BFA",
  C: "#22D3EE",
  UNKNOWN: "#334155",
});

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function normalizeFireTeamLabel(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return "";
  if (/^(?:A|ALPHA|A组|A組|火力组A|火力組A)$/.test(text)) return "A";
  if (/^(?:B|BRAVO|B组|B組|火力组B|火力組B)$/.test(text)) return "B";
  if (/^(?:C|CHARLIE|C组|C組|火力组C|火力組C)$/.test(text)) return "C";
  const match = text.match(/(?:FIRE\s*TEAM\s*|火力[组組]\s*)?([ABC])(?:\s*TEAM|[组組])?/);
  return match?.[1] ?? "";
}

export function normalizeFireTeamId(value) {
  const number = Number(value);
  return number === 1 ? "A" : number === 2 ? "B" : number === 3 ? "C" : "";
}

export function normalizeFireTeamIndex(value) {
  const number = Number(value);
  return number === 0 ? "A" : number === 1 ? "B" : number === 2 ? "C" : "";
}

function findFirst(source, keys) {
  for (const key of keys) {
    if (hasValue(source?.[key])) return { value: source[key], key };
  }
  return null;
}

export function resolvePlayerFireTeam(player, corePlayer = player?.bzssCore) {
  const labelKeys = ["fireTeam", "fireteam", "fireTeamName", "fireteamName"];
  const idKeys = ["fireTeamID", "fireteamID", "fireTeamId", "fireteamId"];
  const indexKeys = ["ftIndex", "fireTeamIndex", "fireteamIndex"];
  const sources = [
    ["player", player],
    ["bzssCore", corePlayer],
    ["bzssCore.soldierInfo", corePlayer?.soldierInfo],
  ];

  for (const [sourceName, source] of sources) {
    const found = findFirst(source, labelKeys);
    const fireTeam = normalizeFireTeamLabel(found?.value);
    if (fireTeam) return { fireTeam, fireTeamRaw: found.value, fireTeamSource: sourceName + "." + found.key };
  }
  for (const [sourceName, source] of sources) {
    const found = findFirst(source, idKeys);
    const fireTeam = normalizeFireTeamId(found?.value);
    if (fireTeam) return { fireTeam, fireTeamRaw: found.value, fireTeamSource: sourceName + "." + found.key };
  }
  for (const [sourceName, source] of sources) {
    const found = findFirst(source, indexKeys);
    const fireTeam = normalizeFireTeamIndex(found?.value);
    if (fireTeam) return { fireTeam, fireTeamRaw: found.value, fireTeamSource: sourceName + "." + found.key };
  }
  return { fireTeam: "", fireTeamRaw: null, fireTeamSource: "unknown" };
}

export function resolveSnapshotPlayerFireTeam(player) {
  return resolvePlayerFireTeam(player, player?.bzssCore);
}

export function fireTeamRank(value) {
  return value === "A" ? 0 : value === "B" ? 1 : value === "C" ? 2 : 3;
}
