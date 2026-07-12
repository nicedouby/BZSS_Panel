<template>
  <section class="team-column" :class="[teamColorClass, densityMode]">
    <header
      class="team-column-header"
      :class="{ 'has-flag': !!factionFlagUrl }"
      style="position: relative;"
    >
      <div v-if="factionFlagUrl" class="team-header-flag-bg">
        <img class="team-faction-bg-img" :src="factionFlagUrl" alt="" />
      </div>
      <div class="team-column-main">
        <!-- Title Row -->
        <div class="team-header-top-row">
          <h2 class="team-title-line">
            <span class="team-id-badge">TEAM {{ team.teamId }}</span>
            <span class="team-name" :title="team.teamName">{{ team.teamName }}</span>
          </h2>

          <img v-if="unitIconUrl" class="unit-icon" :src="unitIconUrl" alt="" />
        </div>

        <!-- Secondary Stats Chips -->
        <div class="team-secondary-stats">
          <TeamHeaderQuickStats
            :team-id="team.teamId"
            :ticket-count="team.ticketCount"
            :player-count="team.playerCount"
            :max-players="team.maxPlayers"
            :can-edit-tickets="canEditTickets"
            :class="teamColorClass"
            @edit-tickets="$emit('edit-tickets', props.team)"
          />

          <span class="team-stat-chip avg" title="队伍平均游戏时长">
            <svg class="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span class="tsc-label">均时</span>
            <span class="tsc-value">{{ teamAveragePlaytimeShortText }}</span>
          </span>
          <span class="team-stat-chip leader-avg" title="队长平均游戏时长">
            <svg class="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span class="tsc-label">队长</span>
            <span class="tsc-value">{{ teamLeaderAveragePlaytimeShortText }}</span>
          </span>
          <span class="team-stat-chip ping-avg" title="队伍平均延迟">
            <svg class="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V4" />
            </svg>
            <span class="tsc-label">均迟</span>
            <span class="tsc-value">{{ teamAveragePingText }}</span>
          </span>
          <span class="team-stat-chip squads" title="总小队数">
            <svg class="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
            </svg>
            <span class="tsc-label">小队</span>
            <span class="tsc-value">{{ team.squads.length }}</span>
          </span>
          <template v-if="isComfortable">
            <span class="team-stat-chip playtime-public" title="Steam 游戏时长公开玩家数">
              <span class="tsc-label">公开</span>
              <span class="tsc-value">{{ team.publicPlaytimePlayers }}</span>
            </span>
            <span class="team-stat-chip playtime-private" title="Steam 游戏时长私密玩家数">
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
        :health-lookup="healthLookup"
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
import TeamHeaderQuickStats from "./TeamHeaderQuickStats.vue";
import { extractPlaytimeHours } from "../../utils/squad-admin-adapter";
import { 获取战斗群旗帜, getUnitIconUrlByTeamName } from "../../shared/faction-assets/faction-data";

const props = defineProps<{
  team: TeamViewModel;
  playtimes: Record<string, any>;
  combatStatsLookup: Record<string, CombatStats>;
  healthLookup?: Record<string, number | null>;
  densityMode?: "comfortable" | "compact";
  multiSelectMode?: boolean;
  selectedPlayerIds?: Set<string | number>;
  canEditTickets?: boolean;
}>();

defineEmits<{
  (event: "select-player", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
  (event: "toggle-player-check", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
  (event: "select-squad", squad: SquadViewModel): void;
  (event: "edit-tickets", team: TeamViewModel): void;
}>();

const teamColorClass = computed(() => (props.team.teamColorType === "team1" ? "team1" : "team2"));
const isComfortable = computed(() => props.densityMode !== "compact");

const factionFlagUrl = computed(() => {
  return 获取战斗群旗帜(props.team.teamName);
});
const unitIconUrl = computed(() => {
  return getUnitIconUrlByTeamName(props.team.teamName);
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

const teamTicketText = computed(() => {
  const value = props.team.ticketCount;
  return value == null ? "--" : String(value);
});

const teamAveragePingText = computed(() => {
  const playersList = teamPlayers.value;
  const pings = playersList
    .map(p => p.bzssCorePing ?? p.ping)
    .filter((ping): ping is number => ping != null && Number.isFinite(ping) && ping >= 0);

  if (pings.length === 0) return "--";
  const sum = pings.reduce((acc, val) => acc + val, 0);
  return `${Math.round(sum / pings.length)}ms`;
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
  position: relative;
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
  padding: 7px 9px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.015)), rgba(255, 255, 255, 0.012)),
    var(--color-bg-card);
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: stretch;
  gap: 10px;
  transition: border-color 0.2s ease;
  position: relative;
  z-index: 1;
  overflow: hidden;
}

/* ─── Faction flag background with slanted fade (Avatar style) ───────────── */
.team-column.team2 .team-faction-top-bg {
  left: 0;
  right: auto;
}

/* Top flag background (similar to avatar style) */
.team-faction-top-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 70px;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(125deg, transparent 0%, rgba(0,0,0,0.1) 25%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,1) 100%);
  mask-image: linear-gradient(125deg, transparent 0%, rgba(0,0,0,0.1) 25%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,1) 100%);
  opacity: 0.85;
  transition: opacity 0.3s ease;
}
.team-faction-top-bg-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
  filter: saturate(0.8) brightness(0.9);
  transition: filter 0.3s ease;
}
.team-column:hover .team-faction-top-bg-img {
  filter: saturate(1) brightness(1.05);
}

