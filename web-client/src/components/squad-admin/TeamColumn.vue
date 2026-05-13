<template>
  <section class="team-column" :class="[teamColorClass, densityMode]">
    <header class="team-column-header">
      <div class="team-column-title">
        <h2 class="team-title-line">
          <span class="team-id-badge">TEAM {{ team.teamId }}</span>
          <span class="team-name">{{ team.teamName }}</span>
          <span class="team-count">{{ team.playerCount }}/{{ team.maxPlayers }}</span>
        </h2>
        <p class="team-column-subtitle" :class="{ compact: !isComfortable }">
          <span>{{ headerSummaryText }}</span>
        </p>
      </div>
    </header>

    <div class="squad-list">
      <SquadCard
        v-for="squad in team.squads"
        :key="`${squad.squadId}`"
        :squad="squad"
        :density-mode="densityMode"
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

const props = defineProps<{
  team: TeamViewModel;
  selectedPlayerId?: string | number | null;
  densityMode?: "comfortable" | "compact";
}>();

defineEmits<{
  (event: "select-player", player: PlayerRowViewModel): void;
}>();

const teamColorClass = computed(() => (props.team.teamColorType === "team1" ? "team1" : "team2"));
const isComfortable = computed(() => props.densityMode !== "compact");

const teamAveragePlaytimeShortText = computed(() => {
  if (props.team.knownPlaytimePlayers <= 0) return "--";
  if (props.team.averagePlaytimeHours == null) return "--";
  return `${props.team.averagePlaytimeHours}h`;
});

const headerSummaryText = computed(() => {
  const avg = `Avg ${teamAveragePlaytimeShortText.value}`;
  const squadsText = `Squads ${props.team.squads.length}`;

  if (!isComfortable.value) {
    return `${avg} · ${squadsText}`;
  }

  const publicText = `Public ${props.team.publicPlaytimePlayers}`;
  const privateText = `Private ${props.team.privatePlaytimePlayers}`;
  return `${avg} · ${publicText} · ${privateText} · ${squadsText}`;
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
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.01)), rgba(255, 255, 255, 0.008)),
    var(--color-bg-panel);
  box-shadow: var(--shadow-lg);
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
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.015)), rgba(255, 255, 255, 0.012)),
    var(--color-bg-card);
  box-shadow: var(--shadow-sm);
  display: grid;
  gap: 6px;
}

.team-column.team1 .team-column-header {
  border-top: 3px solid var(--color-team1-primary);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02), var(--shadow-sm);
}

.team-column.team2 .team-column-header {
  border-top: 3px solid var(--color-team2-primary);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02), var(--shadow-sm);
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

.team-count {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 700;
  flex: 0 0 auto;
}

.team-column-subtitle {
  margin: 4px 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.35;
}

.team-column-subtitle.compact {
  font-size: var(--font-size-xs);
}

.team-column-subtitle span {
  display: inline-block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  gap: 8px;
}

.team-column.compact .squad-list {
  gap: 8px;
}
</style>
