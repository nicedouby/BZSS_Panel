<template>
  <section class="team-column" :class="teamColorClass">
    <header class="team-column-header">
      <div>
        <h2>{{ team.teamName }}</h2>
        <span class="team-player-count">{{ t("topbar.players", "", { count: team.playerCount }) }}</span>
        <span class="team-average-playtime">{{ teamAveragePlaytimeText }}</span>
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
</script>

<style scoped>
.team-column {
  display: flex;
  flex-direction: column;
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
  flex: 0 0 auto;
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

.team-average-playtime {
  display: block;
  margin-top: 4px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
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
