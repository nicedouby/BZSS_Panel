<template>
  <section class="team-column" :class="teamColorClass">
    <header class="team-column-header">
      <div>
        <h2>{{ team.teamName }}</h2>
        <span class="team-player-count">{{ team.playerCount }} players</span>
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
import type { TeamViewModel, PlayerRowViewModel } from "../../types/squad-admin.types";
import SquadCard from "./SquadCard.vue";

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
</script>

<style scoped>
.team-column {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--spacing-md);
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.team-column.team1 .team-column-header {
  border-top: 3px solid var(--color-team1-primary);
}

.team-column.team2 .team-column-header {
  border-top: 3px solid var(--color-team2-primary);
}

.team-column-header {
  padding: var(--spacing-md);
  background: var(--color-bg-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-default);
}

.team-column-header h2 {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--color-text-primary);
}

.team-player-count {
  display: block;
  margin-top: 4px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.squad-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--spacing-md);
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  align-content: start;
  overscroll-behavior: contain;
}

/* 紧凑模式 */
.team-column.compact {
  gap: 8px;
}

.team-column.compact .team-column-header {
  padding: 10px;
}

.team-column.compact .squad-list {
  gap: 8px;
}
</style>