.team-column-header > *:not(.team-header-flag-bg) {
  position: relative;
  z-index: 1;
}

.team-header-flag-bg {
  position: absolute;
  top: -50px;
  left: -50px;
  width: calc(100% + 100px);
  height: calc(100% + 100px);
  z-index: 0;
  pointer-events: none;
  overflow: visible;
  transform: rotate(-7deg);
  opacity: 0.22;
  mask-image: linear-gradient(135deg, rgba(0, 0, 0, 1) 15%, rgba(0, 0, 0, 0) 75%);
  -webkit-mask-image: linear-gradient(135deg, rgba(0, 0, 0, 1) 15%, rgba(0, 0, 0, 0) 75%);
}

.team-header-flag-bg .team-faction-bg-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  filter: blur(2px);
}


.team-column-main {
  flex: 1 1 auto;
  min-width: 0;
}

.unit-icon {
  align-self: center;
  display: block;
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex: 0 0 auto;
  padding: 2px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
}



.team-title-line {
  width: 100%;
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

/* ─── 队伍标题与主控制行 ─────────────────────────────────────────────────── */
.team-header-top-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.team-title-line {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--font-size-md);
  font-weight: 800;
  color: var(--color-text-primary);
  flex: 1 1 auto;
}

.team-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

@media (max-width: 720px) {
  .team-header-top-row {
    flex-wrap: wrap;
  }

  .team-header-actions {
    width: 100%;
    justify-content: flex-start;
  }
}

.team-id-badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
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



/* ─── 次要指标芯片行 ─────────────────────────────────────────────────────── */
.team-secondary-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
}

.team-stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
  font-size: 9px;
  white-space: nowrap;
  color: var(--color-text-secondary);
}

.chip-icon {
  width: 10px;
  height: 10px;
  opacity: 0.65;
  flex-shrink: 0;
}

.team-stat-chip.avg {
  color: var(--color-status-online);
  border-color: rgba(52, 211, 153, 0.2);
  background: rgba(52, 211, 153, 0.05);
}

.team-stat-chip.leader-avg {
  color: #fde68a;
  border-color: rgba(250, 204, 21, 0.2);
  background: rgba(250, 204, 21, 0.05);
}

.team-stat-chip.ping-avg {
  color: #a78bfa;
  border-color: rgba(167, 139, 250, 0.2);
  background: rgba(167, 139, 250, 0.05);
}

.team-stat-chip.squads {
  color: var(--color-text-secondary);
}

.tsc-label {
  color: var(--color-text-muted);
  font-size: 8px;
}

.tsc-value {
  color: inherit;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-size: 9px;
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
  padding: 5px 8px 5px;
}

.team-column.compact .unit-icon {
  padding: 1px;
}

.team-column.compact .team-secondary-stats {
  gap: 3px;
}

.team-column.compact .team-stat-chip {
  height: 16px;
  padding: 0 4px;
  font-size: 8px;
}

/* ─── 紧凑模式下的快速统计指标微调 ────────────────────────────────────────── */
.team-column.compact :deep(.team-quick-stat) {
  height: 16px;
  padding: 0 4px;
}

.team-column.compact :deep(.team-ticket-stat) {
  min-width: 48px;
  padding: 0 4px;
}

.team-column.compact :deep(.team-player-stat) {
  min-width: 62px;
  padding-bottom: 1px;
}

.team-column.compact :deep(.quick-stat-label) {
  font-size: 7px;
}

.team-column.compact :deep(.quick-stat-value),
.team-column.compact :deep(.quick-stat-limit),
.team-column.compact :deep(.quick-stat-divider) {
  font-size: 8px;
}

.team-column.compact :deep(.quick-stat-edit) {
  width: 7px;
  height: 7px;
}

.team-column.compact :deep(.player-capacity-track) {
  left: 4px;
  right: 4px;
  bottom: 0px;
  height: 1px;
}

.team-column.compact .squad-list {
  gap: 6px;
}
</style>

