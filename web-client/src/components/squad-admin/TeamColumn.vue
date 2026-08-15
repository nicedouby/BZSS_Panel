<template>
  <section class="team-column" :class="[teamColorClass, densityMode]">
    <header
      class="team-column-header"
      :class="{ 'has-flag': !!factionFlagUrl }"
      style="position: relative;"
      role="button"
      tabindex="0"
      :aria-label="`查看 TEAM ${team.teamId} 阵营详情`"
      @click="emit('select-team', team)"
      @keydown.enter.prevent="emit('select-team', team)"
      @keydown.space.prevent="emit('select-team', team)"
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
          <div class="team-ticket-controls" @click.stop @keydown.stop>
            <TeamHeaderQuickStats
              :team-id="team.teamId"
              :ticket-count="team.ticketCount"
              :player-count="team.playerCount"
              :max-players="team.maxPlayers"
              :can-edit-tickets="canEditTickets"
              :class="teamColorClass"
              @edit-tickets="$emit('edit-tickets', props.team)"
            />
          </div>

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

    <label class="team-search-wrapper">
      <span class="team-search-icon" aria-hidden="true">⌕</span>
      <input
        :value="searchQuery"
        type="search"
        class="team-search-input"
        :placeholder="`搜索 TEAM ${team.teamId} 玩家或小队`"
        @input="handleSearch"
      />
    </label>

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
import { 获取战斗群旗帜, getFlagUrl, getUnitIconUrlByTeamName } from "../../shared/faction-assets/faction-data";

const props = defineProps<{
  team: TeamViewModel;
  playtimes: Record<string, any>;
  combatStatsLookup: Record<string, CombatStats>;
  healthLookup?: Record<string, number | null>;
  densityMode?: "comfortable" | "compact";
  multiSelectMode?: boolean;
  selectedPlayerIds?: Set<string | number>;
  canEditTickets?: boolean;
  searchQuery?: string;
}>();

