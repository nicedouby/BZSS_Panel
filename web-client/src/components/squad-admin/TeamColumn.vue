<template>
  <section class="team-column" :class="[teamColorClass, densityMode]">
    <header
      class="team-column-header"
      :class="{ 'has-flag': !!factionFlagUrl }"
      :style="factionFlagUrl ? { '--faction-flag-url': `url(${factionFlagUrl})` } : {}"
    >
      <!-- DEBUG -->
      <div style="position: absolute; top: 0; left: 0; font-size: 10px; color: yellow; background: rgba(0,0,0,0.8); padding: 2px; z-index: 999;">
        Flag: {{ factionFlagUrl ? 'YES' : 'NO' }} | Badge: {{ formationBadgeUrl ? 'YES' : 'NO' }}
      </div>
      <div class="team-column-title">
        <h2 class="team-title-line">
          <img v-if="formationBadgeUrl" class="formation-badge" :src="formationBadgeUrl" alt="" />
          <span class="team-id-badge">TEAM {{ team.teamId }}</span>
          <span class="team-name">{{ team.teamName }}</span>
        </h2>
        <div class="team-stats-row">
          <span class="team-stat-chip count">
            <span class="tsc-label">玩家</span>
            <span class="tsc-value">{{ team.playerCount }}/{{ team.maxPlayers }}</span>
          </span>
          <span class="team-stat-chip avg">
            <span class="tsc-label">均时</span>
            <span class="tsc-value">{{ teamAveragePlaytimeShortText }}</span>
          </span>
          <span class="team-stat-chip leader-avg">
            <span class="tsc-label">队长</span>
            <span class="tsc-value">{{ teamLeaderAveragePlaytimeShortText }}</span>
          </span>
          <span class="team-stat-chip squads">
            <span class="tsc-label">小队</span>
            <span class="tsc-value">{{ team.squads.length }}</span>
          </span>
          <template v-if="isComfortable">
            <span class="team-stat-chip">
              <span class="tsc-label">公开</span>
              <span class="tsc-value">{{ team.publicPlaytimePlayers }}</span>
            </span>
            <span class="team-stat-chip">
              <span class="tsc-label">私密</span>
              <span class="tsc-value">{{ team.privatePlaytimePlayers }}</span>
            </span>
          </template>
        </div>
      </div>
    </header>

    <div class="squad-list">
      <SquadCard
        v-for="squad in team.squads"
        :key="`${squad.squadId}`"
        :squad="squad"
        :playtimes="playtimes"
        :combat-stats-lookup="combatStatsLookup"
        :density-mode="densityMode"
        :multi-select-mode="multiSelectMode"
        :selected-player-ids="selectedPlayerIds"
        @select-player="($event) => $emit('select-player', $event)"
        @toggle-player-check="($event) => $emit('toggle-player-check', $event)"
        @select-squad="$emit('select-squad', $event)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PlayerRowViewModel, TeamViewModel, SquadViewModel, CombatStats, SquadLeaderRowViewModel } from "../../types/squad-admin.types";
import SquadCard from "./SquadCard.vue";
import { extractPlaytimeHours } from "../../utils/squad-admin-adapter";
import { getFlagUrlByTeamName, getBadgeUrl } from "../../shared/faction-assets/faction-data";

const props = defineProps<{
  team: TeamViewModel;
  playtimes: Record<string, any>;
  combatStatsLookup: Record<string, CombatStats>;
  densityMode?: "comfortable" | "compact";
  multiSelectMode?: boolean;
  selectedPlayerIds?: Set<string | number>;
}>();

