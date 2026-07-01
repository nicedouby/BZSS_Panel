import type { CombatStats } from "../types/squad-admin.types";

export interface CombatScoreboardItem {
  key: string;
  label: string;
  shortLabel: string;
  value: number | string;
  tone: string;
}

export function buildCombatScoreboardItems(
  stats: CombatStats | null | undefined,
  includeAll = false,
  latencyMs: number | null | undefined = null
): CombatScoreboardItem[] {
  const items: CombatScoreboardItem[] = [
    { key: "numKills", label: "击杀 / Kills", shortLabel: "k", value: statNumber(stats?.kills), tone: "kills" },
    { key: "numDeaths", label: "死亡 / Deaths", shortLabel: "d", value: statNumber(stats?.deaths), tone: "deaths" },
    { key: "numWoundeds", label: "击倒 / Downs", shortLabel: "w", value: statNumber(stats?.downs), tone: "woundeds" },
    { key: "numTeamKills", label: "队友击杀 / TeamKills (TK)", value: statNumber(stats?.tk), shortLabel: "tk", tone: "tk" },
    { key: "revivedPoints", label: "复苏数 / Revives", shortLabel: "r", value: statNumber(stats?.revivedPoints ?? stats?.revives), tone: "revived" },
  ];

  if (includeAll) {
    items.push(
      { key: "numWounds", label: "受伤次数 / Wounds", shortLabel: "wd", value: statNumber(stats?.wounds), tone: "wounds" },
      { key: "healPoints", label: "治疗量 / Heal Points", shortLabel: "h", value: statNumber(stats?.healPoints), tone: "heal" },
      { key: "teamworkScore", label: "团队合作分 / Teamwork Score", shortLabel: "t", value: statNumber(stats?.teamworkScore), tone: "teamwork" },
      { key: "objectiveScore", label: "目标分数 / Objective Score", shortLabel: "o", value: statNumber(stats?.objectiveScore), tone: "objective" },
      { key: "combatScore", label: "战斗分数 / Combat Score", shortLabel: "c", value: statNumber(stats?.combatScore), tone: "combat" }
    );
  }

  if (includeAll) {
    items.push({
      key: "latency",
      label: "网络延迟 / Ping",
      shortLabel: "p",
      value: formatLatency(latencyMs),
      tone: "latency",
    });
  }

  return items;
}

function statNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.trunc(numeric);
}

function formatLatency(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "--";
  return `${Math.round(numeric)} ms`;
}
