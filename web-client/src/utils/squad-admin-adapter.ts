/**
 * Squad Admin Console Adapter
 * 将原始数据转换为 ViewModel
 */

import type { RuntimePlayer } from "../stores/player.store";
import type { RuntimeSquad } from "../stores/squad.store";
import type { RuntimeTeam } from "../stores/match.store";
import type {
  PlayerRowViewModel,
  SquadLeaderRowViewModel,
  SquadViewModel,
  TeamViewModel,
  PlayerDetailViewModel,
  MatchHeaderData,
  SquadWarning,
} from "../types/squad-admin.types";

/**
 * 将 RuntimePlayer 转换为 PlayerRowViewModel
 */
export function adaptPlayerRow(
  player: RuntimePlayer,
  playtimeHours: number | null = null,
): PlayerRowViewModel {
  return {
    playerId: player.playerID ?? null,
    name: player.name || "Unknown",
    role: player.role || "Unknown Role",
    isLeader: Boolean(player.isLeader),
    isOnline: Boolean(player.online),
    teamId: player.teamID ?? null,
    squadId: player.squadID ?? null,
    steamId: player.steamID ?? null,
    eosId: player.eosID ?? null,
    ip: (player as any).current_ip || (player as any).ip || null,
    playtimeHours,
    raw: player,
  };
}

/**
 * 将小队的成员按 leader 分离
 * 返回 [leader, otherMembers]
 */
export function separateSquadLeader(
  members: RuntimePlayer[],
  playtimes: Record<string, any> = {},
): [SquadLeaderRowViewModel | null, PlayerRowViewModel[]] {
  const leader = members.find((m) => m.isLeader);
  const others = members.filter((m) => !m.isLeader);

  const leaderVm = leader
    ? (adaptPlayerRow(
        leader,
        extractPlaytimeHours(leader.steamID, playtimes),
      ) as SquadLeaderRowViewModel)
    : null;

  const memberVms = others.map((m) =>
    adaptPlayerRow(m, extractPlaytimeHours(m.steamID, playtimes)),
  );

  return [leaderVm, memberVms];
}

/**
 * 从 playtimes 缓存中提取小时数
 */