defineEmits<{
  (event: "select-player", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
  (event: "toggle-player-check", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
  (event: "select-squad", squad: SquadViewModel): void;
}>();

const teamColorClass = computed(() => (props.team.teamColorType === "team1" ? "team1" : "team2"));
const isComfortable = computed(() => props.densityMode !== "compact");

const factionFlagUrl = computed(() => {
  const url = getFlagUrlByTeamName(props.team.teamName);
  console.log('[TeamColumn] factionFlagUrl:', { teamName: props.team.teamName, url });
  return url;
});
const formationBadgeUrl = computed(() => {
  const url = getBadgeUrl(props.team.teamName);
  console.log('[TeamColumn] formationBadgeUrl:', { teamName: props.team.teamName, url });
  return url;
});

const teamPlayers = computed(() => {
  return props.team.squads.flatMap((squad) => {
    return [
      ...(squad.leader ? [squad.leader] : []),
      ...squad.members,
    ];
  });
});

const teamPlaytimeSummary = computed(() => {
  const playersList = teamPlayers.value;
  const hoursList = playersList.map(p => extractPlaytimeHours(p.steamId, props.playtimes));

  const known = hoursList.filter((h) => h != null) as number[];
  const publicPlayers = known.filter((h) => h > 0);
  const privatePlayers = known.filter((h) => h === 0);

  const totalHours = publicPlayers.reduce((sum, h) => sum + h, 0);
  const average = publicPlayers.length > 0
    ? Math.round((totalHours / publicPlayers.length) * 10) / 10
    : null;

  return {
    averagePlaytimeHours: average,
    knownPlaytimePlayers: known.length,
    publicPlaytimePlayers: publicPlayers.length,
    privatePlaytimePlayers: privatePlayers.length,
  };
});

const teamLeaderPlaytimeSummary = computed(() => {
  const leaders = props.team.squads
    .filter((squad) => squad.squadId != null)
    .map((squad) => squad.leader)
    .filter((leader): leader is SquadLeaderRowViewModel => Boolean(leader));

  const hoursList = leaders.map(p => extractPlaytimeHours(p.steamId, props.playtimes));

  const known = hoursList.filter((h) => h != null) as number[];
  const publicPlayers = known.filter((h) => h > 0);

  const totalHours = publicPlayers.reduce((sum, h) => sum + h, 0);
  const average = publicPlayers.length > 0
    ? Math.round((totalHours / publicPlayers.length) * 10) / 10
    : null;

  return {
    averagePlaytimeHours: average,
    knownPlaytimePlayers: known.length,
  };
});

const teamAveragePlaytimeShortText = computed(() => {
  const summary = teamPlaytimeSummary.value;
  if (summary.knownPlaytimePlayers <= 0) return "--";
  if (summary.averagePlaytimeHours == null) return "--";
  return `${summary.averagePlaytimeHours}h`;
});

const teamLeaderAveragePlaytimeShortText = computed(() => {
  const summary = teamLeaderPlaytimeSummary.value;
  if (summary.knownPlaytimePlayers <= 0) return "--";
  if (summary.averagePlaytimeHours == null) return "--";
  return `${summary.averagePlaytimeHours}h`;
});
</script>

<style scoped>
/* ─── 队伍列主容器 ───────────────────────────────────────────────────────── */
.team-column {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border-radius: var(--radius-lg);
  padding: 8px;
  border: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.01)), rgba(255, 255, 255, 0.008)),
    var(--color-bg-panel);
  box-shadow: var(--shadow-lg);
  transition: border-color 0.2s ease;
}

.team-column.team1 {
  background:
    linear-gradient(160deg, rgba(55, 200, 255, 0.08) 0%, rgba(55, 200, 255, 0.02) 30%, transparent 55%),
    var(--color-bg-panel);
  border-color: var(--color-team1-border);
}

.team-column.team2 {
  background:
    linear-gradient(160deg, rgba(255, 155, 69, 0.08) 0%, rgba(255, 155, 69, 0.02) 30%, transparent 55%),
    var(--color-bg-panel);
  border-color: var(--color-team2-border);
}

