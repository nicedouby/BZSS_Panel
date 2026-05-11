<template>
  <div
    class="player-row"
    :class="{ selected: isSelected }"
    @click="$emit('select')"
  >
    <div class="player-row-left">
      <span class="player-name">{{ player.name }}</span>
      <div class="player-meta">
        <span class="player-role">{{ player.role }}</span>
        <span class="player-id">ID {{ player.playerId ?? "-" }}</span>
      </div>
    </div>
    <div v-if="playtimeText" class="player-playtime">
      {{ playtimeText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PlayerRowViewModel } from "../../types/squad-admin.types";

const props = defineProps<{
  player: PlayerRowViewModel;
  selected?: boolean;
}>();

defineEmits<{
  (event: "select"): void;
}>();

const isSelected = computed(() => props.selected ?? false);

const playtimeText = computed(() => {
  if (props.player.playtimeHours == null) return "";
  return `Steam ${props.player.playtimeHours}h`;
});
</script>

<style scoped>
.player-row {
  padding: var(--spacing-md);
  border-top: 1px solid var(--color-border-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
  transition: all 0.15s ease;
  cursor: pointer;
}

.player-row:hover {
  background-color: var(--color-bg-hover);
}

.player-row.selected {
  background-color: var(--color-bg-selected);
}

.player-row-left {
  display: grid;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.player-name {
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-meta {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  flex-wrap: wrap;
}

.player-role {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-id {
  white-space: nowrap;
}

.player-playtime {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .player-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .player-playtime {
    font-size: var(--font-size-xs);
  }
}
</style>
