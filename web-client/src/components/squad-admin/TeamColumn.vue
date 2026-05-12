<template>
  <section class="team-column" :class="teamColorClass">
    <header class="team-column-header">
      <div class="team-column-title">
        <h2 class="team-title-line">
          <span class="team-id-badge">TEAM {{ team.teamId }}</span>
          <span class="team-name">{{ team.teamName }}</span>
        </h2>
        <p class="team-column-subtitle">
          <span>{{ t("topbar.players", "", { count: team.playerCount }) }}</span>
          <span class="team-subtitle-separator">·</span>
          <span>{{ teamAveragePlaytimeText }}</span>
        </p>
      </div>
      <div class="team-column-metrics">
        <div class="team-metric">
          <span>Strength</span>
          <strong>{{ team.playerCount }}/{{ team.maxPlayers }}</strong>
        </div>
        <div class="team-metric">
          <span>Avg</span>
          <strong>{{ teamAveragePlaytimeShortText }}</strong>
        </div>
        <div class="team-metric">
          <span>Squads</span>
          <strong>{{ team.squads.length }}</strong>
        </div>
      </div>
    </header>

    <div class="squad-list">
      <SquadCard
        v-for="squad in team.squads"
        :key="`${squad.squadId}`"
        :squad="squad"
        :selected-player-id="selectedPlayerId"
        @select-player="$emit('select-player', $event)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PlayerRowViewModel, TeamViewModel } from "../../types/squad-admin.types";
import SquadCard from "./SquadCard.vue";
import { t } from "../../i18n";

const props = defineProps<{
  team: TeamViewModel;
  selectedPlayerId?: string | number | null;
}>();

defineEmits<{
  (event: "select-player", player: PlayerRowViewModel): void;
}>();

const teamColorClass = computed(() => {
  return props.team.teamColorType === "team1" ? "team1" : "team2";
});

const teamAveragePlaytimeText = computed(() => {
  if (props.team.knownPlaytimePlayers <= 0) return "Steam 时长未加载";

  const privateText = props.team.privatePlaytimePlayers > 0
    ? ` / 未公开 ${props.team.privatePlaytimePlayers}`
    : "";

  if (props.team.averagePlaytimeHours == null) {
    return `平均时长 -- / 公开 0${privateText}`;
  }

  return `平均 ${props.team.averagePlaytimeHours}h / 公开 ${props.team.publicPlaytimePlayers}${privateText}`;
});

const teamAveragePlaytimeShortText = computed(() => {
  if (props.team.knownPlaytimePlayers <= 0) return "--";
  if (props.team.averagePlaytimeHours == null) return "--";
  return `${props.team.averagePlaytimeHours}h`;
});
</script>

<style scoped>
.team-column {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border-radius: var(--radius-lg);
  padding: 10px;
  border: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.008)),
    var(--color-bg-panel);
}

.team-column.team1 {
  background:
    linear-gradient(180deg, var(--color-team1-bg), transparent 240px),
    var(--color-bg-panel);
  border-color: var(--color-team1-border);
}

.team-column.team2 {
  background:
    linear-gradient(180deg, var(--color-team2-bg), transparent 240px),
    var(--color-bg-panel);
  border-color: var(--color-team2-border);
}

.team-column-header {
  flex: 0 0 auto;
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
    var(--color-bg-card);
  box-shadow: var(--shadow-sm);
  display: grid;
  gap: var(--spacing-md);
}

.team-column.team1 .team-column-header {
  border-top: 3px solid var(--color-team1-primary);
}

.team-column.team2 .team-column-header {
  border-top: 3px solid var(--color-team2-primary);
}

.team-column-title {
  min-width: 0;
}

.team-column-header h2 {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: 800;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.team-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-column-subtitle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  flex-wrap: wrap;
}

.team-subtitle-separator {
  color: var(--color-text-muted);
}

.team-id-badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 800;
  letter-spacing: 0.04em;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.045);
  color: var(--color-text-secondary);
  flex: 0 0 auto;
}

.team-column.team1 .team-id-badge {
  color: var(--color-team1-primary);
  border-color: var(--color-team1-border);
  background: var(--color-team1-soft);
}

.team-column.team2 .team-id-badge {
  color: var(--color-team2-primary);
  border-color: var(--color-team2-border);
  background: var(--color-team2-soft);
}

.team-column-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.team-metric {
  padding: 8px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.022);
  min-width: 0;
}

.team-metric span {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.team-metric strong {
  display: block;
  margin-top: 2px;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.squad-list {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--spacing-md);
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
  overscroll-behavior: contain;
}

.team-column.compact {
  gap: 8px;
}

.team-column.compact .team-column-header {
  padding: 10px;
}

.team-column.compact .team-column-metrics {
  gap: 6px;
}

.team-column.compact .squad-list {
  gap: 8px;
}

@media (max-width: 900px) {
  .team-column-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