const emit = defineEmits<{
  (event: "select-player", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
  (event: "toggle-player-check", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
  (event: "select-squad", squad: SquadViewModel): void;
  (event: "select-team", team: TeamViewModel): void;
  (event: "edit-tickets", team: TeamViewModel): void;
  (event: "warn-team", teamId: number): void;
  (event: "search", query: string): void;
}>();

function handleSearch(event: Event) {
  emit("search", (event.target as HTMLInputElement | null)?.value ?? "");
}

const teamColorClass = computed(() => (props.team.teamColorType === "team1" ? "team1" : "team2"));
const isComfortable = computed(() => props.densityMode !== "compact");

const factionFlagUrl = computed(() => {
  // factionCode comes from ShowServerInfo; keep team name as a legacy fallback.
  return getFlagUrl(props.team.factionCode ?? "") ?? 获取战斗群旗帜(props.team.teamName);
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
.team-search-wrapper {
  position: relative;
  display: block;
  flex: 0 0 auto;
}

.team-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-muted);
  pointer-events: none;
}

.team-search-input {
  width: 100%;
  height: 28px;
  padding: 0 9px 0 28px;
  border: 1px solid var(--color-border-soft);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.34);
  color: var(--color-text-primary);
  font-size: 11px;
  outline: none;
}

.team-search-input:focus {
  border-color: rgba(56, 189, 248, 0.5);
}

.team-column-header[role="button"] {
  cursor: pointer;
}

.team-column-header[role="button"]:focus-visible {
  outline: 2px solid rgba(56, 189, 248, .82);
  outline-offset: 2px;
}

.team-ticket-controls {
  display: contents;
}

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

/* ─── 队伍容器重构：身份区 + 核心状态区 + 统计区 ─────────────────────────── */
.team-column { gap: 10px; padding: 10px; border-radius: 16px; background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.012) 24%, transparent 60%), var(--color-bg-panel); box-shadow: 0 14px 34px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.045); }
.team-column.team1 { border-color: rgba(55,200,255,.34); background: radial-gradient(circle at 0% 0%, rgba(55,200,255,.18), transparent 34%), linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.012) 24%, transparent 60%), var(--color-bg-panel); }
.team-column.team2 { border-color: rgba(255,155,69,.34); background: radial-gradient(circle at 0% 0%, rgba(255,155,69,.16), transparent 34%), linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.012) 24%, transparent 60%), var(--color-bg-panel); }
.team-column-header { min-height: 128px; padding: 12px 13px 11px; border-radius: 13px; display: block; background: linear-gradient(135deg, rgba(255,255,255,.075), rgba(255,255,255,.018) 54%), rgba(7,12,23,.82); box-shadow: 0 8px 20px rgba(0,0,0,.2), inset 0 1px 0 rgba(255,255,255,.06); }
.team-column.team1 .team-column-header { border-top: 3px solid var(--color-team1-primary); border-color: rgba(55,200,255,.34); box-shadow: inset 0 1px 0 rgba(55,200,255,.16), 0 0 22px rgba(55,200,255,.08); }
.team-column.team2 .team-column-header { border-top: 3px solid var(--color-team2-primary); border-color: rgba(255,155,69,.34); box-shadow: inset 0 1px 0 rgba(255,155,69,.16), 0 0 22px rgba(255,155,69,.08); }
.team-column-main { display: grid; gap: 12px; }
.team-header-top-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; align-items: center; }
.team-title-line { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 15px; line-height: 1.15; }
.team-id-badge { height: 22px; padding: 0 8px; border-radius: 6px; font-size: 10px; letter-spacing: .08em; box-shadow: inset 0 1px 0 rgba(255,255,255,.14); }
.team-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 850; color: #f8fafc; text-shadow: 0 0 14px rgba(255,255,255,.12); }
.unit-icon { width: 34px; height: 34px; padding: 5px; border-radius: 10px; background: rgba(255,255,255,.07); box-shadow: 0 0 0 1px rgba(255,255,255,.1), 0 0 16px rgba(255,255,255,.08); }
.team-secondary-stats { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 6px; align-items: stretch; }
.team-stat-chip { min-width: 0; height: 34px; padding: 0 7px; display: grid; grid-template-columns: auto minmax(0,1fr); grid-template-rows: auto auto; column-gap: 5px; align-content: center; border-radius: 9px; border: 1px solid rgba(148,163,184,.16); background: rgba(255,255,255,.045); box-shadow: inset 0 1px 0 rgba(255,255,255,.04); }
.team-stat-chip .chip-icon { grid-row: 1 / span 2; align-self: center; width: 13px; height: 13px; opacity: .82; }
.team-stat-chip .tsc-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 8px; line-height: 1; letter-spacing: .04em; }
.team-stat-chip .tsc-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 1.1; font-weight: 850; }
.team-stat-chip.avg { color: #6ee7b7; border-color: rgba(52,211,153,.25); background: linear-gradient(135deg, rgba(52,211,153,.12), rgba(52,211,153,.035)); }
.team-stat-chip.leader-avg { color: #fde68a; border-color: rgba(250,204,21,.25); background: linear-gradient(135deg, rgba(250,204,21,.11), rgba(250,204,21,.035)); }
.team-stat-chip.ping-avg { color: #c4b5fd; border-color: rgba(167,139,250,.28); background: linear-gradient(135deg, rgba(167,139,250,.13), rgba(167,139,250,.035)); }
.team-stat-chip.squads { color: #cbd5e1; border-color: rgba(148,163,184,.22); }
.team-column.team1 .team-stat-chip.squads { border-color: rgba(55,200,255,.22); background: rgba(55,200,255,.06); }
.team-column.team2 .team-stat-chip.squads { border-color: rgba(255,155,69,.22); background: rgba(255,155,69,.06); }
.team-column.compact .team-column-header { min-height: 104px; padding: 9px 10px; }
.team-column.compact .team-column-main { gap: 8px; }
.team-column.compact .team-secondary-stats { gap: 4px; }
.team-column.compact .team-stat-chip { height: 28px; padding-inline: 5px; }
@media (max-width: 720px) {
  .team-column { padding: 7px; border-radius: 13px; }
  .team-column-header { min-height: 0; padding: 10px; }
  .team-name { font-size: 13px; }
  .team-secondary-stats { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .team-stat-chip { height: 32px; }
}

/* ─── 紧凑队伍头部与节省空间的旗帜显示 ───────────────────────────────────── */
.team-column {
  gap: 7px;
  padding: 7px;
  border-radius: 12px;
}

.team-column-header {
  min-height: 0;
  padding: 8px 9px;
  border-radius: 10px;
}

.team-column-main {
  gap: 7px;
}

.team-header-top-row {
  min-height: 25px;
  gap: 7px;
}

.team-title-line {
  gap: 6px;
  font-size: 13px;
}

.team-id-badge {
  height: 19px;
  padding: 0 6px;
  border-radius: 5px;
  font-size: 9px;
}

.team-name {
  font-size: 13px;
  line-height: 1.1;
}

.unit-icon {
  width: 25px;
  height: 25px;
  padding: 3px;
  border-radius: 7px;
}

/* 旗帜作为右侧装饰层，不再铺满整个头部 */
.team-header-flag-bg {
  top: 0;
  right: 0;
  left: auto;
  width: 112px;
  height: 100%;
  transform: none;
  opacity: .18;
  overflow: hidden;
  mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,.35) 35%, #000 100%);
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,.35) 35%, #000 100%);
}

.team-header-flag-bg .team-faction-bg-img {
  object-fit: cover;
  object-position: right center;
  filter: saturate(.7) brightness(.8);
}

.team-secondary-stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.team-stat-chip {
  height: 27px;
  padding: 0 5px;
  border-radius: 7px;
  column-gap: 3px;
}

.team-stat-chip .chip-icon {
  width: 10px;
  height: 10px;
}

.team-stat-chip .tsc-label {
  font-size: 7px;
}

.team-stat-chip .tsc-value {
  font-size: 10px;
}

.team-column .squad-list {
  gap: 6px;
}

@media (max-width: 720px) {
  .team-column {
    gap: 6px;
    padding: 6px;
  }

  .team-column-header {
    padding: 7px 8px;
  }

  .team-secondary-stats {
    gap: 3px;
  }

  .team-stat-chip {
    height: 25px;
    padding-inline: 4px;
  }

  .team-header-flag-bg {
    width: 82px;
    opacity: .14;
  }
}

/* ─── 高密度布局：最大化玩家列表可用空间 ─────────────────────────────────── */
.team-column {
  gap: 4px !important;
  padding: 4px !important;
  border-radius: 9px !important;
  box-shadow: none !important;
}

.team-column-header {
  min-height: 0 !important;
  height: auto !important;
  padding: 5px 7px !important;
  border-radius: 7px !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05) !important;
}

.team-column-main {
  gap: 4px !important;
}

.team-header-top-row {
  min-height: 20px !important;
  height: 20px !important;
  gap: 5px !important;
}

.team-title-line {
  gap: 4px !important;
  font-size: 11px !important;
  line-height: 1 !important;
}

.team-id-badge {
  height: 16px !important;
  padding: 0 5px !important;
  border-radius: 4px !important;
  font-size: 8px !important;
}

.team-name {
  font-size: 11px !important;
  font-weight: 800 !important;
  line-height: 1 !important;
}

.unit-icon {
  width: 19px !important;
  height: 19px !important;
  padding: 2px !important;
  border-radius: 5px !important;
}

/* 旗帜只保留为极窄的阵营识别背景 */
.team-header-flag-bg {
  width: 58px !important;
  opacity: .12 !important;
  mask-image: linear-gradient(90deg, transparent, #000) !important;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000) !important;
}

.team-secondary-stats {
  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  gap: 3px !important;
}

.team-stat-chip {
  height: 21px !important;
  min-height: 21px !important;
  padding: 0 4px !important;
  border-radius: 5px !important;
  column-gap: 3px !important;
  box-shadow: none !important;
}

.team-stat-chip .chip-icon {
  width: 8px !important;
  height: 8px !important;
}

.team-stat-chip .tsc-label {
  font-size: 6px !important;
  line-height: 1 !important;
}

.team-stat-chip .tsc-value {
  font-size: 8px !important;
  line-height: 1 !important;
  font-weight: 800 !important;
}

/* 让下方小队列表从紧凑头部中获得空间 */
.team-column .squad-list {
  gap: 4px !important;
  padding-right: 1px !important;
}

.team-column.compact .team-column-header {
  min-height: 0 !important;
  height: auto !important;
  padding: 4px 6px !important;
}

@media (max-width: 720px) {
  .team-column {
    gap: 3px !important;
    padding: 3px !important;
  }

  .team-column-header {
    padding: 4px 6px !important;
  }

  .team-header-top-row {
    height: 18px !important;
    min-height: 18px !important;
  }

  .team-secondary-stats {
    gap: 2px !important;
  }

  .team-stat-chip {
    height: 19px !important;
    min-height: 19px !important;
    padding-inline: 3px !important;
  }

  .team-stat-chip .chip-icon {
    display: none;
  }
}

/* ─── 恢复早期旗帜背景，并修正统计区横向排布 ─────────────────────────────── */
.team-header-flag-bg {
  top: -42px !important;
  left: -38px !important;
  right: auto !important;
  width: calc(100% + 76px) !important;
  height: calc(100% + 84px) !important;
  transform: rotate(-7deg) translate(-5px, 2px) !important;
  opacity: .22 !important;
  mask-image: linear-gradient(135deg, rgba(0,0,0,1) 15%, rgba(0,0,0,0) 75%) !important;
  -webkit-mask-image: linear-gradient(135deg, rgba(0,0,0,1) 15%, rgba(0,0,0,0) 75%) !important;
}

.team-header-flag-bg .team-faction-bg-img {
  object-fit: cover !important;
  object-position: center !important;
  filter: blur(2px) saturate(.85) brightness(.9) !important;
}

/* 第一项是票数+在线人数组合，和其余统计项保持一行 */
.team-secondary-stats {
  display: grid !important;
  grid-template-columns: minmax(112px, 1.35fr) repeat(4, minmax(0, 1fr)) !important;
  grid-auto-flow: row !important;
  align-items: center !important;
  gap: 3px !important;
}

.team-secondary-stats > :deep(.team-header-actions) {
  min-width: 0;
  width: 100%;
}

.team-column.compact .team-secondary-stats {
  grid-template-columns: minmax(100px, 1.25fr) repeat(4, minmax(0, 1fr)) !important;
}

/* 舒适模式中的公开/私密数据另起一行，但不撑高核心统计 */
.team-secondary-stats > .playtime-public,
.team-secondary-stats > .playtime-private {
  grid-row: 2;
  height: 18px !important;
}

@media (max-width: 720px) {
  .team-secondary-stats {
    grid-template-columns: minmax(96px, 1.2fr) repeat(2, minmax(0, 1fr)) !important;
  }

  .team-header-flag-bg {
    top: -30px !important;
    left: -28px !important;
    width: calc(100% + 56px) !important;
    height: calc(100% + 60px) !important;
  }
}


/* Keep the faction flag as a compact left accent instead of a full-header backdrop. */
.team-header-flag-bg {
  top: -16px !important;
  left: -22px !important;
  right: auto !important;
  width: 138px !important;
  height: calc(100% + 32px) !important;
  transform: rotate(-6deg) !important;
  opacity: .2 !important;
  mask-image: linear-gradient(108deg, #000 0%, rgba(0, 0, 0, .78) 48%, transparent 100%) !important;
  -webkit-mask-image: linear-gradient(108deg, #000 0%, rgba(0, 0, 0, .78) 48%, transparent 100%) !important;
}

.team-header-flag-bg .team-faction-bg-img {
  object-fit: cover !important;
  object-position: left center !important;
  filter: blur(1px) saturate(.9) brightness(.9) !important;
}

@media (max-width: 720px) {
  .team-header-flag-bg {
    left: -18px !important;
    width: 112px !important;
  }
}


</style>
