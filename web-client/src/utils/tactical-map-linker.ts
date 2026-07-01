import type { BzssCoreTrackedPlayerInfo, BzssCoreTrackedVector } from "../app/bzssCoreApi";
import type { RuntimePlayer } from "../stores/player.store";

export type TacticalLinkConfidence = "exact" | "strong" | "weak" | "none";

export interface TacticalLinkedPlayer extends BzssCoreTrackedPlayerInfo {
  key: string;
  bzss: BzssCoreTrackedPlayerInfo;
  runtime: RuntimePlayer | null;
  steamId: string | null;
  eosId: string | null;
  role: string;
  isLeader: boolean;
  health: number | null;
  position: BzssCoreTrackedVector | null;
  yaw: number | null;
  vehicleInfo?: BzssCoreTrackedPlayerInfo["vehicleInfo"];
  linkConfidence: TacticalLinkConfidence;
  linkReason: string;
}

export interface TacticalPlayerLinkInput {
  bzssPlayers: BzssCoreTrackedPlayerInfo[];
  runtimePlayers?: RuntimePlayer[];
  bySteamID?: Record<string, RuntimePlayer>;
  byEOSID?: Record<string, RuntimePlayer>;
  byPlayerID?: Record<string, RuntimePlayer>;
  byName?: Record<string, RuntimePlayer>;
}

export interface TacticalRuntimePlayerMatch {
  runtime: RuntimePlayer | null;
  linkConfidence: TacticalLinkConfidence;
  linkReason: string;
}

export function linkTacticalPlayers(input: TacticalPlayerLinkInput): TacticalLinkedPlayer[] {
  const runtimePlayers = Array.isArray(input.runtimePlayers) ? input.runtimePlayers : [];
  return (input.bzssPlayers ?? []).map((bzssPlayer) => {
    const runtimeMatch = resolveRuntimePlayerForBzssPlayer(bzssPlayer, {
      runtimePlayers,
      bySteamID: input.bySteamID,
      byEOSID: input.byEOSID,
      byPlayerID: input.byPlayerID,
      byName: input.byName,
    });

    const runtime = runtimeMatch.runtime;
    const steamId = normalizeSteam64(runtime?.steamID ?? runtime?.steam64 ?? bzssPlayer.playerGuid);
    const eosId = normalizeEOSID(runtime?.eosID ?? (normalizeSteam64(bzssPlayer.playerGuid) ? "" : bzssPlayer.playerGuid));
    const playerName = String(runtime?.name ?? bzssPlayer.playerName ?? "").trim() || "Unknown";
    const playerId = runtime?.playerID ?? bzssPlayer.playerId ?? null;
    const playerIndex = bzssPlayer.playerIndex ?? null;
    const teamId = runtime?.teamID ?? bzssPlayer.teamId ?? null;
    const squadId = runtime?.squadID ?? bzssPlayer.squadId ?? null;
    const role = String(runtime?.role ?? resolveBzssRole(bzssPlayer)).trim() || "Unknown Role";
    const isLeader = runtime?.isLeader ?? resolveBzssLeaderFlag(bzssPlayer);
    const position = bzssPlayer.soldierInfo?.position ?? bzssPlayer.position ?? null;
    const yaw = bzssPlayer.yaw ?? bzssPlayer.soldierInfo?.rotation?.z ?? bzssPlayer.soldierInfo?.rotation?.y ?? null;
    const health = normalizeNumeric(bzssPlayer.soldierInfo?.health);
    const vehicleInfo = bzssPlayer.vehicleInfo ?? undefined;

    return {
      ...bzssPlayer,
      key: buildTacticalPlayerKey({
        ...bzssPlayer,
        playerId,
        playerIndex,
        playerGuid: bzssPlayer.playerGuid ?? "",
        playerName,
      }, runtime),
      bzss: bzssPlayer,
      runtime,
      playerId,
      playerIndex,
      playerName,
      playerGuid: String(bzssPlayer.playerGuid ?? ""),
      teamId,
      squadId,
      steamId: steamId || null,
      eosId: eosId || null,
      role,
      isLeader: Boolean(isLeader),
      health,
      position,
      yaw,
      vehicleInfo,
      linkConfidence: runtimeMatch.linkConfidence,
      linkReason: runtimeMatch.linkReason,
    };
  });
}

