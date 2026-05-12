<template>
  <div
    class="squad-leader-row"
    :class="{ selected: isSelected }"
    @click="$emit('select')"
  >
    <div class="leader-row-left">
      <div class="leader-identity">
        <span
          class="role-icon"
          :class="`tone-${roleIcon.tone}`"
          :title="`${roleIcon.label}: ${player.role || 'Unknown Role'}`"
          aria-hidden="true"
        >
          <img
            v-if="isRoleIconImage"
            class="role-icon-image"
            :src="roleIcon.icon"
            :alt="roleIcon.label"
          />
          <span v-else>{{ roleIcon.icon }}</span>
        </span>
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
import { resolveRoleIcon } from "../../utils/role-icons";

const props = defineProps<{
  player: SquadLeaderRowViewModel;
  selected?: boolean;
}>();

defineEmits<{
  (event: "select"): void;
}>();

const isSelected = computed(() => props.selected ?? false);
const roleIcon = computed(() => resolveRoleIcon(props.player.role));
const isRoleIconImage = computed(() => roleIcon.value.icon.startsWith("/"));

const playtimeText = computed(() => {
  if (props.player.playtimeHours == null) return "";
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
  flex-wrap: nowrap;
}

.role-icon {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.role-icon-image {
  width: 16px;
  height: 16px;
  object-fit: contain;
  display: block;
}

.tone-leader {
  color: #facc15;
  background: rgba(250, 204, 21, 0.1);
}

.tone-medic {
  color: #fb7185;
  background: rgba(251, 113, 133, 0.1);
}

.tone-at {
  color: #f97316;
  background: rgba(249, 115, 22, 0.1);
}

.tone-mg {
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.1);
}

.tone-engineer {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
}

.tone-marksman {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
}

.tone-rifleman {
  color: #cbd5e1;
  background: rgba(203, 213, 225, 0.08);
}

.tone-crewman {
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.1);
}

.tone-pilot {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.1);
}

.tone-default {
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.06);
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
