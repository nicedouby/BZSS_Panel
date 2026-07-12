<template>
  <div class="team-header-actions">
    <button
      type="button"
      class="team-quick-stat team-ticket-stat"
      :class="{ clickable: canEditTickets }"
      :disabled="!canEditTickets"
      :title="canEditTickets ? '剩余票数：' + teamTicketText + '，点击修改' : '当前无法修改票数'"
      @click="$emit('edit-tickets')"
    >
      <span class="quick-stat-label">票</span>
      <strong class="quick-stat-value">{{ teamTicketText }}</strong>

      <svg
        v-if="canEditTickets"
        class="quick-stat-edit"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </svg>
    </button>

    <div
      class="team-quick-stat team-player-stat"
      :class="playerOccupancyTone"
      :title="`在线玩家 ${playerCount} / ${maxPlayers}`"
    >
      <span class="quick-stat-label">在线</span>

      <strong class="quick-stat-value">
        {{ playerCount }}
      </strong>

      <span class="quick-stat-divider">/</span>

      <span class="quick-stat-limit">
        {{ maxPlayers }}
      </span>

      <span class="player-capacity-track" aria-hidden="true">
        <span
          class="player-capacity-fill"
          :style="{ width: `${playerOccupancyPercent}%` }"
        />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    teamId: number;
    ticketCount: number | null;
    playerCount: number;
    maxPlayers: number;
    canEditTickets?: boolean;
  }>(),
  {
    canEditTickets: false,
  }
);

defineEmits<{
  (event: "edit-tickets"): void;
}>();

const teamTicketText = computed(() => {
  return props.ticketCount == null ? "--" : String(props.ticketCount);
});

const playerOccupancyPercent = computed(() => {
  const current = Number(props.playerCount ?? 0);
  const maximum = Number(props.maxPlayers ?? 0);

  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (current / maximum) * 100));
});

const playerOccupancyTone = computed(() => {
  const percent = playerOccupancyPercent.value;
  if (percent >= 96) return "full";
  if (percent >= 80) return "busy";
  return "normal";
});
</script>

<style scoped>
.team-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  flex: 0 0 auto;
}

.team-quick-stat {
  box-sizing: border-box;
  position: relative;
  height: 20px;
  min-width: 0;
  padding: 0 8px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.025);
  color: var(--color-text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}

.quick-stat-label {
  font-size: 8px;
  font-weight: 500;
  color: var(--color-text-muted);
}

.quick-stat-value {
  font-size: 9px;
  line-height: 1;
  font-weight: 800;
  color: var(--color-text-primary);
}

.quick-stat-divider {
  margin: 0 -1px;
  font-size: 9px;
  color: var(--color-text-muted);
  opacity: 0.55;
}

.quick-stat-limit {
  font-size: 9px;
  font-weight: 600;
  color: var(--color-text-muted);
}

.quick-stat-edit {
  width: 9px;
  height: 9px;
  opacity: 0.4;
  flex: 0 0 auto;
}

.team-ticket-stat {
  appearance: none;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-full);
  padding: 0 8px;
  margin: 0;
  font: inherit;
  color: var(--color-text-secondary);
  min-width: 58px;
  box-sizing: border-box;
  outline: none;
  box-shadow: none;
}

.team-ticket-stat.clickable {
  cursor: pointer;
}

.team-ticket-stat:disabled {
  cursor: default;
  opacity: 1;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--color-border-soft);
  box-shadow: none;
}

.team1 .team-ticket-stat {
  border-color: rgba(55, 200, 255, 0.24);
  background: rgba(55, 200, 255, 0.055);
}

.team1 .team-ticket-stat:disabled {
  border-color: rgba(55, 200, 255, 0.24);
  background: rgba(55, 200, 255, 0.055);
}

.team1 .team-ticket-stat .quick-stat-value {
  color: var(--color-team1-primary);
}

.team2 .team-ticket-stat {
  border-color: rgba(255, 155, 69, 0.24);
  background: rgba(255, 155, 69, 0.055);
}

.team2 .team-ticket-stat:disabled {
  border-color: rgba(255, 155, 69, 0.24);
  background: rgba(255, 155, 69, 0.055);
}

.team2 .team-ticket-stat .quick-stat-value {
  color: var(--color-team2-primary);
}

.team-ticket-stat.clickable:hover {
  border-color: var(--color-border-highlight);
  background: var(--color-bg-hover);
  transform: none;
  box-shadow: none;
}

.team-ticket-stat.clickable:hover .quick-stat-edit {
  opacity: 0.9;
}

.team-player-stat {
  min-width: 76px;
  padding-bottom: 2px;
}

.player-capacity-track {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 1px;
  height: 2px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.player-capacity-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 180ms ease;
  background: rgba(255, 255, 255, 0.25);
}

.team1 .team-player-stat.busy .player-capacity-fill {
  background: var(--color-team1-primary);
}

.team2 .team-player-stat.busy .player-capacity-fill {
  background: var(--color-team2-primary);
}

.team1 .team-player-stat.full .player-capacity-fill,
.team2 .team-player-stat.full .player-capacity-fill {
  background: var(--color-status-warning);
}

.team-player-stat.full .quick-stat-value {
  color: var(--color-status-warning);
}
</style>