export function resolveRuntimePlayerForBzssPlayer(
  bzssPlayer: BzssCoreTrackedPlayerInfo,
  input: {
    runtimePlayers?: RuntimePlayer[];
    bySteamID?: Record<string, RuntimePlayer>;
    byEOSID?: Record<string, RuntimePlayer>;
    byPlayerID?: Record<string, RuntimePlayer>;
    byName?: Record<string, RuntimePlayer>;
  },
): TacticalRuntimePlayerMatch {
  const runtimePlayers = Array.isArray(input.runtimePlayers) ? input.runtimePlayers : [];
  const directGuid = String(bzssPlayer.playerGuid ?? "").trim();
  const playerId = normalizePlayerId(bzssPlayer.playerId);
  const playerName = String(bzssPlayer.playerName ?? "").trim();

  const steam64 = normalizeSteam64(directGuid);
  if (steam64) {
    const match = lookupRuntimePlayerBySteam64(steam64, input.bySteamID, runtimePlayers);
    if (match) {
      return {
        runtime: match,
        linkConfidence: "exact",
        linkReason: "Steam64 直接匹配",
      };
    }
  }

  const eosId = normalizeEOSID(directGuid);
  if (eosId) {
    const match = lookupRuntimePlayerByEOSID(eosId, input.byEOSID, runtimePlayers);
    if (match) {
      return {
        runtime: match,
        linkConfidence: "exact",
        linkReason: "EOSID 直接匹配",
      };
    }
  }

  if (playerId != null) {
    const match = lookupRuntimePlayerByPlayerID(playerId, input.byPlayerID, runtimePlayers);
    if (match) {
      return {
        runtime: match,
        linkConfidence: "strong",
        linkReason: "PlayerID 直接匹配",
      };
    }
  }

  if (playerName) {
    const exactMatch = lookupRuntimePlayerByName(playerName, input.byName, runtimePlayers);
    if (exactMatch) {
      return {
        runtime: exactMatch.runtime,
        linkConfidence: exactMatch.linkConfidence,
        linkReason: exactMatch.linkReason,
      };
    }
  }

  const fuzzyMatch = findFuzzyRuntimePlayerMatch(bzssPlayer, runtimePlayers);
  if (fuzzyMatch.runtime) {
    return fuzzyMatch;
  }

  return {
    runtime: null,
    linkConfidence: "none",
    linkReason: "未关联，仅保留 BZSS Core 数据",
  };
}

export function buildTacticalPlayerKey(
  player: Pick<BzssCoreTrackedPlayerInfo, "playerId" | "playerIndex" | "playerGuid" | "playerName">,
  runtime?: RuntimePlayer | null,
): string {
  const playerIndex = normalizePlayerId(player.playerIndex ?? player.playerId ?? runtime?.playerID);
  if (playerIndex != null) return `idx:${playerIndex}`;

  const steam64 = normalizeSteam64(runtime?.steamID ?? runtime?.steam64 ?? player.playerGuid);
  if (steam64) return `steam:${steam64}`;

  const eosId = normalizeEOSID(runtime?.eosID ?? player.playerGuid);
  if (eosId) return `eos:${eosId}`;

  const playerName = normalizeIdentityName(runtime?.name ?? player.playerName);
  if (playerName) return `name:${playerName}`;

  return "player:unknown";
}

export function normalizeSteam64(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{17}$/.test(text) ? text : "";
}

export function normalizeEOSID(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^[0-9a-zA-Z]{32}$/.test(text) ? text.toLowerCase() : "";
}

export function normalizeIdentityName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeLooseIdentityName(value: unknown): string {
  return normalizeIdentityName(value).replace(/[^0-9a-z\u4e00-\u9fff]+/g, "");
}

function lookupRuntimePlayerBySteam64(
  steam64: string,
  bySteamID?: Record<string, RuntimePlayer>,
  runtimePlayers: RuntimePlayer[] = [],
) {
  const exact = bySteamID?.[steam64] ?? bySteamID?.[steam64.trim()];
  if (exact) return exact;
  return runtimePlayers.find((player) => normalizeSteam64(player.steamID ?? player.steam64) === steam64) ?? null;
}

function lookupRuntimePlayerByEOSID(
  eosId: string,
  byEOSID?: Record<string, RuntimePlayer>,
  runtimePlayers: RuntimePlayer[] = [],
) {
  const exact = byEOSID?.[eosId] ?? byEOSID?.[eosId.trim()] ?? byEOSID?.[eosId.toUpperCase()];
  if (exact) return exact;
  return runtimePlayers.find((player) => normalizeEOSID(player.eosID) === eosId) ?? null;
}

