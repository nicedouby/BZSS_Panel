import type { CombatStats } from "../types/squad-admin.types";

export interface CombatScoreboardItem {
  key: string;
  label: string;
  shortLabel: string;
  value: number;
  tone: string;
}

export function buildCombatScoreboardItems(stats: CombatStats | null | undefined): CombatScoreboardItem[] {
  return [
    { key: "numKills", label: "Num kills", shortLabel: "Kills", value: statNumber(stats?.kills), tone: "kills" },
    { key: "numDeaths", label: "Num death", shortLabel: "Death", value: statNumber(stats?.deaths), tone: "deaths" },
    { key: "numWoundeds", label: "Num woundeds", shortLabel: "Wounded", value: statNumber(stats?.downs), tone: "woundeds" },
    { key: "numWounds", label: "Num wounds", shortLabel: "Wounds", value: statNumber(stats?.wounds), tone: "wounds" },
    { key: "numTeamKills", label: "Num TK", shortLabel: "TK", value: statNumber(stats?.tk), tone: "tk" },
    { key: "healPoints", label: "Heal point", shortLabel: "Heal", value: statNumber(stats?.healPoints), tone: "heal" },
    { key: "revivedPoints", label: "Revived points", shortLabel: "Revive", value: statNumber(stats?.revivedPoints ?? stats?.revives), tone: "revived" },
    { key: "teamworkScore", label: "Team work score", shortLabel: "Team", value: statNumber(stats?.teamworkScore), tone: "teamwork" },
    { key: "objectiveScore", label: "Objective score", shortLabel: "Obj", value: statNumber(stats?.objectiveScore), tone: "objective" },
    { key: "combatScore", label: "Combat score", shortLabel: "Combat", value: statNumber(stats?.combatScore), tone: "combat" },
  ];
}

function statNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.trunc(numeric);
}
