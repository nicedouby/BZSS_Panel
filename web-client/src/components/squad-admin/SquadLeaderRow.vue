<template>
  <div
    class="squad-leader-row"
    :class="{ selected: isSelected }"
    @click="$emit('select')"
  >
    <div class="leader-row-left">
      <div class="leader-identity">
        <span class="leader-icon">👑</span>
        <span class="leader-name">{{ player.name }}</span>
        <StatusBadge tone="ok">SL</StatusBadge>
      </div>
      <div class="leader-meta">
        <span class="leader-role">{{ player.role }}</span>
        <span class="leader-id">ID {{ player.playerId ?? "-" }}</span>
      </div>
    </div>
    <div v-if="playtimeText" class="leader-playtime">
      {{ playtimeText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SquadLeaderRowViewModel } from "../../types/squad-admin.types";
import StatusBadge from "../common/StatusBadge.vue";

const props = defineProps<{
  player: SquadLeaderRowViewModel;
  selected?: boolean;
}>();

defineEmits<{
  (event: "select"): void;
}>();

const isSelected = computed(() => props.selected ?? false);

const playtimeText = computed(() => {
  if (props.player.playtimeHours === null) return "";
  return `Steam ${props.player.playtimeHours}h`;
});
</script>

<style scoped>
.squad-leader-row {
  padding: var(--spacing-md);
  border-top: 1px solid var(--color-border-soft);
  border-left: 4px solid var(--color-status-leader);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
  background-color: rgba(250, 204, 21, 0.03);
  transition: all 0.15s ease;
  cursor: pointer;
}

.squad-leader-row:hover {
  background-color: rgba(250, 204, 21, 0.06);
}

.squad-leader-row.selected {
  background-color: var(--color-bg-selected);
  border-left-color: var(--color-status-info);
}

.leader-row-left {
  display: grid;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.leader-identity {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  flex-wrap: wrap;
}

.leader-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.leader-name {
  font-weight: 700;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leader-meta {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  flex-wrap: wrap;
}

.leader-role {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leader-id {
  white-space: nowrap;
}

.leader-playtime {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .squad-leader-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .leader-playtime {
    font-size: var(--font-size-xs);
  }
}
</style>