/* ─── 队伍头部 ───────────────────────────────────────────────────────────── */
.team-column-header {
  flex: 0 0 auto;
  padding: 8px 10px 9px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.015)), rgba(255, 255, 255, 0.012)),
    var(--color-bg-card);
  box-shadow: var(--shadow-sm);
  display: grid;
  gap: 5px;
  transition: border-color 0.2s ease;
  position: relative;
  overflow: hidden;
}

.team-column-header.has-flag::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: var(--faction-flag-url);
  background-size: cover;
  background-position: center right;
  opacity: 0.25;
  pointer-events: none;
  z-index: 0;
  border: 2px solid red; /* DEBUG */
}

.team-column-header > * {
  position: relative;
  z-index: 1;
}

/* ─── 编制徽章 ───────────────────────────────────────────────────────────── */
.formation-badge {
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex: 0 0 auto;
  image-rendering: auto;
}

.team-column.team1 .team-column-header {
  border-top: 3px solid var(--color-team1-primary);
  border-color: var(--color-team1-border);
  box-shadow:
    inset 0 1px 0 rgba(55, 200, 255, 0.05),
    0 0 12px rgba(55, 200, 255, 0.04),
    var(--shadow-sm);
}

.team-column.team2 .team-column-header {
  border-top: 3px solid var(--color-team2-primary);
  border-color: var(--color-team2-border);
  box-shadow:
    inset 0 1px 0 rgba(255, 155, 69, 0.05),
    0 0 12px rgba(255, 155, 69, 0.04),
    var(--shadow-sm);
}

.team-column-title {
  min-width: 0;
}

/* ─── 队伍标题行 ─────────────────────────────────────────────────────────── */
.team-title-line {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: var(--font-size-lg);
  font-weight: 800;
  color: var(--color-text-primary);
}

.team-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-md);
}

.team-id-badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.045);
  color: var(--color-text-secondary);
  flex: 0 0 auto;
}

.team-column.team1 .team-id-badge {
  color: var(--color-team1-primary);
  border-color: var(--color-team1-border);
  background: var(--color-team1-soft);
  text-shadow: 0 0 8px rgba(55, 200, 255, 0.35);
}

.team-column.team2 .team-id-badge {
  color: var(--color-team2-primary);
  border-color: var(--color-team2-border);
  background: var(--color-team2-soft);
  text-shadow: 0 0 8px rgba(255, 155, 69, 0.35);
}

/* ─── 队伍统计芯片行 ─────────────────────────────────────────────────────── */
.team-stats-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.team-stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
  font-size: 10px;
  white-space: nowrap;
}

.team-stat-chip.count {
  border-color: rgba(140, 160, 185, 0.2);
}

.team-stat-chip.avg {
  color: var(--color-status-online);
  border-color: rgba(52, 211, 153, 0.22);
  background: rgba(52, 211, 153, 0.06);
}

.team-stat-chip.leader-avg {
  color: #fde68a;
  border-color: rgba(250, 204, 21, 0.22);
  background: rgba(250, 204, 21, 0.06);
}

.team-stat-chip.squads {
  color: var(--color-text-secondary);
}

.tsc-label {
  color: var(--color-text-muted);
  font-size: 9px;
}

.tsc-value {
  color: inherit;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.team-stat-chip.count .tsc-value {
  color: var(--color-text-secondary);
}

/* ─── 小队列表 ───────────────────────────────────────────────────────────── */
.squad-list {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
  overscroll-behavior: contain;
}

/* 滚动条样式 */
.squad-list::-webkit-scrollbar {
  width: 4px;
}

.squad-list::-webkit-scrollbar-track {
  background: transparent;
}

.squad-list::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: rgba(140, 160, 185, 0.2);
}

.squad-list::-webkit-scrollbar-thumb:hover {
  background: rgba(140, 160, 185, 0.35);
}

/* ─── 紧凑密度调整 ───────────────────────────────────────────────────────── */
.team-column.compact {
  gap: 6px;
}

.team-column.compact .team-column-header {
  padding: 7px 9px 8px;
}

.team-column.compact .squad-list {
  gap: 6px;
}
</style>