function lookupRuntimePlayerByPlayerID(
  playerId: number,
  byPlayerID?: Record<string, RuntimePlayer>,
  runtimePlayers: RuntimePlayer[] = [],
) {
  const exact = byPlayerID?.[String(playerId)] ?? byPlayerID?.[playerId as unknown as string];
  if (exact) return exact;
  return runtimePlayers.find((player) => normalizePlayerId(player.playerID) === playerId) ?? null;
}

function lookupRuntimePlayerByName(
  playerName: string,
  byName?: Record<string, RuntimePlayer>,
  runtimePlayers: RuntimePlayer[] = [],
): TacticalRuntimePlayerMatch | null {
  const normalized = normalizeIdentityName(playerName);
  const direct = byName?.[playerName] ?? byName?.[playerName.trim()];
  if (direct) {
    return {
      runtime: direct,
      linkConfidence: "strong",
      linkReason: "玩家名直接匹配",
    };
  }

  const exactMatch = runtimePlayers.find((player) => normalizeIdentityName(player.name) === normalized) ?? null;
  if (exactMatch) {
    return {
      runtime: exactMatch,
      linkConfidence: "strong",
      linkReason: "玩家名标准化匹配",
    };
  }

  return null;
}

function findFuzzyRuntimePlayerMatch(
  bzssPlayer: BzssCoreTrackedPlayerInfo,
  runtimePlayers: RuntimePlayer[],
): TacticalRuntimePlayerMatch {
  const targetName = normalizeIdentityName(bzssPlayer.playerName);
  const targetLoose = normalizeLooseIdentityName(bzssPlayer.playerName);
  if (!targetName && !targetLoose) {
    return {
      runtime: null,
      linkConfidence: "none",
      linkReason: "未找到可用于模糊匹配的名称",
    };
  }

  let best: RuntimePlayer | null = null;
  let bestScore = 0;
  let bestReason = "";
  for (const candidate of runtimePlayers) {
    const candidateName = normalizeIdentityName(candidate.name);
    const candidateLoose = normalizeLooseIdentityName(candidate.name);
    let score = 0;
    let reason = "";

    if (candidateName === targetName && targetName) {
      score = 90;
      reason = "玩家名完全匹配";
    } else if (candidateLoose === targetLoose && targetLoose) {
      score = 70;
      reason = "玩家名弱匹配";
    } else if (candidateName && targetName && (candidateName.includes(targetName) || targetName.includes(candidateName))) {
      score = 55;
      reason = "玩家名弱匹配";
    } else if (candidateLoose && targetLoose && (candidateLoose.includes(targetLoose) || targetLoose.includes(candidateLoose))) {
      score = 40;
      reason = "玩家名弱匹配";
    }

    if (score === 0) continue;

    if (normalizePlayerId(candidate.teamID) === normalizePlayerId(bzssPlayer.teamId)) score += 4;
    if (normalizePlayerId(candidate.squadID) === normalizePlayerId(bzssPlayer.squadId)) score += 2;
    if (Boolean(candidate.isLeader) === Boolean(isBzssLeader(bzssPlayer))) score += 1;

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      bestReason = reason;
    }
  }

  if (!best || bestScore < 35) {
    return {
      runtime: null,
      linkConfidence: "none",
      linkReason: "未找到可接受的名称弱匹配",
    };
  }

  return {
    runtime: best,
    linkConfidence: "weak",
    linkReason: `${bestReason}：${bzssPlayer.playerName} -> ${best.name}`,
  };
}

function resolveBzssRole(player: BzssCoreTrackedPlayerInfo): string {
  const role = String(player.soldierInfo?.soldierClass ?? player.soldierInfo?.weaponClass ?? "").trim();
  return role || "Unknown Role";
}

function resolveBzssLeaderFlag(player: BzssCoreTrackedPlayerInfo): boolean {
  const soldierClass = String(player.soldierInfo?.soldierClass ?? "").toLowerCase();
  return soldierClass.includes("squadleader") || soldierClass.includes("officer") || soldierClass.includes("sl");
}

function isBzssLeader(player: BzssCoreTrackedPlayerInfo): boolean {
  return resolveBzssLeaderFlag(player);
}

function normalizePlayerId(value: unknown): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeNumeric(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