export function extractPlaytimeHours(
  steamId: string | null | undefined,
  playtimes: Record<string, any>,
): number | null {
  if (!steamId) return null;
  const playtime = playtimes[steamId];
  if (!playtime) return null;
  const seconds = Number(playtime.gameSeconds ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round((seconds / 3600) * 10) / 10; // 一位小数
}

/**
 * 将 RuntimeSquad 和成员转换为 SquadViewModel
 */
export function adaptSquad(
  squad: RuntimeSquad,
  members: RuntimePlayer[] = [],
  playtimes: Record<string, any> = {},
): SquadViewModel {
  const [leader, otherMembers] = separateSquadLeader(members, playtimes);

  const warnings: SquadWarning[] = [];
  if (members.length > 0 && !leader) {
    warnings.push({
      type: "no_leader",
      message: "No squad leader",
    });
  }

  const state =
    members.length === 0
      ? "empty"
      : !leader
        ? "no_leader"
        : "normal";

  return {
    squadId: squad.squadID ?? null,
    squadName: squad.squadName || squad.name || `Squad ${squad.squadID ?? "?"}`,
    teamId: squad.teamID ?? null,
    creatorName: squad.creatorName || "Unknown Creator",
    isLocked: Boolean(squad.locked),
    memberCount: members.length,
    maxMembers: squad.size ?? 9,
    leader,
    members: otherMembers,
    warnings,
    state,
  };
}

/**
 * 将 RuntimeTeam 转换为 TeamViewModel
 */
export function adaptTeam(
  runtimeTeam: RuntimeTeam,
  playtimes: Record<string, any> = {},
): TeamViewModel {
  const squads = runtimeTeam.squads.map((squad) =>
    adaptSquad(squad, squad.members ?? [], playtimes),
  );

  // 处理未分配玩家 (Unassigned squad)
  if (runtimeTeam.unassignedPlayers.length > 0) {
    squads.push(
      adaptSquad(
        {
          key: `${runtimeTeam.teamID}:unassigned`,
          teamID: runtimeTeam.teamID,
          squadID: null,
          squadName: "Unassigned",
          name: "Unassigned",
          locked: false,
          creatorName: "",
        },
        runtimeTeam.unassignedPlayers,
        playtimes,
      ),
    );
  }

  return {
    teamId: runtimeTeam.teamID,
    teamName: runtimeTeam.teamName,
    teamColorType: runtimeTeam.teamID === 1 ? "team1" : "team2",
    playerCount: runtimeTeam.playerCount,
    maxPlayers: 50, // 默认值，可从配置获取
    squads,
  };
}

/**
 * 将 RuntimePlayer 转换为 PlayerDetailViewModel
 */
export function adaptPlayerDetail(
  player: RuntimePlayer,
  playtimeHours: number | null = null,
): PlayerDetailViewModel {
  return {
    playerId: player.playerID ?? null,
    name: player.name || "Unknown",
    role: player.role || "Unknown Role",
    isLeader: Boolean(player.isLeader),
    isOnline: Boolean(player.online),
    teamId: player.teamID ?? null,
    squadId: player.squadID ?? null,
    steamId: player.steamID ?? null,
    eosId: player.eosID ?? null,
    ip: (player as any).current_ip || (player as any).ip || null,
    playtimeHours,
    source: (player as any).source || "unknown",
    controller: (player as any).controllerID || (player as any).controller || "",
    raw: player,
  };
}

/**
 * 根据战局数据构建 MatchHeaderData
 */
export function adaptMatchHeader(
  server: Record<string, any>,
  runtimeState: any,
  matchStore: any,
  matchSnapshot: any = null,
): MatchHeaderData {
  const snapshot = server.snapshot ?? server ?? {};
  const backendServerStatus = matchSnapshot?.serverStatus ?? {};
  const backendMatch = matchSnapshot?.match ?? {};
  const backendPlayers = matchSnapshot?.players ?? {};
  const backendSquads = matchSnapshot?.squads ?? {};
  const team1 = matchStore.team1Players?.length ?? 0;
  const team2 = matchStore.team2Players?.length ?? 0;
  const serverStatusUpdatedAt = toTimestamp(backendServerStatus.lastUpdatedAt);
  const playersUpdatedAt = toTimestamp(backendPlayers.lastUpdatedAt);
  const squadsUpdatedAt = toTimestamp(backendSquads.lastUpdatedAt);
  const runtimeUpdatedAt = Number(server.updatedAt ?? 0);
  const lastUpdateTime = Math.max(serverStatusUpdatedAt, playersUpdatedAt, squadsUpdatedAt, runtimeUpdatedAt);
  const tps = firstPositiveNumber(
    backendServerStatus.tps,
    snapshot.tps,
    snapshot.webStatus?.tps,
  );

  return {
    serverName: firstDisplayValue(
      backendServerStatus.serverName,
      backendServerStatus.name,
      snapshot.serverName,
      snapshot.name,
      snapshot.webStatus?.serverName,
      "BZSS Panel",
    ) ?? "BZSS Panel",
    mapName: firstDisplayValue(
      backendServerStatus.mapName,
      backendServerStatus.map,
      snapshot.mapName,
      snapshot.map,
      snapshot.layerName,
      snapshot.layer,
      snapshot.webStatus?.mapName,
      snapshot.webStatus?.map,
      backendMatch.map,
      "Unknown Map",
    ) ?? "Unknown Map",
    gameMode: firstDisplayValue(
      backendServerStatus.gameMode,
      backendServerStatus.mode,
      snapshot.gameMode,
      snapshot.mode,
      snapshot.webStatus?.gameMode,
      snapshot.webStatus?.mode,
      backendMatch.mode,
      "Unknown",
    ) ?? "Unknown",
    totalPlayers: team1 + team2,
    maxPlayers: firstFiniteNumber(
      backendServerStatus.maxPlayers,
      snapshot.maxPlayers,
      snapshot.webStatus?.maxPlayers,
    ) ?? 100,
    team1Count: team1,
    team2Count: team2,
    matchTimeSeconds: firstFiniteNumber(
      backendServerStatus.playtime,
      backendServerStatus.matchTimeSeconds,
      snapshot.playtime,
      snapshot.matchTimeSeconds,
      backendMatch.playtime,
    ) ?? 0,
    tps,
    rconStatus: (matchSnapshot?.rconStatus?.status ?? snapshot.webStatus?.rcon ?? snapshot.rconStatus ?? "unknown") as any,
    logsStatus: runtimeState?.lastError ? "stale" : "live",
    lastUpdateTime,
    serverStatusUpdatedAt,
    playersUpdatedAt,
    squadsUpdatedAt,
  };
}

/**
 * 搜索过滤
 */
export function filterSquadsBySearch(
  squads: SquadViewModel[],
  query: string,
): SquadViewModel[] {
  if (!query.trim()) return squads;

  const lowerQuery = query.toLowerCase();
  return squads.map((squad) => ({
    ...squad,
    members: squad.members.filter((member) =>
      isPlayerMatch(member, lowerQuery),
    ),
    leader: squad.leader && isPlayerMatch(squad.leader, lowerQuery)
      ? squad.leader
      : squad.leader && !squad.leader.name.toLowerCase().includes(lowerQuery)
        ? null
        : squad.leader,
  }));
}

function isPlayerMatch(player: PlayerRowViewModel, query: string): boolean {
  return (
    player.name.toLowerCase().includes(query)
    || player.role.toLowerCase().includes(query)
    || player.playerId?.toString().includes(query)
    || (player.steamId?.includes(query) ?? false)
    || (player.eosId?.toLowerCase().includes(query) ?? false)
    || (player.ip?.includes(query) ?? false)
  );
}

function toTimestamp(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function firstDisplayValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) continue;
      if (text === "Unknown" || text === "Unknown Server" || text === "Unknown Map" || text === "Unknown Layer") continue;
      return text;
    }
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }
  return undefined;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}
