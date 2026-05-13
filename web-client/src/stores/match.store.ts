import { defineStore } from "pinia";
import { computed } from "vue";
import { usePlayerStore, type RuntimePlayer } from "./player.store";
import { useSquadStore, type RuntimeSquad } from "./squad.store";

export interface RuntimeTeam {
  teamID: number;
  teamName: string;
  squads: Array<RuntimeSquad & { members: RuntimePlayer[] }>;
  unassignedPlayers: RuntimePlayer[];
  playerCount: number;
}

export const useMatchStore = defineStore("match", () => {
  const players = usePlayerStore();
  const squads = useSquadStore();

  const teams = computed<RuntimeTeam[]>(() => {
    const map = new Map<number, RuntimeTeam>();
    for (const teamID of [1, 2]) {
      map.set(teamID, { teamID, teamName: `Team ${teamID}`, squads: [], unassignedPlayers: [], playerCount: 0 });
    }

    const squadMap = new Map<string, RuntimeSquad & { members: RuntimePlayer[] }>();
    for (const squad of squads.list) {
      if (squad.teamID == null || squad.squadID == null) continue;
      const team = ensureTeam(map, squad.teamID, squad.teamName);
      const entry = { ...squad, members: [] };
      team.squads.push(entry);
      squadMap.set(buildSquadKey(squad.teamID, squad.squadID, squad.generation), entry);
      squadMap.set(buildSquadKey(squad.teamID, squad.squadID), entry);
    }

    for (const player of players.active) {
      const teamID = player.teamID ?? 1;
      const team = ensureTeam(map, teamID);
      const squad = player.squadID != null ? squadMap.get(buildSquadKey(teamID, player.squadID)) : null;
      if (squad) squad.members.push(player);
      else team.unassignedPlayers.push(player);
      team.playerCount += 1;
    }

    return [...map.values()].map((team) => ({
      ...team,
      squads: team.squads.sort((a, b) => Number(a.squadID ?? 9999) - Number(b.squadID ?? 9999)),
    }));
  });

  const team1Players = computed(() => players.active.filter((player) => player.teamID === 1));
  const team2Players = computed(() => players.active.filter((player) => player.teamID === 2));
  const squadMembers = computed(() => {
    const members: Record<string, RuntimePlayer[]> = {};
    for (const player of players.active) {
      if (player.teamID == null || player.squadID == null) continue;
      const key = buildSquadKey(player.teamID, player.squadID);
      if (!members[key]) members[key] = [];
      members[key].push(player);
    }
    return members;
  });
  const unassignedPlayers = computed(() => players.active.filter((player) => player.squadID == null));
  const leaderList = computed(() => players.active.filter((player) => player.isLeader));

  return { teams, team1Players, team2Players, squadMembers, unassignedPlayers, leaderList };
});

function ensureTeam(map: Map<number, RuntimeTeam>, teamID: number, teamName = "") {
  if (!map.has(teamID)) {
    map.set(teamID, { teamID, teamName: teamName || `Team ${teamID}`, squads: [], unassignedPlayers: [], playerCount: 0 });
  }
  const team = map.get(teamID)!;
  if (teamName) team.teamName = teamName;
  return team;
}

function buildSquadKey(teamID: number | null | undefined, squadID: number | null | undefined, generation: number | null | undefined = null) {
  const base = `${String(teamID ?? "")}:${String(squadID ?? "")}`;
  const generationText = Number.isFinite(Number(generation)) && Number(generation) > 0 ? Math.trunc(Number(generation)) : null;
  return generationText == null ? base : `${base}:G${generationText}`;
}
